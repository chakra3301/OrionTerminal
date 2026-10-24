use super::{failure, identifier, image, invalid, RoomFailure};
use crate::xdesign_archive::room_image::{self as archive, ArchiveInfo};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const MAX_RECORD: usize = 128 * 1024;
const MAX_ARCHIVE: usize = 512 * 1024 * 1024;
const MAX_CACHE: u64 = 1024 * 1024 * 1024;
const MAX_TRANSFERS: usize = 256;
const MAX_SCAN_FILES: usize = 200_000;
const CACHE: &str = ".room-images";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    pub version: u32,
    pub project_id: String,
    pub member_id: String,
    pub transfer_id: String,
    pub action: Action,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Prepare { photo: Value },
    Status {},
    Read { index: u32 },
    Stage { manifest: Value },
    Put { index: u32, chunk: Value },
    Import {},
    Discard {},
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    origin: String,
    document_id: String,
    member_id: String,
    project_id: String,
    transfer_id: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Upload,
    Download,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Preparing,
    Ready,
    Receiving,
    Importing,
    Imported,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u32,
    scope: Scope,
    direction: Direction,
    phase: Phase,
    source: Option<Value>,
    manifest: Option<Value>,
    info: Option<ArchiveInfo>,
    local_id: Option<String>,
    local_version: Option<String>,
    photo: Option<Value>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    record: Record,
    sha256: String,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn broken() -> RoomFailure {
    failure(
        422,
        "file",
        "The image transfer is incomplete or changed. Original files were retained.",
    )
}
fn capacity() -> RoomFailure {
    failure(
        413,
        "capacity",
        "The local image transfer cache is full. Retained transfers were preserved.",
    )
}
fn canonical_id(id: &str) -> Result<(), RoomFailure> {
    if ulid::Ulid::from_string(id)
        .map_err(|_| invalid())?
        .to_string()
        != id
    {
        return Err(invalid());
    }
    Ok(())
}
fn directory(path: &Path) -> Result<(), RoomFailure> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| broken())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(broken());
    }
    Ok(())
}
#[cfg(unix)]
type DirectoryIdentity = (u64, u64);
#[cfg(not(unix))]
type DirectoryIdentity = std::time::SystemTime;
fn directory_identity(path: &Path) -> Result<DirectoryIdentity, RoomFailure> {
    directory(path)?;
    let metadata = std::fs::symlink_metadata(path).map_err(|_| broken())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok((metadata.dev(), metadata.ino()))
    }
    #[cfg(not(unix))]
    {
        metadata.created().map_err(|_| broken())
    }
}
fn ensure(path: &Path) -> Result<(), RoomFailure> {
    if !path.exists() {
        std::fs::create_dir(path).map_err(|_| broken())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| broken())?;
        }
    }
    directory(path)
}
fn bytes(path: &Path, max: usize) -> Result<Vec<u8>, RoomFailure> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| broken())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > max as u64 {
        return Err(broken());
    }
    let mut out = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| broken())?
        .take(max as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| broken())?;
    if out.len() > max {
        return Err(broken());
    }
    Ok(out)
}
struct Draft(PathBuf);
impl Drop for Draft {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
fn atomic(path: &Path, data: &[u8]) -> Result<(), RoomFailure> {
    let parent = path.parent().ok_or_else(broken)?;
    directory(parent)?;
    // Never recreate a deleted project's parents during a late transfer write.
    let draft = Draft(parent.join(format!(".transfer-{}.tmp", ulid::Ulid::new())));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&draft.0)
        .map_err(|_| broken())?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(|_| broken())?;
    std::fs::rename(&draft.0, path).map_err(|_| broken())?;
    std::fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|_| broken())
}
fn load(path: &Path) -> Result<Record, RoomFailure> {
    let envelope: Envelope =
        serde_json::from_slice(&bytes(path, MAX_RECORD)?).map_err(|_| broken())?;
    if envelope.record.version != 1
        || digest(&serde_json::to_vec(&envelope.record).map_err(|_| broken())?) != envelope.sha256
    {
        return Err(broken());
    }
    Ok(envelope.record)
}
fn save(path: &Path, record: &Record) -> Result<(), RoomFailure> {
    let sha256 = digest(&serde_json::to_vec(record).map_err(|_| broken())?);
    let bytes = serde_json::to_vec(&Envelope {
        record: record.clone(),
        sha256,
    })
    .map_err(|_| broken())?;
    if bytes.len() > MAX_RECORD {
        return Err(capacity());
    }
    atomic(path, &bytes)
}
fn manifest_info(value: &Value) -> Result<ArchiveInfo, RoomFailure> {
    image::manifest(value)?;
    serde_json::from_value(json!({"name":value["name"],"width":value["width"],"height":value["height"],"previewWidth":value["previewWidth"],"previewHeight":value["previewHeight"],
        "archiveBytes":value["archiveBytes"],"archiveDigest":value["archiveDigest"],"previewDigest":value["previewDigest"],"chunkDigests":value["chunkDigests"]})).map_err(|_|broken())
}
fn same_info(a: &ArchiveInfo, b: &ArchiveInfo) -> bool {
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}
fn chunk_size(info: &ArchiveInfo, index: u32) -> Result<usize, RoomFailure> {
    image::index(index)?;
    let offset = index as usize * archive::CHUNK_BYTES;
    if offset >= info.archive_bytes {
        return Err(invalid());
    }
    Ok(archive::CHUNK_BYTES.min(info.archive_bytes - offset))
}
fn cache_usage(root: &Path) -> Result<(u64, usize), RoomFailure> {
    let mut total = 0u64;
    let mut transfers = 0usize;
    let mut files = 0usize;
    for entry in std::fs::read_dir(root).map_err(|_| broken())? {
        let entry = entry.map_err(|_| broken())?;
        if canonical_id(&entry.file_name().to_string_lossy()).is_err()
            || !entry.file_type().map_err(|_| broken())?.is_dir()
        {
            continue;
        }
        let cache = entry.path().join(CACHE);
        match std::fs::symlink_metadata(&cache) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(broken()),
            Ok(_) => {}
        }
        directory(&cache)?;
        for entry in walkdir::WalkDir::new(&cache).follow_links(false) {
            let entry = entry.map_err(|_| broken())?;
            files += 1;
            if files > MAX_SCAN_FILES {
                return Err(capacity());
            }
            if entry.depth() > 8 || entry.file_type().is_symlink() {
                return Err(broken());
            }
            if entry.file_type().is_file() {
                total = total
                    .checked_add(entry.metadata().map_err(|_| broken())?.len())
                    .ok_or_else(capacity)?;
                if entry.file_name() == "record.json" {
                    transfers += 1;
                }
            }
        }
    }
    Ok((total, transfers))
}
pub(crate) fn retained_photos(root: &Path) -> Result<HashSet<(String, String, String)>, String> {
    let mut refs = HashSet::new();
    let mut entries = 0usize;
    let mut records = 0usize;
    if !root.exists() {
        return Ok(refs);
    }
    for project in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let project = project.map_err(|e| e.to_string())?;
        let project_id = project.file_name().to_string_lossy().into_owned();
        if canonical_id(&project_id).is_err()
            || !project.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            continue;
        }
        let cache = project.path().join(CACHE);
        match std::fs::symlink_metadata(&cache) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
            Ok(_) => {}
        }
        directory(&cache).map_err(|_| "Invalid pending Image cache")?;
        for entry in walkdir::WalkDir::new(&cache)
            .follow_links(false)
            .max_depth(5)
        {
            let entry = entry.map_err(|e| e.to_string())?;
            entries += 1;
            if entries > MAX_SCAN_FILES {
                return Err("Pending Image cache scan exceeds its limit".into());
            }
            if entry.file_type().is_symlink() {
                return Err("Invalid pending Image cache link".into());
            }
            if entry.file_name() != "record.json" || !entry.file_type().is_file() {
                continue;
            }
            records += 1;
            if records > MAX_TRANSFERS {
                return Err("Too many pending Image transfers; image cleanup was cancelled".into());
            }
            let record = load(entry.path())
                .map_err(|_| "Pending Image cache checksum failed; image cleanup was cancelled")?;
            let store = Store::new(
                root,
                &record.scope.origin,
                &record.scope.document_id,
                &record.scope.member_id,
                &record.scope.project_id,
                &record.scope.transfer_id,
            )
            .map_err(|_| "Invalid pending Image scope")?;
            if store
                .path(false)
                .map_err(|_| "Invalid pending Image scope")?
                .join("record.json")
                != entry.path()
            {
                return Err("Pending Image cache belongs to another scope".into());
            }
            store
                .validate(&record)
                .map_err(|_| "Invalid pending Image cache record")?;
            if let Some(source) = record.source {
                refs.insert((
                    project_id.clone(),
                    source["id"]
                        .as_str()
                        .ok_or("Invalid pending Image identity")?
                        .into(),
                    source["version"]
                        .as_str()
                        .ok_or("Invalid pending Image version")?
                        .into(),
                ));
            }
            if let (Some(id), Some(version)) = (record.local_id, record.local_version) {
                refs.insert((project_id.clone(), id, version));
            }
            if refs.len() > MAX_TRANSFERS * 2 {
                return Err(
                    "Too many pending Image references; image cleanup was cancelled".into(),
                );
            }
        }
    }
    Ok(refs)
}

