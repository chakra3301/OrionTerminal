use photocraft_engine::{doc::{Document, Layer, LayerContent, LayerId, Rect}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::sync::Arc;

#[path = "xdesign_photo_sparse_surfaces.rs"]
mod sparse;

#[path = "xdesign_photo_trim.rs"]
mod trim;

const CANVAS: &str = "image.canvasSize";
const CROP: &str = "image.crop";
const TRIM: &str = "image.trim";
const LIMIT: &str = "Requested dimensions exceed the 256 megapixel editing limit";
const COORDINATES: &str = "Canvas or crop coordinates exceed the supported pixel range";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if ![CANVAS, CROP, TRIM].contains(&command) || !(params.is_object() || params.is_null()) { return None; }
    Some(run_with(engine, command, params))
}

struct Geometry {
    dx: i32,
    dy: i32,
    crop: Option<Rect>,
    old_canvas: Rect,
    extension: Option<[f32; 4]>,
    native_params: Value,
}

fn checked_rect(x0: i64, y0: i64, x1: i64, y1: i64) -> Result<Rect, String> {
    let coordinate = |v| i32::try_from(v).map_err(|_| COORDINATES.to_owned());
    if x1.checked_sub(x0).is_none_or(|v| v > i64::from(i32::MAX))
        || y1.checked_sub(y0).is_none_or(|v| v > i64::from(i32::MAX)) { return Err(COORDINATES.into()); }
    Ok(Rect::new(coordinate(x0)?, coordinate(y0)?, coordinate(x1)?, coordinate(y1)?))
}

fn integer(params: &Value, key: &str) -> Option<i64> {
    params.get(key).and_then(|value| value.as_i64().or_else(|| value.as_f64().filter(|v| v.is_finite()).map(|v| v.round() as i64)))
}

fn extension_color(engine: &Session, params: &Value) -> [f32; 4] {
    match params.get("extensionColor").and_then(Value::as_str).unwrap_or("background") {
        "foreground" => engine.tools.foreground,
        "white" => [1.; 4],
        "black" => [0., 0., 0., 1.],
        "transparent" => [0.; 4],
        hex if hex.starts_with('#') => {
            let hex = hex.trim_start_matches('#');
            let channel = |i| hex.get(i..i + 2).and_then(|value| u8::from_str_radix(value, 16).ok()).map_or(0., |v| f32::from(v) / 255.);
            [channel(0), channel(2), channel(4), 1.]
        }
        _ => engine.tools.background,
    }
}

fn geometry(engine: &Session, command: &str, params: &Value) -> Result<Geometry, String> {
    let state = engine.active().ok_or("No image document")?;
    let (width, height) = (state.doc.size.width, state.doc.size.height);
    let old = checked_rect(0, 0, i64::from(width), i64::from(height))?;
    let mut native_params = if params.is_null() { json!({}) } else { params.clone() };
    if command == CANVAS {
        super::super::preview::validate_geometry_input(engine, command, params)?;
        let relative = params.get("relative").and_then(Value::as_bool).unwrap_or(false);
        let dimension = |key, old: u32| {
            let requested = params.get(key).and_then(Value::as_f64).unwrap_or(if relative { 0. } else { f64::from(old) });
            (if relative { f64::from(old) + requested } else { requested }).round().clamp(1., 300_000.) as u32
        };
        let (w, h) = (dimension("width", width), dimension("height", height));
        let anchor = params.get("anchor").and_then(Value::as_str).unwrap_or("center");
        let ax = if anchor.contains("Left") || anchor == "left" { 0. } else if anchor.contains("Right") || anchor == "right" { 1. } else { 0.5 };
        let ay = if anchor.starts_with("top") { 0. } else if anchor.starts_with("bottom") { 1. } else { 0.5 };
        let dx = ((f64::from(w) - f64::from(width)) * ax).round() as i32;
        let dy = ((f64::from(h) - f64::from(height)) * ay).round() as i32;
        let old_canvas = checked_rect(i64::from(dx), i64::from(dy), i64::from(dx) + i64::from(width), i64::from(dy) + i64::from(height))?;
        // Native extension would still fill the whole canvas while all pixel payloads are suppressed.
        native_params["extensionColor"] = json!("transparent");
        return Ok(Geometry { dx, dy, crop: None, old_canvas, extension: Some(extension_color(engine, params)), native_params });
    }
    let explicit = if command == TRIM { Some(trim::bounds(engine, params)?) } else { match (integer(params, "x"), integer(params, "y"), integer(params, "width"), integer(params, "height")) {
        (Some(x), Some(y), Some(w), Some(h)) if w > 0 && h > 0 => {
            let x1 = x.checked_add(w).ok_or(COORDINATES)? as i32;
            let y1 = y.checked_add(h).ok_or(COORDINATES)? as i32;
            Some(checked_rect(i64::from(x as i32), i64::from(y as i32), i64::from(x1), i64::from(y1))?)
        }
        _ => None,
    } };
    let rect = match explicit {
        Some(rect) => rect,
        None => match state.doc.selection.as_ref() {
            Some(surface) => surface_bounds(surface)?.intersect(&old),
            None => Rect::EMPTY,
        },
    };
    if rect.is_empty() {
        return Err(photocraft_engine::EngineError::Other("nothing to crop: pass x/y/width/height or make a selection".into()).to_string());
    }
    if u64::from(rect.width()) * u64::from(rect.height()) > super::super::MAX_PIXELS { return Err(LIMIT.into()); }
    let dx = rect.x0.checked_neg().ok_or(COORDINATES)?;
    let dy = rect.y0.checked_neg().ok_or(COORDINATES)?;
    native_params["x"] = json!(rect.x0);
    native_params["y"] = json!(rect.y0);
    native_params["width"] = json!(rect.width());
    native_params["height"] = json!(rect.height());
    let delete = command == TRIM || params.get("deleteCroppedPixels").and_then(Value::as_bool).unwrap_or(true);
    if command == TRIM { native_params["deleteCroppedPixels"] = json!(true); }
    Ok(Geometry { dx, dy, crop: delete.then_some(rect), old_canvas: old, extension: None, native_params })
}

