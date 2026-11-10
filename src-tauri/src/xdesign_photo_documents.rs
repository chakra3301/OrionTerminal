//! Image commands that open new images. The command runs in a throwaway session seeded from the pinned version, so
//! the source keeps its history and the resident session never holds a second document; each result is published as
//! its own photo with a fresh history.
use super::{color_settings, color_views, id, key, publish, reply, root, sessions, snapshot, tools, workspace_snapshot_with_history, PhotoReply, PhotoSession};
use photocraft_engine::{doc::Document, DocState, Session};
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Manager};

const COMMANDS: [&str; 4] = ["image.duplicate", "file.automate.cropAndStraightenPhotos", PHOTOMERGE, HDR];
const PHOTOMERGE: &str = "file.automate.photomerge";
const HDR: &str = "file.automate.mergeToHdrPro";
const MAX_SOURCES: usize = 64;

fn derive(state: DocState, color: &color_views::Snapshot, command: &str, mut params: Value) -> Result<(Session, Vec<Document>), String> {
    if !COMMANDS.contains(&command) { return Err("This operation does not create an image".into()); }
    if !params.is_object() || params.to_string().len() > 64 * 1024 { return Err("Invalid image operation parameters".into()); }
    let mut draft = Session::new();
    let seeds = if command == PHOTOMERGE || command == HDR { merge_sources(&mut draft, state, &mut params)? } else {
        draft.add_document((*state.doc).clone(), None);
        *draft.active_mut().ok_or("No image document")? = state;
        1
    };
    color.install(&mut draft)?;
    draft.execute(command, params).map_err(|e| e.to_string())?;
    let mut created: Vec<Document> = draft.documents()[seeds..].iter().map(|state| (*state.doc).clone()).collect();
    if created.is_empty() { return Err("The operation created no image".into()); }
    if created.iter().any(|doc| doc.size.width == 0 || doc.size.height == 0 || u64::from(doc.size.width) * u64::from(doc.size.height) > super::MAX_PIXELS) {
        return Err("The result exceeds the 256 megapixel editing limit".into());
    }
    // The engine numbers results after the sources it was handed; Photoshop numbers its first result 1.
    if command == PHOTOMERGE || command == HDR { for doc in &mut created { doc.name = if command == PHOTOMERGE { "Untitled_Panorama1" } else { "Untitled_HDR1" }.into(); } }
    Ok((draft, created))
}

/// Opens the merge sources into the draft so the engine never reads a path itself: the current image when
/// `useOpenDocuments` is set, then each chosen file, read with the import limits. Returns how many were opened.
fn merge_sources(draft: &mut Session, state: DocState, params: &mut Value) -> Result<usize, String> {
    let current = params.get("useOpenDocuments").and_then(Value::as_bool).unwrap_or(false);
    if params.get("input").is_some() { return Err("Choose image files for the merge".into()); }
    let paths: Vec<String> = match params.get("paths") {
        None => Vec::new(),
        Some(Value::Array(paths)) => paths.iter().map(|path| path.as_str().map(str::to_string).ok_or("Invalid image file path")).collect::<Result<_, _>>()?,
        Some(_) => return Err("Choose image files for the merge, not a folder".into()),
    };
    let count = paths.len() + usize::from(current);
    if count < 2 { return Err("Choose at least two images to merge".into()); }
    if count > MAX_SOURCES { return Err(format!("Choose at most {MAX_SOURCES} images to merge")); }
    if current {
        draft.add_document((*state.doc).clone(), None);
        *draft.active_mut().ok_or("No image document")? = state;
    }
    for path in &paths {
        let path = Path::new(path);
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("image");
        if !std::fs::metadata(path).map_err(|e| format!("{name}: {e}"))?.is_file() { return Err(format!("{name} is not an image file")); }
        let document = super::import_image_path(path, None).map_err(|e| format!("{name}: {e}"))?.document;
        if document.size.width == 0 || document.size.height == 0 || u64::from(document.size.width) * u64::from(document.size.height) > super::MAX_PIXELS {
            return Err(format!("{name} exceeds the 256 megapixel editing limit"));
        }
        draft.add_document(document, None);
    }
    let options = params.as_object_mut().ok_or("Invalid image operation parameters")?;
    options.remove("paths");
    options.insert("useOpenDocuments".into(), Value::Bool(true));
    Ok(count)
}