pub(crate) struct Store {
    root: PathBuf,
    project: PathBuf,
    root_identity: DirectoryIdentity,
    project_identity: DirectoryIdentity,
    scope: Scope,
}
impl Store {
    pub(crate) fn new(
        root: &Path,
        origin: &str,
        document_id: &str,
        member_id: &str,
        project_id: &str,
        transfer_id: &str,
    ) -> Result<Self, RoomFailure> {
        canonical_id(project_id)?;
        for id in [document_id, member_id, transfer_id] {
            identifier(id)?;
        }
        let origin = super::server(origin)?.to_string();
        let root_identity = directory_identity(root)?;
        let project = root.join(project_id);
        let project_identity = directory_identity(&project)?;
        Ok(Self {
            root: root.into(),
            project,
            root_identity,
            project_identity,
            scope: Scope {
                origin,
                document_id: document_id.into(),
                member_id: member_id.into(),
                project_id: project_id.into(),
                transfer_id: transfer_id.into(),
            },
        })
    }
    fn current_project(&self) -> Result<(), RoomFailure> {
        if directory_identity(&self.root)? != self.root_identity
            || directory_identity(&self.project)? != self.project_identity
        {
            return Err(broken());
        }
        Ok(())
    }
    fn path(&self, create: bool) -> Result<PathBuf, RoomFailure> {
        self.current_project()?;
        let mut path = self.project.clone();
        for part in [
            CACHE.into(),
            digest(self.scope.origin.as_bytes()),
            self.scope.document_id.clone(),
            self.scope.member_id.clone(),
            self.scope.transfer_id.clone(),
        ] {
            path.push(part);
            if create {
                ensure(&path)?;
            } else {
                directory(&path)?;
            }
        }
        Ok(path)
    }
    fn discarded(&self) -> Value {
        json!({"version":1,"documentId":self.scope.document_id,"memberId":self.scope.member_id,"projectId":self.scope.project_id,"transferId":self.scope.transfer_id,"discarded":true})
    }
    fn missing_cache(&self) -> Result<bool, RoomFailure> {
        self.current_project()?;
        let mut path = self.project.clone();
        for part in [
            CACHE.into(),
            digest(self.scope.origin.as_bytes()),
            self.scope.document_id.clone(),
            self.scope.member_id.clone(),
            self.scope.transfer_id.clone(),
        ] {
            path.push(part);
            match std::fs::symlink_metadata(&path) {
                Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(true),
                _ => return Err(broken()),
            }
        }
        Ok(false)
    }
    fn validate(&self, record: &Record) -> Result<(), RoomFailure> {
        if record.version != 1 || record.scope != self.scope {
            return Err(broken());
        }
        match record.direction {
            Direction::Upload => {
                archive::validate_source(record.source.as_ref().ok_or_else(broken)?)
                    .map_err(|_| broken())?;
                if !matches!(record.phase, Phase::Preparing | Phase::Ready)
                    || record.manifest.is_some()
                    || record.local_id.is_some()
                    || record.local_version.is_some()
                    || record.photo.is_some()
                    || record.phase == Phase::Ready && record.info.is_none()
                {
                    return Err(broken());
                }
                if let Some(info) = &record.info {
                    let source = record.source.as_ref().ok_or_else(broken)?;
                    if info.archive_bytes == 0
                        || info.archive_bytes > MAX_ARCHIVE
                        || info.chunk_digests.len()
                            != info.archive_bytes.div_ceil(archive::CHUNK_BYTES)
                    {
                        return Err(broken());
                    }
                    for hash in [&info.archive_digest, &info.preview_digest]
                        .into_iter()
                        .chain(info.chunk_digests.iter())
                    {
                        image::hash(hash).map_err(|_| broken())?;
                    }
                    if source["name"] != info.name
                        || source["width"] != info.width
                        || source["height"] != info.height
                        || source["previewWidth"] != info.preview_width
                        || source["previewHeight"] != info.preview_height
                    {
                        return Err(broken());
                    }
                }
            }
            Direction::Download => {
                let info = manifest_info(record.manifest.as_ref().ok_or_else(broken)?)?;
                if !same_info(&info, record.info.as_ref().ok_or_else(broken)?)
                    || record.source.is_some()
                {
                    return Err(broken());
                }
                if !matches!(
                    record.phase,
                    Phase::Receiving | Phase::Importing | Phase::Imported
                ) || (record.phase != Phase::Receiving) != record.local_id.is_some()
                    || record.local_id.is_some() != record.local_version.is_some()
                    || (record.phase == Phase::Imported) != record.photo.is_some()
                {
                    return Err(broken());
                }
                if let Some(id) = &record.local_id {
                    canonical_id(id)?;
                }
                if let Some(version) = &record.local_version {
                    canonical_id(version)?;
                }
                if let Some(photo) = &record.photo {
                    archive::validate_source(photo).map_err(|_| broken())?;
                    let id = record.local_id.as_deref().ok_or_else(broken)?;
                    let version = photo["version"].as_str().ok_or_else(broken)?;
                    if photo["id"] != id
                        || Some(version) != record.local_version.as_deref()
                        || photo["originalPath"] != Value::Null
                        || photo["bundlePath"]
                            != json!(self.project.join(id).join(format!("{version}.pcraft")))
                        || photo["previewPath"]
                            != json!(self.project.join(id).join(format!("{version}.png")))
                    {
                        return Err(broken());
                    }
                }
            }
        }
        Ok(())
    }
    fn admit(&self, additional: usize, new: bool) -> Result<(), RoomFailure> {
        let (bytes, count) = cache_usage(&self.root)?;
        if bytes
            .checked_add(additional as u64)
            .is_none_or(|n| n > MAX_CACHE)
            || new && count >= MAX_TRANSFERS
        {
            return Err(capacity());
        }
        Ok(())
    }
    fn progress(
        &self,
        path: &Path,
        record: &Record,
        verify: bool,
    ) -> Result<Vec<u32>, RoomFailure> {
        if record.direction == Direction::Upload {
            return Ok(Vec::new());
        }
        let parts = path.join("parts");
        directory(&parts)?;
        let info = record.info.as_ref().ok_or_else(broken)?;
        let mut received = Vec::new();
        for entry in std::fs::read_dir(parts).map_err(|_| broken())? {
            let entry = entry.map_err(|_| broken())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let index = name
                .strip_suffix(".bin")
                .and_then(|n| n.parse::<u32>().ok())
                .ok_or_else(broken)?;
            if name != format!("{index}.bin") {
                return Err(broken());
            }
            let expected = chunk_size(info, index)?;
            let meta = std::fs::symlink_metadata(entry.path()).map_err(|_| broken())?;
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() != expected as u64 {
                return Err(broken());
            }
            if verify {
                let data = bytes(&entry.path(), expected)?;
                if data.len() != expected || digest(&data) != info.chunk_digests[index as usize] {
                    return Err(broken());
                }
            }
            received.push(index);
        }
        received.sort_unstable();
        Ok(received)
    }
    fn status(&self, path: &Path, record: &Record) -> Result<Value, RoomFailure> {
        self.status_with(path, record, true)
    }
    fn status_with(
        &self,
        path: &Path,
        record: &Record,
        verify: bool,
    ) -> Result<Value, RoomFailure> {
        self.validate(record)?;
        let received = self.progress(path, record, verify)?;
        if record.phase == Phase::Ready {
            let meta = std::fs::symlink_metadata(path.join("archive.bin")).map_err(|_| broken())?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() != record.info.as_ref().ok_or_else(broken)?.archive_bytes as u64
            {
                return Err(broken());
            }
        }
        if record.phase == Phase::Imported {
            if received.len() != record.info.as_ref().ok_or_else(broken)?.chunk_digests.len() {
                return Err(broken());
            }
            let photo = record.photo.as_ref().ok_or_else(broken)?;
            let meta = std::fs::symlink_metadata(photo["bundlePath"].as_str().ok_or_else(broken)?)
                .map_err(|_| broken())?;
            if !(meta.is_file() || meta.is_dir()) || meta.file_type().is_symlink() {
                return Err(broken());
            }
        }
        Ok(
            json!({"version":1,"documentId":self.scope.document_id,"memberId":self.scope.member_id,"projectId":self.scope.project_id,"transferId":self.scope.transfer_id,"direction":record.direction,"state":record.phase,"source":record.source,"manifest":record.manifest,"info":record.info,"received":received,"photo":record.photo}),
        )
    }
    pub(crate) fn run(
        &self,
        action: Action,
        request_check: &mut dyn FnMut() -> Result<(), RoomFailure>,
    ) -> Result<Value, RoomFailure> {
        let mut check = || {
            self.current_project()?;
            request_check()
        };
        check()?;
        if matches!(&action, Action::Discard {}) && self.missing_cache()? {
            check()?;
            return Ok(self.discarded());
        }
        match &action {
            Action::Prepare { photo } => archive::validate_source(photo).map_err(|_| invalid())?,
            Action::Stage { manifest } => {
                manifest_info(manifest)?;
            }
            _ => {}
        }
        let create = matches!(action, Action::Prepare { .. } | Action::Stage { .. });
        let path = self.path(create)?;
        let lock_path = path.join("operation.lock");
        if std::fs::symlink_metadata(&lock_path)
            .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
        {
            return Err(broken());
        }
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(|_| broken())?;
        lock.try_lock().map_err(|_| {
            failure(
                503,
                "busy",
                "Wait for the original image file operation to finish.",
            )
        })?;
        let record_path = path.join("record.json");
        let mut record = if record_path.exists() {
            let r = load(&record_path)?;
            self.validate(&r)?;
            Some(r)
        } else {
            None
        };
        if record.is_none()
            && std::fs::read_dir(&path)
                .map_err(|_| broken())?
                .any(|e| e.map_or(true, |e| e.file_name() != "operation.lock"))
        {
            return Err(broken());
        }
        match action {
            Action::Prepare { photo } => {
                archive::validate_source(&photo).map_err(|_| invalid())?;
                if let Some(r) = &record {
                    if r.direction != Direction::Upload || r.source.as_ref() != Some(&photo) {
                        return Err(failure(
                            409,
                            "conflict",
                            "The original image preparation request changed.",
                        ));
                    }
                } else {
                    self.admit(MAX_RECORD, true)?;
                    let r = Record {
                        version: 1,
                        scope: self.scope.clone(),
                        direction: Direction::Upload,
                        phase: Phase::Preparing,
                        source: Some(photo.clone()),
                        manifest: None,
                        info: None,
                        local_id: None,
                        local_version: None,
                        photo: None,
                    };
                    save(&record_path, &r)?;
                    record = Some(r);
                }
                let mut r = record.ok_or_else(broken)?;
                if r.phase == Phase::Preparing {
                    if std::fs::symlink_metadata(path.join("archive.bin")).is_ok() {
                        let data = bytes(&path.join("archive.bin"), MAX_ARCHIVE)?;
                        let info = r.info.as_ref().ok_or_else(broken)?;
                        if data.len() != info.archive_bytes
                            || digest(&data) != info.archive_digest
                            || data
                                .chunks(archive::CHUNK_BYTES)
                                .map(digest)
                                .collect::<Vec<_>>()
                                != info.chunk_digests
                        {
                            return Err(broken());
                        }
                    } else {
                        let built = archive::build_guarded(&self.project, &photo, &mut || {
                            check().map_err(|_| "Image operation cancelled".into())
                        });
                        let built = match built {
                            Ok(v) => v,
                            Err(_) => {
                                check()?;
                                return Err(broken());
                            }
                        };
                        check()?;
                        if r.info
                            .as_ref()
                            .is_some_and(|info| !same_info(info, &built.info))
                        {
                            return Err(broken());
                        }
                        self.admit(built.bytes.len() + MAX_RECORD, false)?;
                        r.info = Some(built.info);
                        save(&record_path, &r)?;
                        check()?;
                        atomic(&path.join("archive.bin"), &built.bytes)?;
                    }
                    check()?;
                    r.phase = Phase::Ready;
                    save(&record_path, &r)?;
                }
                self.status(&path, &r)
            }
            Action::Stage { manifest } => {
                let info = manifest_info(&manifest)?;
                if let Some(r) = &record {
                    if r.direction != Direction::Download || r.manifest.as_ref() != Some(&manifest)
                    {
                        return Err(failure(
                            409,
                            "conflict",
                            "The original image download request changed.",
                        ));
                    }
                } else {
                    self.admit(MAX_RECORD, true)?;
                    let r = Record {
                        version: 1,
                        scope: self.scope.clone(),
                        direction: Direction::Download,
                        phase: Phase::Receiving,
                        source: None,
                        manifest: Some(manifest),
                        info: Some(info),
                        local_id: None,
                        local_version: None,
                        photo: None,
                    };
                    check()?;
                    save(&record_path, &r)?;
                    record = Some(r);
                }
                ensure(&path.join("parts"))?;
                self.status(&path, &record.ok_or_else(broken)?)
            }
            Action::Status {} => self.status(&path, &record.ok_or_else(broken)?),
            Action::Read { index } => {
                let r = record.ok_or_else(broken)?;
                if r.direction != Direction::Upload || r.phase != Phase::Ready {
                    return Err(broken());
                }
                let info = r.info.as_ref().ok_or_else(broken)?;
                let size = chunk_size(info, index)?;
                let file_path = path.join("archive.bin");
                let meta = std::fs::symlink_metadata(&file_path).map_err(|_| broken())?;
                if !meta.is_file()
                    || meta.file_type().is_symlink()
                    || meta.len() != info.archive_bytes as u64
                {
                    return Err(broken());
                }
                let mut file = std::fs::File::open(file_path).map_err(|_| broken())?;
                file.seek(SeekFrom::Start(index as u64 * archive::CHUNK_BYTES as u64))
                    .map_err(|_| broken())?;
                let mut data = vec![0; size];
                file.read_exact(&mut data).map_err(|_| broken())?;
                if digest(&data) != info.chunk_digests[index as usize] {
                    return Err(broken());
                }
                check()?;
                Ok(
                    json!({"version":1,"documentId":self.scope.document_id,"memberId":self.scope.member_id,"projectId":self.scope.project_id,"transferId":self.scope.transfer_id,"chunk":{"version":1,"index":index,"sha256":info.chunk_digests[index as usize],"data":STANDARD.encode(data)}}),
                )
            }
            Action::Put { index, chunk } => {
                let r = record.ok_or_else(broken)?;
                if r.direction != Direction::Download {
                    return Err(broken());
                }
                image::chunk(&chunk, index)?;
                let info = r.info.as_ref().ok_or_else(broken)?;
                let size = chunk_size(info, index)?;
                let data = STANDARD
                    .decode(chunk["data"].as_str().ok_or_else(invalid)?)
                    .map_err(|_| invalid())?;
                if data.len() != size || chunk["sha256"] != info.chunk_digests[index as usize] {
                    return Err(invalid());
                }
                let file = path.join("parts").join(format!("{index}.bin"));
                if std::fs::symlink_metadata(&file).is_ok() {
                    if bytes(&file, size)? != data {
                        return Err(broken());
                    }
                } else {
                    if r.phase != Phase::Receiving {
                        return Err(broken());
                    }
                    self.admit(data.len(), false)?;
                    check()?;
                    atomic(&file, &data)?;
                }
                self.status_with(&path, &r, false)
            }
            Action::Import {} => {
                let mut r = record.ok_or_else(broken)?;
                if r.direction != Direction::Download {
                    return Err(broken());
                }
                if r.phase == Phase::Imported {
                    return self.status(&path, &r);
                }
                let info = r.info.as_ref().ok_or_else(broken)?.clone();
                let received = self.progress(&path, &r, false)?;
                if received.len() != info.chunk_digests.len() {
                    return Err(broken());
                }
                let mut data = Vec::with_capacity(info.archive_bytes);
                for index in received {
                    check()?;
                    let chunk = bytes(
                        &path.join("parts").join(format!("{index}.bin")),
                        archive::CHUNK_BYTES,
                    )?;
                    if digest(&chunk) != info.chunk_digests[index as usize] {
                        return Err(broken());
                    }
                    data.extend(chunk);
                }
                if data.len() != info.archive_bytes || digest(&data) != info.archive_digest {
                    return Err(broken());
                }
                check()?;
                if r.phase == Phase::Receiving {
                    r.local_version = Some(archive::native_version(&data).map_err(|_| broken())?);
                    r.local_id = Some(ulid::Ulid::new().to_string());
                    r.phase = Phase::Importing;
                    save(&record_path, &r)?;
                }
                let id = r.local_id.as_deref().ok_or_else(broken)?;
                let imported = if self.project.join(id).exists() {
                    archive::recover_import(&data, &self.project, id, &info)
                } else {
                    archive::import_guarded(&data, &self.project, id, &info, &mut || {
                        check().map_err(|_| "Image operation cancelled".into())
                    })
                };
                let imported = match imported {
                    Ok(v) => v,
                    Err(_) => {
                        check()?;
                        return Err(broken());
                    }
                };
                // A committed native image needs its original receipt even if the caller just cancelled.
                self.current_project()?;
                r.photo = Some(imported.photo);
                r.phase = Phase::Imported;
                save(&record_path, &r)?;
                self.status(&path, &r)
            }
            Action::Discard {} => {
                let r = record.ok_or_else(broken)?;
                self.validate(&r)?;
                check()?;
                std::fs::remove_dir_all(&path).map_err(|_| broken())?;
                Ok(self.discarded())
            }
        }
    }
}

#[cfg(test)]
#[path = "xdesign_room_image_files_tests.rs"]
mod tests;
