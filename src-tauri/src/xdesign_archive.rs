//! Portable XDesign projects. Files are CRC/SHA checked, bounded, and staged
//! under a fresh project identity before the frontend publishes its registry.
use photocraft_format::zip::{ZipReader, ZipWriter};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, io::Read, path::{Path, PathBuf}};
use tauri::{AppHandle, Manager};

#[path = "xdesign_room_image_archive.rs"]
pub(crate) mod room_image;

const MAX_TOTAL: usize = 512 * 1024 * 1024;
const MAX_JSON: usize = 64 * 1024 * 1024;
const MAX_FILES: usize = 8192;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileRecord { pub(crate) name: String, pub(crate) bytes: usize, pub(crate) sha256: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest { format: String, version: u32, name: String, document: Value, files: Vec<FileRecord> }
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndependentPhotoCopy { source_id: String, source_version: String, target_id: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedProject { pub(crate) name: String, pub(crate) document: Value }

fn identity(value: &str) -> Result<(), String> {
    ulid::Ulid::from_string(value).map(|_| ()).map_err(|_| "Invalid project asset identity".into())
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key].as_str().ok_or_else(|| format!("Invalid project field: {key}"))
}
fn read_bounded(file: &Path, max: usize) -> Result<Vec<u8>, String> {
    let mut input = std::fs::File::open(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let metadata = input.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > max as u64 { return Err("Project asset exceeds its size limit".into()); }
    let mut bytes = Vec::new();
    (&mut input).take(max as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > max { return Err("Project asset exceeds its size limit".into()); }
    Ok(bytes)
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
// Where Save As put each image is a path on this machine, like originalPath. A copied or imported project asks again rather than saving over another project's files.
fn local_only(document: &mut Value) { if let Some(document) = document.as_object_mut() { document.remove("photoSavePaths"); document.remove("photoResume"); } }

pub(crate) fn visit_photos(document: &mut Value, mut visit: impl FnMut(&mut Value) -> Result<(), String>) -> Result<(), String> {
    if let Some(photos) = document.get_mut("photoDocuments") {
        let photos = photos.as_object_mut().ok_or("Invalid image document registry")?;
        if photos.len() > 1024 { return Err("Too many image documents".into()); }
        for (id, photo) in photos {
            if photo["id"].as_str() != Some(id) { return Err("Invalid image document identity".into()); }
            visit(photo)?;
        }
    }
    if let Some(drafts) = document.get_mut("photoDrafts") {
        let drafts = drafts.as_array_mut().ok_or("Invalid image drafts")?;
        if drafts.len() > 64 { return Err("Too many image drafts".into()); }
        for draft in drafts {
            let trail = draft["trail"].as_array_mut().ok_or("Invalid image draft trail")?;
            if trail.is_empty() || trail.len() > 8 { return Err("Invalid image draft depth".into()); }
            for frame in trail {
                visit(&mut frame["parent"])?;
                let mut count = 0;
                for key in ["past", "future"] {
                    let versions = frame[key].as_array_mut().ok_or("Invalid image draft history")?;
                    count += versions.len();
                    if count > 100 { return Err("Image draft history exceeds its limit".into()); }
                    for photo in versions { visit(photo)?; }
                }
            }
        }
    }
    if let Some(images) = document.get_mut("pencilDocument").and_then(|pencil| pencil.get_mut("roomImages")) {
        let images = images.as_object_mut().ok_or("Invalid local shared image mappings")?;
        if images.len() != 2 || images.get("version").and_then(Value::as_u64) != Some(1) { return Err("Unsupported local shared image mappings".into()); }
        let bindings = images.get_mut("bindings").and_then(Value::as_array_mut).ok_or("Invalid local shared image mappings")?;
        if bindings.len() > 500 { return Err("Too many local shared image mappings".into()); }
        for binding in bindings {
            if !binding.is_object() || binding.as_object().unwrap().len() != 4 || !["serverUrl", "documentId", "reference", "photo"].iter().all(|key| binding.get(key).is_some()) { return Err("Invalid local shared image mapping".into()); }
            visit(binding.get_mut("photo").ok_or("Missing local shared image document")?)?;
        }
    }
    Ok(())
}

fn photo_names(photo: &Value) -> Result<(String, String, String), String> {
    let id = text(photo, "id")?; let version = text(photo, "version")?;
    identity(id)?; identity(version)?;
    let dimensions: Vec<_> = ["width", "height", "previewWidth", "previewHeight"].iter()
        .map(|field| photo[*field].as_u64().filter(|n| *n > 0).ok_or("Invalid image dimensions"))
        .collect::<Result<_, _>>()?;
    if dimensions[0].saturating_mul(dimensions[1]) > 268_435_456 || dimensions[2] > dimensions[0] || dimensions[3] > dimensions[1] || dimensions[2] > 2048 || dimensions[3] > 2048 {
        return Err("Image document exceeds its editing limit".into());
    }
    Ok((format!("photos/{id}/{version}.pcraft"), format!("photos/{id}/{version}.png"), format!("photos/{id}/{version}.view.json")))
}

fn add_file(files: &mut BTreeMap<String, Vec<u8>>, total: &mut usize, name: String, bytes: Vec<u8>) -> Result<(), String> {
    if files.contains_key(&name) { return Ok(()); }
    *total = total.saturating_add(bytes.len());
    if *total > MAX_TOTAL - MAX_JSON || files.len() >= MAX_FILES { return Err("Portable project exceeds 512MB or 8192 assets".into()); }
    files.insert(name, bytes); Ok(())
}

// A backup embeds linked sources in cloned bundles. The live image and its
// external links are never changed. Nested native bundles remain editable.
fn portable_photo(bytes: &[u8], depth: usize) -> Result<Vec<u8>, String> {
    if depth > 8 { return Err("Linked smart-object backup exceeds eight nested documents".into()); }
    let mut doc = photocraft_format::load_from_bytes_with(bytes, &photocraft_format::LoadOptions {
        max_total_bytes: MAX_TOTAL as u64, max_blob_bytes: MAX_TOTAL, max_manifest_bytes: 32 * 1024 * 1024, preserve_ids: true,
    }).map_err(|e| e.to_string())?;
    if u64::from(doc.size.width) * u64::from(doc.size.height) > 268_435_456 { return Err("Image document exceeds its editing limit".into()); }
    use photocraft_engine::doc::{LayerContent, SmartSource};
    let ids: Vec<_> = doc.walk().iter().filter_map(|(_, _, layer)| matches!(layer.content, LayerContent::Smart(_)).then_some(layer.id)).collect();
    let mut changed = false;
    let mut embedded_bytes = 0usize;
    for id in ids {
        let LayerContent::Smart(smart) = &doc.layer(id).ok_or("Missing smart-object layer")?.content else { continue; };
        if let SmartSource::Linked { path } = &smart.source {
            if Path::new(path).is_file() && std::fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_TOTAL as u64 {
                return Err("A linked smart-object source exceeds 512MB".into());
            }
        }
        let (name, source) = photocraft_engine::smart_cmds::source_bytes(&doc.metadata, &smart.source)
            .ok_or("A smart-object source is missing. Relink it before saving a portable project.")?;
        embedded_bytes = embedded_bytes.saturating_add(source.len());
        if embedded_bytes > MAX_TOTAL { return Err("Smart-object sources exceed 512MB".into()); }
        let native = photocraft_format::is_pcraft(&source);
        let linked = matches!(smart.source, SmartSource::Linked { .. });
        if native || linked {
            let source = if native { portable_photo(&source, depth + 1)? } else { (*source).clone() };
            let LayerContent::Smart(smart) = &mut doc.layer_mut(id).ok_or("Missing smart-object layer")?.content else { continue; };
            smart.source = SmartSource::Embedded { file_name: name, bytes: std::sync::Arc::new(source) };
            changed = true;
        }
    }
    if changed { photocraft_format::save_to_bytes(&doc, &Default::default()).map_err(|e| e.to_string()) }
    else { Ok(bytes.to_vec()) }
}

fn visit_shape_paths(document: &mut Value, mut visit: impl FnMut(&mut Value) -> Result<(), String>) -> Result<(), String> {
    let pages = document["pages"].as_array_mut().ok_or("Invalid design pages")?;
    for page in pages {
        for shape in page["shapes"].as_array_mut().ok_or("Invalid design layers")? {
            if shape.get("filePath").is_some() { visit(&mut shape["filePath"])?; shape["assetId"] = Value::Null; }
            if let Some(fill) = shape.get_mut("fillImage") { visit(&mut fill["filePath"])?; fill["assetId"] = Value::Null; }
        }
    }
    Ok(())
}

pub(crate) fn build_archive(project_dir: &Path, name: String, document: Value) -> Result<Vec<u8>, String> {
    build_archive_with_photo_sources(project_dir, name, document, &BTreeMap::new())
}
fn build_archive_with_photo_sources(project_dir: &Path, name: String, mut document: Value, photo_sources: &BTreeMap<String, IndependentPhotoCopy>) -> Result<Vec<u8>, String> {
    if name.len() > 16_384 || serde_json::to_vec(&document).map_err(|e| e.to_string())?.len() > MAX_JSON { return Err("Project metadata exceeds 64MB".into()); }
    local_only(&mut document);
    let mut files = BTreeMap::new(); let mut total = 0usize;
    let mut preview_paths = BTreeMap::new();
    visit_photos(&mut document, |photo| {
        let (bundle, preview, view) = photo_names(photo)?;
        let target_id = text(photo, "id")?;
        let source_id = photo_sources.get(target_id).map(|copy| copy.source_id.as_str()).unwrap_or(target_id);
        let version = text(photo, "version")?;
        let source_bundle = project_dir.join(source_id).join(format!("{version}.pcraft"));
        let source_preview = project_dir.join(source_id).join(format!("{version}.png"));
        let source_view = project_dir.join(source_id).join(format!("{version}.view.json"));
        preview_paths.insert(text(photo, "previewPath")?.to_string(), preview.clone());
        if !files.contains_key(&bundle) {
            let bytes = crate::xdesign_photo::bundle::portable_bytes(&source_bundle, MAX_TOTAL - total)?;
            add_file(&mut files, &mut total, bundle.clone(), portable_photo(&bytes, 0)?)?;
        }
        if !files.contains_key(&preview){add_file(&mut files, &mut total, preview.clone(), read_bounded(&source_preview, 24 * 1024 * 1024)?)?;}
        if !files.contains_key(&view){
            let file = source_view;
            if file.is_file() {
                let bytes=read_bounded(&file,32*1024*1024)?;
                let metadata:Value=serde_json::from_slice(&bytes).map_err(|error|error.to_string())?;
                for version in crate::xdesign_photo::saved_history_references(&metadata,text(photo,"version")?)? {
                    let name=format!("photos/{}/{version}.pcraft",text(photo,"id")?);
                    if !files.contains_key(&name){let bytes=crate::xdesign_photo::bundle::portable_bytes(&project_dir.join(source_id).join(format!("{version}.pcraft")),MAX_TOTAL-total)?;add_file(&mut files,&mut total,name,portable_photo(&bytes,0)?)?;}
                }
                add_file(&mut files, &mut total, view, bytes)?;
            }
        }
        photo["bundlePath"] = json!(bundle); photo["previewPath"] = json!(preview); photo["originalPath"] = Value::Null;
        Ok(())
    })?;
    if let Some(drafts) = document["photoDrafts"].as_array() {
        for draft in drafts { for frame in draft["trail"].as_array().ok_or("Invalid image draft")? {
            let child = text(frame, "childId")?; identity(child)?;
            let parent = text(&frame["parent"], "id")?; let version = text(&frame["parent"], "version")?;
            let layer = frame["layer"].as_u64().ok_or("Invalid smart-object layer")?;
            let link = serde_json::to_vec(&json!({"parentId":parent,"parentVersion":version,"layer":layer})).map_err(|e| e.to_string())?;
            add_file(&mut files, &mut total, format!("photos/{child}/contents.json"), link)?;
        }}
    }
    let mut resources: BTreeMap<String, String> = BTreeMap::new();
    visit_shape_paths(&mut document, |value| {
        let source = value.as_str().ok_or("Invalid image path")?.to_string();
        let target = if let Some(preview) = preview_paths.get(&source) { preview.clone() }
        else if let Some(resource) = resources.get(&source) { resource.clone() }
        else {
            let file = Path::new(&source);
            if !file.is_absolute() { return Err("A project image is not a local file. Import it locally before saving a portable project.".into()); }
            let bytes = read_bounded(file, 64 * 1024 * 1024)?;
            let extension = file.extension().and_then(|s| s.to_str()).unwrap_or("bin").to_lowercase();
            if extension.len() > 12 || !extension.chars().all(|c| c.is_ascii_alphanumeric()) { return Err("Unsupported project resource extension".into()); }
            let target = format!("resources/{}.{}", digest(&bytes), extension);
            add_file(&mut files, &mut total, target.clone(), bytes)?;
            resources.insert(source, target.clone()); target
        };
        *value = json!(target); Ok(())
    })?;
    let records = files.iter().map(|(name, bytes)| FileRecord { name: name.clone(), bytes: bytes.len(), sha256: digest(bytes) }).collect();
    let manifest = Manifest { format: "orion.xdesign".into(), version: 1, name, document, files: records };
    let manifest = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    if manifest.len() > MAX_JSON { return Err("Project metadata exceeds 64MB".into()); }
    let mut zip = ZipWriter::new();
    zip.add("project.json", &manifest).map_err(|e| e.to_string())?;
    for (name, bytes) in files { zip.add(&name, &bytes).map_err(|e| e.to_string())?; }
    let archive = zip.finish().map_err(|e| e.to_string())?;
    if archive.len() > MAX_TOTAL { return Err("Portable project exceeds 512MB".into()); }
    Ok(archive)
}

pub(crate) fn asset_relative(name: &str) -> Result<PathBuf, String> {
    let parts: Vec<_> = name.split('/').collect();
    if parts.len() == 3 && parts[0] == "photos" {
        identity(parts[1])?;
        if parts[2] != "contents.json" {
            let version = [".view.json", ".pcraft", ".png"].iter().find_map(|suffix| parts[2].strip_suffix(suffix)).ok_or("Unsupported image asset")?;
            identity(version)?;
        }
        return Ok(PathBuf::from(parts[1]).join(parts[2]));
    }
    if parts.len() == 2 && parts[0] == "resources" {
        let (hash, extension) = parts[1].split_once('.').ok_or("Invalid resource name")?;
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) && !extension.is_empty() && extension.len() <= 12 && extension.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Ok(PathBuf::from("resources").join(parts[1]));
        }
    }
    Err("Unsafe or unsupported project asset path".into())
}

struct Staging(PathBuf, bool);
impl Drop for Staging { fn drop(&mut self) { if !self.1 { let _ = std::fs::remove_dir_all(&self.0); } } }
pub(crate) fn unpack_archive(bytes: &[u8], final_dir: &Path) -> Result<ImportedProject, String> {
    unpack_archive_managed(bytes, final_dir, None)
}
pub(crate) fn unpack_archive_managed(bytes: &[u8], final_dir: &Path, mut managed: Option<(&crate::xdesign_project_imports::Lease, &mut rusqlite::Connection)>) -> Result<ImportedProject, String> {
    if bytes.len() > MAX_TOTAL || crate::xdesign_project_imports::present(final_dir)? { return Err("Project file is too large or its destination already exists".into()); }
    let zip = ZipReader::new(bytes).map_err(|e| e.to_string())?;
    if zip.entries.len() > MAX_FILES + 1 { return Err("Project file contains too many assets".into()); }
    let mut names = HashSet::new();
    for entry in &zip.entries { if !names.insert(entry.name.as_str()) { return Err("Project archive contains duplicate assets".into()); } }
    let manifest_bytes = zip.read_by_name("project.json", MAX_JSON).map_err(|e| e.to_string())?;
    let mut manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    if manifest.format != "orion.xdesign" || manifest.version != 1 || manifest.name.len() > 16_384 { return Err("Unsupported XDesign project file".into()); }
    local_only(&mut manifest.document);
    if manifest.files.len() + 1 != zip.entries.len() { return Err("Project asset inventory does not match its archive".into()); }
    let parent = final_dir.parent().ok_or("Invalid project destination")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let operation = managed.as_ref().map(|(lease,_)|lease.receipt.operation_id.clone()).unwrap_or_else(||ulid::Ulid::new().to_string());
    let staging = Staging(parent.join(format!(".import-{operation}")), managed.is_some());
    std::fs::create_dir(&staging.0).map_err(|e| e.to_string())?;
    if let Some((lease,conn))=managed.as_mut(){crate::xdesign_project_imports::owner(conn,lease,&staging.0,&manifest.files)?;}
    let mut total = manifest_bytes.len(); let mut declared = HashSet::new(); let mut destinations = HashSet::new();
    for record in &manifest.files {
        let relative = asset_relative(&record.name)?;
        if !destinations.insert(relative.to_string_lossy().to_lowercase()) { return Err("Project assets have conflicting filesystem names".into()); }
        if !declared.insert(record.name.clone()) || record.bytes > MAX_TOTAL.saturating_sub(total) { return Err("Invalid or oversized project asset inventory".into()); }
        let data = zip.read_by_name(&record.name, record.bytes).map_err(|e| e.to_string())?;
        if data.len() != record.bytes || digest(&data) != record.sha256 { return Err("Project asset failed its integrity check".into()); }
        total = total.saturating_add(data.len());
        if total > MAX_TOTAL { return Err("Expanded project exceeds 512MB".into()); }
        let target = staging.0.join(relative);
        std::fs::create_dir_all(target.parent().ok_or("Invalid asset destination")?).map_err(|e| e.to_string())?;
        photocraft_format::atomic_write(&target, &data).map_err(|e| e.to_string())?;
    }
    let mut verified_photos = BTreeMap::new(); let mut verified_previews = BTreeMap::new();
    visit_photos(&mut manifest.document, |photo| {
        let (bundle, preview, _) = photo_names(photo)?;
        if photo["bundlePath"] != bundle || photo["previewPath"] != preview || !declared.contains(&bundle) || !declared.contains(&preview) { return Err("Missing or invalid layered image asset".into()); }
        if !verified_photos.contains_key(&bundle) {
            let doc = photocraft_format::load_path_with(&staging.0.join(asset_relative(&bundle)?), &photocraft_format::LoadOptions {
                max_total_bytes: MAX_TOTAL as u64, max_blob_bytes: MAX_TOTAL, max_manifest_bytes: 32 * 1024 * 1024, preserve_ids: true,
            }).map_err(|e| e.to_string())?;
            verified_photos.insert(bundle.clone(),(doc.size.width,doc.size.height));
        }
        let (width,height)=verified_photos[&bundle];
        if photo["width"].as_u64()!=Some(u64::from(width))||photo["height"].as_u64()!=Some(u64::from(height)) {
            return Err("Layered image dimensions do not match the project".into());
        }
        if !verified_previews.contains_key(&preview) {
            let png=read_bounded(&staging.0.join(asset_relative(&preview)?),24*1024*1024)?;
            let image=photocraft_codecs::decode_as_with(photocraft_codecs::Format::Png,&png,&photocraft_codecs::DecodeOptions {
                limits:photocraft_codecs::Limits{max_width:2048,max_height:2048,max_pixels:2048*2048,max_alloc:32*1024*1024},..Default::default()
            }).map_err(|e|e.to_string())?;
            verified_previews.insert(preview.clone(),(image.width(),image.height()));
        }
        let (preview_width,preview_height)=verified_previews[&preview];
        if photo["previewWidth"].as_u64()!=Some(u64::from(preview_width))||photo["previewHeight"].as_u64()!=Some(u64::from(preview_height)) {
            return Err("Image preview dimensions do not match the project".into());
        }
        photo["bundlePath"] = json!(final_dir.join(asset_relative(&bundle)?).to_string_lossy());
        photo["previewPath"] = json!(final_dir.join(asset_relative(&preview)?).to_string_lossy());
        photo["originalPath"] = Value::Null; Ok(())
    })?;
    let mut histories=HashSet::new();
    visit_photos(&mut manifest.document,|photo|{
        let id=text(photo,"id")?;let version=text(photo,"version")?;
        if histories.insert((id.to_owned(),version.to_owned())){crate::xdesign_photo::validate_saved_history(&staging.0.join(id),version)?;}
        Ok(())
    })?;
    if let Some(drafts) = manifest.document["photoDrafts"].as_array() {
        for draft in drafts { for frame in draft["trail"].as_array().ok_or("Invalid image draft")? {
            let child = text(frame, "childId")?;
            let link_name = format!("photos/{child}/contents.json");
            if !declared.contains(&link_name) { return Err("A smart-object recovery link is missing".into()); }
            let link: Value = serde_json::from_slice(&read_bounded(&staging.0.join(asset_relative(&link_name)?), 4096)?).map_err(|e| e.to_string())?;
            if link["parentId"] != frame["parent"]["id"] || link["parentVersion"] != frame["parent"]["version"] || link["layer"] != frame["layer"] {
                return Err("A smart-object recovery link does not match its parent".into());
            }
        }}
    }
    visit_shape_paths(&mut manifest.document, |value| {
        let name = value.as_str().ok_or("Invalid project image reference")?;
        if !declared.contains(name) { return Err("A project image resource is missing".into()); }
        *value = json!(final_dir.join(asset_relative(name)?).to_string_lossy()); Ok(())
    })?;
    let imported=ImportedProject { name: manifest.name, document: manifest.document };
    if let Some((lease,conn))=managed.as_mut(){crate::xdesign_project_imports::ready(conn,lease,&staging.0,&imported)?;}
    if crate::xdesign_project_imports::present(final_dir)?{return Err("Project destination appeared during import; files were preserved".into());}
    std::fs::rename(&staging.0, final_dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    { let _=std::fs::File::open(parent).and_then(|dir|dir.sync_all()); }
    Ok(imported)
}

#[tauri::command]
pub async fn xdesign_project_export(app: AppHandle, project_id: String, path: String, name: String, document: Value) -> Result<(), String> {
    identity(&project_id)?;
    let source = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets/xdesign").join(project_id);
    tauri::async_runtime::spawn_blocking(move || {
        let archive = build_archive(&source, name, document)?;
        photocraft_format::atomic_write(Path::new(&path), &archive).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_project_import(app: AppHandle, project_id: String, path: String, operation_id: Option<String>) -> Result<ImportedProject, String> {
    identity(&project_id)?;
    let destination = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets/xdesign").join(&project_id);
    tauri::async_runtime::spawn_blocking(move || match operation_id {
        Some(operation_id)=>crate::xdesign_project_imports::managed(&app,&crate::xdesign_project_imports::Receipt{project_id,operation_id},|lease,conn|unpack_archive_managed(&read_bounded(Path::new(&path),MAX_TOTAL)?,&destination,Some((lease,conn)))),
        None=>unpack_archive(&read_bounded(Path::new(&path), MAX_TOTAL)?, &destination)
    }).await.map_err(|e| e.to_string())?
}

fn clone_project(source: &Path, destination: &Path, name: String, document: Value) -> Result<ImportedProject, String> {
    clone_project_with_photos(source, destination, name, document, Vec::new())
}
fn clone_project_with_photos(source: &Path, destination: &Path, name: String, document: Value, copies: Vec<IndependentPhotoCopy>) -> Result<ImportedProject, String> {
    clone_project_managed(source,destination,name,document,copies,None)
}
fn clone_project_managed(source: &Path, destination: &Path, name: String, document: Value, copies: Vec<IndependentPhotoCopy>, managed: Option<(&crate::xdesign_project_imports::Lease,&mut rusqlite::Connection)>) -> Result<ImportedProject, String> {
    if source == destination { return Err("A shared copy needs a fresh project identity".into()); }
    if copies.len() > 500 { return Err("Too many independent image copies".into()); }
    let mut sources = BTreeMap::new();
    let originals: HashSet<_> = copies.iter().map(|copy| copy.source_id.clone()).collect();
    for copy in copies {
        for id in [&copy.source_id, &copy.source_version, &copy.target_id] { identity(id)?; }
        if originals.contains(&copy.target_id) || source.join(&copy.target_id).exists() || sources.contains_key(&copy.target_id) || document["photoDocuments"][&copy.target_id]["id"].as_str() != Some(copy.target_id.as_str()) || document["photoDocuments"][&copy.target_id]["version"].as_str() != Some(copy.source_version.as_str()) {
            return Err("Conflicting independent image copy identity or version".into());
        }
        sources.insert(copy.target_id.clone(), copy);
    }
    unpack_archive_managed(&build_archive_with_photo_sources(source, name, document, &sources)?, destination,managed)
}

#[tauri::command]
pub async fn xdesign_project_clone(app: AppHandle, source_project_id: String, project_id: String, name: String, document: Value, photo_copies: Option<Vec<IndependentPhotoCopy>>, operation_id: Option<String>) -> Result<ImportedProject, String> {
    identity(&source_project_id)?; identity(&project_id)?;
    let assets = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets/xdesign");
    tauri::async_runtime::spawn_blocking(move || { match operation_id {
        Some(operation_id)=>crate::xdesign_project_imports::managed(&app,&crate::xdesign_project_imports::Receipt{project_id:project_id.clone(),operation_id},|lease,conn|clone_project_managed(&assets.join(source_project_id),&assets.join(project_id),name,document,photo_copies.unwrap_or_default(),Some((lease,conn)))),
        None=>match photo_copies { Some(copies)=>clone_project_with_photos(&assets.join(source_project_id),&assets.join(project_id),name,document,copies),None=>clone_project(&assets.join(source_project_id),&assets.join(project_id),name,document) }
    } }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::{doc::{LayerContent, SmartSource}, Session};

    fn temp() -> Staging {
        let dir = std::env::temp_dir().join(format!("xdesign-archive-{}", ulid::Ulid::new()));
        std::fs::create_dir(&dir).unwrap(); Staging(dir,false)
    }
    fn image(dir: &Path, engine: &Session, photo_id: Option<&str>) -> Value {
        let id = photo_id.map(String::from).unwrap_or_else(|| ulid::Ulid::new().to_string());
        let version = ulid::Ulid::new().to_string();
        let dir = dir.join(&id); std::fs::create_dir_all(&dir).unwrap();
        let doc = &engine.active().unwrap().doc;
        let bundle = dir.join(format!("{version}.pcraft")); let preview = dir.join(format!("{version}.png"));
        std::fs::write(&bundle, photocraft_format::save_to_bytes(doc, &Default::default()).unwrap()).unwrap();
        let pixels=photocraft_compose::thumbnail(doc,2048);
        let image=photocraft_codecs::Image::from_u8(pixels.width,pixels.height,photocraft_codecs::ChannelLayout::Rgba,pixels.pixels).unwrap();
        std::fs::write(&preview,photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap()).unwrap();
        std::fs::write(dir.join(format!("{version}.view.json")), serde_json::to_vec(&photocraft_engine::inspect::document(engine.active().unwrap())).unwrap()).unwrap();
        json!({"id":id,"version":version,"name":doc.name,"width":doc.size.width,"height":doc.size.height,"previewWidth":doc.size.width,"previewHeight":doc.size.height,"bundlePath":bundle,"previewPath":preview,"originalPath":"/old/source.psd"})
    }
    fn engine() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":24,"height":24,"background":"white","depth":16})).unwrap();
        engine
    }
    fn project() -> Value { json!({"formatVersion":2,"pages":[{"id":"page","name":"Page 1","shapes":[]}],"activePageId":"page","photoDocuments":{},"photoDrafts":[]}) }

    #[test]
    fn shared_image_copy_and_backup_keep_accepted_base_and_unpublished_native_versions() {
        let temp = temp(); let source = temp.0.join("source"); let mut engine = engine();
        let base = image(&source, &engine, None);
        engine.execute("paint.stroke", json!({"points":[[10,10]],"size":4,"seed":5})).unwrap();
        let working = image(&source, &engine, Some(text(&base, "id").unwrap()));
        let mut doc = project(); doc["photoDocuments"][text(&working, "id").unwrap()] = working.clone();
        doc["pencilDocument"] = json!({"roomImages":{"version":1,"bindings":[{"serverUrl":"https://rooms.example.test/","documentId":"image_room_identity_001","reference":{"version":1,"imageId":"editable_image_identity_001","revisionId":"a".repeat(64),"previewHash":"b".repeat(40)},"photo":base}]}});
        let archive = build_archive(&source, "Image revisions".into(), doc.clone()).unwrap();
        for (name, imported) in [("copy", clone_project(&source, &temp.0.join("copy"), "Copy".into(), doc.clone()).unwrap()), ("backup", unpack_archive(&archive, &temp.0.join("backup")).unwrap())] {
            let kept = &imported.document["pencilDocument"]["roomImages"]["bindings"][0]["photo"];
            let draft = &imported.document["photoDocuments"][text(&working, "id").unwrap()];
            assert_eq!(kept["id"], draft["id"]); assert_ne!(kept["version"], draft["version"]);
            for photo in [kept, draft] {
                assert!(Path::new(text(photo, "bundlePath").unwrap()).starts_with(temp.0.join(name)));
                assert!(Path::new(text(photo, "previewPath").unwrap()).exists());
                assert!(photocraft_format::load_path(Path::new(text(photo, "bundlePath").unwrap())).is_ok());
                assert!(photo["originalPath"].is_null());
            }
        }
        assert!(Path::new(text(&base, "bundlePath").unwrap()).exists());
        assert!(Path::new(text(&working, "bundlePath").unwrap()).exists());
    }

    #[test]
    fn independent_image_copy_keeps_accepted_layers_separate_from_unpublished_drafts() {
        let temp = temp(); let source = temp.0.join("source"); let mut engine = engine();
        let accepted = image(&source, &engine, None);
        engine.execute("paint.stroke", json!({"points":[[10,10]],"size":8,"seed":5})).unwrap();
        let draft = image(&source, &engine, Some(text(&accepted, "id").unwrap()));
        let target = ulid::Ulid::new().to_string(); let mut alias = accepted.clone(); alias["id"] = json!(target);
        let mut document = project(); document["photoDocuments"][text(&draft,"id").unwrap()] = draft.clone(); document["photoDocuments"][&target] = alias;
        let copy = IndependentPhotoCopy { source_id: text(&accepted,"id").unwrap().into(), source_version: text(&accepted,"version").unwrap().into(), target_id: target.clone() };
        let destination = temp.0.join("independent"); let imported = clone_project_with_photos(&source,&destination,"Independent".into(),document,vec![copy]).unwrap();
        let local = &imported.document["photoDocuments"][&target]; let working = &imported.document["photoDocuments"][text(&draft,"id").unwrap()];
        assert_ne!(local["id"],working["id"]); assert_ne!(local["version"],working["version"]);
        for (original,copied) in [(&accepted,local),(&draft,working)] {
            let original_doc = photocraft_format::load_path(Path::new(text(original,"bundlePath").unwrap())).unwrap();
            let copied_doc = photocraft_format::load_path(Path::new(text(copied,"bundlePath").unwrap())).unwrap();
            assert_eq!(photocraft_compose::thumbnail(&original_doc,2048).pixels,photocraft_compose::thumbnail(&copied_doc,2048).pixels);
            assert_eq!(original_doc.walk().len(),copied_doc.walk().len());
            assert!(Path::new(text(copied,"bundlePath").unwrap()).starts_with(&destination)); assert!(copied["originalPath"].is_null());
        }
        std::fs::remove_file(text(local,"previewPath").unwrap()).unwrap(); assert!(Path::new(text(&accepted,"previewPath").unwrap()).exists());
        assert!(Path::new(text(working,"previewPath").unwrap()).exists());
    }

    #[test]
    fn independent_image_copy_refuses_collisions_changed_versions_and_missing_originals_atomically() {
        let temp = temp(); let source = temp.0.join("source"); let accepted = image(&source,&engine(),None);
        let target = ulid::Ulid::new().to_string(); let mut alias = accepted.clone(); alias["id"] = json!(target);
        let mut document = project(); document["photoDocuments"][&target] = alias;
        let copy = IndependentPhotoCopy { source_id: text(&accepted,"id").unwrap().into(),source_version: text(&accepted,"version").unwrap().into(),target_id: target.clone() };
        let mut same = copy.clone(); same.target_id = same.source_id.clone();
        let mut changed = copy.clone(); changed.source_version = ulid::Ulid::new().to_string();
        for (i,copies) in [vec![same],vec![copy.clone(),copy.clone()],vec![changed]].into_iter().enumerate() {
            let destination = temp.0.join(format!("refused-{i}")); assert!(clone_project_with_photos(&source,&destination,"Refused".into(),document.clone(),copies).is_err()); assert!(!destination.exists());
        }
        std::fs::remove_file(text(&accepted,"previewPath").unwrap()).unwrap(); let destination = temp.0.join("missing");
        assert!(clone_project_with_photos(&source,&destination,"Missing".into(),document,vec![copy]).is_err()); assert!(!destination.exists()); assert!(Path::new(text(&accepted,"bundlePath").unwrap()).exists());
    }

    #[test]
    fn independent_image_copy_wire_refuses_unknown_fields() {
        let id=ulid::Ulid::new().to_string(); let version=ulid::Ulid::new().to_string(); let target=ulid::Ulid::new().to_string();
        let mut value=json!({"sourceId":id,"sourceVersion":version,"targetId":target}); assert!(serde_json::from_value::<IndependentPhotoCopy>(value.clone()).is_ok());
        value["path"]=json!("/foreign/source.pcraft"); assert!(serde_json::from_value::<IndependentPhotoCopy>(value).is_err());
    }

    #[test]
    fn unsupported_shared_image_mapping_refuses_copy_without_publishing_a_destination() {
        let temp = temp(); let source = temp.0.join("source"); std::fs::create_dir_all(&source).unwrap();
        let destination = temp.0.join("refused"); let mut doc = project();
        doc["pencilDocument"] = json!({"roomImages":{"version":2,"bindings":[]}});
        assert!(clone_project(&source, &destination, "Refused".into(), doc).err().unwrap().contains("Unsupported"));
        assert!(!destination.exists());
    }

    #[test]
    fn shared_copy_keeps_layered_assets_independent_and_refuses_overwrite_or_missing_sources() {
        let temp = temp(); let source = temp.0.join("source"); let destination = temp.0.join("copy"); let engine = engine(); let photo = image(&source, &engine, None);
        let mut document = project(); document["photoDocuments"][text(&photo, "id").unwrap()] = photo.clone();
        let source_path = PathBuf::from(text(&photo, "bundlePath").unwrap()); let original = std::fs::read(&source_path).unwrap();
        assert!(clone_project(&source, &source, "Copy".into(), document.clone()).is_err());
        let copied = clone_project(&source, &destination, "Copy".into(), document.clone()).unwrap();
        let copy_path = PathBuf::from(text(&copied.document["photoDocuments"][text(&photo, "id").unwrap()], "bundlePath").unwrap());
        assert!(copy_path.starts_with(&destination)); assert_eq!(std::fs::read(&copy_path).unwrap(), original);
        assert!(clone_project(&source, &destination, "Copy".into(), document.clone()).is_err());
        std::fs::remove_file(&copy_path).unwrap(); assert_eq!(std::fs::read(&source_path).unwrap(), original);
        std::fs::remove_file(&source_path).unwrap(); let failed = temp.0.join("failed"); assert!(clone_project(&source, &failed, "Copy".into(), document).is_err()); assert!(!failed.exists());
    }

    #[test]
    fn portable_project_packages_shared_tile_snapshots_as_standard_pcraft_files() {
        let temp=temp();let source=temp.0.join("source");let engine=engine();let photo=image(&source,&engine,None);
        let path=Path::new(text(&photo,"bundlePath").unwrap());let bytes=std::fs::read(path).unwrap();std::fs::remove_file(path).unwrap();
        crate::xdesign_photo::bundle::write(path.parent().unwrap(),text(&photo,"version").unwrap(),&bytes).unwrap();
        let mut document=project();document["photoDocuments"][text(&photo,"id").unwrap()]=photo.clone();
        let archive=build_archive(&source,"Shared pixels".into(),document).unwrap();let destination=temp.0.join("restored");
        let imported=unpack_archive(&archive,&destination).unwrap();let restored=&imported.document["photoDocuments"][text(&photo,"id").unwrap()];
        let path=Path::new(text(restored,"bundlePath").unwrap());assert!(path.is_file());assert!(photocraft_format::load_path(path).is_ok());
        assert!(photocraft_format::load_path(Path::new(text(&photo,"bundlePath").unwrap())).is_ok());
    }

    #[test]
    fn portable_project_roundtrip_rebases_images_drafts_and_history_without_changing_originals() {
        let temp = temp(); let source = temp.0.join("source");
        let mut engine = engine();
        let parent = image(&source, &engine, None);
        let child = image(&source, &engine, None);
        engine.execute("layer.new.layer", json!({"name":"Draft edit"})).unwrap();
        let changed = image(&source, &engine, child["id"].as_str());
        let mut doc = project();
        doc["photoDocuments"][text(&parent,"id").unwrap()] = parent.clone();
        doc["photoDocuments"][text(&child,"id").unwrap()] = changed.clone();
        doc["photoDrafts"] = json!([{"id":child["id"],"shapeId":"image","source":"legacy","updatedAt":1,"trail":[{"parent":parent,"childId":child["id"],"layer":1,"past":[child],"future":[]}]}]);
        doc["pages"][0]["shapes"] = json!([{"id":"image","kind":"image","filePath":parent["previewPath"],"assetId":"old-local-id","photoDocumentId":parent["id"]}]);
        doc["photoSavePaths"][text(&parent,"id").unwrap()] = json!("/Users/me/Saved.psd");
        doc["photoResume"] = json!({"source":"legacy","placementId":"image","documentId":parent["id"]});
        let archive = build_archive(&source, "Layered project".into(), doc.clone()).unwrap();
        let destination = temp.0.join("new-project");
        let imported = unpack_archive(&archive, &destination).unwrap();
        assert!(imported.document.get("photoSavePaths").is_none() && imported.document.get("photoResume").is_none());
        let zip = ZipReader::new(&archive).unwrap();
        let mut manifest: Manifest = serde_json::from_slice(&zip.read_by_name("project.json", MAX_JSON).unwrap()).unwrap();
        assert!(manifest.document.get("photoSavePaths").is_none() && manifest.document.get("photoResume").is_none());
        manifest.document["photoSavePaths"] = doc["photoSavePaths"].clone();
        manifest.document["photoResume"] = doc["photoResume"].clone();
        let mut crafted = ZipWriter::new(); crafted.add("project.json", &serde_json::to_vec(&manifest).unwrap()).unwrap();
        for record in &manifest.files { crafted.add(&record.name, &zip.read_by_name(&record.name, record.bytes).unwrap()).unwrap(); }
        let crafted = unpack_archive(&crafted.finish().unwrap(), &temp.0.join("crafted")).unwrap().document;
        assert!(crafted.get("photoSavePaths").is_none() && crafted.get("photoResume").is_none());
        let cloned = clone_project(&source, &temp.0.join("clone"), "Clone".into(), doc.clone()).unwrap().document;
        assert!(cloned.get("photoSavePaths").is_none() && cloned.get("photoResume").is_none());
        assert_eq!(imported.name, "Layered project");
        let new_child = &imported.document["photoDocuments"][text(&child,"id").unwrap()];
        assert_eq!(new_child["version"], changed["version"]);
        assert_eq!(new_child["originalPath"], Value::Null);
        assert!(text(new_child,"bundlePath").unwrap().starts_with(destination.to_str().unwrap()));
        let reopened = photocraft_format::load_path(Path::new(text(new_child,"bundlePath").unwrap())).unwrap();
        assert!(reopened.walk().iter().any(|(_,_,layer)| layer.name == "Draft edit"));
        let history = &imported.document["photoDrafts"][0]["trail"][0]["past"][0];
        assert!(Path::new(text(history,"bundlePath").unwrap()).is_file());
        let link: Value = serde_json::from_slice(&std::fs::read(destination.join(text(&child,"id").unwrap()).join("contents.json")).unwrap()).unwrap();
        assert_eq!(link["parentVersion"], parent["version"]);
        assert_eq!(imported.document["pages"][0]["shapes"][0]["assetId"], Value::Null);
        assert!(Path::new(text(&parent,"bundlePath").unwrap()).is_file());
        assert_eq!(doc["photoDocuments"][text(&parent,"id").unwrap()]["originalPath"], "/old/source.psd");
    }

    #[test]
    fn embeds_linked_smart_sources_in_backup_without_mutating_the_live_bundle() {
        let temp = temp(); let source = temp.0.join("source"); let linked_file = temp.0.join("linked.pcraft");
        let mut engine = engine();
        engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        engine.execute("layer.smartObjects.convertToLinked", json!({"path":linked_file})).unwrap();
        let photo = image(&source, &engine, None); let mut doc = project();
        doc["photoDocuments"][text(&photo,"id").unwrap()] = photo.clone();
        let archive = build_archive(&source, "Linked".into(), doc).unwrap();
        std::fs::remove_file(&linked_file).unwrap();
        let imported = unpack_archive(&archive, &temp.0.join("imported")).unwrap();
        let photo = &imported.document["photoDocuments"][text(&photo,"id").unwrap()];
        let doc = photocraft_format::load_path(Path::new(text(photo,"bundlePath").unwrap())).unwrap();
        let smart = doc.walk().into_iter().find_map(|(_,_,layer)| if let LayerContent::Smart(smart)=&layer.content {Some(smart)} else {None}).unwrap();
        assert!(matches!(smart.source, SmartSource::Embedded { .. }));
        let (name, bytes) = photocraft_engine::smart_cmds::source_bytes(&doc.metadata,&smart.source).unwrap();
        assert!(photocraft_engine::smart_cmds::decode_source(&name,&bytes).is_ok());
        assert!(matches!(engine.active().unwrap().doc.walk()[0].2.content, LayerContent::Smart(ref s) if matches!(s.source,SmartSource::Linked { .. })));
    }

    #[test]
    fn legacy_resources_are_content_addressed_and_deduplicated() {
        let temp=temp(); let file=temp.0.join("image.png"); std::fs::write(&file,b"image bytes").unwrap();
        let mut doc=project(); doc["pages"][0]["shapes"]=json!([{"kind":"image","filePath":file},{"kind":"rect","fillImage":{"filePath":file,"assetId":"local"}}]);
        let archive=build_archive(&temp.0,"Legacy".into(),doc).unwrap();
        let zip=ZipReader::new(&archive).unwrap(); assert_eq!(zip.entries.len(),2);
        let imported=unpack_archive(&archive,&temp.0.join("imported")).unwrap();
        assert_eq!(imported.document["pages"][0]["shapes"][0]["filePath"],imported.document["pages"][0]["shapes"][1]["fillImage"]["filePath"]);
    }

    #[test]
    fn rejects_traversal_corruption_duplicates_and_future_versions_without_publishing_assets() {
        let temp=temp();
        for name in ["../outside","photos/../../outside","resources/../escape","/absolute","photos/not-an-id/contents.json"] { assert!(asset_relative(name).is_err()); }
        let mut zip=ZipWriter::new(); zip.add("project.json",b"{}").unwrap();zip.add("project.json",b"{}").unwrap();
        let dest=temp.0.join("duplicate"); assert!(unpack_archive(&zip.finish().unwrap(),&dest).is_err()); assert!(!dest.exists());
        let data=b"pixels"; let resource=format!("resources/{}.png",digest(data));
        for (version,hash) in [(2,digest(data)),(1,"wrong".into())] {
            let manifest=Manifest {format:"orion.xdesign".into(),version,name:"Bad".into(),document:project(),files:vec![FileRecord{name:resource.clone(),bytes:data.len(),sha256:hash}]};
            let mut zip=ZipWriter::new();zip.add("project.json",&serde_json::to_vec(&manifest).unwrap()).unwrap();zip.add(&resource,data).unwrap();
            let dest=temp.0.join(format!("bad-{version}"));assert!(unpack_archive(&zip.finish().unwrap(),&dest).is_err());assert!(!dest.exists());
        }
        assert!(!std::fs::read_dir(&temp.0).unwrap().any(|file| file.unwrap().file_name().to_string_lossy().starts_with(".import-")));
    }
}
