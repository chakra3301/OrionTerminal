use photocraft_algo::resample::translate_surface;
use photocraft_engine::{doc::{Affine, Document, Layer, LayerContent, SmartObject, SmartSource}, EngineError, Session};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};

#[path = "xdesign_photo_place_resample.rs"]
pub(super) mod resample;

const EMBEDDED: &str = "file.placeEmbedded";
const LINKED: &str = "file.placeLinked";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if !matches!(command, EMBEDDED | LINKED) || !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(EngineError::Disabled(command.into(), reason).to_string()));
    }
    let path = params.get("path")?.as_str().filter(|path| !path.is_empty())?;
    Some(run_with(engine, command, params, path, super::input::read_source_file))
}

fn geometry(canvas: (u32, u32), source: (u32, u32), params: &Value) -> Result<(f64, f64, f64), String> {
    let (cw, ch) = (f64::from(canvas.0), f64::from(canvas.1));
    let (w, h) = (f64::from(source.0), f64::from(source.1));
    if source.0 == 0 || source.1 == 0 || u64::from(source.0) * u64::from(source.1) > super::MAX_PIXELS {
        return Err("Placed source exceeds the 256 megapixel editing limit".into());
    }
    let scale = match params.get("scale").and_then(Value::as_f64).filter(|value| value.is_finite()) {
        Some(percent) => (percent / 100.0).max(1e-4),
        None if params.get("fit").and_then(Value::as_bool) != Some(false) && (w > cw || h > ch) => (cw / w).min(ch / h),
        None => 1.0,
    };
    let center = match params.get("center").and_then(Value::as_array) {
        Some(center) if center.len() == 2 => (center[0].as_f64().unwrap_or(cw / 2.0), center[1].as_f64().unwrap_or(ch / 2.0)),
        _ => (cw / 2.0, ch / 2.0),
    };
    let (width, height) = (w * scale, h * scale);
    let (dx, dy) = ((center.0 - width / 2.0).round(), (center.1 - height / 2.0).round());
    if ![width, height, dx, dy].iter().all(|value| value.is_finite())
        || width.ceil().max(1.0) * height.ceil().max(1.0) > super::MAX_PIXELS as f64
        || dx < f64::from(i32::MIN) || dy < f64::from(i32::MIN)
        || dx + width.ceil().max(1.0) > f64::from(i32::MAX)
        || dy + height.ceil().max(1.0) > f64::from(i32::MAX)
    {
        return Err("Placed image dimensions or position exceed the editing limit".into());
    }
    Ok((scale, dx, dy))
}

fn run_with(engine: &mut Session, command: &str, params: &Value, path: &str,
    read: impl FnOnce(&Path) -> Result<Vec<u8>, String>) -> Result<Value, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let bytes = read(Path::new(path)).map_err(|error| format!("{path}: {error}"))?;
        let source = photocraft_io::import(path, &bytes).map_err(|error| format!("{path}: {error}"))?.document;
        let state = engine.active().ok_or("No image document")?;
        let (scale, dx, dy) = geometry((state.doc.size.width, state.doc.size.height), (source.size.width, source.size.height), params)?;
        // Admission needs decoded dimensions before flattening; public place_bytes would decode again.
        let mut pixels = photocraft_compose::flatten_to_surface(&source, state.doc.pixel_format(), None);
        if (scale - 1.0).abs() > 1e-9 { pixels = resample::resize(&pixels, scale)?; }
        let pixels = translate_surface(&pixels, dx as i32, dy as i32);
        // Pasted images arrive as temporary files, so the caller names them.
        let name = params.get("name").and_then(Value::as_str).filter(|name| !name.trim().is_empty()).map(str::to_owned)
            .unwrap_or_else(|| path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned());
        let layer_name = match name.rfind('.') { Some(index) if index > 0 => name[..index].to_owned(), _ => name.clone() };
        let smart_source = if command == LINKED { SmartSource::Linked { path: path.into() } }
            else { SmartSource::Embedded { file_name: name, bytes: Arc::new(bytes) } };
        let smart = SmartObject::new(smart_source, Affine { m: [scale, 0.0, 0.0, scale, dx, dy] }, Some(pixels));
        let label = if command == LINKED { "Place Linked" } else { "Place Embedded" };
        let draft = super::snapshot::capture(state, super::snapshot::HistoryPolicy::Discard);
        let mut scratch = Session::new();
        scratch.add_document(Document::new("Place image", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
        *scratch.active_mut().ok_or("No placement document")? = draft;
        let id = scratch.edit(label, |doc, active| {
            let id = doc.insert_above(*active, Layer::new(layer_name, LayerContent::Smart(smart)));
            *active = Some(id);
            Ok(id)
        }).map_err(|error| error.to_string())?;
        let index = scratch.active_index().ok_or("No placement document")?;
        scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
        let computed = scratch.close(index).ok_or("No completed placement document")?;
        let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
        super::mask_filters::edit_history(engine, label, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
        let state = engine.active_mut().ok_or("No image document")?;
        state.channel_view = computed.channel_view;
        state.selected_layers = computed.selected_layers;
        state.layer_anchor = computed.layer_anchor;
        engine.sync_preset_store();
        engine.journal.push((command.into(), params.clone()));
        Ok(json!({"layer":id.0,"scale":scale*100.0,"bounds":[dx,dy,dx+f64::from(source.size.width)*scale,dy+f64::from(source.size.height)*scale]}))
    })).map_err(|_| format!("`{command}` failed with an internal error (logged); the document is unchanged"))?
}

#[cfg(test)]
#[path = "xdesign_photo_place_tests.rs"]
mod tests;
