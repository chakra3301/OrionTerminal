// Custom wallpaper storage. Picked images get copied into
// `$APPDATA/wallpapers/<id>.<ext>` and the frontend renders the resulting
// path via `convertFileSrc` (the asset protocol scope includes this dir).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct StoredWallpaper {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "originalName")]
    pub original_name: String,
}

fn wallpaper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let dir = base.join("wallpapers");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir)
}

fn ulid_string() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let entropy: u64 = {
        let x: u8 = 0;
        let addr = &x as *const u8 as usize as u64;
        addr ^ ms as u64
    };
    format!("{:013x}{:012x}", ms, entropy & 0xFFF_FFFF_FFFF_FFFF)
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn wallpaper_store_file(
    app: AppHandle,
    source_path: String,
) -> Result<StoredWallpaper, String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(format!("source path not found: {source_path}"));
    }
    let original_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "wallpaper".to_string());

    let ext = ext_of(&src);
    let dir = wallpaper_dir(&app)?;
    let id = ulid_string();
    let target_name = if ext.is_empty() { id.clone() } else { format!("{id}.{ext}") };
    let target = dir.join(&target_name);

    let bytes = fs::read(&src).map_err(|e| format!("read source: {e}"))?;
    fs::write(&target, &bytes).map_err(|e| format!("write target: {e}"))?;

    let file_path = target
        .to_str()
        .ok_or_else(|| "target path was not valid UTF-8".to_string())?
        .to_string();

    Ok(StoredWallpaper { file_path, original_name })
}

#[tauri::command]
pub async fn wallpaper_clear_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove_file: {e}"))?;
    }
    Ok(())
}
