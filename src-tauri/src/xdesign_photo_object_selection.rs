//! Object Selection's Hard Edge and Lasso mode, which the pinned engine lacks: its command only takes a
//! rectangle and always anti-aliases the result.
use photocraft_algo::{
    segment::{clean_mask, finish_region, grabcut, scale_for, Sampler, SurfaceSampler},
    selection::{combine_region, Region, SelectionMode},
};
use photocraft_engine::{
    doc::{Document, Rect},
    Session,
};
use serde_json::{json, Value};

const CMD: &str = "select.object";
const NAME: &str = "Object Selection";
/// The engine's working-copy budget for Object Selection (smartselect_cmds.rs:118).
const WORK_PIXELS: usize = 160_000;
const MAX_POINTS: usize = 65_536;

enum Area {
    Rect(Rect),
    Lasso(Vec<[f64; 2]>),
}

struct Options {
    area: Area,
    hard_edge: bool,
    all_layers: bool,
    mode: SelectionMode,
}

struct Composite<'a>(&'a Document);
impl Sampler for Composite<'_> {
    fn rgba(&self, rect: Rect) -> Vec<[f32; 4]> {
        photocraft_compose::render(self.0, rect).px
    }
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD {
        return None;
    }
    match parse(params) {
        Err(error) => Some(Err(error)),
        Ok(Options { area: Area::Rect(_), hard_edge: false, .. }) => None,
        Ok(options) => Some(apply(engine, params, &options)),
    }
}

fn given<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params.get(key).filter(|value| !value.is_null())
}

fn flag(params: &Value, key: &str) -> Result<bool, String> {
    match given(params, key) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{NAME}: {key} must be true or false")),
    }
}

fn numbers(value: &Value, count: usize) -> Option<Vec<f64>> {
    let values: Vec<f64> = value.as_array()?.iter().map(|v| v.as_f64().filter(|v| v.is_finite())).collect::<Option<_>>()?;
    (values.len() == count).then_some(values)
}

/// Checked on every route, so the engine's silent defaults never apply.
fn parse(params: &Value) -> Result<Options, String> {
    let area = match (given(params, "rect"), given(params, "points")) {
        (Some(_), Some(_)) => return Err(format!("{NAME}: give rect [x, y, width, height] or lasso points, not both")),
        (None, None) => return Err(format!("{NAME}: give rect [x, y, width, height] or lasso points")),
        (Some(rect), None) => {
            let v = numbers(rect, 4).ok_or_else(|| format!("{NAME}: rect must be [x, y, width, height]"))?;
            // Like the engine, a drag up or left gives a negative size.
            let (x0, x1) = (v[0].min(v[0] + v[2]), v[0].max(v[0] + v[2]));
            let (y0, y1) = (v[1].min(v[1] + v[3]), v[1].max(v[1] + v[3]));
            Area::Rect(Rect::new(x0.floor() as i32, y0.floor() as i32, x1.ceil() as i32, y1.ceil() as i32))
        }
        (None, Some(points)) => {
            let bad = || format!("{NAME}: points must be a list of 3 to {MAX_POINTS} [x, y] points");
            let list = points.as_array().filter(|list| (3..=MAX_POINTS).contains(&list.len())).ok_or_else(bad)?;
            Area::Lasso(list.iter().map(|point| numbers(point, 2).map(|v| [v[0], v[1]])).collect::<Option<_>>().ok_or_else(bad)?)
        }
    };
    let mode = match given(params, "mode").map(Value::as_str) {
        None | Some(Some("replace")) => SelectionMode::Replace,
        Some(Some("add")) => SelectionMode::Add,
        Some(Some("subtract")) => SelectionMode::Subtract,
        Some(Some("intersect")) => SelectionMode::Intersect,
        Some(_) => return Err(format!("{NAME}: mode must be replace, add, subtract or intersect")),
    };
    Ok(Options { area, hard_edge: flag(params, "hardEdge")?, all_layers: flag(params, "sampleAllLayers")?, mode })
}

