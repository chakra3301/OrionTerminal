use photocraft_engine::{doc::{Document, LayerContent, LayerId, Metadata, SmartObject, SmartSource, StackMode}, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const PREFIX: &str = "layer.smartObjects.stackMode.";

fn mode(command: &str) -> Option<Option<StackMode>> {
    match command.strip_prefix(PREFIX)? {
        "none" => Some(None),
        id => StackMode::from_id(id).map(Some),
    }
}

fn target(engine: &Session, params: &Value) -> Option<LayerId> {
    let state = engine.active()?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)?;
    matches!(state.doc.layer(id)?.content, LayerContent::Smart(_)).then_some(id)
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    mode(command)?;
    if !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    target(engine, params)?;
    Some(run_with(engine, command, params, |metadata, smart| {
        super::super::smart::source_bytes_checked(metadata, &smart.source, || Ok(()))
    }))
}

fn run_with(engine: &mut Session, command: &str, params: &Value,
    resolve: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    let Some(mode) = mode(command) else { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); };
    if !(params.is_object() || params.is_null()) { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); }
    if let Some(reason) = engine.disabled_reason(command) {
        return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string());
    }
    let Some(id) = target(engine, params) else { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); };
    let label = format!("Stack Mode: {}", mode.map_or("None", StackMode::label));
    let computed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let original = engine.active().ok_or("No image document")?;
        let LayerContent::Smart(before) = &original.doc.layer(id).ok_or("No Smart Object")?.content else { return Err("Select a Smart Object".into()); };
        let mut pinned = before.clone();
        pinned.stack_mode = mode;
        let available = if let Some((file_name, bytes)) = resolve(&original.doc.metadata, &pinned)? {
            // Missing sources commit the mode alone; corrupt sources fail before any filter admission.
            let decoded = match mode {
                Some(mode) => photocraft_engine::smart_cmds::stack_image(&file_name, &bytes, original.doc.pixel_format(), mode),
                None => photocraft_engine::smart_cmds::source_image(&file_name, &bytes, original.doc.pixel_format()),
            }.map_err(|error| error.to_string())?;
            drop(decoded);
            super::admit(&pinned)?;
            pinned.source = SmartSource::Embedded { file_name, bytes };
            true
        } else { false };
        let draft = super::super::snapshot::capture(original, super::super::snapshot::HistoryPolicy::Discard);
        let mut scratch = Session::new();
        scratch.add_document(Document::new("Checked Smart stack mode", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
        *scratch.active_mut().ok_or("No stack-mode document")? = draft;
        scratch.edit(&label, |doc, _| {
            let LayerContent::Smart(smart) = &mut doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?.content else {
                return Err(photocraft_engine::EngineError::Other("the active layer is not a smart object".into()));
            };
            smart.stack_mode = mode;
            if available {
                if let Some(pixels) = photocraft_engine::smart_cmds::render(doc, &pinned)? {
                let LayerContent::Smart(smart) = &mut doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?.content else {
                    return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into()));
                };
                smart.cache = Some(pixels);
                }
            }
            Ok(())
        }).map_err(|error| error.to_string())?;
        // Run native view, mask and layer-slice posthooks after the original source is authoritative.
        let index = scratch.active_index().ok_or("No stack-mode document")?;
        scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
        let computed = scratch.close(index).ok_or("No completed stack-mode document")?;
        let layer = computed.doc.layer(id).ok_or("The stack-mode layer no longer exists")?;
        let LayerContent::Smart(after) = &layer.content else { return Err("The stack-mode layer changed type".into()); };
        let before_layer = original.doc.layer(id).ok_or("The original stack-mode layer no longer exists")?;
        if after.stack_mode != mode || after.source != before.source || after.psd_raw != before.psd_raw || layer.psd_blocks != before_layer.psd_blocks
            || computed.doc.metadata != original.doc.metadata || !available && after.cache != before.cache {
            return Err("Stack Mode changed its source, retained metadata or unavailable cache".into());
        }
        Ok::<_, String>(computed)
    })).map_err(|_| format!("`{command}` failed with an internal error (logged); the document is unchanged"))??;
    let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
    super::super::mask_filters::edit_history(engine, &label, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
    let state = engine.active_mut().ok_or("No image document")?;
    state.channel_view = computed.channel_view;
    state.selected_layers = computed.selected_layers;
    state.layer_anchor = computed.layer_anchor;
    engine.sync_preset_store();
    engine.journal.push((command.into(), params.clone()));
    Ok(json!({"stackMode":mode.map(StackMode::id)}))
}

#[cfg(test)]
#[path = "xdesign_photo_linked_stack_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "xdesign_photo_linked_stack_host_tests.rs"]
mod host_tests;
