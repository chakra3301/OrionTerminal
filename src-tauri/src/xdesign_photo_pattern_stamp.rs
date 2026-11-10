//! Photoshop's Pattern Stamp Tool, which the pinned engine has no command for: Clone Stamp's brush
//! coverage, painting a tiled pattern instead of sampled pixels.
use std::sync::Arc;

use photocraft_compose::pattern::{render, Placement, Tile};
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    commands::blend_from_str,
    doc::{BlendMode, Document, LayerId, Rect},
    paint::{
        retouch::{apply_coverage, stroke_coverage, Region},
        BrushSettings, Stroke, StrokePoint,
    },
    pattern_cmds, EngineError, Session,
};
use photocraft_raster::from_rgba_into;
use serde_json::{json, Value};

pub(super) const COMMAND: &str = "paint.patternStamp";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    (command == COMMAND).then(|| stamp(engine, params))
}

/// The stamped image and the area it changed, with no history step, for live feedback.
pub(super) fn preview(engine: &Session, params: &Value) -> Result<(Arc<Document>, Rect), String> {
    let job = Job::new(engine, params)?;
    let mut doc = (*engine.active().ok_or("No image document")?.doc).clone();
    let damage = job.paint(&mut doc)?;
    Ok((Arc::new(doc), damage))
}

fn stamp(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let job = Job::new(engine, params)?;
    let fade = super::mask_filters::FadeTarget::Pixels(job.layer);
    let damage = super::mask_filters::commit_host_edit(engine, COMMAND, params, "Pattern Stamp", Some(fade), |doc, _| job.paint(doc).map_err(EngineError::Other))?;
    if let Some(state) = engine.active_mut() {
        state.last_damage = Some(damage);
    }
    Ok(json!({"damage": [damage.x0, damage.y0, damage.width(), damage.height()], "pattern": job.pattern}))
}

struct Job {
    layer: LayerId,
    stroke: Stroke,
    mode: BlendMode,
    tile: Tile,
    place: Placement,
    pattern: String,
}

