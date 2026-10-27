//! Image commands that open new images. The command runs in a throwaway session seeded from the pinned version, so
//! the source keeps its history and the resident session never holds a second document; each result is published as
//! its own photo with a fresh history.
use super::{color_settings, color_views, id, key, publish, reply, root, sessions, snapshot, tools, workspace_snapshot_with_history, PhotoReply, PhotoSession};
use photocraft_engine::{doc::Document, DocState, Session};
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Manager};

const COMMANDS: [&str; 2] = ["image.duplicate", "file.automate.cropAndStraightenPhotos"];

fn derive(state: DocState, color: &color_views::Snapshot, command: &str, params: Value) -> Result<(Session, Vec<Document>), String> {
    if !COMMANDS.contains(&command) { return Err("This operation does not create an image".into()); }
    if !params.is_object() || params.to_string().len() > 64 * 1024 { return Err("Invalid image operation parameters".into()); }
    let mut draft = Session::new();
    draft.add_document((*state.doc).clone(), None);
    *draft.active_mut().ok_or("No image document")? = state;
    color.install(&mut draft)?;
    draft.execute(command, params).map_err(|e| e.to_string())?;
    let created: Vec<Document> = draft.documents()[1..].iter().map(|state| (*state.doc).clone()).collect();
    if created.is_empty() { return Err("The operation created no image".into()); }
    Ok((draft, created))
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
}
