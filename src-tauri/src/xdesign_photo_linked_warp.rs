use photocraft_engine::{doc::{Document, Layer, LayerContent, LayerId, Metadata, SmartObject, SmartSource}, Session};
use serde_json::{json, Value};
use std::sync::Arc;

#[path = "xdesign_photo_linked_warp_mesh.rs"]
mod mesh;

#[path = "xdesign_photo_warp_gray.rs"]
mod gray;
#[path = "xdesign_photo_warp_apply.rs"]
mod gray_apply;

const APPLY: [&str; 2] = ["edit.transform.warp", "layer.smartObjects.warp"];

pub(super) fn internal_error(command: &str) -> String {
    format!("`{command}` failed with an internal error (logged); the document is unchanged")
}

fn collect(layer: &Layer, ids: &mut Vec<LayerId>) {
    if matches!(layer.content, LayerContent::Smart(_)) { ids.push(layer.id); }
    if let Some(children) = layer.children() { for child in children { collect(child, ids); } }
}

fn targets(engine: &Session, params: &Value) -> Option<Vec<LayerId>> {
    let state = engine.active()?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)?;
    let mut ids = Vec::new();
    let layer = state.doc.layer(id)?;
    collect(layer, &mut ids);
    if ids.is_empty() && !gray_apply::needed(&state.doc, layer) { None } else { Some(ids) }
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if !APPLY.contains(&command) { return mesh::execute(engine, command, params); }
    if !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    targets(engine, params)?;
    Some(run_with(engine, command, params, |_, metadata, smart| {
        super::super::smart::source_bytes_checked(metadata, &smart.source, || Ok(()))
    }))
}

fn run_with(engine: &mut Session, command: &str, params: &Value,
    mut resolve: impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    if !APPLY.contains(&command) || !(params.is_object() || params.is_null()) {
        return engine.execute(command, params.clone()).map_err(|error| error.to_string());
    }
    if let Some(reason) = engine.disabled_reason(command) {
        return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string());
    }
    let Some(ids) = targets(engine, params) else { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); };
    let (result, prepared) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let original = engine.active().ok_or("No image document")?;
        let mut scratch = scratch(engine, "Checked Smart warp")?;
        let gray = gray_apply::prepare(&mut scratch, command, params)?;
        let native_params = gray.as_ref().map(|prepared| prepared.native_params()).unwrap_or_else(|| params.clone());
        let empty = Arc::new(Vec::new());
        let state = scratch.active_mut().ok_or("No warp document")?;
        for id in &ids {
            let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut state.doc).layer_mut(*id).ok_or("No warp layer")?.content else {
                return Err("The warp layer changed type".into());
            };
            // An invalid Embedded source also suppresses empty-UUID linked metadata fallback.
            smart.source = SmartSource::Embedded { file_name: String::new(), bytes: empty.clone() };
        }
        let result = scratch.execute(command, native_params).map_err(|error| error.to_string())?;
        if result.get("changed").and_then(Value::as_bool) == Some(false) { return Ok((result, None)); }
        if let Some(gray) = gray {
            gray.finish(&mut scratch, command)?;
            scratch.active_mut().ok_or("No completed gray warp document")?.channel_view = original.channel_view.clone();
        }
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No warped document")?.doc);
        for id in &ids {
            let LayerContent::Smart(before) = &original.doc.layer(*id).ok_or("No original Smart Object")?.content else {
                return Err("The original Smart Object changed type".into());
            };
            let LayerContent::Smart(after) = &mut doc.layer_mut(*id).ok_or("No warped Smart Object")?.content else {
                return Err("The warped Smart Object changed type".into());
            };
            after.source = before.source.clone();
        }
        for id in &ids { refresh_with(doc, *id, false, &mut resolve)?; }
        Ok::<_, String>((result, Some(scratch)))
    })).map_err(|_| internal_error(command))??;
    if let Some(scratch) = prepared {
        commit(engine, scratch, command, "Warp", params, &ids)?;
        Ok(result)
    } else {
        // Native identity on a non-Smart target still owns posthooks/journaling, without an edit.
        engine.execute(command, params.clone()).map_err(|error| error.to_string())
    }
}

