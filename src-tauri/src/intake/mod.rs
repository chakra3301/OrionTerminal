mod frontmatter;
pub mod github;
pub mod installed;
pub(crate) mod safe_dir;

use frontmatter::SkillMetadata;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::File,
    io::Read,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILES: usize = 128;
const TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryPoint {
    pub path: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Discovery {
    pub id: String,
    pub label: String,
    pub entries: Vec<EntryPoint>,
    pub attribution_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_files: Option<Vec<github::review::RepositoryDocument>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<github::RepositoryOrigin>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileInfo {
    pub path: String,
    pub source_path: String,
    pub bytes: usize,
    pub sha256: String,
    pub source_mode: u32,
    pub kind: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub schema_version: u8,
    pub id: String,
    pub source_label: String,
    pub entrypoint: String,
    pub source_hash: String,
    pub artifact_hash: String,
    pub metadata: SkillMetadata,
    pub files: Vec<FileInfo>,
    pub total_bytes: usize,
    pub created_at: u64,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<github::RepositoryOrigin>,
}
struct Source {
    root: File,
    discovery: Discovery,
    at: Instant,
}
#[derive(Clone)]
struct Package {
    summary: Candidate,
    contents: BTreeMap<String, Vec<u8>>,
}
#[derive(Default)]
struct Session {
    sources: BTreeMap<String, Source>,
    github_sources: BTreeMap<String, (Instant, github::RepositorySnapshot)>,
    packages: BTreeMap<String, (Instant, Package)>,
}
static SESSION: Lazy<Mutex<Session>> = Lazy::new(|| Mutex::new(Session::default()));
impl Session {
    fn expire(&mut self) {
        self.sources.retain(|_, s| s.at.elapsed() < TTL);
        self.github_sources.retain(|_, (at, _)| at.elapsed() < TTL);
        self.packages.retain(|_, (at, _)| at.elapsed() < TTL);
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id_check(id: &str) -> Result<(), String> {
    ulid::Ulid::from_string(id)
        .map(|_| ())
        .map_err(|_| "Invalid candidate ID".into())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn discover(root: File, label: String) -> Result<Source, String> {
    let names = safe_dir::names(&root)?;
    let started = Instant::now();
    let mut entries = Vec::new();
    if names.iter().any(|n| n == "SKILL.md") {
        entries.push(EntryPoint {
            path: "SKILL.md".into(),
        });
    } else {
        let (container, prefix) = if names.iter().any(|n| n == "skills") {
            (safe_dir::child(&root, "skills", true)?, "skills/")
        } else {
            (safe_dir::child(&root, ".", true)?, "")
        };
        for name in safe_dir::names(&container)? {
            if started.elapsed() > Duration::from_secs(10) {
                return Err("Skill discovery exceeded its time limit".into());
            }
            if name.starts_with('.') {
                continue;
            }
            safe_dir::relative(&name)?;
            // Unsupported siblings aren't selected; inspection still rejects unsafe selected entries.
            if let Ok(dir) = safe_dir::child(&container, &name, true) {
                if safe_dir::names(&dir)?.iter().any(|n| n == "SKILL.md") {
                    entries.push(EntryPoint {
                        path: format!("{prefix}{name}/SKILL.md"),
                    });
                }
            }
        }
    }
    if entries.is_empty() || entries.len() > 64 {
        return Err("Choose a skill directory, a directory of skills, or a repository with skills/ (1–64 entrypoints)".into());
    }
    let attribution_files = names
        .into_iter()
        .filter(|n| {
            [
                "LICENSE",
                "LICENSE.md",
                "LICENSE.txt",
                "NOTICE",
                "NOTICE.md",
                "NOTICE.txt",
            ]
            .contains(&n.as_str())
        })
        .collect();
    Ok(Source {
        root,
        discovery: Discovery {
            id: ulid::Ulid::new().to_string(),
            label,
            entries,
            attribution_files,
            review_files: None,
            repository: None,
        },
        at: Instant::now(),
    })
}
fn descend(root: &File, path: &str) -> Result<File, String> {
    let mut dir = safe_dir::child(root, ".", true)?;
    if !path.is_empty() {
        safe_dir::relative(path)?;
        for part in path.split('/') {
            dir = safe_dir::child(&dir, part, true)?;
        }
    }
    Ok(dir)
}
fn secret_risk(path: &str, bytes: &[u8]) -> bool {
    let base = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    if [
        ".env",
        "auth.json",
        "credentials.json",
        "id_rsa",
        "id_ed25519",
        ".npmrc",
        ".pypirc",
    ]
    .contains(&base.as_str())
        || base.starts_with(".env.")
    {
        return true;
    }
    let text = String::from_utf8_lossy(bytes);
    text.contains("PRIVATE KEY-----")
        || text
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
            .any(|word| {
                (word.starts_with("sk-") && word.len() > 24)
                    || (word.starts_with("ghp_") && word.len() > 24)
                    || (word.starts_with("github_pat_") && word.len() > 30)
                    || (word.starts_with("AKIA") && word.len() == 20)
            })
}
fn regular_bytes(mut file: File, path: &str) -> Result<(Vec<u8>, u32), String> {
    let before = file
        .metadata()
        .map_err(|_| "Cannot read package metadata")?;
    if !before.is_file() {
        return Err("Package contains a special file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.nlink() != 1 {
            return Err("Hardlinked package files are unsupported".into());
        }
    }
    let max = if path.rsplit('/').next() == Some("SKILL.md") {
        128 * 1024
    } else {
        1024 * 1024
    };
    if before.len() > max {
        return Err("Package file exceeds its size limit".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read package file")?;
    let after = file.metadata().map_err(|_| "Cannot recheck package file")?;
    if bytes.len() as u64 > max
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || after.len() != bytes.len() as u64
    {
        return Err("Package changed while being read; inspect again".into());
    }
    #[cfg(unix)]
    let source_mode = {
        use std::os::unix::fs::MetadataExt;
        if before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
            || after.nlink() != 1
        {
            return Err("Package metadata changed during inspection".into());
        }
        if before.mode() & 0o111 != 0 {
            0o100755
        } else {
            0o100644
        }
    };
    #[cfg(not(unix))]
    let source_mode = 0o100644;
    if secret_risk(path, &bytes) {
        return Err("Possible credentials detected. Remove or redact them in a separate local copy before inspection. Nothing was staged.".into());
    }
    Ok((bytes, source_mode))
}
fn walk(
    dir: &File,
    prefix: &str,
    files: &mut BTreeMap<String, (Vec<u8>, u32)>,
    depth: usize,
    visited: &mut usize,
    started: Instant,
) -> Result<(), String> {
    if depth > 8 || started.elapsed() > Duration::from_secs(10) {
        return Err("Package inspection exceeded depth/time limits".into());
    }
    let mut folded = HashSet::new();
    for name in safe_dir::names(dir)? {
        if started.elapsed() > Duration::from_secs(10) {
            return Err("Package inspection exceeded its time limit".into());
        }
        *visited += 1;
        if *visited > 256 {
            return Err("Package exceeds 256 directory entries".into());
        }
        safe_dir::relative(&name)?;
        if !folded.insert(name.to_ascii_lowercase())
            || name.eq_ignore_ascii_case("__orion_attribution")
        {
            return Err("Package has colliding or reserved names".into());
        }
        let path = format!("{prefix}{name}");
        safe_dir::relative(&path)?;
        let file = safe_dir::child(dir, &name, false)?;
        if file
            .metadata()
            .map_err(|_| "Cannot read entry metadata")?
            .is_dir()
        {
            walk(
                &file,
                &format!("{path}/"),
                files,
                depth + 1,
                visited,
                started,
            )?;
        } else {
            let bytes = regular_bytes(file, &path)?;
            files.insert(path, bytes);
            if files.len() > MAX_FILES
                || files.values().map(|(bytes, _)| bytes.len()).sum::<usize>() > MAX_BYTES
            {
                return Err("Package exceeds 128 files or 8 MiB".into());
            }
        }
    }
    Ok(())
}
fn manifest_hash(files: &[FileInfo], source: bool) -> String {
    let mut sorted: Vec<_> = files.iter().collect();
    sorted.sort_by_key(|f| if source { &f.source_path } else { &f.path });
    let mut h = Sha256::new();
    h.update(b"orion-skill-manifest-v1\0");
    for file in sorted {
        let path = if source {
            &file.source_path
        } else {
            &file.path
        };
        h.update((path.len() as u32).to_le_bytes());
        h.update(path.as_bytes());
        h.update((file.bytes as u64).to_le_bytes());
        h.update(file.sha256.as_bytes());
        h.update(
            (if source {
                file.source_mode
            } else {
                0o100644u32
            })
            .to_le_bytes(),
        );
    }
    format!("{:x}", h.finalize())
}
fn inspect(source: &Source, entry: &str, attribution: &[String]) -> Result<Package, String> {
    if !source.discovery.entries.iter().any(|e| e.path == entry) {
        return Err("Entrypoint was not discovered".into());
    }
    let scope = entry
        .strip_suffix("SKILL.md")
        .unwrap()
        .trim_end_matches('/');
    let dir = descend(&source.root, scope)?;
    let mut contents = BTreeMap::new();
    walk(&dir, "", &mut contents, 0, &mut 0, Instant::now())?;
    let mut origins = BTreeMap::new();
    for path in contents.keys() {
        origins.insert(
            path.clone(),
            if scope.is_empty() {
                path.clone()
            } else {
                format!("{scope}/{path}")
            },
        );
    }
    let mut seen = HashSet::new();
    for name in attribution {
        if !seen.insert(name) || !source.discovery.attribution_files.contains(name) {
            return Err("Attribution file was not discovered or was repeated".into());
        }
        if scope.is_empty() && contents.contains_key(name) {
            continue;
        }
        let path = format!("__orion_attribution/{name}");
        contents.insert(
            path.clone(),
            regular_bytes(safe_dir::child(&source.root, name, false)?, name)?,
        );
        origins.insert(path, name.clone());
    }
    assemble(&source.discovery.label, entry, contents, origins, None)
}

fn assemble(
    label: &str,
    entry: &str,
    contents: BTreeMap<String, (Vec<u8>, u32)>,
    origins: BTreeMap<String, String>,
    repository: Option<github::RepositoryOrigin>,
) -> Result<Package, String> {
    let scope = entry
        .strip_suffix("SKILL.md")
        .ok_or("Invalid entrypoint")?
        .trim_end_matches('/');
    let metadata = frontmatter::parse(&contents.get("SKILL.md").ok_or("SKILL.md disappeared")?.0)?;
    let mut warnings = vec![
        if repository.is_some() { "GitHub commit-pinned snapshot of the selected subtree and attribution only. Publisher identity, excluded files and behavior are not verified.".into() } else { "Local snapshot only; no Git revision or publisher verification.".into() },
        "Secret checks cover credential filenames and selected token/private-key patterns only. Obfuscated secrets, vulnerabilities, licenses and behavior are not verified.".into(),
        "Scripts, HTML, SVG and external links are inert. No tools are granted; nothing is installed or sent to AI.".into(),
    ];
    let original_name = if scope.is_empty() {
        label.rsplit('/').next().unwrap_or(label)
    } else {
        scope.rsplit('/').next().unwrap()
    };
    if original_name != metadata.name {
        warnings.push(format!(
            "Packaging adapter: directory {original_name} → {}. Instruction bytes are unchanged.",
            metadata.name
        ));
    }
    if metadata.allowed_tools.is_some() {
        warnings.push("allowed-tools is an unapproved request, not authorization.".into());
    }
    if contents["SKILL.md"].0.len() > 64 * 1024 {
        warnings.push("Large instructions: preserved in full. Activation will require a separate context-budget check.".into());
    }
    if !contents.keys().any(|p| {
        [
            "LICENSE",
            "LICENSE.md",
            "LICENSE.txt",
            "NOTICE",
            "NOTICE.md",
            "NOTICE.txt",
        ]
        .contains(&p.rsplit('/').next().unwrap_or(""))
    }) {
        warnings.push("No LICENSE/NOTICE bytes included. Staging is not license clearance; installation remains unavailable.".into());
    }
    let total_bytes = contents.values().map(|(bytes, _)| bytes.len()).sum();
    if contents.len() > MAX_FILES || total_bytes > MAX_BYTES {
        return Err("Package including attribution exceeds limits".into());
    }
    let mut mapped = BTreeMap::new();
    let mut files = Vec::new();
    for (path, (bytes, source_mode)) in contents {
        let text = std::str::from_utf8(&bytes)
            .ok()
            .filter(|s| !s.contains('\0'));
        let kind = if path.starts_with("__orion_attribution/") {
            "attribution"
        } else if source_mode == 0o100755
            || bytes.starts_with(b"#!")
            || ["sh", "py", "js", "mjs", "cjs", "ts", "exe", "wasm"]
                .contains(&path.rsplit('.').next().unwrap_or(""))
        {
            "inactive-code"
        } else if text.is_some() {
            "text"
        } else {
            "opaque"
        };
        let target = format!("{}/{path}", metadata.name);
        files.push(FileInfo {
            path: target.clone(),
            source_path: origins[&path].clone(),
            bytes: bytes.len(),
            sha256: hash(&bytes),
            source_mode,
            kind: kind.into(),
        });
        mapped.insert(target, bytes);
    }
    if files.iter().any(|f| f.kind == "opaque") {
        warnings.push(
            "Opaque resources are preserved, not decoded, scanned completely or sent to a model."
                .into(),
        );
    }
    if files.iter().any(|f| {
        [
            "package.json",
            "pyproject.toml",
            "requirements.txt",
            "Cargo.toml",
        ]
        .iter()
        .any(|n| f.path.ends_with(n))
            || f.path.contains("lock")
    }) {
        warnings.push("Dependency manifests/lockfiles present; dependency resolution and advisory scans have not run.".into());
    }
    let package = Package {
        summary: Candidate {
            schema_version: 1,
            id: ulid::Ulid::new().to_string(),
            source_label: label.to_string(),
            entrypoint: entry.into(),
            source_hash: manifest_hash(&files, true),
            artifact_hash: manifest_hash(&files, false),
            metadata,
            files,
            total_bytes,
            created_at: now(),
            warnings,
            repository,
        },
        contents: mapped,
    };
    validate(&package)?;
    Ok(package)
}

fn validate(package: &Package) -> Result<(), String> {
    let s = &package.summary;
    id_check(&s.id)?;
    safe_dir::relative(&s.entrypoint)?;
    if let Some(repository) = &s.repository {
        repository.validate()?;
    }
    if s.source_label.len() > 240
        || s.source_label.chars().any(char::is_control)
        || s.warnings.len() > 32
        || s.warnings.iter().any(|w| w.len() > 4096)
        || s.created_at > 9_007_199_254_740_991
    {
        return Err("Staged metadata exceeds bounds".into());
    }
    if s.schema_version != 1
        || s.files.is_empty()
        || s.files.len() > MAX_FILES
        || s.total_bytes > MAX_BYTES
        || s.total_bytes != package.contents.values().map(Vec::len).sum::<usize>()
        || package.contents.len() != s.files.len()
    {
        return Err("Invalid or unsupported staged package".into());
    }
    let mut seen = HashSet::new();
    for f in &s.files {
        safe_dir::relative(&f.path)?;
        safe_dir::relative(&f.source_path)?;
        let bytes = package
            .contents
            .get(&f.path)
            .ok_or("Missing staged resource")?;
        if !["text", "opaque", "inactive-code", "attribution"].contains(&f.kind.as_str())
            || ![0o100644, 0o100755].contains(&f.source_mode)
            || !seen.insert(f.path.to_ascii_lowercase())
            || f.bytes != bytes.len()
            || f.sha256 != hash(bytes)
        {
            return Err("Staged resource integrity failed".into());
        }
    }
    let meta = frontmatter::parse(
        package
            .contents
            .get(&format!("{}/SKILL.md", s.metadata.name))
            .ok_or("Missing staged skill")?,
    )?;
    if serde_json::to_string(&meta).unwrap() != serde_json::to_string(&s.metadata).unwrap()
        || s.source_hash != manifest_hash(&s.files, true)
        || s.artifact_hash != manifest_hash(&s.files, false)
    {
        return Err("Staged manifest integrity failed".into());
    }
    Ok(())
}
fn load(conn: &Connection, id: &str) -> Result<Package, String> { load_package(conn, id, false) }
fn load_package(conn: &Connection, id: &str, installed: bool) -> Result<Package, String> {
    let candidates = if installed { "skill_package_versions" } else { "skill_intake_candidates" };
    let files = if installed { "skill_package_files" } else { "skill_intake_files" };
    id_check(id)?;
    let bounded: bool = conn.query_row(&format!("SELECT length(summary_json)<=262144 AND length(manifest_hash)=64 FROM {candidates} WHERE id=?1"), [id], |r| r.get(0)).map_err(|_| "Staged candidate unavailable")?;
    let (file_count, file_bytes, max_file): (usize, usize, usize) = conn.query_row(&format!("SELECT count(*),coalesce(sum(length(contents)),0),coalesce(max(length(contents)),0) FROM {files} WHERE candidate_id=?1"), [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_| "Cannot measure staged resources")?;
    if !bounded || file_count > MAX_FILES || file_bytes > MAX_BYTES || max_file > 1024 * 1024 {
        return Err("Staged data exceeds read bounds".into());
    }
    let (version, manifest, json, total): (u8, String, String, usize) = conn.query_row(&format!("SELECT schema_version,manifest_hash,summary_json,total_bytes FROM {candidates} WHERE id=?1"), [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_| "Staged candidate unavailable")?;
    if version != 1 || json.len() > 256 * 1024 || total > MAX_BYTES {
        return Err(
            "Unsupported staged candidate version/size; stored data was not changed".into(),
        );
    }
    let summary: Candidate = serde_json::from_str(&json)
        .map_err(|_| "Invalid staged candidate metadata; stored data was not changed")?;
    let mut contents = BTreeMap::new();
    let mut stmt = conn
        .prepare(&format!("SELECT path,sha256,contents FROM {files} WHERE candidate_id=?1"))
        .map_err(|_| "Cannot read staged resources")?;
    let rows = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|_| "Cannot read staged resources")?;
    let mut actual = 0;
    for row in rows {
        let (path, sha, bytes) = row.map_err(|_| "Cannot read staged resource")?;
        actual += bytes.len();
        if actual > MAX_BYTES
            || contents.len() >= MAX_FILES
            || bytes.len() > 1024 * 1024
            || sha != hash(&bytes)
        {
            return Err("Staged resources exceed bounds or failed integrity".into());
        }
        contents.insert(path, bytes);
    }
    if summary.id != id || summary.artifact_hash != manifest || summary.total_bytes != total {
        return Err("Staged identity mismatch".into());
    }
    let package = Package { summary, contents };
    validate(&package)?;
    Ok(package)
}
fn list(conn: &Connection) -> Result<Vec<Candidate>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM skill_intake_candidates ORDER BY created_at DESC LIMIT 5")
        .map_err(|_| "Cannot load staged skills; update the native app and retry")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|_| "Cannot list staged skills")?
        .collect::<Result<_, _>>()
        .map_err(|_| "Cannot list staged skills")?;
    if ids.len() > 4 {
        return Err("Staged collection exceeds its quota".into());
    }
    ids.iter()
        .map(|id| load(conn, id).map(|p| p.summary))
        .collect()
}
fn stage(conn: &mut Connection, package: &Package) -> Result<Candidate, String> {
    validate(package)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot start staging transaction")?;
    let installed_schema: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='skill_package_receipts')", [], |r| r.get(0)).map_err(|_| "Cannot check staged identity")?;
    if installed_schema {
        let consumed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM skill_package_receipts WHERE candidate_id=?1)", [&package.summary.id], |r| r.get(0)).map_err(|_| "Cannot check installation receipt")?;
        if consumed { return Err("This snapshot was already consumed by installation. Inspect again for a new review.".into()); }
    }
    let existing = list(&tx)?;
    if let Some(saved) = existing.iter().find(|s| s.id == package.summary.id) {
        if saved.artifact_hash != package.summary.artifact_hash {
            return Err("Candidate identity conflict".into());
        }
        return Ok(saved.clone());
    }
    if existing.len() >= 4 {
        return Err(
            "Four candidates are already staged. Discard one before staging another.".into(),
        );
    }
    let s = &package.summary;
    tx.execute("INSERT INTO skill_intake_candidates(id,schema_version,manifest_hash,summary_json,total_bytes,created_at) VALUES (?1,1,?2,?3,?4,?5)", params![s.id,s.artifact_hash,serde_json::to_string(s).map_err(|_| "Cannot encode candidate")?,s.total_bytes,s.created_at]).map_err(|_| "Could not stage candidate; previous staged skills are unchanged")?;
    for f in &s.files {
        tx.execute("INSERT INTO skill_intake_files(candidate_id,path,sha256,contents) VALUES (?1,?2,?3,?4)", params![s.id,f.path,f.sha256,package.contents[&f.path]]).map_err(|_| "Could not stage resource; transaction rolled back")?;
    }
    tx.commit().map_err(|_| {
        "Staging commit could not be confirmed. Reload staged skills before retrying."
    })?;
    Ok(s.clone())
}
fn database(app: &AppHandle) -> Result<Connection, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "App data unavailable")?
        .join("orion.db");
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|_| "Skill database unavailable")?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| "Database busy timeout unavailable")?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|_| "Database constraints unavailable")?;
    Ok(conn)
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "Skill inspection task failed")?
}

