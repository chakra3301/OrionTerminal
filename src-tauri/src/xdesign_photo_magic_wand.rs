//! Magic Wand's Sample Size, which the pinned engine lacks: the wand matches the average colour of an N×N
//! window around the click instead of the clicked pixel.
use photocraft_algo::selection::{combine_region, rgba8_image, wand_region, SelectionMode};
use photocraft_engine::Session;
use serde_json::{json, Value};

const CMD: &str = "select.magicWand";
const NAME: &str = "Magic Wand";
const SAMPLE_SIZES: [u64; 7] = [1, 3, 5, 11, 31, 51, 101];

struct Options {
    seed: (i32, i32),
    tolerance: f32,
    contiguous: bool,
    anti_alias: bool,
    all_layers: bool,
    mode: SelectionMode,
    size: u64,
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD {
        return None;
    }
    match parse(params) {
        Err(error) => Some(Err(error)),
        Ok(options) if options.size == 1 => None,
        Ok(options) => Some(apply(engine, params, &options)),
    }
}

fn given<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params.get(key).filter(|value| !value.is_null())
}

fn flag(params: &Value, key: &str, default: bool) -> Result<bool, String> {
    match given(params, key) {
        None => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{NAME}: {key} must be true or false")),
    }
}

fn coordinate(params: &Value, key: &str) -> Result<i32, String> {
    given(params, key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && value.abs() < f64::from(i32::MAX))
        .map(|value| value.floor() as i32)
        .ok_or_else(|| format!("{NAME}: {key} must be a number"))
}

/// Checked on every route, so the engine's silent defaults never apply.
fn parse(params: &Value) -> Result<Options, String> {
    let tolerance = match given(params, "tolerance") {
        None => 32.0,
        Some(value) => value.as_f64().filter(|value| (0.0..=255.0).contains(value)).ok_or_else(|| format!("{NAME}: tolerance must be a number from 0 to 255"))? as f32,
    };
    let mode = match given(params, "mode").map(Value::as_str) {
        None | Some(Some("replace")) => SelectionMode::Replace,
        Some(Some("add")) => SelectionMode::Add,
        Some(Some("subtract")) => SelectionMode::Subtract,
        Some(Some("intersect")) => SelectionMode::Intersect,
        Some(_) => return Err(format!("{NAME}: mode must be replace, add, subtract or intersect")),
    };
    let size = match given(params, "sampleSize") {
        None => 1,
        Some(value) => value.as_u64().filter(|size| SAMPLE_SIZES.contains(size)).ok_or_else(|| format!("{NAME}: sampleSize must be 1, 3, 5, 11, 31, 51 or 101"))?,
    };
    Ok(Options {
        seed: (coordinate(params, "x")?, coordinate(params, "y")?),
        tolerance,
        contiguous: flag(params, "contiguous", true)?,
        anti_alias: flag(params, "antiAlias", true)?,
        all_layers: flag(params, "sampleAllLayers", false)?,
        mode,
        size,
    })
}

