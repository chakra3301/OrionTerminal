use photocraft_engine::{doc::{Document, Layer, LayerContent, LayerId, Metadata, SmartObject, SmartSource}, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const COMMAND: &str = "edit.transform";
const LABEL: &str = "Free Transform";
const REFRESH_PANIC: &str = "Smart Object refresh failed with an internal error";

fn internal_error() -> String { format!("`{COMMAND}` failed with an internal error (logged); the document is unchanged") }

fn collect(layer: &Layer, ids: &mut Vec<LayerId>) {
    if matches!(layer.content, LayerContent::Smart(_)) { ids.push(layer.id); }
    if let Some(children) = layer.children() { for child in children { collect(child, ids); } }
}

fn targets(engine: &Session, params: &Value) -> Option<Vec<LayerId>> {
    let state = engine.active()?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer);
    if photocraft_engine::transform_cmds::lone_target(&state.doc, id, params).ok()?.is_some() { return None; }
    let mut ids = Vec::new();
    collect(state.doc.layer(id?)?, &mut ids);
    (!ids.is_empty()).then_some(ids)
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != COMMAND || !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    targets(engine, params)?;
    Some(run_with(engine, params, |_, meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || Ok(()))))
}

fn run_with(engine: &mut Session, params: &Value,
    resolve: impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    if !(params.is_object() || params.is_null()) { return engine.execute(COMMAND, params.clone()).map_err(|error| error.to_string()); }
    if let Some(reason) = engine.disabled_reason(COMMAND) {
        return Err(photocraft_engine::EngineError::Disabled(COMMAND.into(), reason).to_string());
    }
    let Some(ids) = targets(engine, params) else { return engine.execute(COMMAND, params.clone()).map_err(|error| error.to_string()); };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let original = engine.active().ok_or("No image document")?;
        let mut draft = super::super::snapshot::capture(original, super::super::snapshot::HistoryPolicy::Discard);
        let empty = Arc::new(Vec::new());
        for id in &ids {
            let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut draft.doc).layer_mut(*id).ok_or("No transform layer")?.content else { return Err("The transform layer changed type".into()); };
            smart.source = SmartSource::Embedded { file_name: String::new(), bytes: empty.clone() };
        }
        let mut scratch = Session::new();
        scratch.add_document(Document::new("Checked Smart transform", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
        *scratch.active_mut().ok_or("No transform document")? = draft;
        // Undecodable Embedded bytes suppress refresh without allowing even an empty-UUID metadata lookup.
        let result = scratch.execute(COMMAND, params.clone()).map_err(|error| error.to_string())?;
        let state = scratch.active_mut().ok_or("No transformed document")?;
        let doc = Arc::make_mut(&mut state.doc);
        for id in &ids {
            let LayerContent::Smart(before) = &original.doc.layer(*id).ok_or("No original Smart Object")?.content else { return Err("The original Smart Object changed type".into()); };
            let LayerContent::Smart(after) = &mut doc.layer_mut(*id).ok_or("No transformed Smart Object")?.content else { return Err("The transformed Smart Object changed type".into()); };
            after.source = before.source.clone();
        }
        refresh_ids_with(doc, &ids, resolve).map_err(|error| if error == REFRESH_PANIC { internal_error() } else { error })?;
        let index = scratch.active_index().ok_or("No transform document")?;
        scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
        let computed = scratch.close(index).ok_or("No completed transform")?;
        if computed.doc.metadata != original.doc.metadata { return Err("Smart transform changed global metadata".into()); }
        for id in &ids {
            let before = original.doc.layer(*id).ok_or("No original Smart Object")?;
            let after = computed.doc.layer(*id).ok_or("No transformed Smart Object")?;
            let (LayerContent::Smart(before_smart), LayerContent::Smart(after_smart)) = (&before.content, &after.content) else { return Err("Smart transform changed its layer type".into()); };
            if after_smart.source != before_smart.source || after_smart.psd_raw != before_smart.psd_raw || after.psd_blocks != before.psd_blocks {
                return Err("Smart transform changed its source or placed-layer metadata".into());
            }
        }
        let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
        super::super::mask_filters::edit_history(engine, LABEL, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
        let state = engine.active_mut().ok_or("No image document")?;
        state.channel_view = computed.channel_view;
        state.selected_layers = computed.selected_layers;
        state.layer_anchor = computed.layer_anchor;
        engine.sync_preset_store();
        engine.journal.push((COMMAND.into(), params.clone()));
        Ok(result)
    })).map_err(|_| internal_error())?
}

pub(crate) fn refresh_ids(doc: &mut Document, ids: &[LayerId]) -> Result<(), String> {
    refresh_ids_with(doc, ids, |_, meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || Ok(())))
}

pub(crate) fn refresh_ids_with(doc: &mut Document, ids: &[LayerId],
    mut resolve: impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<(), String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        for id in ids {
            let LayerContent::Smart(smart) = &doc.layer(*id).ok_or("No Smart Object to refresh")?.content else { return Err("The Smart Object changed type".into()); };
            let Some((file_name, bytes)) = resolve(*id, &doc.metadata, smart)? else { continue; };
            // Native Free Transform ignores source decode failures, including in otherwise unsafe stacks.
            // Use the same content/format cache and stack-mode decoder before allowing filter execution.
            let decoded = match smart.stack_mode {
                Some(mode) => photocraft_engine::smart_cmds::stack_image(&file_name, &bytes, doc.pixel_format(), mode),
                None => photocraft_engine::smart_cmds::source_image(&file_name, &bytes, doc.pixel_format()),
            };
            if decoded.is_err() { continue; }
            drop(decoded);
            super::admit(smart)?;
            let LayerContent::Smart(target) = &mut doc.layer_mut(*id).ok_or("No Smart Object to refresh")?.content else { return Err("The Smart Object changed type".into()); };
            let original = std::mem::replace(&mut target.source, SmartSource::Embedded { file_name, bytes });
            let rendered = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let LayerContent::Smart(target) = &doc.layer(*id).ok_or("No Smart Object to refresh")?.content else { return Err("The Smart Object changed type".into()); };
                Ok::<_, String>(photocraft_engine::smart_cmds::render(doc, target))
            }));
            let LayerContent::Smart(target) = &mut doc.layer_mut(*id).ok_or("No Smart Object to refresh")?.content else { return Err("The Smart Object changed type".into()); };
            target.source = original;
            if let Ok(Some(pixels)) = rendered.map_err(|_| REFRESH_PANIC.to_owned())?? { target.cache = Some(pixels); }
        }
        Ok(())
    })).map_err(|_| REFRESH_PANIC.to_owned())?
}

#[cfg(test)]
#[path = "xdesign_photo_linked_transform_tests.rs"]
mod tests;
