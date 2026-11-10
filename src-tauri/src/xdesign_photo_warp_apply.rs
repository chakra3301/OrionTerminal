use photocraft_algo::{transform::Interp, warp::warp_mesh_surface};
use photocraft_engine::{doc::{Document, Layer, LayerContent, LayerId, PixelFormat, Rect}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::sync::Arc;

enum GrayTarget { LayerMask, FilterMask }

pub(super) struct Prepared {
    params: Value,
    rect: Rect,
    selection: Option<Surface>,
    masks: Vec<(LayerId, GrayTarget, Surface)>,
    selected_raster: Option<(LayerId, Surface)>,
}

pub(super) fn needed(doc: &Document, layer: &Layer) -> bool {
    doc.selection.is_some() || has_mask(layer)
}

fn has_mask(layer: &Layer) -> bool {
    layer.mask.as_ref().is_some_and(|mask| mask.linked)
        || matches!(&layer.content, LayerContent::Smart(smart) if smart.filter_mask.is_some())
        || layer.children().is_some_and(|children| children.iter().any(has_mask))
}

fn save_masks(layer: &Layer, saved: &mut Vec<(LayerId, GrayTarget, Surface)>) {
    if let Some(mask) = layer.mask.as_ref().filter(|mask| mask.linked) {
        saved.push((layer.id, GrayTarget::LayerMask, mask.surface.clone()));
    }
    if let LayerContent::Smart(smart) = &layer.content {
        if let Some(mask) = &smart.filter_mask {
            saved.push((layer.id, GrayTarget::FilterMask, mask.surface.clone()));
        }
    }
    if let Some(children) = layer.children() { for child in children { save_masks(child, saved); } }
}

impl GrayTarget {
    fn surface<'a>(&self, doc: &'a mut Document, id: LayerId) -> Result<&'a mut Surface, String> {
        let layer = doc.layer_mut(id).ok_or("No gray warp layer")?;
        match self {
            Self::LayerMask => layer.mask.as_mut().map(|mask| &mut mask.surface).ok_or_else(|| "The warp layer mask changed".into()),
            Self::FilterMask => match &mut layer.content {
                LayerContent::Smart(smart) => smart.filter_mask.as_mut().map(|mask| &mut mask.surface).ok_or_else(|| "The Smart warp filter mask changed".into()),
                _ => Err("The gray warp layer changed type".into()),
            },
        }
    }
}

pub(super) fn prepare(engine: &mut Session, command: &str, params: &Value) -> Result<Option<Prepared>, String> {
    let state = engine.active().ok_or_else(|| photocraft_engine::EngineError::NoDocument.to_string())?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)
        .ok_or_else(|| photocraft_engine::EngineError::Other("no active layer".into()).to_string())?;
    let layer = state.doc.layer(id).ok_or_else(|| photocraft_engine::EngineError::NoLayer(id).to_string())?;
    let rect = match params.get("rect").and_then(Value::as_array) {
        Some(values) if values.len() == 4 => {
            let value = |index: usize| values[index].as_f64().unwrap_or(0.0).round() as i32;
            Rect::new(value(0), value(1), value(2), value(3))
        }
        _ => photocraft_engine::warp_cmds::warp_bounds(&state.doc, layer),
    };
    if rect.is_empty() {
        return Err(photocraft_engine::EngineError::BadParams { cmd: command.into(), msg: "nothing to warp".into() }.to_string());
    }
    let bounds = [f64::from(rect.x0), f64::from(rect.y0), f64::from(rect.x1), f64::from(rect.y1)];
    let warp = photocraft_engine::warp_cmds::warp_from_params(command, params, bounds).map_err(|error| error.to_string())?;
    if warp.is_identity() && !matches!(layer.content, LayerContent::Smart(_)) { return Ok(None); }
    let selection = state.doc.selection.clone();
    let selected_raster = match (&layer.content, &selection) {
        (LayerContent::Raster(surface), Some(_)) => Some((id, surface.clone())),
        _ => None,
    };
    let mut masks = Vec::new(); save_masks(layer, &mut masks);
    let state = engine.active_mut().ok_or("No private gray warp document")?;
    let doc = Arc::make_mut(&mut state.doc);
    doc.selection = None;
    for (id, target, _) in &masks {
        let surface = target.surface(doc, *id)?;
        *surface = Surface::new(surface.format());
    }
    if let Some((id, original)) = &selected_raster {
        let LayerContent::Raster(surface) = &mut doc.layer_mut(*id).ok_or("No selected warp layer")?.content else { return Err("The selected warp layer changed type".into()); };
        let format = original.format();
        *surface = Surface::new(PixelFormat::new(format.mode, format.sample, true));
    }
    Ok(Some(Prepared { params: params.clone(), rect, selection, masks, selected_raster }))
}

