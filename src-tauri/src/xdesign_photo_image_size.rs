use photocraft_algo::resample::Resample;
use photocraft_engine::{doc::{Document, Layer, LayerContent, LayerId, SmartSource}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::sync::Arc;

const COMMAND: &str = "image.imageSize";
const LABEL: &str = "Image Size";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != COMMAND || !(params.is_object() || params.is_null()) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    let state = engine.active()?;
    let (width, height) = dimensions(state.doc.size.width, state.doc.size.height, params);
    let filter = match params.get("resample").and_then(Value::as_str).unwrap_or("bicubic") {
        "none" => return None,
        "nearest" | "nearestNeighbor" => Resample::Nearest,
        "bilinear" => Resample::Bilinear,
        "lanczos" => Resample::Lanczos,
        "preserveDetails" => Resample::PreserveDetails,
        _ => Resample::Bicubic,
    };
    let sx = f64::from(width) / f64::from(state.doc.size.width.max(1));
    let sy = f64::from(height) / f64::from(state.doc.size.height.max(1));
    if (sx - 1.0).abs() < 1e-12 && (sy - 1.0).abs() < 1e-12 { return None; }
    Some(run(engine, params, width, height, sx, sy, filter))
}

fn dimensions(width: u32, height: u32, params: &Value) -> (u32, u32) {
    let (w, h) = match (params.get("width").and_then(Value::as_f64), params.get("height").and_then(Value::as_f64)) {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, w * f64::from(height) / f64::from(width.max(1))),
        (None, Some(h)) => (h * f64::from(width) / f64::from(height.max(1)), h),
        (None, None) => (f64::from(width), f64::from(height)),
    };
    (w.round().clamp(1.0, 300_000.0) as u32, h.round().clamp(1.0, 300_000.0) as u32)
}

enum ContentPixels {
    Raster(Surface),
    Smart { source: SmartSource, fallback: Option<Surface> },
    Other,
}

struct LayerPixels {
    id: LayerId,
    mask: Option<Surface>,
    fill: Option<Surface>,
    content: ContentPixels,
}

fn take_resized(surface: &mut Surface, sx: f64, sy: f64, filter: Resample) -> Result<Surface, String> {
    let resized = super::place::resample::resize_xy(surface, sx, sy, filter)?;
    *surface = Surface::with_default(surface.format(), &surface.default_pixel());
    Ok(resized)
}

fn prepare_layers(layers: &mut [Layer], sx: f64, sy: f64, filter: Resample, saved: &mut Vec<LayerPixels>) -> Result<(), String> {
    for layer in layers {
        let mask = layer.mask.as_mut().map(|mask| take_resized(&mut mask.surface, sx, sy, Resample::Bilinear)).transpose()?;
        let fill = layer.fill_cache.as_mut().map(|cache| take_resized(&mut cache.surface, sx, sy, filter)).transpose()?;
        let content = match &mut layer.content {
            LayerContent::Raster(surface) => ContentPixels::Raster(take_resized(surface, sx, sy, filter)?),
            LayerContent::Smart(smart) => {
                let fallback = smart.cache.as_mut().map(|surface| take_resized(surface, sx, sy, filter)).transpose()?;
                smart.cache = None;
                // An undecodable embedded placeholder cannot collide with a PSD linked UUID or read disk.
                let source = std::mem::replace(&mut smart.source, SmartSource::Embedded { file_name: String::new(), bytes: Arc::new(Vec::new()) });
                ContentPixels::Smart { source, fallback }
            }
            // Native Image Size always replaces these caches with sharp geometry-based renders.
            LayerContent::Text(text) => { text.cache = None; ContentPixels::Other }
            LayerContent::Shape(shape) => { shape.cache = None; ContentPixels::Other }
            _ => ContentPixels::Other,
        };
        saved.push(LayerPixels { id: layer.id, mask, fill, content });
        if let Some(children) = layer.children_mut() { prepare_layers(children, sx, sy, filter, saved)?; }
    }
    Ok(())
}

