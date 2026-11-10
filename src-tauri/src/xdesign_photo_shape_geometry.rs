//! Polygon, triangle and star corner radius and line arrowheads, which the pinned engine's live shapes
//! lack (doc/src/vector.rs:269): the host draws the outline and the engine keeps it as a path shape.
use photocraft_engine::{
    doc::{LayerContent, LayerId, LiveShape},
    vector_cmds::{parse_path, path_json, shape_path},
    Session,
};
use serde_json::{json, Map, Value};

const NAME: &str = "Shape";
const GEOMETRY: [&str; 9] = ["kind", "rect", "radii", "radius", "sides", "starRatio", "from", "to", "weight"];
const CORNER: &str = "cornerRadius";
const ARROWS: [&str; 5] = ["arrowStart", "arrowEnd", "arrowWidth", "arrowLength", "arrowConcavity"];
const MAX_RADIUS: f64 = 10_000.0;
const MAX_WEIGHT: f64 = 1_000.0;

enum Outline {
    Polygon { rect: [f64; 4], sides: u32, star_ratio: f64, radius: f64 },
    Line { from: [f64; 2], to: [f64; 2], weight: f64, heads: Heads },
}

struct Heads {
    start: bool,
    end: bool,
    width: f64,
    length: f64,
    concavity: f64,
}

impl Outline {
    /// The engine draws it as a live shape itself.
    fn native(&self) -> bool {
        match self {
            Outline::Polygon { radius, .. } => *radius <= 0.0,
            Outline::Line { heads, .. } => !heads.start && !heads.end,
        }
    }

    fn base_name(&self) -> &'static str {
        match self {
            Outline::Polygon { star_ratio, .. } if *star_ratio < 1.0 => "Star",
            Outline::Polygon { .. } => "Polygon",
            Outline::Line { .. } => "Line",
        }
    }

    fn path(&self) -> Result<Value, String> {
        let path = match self {
            Outline::Polygon { rect, sides, star_ratio, radius } => rounded_polygon(*rect, *sides, *star_ratio, *radius),
            Outline::Line { from, to, weight, heads } => arrow_line(*from, *to, *weight, heads),
        };
        parse_path(&path).map(|path| path_json(&path))
    }
}

/// `shape.path`: the outline a Shape tool would draw, for Path and Pixels modes.
pub(super) fn query(command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != "shape.path" {
        return None;
    }
    let path = match parse(params, None, false) {
        Err(error) => Err(error),
        Ok(Some(outline)) if !outline.native() => outline.path(),
        Ok(_) => shape_path(params).map(|path| path_json(&path)).map_err(|error| error.to_string()),
    };
    Some(path.map(|path| json!({ "path": path })))
}

/// Turns `shape.create` / `shape.edit` with a corner radius or arrowheads into the engine's path form.
pub(super) fn prepare(engine: &Session, command: &str, params: Value) -> Result<Value, String> {
    let create = command == "shape.create";
    if !create && command != "shape.edit" {
        return Ok(params);
    }
    let live = if create { None } else { live_shape(engine, &params) };
    let Some(outline) = parse(&params, live.as_ref(), !create)? else { return Ok(params) };
    if outline.native() {
        return Ok(params);
    }
    let mut object: Map<String, Value> = params.as_object().cloned().unwrap_or_default();
    for key in GEOMETRY.iter().chain(ARROWS.iter()).chain([CORNER].iter()) {
        object.remove(*key);
    }
    object.insert("path".into(), outline.path()?);
    if create {
        object.insert("kind".into(), json!("path"));
        if given(&params, "name").is_none() && given(&params, "addTo").is_none() {
            let doc = &engine.active().ok_or("No image document is open")?.doc;
            object.insert("name".into(), json!(doc.next_layer_name(outline.base_name())));
        }
    }
    Ok(Value::Object(object))
}

fn live_shape(engine: &Session, params: &Value) -> Option<LiveShape> {
    let state = engine.active()?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)?;
    match &state.doc.layer(id)?.content {
        LayerContent::Shape(shape) => shape.live.clone(),
        _ => None,
    }
}

fn given<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params.get(key).filter(|value| !value.is_null())
}