impl Prepared {
    pub(super) fn native_params(&self) -> Value {
        let mut params = if self.params.is_null() { json!({}) } else { self.params.clone() };
        params["rect"] = json!([self.rect.x0, self.rect.y0, self.rect.x1, self.rect.y1]);
        params
    }

    pub(super) fn finish(self, engine: &mut Session, command: &str) -> Result<(), String> {
        let bounds = [f64::from(self.rect.x0), f64::from(self.rect.y0), f64::from(self.rect.x1), f64::from(self.rect.y1)];
        let warp = photocraft_engine::warp_cmds::warp_from_params(command, &self.params, bounds).map_err(|error| error.to_string())?;
        let map = |x: f64, y: f64| warp.map(x, y);
        let interpolation = Interp::parse(self.params.get("interpolation").and_then(Value::as_str).unwrap_or("bicubic"));
        let doc = Arc::make_mut(&mut engine.active_mut().ok_or("No completed gray warp document")?.doc);
        if let Some((id, original)) = self.selected_raster {
            let selection = self.selection.as_ref().ok_or("The selected warp lost its selection")?;
            let (lifted, mut rest) = photocraft_engine::transform_cmds::split_selected(&original, selection);
            let moved = warp_mesh_surface(&lifted, self.rect, &map, interpolation);
            composite_over(&mut rest, &moved); rest.prune();
            let LayerContent::Raster(surface) = &mut doc.layer_mut(id).ok_or("No completed selected warp layer")?.content else { return Err("The selected warp layer changed type".into()); };
            *surface = rest;
        }
        for (id, target, source) in self.masks {
            *target.surface(doc, id)? = super::gray::warp_gray(&source, &map, interpolation);
        }
        doc.selection = self.selection.map(|source| super::gray::warp_gray(&source, &map, Interp::Bilinear)).filter(|surface| !surface.content_bounds().is_empty());
        Ok(())
    }
}

// The native engine keeps this exact straight-alpha composite private.
fn composite_over(destination: &mut Surface, top: &Surface) {
    let bounds = top.content_bounds(); if bounds.is_empty() { return; }
    let channels = destination.format().channels(); let alpha = channels - 1;
    let top_pixels = top.read_region(bounds); let mut under = destination.read_region(bounds);
    for (destination, top) in under.chunks_exact_mut(channels).zip(top_pixels.chunks_exact(channels)) {
        let (top_alpha, under_alpha) = (top[alpha], destination[alpha]);
        let output_alpha = top_alpha + under_alpha * (1.0 - top_alpha);
        if output_alpha > 0.0 {
            for channel in 0..alpha { destination[channel] = (top[channel] * top_alpha + destination[channel] * under_alpha * (1.0 - top_alpha)) / output_alpha; }
        }
        destination[alpha] = output_alpha;
    }
    destination.write_region(bounds, &under);
}

#[cfg(test)]
#[path = "xdesign_photo_warp_apply_tests.rs"]
mod tests;
