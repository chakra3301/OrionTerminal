use photocraft_engine::{doc::{Document, LayerContent, LayerId, Metadata, SmartObject, SmartSource}, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const COMMAND: &str = "layer.smartObjects.convertToEmbedded";
const LABEL: &str = "Convert to Embedded";
const UNAVAILABLE: &str = "the linked file can't be read";
const RELINK_COMMAND: &str = "layer.smartObjects.relinkToFile";
const RELINK_LABEL: &str = "Relink to File";
const REPLACE_COMMAND: &str = "layer.smartObjects.replaceContents";
const REPLACE_LABEL: &str = "Replace Contents";
const EXPORT_COMMAND: &str = "layer.smartObjects.exportContents";
const CONVERT_COMMAND: &str = "layer.smartObjects.convertToLinked";
const CONVERT_LABEL: &str = "Convert to Linked";
const CONTENTS_UNAVAILABLE: &str = "the smart object's contents are unavailable";
const REFRESH_UNAVAILABLE: &str = "the smart object's contents are unavailable (missing linked file?), so it can't be re-rendered";
const PLACED_KEYS: [[u8; 4]; 3] = [*b"SoLd", *b"PlLd", *b"SoLE"];

enum SourceChange {
    Embed(super::Bytes),
    Relink { path: String, resolved: super::Bytes },
    Replace(super::Bytes),
    Convert { path: String, resolved: super::Bytes },
}

impl SourceChange {
    fn command(&self) -> &'static str { match self { Self::Embed(_) => COMMAND, Self::Relink { .. } => RELINK_COMMAND, Self::Replace(_) => REPLACE_COMMAND, Self::Convert { .. } => CONVERT_COMMAND } }
    fn label(&self) -> &'static str { match self { Self::Embed(_) => LABEL, Self::Relink { .. } => RELINK_LABEL, Self::Replace(_) => REPLACE_LABEL, Self::Convert { .. } => CONVERT_LABEL } }
    fn resolved(&self) -> &super::Bytes { match self { Self::Embed(bytes) | Self::Replace(bytes) | Self::Relink { resolved: bytes, .. } | Self::Convert { resolved: bytes, .. } => bytes } }
    fn keep_psd(&self) -> bool { matches!(self, Self::Embed(_)) }
    fn matches_source(&self, source: &SmartSource) -> bool {
        match (self, source) {
            (Self::Relink { path, .. } | Self::Convert { path, .. }, SmartSource::Linked { path: actual }) => actual == path,
            (Self::Embed((name, bytes)) | Self::Replace((name, bytes)), SmartSource::Embedded { file_name, bytes: actual }) => file_name == name && Arc::ptr_eq(actual, bytes),
            _ => false,
        }
    }
}

fn internal_error(command: &str) -> String { format!("`{command}` failed with an internal error (logged); the document is unchanged") }

fn actual_target(engine: &Session, params: &Value) -> Result<LayerId, String> {
    let state = engine.active().ok_or(photocraft_engine::EngineError::NoDocument).map_err(|error| error.to_string())?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)
        .ok_or_else(|| photocraft_engine::EngineError::Other("no active layer".into()).to_string())?;
    let layer = state.doc.layer(id).ok_or(photocraft_engine::EngineError::NoLayer(id)).map_err(|error| error.to_string())?;
    if !matches!(layer.content, LayerContent::Smart(_)) { return Err(photocraft_engine::EngineError::Other("the layer is not a smart object".into()).to_string()); }
    Ok(id)
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if !matches!(command, COMMAND | RELINK_COMMAND | REPLACE_COMMAND | EXPORT_COMMAND | CONVERT_COMMAND) || !(params.is_object() || params.is_null()) { return None; }
    // Native enablement uses the active layer, even when the actual target differs.
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    if command != COMMAND {
        let path = params.get("path")?.as_str().filter(|path| !path.is_empty())?;
        if command == REPLACE_COMMAND { return Some(run_replace_with(engine, params, path, super::super::input::read_source_file)); }
        let id = actual_target(engine, params).ok()?;
        if command == EXPORT_COMMAND {
            return Some(run_export_with(engine, params, id, path,
                |meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || Ok(())), write_output));
        }
        if command == CONVERT_COMMAND {
            return Some(run_convert_with(engine, params, id, path,
                |meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || Ok(())),
                |meta, path, smart| super::super::smart::metadata_source_bytes_checked(meta, path, || super::admit(smart)), write_output));
        }
        return Some(run_relink_with(engine, params, id, path, |meta, smart, source| super::super::smart::source_bytes_checked(meta, source, || super::admit(smart))));
    }
    let id = actual_target(engine, params).ok()?;
    Some(run_with(engine, params, id, |meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || super::admit(smart))))
}