fn restore_layers(layers: &mut [Layer], saved: &mut impl Iterator<Item = LayerPixels>, ids: &mut Vec<LayerId>) -> Result<(), String> {
    for layer in layers {
        let pixels = saved.next().ok_or("Image Size lost a prepared layer")?;
        if pixels.id != layer.id { return Err("Image Size changed its layer order".into()); }
        if let Some(surface) = pixels.mask { layer.mask.as_mut().ok_or("Image Size lost a layer mask")?.surface = surface; }
        if let Some(surface) = pixels.fill { layer.fill_cache.as_mut().ok_or("Image Size lost a fill cache")?.surface = surface; }
        match (pixels.content, &mut layer.content) {
            (ContentPixels::Raster(surface), LayerContent::Raster(target)) => *target = surface,
            (ContentPixels::Smart { source, fallback }, LayerContent::Smart(smart)) => {
                smart.source = source;
                smart.cache = fallback;
                ids.push(layer.id);
            }
            (ContentPixels::Other, _) => {}
            _ => return Err("Image Size changed a layer's content type".into()),
        }
        if let Some(children) = layer.children_mut() { restore_layers(children, saved, ids)?; }
    }
    Ok(())
}

fn run(engine: &mut Session, params: &Value, width: u32, height: u32, sx: f64, sy: f64, filter: Resample) -> Result<Value, String> {
    run_with(engine, params, width, height, sx, sy, filter, super::linked_replay::refresh_ids)
}

fn run_with(engine: &mut Session, params: &Value, width: u32, height: u32, sx: f64, sy: f64, filter: Resample,
    refresh: impl FnOnce(&mut Document, &[LayerId]) -> Result<(), String>) -> Result<Value, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if u64::from(width) * u64::from(height) > super::MAX_PIXELS {
            return Err("The resized image exceeds the 256 megapixel editing limit".into());
        }
        let state = engine.active().ok_or("No image document")?;
        let draft = super::snapshot::capture(state, super::snapshot::HistoryPolicy::Discard);
        let mut scratch = Session::new();
        scratch.add_document(Document::new("Image Size", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
        *scratch.active_mut().ok_or("No resize document")? = draft;
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No resize document")?.doc);
        let mut saved = Vec::new();
        prepare_layers(&mut doc.layers, sx, sy, filter, &mut saved)?;
        let mut channels = Vec::new();
        for channel in doc.channels.iter_mut().chain(doc.quick_mask.as_mut()) {
            channels.push(take_resized(&mut channel.surface, sx, sy, Resample::Bilinear)?);
        }
        let selection = doc.selection.as_mut().map(|surface| take_resized(surface, sx, sy, Resample::Bilinear)).transpose()?;
        // Keep native geometry, effects, TySh generation and sharp vector/text refresh authoritative.
        let value = scratch.execute(COMMAND, params.clone()).map_err(|error| error.to_string())?;
        scratch.active_mut().ok_or("No resize document")?.history = Default::default();
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No resize document")?.doc);
        let mut saved = saved.into_iter();
        let mut ids = Vec::new();
        restore_layers(&mut doc.layers, &mut saved, &mut ids)?;
        if saved.next().is_some() { return Err("Image Size retained an unexpected prepared layer".into()); }
        let mut channels = channels.into_iter();
        for channel in doc.channels.iter_mut().chain(doc.quick_mask.as_mut()) {
            channel.surface = channels.next().ok_or("Image Size lost a prepared channel")?;
        }
        if channels.next().is_some() { return Err("Image Size retained an unexpected prepared channel".into()); }
        doc.selection = selection;
        refresh(doc, &ids)?;
        let index = scratch.active_index().ok_or("No resize document")?;
        scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
        let computed = scratch.close(index).ok_or("No completed Image Size document")?;
        let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
        super::mask_filters::edit_history(engine, LABEL, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
        let state = engine.active_mut().ok_or("No image document")?;
        state.channel_view = computed.channel_view;
        state.selected_layers = computed.selected_layers;
        state.layer_anchor = computed.layer_anchor;
        engine.sync_preset_store();
        engine.journal.push((COMMAND.into(), params.clone()));
        Ok(value)
    })).map_err(|_| format!("`{COMMAND}` failed with an internal error (logged); the document is unchanged"))?
}

#[cfg(test)]
#[path = "xdesign_photo_image_size_tests.rs"]
mod tests;
