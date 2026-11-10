//! One small PNG per XDesign project for the Home page, outside `assets/xdesign` so
//! the photo storage sweep and project archives never see it.
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

pub(crate) const PREVIEW_MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntry {
    pub path: String,
    /// Modification time in microseconds; the Home page puts it in the URL so a replaced file isn't served from cache.
    pub revision: u64,
}

fn preview_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| format!("app_data_dir: {e}"))?.join("assets").join("xdesign-previews"))
}

fn canonical_id(id: &str) -> Result<String, String> {
    ulid::Ulid::from_string(id).map(|id| id.to_string()).map_err(|_| "Invalid project id".to_string())
}

fn entry(path: &Path) -> Result<PreviewEntry, String> {
    let modified = fs::metadata(path).and_then(|m| m.modified()).map_err(|e| format!("preview metadata: {e}"))?;
    let revision = modified.duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0);
    let path = path.to_str().ok_or("preview path was not valid UTF-8")?.to_string();
    Ok(PreviewEntry { path, revision })
}

pub(crate) fn write_preview(dir: &Path, id: &str, png: &[u8]) -> Result<PreviewEntry, String> {
    let id = canonical_id(id)?;
    if png.len() > PREVIEW_MAX_BYTES || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("A project preview must be a PNG of at most 4 MB".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("create_dir_all: {e}"))?;
    let path = dir.join(format!("{id}.png"));
    crate::fs_ops::atomic_write_bytes(&path.to_string_lossy(), png)?;
    entry(&path)
}

pub(crate) fn list_previews(dir: &Path) -> Result<HashMap<String, PreviewEntry>, String> {
    let items = match fs::read_dir(dir) {
        Ok(items) => items,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(e) => return Err(format!("read previews: {e}")),
    };
    let mut previews = HashMap::new();
    for item in items.flatten() {
        let name = item.file_name();
        let Some(stem) = name.to_str().and_then(|name| name.strip_suffix(".png")) else { continue };
        if canonical_id(stem).ok().as_deref() != Some(stem) || !item.file_type().map(|t| t.is_file()).unwrap_or(false) { continue }
        if let Ok(preview) = entry(&item.path()) { previews.insert(stem.to_string(), preview); }
    }
    Ok(previews)
}

pub(crate) fn delete_preview(dir: &Path, id: &str) -> Result<(), String> {
    let id = canonical_id(id)?;
    match fs::remove_file(dir.join(format!("{id}.png"))) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(format!("remove preview: {e}")),
        _ => Ok(()),
    }
}

// Async so file work stays off the main thread while the owner is painting.
#[tauri::command]
pub async fn xdesign_preview_write(app: AppHandle, project_id: String, png: Vec<u8>) -> Result<PreviewEntry, String> {
    write_preview(&preview_dir(&app)?, &project_id, &png)
}

#[tauri::command]
pub async fn xdesign_preview_list(app: AppHandle) -> Result<HashMap<String, PreviewEntry>, String> {
    list_previews(&preview_dir(&app)?)
}

#[tauri::command]
pub async fn xdesign_preview_delete(app: AppHandle, project_id: String) -> Result<(), String> {
    delete_preview(&preview_dir(&app)?, &project_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
    fn temp() -> PathBuf { std::env::temp_dir().join(format!("orion-previews-{}", ulid::Ulid::new())) }
    fn png(body: &[u8]) -> Vec<u8> { [PNG, body].concat() }

    #[test]
    fn writes_one_preview_per_project_and_lists_it() {
        let dir = temp();
        let id = ulid::Ulid::new().to_string();
        let first = write_preview(&dir, &id, &png(b"first")).unwrap();
        let second = write_preview(&dir, &id.to_lowercase(), &png(b"second")).unwrap();
        assert_eq!(first.path, second.path);
        assert!(second.path.ends_with(&format!("{id}.png")));
        assert!(second.revision >= first.revision);
        assert_eq!(fs::read(&second.path).unwrap(), png(b"second"));
        let listed = list_previews(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[&id].path, second.path);
        assert_eq!(listed[&id].revision, second.revision);
    }

    #[test]
    fn refuses_bad_ids_non_png_and_oversized_previews() {
        let dir = temp();
        let id = ulid::Ulid::new().to_string();
        assert!(write_preview(&dir, "../x", &png(b"a")).is_err());
        assert!(write_preview(&dir, "not-a-ulid", &png(b"a")).is_err());
        assert!(write_preview(&dir, &id, b"GIF89a....").is_err());
        let mut big = png(b"");
        big.resize(PREVIEW_MAX_BYTES + 1, 0);
        assert!(write_preview(&dir, &id, &big).is_err());
        assert!(list_previews(&dir).unwrap().is_empty());
        assert!(!dir.exists() || fs::read_dir(&dir).unwrap().next().is_none());
    }

    #[test]
    fn list_skips_strays_and_delete_tolerates_missing() {
        let dir = temp();
        assert!(list_previews(&dir).unwrap().is_empty());
        let id = ulid::Ulid::new().to_string();
        write_preview(&dir, &id, &png(b"kept")).unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        fs::write(dir.join(format!("{}.png.tmp", ulid::Ulid::new())), png(b"x")).unwrap();
        fs::write(dir.join("nope.png"), png(b"x")).unwrap();
        assert_eq!(list_previews(&dir).unwrap().keys().cloned().collect::<Vec<_>>(), vec![id.clone()]);
        delete_preview(&dir, &id).unwrap();
        delete_preview(&dir, &id).unwrap();
        assert!(list_previews(&dir).unwrap().is_empty());
        assert!(delete_preview(&dir, "../x").is_err());
    }
}