fn write_output(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    photocraft_format::atomic_write(path, bytes).map_err(|error| error.to_string())
}

fn run_export_with(engine: &mut Session, params: &Value, id: LayerId, path: &str,
    resolve: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>,
    write: impl FnOnce(&std::path::Path, &[u8]) -> Result<(), String>) -> Result<Value, String> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let state = engine.active().ok_or("No image document")?;
        let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("No Smart Object")?.content else { return Err("Select a Smart Object".into()); };
        let (name, bytes) = resolve(&state.doc.metadata, smart)?.ok_or(CONTENTS_UNAVAILABLE)?;
        write(std::path::Path::new(path), &bytes)?;
        Ok::<_, String>(json!({"path":path,"fileName":name,"bytes":bytes.len()}))
    })).map_err(|_| internal_error(EXPORT_COMMAND))??;
    // Output is already published. A later document failure cannot undo that external effect.
    super::persist_output(Some(path), || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let index = engine.active_index().ok_or("No image document")?;
            engine.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
            engine.journal.push((EXPORT_COMMAND.into(), params.clone()));
            Ok(result)
        })).map_err(|_| internal_error(EXPORT_COMMAND))?
    })
}

fn run_convert_with(engine: &mut Session, params: &Value, id: LayerId, path: &str,
    resolve_old: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>,
    resolve_destination: impl FnOnce(&Metadata, &str, &SmartObject) -> Result<Option<super::Bytes>, String>,
    write: impl FnOnce(&std::path::Path, &[u8]) -> Result<(), String>) -> Result<Value, String> {
    let (output, resolved) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let state = engine.active().ok_or("No image document")?;
        let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("No Smart Object")?.content else { return Err("Select a Smart Object".into()); };
        let (_, output) = resolve_old(&state.doc.metadata, smart)?.ok_or(CONTENTS_UNAVAILABLE)?;
        let resolved = resolve_destination(&state.doc.metadata, path, smart)?;
        super::admit(smart)?;
        let resolved = resolved.unwrap_or_else(|| (path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned(), output.clone()));
        Ok::<_, String>((output, resolved))
    })).map_err(|_| internal_error(CONVERT_COMMAND))??;
    apply_source_change_after_prepare(engine, params, id, SourceChange::Convert { path: path.into(), resolved }, Some(path),
        || write(std::path::Path::new(path), &output))
}

fn run_with(engine: &mut Session, params: &Value, id: LayerId, resolve: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("No Smart Object")?.content else { return Err("Select a Smart Object".into()); };
    let source = resolve(&state.doc.metadata, smart)?.ok_or(UNAVAILABLE)?;
    apply_source_change(engine, params, id, SourceChange::Embed(source))
}

fn run_relink_with(engine: &mut Session, params: &Value, id: LayerId, path: &str, resolve: impl FnOnce(&Metadata, &SmartObject, &SmartSource) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or(photocraft_engine::EngineError::NoLayer(id)).map_err(|error| error.to_string())?.content else {
        return Err(photocraft_engine::EngineError::Other("the layer is not a smart object".into()).to_string());
    };
    let source = SmartSource::Linked { path: path.into() };
    let resolved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| resolve(&state.doc.metadata, smart, &source)))
        .map_err(|_| internal_error(RELINK_COMMAND))??.ok_or(REFRESH_UNAVAILABLE)?;
    apply_source_change(engine, params, id, SourceChange::Relink { path: path.into(), resolved })
}

fn run_replace_with(engine: &mut Session, params: &Value, path: &str, read: impl FnOnce(&std::path::Path) -> Result<Vec<u8>, String>) -> Result<Value, String> {
    // Native Replace validates the disk contents before looking up an explicit layer target.
    let resolved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let bytes = read(std::path::Path::new(path)).map_err(|error| format!("can't read {path}: {error}"))?;
        let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_string();
        photocraft_engine::smart_cmds::decode_source(&name, &bytes).map_err(|error| error.to_string())?;
        Ok::<_, String>((name, Arc::new(bytes)))
    })).map_err(|_| internal_error(REPLACE_COMMAND))??;
    let id = actual_target(engine, params)?;
    let state = engine.active().ok_or("No image document")?;
    let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("No Smart Object")?.content else { return Err("Select a Smart Object".into()); };
    super::admit(smart)?;
    apply_source_change(engine, params, id, SourceChange::Replace(resolved))
}

