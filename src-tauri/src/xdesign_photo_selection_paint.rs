//! Select and Mask's Brush Tool: paints the selection directly with a round tip. The engine has no
//! selection brush, and painting Quick Mask would cost several history steps and use the Brush tool's own tip.
use photocraft_engine::{
    doc::{ColorMode, PixelFormat, Rect, SampleType, Surface},
    paint::{apply_stroke, Stroke, StrokePoint},
    BrushSettings, Session,
};
use serde_json::{json, Value};

const CMD: &str = "select.brush";
const MAX_POINTS: usize = 8192;

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    (command == CMD).then(|| paint(engine, params).map_err(|error| format!("{CMD}: {error}")))
}

fn number(params: &Value, key: &str, default: Option<f64>, min: f64, max: f64) -> Result<f64, String> {
    match (params.get(key).filter(|value| !value.is_null()), default) {
        (None, Some(default)) => Ok(default),
        (None, None) => Err(format!("{key} is required")),
        (Some(value), _) => value.as_f64().filter(|v| (min..=max).contains(v)).ok_or_else(|| format!("{key} must be a number from {min} to {max}")),
    }
}

fn points(value: Option<&Value>, canvas: Rect) -> Result<Vec<StrokePoint>, String> {
    let list = value.and_then(Value::as_array).ok_or("points must be a list of [x, y]")?;
    if list.is_empty() || list.len() > MAX_POINTS {
        return Err(format!("points must hold 1 to {MAX_POINTS} points"));
    }
    list.iter()
        .enumerate()
        .map(|(index, point)| match point.as_array().map(|xy| xy.iter().map(Value::as_f64).collect::<Vec<_>>()).as_deref() {
            Some(&[Some(x), Some(y)]) if (0.0..=f64::from(canvas.x1)).contains(&x) && (0.0..=f64::from(canvas.y1)).contains(&y) => Ok(StrokePoint::new(x, y, 1.0)),
            Some(&[Some(_), Some(_)]) => Err(format!("points[{index}] is off the canvas (0..{} × 0..{})", canvas.x1, canvas.y1)),
            _ => Err(format!("points[{index}] must be [x, y]")),
        })
        .collect()
}

