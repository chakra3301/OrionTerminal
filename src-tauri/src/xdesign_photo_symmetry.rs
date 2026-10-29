//! Photoshop's Paint Symmetry presets (the Options-bar butterfly menu) for the Brush, Pencil and Eraser.
//! The pinned engine mirrors strokes across one path (photocraft symmetry_cmds.rs:14-90, brush_cmds.rs:215-245
//! and 320-395), so the one-axis presets are stored as that path and the engine paints them. Presets with
//! more copies store an empty path, which the engine paints once; `BrushDraft` strokes the other copies and
//! keeps, per pixel, the copy that changed it most. For one brush colour that is the engine's union of
//! coverage under one opacity ceiling (paint render.rs:417), whose coverage maps are private.
use photocraft_engine::{brush_cmds::{parse_points, resolve_brush, LiveStroke},
    doc::{Document, LayerId, Rect, Size, Surface}, paint::StrokePoint, symmetry_cmds::SymmetryAxis, DocState, Session};
use serde_json::{json, Value};
use std::f64::consts::{PI, TAU};
use std::sync::Arc;

const SOURCE: &str = "symmetry-preset:";
const KINDS: [&str; 10] = ["Vertical", "Horizontal", "Dual Axis", "Diagonal", "Wavy", "Circle", "Spiral", "Parallel Lines", "Radial", "Mandala"];
const LIMIT: f64 = 1_000_000.0;
/// Half the length of a straight axis: past any canvas the engine accepts.
const REACH: f64 = 4.0 * LIMIT;

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    (command == "paint.symmetrySet").then(|| set(engine, params))
}

fn set(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let preset = resolve(params, engine.active().ok_or("No image document")?.doc.size)?;
    let segments = path(&preset);
    engine.active_mut().ok_or("No image document")?.symmetry_path = Some(SymmetryAxis { source: format!("{SOURCE}{preset}"), segments });
    engine.journal.push(("paint.symmetrySet".into(), params.clone()));
    let mut result = preset;
    result["enabled"] = json!(true);
    Ok(result)
}

/// The preset with every default filled in, as `describe` reports it.
fn resolve(params: &Value, size: Size) -> Result<Value, String> {
    let kind = params["type"].as_str().and_then(|name| KINDS.into_iter().find(|kind| kind.eq_ignore_ascii_case(name)))
        .ok_or_else(|| format!("Paint Symmetry: type must be one of {}", KINDS.join(", ")))?;
    let given = |key: &str| params.get(key).filter(|value| !value.is_null());
    let (width, height) = (f64::from(size.width), f64::from(size.height));
    let mut preset = json!({"type": kind});
    let counts = match kind { "Radial" => Some((2, 12)), "Mandala" => Some((3, 10)), _ => None };
    match (given("segments"), counts) {
        (Some(_), None) => return Err("Paint Symmetry: segments applies only to Radial and Mandala".into()),
        (Some(value), Some((low, high))) => {
            let count = value.as_f64().filter(|count| count.fract() == 0.0 && (f64::from(low)..=f64::from(high)).contains(count))
                .ok_or_else(|| format!("Paint Symmetry: segments must be a whole number from {low} to {high}"))?;
            preset["segments"] = json!(count as u64);
        }
        (None, Some(_)) => preset["segments"] = json!(5),
        (None, None) => {}
    }
    let center = match given("center") {
        Some(value) => value.as_array().filter(|xy| xy.len() == 2).and_then(|xy| Some([xy[0].as_f64()?, xy[1].as_f64()?]))
            .filter(|xy| xy.iter().all(|v| v.abs() <= LIMIT)).ok_or("Paint Symmetry: center must be [x, y] in pixels")?,
        None => [width / 2.0, height / 2.0],
    };
    preset["center"] = json!(center);
    let angle = match given("angle") {
        Some(value) => value.as_f64().filter(|angle| angle.abs() <= 360.0).ok_or("Paint Symmetry: angle must be a number of degrees from -360 to 360")?,
        None => 0.0,
    };
    preset["angle"] = json!(angle);
    let sized = matches!(kind, "Wavy" | "Circle" | "Spiral" | "Parallel Lines");
    match (given("size"), sized) {
        (Some(_), false) => return Err("Paint Symmetry: size applies only to Wavy, Circle, Spiral and Parallel Lines".into()),
        (Some(value), true) => preset["size"] = json!(value.as_f64().filter(|size| (1.0..=LIMIT).contains(size))
            .ok_or("Paint Symmetry: size must be a number of pixels from 1 to 1000000")?),
        (None, true) => preset["size"] = json!(match kind { "Wavy" => height, "Circle" => width.min(height) / 2.0, "Spiral" => width.min(height), _ => width / 3.0 }),
        (None, false) => {}
    }
    Ok(preset)
}

