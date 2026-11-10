//! The Mixer Brush's Current Brush Load: paint carried between strokes for each image, with
//! Photoshop's Load Brush and Clean Brush commands and its after-stroke options.
use photocraft_engine::{doc::{LayerContent, Rect}, paint::mixer::MixerState, Session};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Mutex, OnceLock}};

const TOOL: &str = "Mixer Brush";

fn store() -> &'static Mutex<HashMap<String, MixerState>> {
    static STORE: OnceLock<Mutex<HashMap<String, MixerState>>> = OnceLock::new();
    STORE.get_or_init(Default::default)
}

fn flag(params: &Value, key: &str, default: bool) -> Result<bool, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{TOOL}: {key} must be true or false")),
    }
}

/// The after-stroke options a Mixer Brush commit applies once it lands.
pub(super) struct After(Option<(bool, bool)>);

/// Installs `document`'s reservoir as the session's Mixer Brush paint before a command runs (the
/// profile tool state is shared by every open image). Options are validated first.
pub(super) fn begin(document: &str, engine: &mut Session, command: &str, params: &Value) -> Result<After, String> {
    let after = if command == "paint.mixerBrush" { Some((flag(params, "cleanAfterStroke", true)?, flag(params, "loadAfterStroke", true)?)) } else { None };
    install(document, engine)?;
    Ok(After(after))
}

/// Keeps the paint a successful command leaves for `document`.
pub(super) fn end(document: &str, engine: &mut Session, after: After) -> Result<(), String> {
    if let After(Some((clean, load))) = after {
        let mixer = &mut engine.tools.mixer;
        // Photoshop's clean empties the brush; the engine only drops the picked-up colour.
        if clean {
            mixer.pickup = None;
            mixer.amount = 0.0;
        }
        if let Some(color) = mixer.reservoir.filter(|_| load) {
            mixer.load(color);
        }
    }
    store().lock().map_err(|_| format!("{TOOL} needs to be restarted"))?.insert(document.to_string(), engine.tools.mixer.clone());
    Ok(())
}

pub(super) fn install(document: &str, engine: &mut Session) -> Result<(), String> {
    engine.tools.mixer = store().lock().map_err(|_| format!("{TOOL} needs to be restarted"))?.get(document).cloned().unwrap_or_default();
    Ok(())
}

pub(super) fn color(tool: &str, value: &Value) -> Result<[f32; 4], String> {
    let invalid = || format!("{tool}: color must be \"#rrggbb\" or [r, g, b] from 0 to 1");
    match value {
        Value::String(text) => {
            let hex = text.strip_prefix('#').unwrap_or(text);
            let byte = |at: usize| hex.get(at..at + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok()).map(|byte| f32::from(byte) / 255.0);
            match (hex.len(), byte(0), byte(2), byte(4)) {
                (6 | 8, Some(r), Some(g), Some(b)) => Ok([r, g, b, if hex.len() == 8 { byte(6).ok_or_else(invalid)? } else { 1.0 }]),
                _ => Err(invalid()),
            }
        }
        Value::Array(items) if (3..=4).contains(&items.len()) => {
            let mut out = [1.0; 4];
            for (slot, item) in out.iter_mut().zip(items) {
                *slot = item.as_f64().filter(|value| (0.0..=1.0).contains(value)).ok_or_else(invalid)? as f32;
            }
            Ok(out)
        }
        _ => Err(invalid()),
    }
}

