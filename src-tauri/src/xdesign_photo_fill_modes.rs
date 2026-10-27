//! Edit › Fill's Behind and Clear modes, which the pinned engine has no blend mode for.
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{Document, LayerId, Rect, Surface},
    EngineError, Session,
};
use photocraft_raster::from_rgba_into;
use serde_json::{json, Value};

const NO_TRANSPARENCY: &str = "Behind and Clear need a layer whose transparency is not locked";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != "edit.fill" {
        return None;
    }
    let behind = match params["mode"].as_str().map(str::to_ascii_lowercase).as_deref() {
        Some("behind") => true,
        Some("clear") => false,
        _ => return None,
    };
    Some(fill(engine, params, behind))
}

fn opacity(params: &Value) -> Result<f32, String> {
    match params.get("opacity") {
        None | Some(Value::Null) => Ok(1.0),
        Some(value) => value.as_f64().filter(|v| v.is_finite()).map(|v| (v.clamp(0.0, 100.0) / 100.0) as f32).ok_or_else(|| format!("Fill opacity must be a number 0..100, not {value}")),
    }
}

fn fill(engine: &mut Session, params: &Value, behind: bool) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason("edit.fill") {
        return Err(reason);
    }
    let opacity = opacity(params)?;
    let state = engine.active().ok_or("No image document")?;
    // Photoshop disables both modes wherever there is no transparency to paint behind or clear.
    let routed = match params.get("target") {
        None => !super::history::effective_target(state).is_null(),
        Some(target) => target != "pixels",
    };
    if routed || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err(NO_TRANSPARENCY.into());
    }
    let layer = params["layer"].as_u64().map(LayerId).or(state.active_layer).ok_or("No active layer")?;
    let target = state.doc.layer(layer).ok_or("The fill layer no longer exists")?;
    if target.locks.pixels || target.locks.all {
        return Err(format!("Could not complete your request because the layer \"{}\" is locked", target.name));
    }
    if target.locks.transparency || !target.surface().is_some_and(|surface| surface.format().alpha) {
        return Err(NO_TRANSPARENCY.into());
    }
    let bounds = state.doc.bounds();
    let selection = state.doc.selection.clone();
    let area = selection.as_ref().map_or(bounds, |selection| selection.content_bounds()).intersect(&bounds);
    let (colors, result) = if behind { let (colors, cleared, result) = fill_colors(engine, params, layer, area)?; (Some((colors, cleared)), result) } else { (None, json!({"contents": params.get("contents").cloned().unwrap_or_else(|| json!("color"))})) };
    if area.is_empty() {
        return Ok(result);
    }
    engine
        .edit("Fill", |doc, _| {
            let surface = doc.layer_mut(layer).and_then(|layer| layer.surface_mut()).ok_or_else(|| EngineError::Other("not a pixel layer".into()))?;
            let format = surface.format();
            let (channels, width) = (format.channels(), area.width() as usize);
            let (mut dst, mut fill, mut encoded) = (Vec::new(), Vec::new(), [0.0; 8]);
            for y in (area.y0..area.y1).step_by(256) {
                let rect = Rect::new(area.x0, y, area.x1, (y + 256).min(area.y1));
                let count = width * rect.height() as usize;
                let mut raw = surface.read_region(rect);
                dst.resize(count, [0.0; 4]);
                surface.read_rgba_into(rect, &mut dst);
                let cover = selection.as_ref().map(|selection| (selection.read_region(rect), selection.format().channels()));
                if let Some((colors, _)) = &colors {
                    fill.resize(count, [0.0; 4]);
                    colors.read_rgba_into(rect, &mut fill);
                }
                let mut changed = false;
                for (index, &d) in dst.iter().enumerate() {
                    let coverage = cover.as_ref().map_or(1.0, |(cover, stride)| cover[index * stride]) * opacity;
                    let out = match &colors {
                        // The cleared copy's alpha already carries the selection coverage (and any pattern transparency).
                        Some((_, cleared)) => under(d, fill[index], if *cleared { fill[index][3] * opacity } else { coverage }),
                        None => [d[0], d[1], d[2], d[3] * (1.0 - coverage)],
                    };
                    if out != d {
                        let samples = from_rgba_into(&format, out, &mut encoded);
                        raw[index * channels..][..samples].copy_from_slice(&encoded[..samples]);
                        changed = true;
                    }
                }
                if changed {
                    surface.write_region(rect, &raw);
                }
            }
            surface.prune();
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push(("edit.fill".into(), params.clone()));
    Ok(result)
}

/// `dst` over the fill colour at `alpha`: existing pixels stay on top.
fn under(dst: [f32; 4], fill: [f32; 4], alpha: f32) -> [f32; 4] {
    let a = dst[3] + alpha * (1.0 - dst[3]);
    if alpha <= 0.0 || dst[3] >= 1.0 || a <= 0.0 {
        return dst;
    }
    let mix = |c: usize| (dst[c] * dst[3] + fill[c] * alpha * (1.0 - dst[3])) / a;
    [mix(0), mix(1), mix(2), a]
}

/// The engine's Fill (any contents) at Normal 100 % onto a cleared copy of the layer gives each pixel's fill colour,
/// with the selection coverage as alpha. Content-Aware samples the layer around the selection, so it fills the original.
fn fill_colors(engine: &Session, params: &Value, layer: LayerId, area: Rect) -> Result<(Surface, bool, Value), String> {
    let state = engine.active().ok_or("No image document")?;
    let mut scratch = Session::new();
    scratch.add_document(Document::new("Fill", state.doc.size, state.doc.mode, state.doc.depth), None);
    *scratch.active_mut().ok_or("No image document")? = state.clone();
    scratch.tools = engine.tools.clone();
    scratch.presets = engine.presets.clone();
    scratch.patterns = engine.patterns.clone();
    let cleared = params["contents"] != "contentAware";
    if cleared && !area.is_empty() {
        scratch
            .edit("Clear fill target", |doc, _| {
                if let Some(surface) = doc.layer_mut(layer).and_then(|layer| layer.surface_mut()) {
                    let channels = surface.format().channels();
                    surface.fill_rect(area, &vec![0.0; channels]);
                }
                Ok(())
            })
            .map_err(|error| error.to_string())?;
    }
    let mut request = params.clone();
    let object = request.as_object_mut().ok_or("Invalid Fill parameters")?;
    for (key, value) in [("mode", json!("normal")), ("opacity", json!(100)), ("preserveTransparency", json!(false)), ("layer", json!(layer.0)), ("target", json!("pixels"))] {
        object.insert(key.into(), value);
    }
    let result = scratch.execute("edit.fill", request).map_err(|error| error.to_string())?;
    let colors = scratch.active().and_then(|state| state.doc.layer(layer)).and_then(|layer| layer.surface()).cloned().ok_or("The fill layer no longer exists")?;
    Ok((colors, cleared, result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Layer, SampleType, Size};
    use serde_json::json;

    fn session(pixels: &[[f32; 4]]) -> Session {
        let mut doc = Document::new("Fill modes", Size::new(pixels.len() as u32, 1), ColorMode::Rgb, SampleType::U8);
        let mut layer = Layer::raster("Layer 1", doc.pixel_format());
        let data: Vec<f32> = pixels.iter().flatten().copied().collect();
        layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
        doc.layers.push(layer);
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine
    }
    fn px(engine: &Session, x: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, 0)
    }
    fn close(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= 1.5 / 255.0)
    }
    fn fill(engine: &mut Session, params: Value) -> Result<Value, String> {
        execute(engine, "edit.fill", &params).expect("Behind and Clear are handled here")
    }

    #[test]
    fn behind_keeps_opaque_pixels_and_fills_transparent_ones() {
        let mut engine = session(&[[0.0, 0.0, 1.0, 1.0], [0.0; 4], [0.0, 0.0, 1.0, 0.5]]);
        let past = engine.active().unwrap().history.past_len();
        fill(&mut engine, json!({"contents": "color", "color": "#ff0000", "mode": "Behind"})).unwrap();
        assert!(close(px(&engine, 0), [0.0, 0.0, 1.0, 1.0]), "{:?}", px(&engine, 0));
        assert!(close(px(&engine, 1), [1.0, 0.0, 0.0, 1.0]), "{:?}", px(&engine, 1));
        assert!(close(px(&engine, 2), [0.5, 0.0, 0.5, 1.0]), "{:?}", px(&engine, 2));
        let history = &engine.active().unwrap().history;
        assert_eq!((history.past_len(), history.undo_label()), (past + 1, Some("Fill")));
    }

    #[test]
    fn clear_scales_alpha_by_coverage_and_opacity() {
        let mut engine = session(&[[0.2, 0.4, 0.6, 1.0], [0.2, 0.4, 0.6, 1.0]]);
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 1, "height": 1})).unwrap();
        fill(&mut engine, json!({"mode": "Clear", "opacity": 50})).unwrap();
        assert!(close(px(&engine, 0), [0.2, 0.4, 0.6, 128.0 / 255.0]), "{:?}", px(&engine, 0));
        assert_eq!(px(&engine, 1), [0.2, 0.4, 0.6, 1.0]);
    }

    #[test]
    fn behind_on_empty_layer_matches_normal() {
        let mut engine = session(&[[0.0; 4], [0.0; 4]]);
        engine.execute("select.rect", json!({"x": 1, "y": 0, "width": 1, "height": 1})).unwrap();
        let state = engine.active().unwrap().clone();
        let mut normal = Session::new();
        normal.add_document((*state.doc).clone(), None);
        *normal.active_mut().unwrap() = state;
        normal.execute("edit.fill", json!({"contents": "color", "color": "#336699", "opacity": 60})).unwrap();
        fill(&mut engine, json!({"contents": "color", "color": "#336699", "opacity": 60, "mode": "behind"})).unwrap();
        for x in 0..2 {
            assert!(close(px(&engine, x), px(&normal, x)), "{x}: {:?} vs {:?}", px(&engine, x), px(&normal, x));
        }
    }

    #[test]
    fn non_special_modes_fall_through() {
        let mut engine = session(&[[0.0; 4]]);
        for mode in ["Normal", "Dissolve", "Multiply"] {
            assert!(execute(&mut engine, "edit.fill", &json!({"mode": mode})).is_none());
        }
        assert!(execute(&mut engine, "edit.fill", &json!({})).is_none());
        assert!(execute(&mut engine, "edit.stroke", &json!({"mode": "Behind"})).is_none());
    }

    #[test]
    fn behind_and_clear_need_unlocked_layer_transparency() {
        let mut engine = session(&[[0.2, 0.4, 0.6, 1.0]]);
        let layer = engine.active().unwrap().active_layer.unwrap();
        engine.execute("layer.mask.add", json!({"reveal": true})).ok();
        for params in [json!({"mode": "Clear", "target": "mask"}), json!({"mode": "Behind", "target": {"channel": 0}})] {
            let before = engine.active().unwrap().doc.clone();
            assert!(fill(&mut engine, params).is_err());
            assert!(std::sync::Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        }
        engine.edit("Lock", |doc, _| { doc.layer_mut(layer).unwrap().locks.transparency = true; Ok(()) }).unwrap();
        let before = engine.active().unwrap().doc.clone();
        assert!(fill(&mut engine, json!({"mode": "Clear"})).is_err());
        assert!(std::sync::Arc::ptr_eq(&before, &engine.active().unwrap().doc));
    }
}
