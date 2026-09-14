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
    ulid::Ulid::new().to_string()
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

    let size_bytes = crate::fs_ops::copy_regular_file(&src, &target, 512 * 1024 * 1024)?;

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
    if bytes.len() > 64 * 1024 * 1024 { return Err("Pasted assets must be smaller than 64 MB".into()); }
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
    crate::fs_ops::atomic_write_bytes(&target.to_string_lossy(), &bytes)?;

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
pub async fn asset_delete_file(app: AppHandle, file_path: String) -> Result<(), String> {
    // Frontend calls this AFTER the DB row is deleted. Idempotent — a missing
    // file is fine. Scoped to the assets dir so a bad path can't delete
    // anything else.
    let dir = asset_dir(&app)?;
    crate::fs_ops::remove_file_within(&dir, &file_path)
}

/// References and comparison sheets must not overwrite one another while
/// another connector is still reading them.
#[tauri::command]
pub fn xdesign_snapshot_write(app: AppHandle, bytes: Vec<u8>) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("snapshots");
    write_snapshot(&dir, &bytes)
}

fn write_snapshot(dir: &Path, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > 20 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Snapshot must be a PNG smaller than 20 MB".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("create_dir_all: {e}"))?;
    let path = dir.join(format!("{}.png", ulid_string()));
    crate::fs_ops::atomic_write_bytes(&path.to_string_lossy(), &bytes)?;
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "snapshot path was not valid UTF-8".to_string())
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    #[test]
    fn reference_and_comparison_snapshots_never_overwrite_each_other() {
        let dir = std::env::temp_dir().join(format!("orion-snapshot-{}", ulid::Ulid::new()));
        let reference = b"\x89PNG\r\n\x1a\nreference";
        let comparison = b"\x89PNG\r\n\x1a\ncomparison";
        let first = write_snapshot(&dir, reference).unwrap();
        let second = write_snapshot(&dir, comparison).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(first).unwrap(), reference);
        assert_eq!(fs::read(second).unwrap(), comparison);
        assert!(write_snapshot(&dir, b"not PNG").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