/// Alt-click loading: the average paint under the tip. Only solid loads exist, so this is
/// Photoshop's Load Solid Colors Only result.
fn canvas_color(engine: &Session, params: &Value) -> Result<[f32; 4], String> {
    let coordinate = |key: &str| params.get(key).and_then(Value::as_f64).filter(|value| value.is_finite());
    let (Some(x), Some(y)) = (coordinate("x"), coordinate("y")) else { return Err(format!("{TOOL}: give the canvas point as numbers x and y")) };
    let size = match params.get("size") {
        None | Some(Value::Null) => f64::from(engine.tools.brush.size),
        Some(value) => value.as_f64().filter(|size| (1.0..=5000.0).contains(size)).ok_or_else(|| format!("{TOOL}: size must be a number from 1 to 5000"))?,
    };
    let all = flag(params, "sampleAllLayers", false)?;
    let state = engine.active().ok_or_else(|| format!("{TOOL}: open an image first"))?;
    let doc = &state.doc;
    let radius = size / 2.0;
    let canvas = Rect::from_xywh(0, 0, doc.size.width, doc.size.height);
    let tip = Rect::new((x - radius).floor() as i32, (y - radius).floor() as i32, (x + radius).ceil() as i32, (y + radius).ceil() as i32).intersect(&canvas);
    let composite = all.then(|| photocraft_compose::render(doc, tip));
    let surface = match (&composite, state.active_layer.and_then(|id| doc.layer(id)).map(|layer| &layer.content)) {
        (Some(_), _) => None,
        (None, Some(LayerContent::Raster(surface))) => Some(surface),
        (None, _) => return Err(format!("{TOOL}: the active layer has no pixels to load from; turn on sampleAllLayers")),
    };
    let (mut sum, mut weight) = ([0.0f64; 3], 0.0f64);
    for py in tip.y0..tip.y1 {
        for px in tip.x0..tip.x1 {
            if (f64::from(px) + 0.5 - x).powi(2) + (f64::from(py) + 0.5 - y).powi(2) > radius * radius {
                continue;
            }
            let rgba = match (&composite, surface) {
                (Some(buffer), _) => buffer.px[((py - tip.y0) * tip.width() as i32 + px - tip.x0) as usize],
                (None, Some(surface)) => surface.rgba(px, py),
                (None, None) => unreachable!(),
            };
            let alpha = f64::from(rgba[3]);
            for (total, value) in sum.iter_mut().zip(rgba) {
                *total += f64::from(value) * alpha;
            }
            weight += alpha;
        }
    }
    if weight < 1e-6 {
        return Err(format!("{TOOL}: there is no paint to load here"));
    }
    Ok([(sum[0] / weight) as f32, (sum[1] / weight) as f32, (sum[2] / weight) as f32, 1.0])
}

fn reply(mixer: &MixerState) -> Value {
    json!({"color": mixer.reservoir, "amount": mixer.amount, "loaded": mixer.reservoir.is_some() && mixer.amount > 0.0, "pickup": mixer.pickup})
}