/// Every image is written before any becomes resident, so a failed write leaves the open images as they were.
fn open(assets: &Path, tool_dir: &Path, draft: &Session, created: Vec<Document>) -> Result<Vec<(String, PhotoSession, PhotoReply)>, String> {
    created.into_iter().map(|document| {
        let photo = ulid::Ulid::new().to_string();
        let mut engine = Session::new();
        engine.add_document(document, None);
        engine.color.settings = draft.color.settings.clone();
        tools::preview_settings(tool_dir, &mut engine)?;
        let mut session = PhotoSession { color_settings: color_settings::retain(&engine.color.settings), engine, version: String::new(), original_path: None, writer: Default::default() };
        let dir = assets.join(&photo);
        publish(&dir, &photo, &mut session)?;
        let response = reply(&dir, &photo, &session, Vec::new())?;
        Ok((photo, session, response))
    }).collect()
}

pub(super) async fn run(app: AppHandle, project_id: String, photo_id: String, version: String, command: String, params: Value) -> Result<Vec<PhotoReply>, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let (state, color) = workspace_snapshot_with_history(&dir, &project_id, &photo_id, &version, snapshot::HistoryPolicy::Discard)?;
        let (draft, created) = derive(state, &color, &command, params)?;
        let opened = open(&data.join("assets").join("xdesign").join(&project_id), &data.join("xdesign-tools"), &draft, created)?;
        let mut cache = sessions().lock().map_err(|_| "Image engine needs to be restarted")?;
        Ok(opened.into_iter().map(|(photo, session, response)| { cache.insert(key(&project_id, &photo), session); response }).collect())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Directory(std::path::PathBuf);
    impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

    fn source() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"name": "Portrait", "width": 240, "height": 160, "background": "white"})).unwrap();
        engine.execute("layer.new.layer", json!({"name": "Ink"})).unwrap();
        for (x, y) in [(20, 30), (140, 70)] {
            engine.execute("select.rect", json!({"x": x, "y": y, "width": 70, "height": 50})).unwrap();
            engine.execute("edit.fill", json!({"color": "#204080"})).unwrap();
        }
        engine.execute("select.deselect", json!({})).unwrap();
        engine
    }

    fn derived(engine: &Session, command: &str, params: Value) -> Result<(Session, Vec<Document>), String> {
        derive(snapshot::capture(engine.active().unwrap(), snapshot::HistoryPolicy::Discard), &color_views::Snapshot::capture(engine).unwrap(), command, params)
    }

    #[test]
    fn new_image_commands_stay_out_of_the_single_image_command() {
        for command in COMMANDS { assert!(!super::super::command_supported(command), "{command}"); }
        assert!(derived(&source(), "image.imageSize", json!({"width": 10, "height": 10})).is_err());
    }

    #[test]
    fn duplicate_copies_the_image_under_the_new_name_without_touching_the_source() {
        let engine = source();
        let before = engine.active().unwrap().doc.clone();
        let (_, copies) = derived(&engine, "image.duplicate", json!({"name": "Portrait copy", "mergedOnly": false})).unwrap();
        assert_eq!(copies.len(), 1);
        assert_eq!((copies[0].name.as_str(), copies[0].layers.len()), ("Portrait copy", 2));
        assert!(copies[0].layers.iter().zip(&before.layers).all(|(copy, layer)| copy.id != layer.id && copy.name == layer.name));
        let (_, merged) = derived(&engine, "image.duplicate", json!({"name": "Flat", "mergedOnly": true})).unwrap();
        assert_eq!(merged[0].layers.iter().map(|layer| layer.name.as_str()).collect::<Vec<_>>(), ["Background"]);
        assert!(std::sync::Arc::ptr_eq(&before, &engine.active().unwrap().doc));
    }

    #[test]
    fn crop_and_straighten_publishes_each_photo_with_a_fresh_history() {
        let (assets, tools) = (Directory(std::env::temp_dir().join(format!("xdesign-new-images-{}", ulid::Ulid::new()))), Directory(std::env::temp_dir().join(format!("xdesign-new-image-tools-{}", ulid::Ulid::new()))));
        let (draft, photos) = derived(&source(), "file.automate.cropAndStraightenPhotos", json!({})).unwrap();
        assert_eq!(photos.len(), 2);
        assert!(photos.iter().all(|photo| photo.size.width.abs_diff(70) <= 3 && photo.size.height.abs_diff(50) <= 3), "{:?}", photos.iter().map(|photo| photo.size).collect::<Vec<_>>());
        let opened = open(&assets.0, &tools.0, &draft, photos).unwrap();
        assert_eq!(opened.iter().map(|(_, _, reply)| reply.document.name.as_str()).collect::<Vec<_>>(), ["Portrait copy 1", "Portrait copy 2"]);
        for (photo, session, reply) in &opened {
            assert_eq!(&reply.document.id, photo);
            assert!(Path::new(&reply.document.bundle_path).starts_with(assets.0.join(photo)) && Path::new(&reply.document.bundle_path).exists());
            assert_eq!((session.engine.documents().len(), session.engine.active().unwrap().history.past_len()), (1, 0));
            assert!(session.engine.journal.is_empty());
        }
        let mut blank = Session::new();
        blank.execute("file.new", json!({"width": 64, "height": 64, "background": "white"})).unwrap();
        assert!(derived(&blank, "file.automate.cropAndStraightenPhotos", json!({})).is_err());
    }

    /// A textured scene and two overlapping crops of it written as PNG files.
    fn crops(dir: &Path) -> (Session, Vec<String>) {
        let mut scene = Session::new();
        scene.execute("file.new", json!({"name": "Scene", "width": 360, "height": 160, "background": "white"})).unwrap();
        let mut seed = 7u32;
        let mut next = |range: u32| { seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345); (seed >> 8) % range };
        for _ in 0..140 {
            let (x, y, size) = (next(350), next(150), 4 + next(14));
            scene.execute("select.rect", json!({"x": x, "y": y, "width": size, "height": size})).unwrap();
            scene.execute("edit.fill", json!({"color": format!("#{:06x}", next(0xff_ffff))})).unwrap();
        }
        scene.execute("select.deselect", json!({})).unwrap();
        let paths = [0, 140].iter().map(|x| {
            let mut crop = Session::new();
            crop.add_document((*scene.active().unwrap().doc).clone(), None);
            crop.execute("image.crop", json!({"x": x, "y": 0, "width": 220, "height": 160})).unwrap();
            let path = dir.join(format!("crop-{x}.png"));
            std::fs::write(&path, photocraft_io::export(&crop.active().unwrap().doc, "png", &Default::default()).unwrap().bytes).unwrap();
            path.to_string_lossy().into_owned()
        }).collect();
        (scene, paths)
    }

    #[test]
    fn photomerge_opens_the_chosen_files_and_publishes_one_panorama() {
        let dir = Directory(std::env::temp_dir().join(format!("xdesign-merge-{}", ulid::Ulid::new())));
        std::fs::create_dir_all(&dir.0).unwrap();
        let (scene, paths) = crops(&dir.0);
        let before = scene.active().unwrap().doc.clone();
        let (_, panoramas) = derived(&scene, PHOTOMERGE, json!({"paths": paths, "layout": "reposition"})).unwrap();
        assert_eq!(panoramas.len(), 1);
        assert_eq!(panoramas[0].name, "Untitled_Panorama1");
        assert!(panoramas[0].size.width.abs_diff(360) <= 4 && panoramas[0].size.height.abs_diff(160) <= 4, "{:?}", panoramas[0].size);
        assert_eq!(panoramas[0].layers.len(), 2);
        assert!(std::sync::Arc::ptr_eq(&before, &scene.active().unwrap().doc));
        let (_, hdr) = derived(&scene, HDR, json!({"paths": [paths[0], paths[0]], "mode": "8", "exposures": [0, 1]})).unwrap();
        assert_eq!((hdr[0].name.as_str(), hdr[0].size.width, hdr[0].size.height), ("Untitled_HDR1", 220, 160));
    }

    #[test]
    fn merges_refuse_too_few_sources_folders_and_oversized_files() {
        let dir = Directory(std::env::temp_dir().join(format!("xdesign-merge-refuse-{}", ulid::Ulid::new())));
        std::fs::create_dir_all(dir.0.join("folder")).unwrap();
        let (scene, paths) = crops(&dir.0);
        let folder = dir.0.join("folder").to_string_lossy().into_owned();
        let oversized = dir.0.join("huge.png");
        std::fs::File::create(&oversized).unwrap().set_len(super::super::MAX_INPUT_BYTES + 1).unwrap();
        let error = |command: &str, params: Value| derived(&scene, command, params).err().expect("refused");
        for command in [PHOTOMERGE, HDR] {
            assert!(error(command, json!({"paths": [paths[0]]})).contains("at least two"));
            assert!(error(command, json!({"useOpenDocuments": true})).contains("at least two"));
            assert!(error(command, json!({"paths": vec![paths[0].clone(); MAX_SOURCES + 1]})).contains("at most 64"));
            assert!(error(command, json!({"paths": folder})).contains("not a folder"));
            assert!(error(command, json!({"input": folder, "useOpenDocuments": true})).contains("image files"));
            assert!(error(command, json!({"paths": [paths[0], folder]})).contains("folder is not an image file"));
            assert!(error(command, json!({"paths": [paths[0], oversized.to_string_lossy()]})).contains("512MB"));
            assert!(error(command, json!({"paths": [paths[0], dir.0.join("missing.png").to_string_lossy()]})).contains("missing.png"));
        }
        // The current image counts as a source with Add Open Files.
        let (_, merged) = derived(&scene, PHOTOMERGE, json!({"paths": [paths[0]], "useOpenDocuments": true, "layout": "reposition"})).unwrap();
        assert_eq!(merged.len(), 1);
    }
}
