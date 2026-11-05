use photocraft_engine::{doc::{Layer, LayerContent, LayerId, Metadata, SmartObject, SmartSource}, DocState, Session};
use serde_json::Value;
use std::sync::Arc;

const AGAIN: &str = "edit.transform.again";
const COPY: &str = "edit.transform.againCopy";

fn internal_error(command: &str) -> String {
    format!("`{command}` failed with an internal error (logged); the document is unchanged")
}

fn collect(layer: &Layer, ids: &mut Vec<LayerId>) {
    if matches!(layer.content, LayerContent::Smart(_)) { ids.push(layer.id); }
    if let Some(children) = layer.children() { for child in children { collect(child, ids); } }
}

fn targets(engine: &Session) -> Option<(LayerId, Vec<LayerId>)> {
    let state = engine.active()?;
    let id = state.active_layer?;
    let mut ids = Vec::new();
    collect(state.doc.layer(id)?, &mut ids);
    (!ids.is_empty()).then_some((id, ids))
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if !matches!(command, AGAIN | COPY) || !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    targets(engine)?;
    Some(run_with(engine, command, params, |_, metadata, smart| {
        super::super::smart::source_bytes_checked(metadata, &smart.source, || Ok(()))
    }))
}

struct Prepared {
    state: DocState,
    journal: Vec<(String, Value)>,
    result: Result<Value, String>,
}

pub(super) fn run_with(engine: &mut Session, command: &str, params: &Value,
    mut resolve: impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    if !matches!(command, AGAIN | COPY) || !(params.is_object() || params.is_null()) {
        return engine.execute(command, params.clone()).map_err(|error| error.to_string());
    }
    if let Some(reason) = engine.disabled_reason(command) {
        return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string());
    }
    let Some((target, ids)) = targets(engine) else {
        return engine.execute(command, params.clone()).map_err(|error| error.to_string());
    };
    let prepared = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        prepare(engine, command, params, target, &ids, &mut resolve)
    })).map_err(|_| internal_error(command))??;
    // Publish only after native geometry, source checks, history repair and all
    // posthooks finish. Native Copy failures can still carry duplicate/Undo effects.
    *engine.active_mut().ok_or("No completed Transform Again document")? = prepared.state;
    if !prepared.journal.is_empty() { engine.sync_preset_store(); }
    engine.journal.extend(prepared.journal);
    prepared.result
}

fn restore_sources(doc: &mut photocraft_engine::doc::Document,
    original: &photocraft_engine::doc::Document, pairs: &[(LayerId, LayerId)]) -> Result<(), String> {
    for (before, after) in pairs {
        let LayerContent::Smart(source) = &original.layer(*before).ok_or("No original repeated Smart Object")?.content else {
            return Err("The original repeated layer changed type".into());
        };
        let LayerContent::Smart(target) = &mut doc.layer_mut(*after).ok_or("No repeated Smart Object")?.content else {
            return Err("The repeated layer changed type".into());
        };
        target.source = source.source.clone();
    }
    Ok(())
}

fn copy_pairs(original: &Layer, copied: &Layer, pairs: &mut Vec<(LayerId, LayerId)>) -> Result<(), String> {
    if original.id == copied.id || std::mem::discriminant(&original.content) != std::mem::discriminant(&copied.content) {
        return Err("Transform Again Copy changed its duplicate structure".into());
    }
    if matches!(original.content, LayerContent::Smart(_)) { pairs.push((original.id, copied.id)); }
    match (original.children(), copied.children()) {
        (Some(before), Some(after)) if before.len() == after.len() => {
            for (before, after) in before.iter().zip(after) { copy_pairs(before, after, pairs)?; }
        }
        (None, None) => {},
        _ => return Err("Transform Again Copy changed its duplicate children".into()),
    }
    Ok(())
}

fn duplicate_identity(layer: &mut Layer, actual: &Layer) -> Result<(), String> {
    if layer.id == actual.id || std::mem::discriminant(&layer.content) != std::mem::discriminant(&actual.content) {
        return Err("The native repeated duplicate changed structure".into());
    }
    layer.id = actual.id;
    layer.psd_id = None;
    match (layer.children_mut(), actual.children()) {
        (Some(before), Some(after)) if before.len() == after.len() => {
            for (before, after) in before.iter_mut().zip(after) { duplicate_identity(before, after)?; }
        }
        (None, None) => {},
        _ => return Err("The native repeated duplicate changed children".into()),
    }
    Ok(())
}

fn rebuild_budget_history(original: &DocState, computed: &mut DocState, command: &str, target: LayerId) -> Result<(), String> {
    // The private native edit trimmed against its fallback cache. A fresh source
    // may use more or fewer tiles, so replay only public History bookkeeping
    // against the actual final pixels, retaining native duplicate/trim/purge order.
    computed.history.max_states = computed.history.past_len().saturating_add(1).max(1);
    computed.history.record("Target probe", computed.doc.clone(), Default::default());
    let (_, layers) = computed.history.undo(computed.doc.clone()).ok_or("No native repeated layer target")?;
    let mut history = original.history.clone();
    if command == COPY {
        let source = original.doc.layer(target).ok_or("No original duplicate baseline")?;
        let actual = computed.doc.layer(computed.active_layer.ok_or("No native duplicate baseline")?).ok_or("The native duplicate disappeared")?;
        let mut copied = source.clone();
        duplicate_identity(&mut copied, actual)?;
        copied.name = format!("{} copy", source.name);
        if source.name == "Background" && source.locks.transparency && original.doc.layers.first().is_some_and(|layer| layer.id == target) {
            copied.locks = Default::default();
        }
        let mut duplicate = (*original.doc).clone();
        if duplicate.insert_above(Some(target), copied) != actual.id { return Err("The native duplicate baseline identity changed".into()); }
        let duplicate = Arc::new(duplicate);
        history.record("Duplicate Layer", original.doc.clone(), layers.clone());
        history.trim(&duplicate);
        history.record("Free Transform", duplicate, layers);
        history.trim(&computed.doc);
        history.purge_last();
        history.set_current_label("Transform Again");
    } else {
        history.record("Free Transform", original.doc.clone(), layers);
        history.trim(&computed.doc);
    }
    computed.history = history;
    Ok(())
}