/// The document's symmetry for the view: `null`, a preset, or the engine's path symmetry by path name.
pub(super) fn describe(engine: &Session) -> Value {
    match engine.active().and_then(|state| state.symmetry_path.as_ref()) {
        None => Value::Null,
        Some(axis) => preset_of(axis).unwrap_or_else(|| json!({"type": "Path", "path": axis.source})),
    }
}

fn preset_of(axis: &SymmetryAxis) -> Option<Value> {
    serde_json::from_str(axis.source.strip_prefix(SOURCE)?).ok()
}

fn snap(value: f64) -> f64 {
    let whole = value.round();
    if (value - whole).abs() < 1e-12 { whole } else { value }
}

/// The preset's centre and rotation `[cos, -sin, sin, cos]`, clockwise on screen (y points down).
fn frame(preset: &Value) -> ([f64; 2], [f64; 4]) {
    let center = [preset["center"][0].as_f64().unwrap_or(0.0), preset["center"][1].as_f64().unwrap_or(0.0)];
    let (sin, cos) = preset["angle"].as_f64().unwrap_or(0.0).to_radians().sin_cos();
    (center, [snap(cos), snap(-sin), snap(sin), snap(cos)])
}

fn times(m: [f64; 4], [x, y]: [f64; 2]) -> [f64; 2] {
    [m[0] * x + m[1] * y, m[2] * x + m[3] * y]
}

/// The engine path of a one-axis preset; empty for the presets `BrushDraft` copies.
fn path(preset: &Value) -> Vec<[[f64; 2]; 2]> {
    let (center, rotation) = frame(preset);
    let size = preset["size"].as_f64().unwrap_or(0.0);
    let local: Vec<[f64; 2]> = match preset["type"].as_str().unwrap_or("") {
        "Vertical" => vec![[0.0, -REACH], [0.0, REACH]],
        "Horizontal" => vec![[-REACH, 0.0], [REACH, 0.0]],
        "Diagonal" => vec![[-REACH, REACH], [REACH, -REACH]],
        "Wavy" => (0..=64).map(|step| { let t = f64::from(step) / 64.0; [size / 16.0 * (2.0 * TAU * t).sin(), size * (t - 0.5)] }).collect(),
        "Circle" => (0..=128).map(|step| { let (sin, cos) = (TAU * f64::from(step) / 128.0).sin_cos(); [size / 2.0 * cos, size / 2.0 * sin] }).collect(),
        "Spiral" => (0..=192).map(|step| { let t = f64::from(step) / 192.0; let (sin, cos) = (3.0 * TAU * t).sin_cos(); [size / 2.0 * t * cos, size / 2.0 * t * sin] }).collect(),
        _ => Vec::new(),
    };
    let world = |point| { let [x, y] = times(rotation, point); [center[0] + x, center[1] + y] };
    local.windows(2).map(|pair| [world(pair[0]), world(pair[1])]).filter(|[a, b]| a != b).collect()
}

