//! HDR Toning's Equalize Histogram, Highlight Compression and Exposure and Gamma methods. The pinned engine's
//! command only runs Local Adaptation, but its HDR tone mapper has all four.
use photocraft_algo::hdr::{tone_map, ToneMethod};
use photocraft_engine::{doc::Layer, edit_menu_cmds::FadeSource, EngineError, Session};
use photocraft_raster::from_rgba_into;
use serde_json::Value;

const CMD: &str = "image.adjustments.hdrToning";
const NAME: &str = "HDR Toning";
const RANGES: [(&str, f64, f64); 9] = [
    ("radius", 1.0, 500.0),
    ("strength", 0.1, 4.0),
    ("gamma", 0.1, 2.0),
    ("exposure", -5.0, 5.0),
    ("detail", -100.0, 300.0),
    ("shadow", -100.0, 100.0),
    ("highlight", -100.0, 100.0),
    ("vibrance", -100.0, 100.0),
    ("saturation", -100.0, 100.0),
];
const MAX_CURVE_POINTS: usize = 256;

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD {
        return None;
    }
    match parse(params) {
        Err(error) => Some(Err(error)),
        Ok(None) => None,
        Ok(Some(method)) => Some(apply(engine, params, &method)),
    }
}

fn given<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params.get(key).filter(|value| !value.is_null())
}

fn number(params: &Value, key: &str, default: f32) -> Result<f32, String> {
    let (_, low, high) = RANGES.iter().find(|(name, ..)| *name == key).copied().ok_or_else(|| format!("{NAME}: unknown setting {key}"))?;
    match given(params, key) {
        None => Ok(default),
        Some(value) => value
            .as_f64()
            .filter(|value| (low..=high).contains(value))
            .map(|value| value as f32)
            .ok_or_else(|| format!("{NAME}: {key} must be a number from {low} to {high}")),
    }
}

fn check_curve(params: &Value) -> Result<(), String> {
    let Some(curve) = given(params, "curve") else { return Ok(()) };
    let bad = || format!("{NAME}: curve must be a list of up to {MAX_CURVE_POINTS} [input, output] points from 0 to 255 with rising inputs");
    let points = curve.as_array().filter(|points| points.len() <= MAX_CURVE_POINTS).ok_or_else(bad)?;
    let mut last = f64::NEG_INFINITY;
    for point in points {
        let level = |i: usize| point.as_array().filter(|pair| pair.len() == 2).and_then(|pair| pair[i].as_f64()).filter(|v| (0.0..=255.0).contains(v));
        match (level(0), level(1)) {
            (Some(input), Some(_)) if input > last => last = input,
            _ => return Err(bad()),
        }
    }
    Ok(())
}

/// The host's tone method, or None for Local Adaptation, which stays the engine's command. Every setting is
/// checked on both routes so the engine's silent clamps never apply.
fn parse(params: &Value) -> Result<Option<ToneMethod>, String> {
    for (key, ..) in RANGES {
        number(params, key, 0.0)?;
    }
    check_curve(params)?;
    match given(params, "method").map(|method| method.as_str()) {
        None | Some(Some("localAdaptation")) => Ok(None),
        Some(Some("equalizeHistogram")) => Ok(Some(ToneMethod::EqualizeHistogram)),
        Some(Some("highlightCompression")) => Ok(Some(ToneMethod::HighlightCompression)),
        Some(Some("exposureGamma")) => Ok(Some(ToneMethod::ExposureGamma { exposure: number(params, "exposure", 0.0)?, gamma: number(params, "gamma", 1.0)? })),
        Some(_) => Err(format!("{NAME}: method must be localAdaptation, equalizeHistogram, exposureGamma or highlightCompression")),
    }
}

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

