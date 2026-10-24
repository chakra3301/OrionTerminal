use super::{digest, identity, portable_photo, read_bounded, Staging, MAX_FILES, MAX_TOTAL};
use photocraft_engine::doc::{LayerContent, SmartSource};
use photocraft_format::zip::{ZipReader, ZipWriter};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{BTreeMap, HashSet}, path::Path};

const MAX_METADATA: usize = 2 * 1024 * 1024;
const MAX_VIEW: usize = 32 * 1024 * 1024;
const MAX_PREVIEW: usize = 24 * 1024 * 1024;
pub(crate) const CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Photo {
    id: String, version: String, name: String, width: u32, height: u32,
    preview_width: u32, preview_height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    history_brush_source_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileRecord { name: String, bytes: usize, sha256: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest { version: u32, kind: String, photo: Photo, files: Vec<FileRecord> }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveInfo {
    pub name: String, pub width: u32, pub height: u32,
    pub preview_width: u32, pub preview_height: u32,
    pub archive_bytes: usize, pub archive_digest: String, pub preview_digest: String,
    pub chunk_digests: Vec<String>,
}
pub(crate) struct PreparedArchive { pub bytes: Vec<u8>, pub info: ArchiveInfo }
pub(crate) struct ImportedImage { pub photo: Value, pub info: ArchiveInfo }

fn valid_hash(value: &str) -> bool { value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) }
fn validate_photo(photo: &Photo) -> Result<(), String> {
    for id in [&photo.id, &photo.version] {
        identity(id)?;
        if ulid::Ulid::from_string(id).map_err(|e| e.to_string())?.to_string() != *id { return Err("Noncanonical shared image identity".into()); }
    }
    if let Some(id) = &photo.history_brush_source_id { identity(id)?; }
    if photo.name.trim().is_empty() || photo.name.encode_utf16().count() > 200 || photo.name.chars().any(char::is_control)
        || photo.width == 0 || photo.height == 0 || u64::from(photo.width) * u64::from(photo.height) > 268_435_456
        || photo.preview_width == 0 || photo.preview_height == 0 || photo.preview_width > photo.width.min(2048) || photo.preview_height > photo.height.min(2048) {
        return Err("Invalid shared image metadata".into());
    }
    Ok(())
}
fn local_photo(value: &Value) -> Result<Photo, String> {
    let mut fields = value.as_object().ok_or("Invalid local image metadata")?.clone();
    for key in ["bundlePath", "previewPath", "originalPath"] { fields.remove(key); }
    let photo: Photo = serde_json::from_value(Value::Object(fields)).map_err(|e| e.to_string())?;
    validate_photo(&photo)?; Ok(photo)
}
fn safe_read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("Invalid shared image source file".into()); }
    read_bounded(path, max)
}
fn file_limit(name: &str, version: &str) -> Result<usize, String> {
    if name == format!("{version}.png") { return Ok(MAX_PREVIEW); }
    if name == format!("{version}.view.json") { return Ok(MAX_VIEW); }
    if let Some(id) = name.strip_suffix(".pcraft") {
        identity(id)?;
        if ulid::Ulid::from_string(id).map_err(|e| e.to_string())?.to_string() == id { return Ok(MAX_TOTAL); }
    }
    Err("Unsafe or unexpected shared image asset".into())
}
fn validate_native(bytes: &[u8], depth: usize, remaining: &mut usize) -> Result<(u32, u32), String> {
    if depth > 8 || bytes.len() > *remaining { return Err("Shared smart-object dependencies exceed their limits".into()); }
    *remaining -= bytes.len();
    let doc = photocraft_format::load_from_bytes_with(bytes, &photocraft_format::LoadOptions {
        max_total_bytes: MAX_TOTAL as u64, max_blob_bytes: MAX_TOTAL,
        max_manifest_bytes: MAX_VIEW, preserve_ids: true,
    }).map_err(|e| e.to_string())?;
    if doc.size.width == 0 || doc.size.height == 0 || u64::from(doc.size.width) * u64::from(doc.size.height) > 268_435_456 { return Err("Shared image exceeds its editing limit".into()); }
    for (_, _, layer) in doc.walk() {
        if let LayerContent::Smart(smart) = &layer.content {
            match &smart.source {
                SmartSource::Linked { .. } => return Err("Shared images must embed every smart-object source".into()),
                SmartSource::Embedded { bytes, .. } => {
                    if photocraft_format::is_pcraft(bytes) { validate_native(bytes, depth + 1, remaining)?; }
                    else {
                        if bytes.len() > *remaining { return Err("Shared smart-object dependencies exceed their limits".into()); }
                        *remaining -= bytes.len();
                    }
                }
            }
        }
    }
    Ok((doc.size.width, doc.size.height))
}
fn validate_preview(bytes: &[u8], photo: &Photo) -> Result<(), String> {
    let image = photocraft_codecs::decode_as_with(photocraft_codecs::Format::Png, bytes, &photocraft_codecs::DecodeOptions {
        limits: photocraft_codecs::Limits { max_width: 2048, max_height: 2048, max_pixels: 2048 * 2048, max_alloc: 32 * 1024 * 1024 }, ..Default::default()
    }).map_err(|e| e.to_string())?;
    if (image.width(), image.height()) != (photo.preview_width, photo.preview_height) { return Err("Shared image preview dimensions disagree".into()); }
    Ok(())
}
fn info(bytes: &[u8], photo: &Photo, preview: &[u8]) -> ArchiveInfo {
    ArchiveInfo { name: photo.name.clone(), width: photo.width, height: photo.height,
        preview_width: photo.preview_width, preview_height: photo.preview_height,
        archive_bytes: bytes.len(), archive_digest: digest(bytes), preview_digest: digest(preview),
        chunk_digests: bytes.chunks(CHUNK_BYTES).map(digest).collect() }
}
fn archive(photo: Photo, files: BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, String> {
    let total = files.values().try_fold(0usize, |total, bytes| total.checked_add(bytes.len())).ok_or("Shared image exceeds its archive limit")?;
    if total > MAX_TOTAL - MAX_METADATA || files.len() > MAX_FILES { return Err("Shared image exceeds its archive limit".into()); }
    let manifest = Manifest { version: 1, kind: "orion.xdesign.image.archive".into(), photo,
        files: files.iter().map(|(name, bytes)| FileRecord { name: name.clone(), bytes: bytes.len(), sha256: digest(bytes) }).collect() };
    let metadata = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_METADATA { return Err("Shared image inventory exceeds its limit".into()); }
    let mut zip = ZipWriter::new(); zip.add("image.json", &metadata).map_err(|e| e.to_string())?;
    for (name, bytes) in files { zip.add(&name, &bytes).map_err(|e| e.to_string())?; }
    let bytes = zip.finish().map_err(|e| e.to_string())?;
    if bytes.len() > MAX_TOTAL { return Err("Shared image exceeds its archive limit".into()); } Ok(bytes)
}

pub(crate) fn build(project_dir: &Path, photo: &Value) -> Result<PreparedArchive, String> {
    build_guarded(project_dir, photo, &mut || Ok(()))
}
pub(crate) fn validate_source(photo: &Value) -> Result<(), String> { local_photo(photo).map(|_| ()) }
pub(crate) fn native_version(bytes:&[u8])->Result<String,String>{
    let zip=ZipReader::new(bytes).map_err(|e|e.to_string())?;
    let manifest:Manifest=serde_json::from_slice(&zip.read_by_name("image.json",MAX_METADATA).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if manifest.version!=1||manifest.kind!="orion.xdesign.image.archive"{return Err("Unsupported native image archive".into());}validate_photo(&manifest.photo)?;Ok(manifest.photo.version)
}
pub(crate) fn build_guarded(project_dir: &Path, photo: &Value, check: &mut dyn FnMut() -> Result<(), String>) -> Result<PreparedArchive, String> {
    check()?;
    let photo = local_photo(photo)?; let source = project_dir.join(&photo.id);
    let source_metadata = std::fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !source_metadata.is_dir() || source_metadata.file_type().is_symlink() { return Err("Invalid shared image source directory".into()); }
    let preview = safe_read(&source.join(format!("{}.png", photo.version)), MAX_PREVIEW)?;
    validate_preview(&preview, &photo)?;
    let mut files = BTreeMap::new(); let mut versions = vec![photo.version.clone()];
    let view_name = format!("{}.view.json", photo.version); let view_path = source.join(&view_name);
    if view_path.exists() {
        let view = safe_read(&view_path, MAX_VIEW)?;
        let value = serde_json::from_slice(&view).map_err(|e| e.to_string())?;
        versions.extend(crate::xdesign_photo::saved_history_references(&value, &photo.version)?);
        files.insert(view_name, view);
    }
    let mut remaining = MAX_TOTAL;
    for version in versions {
        check()?;
        let name = format!("{version}.pcraft"); if files.contains_key(&name) { continue; }
        file_limit(&name, &photo.version)?;
        let original = crate::xdesign_photo::bundle::portable_bytes(&source.join(&name), remaining)?;
        let bytes = portable_photo(&original, 0)?;
        let dimensions = validate_native(&bytes, 0, &mut remaining)?;
        if version == photo.version && dimensions != (photo.width, photo.height) { return Err("Shared native image dimensions disagree".into()); }
        files.insert(name, bytes);
    }
    files.insert(format!("{}.png", photo.version), preview.clone());
    let bytes = archive(photo.clone(), files)?;
    check()?;
    // Validate the same history admission used for remote imports, without changing live snapshots.
    let checked = checked_archive(&bytes)?;
    let stage = staging(project_dir)?;
    stage_files(&stage.0, &checked.files)?;
    crate::xdesign_photo::validate_saved_history(&stage.0, &photo.version)?;
    check()?;
    Ok(PreparedArchive { info: info(&bytes, &photo, &preview), bytes })
}

struct Checked { photo: Photo, files: BTreeMap<String, Vec<u8>>, info: ArchiveInfo }
fn checked_archive(bytes: &[u8]) -> Result<Checked, String> {
    if bytes.is_empty() || bytes.len() > MAX_TOTAL { return Err("Shared image archive exceeds its limit".into()); }
    let zip = ZipReader::new(bytes).map_err(|e| e.to_string())?;
    if zip.entries.len() > MAX_FILES + 1 { return Err("Shared image contains too many assets".into()); }
    let mut names = HashSet::new();
    if zip.entries.iter().any(|entry| !names.insert(entry.name.clone())) { return Err("Shared image contains duplicate assets".into()); }
    let metadata = zip.read_by_name("image.json", MAX_METADATA).map_err(|e| e.to_string())?;
    let manifest: Manifest = serde_json::from_slice(&metadata).map_err(|e| e.to_string())?;
    if manifest.version != 1 || manifest.kind != "orion.xdesign.image.archive" || manifest.files.len() + 1 != zip.entries.len() { return Err("Unsupported shared image archive or inventory".into()); }
    validate_photo(&manifest.photo)?;
    let mut total = metadata.len(); let mut remaining = MAX_TOTAL; let mut files = BTreeMap::new();
    let current = format!("{}.pcraft", manifest.photo.version); let preview_name = format!("{}.png", manifest.photo.version);
    let view_name = format!("{}.view.json", manifest.photo.version);
    for record in manifest.files {
        let limit = file_limit(&record.name, &manifest.photo.version)?;
        if !valid_hash(&record.sha256) || record.bytes > limit || record.bytes > MAX_TOTAL.saturating_sub(total) || files.contains_key(&record.name) { return Err("Invalid shared image asset inventory".into()); }
        let data = zip.read_by_name(&record.name, record.bytes).map_err(|e| e.to_string())?;
        if data.len() != record.bytes || digest(&data) != record.sha256 { return Err("Shared image failed its asset integrity check".into()); }
        total += data.len();
        if record.name.ends_with(".pcraft") {
            let dimensions = validate_native(&data, 0, &mut remaining)?;
            if record.name == current && dimensions != (manifest.photo.width, manifest.photo.height) { return Err("Shared native image dimensions disagree".into()); }
        }
        files.insert(record.name, data);
    }
    let preview = files.get(&preview_name).ok_or("Shared image preview is missing")?;
    validate_preview(preview, &manifest.photo)?;
    let mut expected = HashSet::from([current, preview_name]);
    if let Some(view) = files.get(&view_name) {
        let value = serde_json::from_slice(view).map_err(|e| e.to_string())?;
        for version in crate::xdesign_photo::saved_history_references(&value, &manifest.photo.version)? { expected.insert(format!("{version}.pcraft")); }
        expected.insert(view_name);
    }
    if expected.len() != files.len() || expected.iter().any(|name| !files.contains_key(name)) { return Err("Shared image history is incomplete or contains undeclared versions".into()); }
    Ok(Checked { info: info(bytes, &manifest.photo, preview), photo: manifest.photo, files })
}
fn staging(parent: &Path) -> Result<Staging, String> {
    let metadata = std::fs::symlink_metadata(parent).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() { return Err("Invalid shared image destination".into()); }
    let stage = Staging(parent.join(format!(".room-image-{}", ulid::Ulid::new())), false);
    std::fs::create_dir(&stage.0).map_err(|e| e.to_string())?; Ok(stage)
}
fn stage_files(dir: &Path, files: &BTreeMap<String, Vec<u8>>) -> Result<(), String> {
    use std::io::Write;
    // The unpublished directory is the transaction; a late write cannot recreate its parents.
    for (name, bytes) in files {
        let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(name)).map_err(|e|e.to_string())?;
        file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;
    }
    Ok(())
}
pub(crate) fn import(bytes: &[u8], project_dir: &Path, photo_id: &str, expected: &ArchiveInfo) -> Result<ImportedImage, String> {
    import_guarded(bytes, project_dir, photo_id, expected, &mut || Ok(()))
}
pub(crate) fn import_guarded(bytes: &[u8], project_dir: &Path, photo_id: &str, expected: &ArchiveInfo, check: &mut dyn FnMut() -> Result<(), String>) -> Result<ImportedImage, String> {
    check()?;
    identity(photo_id)?;
    if ulid::Ulid::from_string(photo_id).map_err(|e| e.to_string())?.to_string() != photo_id { return Err("Noncanonical local image identity".into()); }
    let destination = project_dir.join(photo_id);
    if std::fs::symlink_metadata(&destination).is_ok() { return Err("Shared image destination already exists".into()); }
    let checked = checked_archive(bytes)?;
    check()?;
    if checked.photo.id == photo_id { return Err("A shared image import needs a fresh local identity".into()); }
    if serde_json::to_value(&checked.info).map_err(|e| e.to_string())? != serde_json::to_value(expected).map_err(|e| e.to_string())? { return Err("Shared image differs from its reviewed metadata and bytes".into()); }
    let stage = staging(project_dir)?; stage_files(&stage.0, &checked.files)?;
    crate::xdesign_photo::validate_saved_history(&stage.0, &checked.photo.version)?;
    check()?;
    let mut photo = serde_json::to_value(&checked.photo).map_err(|e| e.to_string())?;
    photo["id"] = json!(photo_id); photo["bundlePath"] = json!(destination.join(format!("{}.pcraft", checked.photo.version)));
    photo["previewPath"] = json!(destination.join(format!("{}.png", checked.photo.version))); photo["originalPath"] = Value::Null;
    photocraft_format::atomic::AtomicFs::sync_dir(&photocraft_format::atomic::RealFs, &stage.0).map_err(|e| e.to_string())?;
    // A crash leaves a refusal marker rather than permitting replacement of an uncertain import.
    let reservation = project_dir.join(format!(".room-image-{photo_id}.reserve"));
    let _reservation_file = std::fs::OpenOptions::new().write(true).create_new(true).open(&reservation).map_err(|_| "Another shared image import owns this destination")?;
    let result = (|| {
        check()?;
        if std::fs::symlink_metadata(&destination).is_ok() { return Err("Shared image destination already exists".into()); }
        std::fs::rename(&stage.0, &destination).map_err(|e| e.to_string())?;
        Ok(ImportedImage { photo, info: checked.info })
    })();
    let _ = std::fs::remove_file(reservation);
    result
}
pub(crate) fn recover_import(bytes: &[u8], project_dir: &Path, photo_id: &str, expected: &ArchiveInfo) -> Result<ImportedImage, String> {
    identity(photo_id)?; let checked = checked_archive(bytes)?;
    if checked.photo.id == photo_id || serde_json::to_value(&checked.info).map_err(|e| e.to_string())? != serde_json::to_value(expected).map_err(|e| e.to_string())? { return Err("Shared import recovery differs from its original bytes".into()); }
    let destination = project_dir.join(photo_id);
    let metadata = std::fs::symlink_metadata(&destination).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() { return Err("Invalid original shared image destination".into()); }
    for (name, bytes) in &checked.files {
        if safe_read(&destination.join(name), bytes.len())? != *bytes { return Err("The original imported image was changed or damaged".into()); }
    }
    crate::xdesign_photo::validate_saved_history(&destination, &checked.photo.version)?;
    let mut photo = serde_json::to_value(&checked.photo).map_err(|e| e.to_string())?;
    photo["id"] = json!(photo_id); photo["bundlePath"] = json!(destination.join(format!("{}.pcraft", checked.photo.version)));
    photo["previewPath"] = json!(destination.join(format!("{}.png", checked.photo.version))); photo["originalPath"] = Value::Null;
    Ok(ImportedImage { photo, info: checked.info })
}

#[cfg(test)]
#[path = "xdesign_room_image_archive_tests.rs"]
mod tests;