fn number(params: &Value, key: &str, low: f64, high: f64, default: f64) -> Result<f64, String> {
    match given(params, key) {
        None => Ok(default),
        Some(value) => value.as_f64().filter(|v| (low..=high).contains(v)).ok_or_else(|| format!("{NAME}: {key} must be a number from {low} to {high}")),
    }
}

fn flag(params: &Value, key: &str) -> Result<bool, String> {
    match given(params, key) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{NAME}: {key} must be true or false")),
    }
}

fn numbers<const N: usize>(params: &Value, key: &str) -> Option<Result<[f64; N], ()>> {
    let value = given(params, key)?;
    let list = value.as_array().filter(|list| list.len() == N);
    Some(list.and_then(|list| {
        let mut out = [0.0; N];
        for (slot, item) in out.iter_mut().zip(list) {
            *slot = item.as_f64().filter(|v| v.is_finite())?;
        }
        Some(out)
    }).ok_or(()))
}

fn parse(params: &Value, live: Option<&LiveShape>, editing: bool) -> Result<Option<Outline>, String> {
    let corner = given(params, CORNER).is_some();
    let arrows = ARROWS.iter().any(|key| given(params, key).is_some());
    if !corner && !arrows {
        return Ok(None);
    }
    let kind = match (given(params, "kind").and_then(Value::as_str), live) {
        (Some(kind), _) => kind,
        (None, Some(LiveShape::Polygon { star_ratio, .. })) if *star_ratio < 1.0 => "star",
        (None, Some(LiveShape::Polygon { .. })) => "polygon",
        (None, Some(LiveShape::Line { .. })) => "line",
        (None, Some(_)) => "rect",
        (None, None) if editing => {
            return Err(format!("{NAME}: this shape has no live parameters; pass kind with rect and sides, or with from, to and weight"));
        }
        (None, None) => "rect",
    };
    if corner && !matches!(kind, "polygon" | "star") {
        return Err(format!("{NAME}: cornerRadius applies to polygon, triangle and star shapes (rectangles use radii)"));
    }
    if arrows && kind != "line" {
        return Err(format!("{NAME}: arrowheads apply to line shapes"));
    }
    if kind == "line" { line(params, live).map(Some) } else { polygon(params, kind, live).map(Some) }
}

fn polygon(params: &Value, kind: &str, live: Option<&LiveShape>) -> Result<Outline, String> {
    let radius = number(params, CORNER, 0.0, MAX_RADIUS, 0.0)?;
    let (rect, sides, ratio) = match live {
        Some(LiveShape::Polygon { rect, sides, star_ratio }) => (Some(*rect), *sides, *star_ratio),
        _ => (None, 5, 1.0),
    };
    let rect = match (numbers::<4>(params, "rect"), rect) {
        (Some(Ok(rect)), _) if rect[2] > 0.0 && rect[3] > 0.0 => rect,
        (None, Some(rect)) => rect,
        _ => return Err(format!("{NAME}: rect must be [x, y, width, height] with a positive width and height")),
    };
    let sides = match given(params, "sides") {
        None => sides,
        Some(value) => value
            .as_f64()
            .filter(|v| v.fract() == 0.0 && (3.0..=100.0).contains(v))
            .map(|v| v as u32)
            .ok_or_else(|| format!("{NAME}: sides must be a whole number from 3 to 100"))?,
    };
    let star_ratio = match given(params, "starRatio") {
        Some(_) => number(params, "starRatio", 0.01, 1.0, 1.0)?,
        None if kind == "polygon" => 1.0,
        None if ratio < 1.0 => ratio,
        None => 0.5,
    };
    Ok(Outline::Polygon { rect, sides, star_ratio, radius })
}