fn paint(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let state = engine.active().ok_or("no image document")?;
    if state.doc.quick_mask.is_some() {
        return Err("leave Quick Mask mode first; the Brush Tool paints the selection".into());
    }
    let canvas = state.doc.bounds();
    let points = points(params.get("points"), canvas)?;
    let size = number(params, "size", None, 1.0, 5000.0)?;
    let hardness = number(params, "hardness", Some(100.0), 0.0, 100.0)?;
    let add = match params.get("mode").and_then(Value::as_str) {
        Some("add") => true,
        Some("subtract") => false,
        _ => return Err("mode must be \"add\" or \"subtract\"".into()),
    };
    if !params.get("sampleAllLayers").is_none_or(|value| value.is_boolean() || value.is_null()) {
        return Err("sampleAllLayers must be true or false".into());
    }
    if !add && state.doc.selection.is_none() {
        return Ok(json!({"selected": false}));
    }
    let brush = BrushSettings { size: size as f32, hardness: (hardness / 100.0) as f32, pressure_size: false, color: [1.0; 4], ..BrushSettings::default() };
    let mut coverage = Surface::new(PixelFormat { mode: ColorMode::Grayscale, sample: SampleType::F32, alpha: false });
    let area = apply_stroke(&mut coverage, &Stroke { brush, points }, None, false).intersect(&canvas);
    let mut selection = state.doc.selection.clone().unwrap_or_else(|| Surface::new(PixelFormat::GRAY8));
    let mut values = selection.read_region(area);
    // Painting white or black over the mask, as Photoshop's brush does, so soft strokes build up.
    for (value, cover) in values.iter_mut().zip(coverage.read_region(area)) {
        *value = if add { *value + cover * (1.0 - *value) } else { *value * (1.0 - cover) };
    }
    selection.write_region(area, &values);
    let selected = selection.default_pixel().first().is_some_and(|value| *value > 0.0) || !selection.content_bounds().intersect(&canvas).is_empty();
    engine
        .edit("Brush Tool", move |doc, _| {
            doc.selection = selected.then_some(selection);
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((CMD.into(), params.clone()));
    Ok(json!({"selected": selected}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 40, "height": 20, "background": "#808080"})).unwrap();
        engine
    }
    fn at(engine: &Session, x: i32, y: i32) -> f32 {
        engine.active().unwrap().doc.selection.as_ref().map_or(0.0, |selection| selection.sample_channel(x, y, 0))
    }
    fn past(engine: &Session) -> usize {
        engine.active().unwrap().history.past_len()
    }
    fn brush(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    #[test]
    fn add_paints_a_round_tip_and_creates_the_selection_in_one_step() {
        let mut engine = session();
        let before = past(&engine);
        let params = json!({"points": [[10, 10]], "size": 8, "mode": "add"});
        assert_eq!(brush(&mut engine, params.clone()).unwrap(), json!({"selected": true}));
        assert_eq!((at(&engine, 10, 10), at(&engine, 12, 10), at(&engine, 10, 7), at(&engine, 16, 10), at(&engine, 10, 15)), (1.0, 1.0, 1.0, 0.0, 0.0));
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (before + 1, Some("Brush Tool")));
        assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params)));
        brush(&mut engine, json!({"points": [[4, 16], [36, 16]], "size": 4, "mode": "add", "sampleAllLayers": true})).unwrap();
        assert_eq!((at(&engine, 20, 16), at(&engine, 34, 16), at(&engine, 20, 12), at(&engine, 10, 10)), (1.0, 1.0, 0.0, 1.0));
        assert_eq!(past(&engine), before + 2);
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!((at(&engine, 20, 16), at(&engine, 10, 10)), (0.0, 1.0));
    }

    #[test]
    fn subtract_erases_and_an_emptied_selection_is_dropped() {
        let mut engine = session();
        engine.execute("select.all", json!({})).unwrap();
        brush(&mut engine, json!({"points": [[0, 10], [40, 10]], "size": 4, "mode": "subtract"})).unwrap();
        assert_eq!((at(&engine, 20, 10), at(&engine, 5, 10), at(&engine, 20, 3), at(&engine, 20, 17)), (0.0, 0.0, 1.0, 1.0));
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 4, "height": 4})).unwrap();
        let before = past(&engine);
        assert_eq!(brush(&mut engine, json!({"points": [[2, 2]], "size": 20, "mode": "subtract"})).unwrap(), json!({"selected": false}));
        assert!(engine.active().unwrap().doc.selection.is_none());
        assert_eq!(past(&engine), before + 1);
        // Nothing to subtract from: no history step.
        assert_eq!(brush(&mut engine, json!({"points": [[2, 2]], "size": 20, "mode": "subtract"})).unwrap(), json!({"selected": false}));
        assert_eq!(past(&engine), before + 1);
        // A tip hanging over the edge selects only the canvas part.
        brush(&mut engine, json!({"points": [[0, 0]], "size": 10, "mode": "add"})).unwrap();
        let bounds = engine.active().unwrap().doc.selection.as_ref().unwrap().content_bounds();
        assert_eq!((bounds.x0, bounds.y0), (0, 0));
    }

    #[test]
    fn hardness_softens_the_tip_edge() {
        let mut hard = session();
        brush(&mut hard, json!({"points": [[20, 10]], "size": 18, "mode": "add"})).unwrap();
        let mut soft = session();
        brush(&mut soft, json!({"points": [[20, 10]], "size": 18, "hardness": 0, "mode": "add"})).unwrap();
        assert_eq!(at(&hard, 26, 10), 1.0);
        let edge = at(&soft, 26, 10);
        assert!(edge > 0.02 && edge < 0.9, "{edge}");
        assert!(at(&soft, 20, 10) > 0.95);
        // Adding over a partial selection builds towards fully selected.
        brush(&mut soft, json!({"points": [[20, 10]], "size": 18, "hardness": 0, "mode": "add"})).unwrap();
        assert!(at(&soft, 26, 10) > edge);
    }

    #[test]
    fn bad_selection_brush_params_are_refused() {
        let mut engine = session();
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 10, "height": 10})).unwrap();
        let selection = engine.active().unwrap().doc.selection.clone();
        let before = past(&engine);
        let many: Vec<[i32; 2]> = (0..8193).map(|i| [i % 40, 5]).collect();
        for params in [
            json!({"size": 8, "mode": "add"}),
            json!({"points": [], "size": 8, "mode": "add"}),
            json!({"points": [[1]], "size": 8, "mode": "add"}),
            json!({"points": [[1, 2, 3]], "size": 8, "mode": "add"}),
            json!({"points": [["a", 2]], "size": 8, "mode": "add"}),
            json!({"points": many, "size": 8, "mode": "add"}),
            json!({"points": [[1, 2], [-1, 2]], "size": 8, "mode": "add"}),
            json!({"points": [[41, 2]], "size": 8, "mode": "add"}),
            json!({"points": [[1, 21]], "size": 8, "mode": "add"}),
            json!({"points": [[1, 2]], "mode": "add"}),
            json!({"points": [[1, 2]], "size": 0, "mode": "add"}),
            json!({"points": [[1, 2]], "size": 5001, "mode": "add"}),
            json!({"points": [[1, 2]], "size": "8", "mode": "add"}),
            json!({"points": [[1, 2]], "size": 8, "hardness": -1, "mode": "add"}),
            json!({"points": [[1, 2]], "size": 8, "hardness": 101, "mode": "add"}),
            json!({"points": [[1, 2]], "size": 8}),
            json!({"points": [[1, 2]], "size": 8, "mode": "replace"}),
            json!({"points": [[1, 2]], "size": 8, "mode": "add", "sampleAllLayers": "yes"}),
        ] {
            let error = brush(&mut engine, params.clone()).expect_err(&params.to_string());
            assert!(error.starts_with("select.brush: "), "{error}");
        }
        assert_eq!(past(&engine), before);
        assert_eq!(engine.active().unwrap().doc.selection, selection);
        engine.execute("select.editInQuickMaskMode", json!({})).unwrap();
        assert!(engine.active().unwrap().doc.quick_mask.is_some());
        assert!(brush(&mut engine, json!({"points": [[1, 2]], "size": 8, "mode": "add"})).unwrap_err().contains("Quick Mask"));
    }
}
