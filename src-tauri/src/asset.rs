// File-ingest pipeline for Archives media.
//
// `asset_store_file` copies a host-side file into the app data dir under
// `assets/<ulid>.<ext>` and returns metadata back to the frontend, which is
// responsible for inserting the corresponding DB row via the SQL plugin.
// The file is content-addressed by a fresh ulid (not a hash) so the same
// file dropped twice creates two assets — Phase B doesn't dedupe.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct StoredAsset {
    pub id: String,
    pub kind: String,           // "image" | "video" | "audio" | "doc" | "other"
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "originalName")]
    pub original_name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,      // absolute path, used by convertFileSrc on the FE
}

fn asset_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let dir = base.join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir)
}

fn ulid_string() -> String {
    // We don't have the ulid crate on the Rust side; mint a passable id from
    // time + a few random bytes. This is opaque to humans and good enough as
    // a filesystem-safe asset id.
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // 6 random bytes via the address of a stack var (good-enough entropy
    // mixed with the timestamp — collisions across writes within the same
    // ms on the same machine are not a concern at human typing speed).
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

fn classify_kind(ext: &str, mime: &str) -> &'static str {
    if mime.starts_with("image/") || matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "heic" | "bmp" | "avif") {
        return "image";
    }
    if mime.starts_with("video/") || matches!(ext, "mp4" | "mov" | "webm" | "mkv" | "m4v") {
        return "video";
    }
    if mime.starts_with("audio/") || matches!(ext, "mp3" | "wav" | "m4a" | "flac" | "ogg") {
        return "audio";
    }
    if matches!(ext, "pdf" | "md" | "txt" | "rtf" | "docx" | "doc") {
        return "doc";
    }
    "other"
}

fn guess_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "m4v" => "video/x-m4v",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "pdf" => "application/pdf",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "rtf" => "application/rtf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc" => "application/msword",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub async fn asset_store_file(
    app: AppHandle,
    source_path: String,
) -> Result<StoredAsset, String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(format!("source path not found: {source_path}"));
    }
    let original_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "untitled".to_string());

    let ext = ext_of(&src);
    let mime = guess_mime(&ext).to_string();
    let kind = classify_kind(&ext, &mime).to_string();

    let dir = asset_dir(&app)?;
    let id = ulid_string();
    let target_name = if ext.is_empty() {
        id.clone()
    } else {
        format!("{id}.{ext}")
    };
    let target = dir.join(&target_name);

    let bytes = fs::read(&src).map_err(|e| format!("read source: {e}"))?;
    let size_bytes = bytes.len() as u64;
    fs::write(&target, &bytes).map_err(|e| format!("write target: {e}"))?;

    let file_path = target
        .to_str()
        .ok_or_else(|| "target path was not valid UTF-8".to_string())?
        .to_string();

    Ok(StoredAsset {
        id,
        kind,
        mime_type: mime,
        size_bytes,
        original_name,
        file_path,
    })
}

/// Bytes-in variant of `asset_store_file` — used by the clipboard-paste path,
/// where the source has no host filesystem path. The frontend sends the raw
/// bytes (typically a PNG decoded from `clipboardData.items`) plus a
/// preferred filename, and we write it to the same `$APPDATA/assets/` dir.
#[tauri::command]
pub async fn asset_store_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    suggested_name: String,
    mime_type_hint: String,
) -> Result<StoredAsset, String> {
    let original_name = if suggested_name.trim().is_empty() {
        format!("pasted-{}", chrono_like_now())
    } else {
        suggested_name
    };

    let mut ext = ext_of(Path::new(&original_name));
    if ext.is_empty() {
        ext = ext_from_mime(&mime_type_hint).to_string();
    }
    let mime = if mime_type_hint.trim().is_empty() {
        guess_mime(&ext).to_string()
    } else {
        mime_type_hint
    };
    let kind = classify_kind(&ext, &mime).to_string();

    let dir = asset_dir(&app)?;
    let id = ulid_string();
    let target_name = if ext.is_empty() {
        id.clone()
    } else {
        format!("{id}.{ext}")
    };
    let target = dir.join(&target_name);

    let size_bytes = bytes.len() as u64;
    fs::write(&target, &bytes).map_err(|e| format!("write target: {e}"))?;

    let file_path = target
        .to_str()
        .ok_or_else(|| "target path was not valid UTF-8".to_string())?
        .to_string();

    let final_name = if original_name.contains('.') {
        original_name
    } else if !ext.is_empty() {
        format!("{original_name}.{ext}")
    } else {
        original_name
    };

    Ok(StoredAsset {
        id,
        kind,
        mime_type: mime,
        size_bytes,
        original_name: final_name,
        file_path,
    })
}

fn ext_from_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/heic" => "heic",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        "audio/wav" => "wav",
        "application/pdf" => "pdf",
        _ => "",
    }
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

#[tauri::command]
pub async fn asset_delete_file(file_path: String) -> Result<(), String> {
    // Frontend calls this AFTER the DB row is deleted. Idempotent — a missing
    // file is fine.
    let path = PathBuf::from(&file_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove_file: {e}"))?;
    }
    Ok(())
}

/// Write a transient XDesign canvas snapshot PNG for the Claude vision loop.
/// Overwrites a single file in the app config dir each turn — these are
/// throwaway renders, deliberately kept out of the asset library — and
/// returns its absolute path so the caller can hand it to the CLI as an
/// `@<path>` attachment.
#[tauri::command]
pub fn xdesign_snapshot_write(app: AppHandle, bytes: Vec<u8>) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    let path = dir.join("xdesign-snapshot.png");
    fs::write(&path, &bytes).map_err(|e| format!("write snapshot: {e}"))?;
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "snapshot path was not valid UTF-8".to_string())
}
