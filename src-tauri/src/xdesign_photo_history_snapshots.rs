//! History panel snapshots, which the pinned engine doesn't keep. Like Photoshop's they last only while the image is
//! open: the store follows the resident session and is dropped when the session cache evicts it.
use photocraft_engine::{
    doc::{Document, LayerId},
    Session,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

pub(super) const COMMANDS: [&str; 4] = ["history.snapshot.new", "history.snapshot.select", "history.snapshot.rename", "history.snapshot.delete"];
const MAX_SNAPSHOTS: usize = 100;
/// The layer thumbnails' size, so snapshot rows match the Layers panel.
const THUMBNAIL_SIZE: u32 = 56;

struct Snapshot {
    id: String,
    name: String,
    doc: Arc<Document>,
    active: Option<LayerId>,
    thumbnail: Option<String>,
}

#[derive(Default)]
struct Store {
    items: Vec<Snapshot>,
    created: usize,
    /// The snapshot last chosen and the revision it left, so the row stays selected until the image changes.
    selected: Option<(String, u64)>,
    /// The Open row's thumbnail and the History Brush identity of the state it shows, so refreshes reuse it.
    opening: Option<(String, Option<String>)>,
}

fn stores() -> &'static Mutex<HashMap<String, Store>> {
    static STORES: OnceLock<Mutex<HashMap<String, Store>>> = OnceLock::new();
    STORES.get_or_init(Default::default)
}

/// Photo ids are ULIDs, so the photo part of a session cache key names one image across projects.
pub(super) fn forget(cache_key: &str) {
    let photo = cache_key.rsplit('/').next().unwrap_or(cache_key);
    if let Ok(mut stores) = stores().lock() {
        stores.remove(photo);
    }
}

/// Snapshot rows, oldest first. `source` is the History Brush identity of the snapshot's image, shared with the
/// History state it was taken from while that state is still listed.
pub(super) fn describe(engine: &Session, photo: &str) -> Value {
    let Ok(stores) = stores().lock() else { return json!([]) };
    let Some(store) = stores.get(photo) else { return json!([]) };
    let revision = engine.active().map(|state| state.revision);
    json!(store
        .items
        .iter()
        .map(|item| json!({
            "id": item.id,
            "name": item.name,
            "source": super::history::snapshot_id(&item.doc),
            "current": store.selected.as_ref().is_some_and(|(id, at)| *id == item.id && Some(*at) == revision),
            "thumbnail": item.thumbnail,
        }))
        .collect::<Vec<_>>())
}

/// The Open row's thumbnail: the image as opened, while that state is still retained.
pub(super) fn opening(engine: &Session, photo: &str) -> Value {
    let Some(state) = engine.active() else { return Value::Null };
    if state.history.entries().first().map(String::as_str) != Some("Open") {
        return Value::Null;
    }
    let Some(doc) = (if state.history.past_len() == 0 { Some(state.doc.clone()) } else { state.history.state(0) }) else { return Value::Null };
    let Ok(mut stores) = stores().lock() else { return Value::Null };
    let store = stores.entry(photo.to_owned()).or_default();
    let source = super::history::snapshot_id(&doc);
    if store.opening.as_ref().is_none_or(|(id, _)| *id != source) {
        store.opening = Some((source, thumbnail(&doc)));
    }
    json!(store.opening.as_ref().and_then(|(_, thumbnail)| thumbnail.as_deref()))
}

fn thumbnail(doc: &Document) -> Option<String> {
    let image = photocraft_compose::thumbnail(doc, THUMBNAIL_SIZE);
    super::tiles::png(image.width, image.height, image.pixels).ok()
}

/// The name New Snapshot gives when none is typed, which its dialog offers.
pub(super) fn next_name(photo: &str) -> String {
    format!("Snapshot {}", stores().lock().ok().and_then(|stores| stores.get(photo).map(|store| store.created)).unwrap_or(0) + 1)
}

pub(super) fn execute(engine: &mut Session, photo: &str, command: &str, params: &Value) -> Option<Result<Value, String>> {
    COMMANDS.contains(&command).then(|| {
        if engine.active_job().is_some() {
            return Err("Wait for the current image operation to finish".into());
        }
        let mut stores = stores().lock().map_err(|_| "Image engine needs to be restarted")?;
        let store = stores.entry(photo.to_owned()).or_default();
        match command {
            "history.snapshot.new" => create(engine, store, params),
            "history.snapshot.select" => select(engine, store, params),
            "history.snapshot.rename" => {
                let name = name(params)?;
                find(store, params)?.name = name;
                Ok(Value::Bool(true))
            }
            _ => {
                let id = find(store, params)?.id.clone();
                store.items.retain(|item| item.id != id);
                Ok(Value::Bool(true))
            }
        }
    })
}

fn name(params: &Value) -> Result<String, String> {
    let name = params["name"].as_str().map(str::trim).ok_or("The snapshot needs a name")?;
    if name.is_empty() || name.chars().count() > 255 {
        return Err("Snapshot names are 1 to 255 characters".into());
    }
    Ok(name.to_owned())
}

