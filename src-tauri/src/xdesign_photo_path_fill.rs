//! Fill Path with an inline path (the shape tools' Pixels mode). The engine fills stored paths only
//! (photocraft engine/src/vector_cmds.rs:937), so the path's coverage is painted through Edit › Fill.
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{ColorMode, LayerContent, LayerId, PixelFormat, SampleType, Surface},
    vector_cmds::parse_path,
    EngineError, Session,
};
use serde_json::{json, Value};

const CMD: &str = "path.fill";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD || params.get("path").is_none_or(Value::is_null) {
        return None;
    }
    Some(fill(engine, params))
}

fn fill(engine: &mut Session, params: &Value) -> Result<Value, String> {
    if params.get("name").is_some_and(|name| !name.is_null()) {
        return Err(format!("{CMD}: give a path or a name, not both"));
    }
    let path = parse_path(&params["path"]).map_err(|error| format!("{CMD}: path: {error}"))?;
    let color = super::mixer_reservoir::color(CMD, params.get("color").filter(|color| !color.is_null()).ok_or_else(|| format!("{CMD}: color is required"))?)?;
    let (mode, name) = super::bucket::mode(CMD, params.get("mode"))?;
    let opacity = match params.get("opacity") {
        None | Some(Value::Null) => 100.0,
        Some(value) => value.as_f64().filter(|v| (1.0..=100.0).contains(v)).ok_or_else(|| format!("{CMD}: opacity must be a number from 1 to 100"))?,
    };
    let anti_alias = match params.get("antiAlias") {
        None | Some(Value::Null) => true,
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err(format!("{CMD}: antiAlias must be true or false")),
    };
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{CMD}: {reason}"));
    }
    let state = engine.active().ok_or_else(|| format!("{CMD}: no image document"))?;
    let routed = match params.get("target") {
        None | Some(Value::Null) => !super::history::effective_target(state).is_null(),
        Some(target) => target != "pixels",
    };
    if routed || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err(format!("{CMD}: a path fills a layer's pixels; target the layer, not a mask or channel"));
    }
    let layer = match params.get("layer") {
        None | Some(Value::Null) => state.active_layer.ok_or_else(|| format!("{CMD}: select a layer"))?,
        Some(value) => value.as_u64().map(LayerId).ok_or_else(|| format!("{CMD}: layer must be a layer id"))?,
    };
    let target = state.doc.layer(layer).ok_or_else(|| format!("{CMD}: there is no layer {}", layer.0))?;
    if target.locks.pixels || target.locks.all {
        return Err(format!("{CMD}: the layer \"{}\" is locked", target.name));
    }
    if !matches!(target.content, LayerContent::Raster(_)) {
        return Err(format!("{CMD}: the layer \"{}\" is not a pixel layer; rasterize it first", target.name));
    }
    let canvas = state.doc.bounds();
    let rasterizer = photocraft_vector::fill_rasterizer(&path, photocraft_vector::DEFAULT_TOLERANCE);
    let area = rasterizer.pixel_bounds().map_or(canvas, |bounds| bounds.intersect(&canvas));
    let mut coverage = if area.is_empty() { Vec::new() } else { rasterizer.render(area) };
    let width = area.width().max(1) as usize;
    let selection = state.doc.selection.as_ref();
    for (index, value) in coverage.iter_mut().enumerate() {
        if !anti_alias {
            *value = if *value >= 0.5 { 1.0 } else { 0.0 };
        }
        if let Some(selection) = selection {
            *value *= selection.sample_channel(area.x0 + (index % width) as i32, area.y0 + (index / width) as i32, 0);
        }
    }
    if !coverage.iter().any(|value| *value > 0.0) {
        return Ok(json!({"filled": false}));
    }
    let mut mask = Surface::new(PixelFormat { mode: ColorMode::Grayscale, sample: SampleType::F32, alpha: false });
    mask.write_region(area, &coverage);
    let request = json!({"contents": "foreground", "mode": name, "opacity": opacity, "preserveTransparency": false, "layer": layer.0, "target": "pixels"});
    let painted = super::bucket::fill_coverage(engine, layer, mask, mode, &request, Some(color)).map_err(|error| format!("{CMD}: {error}"))?;
    engine
        .edit("Fill Path", |doc, _| {
            *doc.layer_mut(layer).and_then(|layer| layer.surface_mut()).ok_or_else(|| EngineError::Other("not a pixel layer".into()))? = painted;
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((CMD.into(), params.clone()));
    Ok(json!({"filled": true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Layer, SampleType, Size};
    use serde_json::json;

    const GRAY: [f32; 4] = [0.5, 0.5, 0.5, 1.0];
    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
    const CLEAR: [f32; 4] = [0.0; 4];

    fn session(row: &[[f32; 4]]) -> Session {
        let mut doc = Document::new("Path fill", Size::new(row.len() as u32, 1), ColorMode::Rgb, SampleType::U8);
        let mut layer = Layer::raster("Layer 1", doc.pixel_format());
        let data: Vec<f32> = row.iter().flatten().copied().collect();
        layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
        let id = layer.id;
        doc.layers.push(layer);
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.active_mut().unwrap().active_layer = Some(id);
        engine
    }
    fn row(engine: &Session) -> Vec<[f32; 4]> {
        let state = engine.active().unwrap();
        let surface = state.doc.layers[0].surface().unwrap();
        (0..state.doc.size.width as i32).map(|x| surface.rgba(x, 0)).collect()
    }
    fn close(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= 1.5 / 255.0)
    }
    fn assert_row(engine: &Session, expected: &[[f32; 4]]) {
        let actual = row(engine);
        assert!(actual.len() == expected.len() && actual.iter().zip(expected).all(|(a, b)| close(*a, *b)), "{actual:?} vs {expected:?}");
    }
    fn alphas(engine: &Session) -> Vec<f32> {
        row(engine).iter().map(|px| (px[3] * 255.0).round()).collect()
    }
    fn past(engine: &Session) -> usize {
        engine.active().unwrap().history.past_len()
    }
    /// A closed band over the whole (one-pixel-high) row from `x0` to `x1`.
    fn band(x0: f64, x1: f64) -> Value {
        json!({"subpaths": [{"closed": true, "knots": [[x0, -1.0], [x1, -1.0], [x1, 2.0], [x0, 2.0]]}]})
    }
    fn fill(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    #[test]
    fn an_inline_path_fills_the_active_layer_in_one_step_and_keeps_the_work_path() {
        let mut engine = session(&[GRAY; 6]);
        engine.execute("path.set", json!({"path": band(0.0, 1.0)})).unwrap();
        let work = engine.active().unwrap().doc.work_path.clone();
        assert!(work.is_some());
        let before = past(&engine);
        let params = json!({"path": band(2.0, 4.0), "color": "#ff0000"});
        assert_eq!(fill(&mut engine, params.clone()).unwrap(), json!({"filled": true}));
        assert_row(&engine, &[GRAY, GRAY, RED, RED, GRAY, GRAY]);
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (before + 1, Some("Fill Path")));
        assert_eq!(state.doc.work_path, work);
        assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params)));
        engine.execute("edit.undo", json!({})).unwrap();
        assert_row(&engine, &[GRAY; 6]);
        // Stored paths are still the engine's.
        assert!(execute(&mut engine, CMD, &json!({"name": "work"})).is_none());
        assert!(execute(&mut engine, CMD, &json!({"path": null})).is_none());
    }

    #[test]
    fn modes_and_opacity_blend_as_edit_fill_does() {
        let mut engine = session(&[GRAY; 4]);
        fill(&mut engine, json!({"path": band(0.0, 2.0), "color": "#ff0000", "mode": "Multiply", "opacity": 50})).unwrap();
        let mixed = [0.5, 0.25, 0.25, 1.0];
        assert_row(&engine, &[mixed, mixed, GRAY, GRAY]);
        let mut engine = session(&[CLEAR, BLUE, CLEAR, BLUE]);
        fill(&mut engine, json!({"path": band(0.0, 3.0), "color": "#ff0000", "mode": "Behind"})).unwrap();
        assert_row(&engine, &[RED, BLUE, RED, BLUE]);
        fill(&mut engine, json!({"path": band(1.0, 4.0), "color": "#ff0000", "mode": "Clear"})).unwrap();
        assert_eq!(alphas(&engine), [255.0, 0.0, 0.0, 0.0]);
        assert_eq!(past(&engine), 2);
    }

    #[test]
    fn anti_alias_and_the_selection_shape_the_coverage() {
        let mut engine = session(&[CLEAR; 8]);
        fill(&mut engine, json!({"path": band(2.25, 6.25), "color": "#ff0000"})).unwrap();
        assert_eq!(alphas(&engine), [0.0, 0.0, 191.0, 255.0, 255.0, 255.0, 64.0, 0.0]);
        let mut engine = session(&[CLEAR; 8]);
        fill(&mut engine, json!({"path": band(2.25, 6.25), "color": "#ff0000", "antiAlias": false})).unwrap();
        assert_eq!(alphas(&engine), [0.0, 0.0, 255.0, 255.0, 255.0, 255.0, 0.0, 0.0]);
        let mut engine = session(&[CLEAR; 8]);
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 4, "height": 1})).unwrap();
        let selection = engine.active().unwrap().doc.selection.clone();
        fill(&mut engine, json!({"path": band(2.0, 8.0), "color": "#ff0000"})).unwrap();
        assert_eq!(alphas(&engine), [0.0, 0.0, 255.0, 255.0, 0.0, 0.0, 0.0, 0.0]);
        assert_eq!(engine.active().unwrap().doc.selection, selection);
    }

    #[test]
    fn a_path_that_covers_no_pixels_fills_nothing() {
        let mut engine = session(&[GRAY; 4]);
        for path in [json!({"subpaths": []}), band(10.0, 20.0)] {
            assert_eq!(fill(&mut engine, json!({"path": path, "color": "#ff0000"})).unwrap(), json!({"filled": false}));
        }
        assert_eq!(past(&engine), 0);
        assert_row(&engine, &[GRAY; 4]);
    }

    #[test]
    fn bad_path_fills_are_refused_before_painting() {
        let mut engine = session(&[GRAY; 4]);
        let path = band(0.0, 4.0);
        for params in [
            json!({"path": path}),
            json!({"path": path, "color": "red"}),
            json!({"path": path, "color": "#ff0000", "opacity": 0}),
            json!({"path": path, "color": "#ff0000", "opacity": 101}),
            json!({"path": path, "color": "#ff0000", "opacity": "50"}),
            json!({"path": path, "color": "#ff0000", "mode": "Sparkle"}),
            json!({"path": path, "color": "#ff0000", "antiAlias": "yes"}),
            json!({"path": {"subpaths": 3}, "color": "#ff0000"}),
            json!({"path": path, "name": "work", "color": "#ff0000"}),
            json!({"path": path, "color": "#ff0000", "layer": 999}),
            json!({"path": path, "color": "#ff0000", "target": "mask"}),
        ] {
            let error = fill(&mut engine, params.clone()).expect_err(&params.to_string());
            assert!(error.starts_with("path.fill: "), "{error}");
        }
        let layer = engine.active().unwrap().active_layer.unwrap();
        engine.edit("Lock", |doc, _| { doc.layer_mut(layer).unwrap().locks.pixels = true; Ok(()) }).unwrap();
        assert!(fill(&mut engine, json!({"path": path, "color": "#ff0000"})).unwrap_err().contains("locked"));
        engine.execute("shape.create", json!({"kind": "rect", "rect": [0, 0, 2, 1], "fill": "#00ff00"})).unwrap();
        let shapes = past(&engine);
        assert!(fill(&mut engine, json!({"path": path, "color": "#ff0000"})).unwrap_err().contains("rasterize"));
        assert_eq!(past(&engine), shapes);
        assert_row(&engine, &[GRAY; 4]);
    }
}