fn line(params: &Value, live: Option<&LiveShape>) -> Result<Outline, String> {
    let (from, to, weight) = match live {
        Some(LiveShape::Line { from, to, weight }) => (Some(*from), Some(*to), *weight),
        _ => (None, None, 1.0),
    };
    let point = |key: &str, previous: Option<[f64; 2]>| match (numbers::<2>(params, key), previous) {
        (Some(Ok(point)), _) | (None, Some(point)) => Ok(point),
        _ => Err(format!("{NAME}: {key} must be [x, y]")),
    };
    let (from, to) = (point("from", from)?, point("to", to)?);
    let weight = match given(params, "weight") {
        None => weight,
        Some(value) => value
            .as_f64()
            .filter(|v| *v > 0.0 && *v <= MAX_WEIGHT)
            .ok_or_else(|| format!("{NAME}: weight must be a number above 0 and up to {MAX_WEIGHT}"))?,
    };
    let heads = Heads {
        start: flag(params, "arrowStart")?,
        end: flag(params, "arrowEnd")?,
        width: number(params, "arrowWidth", 10.0, 1000.0, 500.0)?,
        length: number(params, "arrowLength", 10.0, 5000.0, 1000.0)?,
        concavity: number(params, "arrowConcavity", -50.0, 50.0, 0.0)?,
    };
    if (heads.start || heads.end) && from == to {
        return Err(format!("{NAME}: a line with arrowheads needs different from and to points"));
    }
    Ok(Outline::Line { from, to, weight, heads })
}