/// Load Brush and Clean Brush change only the carried paint: no pixels, history or journal.
pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    match command {
        "paint.mixerBrush.load" => Some((|| {
            let canvas = params.get("x").is_some() || params.get("y").is_some();
            let paint = match (params.get("color").filter(|value| !value.is_null()), canvas) {
                (Some(_), true) => return Err(format!("{TOOL}: load either a color or a canvas point x, y")),
                (Some(value), false) => color(TOOL, value)?,
                (None, true) => canvas_color(engine, params)?,
                (None, false) => engine.tools.foreground,
            };
            let mixer = &mut engine.tools.mixer;
            mixer.load(paint);
            mixer.pickup = None;
            Ok(reply(mixer))
        })()),
        "paint.mixerBrush.clean" => {
            let foreground = engine.tools.foreground;
            let mixer = &mut engine.tools.mixer;
            // Keeping a (drained) reservoir colour stops the next stroke from reloading itself.
            mixer.reservoir = Some(mixer.reservoir.unwrap_or(foreground));
            mixer.amount = 0.0;
            mixer.pickup = None;
            Some(Ok(reply(mixer)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn image(background: &str) -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 64, "height": 32, "background": background})).unwrap();
        engine
    }
    fn exec(document: &str, engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
        let after = begin(document, engine, command, &params)?;
        let value = super::super::execute_view_command(engine, command, params)?;
        end(document, engine, after).map(|()| value)
    }
    fn stroke(load: bool, clean: bool) -> Value {
        json!({"points": [[4, 16], [60, 16]], "size": 6, "hardness": 1.0, "wet": 0, "load": 50, "mix": 0, "loadAfterStroke": load, "cleanAfterStroke": clean, "seed": 1})
    }
    fn pixel(engine: &Session, x: i32, y: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        let layer = state.doc.layer(state.active_layer.unwrap()).unwrap();
        let photocraft_engine::doc::LayerContent::Raster(surface) = &layer.content else { unreachable!() };
        surface.rgba(x, y)
    }
    fn close(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() < 0.02)
    }

    #[test]
    fn mixer_reservoirs_are_kept_per_document() {
        let (mut a, mut b) = (image("#ffffff"), image("#ffffff"));
        exec("mixer-test/a", &mut a, "paint.mixerBrush.load", json!({"color": "#ff0000"})).unwrap();
        exec("mixer-test/b", &mut b, "paint.mixerBrush.load", json!({"color": "#0000ff"})).unwrap();
        // The profile tool state is shared; each command starts from whatever the last one left.
        a.tools.mixer = b.tools.mixer.clone();
        install("mixer-test/a", &mut a).unwrap();
        assert_eq!(a.tools.mixer.reservoir, Some([1.0, 0.0, 0.0, 1.0]));
        install("mixer-test/b", &mut b).unwrap();
        assert_eq!(b.tools.mixer.reservoir, Some([0.0, 0.0, 1.0, 1.0]));
        let mut fresh = image("#ffffff");
        fresh.tools.mixer.load([0.0, 1.0, 0.0, 1.0]);
        install("mixer-test/never-used", &mut fresh).unwrap();
        assert_eq!(fresh.tools.mixer, MixerState::default());
    }

    #[test]
    fn load_brush_fills_with_a_colour_or_the_solid_canvas_average() {
        let mut engine = image("#ffffff");
        engine.tools.mixer.pickup = Some([0.5, 0.5, 0.5, 1.0]);
        let result = exec("mixer-test/load", &mut engine, "paint.mixerBrush.load", json!({"color": "#ff8000"})).unwrap();
        assert_eq!(engine.tools.mixer, MixerState { reservoir: Some([1.0, 128.0 / 255.0, 0.0, 1.0]), amount: 1.0, pickup: None });
        assert_eq!(result["amount"], json!(1.0));
        engine.tools.foreground = [0.0, 0.0, 1.0, 1.0];
        exec("mixer-test/load", &mut engine, "paint.mixerBrush.load", json!({})).unwrap();
        assert_eq!(engine.tools.mixer.reservoir, Some([0.0, 0.0, 1.0, 1.0]));
        engine.execute("select.rect", json!({"x": 32, "y": 0, "width": 32, "height": 32})).unwrap();
        engine.execute("edit.fill", json!({"color": "#ff0000"})).unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        exec("mixer-test/load", &mut engine, "paint.mixerBrush.load", json!({"x": 32, "y": 16, "size": 10})).unwrap();
        let loaded = engine.tools.mixer.reservoir.unwrap();
        assert!(close(loaded, [1.0, 0.5, 0.5, 1.0]), "{loaded:?}");
        exec("mixer-test/load", &mut engine, "paint.mixerBrush.load", json!({"x": 50, "y": 16, "size": 10})).unwrap();
        assert!(close(engine.tools.mixer.reservoir.unwrap(), [1.0, 0.0, 0.0, 1.0]));
        engine.execute("layer.new.layer", json!({"name": "Empty"})).unwrap();
        let error = exec("mixer-test/load", &mut engine, "paint.mixerBrush.load", json!({"x": 50, "y": 16, "size": 10})).unwrap_err();
        assert!(error.contains("no paint to load"), "{error}");
        exec("mixer-test/load", &mut engine, "paint.mixerBrush.load", json!({"x": 50, "y": 16, "size": 10, "sampleAllLayers": true})).unwrap();
        assert!(close(engine.tools.mixer.reservoir.unwrap(), [1.0, 0.0, 0.0, 1.0]));
    }

    #[test]
    fn clean_brush_empties_it_so_an_unloaded_stroke_paints_nothing() {
        let mut engine = image("#ffffff");
        engine.tools.foreground = [1.0, 0.0, 0.0, 1.0];
        exec("mixer-test/clean", &mut engine, "paint.mixerBrush.clean", json!({})).unwrap();
        assert_eq!(engine.tools.mixer.amount, 0.0);
        assert_eq!(engine.tools.mixer.pickup, None);
        exec("mixer-test/clean", &mut engine, "paint.mixerBrush", stroke(false, true)).unwrap();
        assert!(close(pixel(&engine, 30, 16), [1.0, 1.0, 1.0, 1.0]), "{:?}", pixel(&engine, 30, 16));
        exec("mixer-test/clean", &mut engine, "paint.mixerBrush.load", json!({})).unwrap();
        exec("mixer-test/clean", &mut engine, "paint.mixerBrush", stroke(false, true)).unwrap();
        assert!(close(pixel(&engine, 6, 16), [1.0, 0.0, 0.0, 1.0]), "{:?}", pixel(&engine, 6, 16));
    }

    #[test]
    fn after_stroke_options_clean_then_load_like_photoshop() {
        let mut engine = image("#808080");
        engine.tools.foreground = [1.0, 0.0, 0.0, 1.0];
        let wet = |load: bool, clean: bool| {
            let mut params = stroke(load, clean);
            params["wet"] = json!(60);
            params["mix"] = json!(50);
            params
        };
        exec("mixer-test/after", &mut engine, "paint.mixerBrush", wet(false, false)).unwrap();
        let carried = engine.tools.mixer.clone();
        assert!(carried.amount < 1.0 && carried.pickup.is_some(), "{carried:?}");
        exec("mixer-test/after", &mut engine, "paint.mixerBrush", wet(false, true)).unwrap();
        assert_eq!((engine.tools.mixer.amount, engine.tools.mixer.pickup), (0.0, None));
        exec("mixer-test/after", &mut engine, "paint.mixerBrush", wet(true, true)).unwrap();
        assert_eq!(engine.tools.mixer, MixerState { reservoir: Some([1.0, 0.0, 0.0, 1.0]), amount: 1.0, pickup: None });
        exec("mixer-test/after", &mut engine, "paint.mixerBrush", wet(true, false)).unwrap();
        assert_eq!(engine.tools.mixer.amount, 1.0);
        assert!(engine.tools.mixer.pickup.is_some());
    }

    #[test]
    fn load_and_clean_leave_pixels_history_and_journal_untouched() {
        let mut engine = image("#ffffff");
        let before = engine.active().unwrap().clone();
        let journal = engine.journal.clone();
        for (command, params) in [("paint.mixerBrush.load", json!({"color": "#123456"})), ("paint.mixerBrush.load", json!({"x": 4, "y": 4})), ("paint.mixerBrush.clean", json!({}))] {
            exec("mixer-test/untouched", &mut engine, command, params).unwrap();
            let after = engine.active().unwrap();
            assert!(std::sync::Arc::ptr_eq(&before.doc, &after.doc));
            assert_eq!(before.history.entries().len(), after.history.entries().len());
            assert_eq!(before.revision, after.revision);
            assert_eq!(journal, engine.journal);
        }
    }

    #[test]
    fn mixer_options_reject_bad_values_without_changing_the_brush() {
        let mut engine = image("#ffffff");
        exec("mixer-test/bad", &mut engine, "paint.mixerBrush.load", json!({"color": "#00ff00"})).unwrap();
        let kept = engine.tools.mixer.clone();
        for (command, params, needle) in [
            ("paint.mixerBrush.load", json!({"color": "green"}), "color must be"),
            ("paint.mixerBrush.load", json!({"color": [1, 0]}), "color must be"),
            ("paint.mixerBrush.load", json!({"color": [2, 0, 0]}), "color must be"),
            ("paint.mixerBrush.load", json!({"x": 4}), "x and y"),
            ("paint.mixerBrush.load", json!({"x": 4, "y": "1"}), "x and y"),
            ("paint.mixerBrush.load", json!({"x": 4, "y": 4, "color": "#000000"}), "either"),
            ("paint.mixerBrush.load", json!({"x": 4, "y": 4, "size": 0}), "size must be"),
            ("paint.mixerBrush.load", json!({"x": 4, "y": 4, "size": 5001}), "size must be"),
            ("paint.mixerBrush.load", json!({"x": 4, "y": 4, "sampleAllLayers": 1}), "sampleAllLayers must be"),
            ("paint.mixerBrush.load", json!({"x": 400, "y": 4}), "no paint to load"),
            ("paint.mixerBrush", json!({"points": [[4, 4], [9, 9]], "cleanAfterStroke": "yes"}), "cleanAfterStroke must be"),
            ("paint.mixerBrush", json!({"points": [[4, 4], [9, 9]], "loadAfterStroke": 0}), "loadAfterStroke must be"),
        ] {
            let before = engine.active().unwrap().doc.clone();
            let error = exec("mixer-test/bad", &mut engine, command, params.clone()).unwrap_err();
            assert!(error.starts_with("Mixer Brush:") && error.contains(needle), "{params}: {error}");
            assert!(std::sync::Arc::ptr_eq(&before, &engine.active().unwrap().doc));
            install("mixer-test/bad", &mut engine).unwrap();
            assert_eq!(engine.tools.mixer, kept);
        }
    }
}