/// Every copy besides the stroke itself, as world maps `[a, b, c, d, e, f]`: x' = ax + by + e, y' = cx + dy + f.
fn maps(preset: &Value) -> Vec<[f64; 6]> {
    let count = preset["segments"].as_u64().unwrap_or(0) as usize;
    let size = preset["size"].as_f64().unwrap_or(0.0);
    let turn = |k: usize| { let (sin, cos) = (TAU * k as f64 / count as f64).sin_cos(); ([cos, -sin, sin, cos], [0.0, 0.0]) };
    let local: Vec<([f64; 4], [f64; 2])> = match preset["type"].as_str().unwrap_or("") {
        "Dual Axis" => vec![([-1.0, 0.0, 0.0, 1.0], [0.0; 2]), ([1.0, 0.0, 0.0, -1.0], [0.0; 2]), ([-1.0, 0.0, 0.0, -1.0], [0.0; 2])],
        "Parallel Lines" => vec![([-1.0, 0.0, 0.0, 1.0], [size, 0.0]), ([-1.0, 0.0, 0.0, 1.0], [-size, 0.0])],
        "Radial" => (1..count).map(turn).collect(),
        // The first mirror axis is vertical; the others follow every half segment.
        "Mandala" => (1..count).map(turn).chain((0..count).map(|k| {
            let (sin, cos) = (2.0 * (PI / 2.0 + PI * k as f64 / count as f64)).sin_cos();
            ([cos, sin, sin, -cos], [0.0, 0.0])
        })).collect(),
        _ => Vec::new(),
    };
    let (center, r) = frame(preset);
    let rt = [r[0], r[2], r[1], r[3]];
    local.into_iter().map(|(linear, shift)| {
        let rl = [r[0] * linear[0] + r[1] * linear[2], r[0] * linear[1] + r[1] * linear[3], r[2] * linear[0] + r[3] * linear[2], r[2] * linear[1] + r[3] * linear[3]];
        let m = [rl[0] * rt[0] + rl[1] * rt[2], rl[0] * rt[1] + rl[1] * rt[3], rl[2] * rt[0] + rl[3] * rt[2], rl[2] * rt[1] + rl[3] * rt[3]].map(snap);
        let (moved, shift) = (times(m, center), times(r, shift));
        [m[0], m[1], m[2], m[3], center[0] - moved[0] + shift[0], center[1] - moved[1] + shift[1]]
    }).collect()
}

fn apply(map: &[f64; 6], x: f64, y: f64) -> [f64; 2] {
    [map[0] * x + map[1] * y + map[4], map[2] * x + map[3] * y + map[5]]
}

/// The stroke `points` (arrays or objects) moved by `map`; tilt, rotation and pressure stay as drawn.
fn moved(points: &Value, map: &[f64; 6]) -> Value {
    let mut points = points.clone();
    for point in points.as_array_mut().into_iter().flatten() {
        let (x, y) = match &*point { Value::Array(list) => (list.first(), list.get(1)), _ => (point.get("x"), point.get("y")) };
        let (Some(x), Some(y)) = (x.and_then(Value::as_f64), y.and_then(Value::as_f64)) else { continue };
        let [x, y] = apply(map, x, y);
        match point {
            Value::Array(list) => { list[0] = json!(x); list[1] = json!(y); }
            _ => { point["x"] = json!(x); point["y"] = json!(y); }
        }
    }
    points
}

fn preset(engine: &Session) -> Option<Value> {
    preset_of(engine.active()?.symmetry_path.as_ref()?)
}

/// A Brush, Pencil or Eraser stroke under a preset the engine cannot paint by itself.
pub(super) fn applies(engine: &Session, command: &str) -> bool {
    matches!(command, "paint.stroke" | "paint.pencil") && preset(engine).is_some_and(|preset| !maps(&preset).is_empty())
}

fn layer_of(state: &DocState, params: &Value) -> Option<LayerId> {
    params["layer"].as_u64().map(LayerId).or(state.active_layer)
}

/// The surface a stroke paints, as the engine picks it (channel_cmds.rs:490-522).
fn surface<'a>(doc: &'a Document, layer: Option<LayerId>, target: &Value) -> Option<&'a Surface> {
    match target {
        Value::String(name) if name == "mask" => doc.layer(layer?)?.mask.as_ref().map(|mask| &mask.surface),
        Value::String(name) if name == "quickMask" => doc.quick_mask.as_ref().map(|mask| &mask.surface),
        Value::Object(object) if object.get("channel").and_then(Value::as_u64).is_some() => doc.channels.get(object["channel"].as_u64()? as usize).map(|channel| &channel.surface),
        _ => doc.layer(layer?)?.surface(),
    }
}

fn surface_mut<'a>(doc: &'a mut Document, layer: Option<LayerId>, target: &Value) -> Option<&'a mut Surface> {
    match target {
        Value::String(name) if name == "mask" => doc.layer_mut(layer?)?.mask.as_mut().map(|mask| &mut mask.surface),
        Value::String(name) if name == "quickMask" => doc.quick_mask.as_mut().map(|mask| &mut mask.surface),
        Value::Object(object) if object.get("channel").and_then(Value::as_u64).is_some() => doc.channels.get_mut(object["channel"].as_u64()? as usize).map(|channel| &mut channel.surface),
        _ => doc.layer_mut(layer?)?.surface_mut(),
    }
}

/// The copies a multi-copy preset adds to a stroke, before they start.
pub(super) struct Plan {
    session: Session,
    maps: Vec<[f64; 6]>,
}

