//! Replace Color's Add to Sample and Subtract from Sample eyedroppers and Localized Color Clusters, which the
//! pinned engine's single-colour Replace Color lacks. The hue, saturation and lightness shift is the engine's own.
use std::ops::RangeInclusive;

use photocraft_algo::{selection::{color_range_samples, RangeSample}, tone};
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{Layer, Rect, Surface},
    edit_menu_cmds::FadeSource,
    EngineError, Session,
};
use photocraft_raster::from_rgba_into;
use serde_json::Value;

const CMD: &str = "image.adjustments.replaceColor";
const NAME: &str = "Replace Color";
/// Keys the engine's route ignores; any of them moves the request to this module.
const EXTENDED: [&str; 6] = ["colors", "points", "subtractColors", "subtractPoints", "localized", "range"];
/// Every pixel is judged against every sample, so a list stays small enough to preview.
const MAX_SAMPLES: usize = 256;

struct Options {
    color: Option<[f32; 3]>,
    colors: Vec<[f32; 3]>,
    points: Vec<(i32, i32)>,
    minus_colors: Vec<[f32; 3]>,
    minus_points: Vec<(i32, i32)>,
    localized: Option<f32>,
    fuzziness: f32,
    hue: f32,
    saturation: f32,
    lightness: f32,
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD {
        return None;
    }
    let area = engine.active()?.doc.bounds();
    let options = match parse(params, area) {
        Ok(options) => options,
        Err(error) => return Some(Err(error)),
    };
    if !EXTENDED.iter().any(|key| params.get(*key).is_some_and(|value| !value.is_null())) {
        return None;
    }
    Some(replace(engine, params, &options))
}

fn given<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params.get(key).filter(|value| !value.is_null())
}

fn number(params: &Value, key: &str, range: RangeInclusive<f64>, default: f64) -> Result<f32, String> {
    match given(params, key) {
        None => Ok(default as f32),
        Some(value) => value
            .as_f64()
            .filter(|value| range.contains(value))
            .map(|value| value as f32)
            .ok_or_else(|| format!("{NAME}: {key} must be a number from {} to {}", range.start(), range.end())),
    }
}

fn list<'a>(params: &'a Value, key: &str, what: &str) -> Result<&'a [Value], String> {
    let Some(value) = given(params, key) else { return Ok(&[]) };
    let items = value.as_array().ok_or_else(|| format!("{NAME}: {key} must be a list of {what}"))?;
    if items.len() > MAX_SAMPLES {
        return Err(format!("{NAME}: {key} takes at most {MAX_SAMPLES} samples"));
    }
    Ok(items)
}

fn colors(params: &Value, key: &str) -> Result<Vec<[f32; 3]>, String> {
    list(params, key, "colours")?
        .iter()
        .map(|value| super::mixer_reservoir::color(NAME, value).map(|[r, g, b, _]| [r, g, b]))
        .collect()
}

fn points(params: &Value, key: &str, area: Rect) -> Result<Vec<(i32, i32)>, String> {
    list(params, key, "[x, y] points")?
        .iter()
        .map(|point| {
            let (x, y) = point
                .as_array()
                .and_then(|pair| match pair.as_slice() {
                    [x, y] => Some((x.as_f64()?, y.as_f64()?)),
                    _ => None,
                })
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .ok_or_else(|| format!("{NAME}: bad point {point} in {key} (want [x, y])"))?;
            let at = (x.floor() as i32, y.floor() as i32);
            if !area.contains(at.0, at.1) {
                return Err(format!("{NAME}: point [{x}, {y}] in {key} is outside the canvas"));
            }
            Ok(at)
        })
        .collect()
}

fn parse(params: &Value, area: Rect) -> Result<Options, String> {
    let color = match given(params, "color") {
        None => None,
        Some(value) => Some(super::mixer_reservoir::color(NAME, value).map(|[r, g, b, _]| [r, g, b])?),
    };
    let (added, subtracted) = (points(params, "points", area)?, points(params, "subtractPoints", area)?);
    let localized = match given(params, "localized") {
        None | Some(Value::Bool(false)) => false,
        Some(Value::Bool(true)) => true,
        Some(_) => return Err(format!("{NAME}: localized must be true or false")),
    };
    let range = number(params, "range", 0.0..=100.0, 100.0)?;
    let localized = if localized {
        if added.is_empty() && subtracted.is_empty() {
            return Err(format!("{NAME}: Localized Color Clusters need eyedropper points"));
        }
        // Range is a percentage of the canvas's longer side, as in Select › Color Range.
        Some(range / 100.0 * area.width().max(area.height()) as f32)
    } else {
        None
    };
    Ok(Options {
        color,
        colors: colors(params, "colors")?,
        points: added,
        minus_colors: colors(params, "subtractColors")?,
        minus_points: subtracted,
        localized,
        fuzziness: number(params, "fuzziness", 0.0..=200.0, 40.0)?,
        hue: number(params, "hue", -180.0..=180.0, 0.0)?,
        saturation: number(params, "saturation", -100.0..=100.0, 0.0)?,
        lightness: number(params, "lightness", -100.0..=100.0, 0.0)?,
    })
}