fn find<'a>(store: &'a mut Store, params: &Value) -> Result<&'a mut Snapshot, String> {
    let id = params["id"].as_str().ok_or("Choose a snapshot")?;
    store.items.iter_mut().find(|item| item.id == id).ok_or_else(|| "The snapshot no longer exists".into())
}

/// Photoshop's New Snapshot dialog: From Full Document, Merged Layers or Current Layer.
fn create(engine: &Session, store: &mut Store, params: &Value) -> Result<Value, String> {
    if store.items.len() >= MAX_SNAPSHOTS {
        return Err(format!("An image keeps up to {MAX_SNAPSHOTS} snapshots; delete one first"));
    }
    let state = engine.active().ok_or("No image document")?;
    let name = if params.get("name").is_some_and(|value| !value.is_null()) { name(params)? } else { format!("Snapshot {}", store.created + 1) };
    let (doc, active) = match params["from"].as_str().unwrap_or("document") {
        "document" => (state.doc.clone(), state.active_layer),
        "merged" => {
            let mut visible = (*state.doc).clone();
            visible.layers.retain(|layer| layer.visible);
            if visible.layers.is_empty() {
                return Err("There are no visible layers to merge".into());
            }
            let mut draft = Session::new();
            draft.add_document(visible, None);
            if draft.active().is_some_and(|state| state.doc.layers.len() > 1 || state.doc.layers[0].is_group()) {
                draft.execute("layer.mergeVisible", json!({})).map_err(|error| error.to_string())?;
            }
            let state = draft.active().ok_or("No image document")?;
            (state.doc.clone(), state.active_layer)
        }
        "layer" => {
            let id = state.active_layer.ok_or("Select a layer for the snapshot")?;
            let mut solo = (*state.doc).clone();
            solo.layers = vec![state.doc.layer(id).ok_or("Select a layer for the snapshot")?.clone()];
            (Arc::new(solo), Some(id))
        }
        other => return Err(format!("Unknown snapshot source \"{other}\"")),
    };
    let id = ulid::Ulid::new().to_string();
    let thumbnail = thumbnail(&doc);
    store.created += 1;
    store.items.push(Snapshot { id: id.clone(), name: name.clone(), doc, active, thumbnail });
    Ok(json!({"id": id, "name": name}))
}

