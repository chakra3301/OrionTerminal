use photocraft_engine::{doc::{Document, LayerContent, LayerId, Metadata, SmartObject, SmartSource}, EngineError, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const COMMAND: &str = "layer.smartObjects.newSmartObjectViaCopy";
const LABEL: &str = "New Smart Object via Copy";
const PLACED_KEYS: [[u8; 4]; 3] = [*b"SoLd", *b"PlLd", *b"SoLE"];

fn internal_error() -> String { format!("`{COMMAND}` failed with an internal error (logged); the document is unchanged") }

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != COMMAND || !(params.is_object() || params.is_null()) { return None; }
    // Native enablement belongs to the active layer, independently of the actual copy target.
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(EngineError::Disabled(command.into(), reason).to_string()));
    }
    let state = engine.active()?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)?;
    let LayerContent::Smart(_) = &state.doc.layer(id)?.content else { return None; };
    Some(run_with(engine, params, id, |meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || Ok(()))))
}

fn run_with(engine: &mut Session, params: &Value, id: LayerId,
    resolve: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_checked(engine, params, id, resolve)))
        .map_err(|_| internal_error())?
}

fn run_checked(engine: &mut Session, params: &Value, id: LayerId,
    resolve: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    let state = engine.active().ok_or(EngineError::NoDocument).map_err(|error| error.to_string())?;
    let original = state.doc.layer(id).ok_or(EngineError::NoLayer(id)).map_err(|error| error.to_string())?;
    let LayerContent::Smart(before) = &original.content else { return Err(EngineError::Other("the layer is not a smart object".into()).to_string()); };
    // Copy preserves even undecodable bytes and unknown filters; no source rendering is involved.
    let resolved = resolve(&state.doc.metadata, before)?;
    let draft = super::super::snapshot::capture(state, super::super::snapshot::HistoryPolicy::Discard);
    let mut scratch = Session::new();
    scratch.add_document(Document::new("Copy Smart Object", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
    *scratch.active_mut().ok_or("No copy document")? = draft;
    let copied_id = scratch.edit(LABEL, |doc, active| {
        let source = doc.layer(id).ok_or(EngineError::NoLayer(id))?;
        let mut copied = source.duplicate();
        copied.name = format!("{} copy", source.name);
        let LayerContent::Smart(smart) = &mut copied.content else { return Err(EngineError::Other("the layer is not a smart object".into())); };
        if let Some((file_name, bytes)) = &resolved {
            smart.source = SmartSource::Embedded { file_name: file_name.clone(), bytes: bytes.clone() };
        }
        smart.psd_raw = None;
        copied.psd_blocks.retain(|(key, _)| !PLACED_KEYS.contains(key));
        let new_id = doc.insert_above(Some(id), copied);
        *active = Some(new_id);
        Ok(new_id)
    }).map_err(|error| error.to_string())?;
    let index = scratch.active_index().ok_or("No copy document")?;
    scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
    let computed = scratch.close(index).ok_or("No completed copy document")?;
    if computed.active_layer != Some(copied_id) || computed.doc.layer(id) != Some(original) {
        return Err("Smart Object copy modified its original layer".into());
    }
    let copied_layer = computed.doc.layer(copied_id).ok_or("The copied Smart Object no longer exists")?;
    let LayerContent::Smart(copied) = &copied_layer.content else { return Err("The copied Smart Object changed type".into()); };
    let source_matches = match (&resolved, &copied.source) {
        (Some((name, bytes)), SmartSource::Embedded { file_name, bytes: actual }) => file_name == name && Arc::ptr_eq(actual, bytes),
        (None, actual) => actual == &before.source,
        _ => false,
    };
    if !source_matches || copied.cache != before.cache { return Err("Smart Object copy did not retain its intended source and cache".into()); }
    if copied.psd_raw.is_some() || !copied_layer.psd_blocks.iter().eq(original.psd_blocks.iter().filter(|(key, _)| !PLACED_KEYS.contains(key))) {
        return Err("Smart Object copy did not preserve unrelated placed-layer metadata".into());
    }
    if computed.doc.metadata != state.doc.metadata { return Err("Smart Object copy modified global metadata".into()); }
    let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
    super::super::mask_filters::edit_history(engine, LABEL, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
    let state = engine.active_mut().ok_or("No image document")?;
    state.channel_view = computed.channel_view;
    state.selected_layers = computed.selected_layers;
    state.layer_anchor = computed.layer_anchor;
    engine.sync_preset_store();
    engine.journal.push((COMMAND.into(), params.clone()));
    Ok(json!({"layer":copied_id.0}))
}

#[cfg(test)]
#[path = "xdesign_photo_linked_copy_tests.rs"]
mod tests;
