use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_ITEMS: usize = 128;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Item {
    File {
        path: String,
        contents: String,
    },
    Note {
        id: String,
        title: String,
        #[serde(rename = "blocksJson")]
        blocks_json: String,
        plaintext: String,
        #[serde(rename = "noteKind")]
        note_kind: String,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u32,
    revision: u64,
    updated: u64,
    items: Vec<Item>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    session: String,
    revision: u64,
    updated: u64,
    items: Vec<String>,
    error: Option<String>,
}

struct Session {
    id: String,
    revision: u64,
    _lock: File,
}
#[derive(Default)]
pub struct Recovery(Mutex<Option<Session>>);

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        Err("Recovery is available only to the main window".into())
    } else {
        Ok(())
    }
}
fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("draft-recovery");
    prepare_dir(&path)?;
    Ok(path)
}
fn prepare_dir(path: &Path) -> Result<(), String> {
    if !path.try_exists().map_err(|e| e.to_string())? {
        let mut options = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            options.mode(0o700);
        }
        options.create(path).map_err(|e| e.to_string())?;
    }
    if !fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_dir()
    {
        return Err("Recovery directory must not be a symlink".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn new_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|e| e.to_string())
}
fn valid_id(id: &str) -> Result<(), String> {
    if !ulid::Ulid::from_string(id).is_ok_and(|value| value.to_string() == id) {
        Err("Invalid recovery identity".into())
    } else {
        Ok(())
    }
}
fn bounded_read(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.file_type().is_file() || meta.len() > MAX_BYTES as u64 {
        return Err("Recovery file is not a regular bounded file".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Recovery file exceeds 16 MiB".into());
    }
    Ok(bytes)
}
fn validate(items: &[Item]) -> Result<(), String> {
    if items.len() > MAX_ITEMS {
        return Err("Recovery supports at most 128 dirty notes/files".into());
    }
    let mut keys = std::collections::HashSet::new();
    for item in items {
        let key = match item {
            Item::File { path, contents } => {
                if path.is_empty() || path.len() > 4096 || contents.len() > 4 * 1024 * 1024 {
                    return Err("File recovery exceeds its path or 4 MiB content limit".into());
                }
                format!("file:{path}")
            }
            Item::Note {
                id,
                title,
                blocks_json,
                plaintext,
                note_kind,
            } => {
                valid_id(id)?;
                if title.len() > 16_384
                    || blocks_json.len() > 4 * 1024 * 1024
                    || plaintext.len() > 4 * 1024 * 1024
                    || !["note", "journal", "project"].contains(&note_kind.as_str())
                {
                    return Err("Invalid or oversized note recovery".into());
                }
                serde_json::from_str::<Vec<serde_json::Value>>(blocks_json)
                    .map_err(|_| "Invalid note recovery body")?;
                format!("note:{id}")
            }
        };
        if !keys.insert(key) {
            return Err("Duplicate recovery item".into());
        }
    }
    Ok(())
}
fn open_snapshot(root: &Path, id: &str) -> Result<Snapshot, String> {
    valid_id(id)?;
    let bytes = bounded_read(&root.join(format!("{id}.json")))?;
    let snapshot: Snapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "Unreadable or unsupported recovery copy; preserve the original file")?;
    if snapshot.version != 1 {
        return Err("Recovery copy requires another app version; it has not been changed".into());
    }
    validate(&snapshot.items)?;
    Ok(snapshot)
}
fn session(root: &Path) -> Result<Session, String> {
    let id = ulid::Ulid::new().to_string();
    let lock = new_file(&root.join(format!("{id}.lock")))?;
    lock.try_lock().map_err(|e| e.to_string())?;
    Ok(Session {
        id,
        revision: 0,
        _lock: lock,
    })
}
fn try_idle_lock(root: &Path, id: &str) -> Result<Option<File>, String> {
    valid_id(id)?;
    let path = root.join(format!("{id}.lock"));
    if !fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_file()
    {
        return Err("Invalid recovery ownership file".into());
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
fn idle_lock(root: &Path, id: &str) -> Result<File, String> {
    try_idle_lock(root, id)?.ok_or("Recovery copy belongs to a running session or is busy".into())
}
fn persist(root: &Path, state: &mut Session, revision: u64, json: &str) -> Result<(), String> {
    if revision <= state.revision {
        return Err("Stale recovery revision refused".into());
    }
    if json.len() > MAX_BYTES {
        return Err("Recovery snapshot exceeds 16 MiB".into());
    }
    let items: Vec<Item> = serde_json::from_str(json).map_err(|_| "Invalid recovery snapshot")?;
    validate(&items)?;
    let snapshot = Snapshot {
        version: 1,
        revision,
        updated: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64,
        items,
    };
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Recovery snapshot exceeds 16 MiB".into());
    }
    crate::fs_ops::atomic_write_bytes(
        root.join(format!("{}.json", state.id))
            .to_str()
            .ok_or("Invalid recovery path")?,
        &bytes,
    )?;
    state.revision = revision;
    Ok(())
}

fn persist_current(
    root: &Path,
    current: &mut Session,
    owner: &str,
    revision: u64,
    json: &str,
) -> Result<(), String> {
    if current.id != owner {
        return Err("Previous frontend recovery session ended".into());
    }
    persist(root, current, revision, json)
}

#[tauri::command]
pub fn drafts_begin(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Recovery>,
) -> Result<String, String> {
    main_only(&window)?;
    let root = directory(&app)?;
    let mut guard = state
        .inner()
        .0
        .lock()
        .map_err(|_| "Recovery state unavailable")?;
    *guard = Some(session(&root)?);
    Ok(guard.as_ref().unwrap().id.clone())
}
#[tauri::command]
pub async fn drafts_write(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Recovery>,
    session: String,
    revision: u64,
    json: String,
) -> Result<(), String> {
    main_only(&window)?;
    // Serialize through native state as well as the frontend queue; reloads can overlap.
    let root = directory(&app)?;
    let handle = app.clone();
    let _ = state;
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<Recovery>();
        let mut guard = state
            .inner()
            .0
            .lock()
            .map_err(|_| "Recovery state unavailable")?;
        let current = guard.as_mut().ok_or("Recovery is not initialized")?;
        persist_current(&root, current, &session, revision, &json)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drafts_list(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Vec<Summary>, String> {
    main_only(&window)?;
    let root = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut summaries = Vec::new();
        let mut scanned = 0;
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
            scanned += 1;
            if scanned > 1024 {
                return Err(
                    "Recovery directory needs manual review; no copies were deleted".into(),
                );
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            valid_id(id)?;
            let Some(_lock) = try_idle_lock(&root, id)? else {
                continue;
            };
            let summary = match open_snapshot(&root, id) {
                Ok(snapshot) if snapshot.items.is_empty() => {
                    continue;
                }
                Ok(snapshot) => Summary {
                    session: id.into(),
                    revision: snapshot.revision,
                    updated: snapshot.updated,
                    items: snapshot
                        .items
                        .iter()
                        .map(|item| match item {
                            Item::File { path, .. } => format!("File · {path}"),
                            Item::Note { title, .. } => format!("Note · {title}"),
                        })
                        .collect(),
                    error: None,
                },
                Err(error) => Summary {
                    session: id.into(),
                    revision: 0,
                    updated: 0,
                    items: vec![],
                    error: Some(error),
                },
            };
            summaries.push(summary);
            if summaries.len() > 32 {
                return Err(
                    "More than 32 recovery sessions need manual review; no copies were deleted"
                        .into(),
                );
            }
        }
        summaries.sort_by(|a, b| b.updated.cmp(&a.updated));
        Ok(summaries)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn drafts_read(
    app: AppHandle,
    window: tauri::WebviewWindow,
    session: String,
    revision: u64,
    index: usize,
) -> Result<Item, String> {
    main_only(&window)?;
    let root = directory(&app)?;
    let _lock = idle_lock(&root, &session)?;
    let snapshot = open_snapshot(&root, &session)?;
    if snapshot.revision != revision {
        return Err("Recovery copy changed; reload the list".into());
    }
    snapshot
        .items
        .get(index)
        .cloned()
        .ok_or("Recovery item no longer exists".into())
}
#[tauri::command]
pub fn drafts_discard(
    app: AppHandle,
    window: tauri::WebviewWindow,
    session: String,
    revision: u64,
) -> Result<(), String> {
    main_only(&window)?;
    let root = directory(&app)?;
    let _lock = idle_lock(&root, &session)?;
    let snapshot = open_snapshot(&root, &session)?;
    if snapshot.revision != revision {
        return Err("Recovery copy changed; reload before discarding".into());
    }
    fs::remove_file(root.join(format!("{session}.json"))).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn drafts_export(
    app: AppHandle,
    window: tauri::WebviewWindow,
    session: String,
    revision: u64,
    index: usize,
    destination: String,
) -> Result<(), String> {
    let item = drafts_read(app, window, session, revision, index)?;
    let bytes = match item {
        Item::File { contents, .. } => contents.into_bytes(),
        note => serde_json::to_vec_pretty(&note).map_err(|e| e.to_string())?,
    };
    export_new(Path::new(&destination), &bytes)
}
fn export_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing export directory")?;
    let temp = parent.join(format!(".recovery-{}.tmp", ulid::Ulid::new()));
    let result = (|| {
        let mut file = new_file(&temp)?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::hard_link(&temp, path).map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("draft-test-{}", ulid::Ulid::new()));
            prepare_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn payload(text: &str) -> String {
        serde_json::to_string(&vec![Item::File {
            path: "/disposable/file.txt".into(),
            contents: text.into(),
        }])
        .unwrap()
    }
    #[test]
    fn persisted_snapshot_survives_owner_exit_and_rejects_stale_revision() {
        let f = Fixture::new();
        let mut s = session(&f.0).unwrap();
        let id = s.id.clone();
        persist(&f.0, &mut s, 2, &payload("latest")).unwrap();
        assert!(persist(&f.0, &mut s, 1, &payload("old")).is_err());
        assert!(idle_lock(&f.0, &id).is_err());
        drop(s);
        let _lock = idle_lock(&f.0, &id).unwrap();
        assert!(
            matches!(&open_snapshot(&f.0, &id).unwrap().items[0], Item::File { contents, .. } if contents == "latest")
        );
    }
    #[test]
    fn frontend_reload_preserves_old_copy_and_rejects_late_old_writes() {
        let f = Fixture::new();
        let mut old = session(&f.0).unwrap();
        let owner = old.id.clone();
        persist_current(&f.0, &mut old, &owner, 1, &payload("before reload")).unwrap();
        drop(old);
        let mut next = session(&f.0).unwrap();
        assert!(persist_current(&f.0, &mut next, &owner, 99, "[]").is_err());
        assert_eq!(open_snapshot(&f.0, &owner).unwrap().items.len(), 1);
        assert!(idle_lock(&f.0, &owner).is_ok());
    }

    #[test]
    fn invalid_or_oversized_input_preserves_previous_snapshot() {
        let f = Fixture::new();
        let mut s = session(&f.0).unwrap();
        persist(&f.0, &mut s, 1, &payload("keep")).unwrap();
        for invalid in [
            "null".into(),
            "[{\"kind\":\"future\"}]".into(),
            payload(&"x".repeat(4 * 1024 * 1024 + 1)),
        ] {
            assert!(persist(&f.0, &mut s, 2, &invalid).is_err());
        }
        assert_eq!(open_snapshot(&f.0, &s.id).unwrap().revision, 1);
    }
    #[test]
    fn successful_save_clears_items_only_in_its_own_session() {
        let f = Fixture::new();
        let mut a = session(&f.0).unwrap();
        let mut b = session(&f.0).unwrap();
        persist(&f.0, &mut a, 1, &payload("a")).unwrap();
        persist(&f.0, &mut b, 1, &payload("b")).unwrap();
        persist(&f.0, &mut a, 2, "[]").unwrap();
        assert!(open_snapshot(&f.0, &a.id).unwrap().items.is_empty());
        assert_eq!(open_snapshot(&f.0, &b.id).unwrap().items.len(), 1);
    }
    #[test]
    fn export_is_private_and_never_overwrites_existing_file() {
        let f = Fixture::new();
        let target = f.0.join("copy.txt");
        export_new(&target, b"draft").unwrap();
        assert!(export_new(&target, b"replacement").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"draft");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(target).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    }
    #[test]
    fn future_or_corrupt_snapshot_is_preserved_not_silently_replaced() {
        let f = Fixture::new();
        let s = session(&f.0).unwrap();
        let p = f.0.join(format!("{}.json", s.id));
        fs::write(
            &p,
            b"{\"version\":99,\"revision\":1,\"updated\":1,\"items\":[]}",
        )
        .unwrap();
        assert!(open_snapshot(&f.0, &s.id).is_err());
        assert!(p.exists());
        assert!(open_snapshot(&f.0, "../other").is_err());
    }
}