/// Photoshop reverts to a snapshot without a History state; here it is one undoable step named after the snapshot,
/// and the states before it stay listed.
fn select(engine: &mut Session, store: &mut Store, params: &Value) -> Result<Value, String> {
    let snapshot = find(store, params)?;
    let (id, label, source, active) = (snapshot.id.clone(), snapshot.name.clone(), snapshot.doc.clone(), snapshot.active);
    let state = engine.active().ok_or("No image document")?;
    let showing = store.selected.as_ref().is_some_and(|(selected, at)| *selected == id && *at == state.revision);
    let changed = !showing && !Arc::ptr_eq(&state.doc, &source);
    if changed {
        engine
            .edit(&label, |doc, layer| {
                let document = doc.id;
                *doc = (*source).clone();
                doc.id = document;
                *layer = active.filter(|id| doc.layer(*id).is_some()).or_else(|| doc.top_layer());
                Ok(())
            })
            .map_err(|error| error.to_string())?;
    }
    let revision = engine.active().ok_or("No image document")?.revision;
    store.selected = Some((id, revision));
    Ok(Value::Bool(changed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image() -> (Session, String) {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"name": "Snap", "width": 16, "height": 16, "background": "white"})).unwrap();
        (engine, ulid::Ulid::new().to_string())
    }
    fn run(engine: &mut Session, photo: &str, command: &str, params: Value) -> Result<Value, String> {
        execute(engine, photo, command, &params).expect("snapshot command")
    }
    fn pixel(engine: &Session) -> f32 {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(4, 4)[0]
    }

    #[test]
    fn snapshots_are_named_rows_that_revert_the_image_in_one_step() {
        let (mut engine, photo) = image();
        let past = engine.active().unwrap().history.past_len();
        let first = run(&mut engine, &photo, "history.snapshot.new", json!({})).unwrap();
        assert_eq!(first["name"], "Snapshot 1");
        assert_eq!(past, engine.active().unwrap().history.past_len(), "a snapshot is not a History state");
        engine.execute("edit.fill", json!({"color": "#000000"})).unwrap();
        let rows = describe(&engine, &photo);
        assert_eq!(rows[0]["current"], false);
        assert_eq!(rows[0]["source"], json!(super::super::history::snapshot_id(&engine.active().unwrap().history.state(past).unwrap())));
        assert_eq!(pixel(&engine), 0.0);
        assert_eq!(run(&mut engine, &photo, "history.snapshot.select", json!({"id": first["id"]})).unwrap(), true);
        assert_eq!(pixel(&engine), 1.0);
        let history = &engine.active().unwrap().history;
        assert_eq!((history.past_len(), history.undo_label()), (past + 2, Some("Snapshot 1")));
        assert_eq!(describe(&engine, &photo)[0]["current"], true);
        assert_eq!(run(&mut engine, &photo, "history.snapshot.select", json!({"id": first["id"]})).unwrap(), false, "already showing it");
        engine.undo();
        assert_eq!(pixel(&engine), 0.0);
        assert_eq!(describe(&engine, &photo)[0]["current"], false);
    }

    #[test]
    fn the_open_row_keeps_the_image_as_opened() {
        let (mut engine, photo) = image();
        let first = opening(&engine, &photo);
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, first.as_str().unwrap()).unwrap();
        assert_eq!(photocraft_codecs::decode(&bytes).unwrap().data()[..4], [255, 255, 255, 255]);
        engine.execute("edit.fill", json!({"color": "#000000"})).unwrap();
        assert_eq!(opening(&engine, &photo), first);
        assert_eq!(opening(&engine, "another photo"), first, "the store is only a cache");
        engine.active_mut().unwrap().history.clear();
        assert_eq!(opening(&engine, &photo), Value::Null, "the opening state is gone");
    }

    #[test]
    fn names_rename_delete_and_forget() {
        let (mut engine, photo) = image();
        run(&mut engine, &photo, "history.snapshot.new", json!({})).unwrap();
        let second = run(&mut engine, &photo, "history.snapshot.new", json!({"name": "  Before grading "})).unwrap();
        assert_eq!(second["name"], "Before grading");
        assert_eq!(next_name(&photo), "Snapshot 3");
        assert_eq!(run(&mut engine, &photo, "history.snapshot.new", json!({})).unwrap()["name"], "Snapshot 3");
        run(&mut engine, &photo, "history.snapshot.rename", json!({"id": second["id"], "name": "Graded"})).unwrap();
        assert!(run(&mut engine, &photo, "history.snapshot.rename", json!({"id": second["id"], "name": " "})).is_err());
        assert_eq!(describe(&engine, &photo).as_array().unwrap().iter().map(|row| row["name"].as_str().unwrap().to_owned()).collect::<Vec<_>>(), ["Snapshot 1", "Graded", "Snapshot 3"]);
        run(&mut engine, &photo, "history.snapshot.delete", json!({"id": second["id"]})).unwrap();
        assert!(run(&mut engine, &photo, "history.snapshot.select", json!({"id": second["id"]})).is_err());
        assert_eq!(describe(&engine, &photo).as_array().unwrap().len(), 2);
        assert_eq!(describe(&engine, "another photo"), json!([]));
        forget(&format!("project/{photo}"));
        assert_eq!(describe(&engine, &photo), json!([]));
        assert!(execute(&mut engine, &photo, "history.select", &json!({})).is_none());
        assert!(COMMANDS.iter().all(|command| super::super::command_supported(command)));
    }

    #[test]
    fn merged_and_current_layer_snapshots() {
        let (mut engine, photo) = image();
        engine.execute("layer.new.layer", json!({})).unwrap();
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 8, "height": 16})).unwrap();
        engine.execute("edit.fill", json!({"color": "#000000"})).unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        let layers = engine.active().unwrap().doc.layers.len();
        let merged = run(&mut engine, &photo, "history.snapshot.new", json!({"from": "merged"})).unwrap();
        let layer = run(&mut engine, &photo, "history.snapshot.new", json!({"from": "layer"})).unwrap();
        assert!(run(&mut engine, &photo, "history.snapshot.new", json!({"from": "nowhere"})).is_err());
        run(&mut engine, &photo, "history.snapshot.select", json!({"id": merged["id"]})).unwrap();
        let doc = engine.active().unwrap().doc.clone();
        assert_eq!(doc.layers.len(), 1);
        assert_eq!(photocraft_compose::flatten(&doc).px[4 * 16 + 12], [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(pixel(&engine), 0.0);
        run(&mut engine, &photo, "history.snapshot.select", json!({"id": layer["id"]})).unwrap();
        let doc = engine.active().unwrap().doc.clone();
        assert_eq!(doc.layers.len(), 1);
        assert_eq!(doc.layers[0].surface().unwrap().rgba(12, 4)[3], 0.0, "only the painted layer");
        let thumbnail = |row: &Value| {
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, row["thumbnail"].as_str().unwrap()).unwrap();
            let image = photocraft_codecs::decode(&bytes).unwrap();
            let data = image.data().to_vec();
            (image.width(), [data[3], data[data.len() - 1]])
        };
        let rows = describe(&engine, &photo);
        assert_eq!(thumbnail(&rows[0]), (16, [255, 255]), "the merged image is opaque, and small images are not enlarged");
        assert_eq!(thumbnail(&rows[1]), (16, [255, 0]), "the layer alone is clear where it is unpainted");
        engine.undo();
        engine.undo();
        assert_eq!(engine.active().unwrap().doc.layers.len(), layers);
    }
}