impl Job {
    fn new(engine: &Session, params: &Value) -> Result<Job, String> {
        if let Some(reason) = engine.disabled_reason("paint.stroke") {
            return Err(reason);
        }
        let state = engine.active().ok_or("No image document")?;
        let routed = params.get("target").is_some_and(|target| target != "pixels");
        if routed || !super::history::effective_target(state).is_null() || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
            return Err("The Pattern Stamp Tool paints the layer's pixels, not a mask or a single channel".into());
        }
        let layer = params["layer"].as_u64().map(LayerId).or(state.active_layer).ok_or("No active layer")?;
        let target = state.doc.layer(layer).ok_or("The layer no longer exists")?;
        if target.locks.pixels || target.locks.all {
            return Err(format!("Could not use the Pattern Stamp Tool because the layer \"{}\" is locked", target.name));
        }
        if target.surface().is_none() {
            return Err("Could not use the Pattern Stamp Tool because the target layer is not a pixel layer".into());
        }
        let points: Vec<StrokePoint> = params["points"]
            .as_array()
            .ok_or("Pattern Stamp needs stroke points")?
            .iter()
            .filter_map(|point| {
                let point = point.as_array()?;
                Some(StrokePoint::new(point.first()?.as_f64()?, point.get(1)?.as_f64()?, point.get(2).and_then(Value::as_f64).unwrap_or(1.0) as f32))
            })
            .collect();
        let first = *points.first().ok_or("Pattern Stamp needs stroke points")?;
        // The same percentages and ranges as the engine's Clone Stamp.
        let base = engine.tools.brush.clone();
        let number = |key: &str, default: f32| params[key].as_f64().map_or(default, |value| value as f32);
        let percent = |key: &str, default: f32, low: f32, high: f32| number(key, default).clamp(low, high) / 100.0;
        let brush = BrushSettings {
            size: number("size", base.size).max(1.0),
            hardness: percent("hardness", base.hardness * 100.0, 0.0, 100.0),
            opacity: percent("opacity", 100.0, 1.0, 100.0),
            flow: percent("flow", 100.0, 1.0, 100.0),
            spacing: percent("spacing", 25.0, 1.0, 1000.0),
            erase: false,
            ..base
        };
        let mode = match params["mode"].as_str() {
            None => BlendMode::Normal,
            Some(mode) => blend_from_str(mode).ok_or_else(|| format!("Unknown Pattern Stamp mode \"{mode}\""))?,
        };
        let key = params["pattern"].as_str().unwrap_or("");
        let pattern = pattern_cmds::resolve(engine, key).ok_or_else(|| if key.is_empty() { "Choose a pattern for the Pattern Stamp Tool".to_string() } else { format!("No pattern \"{key}\"") })?;
        let tile = Tile::new(&pattern).ok_or("The pattern is empty")?;
        // Aligned tiles from the image origin across strokes; otherwise each stroke centres the pattern where it starts.
        let phase = if params["aligned"].as_bool().unwrap_or(true) { (0.0, 0.0) } else { ((first.x - f64::from(pattern.width) / 2.0) as f32, (first.y - f64::from(pattern.height) / 2.0) as f32) };
        let place = Placement::new(Rect::EMPTY, false, phase, 1.0, 0.0);
        Ok(Job { layer, stroke: Stroke { brush, points }, mode, tile, place, pattern: pattern.id })
    }

    fn paint(&self, doc: &mut Document) -> Result<Rect, String> {
        let (bounds, coverage) = stroke_coverage(&self.stroke);
        let area = bounds.intersect(&doc.bounds());
        if area.is_empty() {
            return Ok(Rect::EMPTY);
        }
        let selection = doc.selection.clone();
        let layer = doc.layer_mut(self.layer).ok_or("The layer no longer exists")?;
        let lock = layer.locks.transparency;
        let surface = layer.surface_mut().ok_or("not a pixel layer")?;
        let format = surface.format();
        let channels = format.channels();
        let (width, stride) = (area.width() as usize, bounds.width() as usize);
        let pattern = render(&self.tile, &self.place, area);
        let mut paint = Region::new(area, channels);
        let mut cover = Vec::with_capacity(pattern.len());
        let mut encoded = [0.0; 8];
        for (index, pixel) in pattern.iter().enumerate() {
            let (x, y) = ((area.x0 - bounds.x0) as usize + index % width, (area.y0 - bounds.y0) as usize + index / width);
            // Pattern transparency scales the coverage, so it also shows on a layer without alpha.
            cover.push(coverage[y * stride + x] * pixel[3]);
            let samples = from_rgba_into(&format, [pixel[0], pixel[1], pixel[2], 1.0], &mut encoded);
            paint.data[index * channels..][..samples].copy_from_slice(&encoded[..samples]);
        }
        Ok(apply_coverage(surface, area, &cover, self.stroke.brush.opacity, selection.as_ref(), lock, &paint, self.mode))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A mid-grey 64×32 image; the first built-in pattern is a 16 px checkerboard of 0.8 and 1.0 grey.
    fn image() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"name": "Stamp", "width": 64, "height": 32, "background": "white"})).unwrap();
        engine.execute("edit.fill", json!({"color": "#000000"})).unwrap();
        engine
    }
    fn px(engine: &Session, x: i32, y: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, y)
    }
    fn stamp(engine: &mut Session, params: Value) -> Result<Value, String> {
        execute(engine, COMMAND, &params).expect("Pattern Stamp is handled here")
    }
    fn near(value: f32, expected: f32) -> bool {
        (value - expected).abs() <= 1.5 / 255.0
    }

    #[test]
    fn paints_the_pattern_aligned_to_the_image_in_one_history_step() {
        let mut engine = image();
        let past = engine.active().unwrap().history.past_len();
        let result = stamp(&mut engine, json!({"points": [[4, 16], [60, 16]], "size": 20, "hardness": 100})).unwrap();
        assert_eq!(result["pattern"], json!(engine.patterns.items[0].id));
        // Squares of 8 px alternate 0.8 and 1.0 from the image origin.
        for (x, grey) in [(2, 0.8), (12, 1.0), (20, 0.8), (28, 1.0)] {
            assert!(near(px(&engine, x, 20)[0], grey), "{x}: {:?}", px(&engine, x, 20));
        }
        assert_eq!(px(&engine, 30, 0)[0], 0.0, "outside the brush stays black");
        let history = &engine.active().unwrap().history;
        assert_eq!((history.past_len(), history.undo_label()), (past + 1, Some("Pattern Stamp")));
        assert_eq!(engine.journal.last().unwrap().0, COMMAND);
        assert_eq!(engine.active().unwrap().last_damage.map(|damage| damage.width() > 50), Some(true));
        assert!(engine.is_enabled("edit.fade"));
        super::super::execute_view_command(&mut engine, "edit.fade", json!({"opacity": 50})).unwrap();
        assert!(near(px(&engine, 12, 20)[0], 0.5), "{:?}", px(&engine, 12, 20));
    }

    #[test]
    fn unaligned_strokes_centre_the_pattern_on_their_start() {
        let mut engine = image();
        stamp(&mut engine, json!({"points": [[20, 16], [44, 16]], "size": 20, "hardness": 100, "aligned": false})).unwrap();
        // The tile's corner moves to (12, 8), so its first 0.8 square spans x 12..20.
        assert!(near(px(&engine, 14, 10)[0], 0.8), "{:?}", px(&engine, 14, 10));
        assert!(near(px(&engine, 22, 10)[0], 1.0), "{:?}", px(&engine, 22, 10));
    }

    #[test]
    fn opacity_mode_and_selection_shape_the_paint() {
        let mut engine = image();
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 32, "height": 32})).unwrap();
        stamp(&mut engine, json!({"points": [[4, 16], [60, 16]], "size": 20, "hardness": 100, "opacity": 50})).unwrap();
        assert!(near(px(&engine, 2, 20)[0], 0.4), "{:?}", px(&engine, 2, 20));
        assert_eq!(px(&engine, 40, 20)[0], 0.0, "outside the selection stays black");
        let mut multiply = image();
        stamp(&mut multiply, json!({"points": [[4, 16], [60, 16]], "size": 20, "hardness": 100, "mode": "Multiply"})).unwrap();
        assert_eq!(px(&multiply, 2, 20)[0], 0.0, "black multiplied stays black");
    }

    #[test]
    fn preview_matches_the_edit_without_touching_history() {
        let mut engine = image();
        let params = json!({"points": [[4, 16], [60, 16]], "size": 12, "hardness": 50, "flow": 60});
        let before = engine.active().unwrap().doc.clone();
        let (preview, damage) = preview(&engine, &params).unwrap();
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        stamp(&mut engine, params).unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap();
        let committed = engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().read_region(damage);
        assert_eq!(preview.layer(layer).unwrap().surface().unwrap().read_region(damage), committed);
    }

    #[test]
    fn refuses_locked_layers_masks_and_missing_patterns() {
        let mut engine = image();
        let params = json!({"points": [[4, 16]], "size": 12});
        let before = engine.active().unwrap().doc.clone();
        assert!(stamp(&mut engine, json!({"points": [[4, 16]], "size": 12, "target": "mask"})).is_err());
        assert!(stamp(&mut engine, json!({"points": [[4, 16]], "size": 12, "pattern": "No such pattern"})).is_err());
        assert!(stamp(&mut engine, json!({"points": [], "size": 12})).is_err());
        engine.patterns.items.clear();
        assert!(stamp(&mut engine, params.clone()).is_err());
        let mut locked = image();
        let layer = locked.active().unwrap().active_layer.unwrap();
        locked.edit("Lock", |doc, _| { doc.layer_mut(layer).unwrap().locks.pixels = true; Ok(()) }).unwrap();
        assert!(stamp(&mut locked, params).is_err());
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        assert!(execute(&mut engine, "paint.cloneStamp", &json!({})).is_none());
    }
}