fn apply_source_change(engine: &mut Session, params: &Value, id: LayerId, change: SourceChange) -> Result<Value, String> {
    apply_source_change_after_prepare(engine, params, id, change, None, || Ok(()))
}

fn apply_source_change_after_prepare(engine: &mut Session, params: &Value, id: LayerId, change: SourceChange, output_path: Option<&str>, write: impl FnOnce() -> Result<(), String>) -> Result<Value, String> {
    let command = change.command();
    let label = change.label();
    let (file_name, bytes) = change.resolved();
    let state = engine.active().ok_or("No image document")?;
    let draft = super::super::snapshot::capture(state, super::super::snapshot::HistoryPolicy::Discard);
    let mut scratch = Session::new();
    scratch.add_document(Document::new("Embed linked source", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
    *scratch.active_mut().ok_or("No embed document")? = draft;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        scratch.edit(label, |doc, _| {
            let layer = doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?;
            let LayerContent::Smart(target) = &mut layer.content else {
                return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into()));
            };
            target.source = SmartSource::Embedded { file_name: file_name.clone(), bytes: bytes.clone() };
            if !change.keep_psd() {
                target.psd_raw = None;
                layer.psd_blocks.retain(|(key, _)| !PLACED_KEYS.contains(key));
            }
            if !photocraft_engine::smart_cmds::refresh(doc, id)? {
                return Err(photocraft_engine::EngineError::Other(REFRESH_UNAVAILABLE.into()));
            }
            if let SourceChange::Relink { path, .. } | SourceChange::Convert { path, .. } = &change {
                let LayerContent::Smart(target) = &mut doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?.content else {
                    return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into()));
                };
                target.source = SmartSource::Linked { path: path.clone() };
            }
            Ok(())
        })
    })).map_err(|_| internal_error(command))?.map_err(|error| error.to_string())?;
    // Keep the native view and layer-slice posthooks without redispatching against an Embedded target.
    let index = scratch.active_index().ok_or("No embed document")?;
    scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
    let computed = scratch.close(index).ok_or("No completed embed document")?;
    let layer = computed.doc.layer(id).ok_or("The embedded Smart Object no longer exists")?;
    let LayerContent::Smart(embedded) = &layer.content else { return Err("The embedded Smart Object changed type".into()); };
    if !change.matches_source(&embedded.source) { return Err("Source change did not retain its intended source".into()); }
    if embedded.cache.is_none() { return Err("Embed source produced no cache".into()); }
    let original = engine.active().and_then(|state| state.doc.layer(id)).ok_or("The original Smart Object no longer exists")?;
    let LayerContent::Smart(before) = &original.content else { return Err("The original Smart Object changed type".into()); };
    if change.keep_psd() {
        if embedded.psd_raw != before.psd_raw || layer.psd_blocks != original.psd_blocks { return Err("Embed source changed retained placed-layer metadata".into()); }
    } else if embedded.psd_raw.is_some() || !layer.psd_blocks.iter().eq(original.psd_blocks.iter().filter(|(key, _)| !PLACED_KEYS.contains(key))) {
        return Err("Source change did not preserve unrelated placed-layer metadata".into());
    }
    if computed.doc.metadata != engine.active().ok_or("No image document")?.doc.metadata { return Err("Source change modified global metadata".into()); }
    let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(write)).map_err(|_| internal_error(command))??;
    // Convert prepares the document before publishing; publication and its later commit are two resources.
    super::persist_output(output_path, || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            super::super::mask_filters::edit_history(engine, label, params, |doc, layer| { *doc = document; *layer = computed.active_layer; Ok(()) })?;
            let state = engine.active_mut().ok_or("No image document")?;
            state.channel_view = computed.channel_view;
            state.selected_layers = computed.selected_layers;
            state.layer_anchor = computed.layer_anchor;
            engine.sync_preset_store();
            engine.journal.push((command.into(), params.clone()));
            Ok(json!({"layer":id.0}))
        })).map_err(|_| internal_error(command))?
    })
}

#[cfg(test)]
#[path = "xdesign_photo_linked_embed_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "xdesign_photo_source_change_tests.rs"]
mod source_change_tests;

#[cfg(test)]
#[path = "xdesign_photo_file_output_tests.rs"]
mod file_output_tests;
