use crate::xdesign_archive::{asset_relative, FileRecord, ImportedProject};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const PREFIX: &str = "xdesign.projectImport.";
const MAX_JSON: usize = 64 * 1024 * 1024;
const MAX_FILES: usize = 8192;
const OWNER: &str = ".orion-import-owner.json";
const READY: &str = ".orion-import-ready.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub project_id: String,
    pub operation_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u32,
    project_id: String,
    operation_id: String,
    phase: String,
    directory_identity: Option<Identity>,
    owner_digest: Option<String>,
    stamp_digest: Option<String>,
    commit_digest: Option<String>,
    cleanup_complete: bool,
    label: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Identity {
    device: u64,
    inode: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Owner {
    version: u32,
    receipt: Receipt,
    identity: Identity,
    files: Vec<FileRecord>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ready {
    version: u32,
    receipt: Receipt,
    imported: ImportedProject,
    asset_digest: String,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    Status {
        project_id: String,
        operation_id: String,
    },
    Discard {
        project_id: String,
        operation_id: String,
    },
    List {},
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid(receipt: &Receipt) -> Result<(), String> {
    for id in [&receipt.project_id, &receipt.operation_id] {
        ulid::Ulid::from_string(id).map_err(|_| "Invalid project import identity")?;
    }
    Ok(())
}
fn key(receipt: &Receipt) -> String {
    format!("{PREFIX}{}", receipt.project_id)
}
pub(crate) fn present(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}
fn identity(path: &Path) -> Result<Identity, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Project import path changed or is linked".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(Identity {
            device: meta.dev(),
            inode: meta.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        Err("Project import filesystem identity is unavailable".into())
    }
}
fn dir(path: &Path, create: bool) -> Result<(), String> {
    if create && !present(path)? {
        std::fs::create_dir(path).map_err(|e| e.to_string())?;
    }
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Project import directory changed or is linked".into());
    }
    Ok(())
}
fn bytes(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_JSON as u64 {
        return Err("Invalid project import metadata file".into());
    }
    let mut result = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_JSON as u64 + 1)
        .read_to_end(&mut result)
        .map_err(|e| e.to_string())?;
    if result.len() > MAX_JSON {
        return Err("Project import metadata exceeds its limit".into());
    }
    Ok(result)
}
fn write(path: &Path, value: &impl Serialize) -> Result<String, String> {
    let data = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if data.len() > MAX_JSON {
        return Err("Project import metadata exceeds its limit".into());
    }
    photocraft_format::atomic_write(path, &data).map_err(|e| e.to_string())?;
    Ok(hash(&data))
}
fn record(conn: &Connection, receipt: &Receipt) -> Result<Option<Record>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_state WHERE key=?1",
            [key(receipt)],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|raw| {
        if raw.len() > 4096 {
            return Err("Invalid project import receipt".into());
        }
        let r: Record = serde_json::from_str(&raw).map_err(|_| "Invalid project import receipt")?;
        if r.version != 1
            || r.project_id != receipt.project_id
            || r.operation_id != receipt.operation_id
            || !["preparing", "staged", "committed", "discarded"].contains(&r.phase.as_str())
        {
            return Err("Project import receipt changed; originals were preserved".into());
        }
        Ok(r)
    })
    .transpose()
}
fn save(conn: &Connection, r: &Record) -> Result<(), String> {
    conn.execute("INSERT INTO app_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("{PREFIX}{}",r.project_id),serde_json::to_string(r).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}
pub(crate) fn registry(conn: &Connection) -> Result<Vec<Value>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_state WHERE key='xdesign.projects'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.len() > MAX_JSON {
        return Err("Project registry exceeds its limit".into());
    }
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Project registry is corrupt")?;
    let entries = value["registry"]
        .as_array()
        .ok_or("Project registry is corrupt")?;
    let mut seen = HashSet::new();
    for entry in entries {
        let id = entry["id"].as_str().ok_or("Project registry is corrupt")?;
        ulid::Ulid::from_string(id).map_err(|_| "Project registry is corrupt")?;
        if !seen.insert(id) {
            return Err("Project registry has duplicate identities".into());
        }
    }
    Ok(entries.clone())
}
fn registered(conn: &Connection, id: &str) -> Result<bool, String> {
    let document: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM app_state WHERE key=?1)",
            [format!("xdesign.project.{id}")],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(document
        || registry(conn)?
            .iter()
            .any(|entry| entry["id"].as_str() == Some(id)))
}