#[tauri::command]
pub async fn intake_discover(path: String) -> Result<Discovery, String> {
    blocking(move || {
        let mut session = SESSION
            .lock()
            .map_err(|_| "Inspection session unavailable")?;
        session.expire();
        if session.sources.len() >= 4 {
            return Err("Too many open directory inspections".into());
        }
        if path.len() > 4096 {
            return Err("Directory path exceeds its limit".into());
        }
        let path = Path::new(&path);
        let label = path
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| s.len() <= 240 && !s.chars().any(char::is_control))
            .ok_or("Invalid directory label")?
            .to_string();
        let source = discover(safe_dir::root(path)?, label)?;
        let out = source.discovery.clone();
        session.sources.insert(out.id.clone(), source);
        Ok(out)
    })
    .await
}
#[tauri::command]
pub async fn intake_inspect(
    discovery_id: String,
    entrypoint: String,
    attribution: Vec<String>,
) -> Result<Candidate, String> {
    blocking(move || {
        id_check(&discovery_id)?;
        if attribution.len() > 6 {
            return Err("Too many attribution files".into());
        }
        let mut session = SESSION
            .lock()
            .map_err(|_| "Inspection session unavailable")?;
        session.expire();
        if session.packages.len() >= 4 {
            return Err("Too many open package previews".into());
        }
        let source = session
            .sources
            .get(&discovery_id)
            .ok_or("Directory inspection expired; choose it again")?;
        let package = inspect(source, &entrypoint, &attribution)?;
        let summary = package.summary.clone();
        session
            .packages
            .insert(summary.id.clone(), (Instant::now(), package));
        Ok(summary)
    })
    .await
}
#[tauri::command]
pub async fn intake_release(id: String) -> Result<(), String> {
    blocking(move || {
        let mut s = SESSION
            .lock()
            .map_err(|_| "Inspection session unavailable")?;
        s.sources.remove(&id);
        s.github_sources.remove(&id);
        s.packages.remove(&id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn intake_stage(
    app: AppHandle,
    id: String,
    expected_hash: String,
) -> Result<Candidate, String> {
    blocking(move || {
        id_check(&id)?;
        let mut conn = database(&app)?;
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM skill_intake_candidates WHERE id=?1",
                [&id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|_| "Staged skills unavailable")?
            .unwrap_or(false);
        if exists {
            let p = load(&conn, &id)?;
            if p.summary.artifact_hash != expected_hash {
                return Err("Review hash mismatch".into());
            }
            return Ok(p.summary);
        }
        let package = {
            let mut s = SESSION
                .lock()
                .map_err(|_| "Inspection session unavailable")?;
            s.expire();
            s.packages
                .get(&id)
                .map(|(_, p)| p.clone())
                .ok_or("Preview expired; inspect again")?
        };
        if package.summary.artifact_hash != expected_hash {
            return Err("Review hash mismatch".into());
        }
        stage(&mut conn, &package)
    })
    .await
}
#[tauri::command]
pub async fn intake_list(app: AppHandle) -> Result<Vec<Candidate>, String> {
    blocking(move || list(&database(&app)?)).await
}
#[tauri::command]
pub async fn intake_discard(app: AppHandle, id: String) -> Result<(), String> {
    blocking(move || {
        id_check(&id)?;
        let mut conn = database(&app)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Cannot start discard")?;
        load(&tx, &id)?;
        tx.execute(
            "DELETE FROM skill_intake_files WHERE candidate_id=?1",
            [&id],
        )
        .map_err(|_| "Cannot discard resources")?;
        tx.execute("DELETE FROM skill_intake_candidates WHERE id=?1", [&id])
            .map_err(|_| "Cannot discard candidate")?;
        tx.commit()
            .map_err(|_| "Discard could not be confirmed; reload staged skills")?;
        SESSION
            .lock()
            .map_err(|_| "Inspection session unavailable")?
            .packages
            .remove(&id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn intake_read(app: AppHandle, id: String, path: String) -> Result<String, String> {
    blocking(move || {
        id_check(&id)?;
        safe_dir::relative(&path)?;
        let package = {
            let mut s = SESSION
                .lock()
                .map_err(|_| "Inspection session unavailable")?;
            s.expire();
            s.packages.get(&id).map(|(_, p)| p.clone())
        };
        let package = match package {
            Some(p) => p,
            None => load(&database(&app)?, &id)?,
        };
        let bytes = package
            .contents
            .get(&path)
            .ok_or("Resource is not part of this candidate")?;
        if bytes.len() > 256 * 1024 {
            return Err("Preview exceeds 256 KiB; bytes remain preserved".into());
        }
        let text = std::str::from_utf8(bytes)
            .map_err(|_| "Opaque resource preserved; text preview unavailable")?;
        if text.contains('\0') {
            return Err("Opaque resource preserved; text preview unavailable".into());
        }
        Ok(text.to_string())
    })
    .await
}

#[cfg(test)]
mod tests;