enum Pixels {
    Raster(Surface),
    Text(Option<Surface>),
    Smart(Option<Surface>),
    Other,
}

struct LayerPixels {
    id: LayerId,
    mask: Option<Surface>,
    fill: Option<Surface>,
    content: Pixels,
}

fn suppress(surface: &mut Surface) -> Surface {
    let empty = Surface::with_default(surface.format(), &surface.default_pixel());
    std::mem::replace(surface, empty)
}

fn surface_bounds(surface: &Surface) -> Result<Rect, String> {
    sparse::validate(surface)?;
    Ok(surface.content_bounds())
}

fn suppress_layers(layers: &mut [Layer], saved: &mut Vec<LayerPixels>) {
    for layer in layers {
        let mask = layer.mask.as_mut().map(|mask| suppress(&mut mask.surface));
        let fill = layer.fill_cache.as_mut().map(|cache| suppress(&mut cache.surface));
        let content = match &mut layer.content {
            LayerContent::Raster(surface) => Pixels::Raster(suppress(surface)),
            LayerContent::Text(text) => Pixels::Text(text.cache.as_mut().map(suppress)),
            LayerContent::Smart(smart) => Pixels::Smart(smart.cache.as_mut().map(suppress)),
            LayerContent::Shape(shape) => { shape.cache = None; Pixels::Other }
            _ => Pixels::Other,
        };
        saved.push(LayerPixels { id: layer.id, mask, fill, content });
        if let Some(children) = layer.children_mut() { suppress_layers(children, saved); }
    }
}

fn moved(surface: Surface, geometry: &Geometry, content: bool) -> Result<Surface, String> {
    let keep = if content { geometry.crop } else { None };
    if geometry.dx == 0 && geometry.dy == 0 && keep.is_none() { return Ok(surface); }
    sparse::translate_crop(&surface, i64::from(geometry.dx), i64::from(geometry.dy), keep)
}

fn restore_layers(layers: &mut [Layer], saved: &mut impl Iterator<Item = LayerPixels>, geometry: &Geometry) -> Result<(), String> {
    for layer in layers {
        let pixels = saved.next().ok_or("Canvas operation lost a prepared layer")?;
        if pixels.id != layer.id { return Err("Canvas operation changed its layer order".into()); }
        if let Some(surface) = pixels.mask { layer.mask.as_mut().ok_or("Canvas operation lost a mask")?.surface = moved(surface, geometry, false)?; }
        if let Some(surface) = pixels.fill { layer.fill_cache.as_mut().ok_or("Canvas operation lost a fill cache")?.surface = moved(surface, geometry, true)?; }
        match (pixels.content, &mut layer.content) {
            (Pixels::Raster(surface), LayerContent::Raster(target)) => *target = moved(surface, geometry, true)?,
            (Pixels::Text(surface), LayerContent::Text(target)) => target.cache = surface.map(|surface| moved(surface, geometry, true)).transpose()?,
            (Pixels::Smart(surface), LayerContent::Smart(target)) => target.cache = surface.map(|surface| moved(surface, geometry, true)).transpose()?,
            (Pixels::Other, _) => {}
            _ => return Err("Canvas operation changed a layer's content type".into()),
        }
        if let Some(children) = layer.children_mut() { restore_layers(children, saved, geometry)?; }
    }
    Ok(())
}

