// Custom character storage. Uploaded .glb/.gltf models get copied into
// `$APPDATA/characters/<id>.<ext>` and the frontend renders the resulting path
// via `convertFileSrc` (the asset protocol scope includes this dir).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct StoredCharacter {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "originalName")]
    pub original_name: String,
}

fn characters_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let dir = base.join("characters");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir)
}

fn ulid_string() -> String {
    ulid::Ulid::new().to_string()
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn character_store_file(
    app: AppHandle,
    source_path: String,
) -> Result<StoredCharacter, String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(format!("source path not found: {source_path}"));
    }
    let ext = ext_of(&src);
    if ext != "glb" && ext != "gltf" {
        return Err("only .glb or .gltf models are supported".to_string());
    }
    let original_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "character".to_string());

    let dir = characters_dir(&app)?;
    let id = ulid_string();
    let target = dir.join(format!("{id}.{ext}"));

    crate::fs_ops::copy_regular_file(&src, &target, 256 * 1024 * 1024)?;

    let file_path = target
        .to_str()
        .ok_or_else(|| "target path was not valid UTF-8".to_string())?
        .to_string();

    Ok(StoredCharacter { file_path, original_name })
}

#[tauri::command]
pub async fn character_clear_file(app: AppHandle, file_path: String) -> Result<(), String> {
    let dir = characters_dir(&app)?;
    crate::fs_ops::remove_file_within(&dir, &file_path)
}