fn replace(engine: &mut Session, params: &Value, options: &Options) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{NAME}: {reason}"));
    }
    let state = engine.active().ok_or("No image document")?;
    let routed = super::mask_filters::target(engine, params)?.is_some()
        || given(params, "target").is_some_and(|target| target != "pixels");
    if routed || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err(format!("{NAME}: Add and Subtract samples and Localized Color Clusters need a pixel layer target; masks and channels take one sample colour"));
    }
    let id = state.active_layer.ok_or_else(|| format!("{NAME}: select a layer"))?;
    let layer = state.doc.layer(id).ok_or_else(|| format!("{NAME}: the layer no longer exists"))?;
    if layer.locks.pixels || layer.locks.all {
        return Err(format!("Could not complete your request because the layer \"{}\" is locked", layer.name));
    }
    let mut surface = layer.surface().ok_or_else(|| format!("{NAME}: the active layer has no pixels; rasterize it first"))?.clone();
    let selection = state.doc.selection.clone();
    let picked = |&(x, y): &(i32, i32)| {
        let [r, g, b, _] = surface.rgba(x, y);
        RangeSample { color: [r, g, b], at: Some((x as f32, y as f32)) }
    };
    let unplaced = |&color: &[f32; 3]| RangeSample { color, at: None };
    let mut add: Vec<RangeSample> = options.points.iter().map(picked).chain(options.colors.iter().map(unplaced)).collect();
    if options.color.is_some() || add.is_empty() {
        let [r, g, b, _] = engine.tools.foreground;
        add.push(unplaced(&options.color.unwrap_or([r, g, b])));
    }
    let minus: Vec<RangeSample> = options.minus_points.iter().map(picked).chain(options.minus_colors.iter().map(unplaced)).collect();
    apply(&mut surface, selection.as_ref(), &add, &minus, options);
    super::mask_filters::edit_history(engine, NAME, params, |doc, _| {
        *doc.layer_mut(id).and_then(Layer::surface_mut).ok_or(EngineError::NoLayer(id))? = surface;
        Ok(())
    })?;
    engine.journal.push((CMD.to_owned(), params.clone()));
    let state = engine.active().ok_or("No image document")?;
    let label = state.history.undo_label().unwrap_or(NAME).to_owned();
    engine.edit_state.fade = Some(FadeSource { doc: state.doc.id, revision: state.revision, layer: id, mask: false, label });
    Ok(Value::Null)
}