fn prepare(engine: &Session, command: &str, params: &Value, target: LayerId, ids: &[LayerId],
    resolve: &mut impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Prepared, String> {
    let original = engine.active().ok_or("No image document")?;
    let draft = super::super::snapshot::capture(original, super::super::snapshot::HistoryPolicy::Keep);
    let mut scratch = Session::new();
    scratch.add_document(photocraft_engine::doc::Document::new("Checked Transform Again", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
    *scratch.active_mut().ok_or("No private Transform Again document")? = draft;
    // The native recipe reads only the latest transform invocation. Retain that
    // exact entry without copying unrelated journal payloads or replaying them.
    if let Some(seed) = engine.journal.iter().rev().find(|(id, _)| id == "edit.transform") { scratch.journal.push(seed.clone()); }
    let seeded = scratch.journal.len();
    let empty = Arc::new(Vec::new());
    let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No private transform document")?.doc);
    for id in ids {
        let LayerContent::Smart(smart) = &mut doc.layer_mut(*id).ok_or("No repeated transform layer")?.content else {
            return Err("The repeated transform layer changed type".into());
        };
        smart.source = SmartSource::Embedded { file_name: String::new(), bytes: empty.clone() };
    }
    let suppressed_before = scratch.active().ok_or("No private transform baseline")?.doc.clone();
    let result = scratch.execute(command, params.clone()).map_err(|error| error.to_string());
    let journal = scratch.journal.split_off(seeded);
    let expected: &[&str] = if result.is_ok() {
        if command == COPY { &["layer.duplicate", "edit.transform", COPY] } else { &["edit.transform", AGAIN] }
    } else if command == COPY && !journal.is_empty() { &["layer.duplicate"] } else { &[] };
    if journal.iter().map(|(id, _)| id.as_str()).ne(expected.iter().copied()) {
        return Err("The native Transform Again journal changed".into());
    }
    if result.is_ok() && journal.last().map(|(_, value)| value) != Some(params) {
        return Err("The native Transform Again invocation changed".into());
    }
    let mut copied = Vec::new();
    if result.is_ok() && command == COPY {
        let state = scratch.active().ok_or("No repeated copy document")?;
        copy_pairs(original.doc.layer(target).ok_or("No original copy target")?,
            state.doc.layer(state.active_layer.ok_or("No repeated copy target")?).ok_or("The repeated copy target disappeared")?, &mut copied)?;
    }
    let retained: Vec<_> = ids.iter().map(|id| (*id, *id)).collect();
    {
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No repeated document")?.doc);
        restore_sources(doc, &original.doc, &retained)?;
        restore_sources(doc, &original.doc, &copied)?;
        if result.is_ok() {
            for (_, id) in if command == COPY { &copied } else { &retained } {
                super::warp::refresh_with(doc, *id, false, resolve)?;
            }
        }
    }
    if result.is_ok() {
        let index = scratch.active_index().ok_or("No repeated transform document")?;
        scratch.execute("document.activate", serde_json::json!({"document":index})).map_err(|error| error.to_string())?;
    }
    let index = scratch.active_index().ok_or("No completed transform document")?;
    let mut computed = scratch.close(index).ok_or("No completed Transform Again state")?;
    if computed.doc.metadata != original.doc.metadata { return Err("Transform Again changed global metadata".into()); }
    for (before, after) in retained.iter().chain(&copied) {
        let old = original.doc.layer(*before).ok_or("No original repeated layer")?;
        let new = computed.doc.layer(*after).ok_or("No completed repeated layer")?;
        let (LayerContent::Smart(old_smart), LayerContent::Smart(new_smart)) = (&old.content, &new.content) else {
            return Err("Transform Again changed its Smart Object type".into());
        };
        if old_smart.source != new_smart.source || old_smart.psd_raw != new_smart.psd_raw || old.psd_blocks != new.psd_blocks {
            return Err("Transform Again changed its source or placed-layer metadata".into());
        }
        if before != after && new.psd_id.is_some() { return Err("Transform Again Copy retained a duplicate PSD layer ID".into()); }
    }
    if result.is_err() {
        if computed.doc != original.doc { return Err("The native failed Transform Again did not restore its document".into()); }
        computed.doc = original.doc.clone();
    } else {
        if command == COPY && computed.doc.layer(target) != original.doc.layer(target) {
            return Err("Transform Again Copy changed its original layer".into());
        }
        // Native history must keep its exact trim/group/target rules, while the
        // new undo baseline must reference the original source-bearing document.
        if original.history.max_bytes != 0 {
            rebuild_budget_history(original, &mut computed, command, target)?;
        } else if computed.history.state(computed.history.past_len().wrapping_sub(1))
            .is_some_and(|before| Arc::ptr_eq(&before, &suppressed_before)) {
            computed.history.undo(computed.doc.clone()).ok_or("No repeated transform undo baseline")?;
            let (current, _) = computed.history.redo(original.doc.clone()).ok_or("No repeated transform redo state")?;
            computed.doc = current;
        }
    }
    Ok(Prepared { state: computed, journal, result })
}

#[cfg(test)]
#[path = "xdesign_photo_linked_again_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "xdesign_photo_linked_again_host_tests.rs"]
mod host_tests;