/// Mirrors the engine's Local Adaptation edit: flatten over white, tone, and leave one locked Background.
fn apply(engine: &mut Session, params: &Value, method: &ToneMethod) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{NAME}: {reason}"));
    }
    let id = super::mask_filters::edit_history(engine, NAME, params, |doc, active| {
        let flat = photocraft_compose::flatten(doc).over_background([1.0; 3]);
        let (width, height) = (flat.rect.width() as usize, flat.rect.height() as usize);
        let mut pixels = flat.px;
        // The tone mapper takes linear radiance, as Photoshop's 32-bit pass does.
        for pixel in pixels.iter_mut() {
            for channel in &mut pixel[..3] {
                *channel = srgb_to_linear(*channel);
            }
        }
        tone_map(&mut pixels, width, height, method);
        let format = doc.pixel_format();
        let channels = format.channels();
        let mut data = vec![0.0; pixels.len() * channels];
        for (pixel, encoded) in pixels.iter().zip(data.chunks_exact_mut(channels)) {
            from_rgba_into(&format, *pixel, encoded);
        }
        let mut background = Layer::raster("Background", format);
        let id = background.id;
        background.locks.transparency = true;
        background.surface_mut().ok_or(EngineError::NoLayer(id))?.write_region(doc.bounds(), &data);
        *active = Some(id);
        doc.layers = vec![background];
        doc.selection = None;
        Ok(id)
    })?;
    engine.journal.push((CMD.to_owned(), params.clone()));
    let state = engine.active().ok_or("No image document")?;
    let label = state.history.undo_label().unwrap_or(NAME).to_owned();
    engine.edit_state.fade = Some(FadeSource { doc: state.doc.id, revision: state.revision, layer: id, mask: false, label });
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Size};
    use serde_json::json;

    const WIDTH: u32 = 8;

    /// A grey ramp under a half-transparent red layer that covers the right half, with a selection.
    fn session() -> Session {
        let mut doc = Document::new("HDR", Size::new(WIDTH, 2), ColorMode::Rgb, photocraft_engine::doc::SampleType::U8);
        let mut ramp = Layer::raster("Ramp", doc.pixel_format());
        let data: Vec<f32> = (0..2 * WIDTH).flat_map(|i| { let v = 0.05 + 0.12 * (i % WIDTH) as f32; [v, v * 0.9, v * 0.7, 1.0] }).collect();
        ramp.surface_mut().unwrap().write_region(doc.bounds(), &data);
        let mut red = Layer::raster("Red", doc.pixel_format());
        let half = photocraft_engine::doc::Rect::new(WIDTH as i32 / 2, 0, WIDTH as i32, 2);
        red.surface_mut().unwrap().write_region(half, &[0.9, 0.1, 0.1, 0.5].repeat(WIDTH as usize));
        doc.layers.push(ramp);
        doc.layers.push(red);
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.set_active(0);
        let top = engine.active().unwrap().doc.layers.last().unwrap().id;
        engine.active_mut().unwrap().active_layer = Some(top);
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 2, "height": 1, "antiAlias": false})).unwrap();
        engine
    }
    fn pixels(engine: &Session) -> Vec<[f32; 4]> {
        let state = engine.active().unwrap();
        let surface = state.doc.layers[0].surface().unwrap();
        (0..2).flat_map(|y| (0..WIDTH as i32).map(move |x| (x, y))).map(|(x, y)| surface.rgba(x, y)).collect()
    }
    /// The tone mapper fed the flattened image in linear light, as Photoshop's 32-bit pass would.
    fn reference(engine: &Session, method: &ToneMethod) -> Vec<[f32; 4]> {
        let mut px = photocraft_compose::flatten(&engine.active().unwrap().doc).over_background([1.0; 3]).px;
        for q in px.iter_mut() {
            for c in &mut q[..3] {
                *c = srgb_to_linear(*c);
            }
        }
        tone_map(&mut px, WIDTH as usize, 2, method);
        px
    }
    fn assert_close(actual: &[[f32; 4]], expected: &[[f32; 4]]) {
        let close = actual.iter().zip(expected).all(|(a, b)| a.iter().zip(b).all(|(a, b)| (a - b).abs() <= 1.5 / 255.0));
        assert!(actual.len() == expected.len() && close, "{actual:?} vs {expected:?}");
    }
    fn toned(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    #[test]
    fn each_new_method_flattens_to_one_tone_mapped_background_in_one_step() {
        for (params, method) in [
            (json!({"method": "equalizeHistogram"}), ToneMethod::EqualizeHistogram),
            (json!({"method": "highlightCompression", "radius": 120}), ToneMethod::HighlightCompression),
            (json!({"method": "exposureGamma"}), ToneMethod::ExposureGamma { exposure: 0.0, gamma: 1.0 }),
            (json!({"method": "exposureGamma", "exposure": 1.5, "gamma": 0.6}), ToneMethod::ExposureGamma { exposure: 1.5, gamma: 0.6 }),
        ] {
            let mut engine = session();
            let before = pixels(&engine);
            let expected = reference(&engine, &method);
            let past = engine.active().unwrap().history.past_len();
            toned(&mut engine, params.clone()).unwrap();
            let state = engine.active().unwrap();
            assert_eq!(state.doc.layers.len(), 1, "{params}");
            let background = &state.doc.layers[0];
            assert!(background.name == "Background" && background.locks.transparency, "{params}");
            assert_eq!(state.active_layer, Some(background.id));
            assert!(state.doc.selection.is_none());
            assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("HDR Toning")));
            assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params.clone())));
            assert_eq!(engine.edit_state.fade.as_ref().map(|fade| (fade.layer, fade.mask)), Some((background.id, false)));
            assert_close(&pixels(&engine), &expected);
            engine.execute("edit.undo", json!({})).unwrap();
            let state = engine.active().unwrap();
            assert!(state.doc.layers.len() == 2 && state.doc.selection.is_some(), "{params}");
            assert_close(&pixels(&engine), &before);
        }
    }

    #[test]
    fn the_methods_tone_differently_and_exposure_brightens() {
        let mut results = Vec::new();
        for params in [
            json!({}),
            json!({"method": "equalizeHistogram"}),
            json!({"method": "highlightCompression"}),
            json!({"method": "exposureGamma"}),
            json!({"method": "exposureGamma", "exposure": 1}),
        ] {
            let mut engine = session();
            toned(&mut engine, params).unwrap();
            results.push(pixels(&engine));
        }
        for i in 0..results.len() {
            for j in i + 1..results.len() {
                assert!(results[i].iter().zip(&results[j]).any(|(a, b)| (a[0] - b[0]).abs() > 2.0 / 255.0), "{i} vs {j}");
            }
        }
        assert!(results[4].iter().zip(&results[3]).all(|(bright, plain)| bright[1] >= plain[1]));
    }

    #[test]
    fn local_adaptation_stays_the_engines_command() {
        let params = json!({"radius": 40, "strength": 1.2, "detail": 80, "curve": [[0, 0], [128, 150], [255, 255]]});
        let mut native = session();
        native.execute(CMD, params.clone()).unwrap();
        for method in [None, Some("localAdaptation")] {
            let mut engine = session();
            let mut params = params.clone();
            if let Some(method) = method {
                params["method"] = json!(method);
            }
            toned(&mut engine, params).unwrap();
            assert_close(&pixels(&engine), &pixels(&native));
            assert_eq!(engine.active().unwrap().history.undo_label(), Some("HDR Toning"));
        }
    }

    #[test]
    fn bad_hdr_toning_options_are_refused_without_a_history_step() {
        let mut engine = session();
        let past = engine.active().unwrap().history.past_len();
        let before = pixels(&engine);
        for (params, message) in [
            (json!({"method": "reinhard"}), "method must be localAdaptation, equalizeHistogram, exposureGamma or highlightCompression"),
            (json!({"method": 2}), "method must be localAdaptation"),
            (json!({"radius": 0}), "radius must be a number from 1 to 500"),
            (json!({"method": "equalizeHistogram", "radius": 501}), "radius must be a number from 1 to 500"),
            (json!({"strength": 4.5}), "strength must be a number from 0.1 to 4"),
            (json!({"method": "exposureGamma", "gamma": 0.05}), "gamma must be a number from 0.1 to 2"),
            (json!({"method": "exposureGamma", "exposure": -6}), "exposure must be a number from -5 to 5"),
            (json!({"detail": 301}), "detail must be a number from -100 to 300"),
            (json!({"shadow": "dark"}), "shadow must be a number from -100 to 100"),
            (json!({"highlight": 101}), "highlight must be a number from -100 to 100"),
            (json!({"vibrance": -101}), "vibrance must be a number from -100 to 100"),
            (json!({"saturation": 120}), "saturation must be a number from -100 to 100"),
            (json!({"curve": "s"}), "curve must be a list of up to 256 [input, output] points"),
            (json!({"curve": [[0, 0], [300, 10]]}), "curve must be a list of up to 256 [input, output] points"),
            (json!({"curve": [[10, 0], [5, 10]]}), "rising inputs"),
            (json!({"curve": [[0]]}), "curve must be a list"),
            (json!({"curve": vec![[0, 0]; 257]}), "up to 256"),
        ] {
            let error = toned(&mut engine, params.clone()).unwrap_err();
            assert!(error.contains(message), "{params}: {error}");
        }
        assert_eq!(engine.active().unwrap().history.past_len(), past);
        assert_close(&pixels(&engine), &before);
    }
    #[test]
    fn every_method_previews_the_committed_pixels_and_huge_images_are_refused() {
        for params in [
            json!({"radius": 40, "strength": 1.2, "detail": 80}),
            json!({"method": "equalizeHistogram"}),
            json!({"method": "highlightCompression"}),
            json!({"method": "exposureGamma", "exposure": 1.5, "gamma": 0.6}),
        ] {
            let mut engine = session();
            let state = engine.active().unwrap();
            let (source, past) = (state.doc.clone(), state.history.past_len());
            let preview = super::super::preview::render(state, CMD, params.clone()).unwrap_or_else(|error| panic!("{params}: {error}"));
            assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.past_len(), past);
            toned(&mut engine, params.clone()).unwrap();
            let state = engine.active().unwrap();
            let committed = super::super::render_view_preview(&state.doc, &state.channel_view).unwrap();
            assert_eq!(preview.png, committed.png, "{params}");
        }
        let mut state = session().active().unwrap().clone();
        std::sync::Arc::make_mut(&mut state.doc).size = Size::new(6000, 4000);
        for method in ["localAdaptation", "equalizeHistogram"] {
            let error = super::super::preview::render(&state, CMD, json!({"method": method})).err().unwrap();
            assert!(error.contains("image size"), "{method}: {error}");
        }
    }
}