/// Prepares `base` (the engine, or the Behind scratch session) for a stroke under a multi-copy preset:
/// a session without the engine path to stroke every copy from. The Pencil's Auto Erase is decided once,
/// from the drawn first sample, so every copy paints the same colour.
pub(super) fn plan(base: &Session, command: &str, effective: &mut Value) -> Result<Option<Plan>, String> {
    if !applies(base, command) { return Ok(None); }
    let maps = preset(base).map(|preset| maps(&preset)).unwrap_or_default();
    let state = base.active().ok_or("No image document")?;
    let mut plain = state.clone();
    plain.symmetry_path = None;
    plain.history = Default::default();
    let mut session = Session::new();
    session.add_document(Document::new("Paint Symmetry", state.doc.size, state.doc.mode, state.doc.depth), None);
    *session.active_mut().ok_or("No image document")? = plain;
    session.tools = base.tools.clone();
    session.presets = base.presets.clone();
    session.patterns = base.patterns.clone();
    if command == "paint.pencil" && effective["autoErase"] == true {
        let color = resolve_brush(base, effective, command).map_err(|error| error.to_string())?.color;
        let first = parse_points(effective, command).map_err(|error| error.to_string())?.first().copied();
        let under = first.and_then(|point| surface(&state.doc, layer_of(state, effective), &effective["target"]).map(|surface| surface.rgba(point.x.floor() as i32, point.y.floor() as i32)));
        let object = effective.as_object_mut().ok_or("Pencil: invalid stroke parameters")?;
        if under.is_some_and(|under| under[3] > 0.0 && (0..3).all(|c| (under[c] - color[c]).abs() < 1.5 / 255.0)) {
            object.remove("color");
            session.tools.foreground = base.tools.background;
        }
        object.remove("autoErase");
    }
    Ok(Some(Plan { session, maps }))
}

impl Plan {
    /// The session to begin the drawn stroke from.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// Starts every copy of `main`, the drawn stroke begun from `session()` with `effective`.
    pub fn begin(self, command: &str, effective: &Value, main: &LiveStroke) -> Result<Copies, String> {
        let state = self.session.active().ok_or("No image document")?;
        let (layer, target) = (layer_of(state, effective), effective["target"].clone());
        let pre = surface(&state.doc, layer, &target).ok_or("Paint Symmetry: the stroke has no surface to paint")?.clone();
        let mut strokes = Vec::with_capacity(self.maps.len());
        for map in &self.maps {
            let mut params = effective.clone();
            params["seed"] = json!(main.seed);
            params["points"] = moved(&effective["points"], map);
            strokes.push((*map, LiveStroke::begin_with(&self.session, command, &params).map_err(|error| error.to_string())?));
        }
        let mut copies = Copies { merged: state.doc.clone(), strokes, pre, layer, target };
        let regions: Vec<Rect> = std::iter::once(main.bounds()).chain(copies.strokes.iter().map(|(_, stroke)| stroke.bounds())).collect();
        copies.merge(main, &regions);
        Ok(copies)
    }
}

/// The other copies of a live stroke and the document showing all of them.
pub(super) struct Copies {
    strokes: Vec<([f64; 6], LiveStroke)>,
    /// The painted surface before the stroke.
    pre: Surface,
    merged: Arc<Document>,
    layer: Option<LayerId>,
    target: Value,
}

impl Copies {
    pub fn document(&self) -> &Arc<Document> {
        &self.merged
    }
    pub fn document_mut(&mut self) -> &mut Arc<Document> {
        &mut self.merged
    }
    pub fn bounds(&self, main: &LiveStroke) -> Rect {
        self.strokes.iter().fold(main.bounds(), |bounds, (_, stroke)| bounds.union(&stroke.bounds()))
    }

    /// Strokes `points` (already drawn into `main`, changing `damage`) into every copy; returns each changed rectangle.
    pub fn push(&mut self, main: &LiveStroke, damage: Rect, points: &[StrokePoint]) -> Result<Vec<Rect>, String> {
        let mut regions = vec![damage];
        for (map, stroke) in &mut self.strokes {
            let moved: Vec<StrokePoint> = points.iter().map(|point| { let mut copy = *point; [copy.x, copy.y] = apply(map, point.x, point.y); copy }).collect();
            regions.push(stroke.push(&moved).map_err(|error| error.to_string())?);
        }
        self.merge(main, &regions);
        Ok(regions)
    }

