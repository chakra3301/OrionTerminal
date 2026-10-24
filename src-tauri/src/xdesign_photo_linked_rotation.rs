use photocraft_engine::{doc::{LayerContent, LayerId, Metadata, SmartObject, SmartSource}, Session};
use serde_json::Value;
use std::sync::Arc;

const COMMAND: &str = "image.rotation.arbitrary";
const LABEL: &str = "Rotate Canvas";

fn changes_geometry(params: &Value) -> bool {
    let angle = f64::from(params.get("angle").and_then(Value::as_f64).unwrap_or(0.) as f32);
    angle.is_finite() && angle.abs() <= 3600. && angle.rem_euclid(360.).abs() >= 1e-9
        && matches!(params.get("direction").and_then(Value::as_str).unwrap_or("cw"), "cw" | "ccw")
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != COMMAND || !(params.is_object() || params.is_null()) { return None; }
    if engine.disabled_reason(command).is_some() || !changes_geometry(params) { return None; }
    let state = engine.active()?;
    if !state.doc.walk().iter().any(|(_, _, layer)| matches!(layer.content, LayerContent::Smart(_))) { return None; }
    Some(run_with(engine, params, |_, metadata, smart| {
        super::super::smart::source_bytes_checked(metadata, &smart.source, || Ok(()))
    }))
}

pub(super) fn run_with(engine: &mut Session, params: &Value,
    resolve: impl FnMut(LayerId, &Metadata, &SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    super::super::preview::validate_geometry_input(engine, COMMAND, params)?;
    if !(params.is_object() || params.is_null()) || engine.disabled_reason(COMMAND).is_some() || !changes_geometry(params) {
        return engine.execute(COMMAND, params.clone()).map_err(|error| error.to_string());
    }
    let ids: Vec<LayerId> = engine.active().ok_or("No image document")?.doc.walk().into_iter()
        .filter(|(_, _, layer)| matches!(layer.content, LayerContent::Smart(_)))
        .map(|(_, _, layer)| layer.id).collect();
    if ids.is_empty() { return engine.execute(COMMAND, params.clone()).map_err(|error| error.to_string()); }
    let (result, scratch) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let original = engine.active().ok_or("No image document")?;
        let mut scratch = super::warp::scratch(engine, "Checked Smart rotation")?;
        scratch.tools = engine.tools.clone();
        let empty = Arc::new(Vec::new());
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No rotation document")?.doc);
        for id in &ids {
            let LayerContent::Smart(smart) = &mut doc.layer_mut(*id).ok_or("No rotation layer")?.content else {
                return Err("The rotation layer changed type".into());
            };
            // Empty Embedded bytes prevent even empty-UUID metadata from bypassing checked resolution.
            smart.source = SmartSource::Embedded { file_name: String::new(), bytes: empty.clone() };
        }
        let result = scratch.execute(COMMAND, params.clone()).map_err(|error| error.to_string())?;
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No rotated document")?.doc);
        for id in &ids {
            let LayerContent::Smart(before) = &original.doc.layer(*id).ok_or("No original rotation layer")?.content else {
                return Err("The original rotation layer changed type".into());
            };
            let LayerContent::Smart(after) = &mut doc.layer_mut(*id).ok_or("No rotated Smart Object")?.content else {
                return Err("The rotated layer changed type".into());
            };
            after.source = before.source.clone();
        }
        super::transform::refresh_ids_with(doc, &ids, resolve)?;
        Ok::<_, String>((result, scratch))
    })).map_err(|_| super::warp::internal_error(COMMAND))?
        .map_err(|error| if error == "Smart Object refresh failed with an internal error" { super::warp::internal_error(COMMAND) } else { error })?;
    // Only preparation is caught: publication errors must not claim an unchanged document after commit.
    super::warp::commit(engine, scratch, COMMAND, LABEL, params, &ids)?;
    Ok(result)
}

#[cfg(test)]
#[path = "xdesign_photo_linked_rotation_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "xdesign_photo_linked_rotation_host_tests.rs"]
mod host_tests;