fn extend_background(doc: &mut Document, geometry: &Geometry) -> Result<(), String> {
    let Some(extension) = geometry.extension.filter(|color| color[3] > 0.) else { return Ok(()); };
    let canvas = doc.bounds();
    let Some(layer) = doc.layers.first_mut() else { return Ok(()); };
    if layer.name != "Background" || !layer.locks.transparency { return Ok(()); }
    let LayerContent::Raster(surface) = &mut layer.content else { return Ok(()); };
    let keep = surface_bounds(surface)?.intersect(&geometry.old_canvas);
    let pixel = photocraft_raster::from_rgba(&surface.format(), extension);
    let protected = keep.intersect(&canvas);
    if protected.is_empty() {
        surface.fill_rect(canvas, &pixel);
    } else {
        // Starting with the moved source already preserves the native saved keep rectangle,
        // including default holes and pixels outside the new canvas.
        for rect in [
            Rect::new(canvas.x0, canvas.y0, canvas.x1, protected.y0),
            Rect::new(canvas.x0, protected.y1, canvas.x1, canvas.y1),
            Rect::new(canvas.x0, protected.y0, protected.x0, protected.y1),
            Rect::new(protected.x1, protected.y0, canvas.x1, protected.y1),
        ] {
            if !rect.is_empty() { surface.fill_rect(rect, &pixel); }
        }
    }
    Ok(())
}

pub(super) fn run_with(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
    if ![CANVAS, CROP, TRIM].contains(&command) || !(params.is_object() || params.is_null()) {
        return engine.execute(command, params.clone()).map_err(|error| error.to_string());
    }
    if let Some(reason) = engine.disabled_reason(command) {
        return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string());
    }
    let (value, mut scratch) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let geometry = geometry(engine, command, params)?;
        let original = engine.active().ok_or("No image document")?;
        let draft = super::super::snapshot::capture(original, super::super::snapshot::HistoryPolicy::Discard);
        let mut scratch = Session::new();
        scratch.add_document(Document::new("Canvas operation", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
        *scratch.active_mut().ok_or("No private canvas document")? = draft;
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No private canvas document")?.doc);
        let mut saved = Vec::new();
        suppress_layers(&mut doc.layers, &mut saved);
        let channels: Vec<_> = doc.channels.iter_mut().chain(doc.quick_mask.as_mut()).map(|channel| suppress(&mut channel.surface)).collect();
        let selection = doc.selection.take();
        let private_command = if command == TRIM { CROP } else { command };
        let value = scratch.execute(private_command, geometry.native_params.clone()).map_err(|error| error.to_string())?;
        scratch.active_mut().ok_or("No private canvas document")?.history = Default::default();
        let doc = Arc::make_mut(&mut scratch.active_mut().ok_or("No private canvas document")?.doc);
        let mut saved = saved.into_iter();
        restore_layers(&mut doc.layers, &mut saved, &geometry)?;
        if saved.next().is_some() { return Err("Canvas operation retained an unexpected prepared layer".into()); }
        let mut channels = channels.into_iter();
        for channel in doc.channels.iter_mut().chain(doc.quick_mask.as_mut()) {
            channel.surface = moved(channels.next().ok_or("Canvas operation lost a prepared channel")?, &geometry, false)?;
        }
        if channels.next().is_some() { return Err("Canvas operation retained an unexpected prepared channel".into()); }
        doc.selection = if command == CROP { None } else { selection.map(|surface| moved(surface, &geometry, false)).transpose()? };
        extend_background(doc, &geometry)?;
        scratch.active_mut().ok_or("No private canvas document")?.channel_view = original.channel_view.clone();
        let index = scratch.active_index().ok_or("No private canvas document")?;
        scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
        Ok::<_, String>((value, scratch))
    })).map_err(|_| format!("`{command}` failed with an internal error (logged); the document is unchanged"))??;
    let index = scratch.active_index().ok_or("No completed canvas document")?;
    let computed = scratch.close(index).ok_or("No completed canvas document")?;
    let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
    let label = match command { CANVAS => "Canvas Size", TRIM => "Trim", _ => "Crop" };
    super::super::mask_filters::edit_history(engine, label, params, |doc, active| { *doc = document; *active = computed.active_layer; Ok(()) })?;
    let state = engine.active_mut().ok_or("No image document")?;
    state.channel_view = computed.channel_view;
    state.selected_layers = computed.selected_layers;
    state.layer_anchor = computed.layer_anchor;
    engine.sync_preset_store();
    engine.journal.push((command.into(), params.clone()));
    Ok(value)
}

#[cfg(test)]
#[path = "xdesign_photo_canvas_crop_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "xdesign_photo_canvas_crop_host_tests.rs"]
mod host_tests;