    fn merge(&mut self, main: &LiveStroke, regions: &[Rect]) {
        let Some(target) = surface_mut(Arc::make_mut(&mut self.merged), self.layer, &self.target) else { return };
        let channels = self.pre.channels();
        for region in regions.iter().filter(|region| !region.is_empty()) {
            let painted: Vec<&Surface> = std::iter::once(main).chain(self.strokes.iter().map(|(_, stroke)| stroke))
                .filter(|stroke| !stroke.bounds().intersect(region).is_empty())
                .filter_map(|stroke| surface(&stroke.doc, self.layer, &self.target)).collect();
            for y in (region.y0..region.y1).step_by(64) {
                let band = Rect::new(region.x0, y, region.x1, (y + 64).min(region.y1));
                let before = self.pre.read_region(band);
                let copies: Vec<Vec<f32>> = painted.iter().map(|surface| surface.read_region(band)).collect();
                let mut out = before.clone();
                for (index, pixel) in out.chunks_exact_mut(channels).enumerate() {
                    let span = index * channels..(index + 1) * channels;
                    let mut most = 0.0f32;
                    for copy in &copies {
                        let change: f32 = copy[span.clone()].iter().zip(&before[span.clone()]).map(|(a, b)| (a - b).abs()).sum();
                        if change > most {
                            most = change;
                            pixel.copy_from_slice(&copy[span.clone()]);
                        }
                    }
                }
                target.write_region(band, &out);
            }
        }
        target.prune();
    }
}

#[cfg(test)]
mod tests {
    use photocraft_engine::doc::{ColorMode, Document, Layer, Rect, SampleType, Size};
    use photocraft_engine::Session;
    use serde_json::{json, Value};

    const SIDE: u32 = 64;
    const TYPE_ERROR: &str = "Paint Symmetry: type must be one of Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial, Mandala";