pub(super) fn scratch(engine: &Session, label: &str) -> Result<Session, String> {
    let original = engine.active().ok_or("No image document")?;
    let draft = super::super::snapshot::capture(original, super::super::snapshot::HistoryPolicy::Discard);
    let mut scratch = Session::new();
    scratch.add_document(Document::new(label, draft.doc.size, draft.doc.mode, draft.doc.depth), None);
    *scratch.active_mut().ok_or("No private warp document")? = draft;
    Ok(scratch)
}

pub(super) fn refresh_with(doc: &mut Document, id: LayerId, strict: bool,
    resolve: &mut impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<(), String> {
    let LayerContent::Smart(smart) = &doc.layer(id).ok_or("No Smart Object to refresh")?.content else {
        return Err("The Smart Object changed type".into());
    };
    let Some((file_name, bytes)) = resolve(id, &doc.metadata, smart)? else { return Ok(()); };
    let decoded = match smart.stack_mode {
        Some(mode) => photocraft_engine::smart_cmds::stack_image(&file_name, &bytes, doc.pixel_format(), mode),
        None => photocraft_engine::smart_cmds::source_image(&file_name, &bytes, doc.pixel_format()),
    };
    match decoded {
        Ok(image) => drop(image),
        Err(error) => return if strict { Err(error.to_string()) } else { Ok(()) },
    }
    super::admit(smart)?;
    let mut pinned = smart.clone();
    pinned.source = SmartSource::Embedded { file_name, bytes };
    match photocraft_engine::smart_cmds::render(doc, &pinned) {
        Ok(Some(pixels)) => {
            let LayerContent::Smart(smart) = &mut doc.layer_mut(id).ok_or("No refreshed Smart Object")?.content else {
                return Err("The refreshed Smart Object changed type".into());
            };
            smart.cache = Some(pixels);
            Ok(())
        }
        Ok(None) => Ok(()),
        Err(error) => if strict { Err(error.to_string()) } else { Ok(()) },
    }
}

pub(super) fn commit(engine: &mut Session, mut scratch: Session, command: &str, label: &str, params: &Value, ids: &[LayerId]) -> Result<(), String> {
    let computed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let index = scratch.active_index().ok_or("No warp document")?;
        scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
        let computed = scratch.close(index).ok_or("No completed warp document")?;
        let original = engine.active().ok_or("No image document")?;
        if computed.doc.metadata != original.doc.metadata { return Err("Smart warp changed global metadata".into()); }
        for id in ids {
            let before = original.doc.layer(*id).ok_or("No original warp layer")?;
            let after = computed.doc.layer(*id).ok_or("No completed warp layer")?;
            let (LayerContent::Smart(before_smart), LayerContent::Smart(after_smart)) = (&before.content, &after.content) else {
                return Err("Smart warp changed its layer type".into());
            };
            if after_smart.source != before_smart.source || after_smart.psd_raw != before_smart.psd_raw || after.psd_blocks != before.psd_blocks {
                return Err("Smart warp changed its source or placed-layer metadata".into());
            }
        }
        Ok::<_, String>(computed)
    })).map_err(|_| internal_error(command))??;
    let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
    super::super::mask_filters::edit_history(engine, label, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
    let state = engine.active_mut().ok_or("No image document")?;
    state.channel_view = computed.channel_view;
    state.selected_layers = computed.selected_layers;
    state.layer_anchor = computed.layer_anchor;
    engine.sync_preset_store();
    engine.journal.push((command.into(), params.clone()));
    Ok(())
}

#[cfg(test)]
#[path = "xdesign_photo_linked_warp_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "xdesign_photo_linked_warp_host_tests.rs"]
mod host_tests;

