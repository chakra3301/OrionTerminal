use photocraft_engine::{doc::{Layer, LayerContent, LayerId, Metadata, SmartObject, SmartSource}, Session};
use serde_json::Value;
use std::sync::Arc;

const COMMANDS: [&str; 5] = [
    "edit.transform.rotate180",
    "edit.transform.rotate90Cw",
    "edit.transform.rotate90Ccw",
    "edit.transform.flipHorizontal",
    "edit.transform.flipVertical",
];

fn collect(layer: &Layer, ids: &mut Vec<LayerId>) {
    if matches!(layer.content, LayerContent::Smart(_)) { ids.push(layer.id); }
    if let Some(children) = layer.children() { for child in children { collect(child, ids); } }
}

fn targets(engine: &Session) -> Option<Vec<LayerId>> {
    let state = engine.active()?;
    let mut ids = Vec::new();
    collect(state.doc.layer(state.active_layer?)?, &mut ids);
    if ids.is_empty() { None } else { Some(ids) }
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if !COMMANDS.contains(&command) || !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    targets(engine)?;
    Some(run_with(engine, command, params, |_, metadata, smart| {
        super::super::smart::source_bytes_checked(metadata, &smart.source, || Ok(()))
    }))
}

pub(super) fn run_with(engine: &mut Session, command: &str, params: &Value,
    mut resolve: impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    if !COMMANDS.contains(&command) || !(params.is_object() || params.is_null()) {
        return engine.execute(command, params.clone()).map_err(|error| error.to_string());
    }
    if let Some(reason) = engine.disabled_reason(command) {
        return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string());
    }
    let Some(ids) = targets(engine) else { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); };
    let (result, scratch, inner, outer) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let original = engine.active().ok_or("No image document")?;
        let mut scratch = super::warp::scratch(engine, "Checked Smart transform preset")?;
        let empty = Arc::new(Vec::new());
        for id in &ids {
            let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut scratch.active_mut().ok_or("No preset document")?.doc).layer_mut(*id).ok_or("No preset layer")?.content else {
                return Err("The preset layer changed type".into());
            };
            smart.source = SmartSource::Embedded { file_name: String::new(), bytes: empty.clone() };
        }
        let result = scratch.execute(command, params.clone()).map_err(|error| error.to_string())?;
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No transformed document")?.doc);
        for id in &ids {
            let LayerContent::Smart(before) = &original.doc.layer(*id).ok_or("No original Smart Object")?.content else {
                return Err("The original Smart Object changed type".into());
            };
            let LayerContent::Smart(after) = &mut doc.layer_mut(*id).ok_or("No transformed Smart Object")?.content else {
                return Err("The transformed Smart Object changed type".into());
            };
            after.source = before.source.clone();
        }
        for id in &ids { super::warp::refresh_with(doc, *id, false, &mut resolve)?; }
        let [inner, outer] = scratch.journal.as_slice() else { return Err("The native preset journal changed".into()); };
        if inner.0 != "edit.transform" || outer.0 != command || outer.1 != *params {
            return Err("The native preset journal changed".into());
        }
        let (inner, outer) = (inner.clone(), outer.clone());
        Ok::<_, String>((result, scratch, inner, outer))
    })).map_err(|_| super::warp::internal_error(command))??;
    // Native presets nest a fresh transform dispatch: outer coalescing/target fields
    // never reach that edit, but both invocation entries remain replayable.
    super::warp::commit(engine, scratch, &inner.0, "Free Transform", &inner.1, &ids)?;
    engine.journal.push(outer);
    Ok(result)
}

#[cfg(test)]
#[path = "xdesign_photo_linked_presets_tests.rs"]
mod tests;