/// Even-odd crossings of the outline with the horizontal line at `y`, sorted.
fn crossings(outline: &[[f64; 2]], y: f64, out: &mut Vec<f64>) {
    out.clear();
    for (i, a) in outline.iter().enumerate() {
        let b = outline[(i + 1) % outline.len()];
        if (a[1] <= y) != (b[1] <= y) {
            out.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
    }
    out.sort_by(f64::total_cmp);
}

/// The engine's rectangle-mode GrabCut (algo/src/segment/grabcut.rs:77-118) with the trimap's probable
/// foreground taken from the lasso outline instead of its bounding box.
fn lasso_select(sampler: &dyn Sampler, canvas: Rect, outline: &[[f64; 2]]) -> Option<Region> {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for [x, y] in outline {
        (x0, y0, x1, y1) = (x0.min(*x), y0.min(*y), x1.max(*x), y1.max(*y));
    }
    let clamp = |v: f64| v.clamp(f64::from(i32::MIN / 2), f64::from(i32::MAX / 2)) as i32;
    let rect = Rect::new(clamp(x0.floor()), clamp(y0.floor()), clamp(x1.ceil()), clamp(y1.ceil())).intersect(&canvas);
    if rect.width() < 2 || rect.height() < 2 {
        return None;
    }
    let margin = ((rect.width().max(rect.height()) as f32 * 0.15).ceil() as i32).max(8);
    let window = rect.inflate(margin).intersect(&canvas);
    let step = scale_for(window, WORK_PIXELS);
    let image = sampler.rgb_scaled(window, step);
    let (lw, lh) = (image.w, image.h);
    let mut trimap = vec![grabcut::BG; lw * lh];
    let mut row = Vec::new();
    let mut any_background = false;
    for y in 0..lh {
        let centre = |i: usize, origin: i32| f64::from(origin + (i * step + step / 2) as i32) + 0.5;
        crossings(outline, centre(y, window.y0), &mut row);
        for x in 0..lw {
            let cx = centre(x, window.x0);
            if row.iter().filter(|crossing| **crossing <= cx).count() % 2 == 1 {
                trimap[y * lw + x] = grabcut::PR_FG;
            } else {
                any_background = true;
            }
        }
    }
    if !any_background {
        let ring = (lw.min(lh) / 50).max(1);
        for y in 0..lh {
            for x in 0..lw {
                if x < ring || y < ring || x + ring >= lw || y + ring >= lh {
                    trimap[y * lw + x] = grabcut::BG;
                }
            }
        }
    }
    let (foreground, background) = grabcut::grabcut(&image, &mut trimap, 8)?;
    let low: Vec<bool> = trimap.iter().map(|t| matches!(*t, grabcut::FG | grabcut::PR_FG)).collect();
    let low = clean_mask(&low, lw, lh, 0.1, 0.002);
    finish_region(sampler, window, step, &low, lw, lh, Some((&foreground, &background)))
}

fn apply(engine: &mut Session, params: &Value, options: &Options) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{NAME}: {reason}"));
    }
    let state = engine.active().ok_or("No image document")?;
    let doc = state.doc.clone();
    let canvas = doc.bounds();
    let layer = state.active_layer.and_then(|id| doc.layer(id)).and_then(|layer| layer.surface());
    let surface_sampler;
    let composite = Composite(&doc);
    let sampler: &dyn Sampler = match (options.all_layers, layer) {
        (false, Some(surface)) => {
            surface_sampler = SurfaceSampler(surface);
            &surface_sampler
        }
        _ => &composite,
    };
    let mut region = match &options.area {
        Area::Rect(rect) => grabcut::object_select(sampler, canvas, *rect, WORK_PIXELS),
        Area::Lasso(outline) => lasso_select(sampler, canvas, outline),
    };
    if options.hard_edge {
        if let Some(region) = region.as_mut() {
            for coverage in region.mask.iter_mut() {
                *coverage = if *coverage >= 128 { 255 } else { 0 };
            }
        }
    }
    let mode = options.mode;
    if region.is_none() && matches!(mode, SelectionMode::Add | SelectionMode::Subtract) {
        return Ok(json!({ "selected": doc.selection.is_some(), "changed": false }));
    }
    let bounds = region.as_ref().map(|region| [region.bbox.x0, region.bbox.y0, region.bbox.width() as i32, region.bbox.height() as i32]);
    let selected = engine
        .edit(NAME, |doc, _| {
            doc.selection = combine_region(doc.selection.as_ref(), region.as_ref(), mode);
            Ok(doc.selection.is_some())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((CMD.to_owned(), params.clone()));
    Ok(json!({ "selected": selected, "changed": true, "bounds": bounds }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Layer, SampleType, Size};
    use serde_json::json;

    const W: i32 = 120;
    const H: i32 = 80;
    /// A Γ whose bounding box holds both discs but whose outline holds only the red one.
    const GAMMA: [[i32; 2]; 6] = [[4, 2], [116, 2], [116, 6], [56, 6], [56, 76], [4, 76]];

    fn red(x: i32, y: i32) -> bool {
        let (dx, dy) = (x as f32 + 0.5 - 30.0, y as f32 + 0.5 - 40.0);
        dx * dx + dy * dy <= 18.0 * 18.0
    }
    fn yellow(x: i32, y: i32) -> bool {
        let (dx, dy) = (x as f32 + 0.5 - 90.0, y as f32 + 0.5 - 24.0);
        dx * dx + dy * dy <= 14.0 * 14.0
    }
    fn in_gamma(x: i32, y: i32) -> bool {
        (4..56).contains(&x) && (2..76).contains(&y) || (4..116).contains(&x) && (2..6).contains(&y)
    }
    /// Red and yellow discs on a noisy blue ground.
    fn session() -> Session {
        let mut doc = Document::new("Object", Size::new(W as u32, H as u32), ColorMode::Rgb, SampleType::U8);
        let mut layer = Layer::raster("Layer 0", doc.pixel_format());
        let data: Vec<f32> = (0..W * H)
            .flat_map(|i| {
                let (x, y) = (i % W, i / W);
                let n = ((i as u32).wrapping_mul(2_654_435_761) >> 24) as f32 / 255.0 * 0.06;
                let rgb = if red(x, y) { [0.85, 0.2, 0.15] } else if yellow(x, y) { [0.9, 0.85, 0.1] } else { [0.25, 0.45, 0.7] };
                [rgb[0] + n, rgb[1] + n, rgb[2] + n, 1.0]
            })
            .collect();
        layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
        doc.layers.push(layer);
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.set_active(0);
        let id = engine.active().unwrap().doc.layers[0].id;
        engine.active_mut().unwrap().active_layer = Some(id);
        engine
    }
    fn coverage(engine: &Session, x: i32, y: i32) -> f32 {
        engine.active().unwrap().doc.selection.as_ref().map_or(0.0, |mask| mask.sample_channel(x, y, 0))
    }
    fn iou(engine: &Session, truth: impl Fn(i32, i32) -> bool) -> f32 {
        let (mut both, mut either) = (0, 0);
        for y in 0..H {
            for x in 0..W {
                let (a, b) = (coverage(engine, x, y) >= 0.5, truth(x, y));
                both += (a && b) as i32;
                either += (a || b) as i32;
            }
        }
        both as f32 / either.max(1) as f32
    }
    fn select(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    #[test]
    fn lasso_mode_bounds_the_object_search_by_its_outline() {
        let mut rect = session();
        rect.execute(CMD, json!({"rect": [4, 2, 112, 74]})).unwrap();
        assert!(coverage(&rect, 90, 24) >= 0.5 && coverage(&rect, 30, 40) >= 0.5);
        let mut engine = session();
        let past = engine.active().unwrap().history.past_len();
        let params = json!({"points": GAMMA});
        let result = select(&mut engine, params.clone()).unwrap();
        assert_eq!((result["selected"].clone(), result["changed"].clone()), (json!(true), json!(true)));
        assert!(iou(&engine, red) > 0.9, "IoU {}", iou(&engine, red));
        assert!(coverage(&engine, 90, 24) < 0.5);
        assert!((0..H).all(|y| (0..W).all(|x| in_gamma(x, y) || coverage(&engine, x, y) == 0.0)));
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Object Selection")));
        assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params)));
        engine.execute("edit.undo", json!({})).unwrap();
        assert!(engine.active().unwrap().doc.selection.is_none());
    }

    #[test]
    fn hard_edge_thresholds_the_anti_aliased_edge() {
        let mut soft = session();
        soft.execute(CMD, json!({"rect": [8, 18, 46, 46]})).unwrap();
        assert!((0..H).any(|y| (0..W).any(|x| { let c = coverage(&soft, x, y); c > 0.01 && c < 0.99 })));
        let mut engine = session();
        select(&mut engine, json!({"rect": [8, 18, 46, 46], "hardEdge": true})).unwrap();
        for y in 0..H {
            for x in 0..W {
                let hard = coverage(&engine, x, y);
                assert_eq!(hard, if coverage(&soft, x, y) >= 0.5 { 1.0 } else { 0.0 }, "({x}, {y})");
            }
        }
        let mut lasso = session();
        select(&mut lasso, json!({"points": GAMMA, "hardEdge": true})).unwrap();
        assert!((0..H).all(|y| (0..W).all(|x| matches!(coverage(&lasso, x, y), 0.0 | 1.0))));
        assert!(iou(&lasso, red) > 0.9);
    }

    #[test]
    fn lasso_regions_combine_with_the_selection_mode() {
        let mut engine = session();
        engine.execute("select.rect", json!({"x": 100, "y": 60, "width": 10, "height": 10, "antiAlias": false})).unwrap();
        select(&mut engine, json!({"points": GAMMA, "mode": "add"})).unwrap();
        assert!(coverage(&engine, 30, 40) >= 0.5 && coverage(&engine, 105, 65) == 1.0);
        select(&mut engine, json!({"points": GAMMA, "mode": "subtract"})).unwrap();
        assert!(coverage(&engine, 30, 40) < 0.5 && coverage(&engine, 105, 65) == 1.0);
        // A lasso around plain ground finds nothing, so Add leaves the selection and history alone.
        let past = engine.active().unwrap().history.past_len();
        let tiny = json!({"points": [[100, 40], [101, 40], [100, 41]], "mode": "add"});
        assert_eq!(select(&mut engine, tiny).unwrap()["changed"], json!(false));
        assert_eq!(engine.active().unwrap().history.past_len(), past);
    }

    #[test]
    fn plain_rectangles_stay_native_and_bad_options_are_refused() {
        let mut native = session();
        native.execute(CMD, json!({"rect": [8, 18, 46, 46]})).unwrap();
        let mut engine = session();
        select(&mut engine, json!({"rect": [8, 18, 46, 46], "hardEdge": false, "sampleAllLayers": false})).unwrap();
        assert!((0..H).all(|y| (0..W).all(|x| coverage(&engine, x, y) == coverage(&native, x, y))));
        let past = engine.active().unwrap().history.past_len();
        for (params, message) in [
            (json!({}), "give rect [x, y, width, height] or lasso points"),
            (json!({"rect": [1, 2, 3, 4], "points": GAMMA}), "give rect [x, y, width, height] or lasso points, not both"),
            (json!({"rect": [1, 2]}), "rect must be [x, y, width, height]"),
            (json!({"rect": [1, 2, "w", 4]}), "rect must be [x, y, width, height]"),
            (json!({"points": [[1, 2], [3, 4]]}), "points must be a list of 3 to 65536 [x, y] points"),
            (json!({"points": [[1, 2], [3, 4], [5]]}), "points must be a list of 3 to 65536 [x, y] points"),
            (json!({"points": "gamma"}), "points must be a list of 3 to 65536 [x, y] points"),
            (json!({"rect": [1, 2, 30, 40], "hardEdge": "yes"}), "hardEdge must be true or false"),
            (json!({"rect": [1, 2, 30, 40], "sampleAllLayers": 1}), "sampleAllLayers must be true or false"),
            (json!({"rect": [1, 2, 30, 40], "mode": "xor"}), "mode must be replace, add, subtract or intersect"),
        ] {
            let error = select(&mut engine, params.clone()).unwrap_err();
            assert!(error.starts_with("Object Selection: ") && error.contains(message), "{params}: {error}");
        }
        assert_eq!(engine.active().unwrap().history.past_len(), past);
    }
}