fn apply(surface: &mut Surface, selection: Option<&Surface>, add: &[RangeSample], minus: &[RangeSample], options: &Options) {
    let area = surface.content_bounds();
    let format = surface.format();
    let channels = format.channels();
    let (band_width, band_height) = super::adjust::BAND;
    for y in (area.y0..area.y1).step_by(band_height as usize) {
        for x in (area.x0..area.x1).step_by(band_width as usize) {
            let rect = Rect::new(x, y, x.saturating_add(band_width).min(area.x1), y.saturating_add(band_height).min(area.y1));
            let width = rect.width() as usize;
            let pixels = width * rect.height() as usize;
            let mut original = vec![[0.0; 4]; pixels];
            surface.read_rgba_into(rect, &mut original);
            // Sample positions are relative to the pixels judged, so each band moves them to its own origin.
            let local = |samples: &[RangeSample]| -> Vec<RangeSample> {
                samples
                    .iter()
                    .map(|sample| RangeSample { at: sample.at.map(|(sx, sy)| (sx - rect.x0 as f32, sy - rect.y0 as f32)), ..*sample })
                    .collect()
            };
            let mut mask = color_range_samples(&original, width, &local(add), options.fuzziness, options.localized);
            if !minus.is_empty() {
                let cut = color_range_samples(&original, width, &local(minus), options.fuzziness, options.localized);
                for (keep, cut) in mask.iter_mut().zip(cut) {
                    *keep *= 1.0 - cut;
                }
            }
            if mask.iter().all(|k| *k <= 0.0) {
                continue;
            }
            let mut shifted = original.clone();
            // No colour distance reaches this fuzziness, so the engine shifts every opaque pixel fully and the
            // host's own mask decides how much of it each pixel keeps.
            tone::replace_color(&mut shifted, [0.0; 3], f32::MAX, options.hue, options.saturation, options.lightness);
            let coverage = selection.map(|selection| (selection.read_region(rect), selection.channels()));
            let mut output = vec![0.0; pixels * channels];
            for (index, ((edited, original), k)) in shifted.iter().zip(&original).zip(&mask).enumerate() {
                let k = k * coverage.as_ref().map_or(1.0, |(coverage, stride)| coverage[index * stride]);
                let mixed = [
                    original[0] + (edited[0] - original[0]) * k,
                    original[1] + (edited[1] - original[1]) * k,
                    original[2] + (edited[2] - original[2]) * k,
                    original[3],
                ];
                from_rgba_into(&format, mixed, &mut output[index * channels..(index + 1) * channels]);
            }
            surface.write_region(rect, &output);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Layer, LayerId, SampleType, Size};
    use serde_json::json;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const GREEN: [f32; 4] = [0.0, 1.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
    const GRAY: [f32; 4] = [0.5, 0.5, 0.5, 1.0];
    const CYAN: [f32; 4] = [0.0, 1.0, 1.0, 1.0];
    const MAGENTA: [f32; 4] = [1.0, 0.0, 1.0, 1.0];
    const YELLOW: [f32; 4] = [1.0, 1.0, 0.0, 1.0];

    fn session(row: &[[f32; 4]]) -> Session {
        let mut doc = Document::new("Replace", Size::new(row.len() as u32, 1), ColorMode::Rgb, SampleType::U8);
        let mut layer = Layer::raster("Layer 0", doc.pixel_format());
        let data: Vec<f32> = row.iter().flatten().copied().collect();
        layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
        doc.layers.push(layer);
        let top = doc.layers.last().unwrap().id;
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.active_mut().unwrap().active_layer = Some(top);
        engine
    }
    fn active(engine: &Session) -> LayerId {
        engine.active().unwrap().active_layer.unwrap()
    }
    fn row(engine: &Session) -> Vec<[f32; 4]> {
        let state = engine.active().unwrap();
        let surface = state.doc.layer(active(engine)).unwrap().surface().unwrap();
        (0..state.doc.size.width as i32).map(|x| surface.rgba(x, 0)).collect()
    }
    fn close(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= 1.5 / 255.0)
    }
    fn assert_row(engine: &Session, expected: &[[f32; 4]]) {
        let actual = row(engine);
        assert!(actual.len() == expected.len() && actual.iter().zip(expected).all(|(a, b)| close(*a, *b)), "{actual:?} vs {expected:?}");
    }
    fn replace(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    #[test]
    fn added_colours_and_points_widen_the_replacement_in_one_history_step() {
        let mut engine = session(&[RED, GREEN, BLUE, GRAY]);
        let past = engine.active().unwrap().history.past_len();
        let params = json!({"color": "#ff0000", "colors": ["#00ff00"], "fuzziness": 0, "hue": 180});
        replace(&mut engine, params.clone()).unwrap();
        assert_row(&engine, &[CYAN, MAGENTA, BLUE, GRAY]);
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Replace Color")));
        assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params)));
        assert_eq!(engine.edit_state.fade.as_ref().map(|fade| (fade.layer, fade.mask)), Some((active(&engine), false)));
        assert!(engine.is_enabled("edit.fade"));
        engine.execute("edit.undo", json!({})).unwrap();
        assert_row(&engine, &[RED, GREEN, BLUE, GRAY]);
        // An eyedropper point samples the layer under it.
        replace(&mut engine, json!({"color": "#ff0000", "points": [[2.7, 0.2]], "fuzziness": 0, "hue": 180})).unwrap();
        assert_row(&engine, &[CYAN, GREEN, YELLOW, GRAY]);
    }

    #[test]
    fn subtracted_colours_and_points_drop_out_of_the_replacement() {
        let dark = [0.8, 0.0, 0.0, 1.0];
        let mut engine = session(&[RED, dark, GRAY]);
        replace(&mut engine, json!({"color": "#ff0000", "fuzziness": 200, "hue": 180})).unwrap();
        assert!(!close(row(&engine)[1], dark));
        engine.execute("edit.undo", json!({})).unwrap();
        replace(&mut engine, json!({"color": "#ff0000", "subtractColors": ["#cc0000"], "fuzziness": 200, "hue": 180})).unwrap();
        let pixels = row(&engine);
        assert!(close(pixels[1], dark) && !close(pixels[0], RED), "{pixels:?}");
        engine.execute("edit.undo", json!({})).unwrap();
        replace(&mut engine, json!({"color": "#ff0000", "subtractPoints": [[1, 0]], "fuzziness": 200, "hue": 180})).unwrap();
        let pixels = row(&engine);
        assert!(close(pixels[1], dark) && !close(pixels[0], RED), "{pixels:?}");
    }

    #[test]
    fn localized_clusters_limit_each_point_to_its_range() {
        // 100 wide, so the test bands split it and Range 20 % is 20 px.
        let mut pixels = vec![GRAY; 100];
        pixels[..10].fill(RED);
        pixels[90..].fill(RED);
        let mut engine = session(&pixels);
        replace(&mut engine, json!({"points": [[95, 0]], "localized": true, "range": 20, "fuzziness": 0, "hue": 180})).unwrap();
        let after = row(&engine);
        assert!(close(after[95], CYAN) && close(after[5], RED), "{:?} {:?}", after[95], after[5]);
        // The cluster fades out towards the edge of the range.
        assert!(after[90][1] > 0.0 && after[90][1] < 1.0, "{:?}", after[90]);
        engine.execute("edit.undo", json!({})).unwrap();
        replace(&mut engine, json!({"points": [[95, 0]], "fuzziness": 0, "hue": 180})).unwrap();
        let after = row(&engine);
        assert!(close(after[95], CYAN) && close(after[5], CYAN) && close(after[90], CYAN));
    }

    #[test]
    fn host_samples_respect_the_selection_and_match_the_engine_shift() {
        let row_in = [RED, [0.9, 0.2, 0.1, 1.0], [0.7, 0.4, 0.4, 1.0], GREEN, [0.95, 0.05, 0.0, 0.5]];
        let shift = json!({"color": "#ff0000", "fuzziness": 120, "hue": 30, "saturation": 20, "lightness": -10});
        let mut native = session(&row_in);
        native.execute(CMD, shift.clone()).unwrap();
        let mut host = session(&row_in);
        let mut params = shift.clone();
        params["colors"] = json!([]);
        replace(&mut host, params).unwrap();
        assert_row(&host, &row(&native));
        // Plain single-colour requests keep the engine route.
        let mut plain = session(&row_in);
        replace(&mut plain, shift.clone()).unwrap();
        assert_row(&plain, &row(&native));
        // A selection limits the host route as it does the engine's.
        let mut engine = session(&[RED, GREEN, RED]);
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 2, "height": 1, "antiAlias": false})).unwrap();
        replace(&mut engine, json!({"color": "#ff0000", "colors": ["#00ff00"], "fuzziness": 0, "hue": 180})).unwrap();
        assert_row(&engine, &[CYAN, MAGENTA, RED]);
    }

    #[test]
    fn bad_replace_color_options_and_targets_are_refused_without_a_history_step() {
        let mut engine = session(&[RED, GREEN, BLUE]);
        let past = engine.active().unwrap().history.past_len();
        for (params, message) in [
            (json!({"fuzziness": 201}), "fuzziness must be a number from 0 to 200"),
            (json!({"hue": -181}), "hue must be a number from -180 to 180"),
            (json!({"saturation": 101}), "saturation must be a number from -100 to 100"),
            (json!({"lightness": "dark"}), "lightness must be a number from -100 to 100"),
            (json!({"color": "red"}), "color must be"),
            (json!({"colors": "#ff0000"}), "colors must be a list of colours"),
            (json!({"subtractColors": ["nope"]}), "color must be"),
            (json!({"points": [[1]]}), "bad point [1] in points"),
            (json!({"subtractPoints": [[9, 0]]}), "point [9, 0] in subtractPoints is outside the canvas"),
            (json!({"localized": "yes"}), "localized must be true or false"),
            (json!({"localized": true, "colors": ["#ff0000"]}), "Localized Color Clusters need eyedropper points"),
            (json!({"points": [[0, 0]], "localized": true, "range": 101}), "range must be a number from 0 to 100"),
        ] {
            let error = replace(&mut engine, params.clone()).unwrap_err();
            assert!(error.contains(message), "{params}: {error}");
        }
        let id = active(&engine);
        engine.edit("Lock", |doc, _| { doc.layer_mut(id).unwrap().locks.pixels = true; Ok(()) }).unwrap();
        let error = replace(&mut engine, json!({"colors": ["#00ff00"]})).unwrap_err();
        assert!(error.contains("is locked"), "{error}");
        engine.edit("Unlock", |doc, _| { doc.layer_mut(id).unwrap().locks.pixels = false; Ok(()) }).unwrap();
        engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
        let error = replace(&mut engine, json!({"colors": ["#00ff00"], "target": "mask"})).unwrap_err();
        assert!(error.contains("need a pixel layer target"), "{error}");
        let state = engine.active().unwrap();
        assert_eq!(state.history.past_len(), past + 3);
        assert_row(&engine, &[RED, GREEN, BLUE]);
    }
}