    /// A transparent 64×64 layer, or an opaque red one to erase.
    fn session(opaque: bool) -> Session {
        let mut doc = Document::new("Symmetry", Size::new(SIDE, SIDE), ColorMode::Rgb, SampleType::F32);
        let mut layer = Layer::raster("Layer 1", doc.pixel_format());
        if opaque {
            layer.surface_mut().unwrap().fill_rect(Rect::new(0, 0, SIDE as i32, SIDE as i32), &[1.0, 0.0, 0.0, 1.0]);
        }
        doc.layers.push(layer);
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine
    }
    fn twin(engine: &Session) -> Session {
        let state = engine.active().unwrap().clone();
        let mut twin = Session::new();
        twin.add_document((*state.doc).clone(), None);
        *twin.active_mut().unwrap() = state;
        twin.tools = engine.tools.clone();
        twin
    }
    fn run(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, command, params.clone())
    }
    fn set(engine: &mut Session, params: Value) -> Value {
        run(engine, "paint.symmetrySet", &params).unwrap()
    }
    fn dab(points: Value) -> Value {
        json!({"points": points, "size": 6, "hardness": 1, "opacity": 1, "color": "#0000ff", "seed": 7})
    }
    fn pixels(engine: &Session) -> Vec<f32> {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().read_region(state.doc.bounds())
    }
    fn alpha(engine: &Session, x: i32, y: i32) -> f32 {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, y)[3]
    }
    fn close(a: &[f32], b: &[f32], tolerance: f32) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(a, b)| (a - b).abs() <= tolerance)
    }
    fn label(engine: &Session) -> (usize, Option<String>) {
        let history = &engine.active().unwrap().history;
        (history.past_len(), history.undo_label().map(str::to_owned))
    }
    fn path(engine: &Session) -> Option<(String, usize)> {
        engine.active().unwrap().symmetry_path.as_ref().map(|axis| (axis.source.clone(), axis.segments.len()))
    }

    #[test]
    fn presets_are_tool_state_that_describe_themselves_without_a_history_step() {
        let third = f64::from(SIDE) / 3.0;
        let cases = [
            (json!({"type": "vertical"}), json!({"type": "Vertical", "center": [32.0, 32.0], "angle": 0.0}), true),
            (json!({"type": "HORIZONTAL"}), json!({"type": "Horizontal", "center": [32.0, 32.0], "angle": 0.0}), true),
            (json!({"type": "Dual Axis", "center": [20, 30], "angle": 15}), json!({"type": "Dual Axis", "center": [20.0, 30.0], "angle": 15.0}), false),
            (json!({"type": "diagonal"}), json!({"type": "Diagonal", "center": [32.0, 32.0], "angle": 0.0}), true),
            (json!({"type": "Wavy"}), json!({"type": "Wavy", "center": [32.0, 32.0], "angle": 0.0, "size": 64.0}), true),
            (json!({"type": "Circle"}), json!({"type": "Circle", "center": [32.0, 32.0], "angle": 0.0, "size": 32.0}), true),
            (json!({"type": "spiral", "size": 40}), json!({"type": "Spiral", "center": [32.0, 32.0], "angle": 0.0, "size": 40.0}), true),
            (json!({"type": "Parallel Lines"}), json!({"type": "Parallel Lines", "center": [32.0, 32.0], "angle": 0.0, "size": third}), false),
            (json!({"type": "Radial"}), json!({"type": "Radial", "segments": 5, "center": [32.0, 32.0], "angle": 0.0}), false),
            (json!({"type": "mandala", "segments": 8.0, "angle": -90}), json!({"type": "Mandala", "segments": 8, "center": [32.0, 32.0], "angle": -90.0}), false),
        ];
        for (params, preset, single_path) in cases {
            let mut engine = session(false);
            let before = label(&engine);
            let result = set(&mut engine, params.clone());
            let mut expected = preset.clone();
            expected["enabled"] = json!(true);
            assert_eq!(result, expected, "{params}");
            assert_eq!(super::describe(&engine), preset, "{params}");
            assert_eq!(label(&engine), before, "{params}: setting a preset is tool state");
            assert_eq!(engine.journal.last(), Some(&("paint.symmetrySet".to_owned(), params.clone())), "{params}");
            let (_, segments) = path(&engine).expect("a preset is the document's symmetry");
            assert_eq!(segments > 0, single_path, "{params}: single-axis presets are an engine path");
        }
        let mut engine = session(false);
        set(&mut engine, json!({"type": "Radial", "segments": 12}));
        engine.execute("paint.symmetryDisable", json!({})).unwrap();
        assert_eq!(super::describe(&engine), Value::Null);
    }

    #[test]
    fn bad_values_are_refused_with_the_key_and_leave_the_preset_alone() {
        let cases = [
            (json!({}), TYPE_ERROR),
            (json!({"type": "Triangle"}), TYPE_ERROR),
            (json!({"type": 5}), TYPE_ERROR),
            (json!({"type": "Vertical", "segments": 4}), "Paint Symmetry: segments applies only to Radial and Mandala"),
            (json!({"type": "Radial", "segments": 1}), "Paint Symmetry: segments must be a whole number from 2 to 12"),
            (json!({"type": "Radial", "segments": 13}), "Paint Symmetry: segments must be a whole number from 2 to 12"),
            (json!({"type": "Radial", "segments": 2.5}), "Paint Symmetry: segments must be a whole number from 2 to 12"),
            (json!({"type": "Radial", "segments": "6"}), "Paint Symmetry: segments must be a whole number from 2 to 12"),
            (json!({"type": "Mandala", "segments": 2}), "Paint Symmetry: segments must be a whole number from 3 to 10"),
            (json!({"type": "Mandala", "segments": 11}), "Paint Symmetry: segments must be a whole number from 3 to 10"),
            (json!({"type": "Vertical", "center": [1]}), "Paint Symmetry: center must be [x, y] in pixels"),
            (json!({"type": "Vertical", "center": "middle"}), "Paint Symmetry: center must be [x, y] in pixels"),
            (json!({"type": "Vertical", "center": [2.0e6, 0]}), "Paint Symmetry: center must be [x, y] in pixels"),
            (json!({"type": "Vertical", "angle": 400}), "Paint Symmetry: angle must be a number of degrees from -360 to 360"),
            (json!({"type": "Vertical", "angle": "left"}), "Paint Symmetry: angle must be a number of degrees from -360 to 360"),
            (json!({"type": "Radial", "size": 10}), "Paint Symmetry: size applies only to Wavy, Circle, Spiral and Parallel Lines"),
            (json!({"type": "Circle", "size": 0}), "Paint Symmetry: size must be a number of pixels from 1 to 1000000"),
            (json!({"type": "Circle", "size": 2.0e6}), "Paint Symmetry: size must be a number of pixels from 1 to 1000000"),
        ];
        let mut engine = session(false);
        set(&mut engine, json!({"type": "Vertical"}));
        let (preset, journal, history) = (super::describe(&engine), engine.journal.len(), label(&engine));
        for (params, message) in cases {
            assert_eq!(run(&mut engine, "paint.symmetrySet", &params), Err(message.to_owned()), "{params}");
            assert_eq!(super::describe(&engine), preset, "{params}");
            assert_eq!((engine.journal.len(), label(&engine)), (journal, history.clone()), "{params}");
        }
    }

    #[test]
    fn single_axis_presets_mirror_through_the_engine_path() {
        let last = SIDE as i32 - 1;
        let mirrors: [(&str, fn(i32, i32, i32) -> (i32, i32)); 3] = [
            ("Vertical", |x, y, last| (last - x, y)),
            ("Horizontal", |x, y, last| (x, last - y)),
            ("Diagonal", |x, y, last| (last - y, last - x)),
        ];
        for (kind, mirror) in mirrors {
            let mut engine = session(false);
            set(&mut engine, json!({"type": kind}));
            run(&mut engine, "paint.stroke", &dab(json!([[10, 20], [20, 26]]))).unwrap();
            assert!(alpha(&engine, 10, 20) > 0.99, "{kind}");
            let (mx, my) = mirror(10, 20, last);
            assert!(alpha(&engine, mx, my) > 0.99, "{kind}: the mirrored copy at {mx},{my}");
            for y in 0..SIDE as i32 { for x in 0..SIDE as i32 {
                let (mx, my) = mirror(x, y, last);
                assert!((alpha(&engine, x, y) - alpha(&engine, mx, my)).abs() <= 0.05, "{kind}: {x},{y} against {mx},{my}");
            }}
        }

        // Circle: a point at radius r mirrors to 2R - r on the same ray.
        let mut engine = session(false);
        set(&mut engine, json!({"type": "Circle", "size": 32}));
        run(&mut engine, "paint.stroke", &dab(json!([[40, 32]]))).unwrap();
        assert!(alpha(&engine, 39, 32) > 0.99 && alpha(&engine, 55, 32) > 0.99, "{} {}", alpha(&engine, 39, 32), alpha(&engine, 55, 32));
        assert_eq!(alpha(&engine, 23, 32), 0.0);

        for kind in ["Wavy", "Spiral"] {
            let mut single = session(false);
            run(&mut single, "paint.stroke", &dab(json!([[10, 20], [14, 22]]))).unwrap();
            let mut engine = session(false);
            set(&mut engine, json!({"type": kind}));
            run(&mut engine, "paint.stroke", &dab(json!([[10, 20], [14, 22]]))).unwrap();
            let coverage = |engine: &Session| pixels(engine).chunks_exact(4).map(|pixel| pixel[3]).sum::<f32>();
            assert!(coverage(&engine) > coverage(&single) * 1.3, "{kind}: {} against {}", coverage(&engine), coverage(&single));
        }
    }

    /// The copies of the dab at (x, y) each multi-copy preset paints about the centre (32, 32).
    fn copies(kind: &str, x: f64, y: f64) -> Vec<(f64, f64)> {
        let (u, v) = (x - 32.0, y - 32.0);
        let turn = |n: usize, u: f64, v: f64| (0..n).map(move |k| {
            let (s, c) = (std::f64::consts::TAU * k as f64 / n as f64).sin_cos();
            (32.0 + u * c - v * s, 32.0 + u * s + v * c)
        });
        match kind {
            "Dual Axis" => vec![(x, y), (64.0 - x, y), (x, 64.0 - y), (64.0 - x, 64.0 - y)],
            "Radial" => turn(4, u, v).collect(),
            "Mandala" => turn(3, u, v).chain(turn(3, -u, v)).collect(),
            "Parallel Lines" => vec![(x, y), (80.0 - x, y), (48.0 - x, y)],
            _ => unreachable!(),
        }
    }

    #[test]
    fn multi_copy_presets_paint_every_copy_as_one_tool_step() {
        let presets = [
            (json!({"type": "Dual Axis"}), "Dual Axis"),
            (json!({"type": "Radial", "segments": 4}), "Radial"),
            (json!({"type": "Mandala", "segments": 3}), "Mandala"),
            (json!({"type": "Parallel Lines", "size": 16}), "Parallel Lines"),
        ];
        for (command, extra, tool) in [("paint.stroke", json!({}), "Brush Tool"), ("paint.pencil", json!({}), "Pencil"), ("paint.stroke", json!({"erase": true}), "Eraser")] {
            for (preset, kind) in &presets {
                let mut engine = session(tool == "Eraser");
                let mut expected = twin(&engine);
                set(&mut engine, preset.clone());
                let (before, (past, _)) = (pixels(&engine), label(&engine));
                let mut params = dab(json!([[36, 20]]));
                params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
                for (x, y) in copies(kind, 36.0, 20.0) {
                    let mut copy = params.clone();
                    copy["points"] = json!([[x, y]]);
                    expected.execute(command, copy).unwrap();
                }
                run(&mut engine, command, &params).unwrap();
                assert!(close(&pixels(&engine), &pixels(&expected), 1e-4), "{tool}/{kind}");
                assert_ne!(pixels(&engine), before, "{tool}/{kind}");
                assert_eq!(label(&engine), (past + 1, Some(tool.to_owned())), "{tool}/{kind}");
                assert_eq!(engine.journal.last(), Some(&(command.to_owned(), params.clone())), "{tool}/{kind}");
                engine.execute("edit.undo", json!({})).unwrap();
                assert_eq!(pixels(&engine), before, "{tool}/{kind}");
            }
        }
    }

    #[test]
    fn overlapping_copies_share_one_opacity_ceiling() {
        let mut params = dab(json!([[20, 32], [44, 32]]));
        params["opacity"] = json!(0.5);
        params["size"] = json!(8);
        let mut single = session(false);
        run(&mut single, "paint.stroke", &params).unwrap();
        for preset in [json!({"type": "Radial", "segments": 2}), json!({"type": "Mandala", "segments": 4}), json!({"type": "Dual Axis"})] {
            let mut engine = session(false);
            set(&mut engine, preset.clone());
            run(&mut engine, "paint.stroke", &params).unwrap();
            assert!((alpha(&engine, 32, 32) - 0.5).abs() <= 1e-3, "{preset}: {}", alpha(&engine, 32, 32));
            assert!((alpha(&engine, 26, 32) - alpha(&single, 26, 32)).abs() <= 1e-3, "{preset}");
        }
    }

    #[test]
    fn live_feedback_commits_the_previewed_copies() {
        let half = |engine: &mut Session| {
            let layer = engine.active().unwrap().active_layer.unwrap();
            engine.edit("Fill", |doc, _| { doc.layer_mut(layer).unwrap().surface_mut().unwrap().fill_rect(Rect::new(0, 0, 32, SIDE as i32), &[1.0, 0.0, 0.0, 1.0]); Ok(()) }).unwrap();
        };
        for command in ["paint.stroke", "paint.pencil"] {
            for (preset, mode) in [(json!({"type": "Radial", "segments": 4}), None), (json!({"type": "Mandala", "segments": 5}), None), (json!({"type": "Dual Axis"}), Some("Behind"))] {
                let mut engine = session(false);
                half(&mut engine);
                set(&mut engine, preset.clone());
                let mut reference = twin(&engine);
                let mut full = dab(json!([[38, 20], [40, 22], [43, 24], [46, 24], [47, 30]]));
                full["opacity"] = json!(0.7);
                if let Some(mode) = mode { full["mode"] = json!(mode); }
                let mut first = full.clone();
                first["points"] = json!(full["points"].as_array().unwrap()[..2]);
                let identity = format!("symmetry-{}", ulid::Ulid::new());
                let source = engine.active().unwrap().doc.clone();
                super::super::stroke::render_with_identity(&engine, Some(&identity), command, &first, 0, 0, 0, 0, 1).unwrap();
                super::super::stroke::render_with_identity(&engine, Some(&identity), command, &full, 0, 0, 0, 0, 1).unwrap();
                assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc), "{command}/{preset}");
                let live = super::super::stroke::commit_feedback(&mut engine, &identity, command, &full).expect("the live draft commits").unwrap();
                let direct = run(&mut reference, command, &full).unwrap();
                assert_eq!(live, direct, "{command}/{preset}");
                assert_eq!(pixels(&engine), pixels(&reference), "{command}/{preset}");
                assert_eq!(label(&engine), label(&reference), "{command}/{preset}");
                // Every copy shows: the dab at (38, 20) rotated half a turn lands at (26, 44).
                if mode.is_none() && preset["segments"] == 4 { assert!(alpha(&engine, 25, 43) > 0.6, "{command}: {}", alpha(&engine, 25, 43)); }
                super::super::stroke::release(&identity, 7).unwrap();
            }
        }
    }
}