pub(crate) struct Lease {
    pub receipt: Receipt,
    root: PathBuf,
    path: PathBuf,
    lock: File,
    lock_identity: Identity,
    directories: Vec<(PathBuf, Identity)>,
}
impl Lease {
    pub(crate) fn open(root: &Path, receipt: &Receipt, create: bool) -> Result<Self, String> {
        valid(receipt)?;
        dir(root, false)?;
        let parent = root.join(".project-imports");
        dir(&parent, create)?;
        let project = parent.join(&receipt.project_id);
        dir(&project, create)?;
        let path = project.join(&receipt.operation_id);
        dir(&path, create)?;
        let file = path.join("operation.lock");
        let exists = present(&file)?;
        if exists {
            let m = std::fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
            if !m.is_file() || m.file_type().is_symlink() {
                return Err("Project import lock changed".into());
            }
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(create && !exists)
            .truncate(false)
            .open(&file)
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|_| "Wait for the original project import to finish")?;
        let lock_identity = identity(&file)?;
        let directories = [root.to_path_buf(), parent, project, path.clone()]
            .into_iter()
            .map(|path| Ok((path.clone(), identity(&path)?)))
            .collect::<Result<Vec<_>, String>>()?;
        let lease = Self {
            receipt: receipt.clone(),
            root: root.into(),
            path,
            lock,
            lock_identity,
            directories,
        };
        lease.check()?;
        Ok(lease)
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        for (path, expected) in &self.directories {
            dir(path, false)?;
            if &identity(path)? != expected {
                return Err("Project import lock directory changed".into());
            }
        }
        if identity(&self.path.join("operation.lock"))? != self.lock_identity {
            return Err("Project import lock changed".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let m = self.lock.metadata().map_err(|e| e.to_string())?;
            if m.dev() != self.lock_identity.device || m.ino() != self.lock_identity.inode {
                return Err("Project import lock changed".into());
            }
        }
        Ok(())
    }
    fn target(&self) -> PathBuf {
        self.root.join(&self.receipt.project_id)
    }
    fn stage(&self) -> PathBuf {
        self.root
            .join(format!(".import-{}", self.receipt.operation_id))
    }
    fn discarded(&self) -> PathBuf {
        self.root
            .join(format!(".discard-{}", self.receipt.operation_id))
    }
}
pub(crate) fn begin(
    conn: &mut Connection,
    root: &Path,
    receipt: &Receipt,
) -> Result<Lease, String> {
    let lease = Lease::open(root, receipt, true)?;
    lease.check()?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    if registered(&tx, &receipt.project_id)?
        || record(&tx, receipt)?.is_some()
        || present(&lease.target())?
        || present(&lease.stage())?
        || present(&lease.discarded())?
    {
        return Err("Recover the original project import before retrying its identity".into());
    }
    let pending = pending(&tx)?["imports"]
        .as_array()
        .ok_or("Invalid project import list")?
        .len();
    if pending >= 64 {
        return Err("Recover interrupted project imports before adding another".into());
    }
    save(
        &tx,
        &Record {
            version: 1,
            project_id: receipt.project_id.clone(),
            operation_id: receipt.operation_id.clone(),
            phase: "preparing".into(),
            directory_identity: None,
            owner_digest: None,
            stamp_digest: None,
            commit_digest: None,
            cleanup_complete: false,
            label: None,
        },
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(lease)
}
pub(crate) fn owner(
    conn: &mut Connection,
    lease: &Lease,
    stage: &Path,
    files: &[FileRecord],
) -> Result<(), String> {
    lease.check()?;
    if stage != lease.stage() {
        return Err("Project import staging path changed".into());
    }
    if files.len() > MAX_FILES {
        return Err("Too many project import assets".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0usize;
    for file in files {
        let path = asset_relative(&file.name)?;
        total = total.saturating_add(file.bytes);
        if total > 512 * 1024 * 1024
            || file.sha256.len() != 64
            || !file.sha256.chars().all(|c| c.is_ascii_hexdigit())
            || !seen.insert(path.to_string_lossy().to_lowercase())
        {
            return Err("Conflicting or oversized project import assets".into());
        }
    }
    let mut r = record(conn, &lease.receipt)?.ok_or("Project import receipt is missing")?;
    if r.phase != "preparing" || r.directory_identity.is_some() {
        return Err("Project import staging changed".into());
    }
    dir(stage, false)?;
    r.directory_identity = Some(identity(stage)?);
    save(conn, &r)?;
    r.owner_digest = Some(write(
        &stage.join(OWNER),
        &Owner {
            version: 1,
            receipt: lease.receipt.clone(),
            identity: r.directory_identity.clone().unwrap(),
            files: files.to_vec(),
        },
    )?);
    save(conn, &r)
}
fn asset_digest(document: &Value) -> Result<String, String> {
    let mut copy = document.clone();
    let mut photos = Vec::new();
    crate::xdesign_archive::visit_photos(&mut copy, |photo| {
        photos.push(photo.clone());
        Ok(())
    })?;
    let mut paths = Vec::new();
    if let Some(pages) = document["pages"].as_array() {
        for page in pages {
            if let Some(shapes) = page["shapes"].as_array() {
                for shape in shapes {
                    for path in [&shape["filePath"], &shape["fillImage"]["filePath"]] {
                        if !path.is_null() {
                            paths.push(path.clone());
                        }
                    }
                }
            }
        }
    }
    Ok(hash(
        &serde_json::to_vec(
            &json!({"photos":photos,"drafts":document["photoDrafts"],"paths":paths}),
        )
        .map_err(|e| e.to_string())?,
    ))
}
pub(crate) fn ready(
    conn: &mut Connection,
    lease: &Lease,
    stage: &Path,
    imported: &ImportedProject,
) -> Result<(), String> {
    lease.check()?;
    let mut r = record(conn, &lease.receipt)?.ok_or("Project import receipt is missing")?;
    if r.phase != "preparing" || r.stamp_digest.is_some() {
        return Err("Project import result changed".into());
    }
    inventory(stage, &r, true)?;
    let label: String = imported.name.trim().chars().take(256).collect();
    r.label = if label.is_empty() { None } else { Some(label) };
    r.stamp_digest = Some(write(
        &stage.join(READY),
        &Ready {
            version: 1,
            receipt: lease.receipt.clone(),
            imported: imported.clone(),
            asset_digest: asset_digest(&imported.document)?,
        },
    )?);
    save(conn, &r)
}
fn inventory(path: &Path, r: &Record, complete: bool) -> Result<Owner, String> {
    dir(path, false)?;
    let data = bytes(&path.join(OWNER))?;
    if r.owner_digest.as_deref() != Some(hash(&data).as_str()) {
        return Err("Project import owner metadata changed; files were preserved".into());
    }
    let owner: Owner =
        serde_json::from_slice(&data).map_err(|_| "Project import owner metadata is corrupt")?;
    if owner.version != 1
        || owner.receipt.project_id != r.project_id
        || owner.receipt.operation_id != r.operation_id
        || Some(&owner.identity) != r.directory_identity.as_ref()
        || owner.identity != identity(path)?
        || owner.files.len() > MAX_FILES
    {
        return Err("Project import directory identity changed".into());
    }
    if present(&path.join(READY))? {
        let data = bytes(&path.join(READY))?;
        if r.stamp_digest.as_deref() != Some(hash(&data).as_str()) {
            return Err("Project import result changed; files were preserved".into());
        }
    }
    let mut expected = std::collections::BTreeMap::new();
    for file in &owner.files {
        let name = asset_relative(&file.name)?.to_string_lossy().to_string();
        if file.bytes > 512 * 1024 * 1024
            || file.sha256.len() != 64
            || expected.insert(name, file).is_some()
        {
            return Err("Invalid project import asset inventory".into());
        }
    }
    let allowed_dirs: HashSet<_> = expected
        .keys()
        .filter_map(|name| {
            Path::new(name)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .map(Path::to_path_buf)
        })
        .collect();
    let mut pending = vec![path.to_path_buf()];
    let mut seen = HashSet::new();
    let mut count = 0;
    let mut total = 0u64;
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let file = entry.path();
            let meta = std::fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() {
                return Err("Linked project import asset was preserved".into());
            }
            let relative = file
                .strip_prefix(path)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();
            if meta.is_dir() {
                if !allowed_dirs.contains(Path::new(&relative)) {
                    return Err("Unknown project import directory was preserved".into());
                }
                pending.push(file);
                continue;
            }
            if !meta.is_file() {
                return Err("Unknown project import asset was preserved".into());
            }
            if relative == OWNER || relative == READY {
                continue;
            }
            count += 1;
            total = total.saturating_add(meta.len());
            if count > MAX_FILES || total > 512 * 1024 * 1024 {
                return Err("Project import asset inventory exceeds its limit".into());
            }
            let declared = expected
                .get(&relative)
                .ok_or("Unknown project import asset was preserved")?;
            if meta.len() != declared.bytes as u64 {
                return Err("Changed project import asset was preserved".into());
            }
            let before = identity(&file)?;
            let input = File::open(&file).map_err(|e| e.to_string())?;
            let mut input = input.take(declared.bytes as u64 + 1);
            let mut digest = Sha256::new();
            let mut buffer = [0u8; 65536];
            let mut read_total = 0usize;
            loop {
                let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                read_total += read;
                digest.update(&buffer[..read]);
            }
            let after = std::fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let held = input.get_ref().metadata().map_err(|e| e.to_string())?;
                if held.dev() != before.device || held.ino() != before.inode {
                    return Err("Changed project import asset was preserved".into());
                }
            }
            if read_total != declared.bytes
                || format!("{:x}", digest.finalize()) != declared.sha256
                || identity(&file)? != before
                || after.len() != meta.len()
                || after.modified().ok() != meta.modified().ok()
            {
                return Err("Changed project import asset was preserved".into());
            }
            seen.insert(relative);
        }
    }
    if complete && seen.len() != expected.len() {
        return Err("Project import assets are incomplete".into());
    }
    if identity(path)? != owner.identity {
        return Err("Project import directory changed".into());
    }
    Ok(owner)
}
fn empty_owned(path: &Path, r: &Record) -> Result<(), String> {
    dir(path, false)?;
    if r.directory_identity.as_ref() != Some(&identity(path)?)
        || std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err("Unrecognized project import files were preserved".into());
    }
    Ok(())
}
fn cleanup_inventory(path: &Path, r: &Record) -> Result<(), String> {
    if !present(&path.join(OWNER))? {
        empty_owned(path, r)
    } else {
        inventory(path, r, false).map(|_| ())
    }
}
fn erase(path: &Path, r: &Record) -> Result<(), String> {
    if !present(&path.join(OWNER))? {
        empty_owned(path, r)?;
        return std::fs::remove_dir(path).map_err(|e| e.to_string());
    }
    let owner = inventory(path, r, false)?;
    let mut directories = HashSet::new();
    for file in &owner.files {
        let relative = asset_relative(&file.name)?;
        let target = path.join(&relative);
        if present(&target)? {
            std::fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
        if let Some(parent) = relative.parent().filter(|p| !p.as_os_str().is_empty()) {
            directories.insert(parent.to_path_buf());
        }
    }
    for directory in directories {
        let target = path.join(directory);
        if present(&target)? {
            std::fs::remove_dir(target).map_err(|e| e.to_string())?;
        }
    }
    if present(&path.join(READY))? {
        std::fs::remove_file(path.join(READY)).map_err(|e| e.to_string())?;
    }
    std::fs::remove_file(path.join(OWNER)).map_err(|e| e.to_string())?;
    empty_owned(path, r)?;
    std::fs::remove_dir(path).map_err(|e| e.to_string())
}
fn staged(lease: &Lease, r: &Record) -> Result<(ImportedProject, String), String> {
    lease.check()?;
    inventory(&lease.target(), r, true)?;
    let data = bytes(&lease.target().join(READY))?;
    let digest = hash(&data);
    if r.stamp_digest.as_ref() != Some(&digest) {
        return Err("Project import result changed".into());
    }
    let ready: Ready =
        serde_json::from_slice(&data).map_err(|_| "Project import result is corrupt")?;
    if ready.version != 1
        || ready.receipt != lease.receipt
        || ready.asset_digest != asset_digest(&ready.imported.document)?
    {
        return Err("Project import result changed".into());
    }
    Ok((ready.imported, digest))
}
pub(crate) fn finish(conn: &mut Connection, lease: &Lease) -> Result<(), String> {
    lease.check()?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut r = record(&tx, &lease.receipt)?.ok_or("Project import receipt is missing")?;
    if r.phase != "preparing" || registered(&tx, &lease.receipt.project_id)? {
        return Err("Project import changed before registration".into());
    }
    let (_, digest) = staged(lease, &r)?;
    r.phase = "staged".into();
    r.stamp_digest = Some(digest);
    save(&tx, &r)?;
    tx.commit().map_err(|e| e.to_string())
}
pub(crate) fn authorize(
    tx: &Transaction,
    lease: &Lease,
    document: &Value,
    writes_digest: &str,
) -> Result<bool, String> {
    lease.check()?;
    let r = record(tx, &lease.receipt)?.ok_or("Project import receipt is missing")?;
    if r.phase == "committed" {
        if r.commit_digest.as_deref() == Some(writes_digest)
            && registered(tx, &lease.receipt.project_id)?
        {
            return Ok(false);
        }
        return Err("The original project import commit changed".into());
    }
    if !["preparing", "staged"].contains(&r.phase.as_str())
        || registered(tx, &lease.receipt.project_id)?
    {
        return Err("Project import can no longer register its assets".into());
    }
    let (imported, digest) = staged(lease, &r)?;
    if asset_digest(document)? != asset_digest(&imported.document)? {
        return Err("Project import asset references changed before registration".into());
    }
    let mut r = r;
    r.phase = "committed".into();
    r.stamp_digest = Some(digest);
    r.commit_digest = Some(writes_digest.into());
    save(tx, &r)?;
    Ok(true)
}
pub(crate) fn has_pending(conn: &Connection, id: &str) -> Result<bool, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_state WHERE key=?1",
            [format!("{PREFIX}{id}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(raw) = raw {
        let r: Record =
            serde_json::from_str(&raw).map_err(|_| "Project import receipt is corrupt")?;
        if r.version != 1 || r.project_id != id {
            return Err("Project import receipt is corrupt".into());
        }
        return Ok(r.phase != "committed");
    }
    Ok(false)
}
fn response(
    lease: &Lease,
    phase: &str,
    imported: Option<ImportedProject>,
    registry: Option<Vec<Value>>,
) -> Value {
    json!({"version":1,"projectId":lease.receipt.project_id,"operationId":lease.receipt.operation_id,"phase":phase,"imported":imported,"registry":registry})
}
pub(crate) fn control(
    conn: &mut Connection,
    root: &Path,
    receipt: &Receipt,
    discard: bool,
) -> Result<Value, String> {
    let lease = Lease::open(root, receipt, false)?;
    lease.check()?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let Some(mut r) = record(&tx, receipt)? else {
        return Err("Project import receipt is missing; files were preserved".into());
    };
    if registered(&tx, &receipt.project_id)? {
        let raw: String = tx
            .query_row(
                "SELECT value FROM app_state WHERE key=?1",
                [format!("xdesign.project.{}", receipt.project_id)],
                |r| r.get(0),
            )
            .map_err(|_| "Registered project data is unavailable; files were preserved")?;
        if raw.len() > MAX_JSON {
            return Err("Registered project exceeds its limit".into());
        }
        let document: Value = serde_json::from_str(&raw)
            .map_err(|_| "Registered project data is corrupt; files were preserved")?;
        let entries = registry(&tx)?;
        let name = entries
            .iter()
            .find(|entry| entry["id"].as_str() == Some(&receipt.project_id))
            .and_then(|entry| entry["name"].as_str())
            .ok_or("Registered project metadata is unavailable")?;
        return Ok(response(
            &lease,
            "committed",
            Some(ImportedProject {
                name: name.into(),
                document,
            }),
            Some(entries),
        ));
    }
    if r.phase == "committed" {
        return Err("A registered import was removed or changed; its files were preserved".into());
    }
    if !discard {
        if r.phase == "preparing"
            && r.stamp_digest.is_some()
            && !present(&lease.target())?
            && present(&lease.stage())?
        {
            inventory(&lease.stage(), &r, true)?;
            lease.check()?;
            std::fs::rename(lease.stage(), lease.target()).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                File::open(root)
                    .and_then(|dir| dir.sync_all())
                    .map_err(|e| e.to_string())?;
            }
        }
        if r.phase != "discarded" && present(&lease.target())? {
            let (imported, digest) = staged(&lease, &r)?;
            if r.phase == "preparing" {
                r.phase = "staged".into();
                r.stamp_digest = Some(digest);
                save(&tx, &r)?;
                tx.commit().map_err(|e| e.to_string())?;
            }
            return Ok(response(&lease, "staged", Some(imported), None));
        }
        return Ok(response(&lease, &r.phase, None, None));
    }
    for path in [lease.target(), lease.stage(), lease.discarded()] {
        if present(&path)? {
            cleanup_inventory(&path, &r)?;
        }
    }
    let target = lease.target();
    let quarantine = lease.discarded();
    if present(&target)? {
        if present(&quarantine)? {
            return Err("Conflicting project import cleanup paths were preserved".into());
        }
        std::fs::rename(&target, &quarantine).map_err(|e| e.to_string())?;
    }
    r.phase = "discarded".into();
    r.cleanup_complete = false;
    save(&tx, &r)?;
    if let Err(error) = tx.commit() {
        if present(&quarantine)? && !present(&target)? {
            let _ = std::fs::rename(&quarantine, &target);
        }
        return Err(error.to_string());
    }
    for path in [lease.stage(), quarantine] {
        if present(&path)? {
            lease.check()?;
            erase(&path, &r)?;
        }
    }
    r.cleanup_complete = true;
    lease.check()?;
    save(conn, &r)?;
    Ok(response(&lease, "discarded", None, None))
}
fn pending(conn: &Connection) -> Result<Value, String> {
    let mut stmt=conn.prepare("SELECT key,value FROM app_state WHERE key LIKE 'xdesign.projectImport.%' AND (json_extract(value,'$.phase') IN ('preparing','staged') OR (json_extract(value,'$.phase')='discarded' AND NOT COALESCE(json_extract(value,'$.cleanupComplete'),0))) ORDER BY key LIMIT 65").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        let (key, raw) = row.map_err(|e| e.to_string())?;
        if raw.len() > 4096 {
            return Err("Project import receipt exceeds its limit".into());
        }
        let r: Record =
            serde_json::from_str(&raw).map_err(|_| "Project import receipt is corrupt")?;
        let receipt = Receipt {
            project_id: r.project_id,
            operation_id: r.operation_id,
        };
        valid(&receipt)?;
        if r.version != 1
            || key != self::key(&receipt)
            || !["preparing", "staged", "discarded"].contains(&r.phase.as_str())
            || r.label
                .as_ref()
                .is_some_and(|label| label.trim().is_empty() || label.chars().count() > 256)
        {
            return Err("Invalid pending project import receipt".into());
        }
        let can_open = r.phase != "discarded" && r.stamp_digest.is_some();
        result.push(json!({"projectId":receipt.project_id,"operationId":receipt.operation_id,"phase":r.phase,"name":r.label,"canOpen":can_open}));
    }
    if result.len() > 64 {
        return Err("Too many interrupted project imports".into());
    }
    Ok(json!({"version":1,"imports":result}))
}