/// The engine's wand over the same 8-bit image, with the clicked pixel standing in for the window average:
/// the fill always starts at the click and compares every other pixel with the seed's colour.
fn apply(engine: &mut Session, params: &Value, options: &Options) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{NAME}: {reason}"));
    }
    let state = engine.active().ok_or("No image document")?;
    let area = state.doc.bounds();
    let layer = state.active_layer.and_then(|id| state.doc.layer(id)).and_then(|layer| layer.surface());
    let mut image = match (options.all_layers, layer) {
        (false, Some(surface)) => rgba8_image(surface, area),
        _ => {
            let quantize = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            photocraft_compose::render(&state.doc, area).px.iter().map(|pixel| pixel.map(quantize)).collect()
        }
    };
    let (x, y) = options.seed;
    if area.contains(x, y) {
        let width = area.width() as usize;
        let half = (options.size / 2) as i32;
        let (x0, x1) = (x.saturating_sub(half).max(area.x0), x.saturating_add(half).min(area.x1 - 1));
        let (y0, y1) = (y.saturating_sub(half).max(area.y0), y.saturating_add(half).min(area.y1 - 1));
        let mut sum = [0u64; 4];
        for row in y0..=y1 {
            let start = (row - area.y0) as usize * width;
            for pixel in &image[start + (x0 - area.x0) as usize..=start + (x1 - area.x0) as usize] {
                for (total, value) in sum.iter_mut().zip(pixel) {
                    *total += u64::from(*value);
                }
            }
        }
        let count = ((x1 - x0 + 1) * (y1 - y0 + 1)) as u64;
        image[(y - area.y0) as usize * width + (x - area.x0) as usize] = sum.map(|total| ((total + count / 2) / count) as u8);
    }
    let region = wand_region(&image, area, (x, y), options.tolerance, options.contiguous, options.anti_alias);
    drop(image);
    let mode = options.mode;
    let selected = engine
        .edit(NAME, |doc, _| {
            doc.selection = combine_region(doc.selection.as_ref(), region.as_ref(), mode);
            Ok(doc.selection.is_some())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((CMD.to_owned(), params.clone()));
    Ok(json!({ "selected": selected }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_algo::selection::mask_from_surface;
    use photocraft_engine::doc::{ColorMode, Document, Layer, SampleType, Size};
    use serde_json::json;

    const WIDTH: u32 = 12;
    const HEIGHT: u32 = 6;
    const A: f32 = 100.0 / 255.0;
    const B: f32 = 140.0 / 255.0;
    const C: f32 = 120.0 / 255.0;

    /// A checkerboard of A and B on the left half (averaging to about C), plain C on the right half, and
    /// an empty layer on top.
    fn session() -> Session {
        let mut doc = Document::new("Wand", Size::new(WIDTH, HEIGHT), ColorMode::Rgb, SampleType::U8);
        let mut base = Layer::raster("Base", doc.pixel_format());
        let data: Vec<f32> = (0..WIDTH * HEIGHT)
            .flat_map(|i| {
                let (x, y) = (i % WIDTH, i / WIDTH);
                let v = if x >= WIDTH / 2 { C } else if (x + y) % 2 == 0 { A } else { B };
                [v, v, v, 1.0]
            })
            .collect();
        base.surface_mut().unwrap().write_region(doc.bounds(), &data);
        doc.layers.push(base);
        doc.layers.push(Layer::raster("Empty", doc.pixel_format()));
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.set_active(0);
        let base = engine.active().unwrap().doc.layers[0].id;
        engine.active_mut().unwrap().active_layer = Some(base);
        engine
    }
    fn selected(engine: &Session) -> Vec<(u32, u32)> {
        let doc = &engine.active().unwrap().doc;
        let mask = mask_from_surface(doc.selection.as_ref(), doc.bounds());
        mask.iter().enumerate().filter(|(_, m)| **m > 0.5).map(|(i, _)| (i as u32 % WIDTH, i as u32 / WIDTH)).collect()
    }
    fn wand(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    #[test]
    fn sample_size_matches_the_window_average_instead_of_the_clicked_pixel() {
        let mut point = session();
        wand(&mut point, json!({"x": 1.4, "y": 1.6, "tolerance": 25, "antiAlias": false})).unwrap();
        assert_eq!(selected(&point), vec![(1, 1)]);
        let mut engine = session();
        let past = engine.active().unwrap().history.past_len();
        let params = json!({"x": 1.4, "y": 1.6, "tolerance": 25, "antiAlias": false, "sampleSize": 3});
        assert_eq!(wand(&mut engine, params.clone()).unwrap(), json!({"selected": true}));
        assert_eq!(selected(&engine).len(), (WIDTH * HEIGHT) as usize);
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Magic Wand")));
        assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params)));
        engine.execute("edit.undo", json!({})).unwrap();
        assert!(engine.active().unwrap().doc.selection.is_none());
        // A tight tolerance around the average matches only the plain half; the clicked pixel seeds the fill.
        let mut engine = session();
        wand(&mut engine, json!({"x": 1, "y": 1, "tolerance": 5, "antiAlias": false, "contiguous": false, "sampleSize": 3})).unwrap();
        let mut expected: Vec<(u32, u32)> = (0..WIDTH * HEIGHT).map(|i| (i % WIDTH, i / WIDTH)).filter(|(x, _)| *x >= WIDTH / 2).collect();
        expected.push((1, 1));
        expected.sort_by_key(|(x, y)| (*y, *x));
        assert_eq!(selected(&engine), expected);
    }

    #[test]
    fn the_window_is_clipped_to_the_canvas_and_every_size_is_accepted() {
        // At the corner the 5 by 5 window keeps 9 pixels: five A and four B.
        let mut engine = session();
        wand(&mut engine, json!({"x": 0, "y": 0, "tolerance": 18, "antiAlias": false, "contiguous": false, "sampleSize": 5})).unwrap();
        let picked = selected(&engine);
        assert!(picked.iter().all(|(x, y)| *x >= WIDTH / 2 || (x + y) % 2 == 0), "{picked:?}");
        assert_eq!(picked.len(), (WIDTH * HEIGHT) as usize / 2 + (WIDTH * HEIGHT) as usize / 4);
        for size in [1, 3, 5, 11, 31, 51, 101] {
            let mut engine = session();
            wand(&mut engine, json!({"x": 8, "y": 3, "tolerance": 0, "antiAlias": false, "sampleSize": size})).unwrap();
            assert_eq!(selected(&engine).len(), (WIDTH * HEIGHT) as usize / 2, "{size}");
        }
    }

    #[test]
    fn averaged_samples_combine_with_the_selection_and_can_read_all_layers() {
        let mut engine = session();
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 2, "height": 1, "antiAlias": false})).unwrap();
        wand(&mut engine, json!({"x": 8, "y": 3, "tolerance": 0, "antiAlias": false, "sampleSize": 11, "mode": "add"})).unwrap();
        assert_eq!(selected(&engine).len(), (WIDTH * HEIGHT) as usize / 2 + 2);
        wand(&mut engine, json!({"x": 8, "y": 3, "tolerance": 0, "antiAlias": false, "sampleSize": 11, "mode": "subtract"})).unwrap();
        assert_eq!(selected(&engine), vec![(0, 0), (1, 0)]);
        // On the empty top layer the wand sees only transparency unless it samples every layer.
        let mut engine = session();
        let top = engine.active().unwrap().doc.layers[1].id;
        engine.active_mut().unwrap().active_layer = Some(top);
        wand(&mut engine, json!({"x": 8, "y": 3, "tolerance": 0, "antiAlias": false, "sampleSize": 3})).unwrap();
        assert_eq!(selected(&engine).len(), (WIDTH * HEIGHT) as usize);
        wand(&mut engine, json!({"x": 8, "y": 3, "tolerance": 0, "antiAlias": false, "sampleSize": 3, "sampleAllLayers": true})).unwrap();
        assert_eq!(selected(&engine).len(), (WIDTH * HEIGHT) as usize / 2);
    }

    #[test]
    fn point_sample_stays_native_and_bad_options_are_refused() {
        let params = json!({"x": 1, "y": 1, "tolerance": 50, "antiAlias": false});
        let mut native = session();
        native.execute(CMD, params.clone()).unwrap();
        let mut engine = session();
        let mut point = params.clone();
        point["sampleSize"] = json!(1);
        wand(&mut engine, point).unwrap();
        assert_eq!(selected(&engine), selected(&native));
        let past = engine.active().unwrap().history.past_len();
        for (params, message) in [
            (json!({"x": 1, "y": 1, "sampleSize": 2}), "sampleSize must be 1, 3, 5, 11, 31, 51 or 101"),
            (json!({"x": 1, "y": 1, "sampleSize": "3"}), "sampleSize must be 1, 3, 5, 11, 31, 51 or 101"),
            (json!({"x": 1, "y": 1, "tolerance": 256}), "tolerance must be a number from 0 to 255"),
            (json!({"x": 1, "y": 1, "tolerance": -1, "sampleSize": 3}), "tolerance must be a number from 0 to 255"),
            (json!({"x": 1, "y": 1, "mode": "new"}), "mode must be replace, add, subtract or intersect"),
            (json!({"x": 1, "y": 1, "contiguous": "yes"}), "contiguous must be true or false"),
            (json!({"x": 1, "y": 1, "antiAlias": 1}), "antiAlias must be true or false"),
            (json!({"x": 1, "y": 1, "sampleAllLayers": "no"}), "sampleAllLayers must be true or false"),
            (json!({"y": 1}), "x must be a number"),
            (json!({"x": 1, "y": "top", "sampleSize": 5}), "y must be a number"),
        ] {
            let error = wand(&mut engine, params.clone()).unwrap_err();
            assert!(error.starts_with("Magic Wand: ") && error.contains(message), "{params}: {error}");
        }
        assert_eq!(engine.active().unwrap().history.past_len(), past);
        assert_eq!(selected(&engine), selected(&native));
    }
}
