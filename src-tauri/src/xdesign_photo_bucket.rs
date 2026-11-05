//! Paint Bucket Mode (including Behind and Clear) and All Layers, which the pinned engine's bucket lacks.
use photocraft_algo::selection::{rgba8_image, wand_region};
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    commands::blend_from_str,
    doc::{BlendMode, ColorMode, Document, LayerId, PixelFormat, Rect, SampleType, Surface},
    edit_menu_cmds::FadeSource,
    EngineError, Session,
};
use serde_json::{json, Value};

const CMD: &str = "paint.bucket";
const TOOL: &str = "Paint Bucket";

#[derive(Clone, Copy, PartialEq, Debug)]
pub(super) enum Mode { Normal, Blend, Behind, Clear }

struct Options {
    mode: Mode,
    name: String,
    all_layers: bool,
    tolerance: f32,
    contiguous: bool,
    anti_alias: bool,
    opacity: f64,
    seed: (i32, i32),
    color: Option<[f32; 4]>,
    pattern: bool,
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD {
        return None;
    }
    let options = match parse(params) {
        Ok(options) => options,
        Err(error) => return Some(Err(error)),
    };
    if options.mode == Mode::Normal && !options.all_layers {
        return None;
    }
    Some(fill(engine, params, &options))
}

fn flag(params: &Value, key: &str, default: bool) -> Result<bool, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{TOOL}: {key} must be true or false")),
    }
}

/// A paint mode by Photoshop label: every Fill mode, Behind and Clear included.
pub(super) fn mode(tool: &str, value: Option<&Value>) -> Result<(Mode, String), String> {
    match value {
        None | Some(Value::Null) => Ok((Mode::Normal, "normal".to_owned())),
        Some(Value::String(name)) => {
            let mode = match name.to_ascii_lowercase().as_str() {
                "behind" => Some(Mode::Behind),
                "clear" => Some(Mode::Clear),
                _ => match blend_from_str(name) {
                    Some(BlendMode::Normal) => Some(Mode::Normal),
                    Some(BlendMode::PassThrough) | None => None,
                    Some(_) => Some(Mode::Blend),
                },
            };
            Ok((mode.ok_or_else(|| format!("{tool}: unknown mode \"{name}\" (Normal, Dissolve, Behind, Clear, Darken, Multiply, ... Luminosity)"))?, name.clone()))
        }
        Some(other) => Err(format!("{tool}: unknown mode {other}")),
    }
}

fn parse(params: &Value) -> Result<Options, String> {
    let (mode, name) = mode(TOOL, params.get("mode"))?;
    let tolerance = match params.get("tolerance") {
        None | Some(Value::Null) => 32.0,
        Some(value) => value.as_f64().filter(|v| v.fract() == 0.0 && (0.0..=255.0).contains(v)).ok_or_else(|| format!("{TOOL}: tolerance must be a whole number from 0 to 255"))? as f32,
    };
    let opacity = match params.get("opacity") {
        None | Some(Value::Null) => 100.0,
        Some(value) => value.as_f64().filter(|v| (1.0..=100.0).contains(v)).ok_or_else(|| format!("{TOOL}: opacity must be a number from 1 to 100"))?,
    };
    let coordinate = |key: &str| params.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()).map(|v| v.floor() as i32).ok_or_else(|| format!("{TOOL}: give the click point as numbers x and y"));
    let seed = (coordinate("x")?, coordinate("y")?);
    let pattern = match params.get("contents").or_else(|| params.get("source")) {
        None | Some(Value::Null) => false,
        Some(value) if value == "foreground" => false,
        Some(value) if value == "pattern" => true,
        Some(_) => return Err(format!("{TOOL}: contents must be \"foreground\" or \"pattern\"")),
    };
    let color = match params.get("color") {
        None | Some(Value::Null) => None,
        Some(value) => Some(super::mixer_reservoir::color(TOOL, value)?),
    };
    Ok(Options {
        mode,
        name,
        all_layers: flag(params, "sampleAllLayers", false)?,
        tolerance,
        contiguous: flag(params, "contiguous", true)?,
        anti_alias: flag(params, "antiAlias", true)?,
        opacity,
        seed,
        color,
        pattern,
    })
}