#[derive(Default)]
pub(crate) struct MaintenanceProtection {
    active: HashSet<String>,
    committed: HashSet<String>,
}
impl MaintenanceProtection {
    pub(crate) fn protects(&self, project: &Path, id: &str) -> Result<bool, String> {
        // A copy may promote after the maintenance DB snapshot, so its owner marker also protects it.
        Ok(self.active.contains(id)
            || !self.committed.contains(id) && present(&project.join(OWNER))?)
    }
}
pub(crate) fn maintenance_protection(conn: &Connection) -> Result<MaintenanceProtection, String> {
    let mut protection = MaintenanceProtection::default();
    let mut statement=conn.prepare("SELECT key,substr(value,1,4097) FROM app_state WHERE key LIKE 'xdesign.projectImport.%'").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for (index, row) in rows.enumerate() {
        if index >= 100_000 {
            return Err(
                "Project import records exceed the maintenance scan limit; cleanup was cancelled"
                    .into(),
            );
        }
        let (stored_key, raw) = row.map_err(|e| e.to_string())?;
        if raw.len() > 4096 {
            return Err("Project import metadata is oversized; cleanup was cancelled".into());
        }
        let r: Record = serde_json::from_str(&raw)
            .map_err(|_| "Project import metadata is invalid; cleanup was cancelled")?;
        let receipt = Receipt {
            project_id: r.project_id.clone(),
            operation_id: r.operation_id,
        };
        valid(&receipt)?;
        if r.version != 1
            || stored_key != key(&receipt)
            || !["preparing", "staged", "committed", "discarded"].contains(&r.phase.as_str())
        {
            return Err("Project import metadata changed; cleanup was cancelled".into());
        }
        if r.phase == "committed" {
            protection.committed.insert(r.project_id);
        } else {
            protection.active.insert(r.project_id);
        }
    }
    Ok(protection)
}
fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("orion.db");
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(db)
}
pub(crate) fn managed(
    app: &AppHandle,
    receipt: &Receipt,
    work: impl FnOnce(&Lease, &mut Connection) -> Result<ImportedProject, String>,
) -> Result<ImportedProject, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets/xdesign");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut conn = connection(app)?;
    let lease = begin(&mut conn, &root, receipt)?;
    let imported = work(&lease, &mut conn)?;
    finish(&mut conn, &lease)?;
    Ok(imported)
}
#[tauri::command]
pub async fn xdesign_project_import_control(
    app: AppHandle,
    operation: Operation,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = connection(&app)?;
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("assets/xdesign");
        match operation {
            Operation::Status {
                project_id,
                operation_id,
            } => control(
                &mut conn,
                &root,
                &Receipt {
                    project_id,
                    operation_id,
                },
                false,
            ),
            Operation::Discard {
                project_id,
                operation_id,
            } => control(
                &mut conn,
                &root,
                &Receipt {
                    project_id,
                    operation_id,
                },
                true,
            ),
            Operation::List {} => pending(&conn),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "xdesign_project_import_tests.rs"]
mod tests;