fn sub(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

fn along(a: [f64; 2], d: [f64; 2], k: f64) -> [f64; 2] {
    [a[0] + d[0] * k, a[1] + d[1] * k]
}

fn unit(d: [f64; 2]) -> ([f64; 2], f64) {
    let length = d[0].hypot(d[1]);
    if length > 0.0 { ([d[0] / length, d[1] / length], length) } else { ([0.0, 0.0], 0.0) }
}

/// The engine's polygon or star with each corner (each point, for stars) replaced by a circular arc
/// tangent to both sides. A radius larger than the sides allow stops where neighbouring arcs meet.
fn rounded_polygon(rect: [f64; 4], sides: u32, star_ratio: f64, radius: f64) -> Value {
    let [x, y, w, h] = rect;
    let base = photocraft_vector::shapes::polygon(x, y, w, h, sides, star_ratio);
    let points: Vec<[f64; 2]> = base.subpaths[0].knots.iter().map(|knot| [knot.anchor.x, knot.anchor.y]).collect();
    let n = points.len();
    let star = star_ratio < 1.0;
    let rounded = |i: usize| !star || i % 2 == 0;
    // [anchor, in, out] per knot.
    let mut knots: Vec<[[f64; 2]; 3]> = Vec::with_capacity(n * 2);
    for i in 0..n {
        let (previous, next) = ((i + n - 1) % n, (i + 1) % n);
        let vertex = points[i];
        let (a, to_previous) = unit(sub(points[previous], vertex));
        let (b, to_next) = unit(sub(points[next], vertex));
        let angle = (a[0] * b[0] + a[1] * b[1]).clamp(-1.0, 1.0).acos();
        let share = |j: usize| if rounded(j) { 0.5 } else { 1.0 };
        let reach = (to_previous * share(previous)).min(to_next * share(next));
        let tangent = if rounded(i) && angle > 1e-9 { (radius / (angle / 2.0).tan()).min(reach) } else { 0.0 };
        if tangent <= 1e-9 {
            knots.push([vertex; 3]);
            continue;
        }
        let arc = tangent * (angle / 2.0).tan();
        let handle = 4.0 / 3.0 * ((std::f64::consts::PI - angle) / 4.0).tan() * arc;
        let (enter, leave) = (along(vertex, a, tangent), along(vertex, b, tangent));
        knots.push([enter, enter, along(enter, a, -handle)]);
        knots.push([leave, along(leave, b, -handle), leave]);
    }
    let mut merged: Vec<[[f64; 2]; 3]> = Vec::with_capacity(knots.len());
    for knot in knots {
        match merged.last_mut() {
            Some(last) if sub(last[0], knot[0]).iter().all(|d| d.abs() < 1e-9) => last[2] = knot[2],
            _ => merged.push(knot),
        }
    }
    if merged.len() > 1 && sub(merged[0][0], merged[merged.len() - 1][0]).iter().all(|d| d.abs() < 1e-9) {
        let last = merged.pop().unwrap_or_default();
        merged[0][1] = last[1];
    }
    let knots: Vec<Value> = merged.iter().map(|[anchor, inward, outward]| json!({"anchor": anchor, "in": inward, "out": outward})).collect();
    json!({"subpaths": [{"closed": true, "knots": knots}]})
}

/// A line bar `weight` thick with Photoshop's arrowheads: each head is `width` % of the weight across its
/// base and `length` % of it long, its tip on the end point; `concavity` % of the length moves the middle
/// of its back towards the tip (or away). One outline when the heads are wider than the bar and don't
/// overlap, otherwise the bar and heads as combined pieces.
fn arrow_line(from: [f64; 2], to: [f64; 2], weight: f64, heads: &Heads) -> Value {
    let (u, length) = unit(sub(to, from));
    let normal = [-u[1], u[0]];
    let at = |t: f64, s: f64| along(along(from, u, t), normal, s);
    let bar = weight / 2.0;
    let half = weight * heads.width / 200.0;
    let long = weight * heads.length / 100.0;
    let c = heads.concavity / 100.0;
    let notch = long * (1.0 - c);
    let footprint = long.max(notch);
    let count = f64::from(u8::from(heads.start) + u8::from(heads.end));
    if half > bar && footprint * count <= length {
        // Where the bar's edges meet the backs of the heads.
        let join = long - long * c * (1.0 - bar / half);
        let mut points = Vec::new();
        if heads.start {
            points.extend([at(0.0, 0.0), at(long, -half), at(join, -bar)]);
        } else {
            points.push(at(0.0, -bar));
        }
        if heads.end {
            let (base, join) = (length - long, length - join);
            points.extend([at(join, -bar), at(base, -half), at(length, 0.0), at(base, half), at(join, bar)]);
        } else {
            points.extend([at(length, -bar), at(length, bar)]);
        }
        if heads.start {
            points.extend([at(join, bar), at(long, half)]);
        } else {
            points.push(at(0.0, bar));
        }
        return json!({"subpaths": [{"closed": true, "knots": points}]});
    }
    let mut pieces = Vec::new();
    let (first, last) = (if heads.start { notch.clamp(0.0, length) } else { 0.0 }, if heads.end { (length - notch).clamp(0.0, length) } else { length });
    if last > first {
        pieces.push(vec![at(first, -bar), at(last, -bar), at(last, bar), at(first, bar)]);
    }
    if heads.start {
        pieces.push(vec![at(0.0, 0.0), at(long, -half), at(notch, 0.0), at(long, half)]);
    }
    if heads.end {
        pieces.push(vec![at(length, 0.0), at(length - long, half), at(length - notch, 0.0), at(length - long, -half)]);
    }
    let subpaths: Vec<Value> = pieces.into_iter().map(|knots| json!({"closed": true, "op": "combine", "knots": knots})).collect();
    json!({"subpaths": subpaths})
}

#[cfg(test)]
mod tests {
    use photocraft_engine::doc::{ColorMode, Document, Layer, LayerContent, Rect, SampleType, Size};
    use photocraft_engine::Session;
    use serde_json::{json, Value};

    fn session() -> Session {
        let mut doc = Document::new("Shapes", Size::new(140, 100), ColorMode::Rgb, SampleType::U8);
        doc.layers.push(Layer::raster("Background", doc.pixel_format()));
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.set_active(0);
        let base = engine.active().unwrap().doc.layers[0].id;
        engine.active_mut().unwrap().active_layer = Some(base);
        engine
    }
    fn run(engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, command, params)
    }
    fn past(engine: &Session) -> usize {
        engine.active().unwrap().history.past_len()
    }
    fn shape(engine: &Session) -> photocraft_engine::doc::ShapeLayer {
        let state = engine.active().unwrap();
        let layer = state.doc.layer(state.active_layer.unwrap()).unwrap();
        match &layer.content { LayerContent::Shape(shape) => shape.clone(), _ => panic!("{} is not a shape", layer.name) }
    }
    fn covered(path: &photocraft_engine::doc::Path, x: i32, y: i32) -> f32 {
        photocraft_vector::path_coverage(path, Rect::new(x, y, x + 1, y + 1))[0]
    }
    fn knots(path: &photocraft_engine::doc::Path) -> Vec<usize> {
        path.subpaths.iter().map(|subpath| subpath.knots.len()).collect()
    }

    #[test]
    fn a_rounded_triangle_is_one_new_shape_step_with_trimmed_corners() {
        let mut sharp = session();
        let triangle = json!({"kind": "polygon", "rect": [20, 10, 100, 80], "sides": 3, "fill": "#ff0000"});
        run(&mut sharp, "shape.create", triangle.clone()).unwrap();
        let sharp = shape(&sharp);
        let mut engine = session();
        let before = past(&engine);
        let mut rounded = triangle.clone();
        rounded["cornerRadius"] = json!(12);
        let info = run(&mut engine, "shape.create", rounded).unwrap();
        let state = engine.active().unwrap();
        assert_eq!((past(&engine), state.history.undo_label()), (before + 1, Some("New Shape Layer")));
        assert_eq!(state.doc.layer(state.active_layer.unwrap()).unwrap().name, "Polygon 1");
        assert_eq!(info["fill"], json!("#ff0000"));
        let rounded = shape(&engine);
        assert!(rounded.live.is_none());
        assert_eq!(knots(&rounded.path), vec![6]);
        // The apex is at (70, 10); a 12 px radius on its 72° corner starts the outline about 8.5 px lower.
        assert!(covered(&sharp.path, 69, 16) > 0.9 && covered(&rounded.path, 69, 16) < 0.05);
        assert!(covered(&rounded.path, 69, 24) > 0.9 && covered(&rounded.path, 70, 60) > 0.99);
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(engine.active().unwrap().doc.layers.len(), 1);
    }

    #[test]
    fn polygon_corners_round_and_stars_round_only_their_points() {
        let mut engine = session();
        run(&mut engine, "shape.create", json!({"kind": "polygon", "rect": [10, 10, 80, 80], "sides": 6, "cornerRadius": 8})).unwrap();
        assert_eq!(knots(&shape(&engine).path), vec![12]);
        run(&mut engine, "shape.create", json!({"kind": "polygon", "rect": [10, 10, 80, 80], "sides": 5, "starRatio": 0.5, "cornerRadius": 4})).unwrap();
        assert_eq!(knots(&shape(&engine).path), vec![15]);
        assert_eq!(engine.active().unwrap().doc.layer(engine.active().unwrap().active_layer.unwrap()).unwrap().name, "Star 1");
        // A radius larger than the sides allow stops where neighbouring corners meet.
        run(&mut engine, "shape.create", json!({"kind": "polygon", "rect": [10, 10, 80, 80], "sides": 4, "cornerRadius": 10000})).unwrap();
        let round = shape(&engine).path;
        assert_eq!(knots(&round), vec![4]);
        assert!(covered(&round, 49, 49) > 0.99 && covered(&round, 49, 25) > 0.9 && covered(&round, 49, 14) < 0.05);
        // Zero keeps the engine's live polygon.
        run(&mut engine, "shape.create", json!({"kind": "polygon", "rect": [10, 10, 80, 80], "sides": 3, "cornerRadius": 0})).unwrap();
        assert!(shape(&engine).live.is_some());
    }

    #[test]
    fn line_arrowheads_follow_photoshops_proportions_of_the_weight() {
        let line = |extra: Value| {
            let mut engine = session();
            let mut params = json!({"kind": "line", "from": [10, 40], "to": [110, 40], "weight": 4});
            params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            run(&mut engine, "shape.create", params).unwrap();
            (engine.active().unwrap().doc.layer(engine.active().unwrap().active_layer.unwrap()).unwrap().name.clone(), shape(&engine))
        };
        let (_, plain) = line(json!({"arrowStart": false, "arrowEnd": false}));
        assert!(plain.live.is_some(), "no arrowheads keeps the live line");
        // Defaults: 500 % wide and 1000 % long, so a 20 px wide, 40 px long head ending at the tip.
        let (name, end) = line(json!({"arrowEnd": true}));
        assert_eq!((name.as_str(), knots(&end.path)), ("Line 1", vec![7]));
        assert!(end.live.is_none());
        assert!(covered(&end.path, 100, 39) > 0.9 && covered(&end.path, 72, 47) > 0.9 && covered(&end.path, 12, 47) < 0.05);
        assert!(covered(&plain.path, 72, 47) < 0.05 && covered(&end.path, 111, 40) < 0.05);
        let (_, both) = line(json!({"arrowStart": true, "arrowEnd": true, "arrowWidth": 250, "arrowLength": 500}));
        assert_eq!(knots(&both.path), vec![10]);
        assert!(covered(&both.path, 25, 42) > 0.9 && covered(&both.path, 94, 42) > 0.9 && covered(&both.path, 50, 42) < 0.05);
        // Concavity moves the back of the head towards the tip (positive) or away from it (negative).
        let (_, concave) = line(json!({"arrowEnd": true, "arrowConcavity": 50}));
        let (_, convex) = line(json!({"arrowEnd": true, "arrowConcavity": -50}));
        assert!(covered(&end.path, 72, 47) > 0.9 && covered(&concave.path, 72, 47) < 0.05);
        assert!(covered(&end.path, 64, 42) < 0.05 && covered(&convex.path, 64, 42) > 0.9);
    }

    #[test]
    fn narrow_or_overlapping_arrowheads_combine_separate_pieces() {
        let mut engine = session();
        run(&mut engine, "shape.create", json!({"kind": "line", "from": [10, 40], "to": [110, 40], "weight": 10, "arrowEnd": true, "arrowWidth": 50, "arrowLength": 200})).unwrap();
        let narrow = shape(&engine).path;
        assert_eq!(knots(&narrow), vec![4, 4]);
        assert!(covered(&narrow, 85, 43) > 0.9 && covered(&narrow, 100, 40) > 0.9 && covered(&narrow, 100, 43) < 0.05);
        run(&mut engine, "shape.create", json!({"kind": "line", "from": [10, 40], "to": [40, 40], "weight": 4, "arrowStart": true, "arrowEnd": true})).unwrap();
        let short = shape(&engine).path;
        assert_eq!(knots(&short), vec![4, 4]);
        assert!(covered(&short, 11, 40) > 0.5 && covered(&short, 38, 40) > 0.5 && covered(&short, 25, 42) > 0.9);
    }

    #[test]
    fn shape_edit_redraws_a_live_shape_with_the_new_options() {
        let mut engine = session();
        run(&mut engine, "shape.create", json!({"kind": "polygon", "rect": [20, 10, 100, 80], "sides": 3, "fill": "#00ff00"})).unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap().0;
        let before = past(&engine);
        let info = run(&mut engine, "shape.edit", json!({"layer": layer, "cornerRadius": 12})).unwrap();
        assert_eq!((past(&engine), engine.active().unwrap().history.undo_label()), (before + 1, Some("Edit Shape")));
        assert_eq!((info["kind"].as_str(), info["fill"].as_str()), (Some("path"), Some("#00ff00")));
        assert!(covered(&shape(&engine).path, 69, 16) < 0.05 && covered(&shape(&engine).path, 69, 24) > 0.9);
        let error = run(&mut engine, "shape.edit", json!({"layer": layer, "cornerRadius": 20})).unwrap_err();
        assert!(error.contains("no live parameters"), "{error}");
        run(&mut engine, "shape.edit", json!({"layer": layer, "kind": "polygon", "rect": [20, 10, 100, 80], "sides": 4, "cornerRadius": 6})).unwrap();
        assert_eq!(knots(&shape(&engine).path), vec![8]);
        run(&mut engine, "shape.create", json!({"kind": "line", "from": [10, 90], "to": [130, 90], "weight": 2})).unwrap();
        let line = engine.active().unwrap().active_layer.unwrap().0;
        run(&mut engine, "shape.edit", json!({"layer": line, "arrowStart": true})).unwrap();
        assert!(covered(&shape(&engine).path, 25, 93) > 0.5);
    }

    #[test]
    fn shape_path_previews_every_kind_without_a_history_step() {
        let mut engine = session();
        let before = past(&engine);
        let rounded = run(&mut engine, "shape.path", json!({"kind": "polygon", "rect": [20, 10, 100, 80], "sides": 3, "cornerRadius": 12})).unwrap();
        let arrow = run(&mut engine, "shape.path", json!({"kind": "line", "from": [10, 40], "to": [110, 40], "weight": 4, "arrowEnd": true})).unwrap();
        let ellipse = run(&mut engine, "shape.path", json!({"kind": "ellipse", "rect": [10, 10, 40, 20]})).unwrap();
        assert_eq!(past(&engine), before);
        let knots = |value: &Value| value["path"]["subpaths"][0]["knots"].as_array().map(Vec::len);
        assert_eq!((knots(&rounded), knots(&arrow), knots(&ellipse)), (Some(6), Some(7), Some(4)));
        run(&mut engine, "shape.create", json!({"kind": "path", "path": rounded["path"]})).unwrap();
        assert_eq!(super::super::execute_view_command(&mut engine, "shape.info", json!({})).unwrap()["path"], rounded["path"]);
        assert!(run(&mut engine, "shape.path", json!({"kind": "polygon", "rect": [0, 0, 10, 10], "cornerRadius": -1})).is_err());
    }

    #[test]
    fn bad_shape_options_are_refused_without_a_history_step() {
        let triangle = json!({"kind": "polygon", "rect": [20, 10, 100, 80], "sides": 3});
        let line = json!({"kind": "line", "from": [10, 40], "to": [110, 40], "weight": 4});
        let with = |base: &Value, extra: Value| {
            let mut params = base.clone();
            params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            params
        };
        let cases = [
            (with(&triangle, json!({"cornerRadius": -1})), "cornerRadius must be a number from 0 to 10000"),
            (with(&triangle, json!({"cornerRadius": 10001})), "cornerRadius must be a number from 0 to 10000"),
            (with(&triangle, json!({"cornerRadius": "4"})), "cornerRadius must be a number from 0 to 10000"),
            (json!({"kind": "rect", "rect": [0, 0, 10, 10], "cornerRadius": 4}), "cornerRadius applies to polygon"),
            (json!({"rect": [0, 0, 10, 10], "cornerRadius": 4}), "cornerRadius applies to polygon"),
            (with(&triangle, json!({"cornerRadius": 4, "sides": 2})), "sides must be a whole number from 3 to 100"),
            (with(&triangle, json!({"cornerRadius": 4, "sides": 3.5})), "sides must be a whole number from 3 to 100"),
            (with(&triangle, json!({"cornerRadius": 4, "starRatio": 0})), "starRatio must be a number from 0.01 to 1"),
            (with(&triangle, json!({"cornerRadius": 4, "rect": [0, 0, 0, 10]})), "rect must be [x, y, width, height]"),
            (with(&triangle, json!({"cornerRadius": 4, "arrowEnd": true})), "arrowheads apply to line shapes"),
            (with(&line, json!({"arrowEnd": "yes"})), "arrowEnd must be true or false"),
            (with(&line, json!({"arrowStart": 1})), "arrowStart must be true or false"),
            (with(&line, json!({"arrowEnd": true, "arrowWidth": 9})), "arrowWidth must be a number from 10 to 1000"),
            (with(&line, json!({"arrowEnd": true, "arrowWidth": 1001})), "arrowWidth must be a number from 10 to 1000"),
            (with(&line, json!({"arrowEnd": true, "arrowLength": 5001})), "arrowLength must be a number from 10 to 5000"),
            (with(&line, json!({"arrowEnd": true, "arrowConcavity": 51})), "arrowConcavity must be a number from -50 to 50"),
            (with(&line, json!({"arrowEnd": true, "weight": 0})), "weight must be a number above 0 and up to 1000"),
            (with(&line, json!({"arrowEnd": true, "to": [10, 40]})), "different from and to points"),
            (json!({"kind": "line", "to": [10, 40], "arrowEnd": true}), "from must be [x, y]"),
            (with(&line, json!({"arrowEnd": true, "cornerRadius": 3})), "cornerRadius applies to polygon"),
            (json!({"kind": "ellipse", "rect": [0, 0, 10, 10], "arrowEnd": true}), "arrowheads apply to line shapes"),
        ];
        let mut engine = session();
        let (before, layers) = (past(&engine), engine.active().unwrap().doc.layers.len());
        for (params, needle) in cases {
            let error = run(&mut engine, "shape.create", params.clone()).unwrap_err();
            assert!(error.contains(needle), "{params}: {error}");
        }
        assert_eq!((past(&engine), engine.active().unwrap().doc.layers.len()), (before, layers));
    }
}