/// The flood region (from the layer or the merged image) times the selection becomes a scratch selection for
/// Edit › Fill, so every mode, Dissolve, patterns and Lock Transparent behave exactly as Fill does.
fn fill(engine: &mut Session, params: &Value, options: &Options) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{TOOL}: {reason}"));
    }
    let state = engine.active().ok_or("No image document")?;
    let routed = match params.get("target") {
        None => !super::history::effective_target(state).is_null(),
        Some(target) => target != "pixels",
    };
    if routed || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err(format!("{TOOL}: blend modes and All Layers need a pixel layer target; masks and channels fill in Normal mode"));
    }
    let layer = state.active_layer.ok_or_else(|| format!("{TOOL}: select a layer"))?;
    let target = state.doc.layer(layer).ok_or_else(|| format!("{TOOL}: the layer no longer exists"))?;
    if target.locks.pixels || target.locks.all {
        return Err(format!("{TOOL}: the layer \"{}\" is locked", target.name));
    }
    let surface = target.surface().ok_or_else(|| format!("{TOOL}: the active layer has no pixels; rasterize it first"))?;
    let area = state.doc.bounds();
    let image = if options.all_layers { merged(&state.doc, area) } else { rgba8_image(surface, area) };
    let Some(region) = wand_region(&image, area, options.seed, options.tolerance, options.contiguous, options.anti_alias) else {
        return Ok(json!({"filled": false}));
    };
    drop(image);
    let bounds = region.bbox;
    let selection = state.doc.selection.as_ref();
    let mut coverage = Vec::with_capacity(bounds.width() as usize * bounds.height() as usize);
    for y in bounds.y0..bounds.y1 {
        for x in bounds.x0..bounds.x1 {
            coverage.push(region.at(x, y) * selection.map_or(1.0, |selection| selection.sample_channel(x, y, 0)));
        }
    }
    if !coverage.iter().any(|value| *value > 0.0) {
        return Ok(json!({"filled": false}));
    }
    let mut mask = Surface::new(PixelFormat { mode: ColorMode::Grayscale, sample: SampleType::F32, alpha: false });
    mask.write_region(bounds, &coverage);
    let mut request = json!({"contents": if options.pattern { "pattern" } else { "foreground" }, "mode": options.name, "opacity": options.opacity, "preserveTransparency": false, "layer": layer.0, "target": "pixels"});
    for key in ["pattern", "scale", "angle", "phase"] {
        if let Some(value) = params.get(key) {
            request[key] = value.clone();
        }
    }
    let painted = fill_coverage(engine, layer, mask, options.mode, &request, options.color).map_err(|error| format!("{TOOL}: {error}"))?;
    engine
        .edit(TOOL, |doc, _| {
            *doc.layer_mut(layer).and_then(|layer| layer.surface_mut()).ok_or_else(|| EngineError::Other("not a pixel layer".into()))? = painted;
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((CMD.into(), params.clone()));
    let state = engine.active().ok_or("No image document")?;
    let fade = FadeSource { doc: state.doc.id, revision: state.revision, layer, mask: false, label: state.history.undo_label().unwrap_or(TOOL).to_owned() };
    engine.edit_state.fade = Some(fade);
    Ok(json!({"filled": true}))
}

/// Runs Edit › Fill `request` on `layer` in a scratch copy of the image whose selection is `coverage`, so every
/// Fill mode, opacity and lock applies as Edit › Fill applies them; returns the painted layer pixels.
pub(super) fn fill_coverage(engine: &Session, layer: LayerId, coverage: Surface, mode: Mode, request: &Value, color: Option<[f32; 4]>) -> Result<Surface, String> {
    let state = engine.active().ok_or("No image document")?;
    let mut scratch = Session::new();
    scratch.add_document(Document::new("Fill", state.doc.size, state.doc.mode, state.doc.depth), None);
    *scratch.active_mut().ok_or("No image document")? = state.clone();
    scratch.tools = engine.tools.clone();
    if let Some(color) = color {
        scratch.tools.foreground = color;
    }
    scratch.presets = engine.presets.clone();
    scratch.patterns = engine.patterns.clone();
    scratch.edit("Fill region", |doc, _| { doc.selection = Some(coverage); Ok(()) }).map_err(|error| error.to_string())?;
    match mode {
        Mode::Behind | Mode::Clear => super::fill_modes::execute(&mut scratch, "edit.fill", request).unwrap_or_else(|| Err("Behind and Clear are unavailable".into())),
        _ => scratch.execute("edit.fill", request.clone()).map_err(|error| error.to_string()),
    }?;
    scratch.active().and_then(|state| state.doc.layer(layer)).and_then(|layer| layer.surface()).cloned().ok_or_else(|| "the layer no longer exists".into())
}

fn merged(doc: &Document, area: Rect) -> Vec<[u8; 4]> {
    let byte = |value: f32| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    photocraft_compose::render(doc, area).px.iter().map(|px| [byte(px[0]), byte(px[1]), byte(px[2]), byte(px[3])]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Layer, LayerId, SampleType, Size};
    use serde_json::json;
    use std::sync::Arc;

    const GRAY: [f32; 4] = [0.5, 0.5, 0.5, 1.0];
    const BLACK: [f32; 4] = [0.0, 0.0, 0.0, 1.0];
    const CLEAR: [f32; 4] = [0.0; 4];

    /// One row per layer, bottom first; the top layer is active.
    fn session(rows: &[&[[f32; 4]]]) -> Session {
        let mut doc = Document::new("Bucket", Size::new(rows[0].len() as u32, 1), ColorMode::Rgb, SampleType::U8);
        for (index, row) in rows.iter().enumerate() {
            let mut layer = Layer::raster(&format!("Layer {index}"), doc.pixel_format());
            let data: Vec<f32> = row.iter().flatten().copied().collect();
            layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
            doc.layers.push(layer);
        }
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
        assert!(actual.iter().zip(expected).all(|(a, b)| close(*a, *b)), "{actual:?} vs {expected:?}");
    }
    fn bucket(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, "paint.bucket", params)
    }
    fn click(x: i32, extra: Value) -> Value {
        let mut params = json!({"x": x, "y": 0, "tolerance": 0, "contiguous": true, "antiAlias": false, "color": "#ff0000", "opacity": 100});
        params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        params
    }

    #[test]
    fn bucket_modes_blend_the_flood_region_in_one_history_step() {
        let mut engine = session(&[&[GRAY, GRAY, GRAY, BLACK, GRAY, GRAY]]);
        let past = engine.active().unwrap().history.past_len();
        let params = click(0, json!({"mode": "Multiply"}));
        assert_eq!(bucket(&mut engine, params.clone()).unwrap(), json!({"filled": true}));
        let red = [0.5, 0.0, 0.0, 1.0];
        assert_row(&engine, &[red, red, red, BLACK, GRAY, GRAY]);
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Paint Bucket")));
        assert_eq!(engine.journal.last(), Some(&("paint.bucket".to_owned(), params)));
        assert_eq!(engine.edit_state.fade.as_ref().map(|fade| (fade.layer, fade.mask)), Some((active(&engine), false)));
        assert!(engine.is_enabled("edit.fade"));
        engine.execute("edit.undo", json!({})).unwrap();
        assert_row(&engine, &[GRAY, GRAY, GRAY, BLACK, GRAY, GRAY]);
        // Dissolve paints whole pixels only.
        let mut engine = session(&[&[GRAY; 64]]);
        bucket(&mut engine, click(0, json!({"mode": "Dissolve", "opacity": 50}))).unwrap();
        let pixels = row(&engine);
        assert!(pixels.iter().all(|px| close(*px, GRAY) || close(*px, [1.0, 0.0, 0.0, 1.0])), "{pixels:?}");
        assert!(pixels.iter().any(|px| close(*px, GRAY)) && pixels.iter().any(|px| !close(*px, GRAY)));
    }

    #[test]
    fn behind_fills_only_transparency_and_clear_erases_the_region() {
        let blue = [0.0, 0.0, 1.0, 1.0];
        let mut engine = session(&[&[CLEAR, CLEAR, blue, CLEAR]]);
        bucket(&mut engine, click(0, json!({"mode": "Behind", "tolerance": 255, "contiguous": false}))).unwrap();
        let red = [1.0, 0.0, 0.0, 1.0];
        assert_row(&engine, &[red, red, blue, red]);
        let mut engine = session(&[&[CLEAR, CLEAR, blue, blue]]);
        bucket(&mut engine, click(2, json!({"mode": "Clear", "opacity": 50}))).unwrap();
        let half = [0.0, 0.0, 1.0, 128.0 / 255.0];
        assert_row(&engine, &[CLEAR, CLEAR, half, half]);
        assert_eq!(engine.active().unwrap().history.undo_label(), Some("Paint Bucket"));
    }

    #[test]
    fn all_layers_bounds_the_flood_by_the_merged_image() {
        let white = [1.0; 4];
        let red = [1.0, 0.0, 0.0, 1.0];
        let mut engine = session(&[&[white, white, white, BLACK, white, white], &[CLEAR; 6]]);
        bucket(&mut engine, click(0, json!({"sampleAllLayers": true}))).unwrap();
        assert_row(&engine, &[red, red, red, CLEAR, CLEAR, CLEAR]);
        // Without All Layers the empty active layer floods everywhere (the native route).
        let mut engine = session(&[&[white, white, white, BLACK, white, white], &[CLEAR; 6]]);
        assert!(execute(&mut engine, "paint.bucket", &click(0, json!({"sampleAllLayers": false, "mode": "normal"}))).is_none());
        bucket(&mut engine, click(0, json!({}))).unwrap();
        assert_row(&engine, &[red; 6]);
    }

    #[test]
    fn pattern_contents_fill_the_host_region_with_the_pattern() {
        let white = [1.0; 4];
        let mut engine = session(&[&[[white; 10].as_slice(), &[BLACK], &[white; 9]].concat(), &[CLEAR; 20]]);
        let params = click(2, json!({"sampleAllLayers": true, "contents": "pattern", "pattern": "Diagonal Lines"}));
        bucket(&mut engine, params).unwrap();
        let pixels = row(&engine);
        assert!(pixels[..10].iter().all(|px| px[3] > 0.0), "{pixels:?}");
        assert!(pixels[..10].iter().any(|px| px[0] < 0.3) && pixels[..10].iter().any(|px| px[0] > 0.9), "{pixels:?}");
        assert!(pixels[10..].iter().all(|px| *px == CLEAR), "{pixels:?}");
    }

    #[test]
    fn the_bucket_region_is_limited_by_the_selection_which_survives() {
        let mut engine = session(&[&[GRAY; 4]]);
        engine.execute("select.rect", json!({"x": 1, "y": 0, "width": 2, "height": 1})).unwrap();
        let selection = engine.active().unwrap().doc.selection.clone();
        bucket(&mut engine, click(0, json!({"mode": "Multiply"}))).unwrap();
        let red = [0.5, 0.0, 0.0, 1.0];
        assert_row(&engine, &[GRAY, red, red, GRAY]);
        assert_eq!(engine.active().unwrap().doc.selection, selection);
        // A region wholly outside the selection paints nothing and adds no step.
        let mut engine = session(&[&[GRAY, BLACK, GRAY]]);
        engine.execute("select.rect", json!({"x": 2, "y": 0, "width": 1, "height": 1})).unwrap();
        let past = engine.active().unwrap().history.past_len();
        assert_eq!(bucket(&mut engine, click(0, json!({"mode": "Multiply"}))).unwrap(), json!({"filled": false}));
        assert_eq!(engine.active().unwrap().history.past_len(), past);
    }

    #[test]
    fn bad_bucket_options_are_refused_before_painting() {
        let mut engine = session(&[&[GRAY; 3]]);
        engine.execute("layer.mask.add", json!({"reveal": true})).ok();
        for (extra, message) in [
            (json!({"mode": "Sparkle"}), "unknown mode"),
            (json!({"mode": "Pass Through"}), "unknown mode"),
            (json!({"mode": 3}), "unknown mode"),
            (json!({"sampleAllLayers": "yes"}), "sampleAllLayers must be true or false"),
            (json!({"contiguous": 1}), "contiguous must be true or false"),
            (json!({"antiAlias": "no"}), "antiAlias must be true or false"),
            (json!({"tolerance": 256}), "tolerance must be a whole number from 0 to 255"),
            (json!({"tolerance": 1.5}), "tolerance must be a whole number from 0 to 255"),
            (json!({"opacity": 0}), "opacity must be a number from 1 to 100"),
            (json!({"opacity": 101}), "opacity must be a number from 1 to 100"),
            (json!({"x": "left"}), "give the click point as numbers x and y"),
            (json!({"color": "red"}), "color must be"),
            (json!({"contents": "gradient"}), "contents must be \"foreground\" or \"pattern\""),
            (json!({"mode": "Multiply", "target": "mask"}), "need a pixel layer"),
            (json!({"sampleAllLayers": true, "target": {"channel": 0}}), "need a pixel layer"),
        ] {
            let before = engine.active().unwrap().doc.clone();
            let error = bucket(&mut engine, click(0, extra.clone())).unwrap_err();
            assert!(error.contains(message), "{extra}: {error}");
            assert!(error.starts_with("Paint Bucket"), "{extra}: {error}");
            assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc), "{extra}");
        }
        let layer = active(&engine);
        engine.edit("Lock", |doc, _| { doc.layer_mut(layer).unwrap().locks.pixels = true; Ok(()) }).unwrap();
        let before = engine.active().unwrap().doc.clone();
        assert!(bucket(&mut engine, click(0, json!({"mode": "Multiply", "target": "pixels"}))).unwrap_err().contains("is locked"));
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
    }
}
