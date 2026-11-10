//! Colour midpoints for the Gradient tool (`paint.gradient {midpoints}`) and for saved
//! gradients (`gradient.presets.new {midpoints}`), which the engine keeps only on Gradient Fill
//! layers.
//!
//! A midpoint `m` on the segment from stop `a` to stop `b` makes the colour half-way between
//! them at `a + m·(b − a)` and linear on either side (`photocraft_compose::gradient_fill::
//! midpoint_remap`). That is exactly one extra colour stop, so the tool paints through the
//! engine's own `paint.gradient` with the bent stops as its current gradient for that one call.
//! Saved and current midpoints live in `gradient-midpoints.json` in the profile tool directory,
//! keyed by preset name (the engine keeps gradient names unique).
use photocraft_engine::{
    presets::gradients::{GradientPreset, StopColor},
    Session,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const FILE: &str = "gradient-midpoints.json";
const RANGE: &str = "midpoints must be a list of numbers from 0.05 to 0.95";
/// Keys this route resolves itself; the engine sees the bent gradient as its current one.
const RESOLVED: [&str; 3] = ["gradient", "stops", "midpoints"];

#[derive(Clone, Default)]
struct Saved {
    presets: BTreeMap<String, Vec<f64>>,
    current: Option<Vec<f64>>,
}

fn store() -> &'static Mutex<HashMap<PathBuf, Saved>> {
    static STORE: OnceLock<Mutex<HashMap<PathBuf, Saved>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn list(value: &Value) -> Option<Vec<f64>> {
    value.as_array()?.iter().map(Value::as_f64).collect()
}

fn read(dir: &Path) -> Saved {
    let Some(value) = std::fs::read(dir.join(FILE)).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) else { return Saved::default() };
    let presets = value["presets"].as_object().map(|presets| presets.iter().filter_map(|(name, mids)| Some((name.clone(), list(mids)?))).collect()).unwrap_or_default();
    Saved { presets, current: list(&value["current"]) }
}

/// The profile's saved midpoints, or nothing when no tool directory is marked on this thread.
fn saved() -> Option<Saved> {
    let dir = super::brush_library::profile_dir()?;
    let mut store = store().lock().ok()?;
    Some(store.entry(dir.clone()).or_insert_with(|| read(&dir)).clone())
}

fn update(change: impl FnOnce(&mut Saved)) -> Result<(), String> {
    let Some(dir) = super::brush_library::profile_dir() else { return Ok(()) };
    let mut store = store().lock().map_err(|_| "Gradient midpoints need Orion to be restarted")?;
    let saved = store.entry(dir.clone()).or_insert_with(|| read(&dir));
    let mut next = saved.clone();
    change(&mut next);
    let bytes = serde_json::to_vec(&json!({ "presets": next.presets, "current": next.current })).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("Gradient midpoints could not be saved: {error}"))?;
    photocraft_format::atomic_write(&dir.join(FILE), &bytes).map_err(|error| format!("Gradient midpoints could not be saved: {error}"))?;
    *saved = next;
    Ok(())
}

#[cfg(test)]
fn forget(dir: &Path) {
    store().lock().unwrap().remove(dir);
}

/// Colour stops as `resolve` orders them: clamped, stably sorted, Foreground to Background when empty.
fn sorted(preset: &GradientPreset) -> Vec<(f32, StopColor)> {
    let mut stops: Vec<(f32, StopColor)> = preset.stops.iter().map(|(t, c)| (t.clamp(0.0, 1.0), *c)).collect();
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    if stops.is_empty() {
        stops = vec![(0.0, StopColor::Foreground), (1.0, StopColor::Background)];
    }
    stops
}

fn segments(preset: &GradientPreset) -> usize {
    sorted(preset).len().saturating_sub(1)
}

/// `midpoints` checked against `segments` colour segments; all-50 % (or `[]`) is none.
fn parse(prefix: &str, value: &Value, segments: usize) -> Result<Vec<f64>, String> {
    let mids = list(value).filter(|mids| mids.iter().all(|m| m.is_finite() && (0.05..=0.95).contains(m))).ok_or_else(|| format!("{prefix}: {RANGE}"))?;
    if !mids.is_empty() && mids.len() != segments {
        return Err(format!("{prefix}: midpoints needs one value per colour segment ({segments}), got {}", mids.len()));
    }
    Ok(if mids.iter().all(|m| *m == 0.5) { Vec::new() } else { mids })
}

/// Stored midpoints that still fit the gradient (a stale list is ignored).
fn fitting(mids: Option<&Vec<f64>>, preset: &GradientPreset) -> Vec<f64> {
    mids.filter(|mids| mids.len() == segments(preset)).cloned().unwrap_or_default()
}

/// `preset` with one colour stop added at each bent midpoint: the colour half-way between the
/// segment's ends, so the engine's linear interpolation is the fill layer's bent one.
fn bend(preset: &GradientPreset, mids: &[f64], fg: [f32; 4], bg: [f32; 4]) -> GradientPreset {
    let rgb = |color: StopColor| match color {
        StopColor::Foreground => [fg[0], fg[1], fg[2]],
        StopColor::Background => [bg[0], bg[1], bg[2]],
        StopColor::Rgb(rgb) => rgb,
    };
    let stops = sorted(preset);
    let mut bent = Vec::with_capacity(stops.len() * 2);
    for (index, stop) in stops.iter().enumerate() {
        bent.push(*stop);
        let (Some(next), Some(m)) = (stops.get(index + 1), mids.get(index)) else { continue };
        let m = *m as f32;
        if (m - 0.5).abs() < 1e-6 || next.0 - stop.0 <= 1e-6 {
            continue;
        }
        let (a, b) = (rgb(stop.1), rgb(next.1));
        bent.push((stop.0 + m * (next.0 - stop.0), StopColor::Rgb(std::array::from_fn(|channel| (a[channel] + b[channel]) * 0.5))));
    }
    GradientPreset { name: preset.name.clone(), stops: bent, opacity: preset.opacity.clone() }
}

fn named<'a>(engine: &'a Session, name: &str) -> Option<&'a GradientPreset> {
    engine.presets.gradients.iter().flat_map(|group| group.items.iter()).find(|preset| preset.name == name)
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    match command {
        "paint.gradient" => paint(engine, params),
        "gradient.presets.new" => Some(new_preset(engine, params)),
        "gradient.presets.select" => Some(select(engine, params)),
        "gradient.presets.edit" | "gradient.presets.reset" => Some(edit(engine, command, params)),
        _ => None,
    }
}

fn engine_run(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
    engine.execute(command, params.clone()).map_err(|error| error.to_string())
}

/// The gradient `paint.gradient` would paint and the midpoints that go with it; `None` leaves
/// the request to the engine (which also reports a missing preset or bad stops).
fn tool_gradient(engine: &Session, params: &Value) -> Result<Option<(GradientPreset, Vec<f64>)>, String> {
    let explicit = params.get("midpoints");
    if params.get("colors").and_then(Value::as_array).is_some_and(|colors| !colors.is_empty()) {
        return match explicit {
            Some(_) => Err("Gradient: midpoints need stops, a gradient preset or the current gradient, not colors".into()),
            None => Ok(None),
        };
    }
    let saved = saved().unwrap_or_default();
    let (preset, stored) = if let Some(name) = params.get("gradient").and_then(Value::as_str) {
        let Some(preset) = named(engine, name) else { return Ok(None) };
        (preset.clone(), saved.presets.get(name).cloned())
    } else if params.get("stops").is_some() {
        let Ok(preset) = GradientPreset::from_params("Custom", params, "paint.gradient") else { return Ok(None) };
        (preset, None)
    } else {
        (engine.presets.gradient.clone(), saved.current.clone())
    };
    let mids = match explicit {
        Some(value) => parse("Gradient", value, segments(&preset))?,
        None => fitting(stored.as_ref(), &preset),
    };
    Ok((!mids.is_empty()).then_some((preset, mids)))
}

/// The bent gradient goes through the same tail as any engine paint command (paint fade
/// bookkeeping included), and the journal keeps the request as sent.
fn paint(engine: &mut Session, params: &Value) -> Option<Result<Value, String>> {
    let (preset, mids) = match tool_gradient(engine, params) {
        Ok(Some(found)) => found,
        Ok(None) => return None,
        Err(error) => return Some(Err(error)),
    };
    let bent = bend(&preset, &mids, engine.tools.foreground, engine.tools.background);
    let mut sent = params.clone();
    if let Some(object) = sent.as_object_mut() {
        for key in RESOLVED {
            object.remove(key);
        }
    }
    let fade = super::mask_filters::prepare_paint_fade(engine, "paint.gradient", &mut sent);
    let journal = engine.journal.len();
    let previous = std::mem::replace(&mut engine.presets.gradient, bent);
    let result = engine_run(engine, "paint.gradient", &sent);
    engine.presets.gradient = previous;
    let result = match result {
        Ok(result) => result,
        Err(error) => return Some(Err(error)),
    };
    super::mask_filters::finish_paint_fade(engine, fade);
    if engine.journal.len() == journal + 1 && engine.journal.last().is_some_and(|(command, _)| command == "paint.gradient") {
        let mut recorded = params.clone();
        if let Some(object) = recorded.as_object_mut() {
            object.retain(|key, _| sent.get(key).is_some() || RESOLVED.contains(&key.as_str()));
        }
        if let Some(last) = engine.journal.last_mut() {
            last.1 = recorded;
        }
    }
    Some(Ok(result))
}

/// The gradient `gradient.presets.new` / `select` would take: `preset` by name, explicit
/// `stops`, else the current gradient, and the midpoints stored with it.
fn chosen(engine: &Session, command: &str, params: &Value) -> Result<Option<(GradientPreset, Option<Vec<f64>>)>, String> {
    let saved = saved().unwrap_or_default();
    if command == "gradient.presets.select" {
        if let Some(name) = params.get("preset").and_then(Value::as_str) {
            let group = params.get("group").and_then(Value::as_str);
            let found = engine.presets.gradients.iter().filter(|g| group.is_none_or(|n| g.name == n)).flat_map(|g| g.items.iter()).find(|preset| preset.name == name);
            return Ok(found.map(|preset| (preset.clone(), saved.presets.get(name).cloned())));
        }
    }
    if params.get("stops").is_some() {
        return Ok(GradientPreset::from_params("Custom", params, command).ok().map(|preset| (preset, None)));
    }
    Ok(Some((engine.presets.gradient.clone(), saved.current.clone())))
}

fn midpoints_for(engine: &Session, command: &str, params: &Value) -> Result<Option<Vec<f64>>, String> {
    let Some((preset, stored)) = chosen(engine, command, params)? else { return Ok(None) };
    Ok(Some(match params.get("midpoints") {
        Some(value) => parse(command, value, segments(&preset))?,
        None => fitting(stored.as_ref(), &preset),
    }))
}

fn new_preset(engine: &mut Session, params: &Value) -> Result<Value, String> {
    const COMMAND: &str = "gradient.presets.new";
    let mids = midpoints_for(engine, COMMAND, params)?;
    let result = engine_run(engine, COMMAND, params)?;
    let name = result["name"].as_str().unwrap_or_default().to_owned();
    update(|saved| {
        match mids.filter(|mids| !mids.is_empty()) {
            Some(mids) => saved.presets.insert(name, mids),
            None => saved.presets.remove(&name),
        };
    })?;
    Ok(result)
}

fn select(engine: &mut Session, params: &Value) -> Result<Value, String> {
    const COMMAND: &str = "gradient.presets.select";
    let mids = midpoints_for(engine, COMMAND, params)?;
    let result = engine_run(engine, COMMAND, params)?;
    update(|saved| saved.current = mids.filter(|mids| !mids.is_empty()))?;
    Ok(result)
}

/// Renames carry a preset's midpoints; deleted presets (and groups, and a reset) drop theirs.
fn edit(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
    let result = engine_run(engine, command, params)?;
    let names: Vec<String> = engine.presets.gradients.iter().flat_map(|group| group.items.iter().map(|preset| preset.name.clone())).collect();
    let renamed = (params["action"] == "rename").then(|| params["preset"].as_str().zip(result["name"].as_str())).flatten();
    update(|saved| {
        if let Some((from, to)) = renamed {
            if let Some(mids) = saved.presets.remove(from) {
                saved.presets.insert(to.to_owned(), mids);
            }
        }
        saved.presets.retain(|name, _| names.contains(name));
    })?;
    Ok(result)
}

/// The state's gradient additions: `midpoints` on saved gradients and on the current gradient
/// when they bend it (absent means every midpoint is at 50 %).
pub(super) fn describe(state: &mut Value) {
    let Some(saved) = saved() else { return };
    if let Some(groups) = state["gradients"].as_array_mut() {
        for preset in groups.iter_mut().filter_map(|group| group["presets"].as_array_mut()).flatten() {
            if let Some(mids) = preset["name"].as_str().and_then(|name| saved.presets.get(name)) {
                preset["midpoints"] = json!(mids);
            }
        }
    }
    if let Some(mids) = &saved.current {
        state["gradient"]["midpoints"] = json!(mids);
    }
}

#[cfg(test)]
mod tests {
    use photocraft_engine::doc::{ColorMode, Document, Layer, SampleType, Size};
    use photocraft_engine::Session;
    use serde_json::{json, Value};
    use std::path::{Path, PathBuf};

    const WIDTH: u32 = 100;

    fn session() -> Session {
        let mut doc = Document::new("Gradient", Size::new(WIDTH, 1), ColorMode::Rgb, SampleType::F32);
        doc.layers.push(Layer::raster("Layer 1", doc.pixel_format()));
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine
    }
    fn px(engine: &Session, x: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, 0)
    }
    fn row(engine: &Session) -> Vec<[f32; 4]> {
        (0..WIDTH as i32).map(|x| px(engine, x)).collect()
    }
    fn run(engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, command, params)
    }
    fn profile() -> PathBuf {
        std::env::temp_dir().join(format!("orion-gradient-midpoints-{}", ulid::Ulid::new()))
    }
    fn tool(dir: &Path, engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
        super::super::tools::execute(dir, engine, command, |engine| super::super::execute_view_command(engine, command, params)).map(|(value, _)| value)
    }
    fn gradient(extra: Value) -> Value {
        let mut params = json!({ "from": [0, 0], "to": [WIDTH, 0], "dither": false });
        for (key, value) in extra.as_object().unwrap() {
            params[key] = value.clone();
        }
        params
    }
    fn hex(value: &str) -> [f32; 3] {
        let channel = |at: usize| f32::from(u8::from_str_radix(&value[at..at + 2], 16).unwrap()) / 255.0;
        [channel(1), channel(3), channel(5)]
    }
    /// The Gradient Fill layer's colour maths (`photocraft_compose::gradient_fill`): each colour
    /// segment is bent by its midpoint, then lerped.
    fn fill_color(stops: &[(f32, [f32; 3])], mids: &[f32], t: f32) -> [f32; 3] {
        if t <= stops[0].0 {
            return stops[0].1;
        }
        for (index, pair) in stops.windows(2).enumerate() {
            let (a, b) = (pair[0], pair[1]);
            if t <= b.0 {
                let u = if b.0 > a.0 { (t - a.0) / (b.0 - a.0) } else { 0.0 };
                let k = photocraft_compose::gradient_fill::midpoint_remap(u, mids.get(index).copied().unwrap_or(0.5));
                return std::array::from_fn(|channel| a.1[channel] + (b.1[channel] - a.1[channel]) * k);
            }
        }
        stops[stops.len() - 1].1
    }
    fn at(x: i32) -> f32 {
        (x as f32 + 0.5) / WIDTH as f32
    }
    fn close(actual: [f32; 4], expected: [f32; 3], alpha: f32, x: i32) {
        for channel in 0..3 {
            assert!((actual[channel] - expected[channel]).abs() < 2e-4, "x {x}: {actual:?} vs {expected:?}");
        }
        assert!((actual[3] - alpha).abs() < 2e-4, "x {x}: alpha {} vs {alpha}", actual[3]);
    }

    #[test]
    fn midpoints_bend_each_colour_segment_like_a_gradient_fill() {
        let mut engine = session();
        let params = gradient(json!({ "stops": [[0, "#000000"], [0.5, "#ff0000"], [1, "#ffffff"]], "midpoints": [0.25, 0.8] }));
        let before = engine.active().unwrap().history.past_len();
        assert_eq!(run(&mut engine, "paint.gradient", params.clone()).unwrap(), Value::Null);
        let stops = [(0.0, hex("#000000")), (0.5, hex("#ff0000")), (1.0, hex("#ffffff"))];
        for (x, pixel) in row(&engine).into_iter().enumerate() {
            close(pixel, fill_color(&stops, &[0.25, 0.8], at(x as i32)), 1.0, x as i32);
        }
        let state = engine.active().unwrap();
        assert_eq!(state.history.past_len(), before + 1);
        assert_eq!(state.history.undo_label(), Some("Gradient"));
        assert_eq!(engine.journal.last().unwrap(), &("paint.gradient".to_string(), params));
        assert_eq!(engine.presets.gradient, Session::new().presets.gradient, "the current gradient is left alone");
    }

    #[test]
    fn midpoints_resolve_foreground_stops_and_keep_opacity_linear() {
        let mut engine = session();
        engine.tools.foreground = [0.2, 0.4, 0.6, 1.0];
        let params = gradient(json!({ "stops": [[0, "foreground"], [1, "#ffffff"]], "transparency": [[0, 100], [1, 0]], "midpoints": [0.7] }));
        run(&mut engine, "paint.gradient", params).unwrap();
        let stops = [(0.0, [0.2, 0.4, 0.6]), (1.0, [1.0, 1.0, 1.0])];
        for (x, pixel) in row(&engine).into_iter().enumerate() {
            let t = at(x as i32);
            close(pixel, fill_color(&stops, &[0.7], t), 1.0 - t, x as i32);
        }
    }

    #[test]
    fn half_or_empty_midpoints_paint_the_plain_gradient() {
        let mut plain = session();
        run(&mut plain, "paint.gradient", gradient(json!({ "stops": [[0, "#102030"], [1, "#f0e0d0"]] }))).unwrap();
        for midpoints in [json!([0.5]), json!([])] {
            let mut engine = session();
            run(&mut engine, "paint.gradient", gradient(json!({ "stops": [[0, "#102030"], [1, "#f0e0d0"]], "midpoints": midpoints }))).unwrap();
            assert_eq!(row(&engine), row(&plain));
        }
    }

    #[test]
    fn bad_midpoints_are_refused_without_painting() {
        let two = json!([[0, "#000000"], [1, "#ffffff"]]);
        for (extra, error) in [
            (json!({ "stops": two, "midpoints": 0.5 }), "Gradient: midpoints must be a list of numbers from 0.05 to 0.95"),
            (json!({ "stops": two, "midpoints": ["half"] }), "Gradient: midpoints must be a list of numbers from 0.05 to 0.95"),
            (json!({ "stops": two, "midpoints": [0.04] }), "Gradient: midpoints must be a list of numbers from 0.05 to 0.95"),
            (json!({ "stops": two, "midpoints": [0.96] }), "Gradient: midpoints must be a list of numbers from 0.05 to 0.95"),
            (json!({ "stops": two, "midpoints": [0.3, 0.4] }), "Gradient: midpoints needs one value per colour segment (1), got 2"),
            (json!({ "colors": ["#000000", "#ffffff"], "midpoints": [0.3] }), "Gradient: midpoints need stops, a gradient preset or the current gradient, not colors"),
        ] {
            let mut engine = session();
            let journal = engine.journal.len();
            assert_eq!(run(&mut engine, "paint.gradient", gradient(extra)).unwrap_err(), error);
            assert!(row(&engine).iter().all(|pixel| pixel[3] == 0.0));
            assert_eq!(engine.journal.len(), journal);
        }
    }

    #[test]
    fn saved_and_current_gradients_keep_their_midpoints() {
        let dir = profile();
        let mut engine = session();
        super::super::tools::activate(&dir, &mut engine).unwrap();
        let stops = json!([[0, "#000000"], [1, "#ffffff"]]);
        let saved = tool(&dir, &mut engine, "gradient.presets.new", json!({ "name": "Bent", "stops": stops, "midpoints": [0.3] })).unwrap();
        let listed = |engine: &Session, name: &str| {
            let state = super::super::tools::presets(engine);
            state["gradients"].as_array().unwrap().iter().flat_map(|group| group["presets"].as_array().unwrap().clone()).find(|preset| preset["name"] == name).unwrap()
        };
        assert_eq!(listed(&engine, saved["name"].as_str().unwrap())["midpoints"], json!([0.3]));
        assert_eq!(
            tool(&dir, &mut engine, "gradient.presets.new", json!({ "name": "Wrong", "stops": stops, "midpoints": [0.99] })).unwrap_err(),
            "gradient.presets.new: midpoints must be a list of numbers from 0.05 to 0.95"
        );
        assert!(super::super::tools::presets(&engine)["gradients"].to_string().find("\"Wrong\"").is_none());

        let bent = [(0.0, [0.0; 3]), (1.0, [1.0; 3])];
        tool(&dir, &mut engine, "paint.gradient", gradient(json!({ "gradient": "Bent" }))).unwrap();
        for (x, pixel) in row(&engine).into_iter().enumerate() {
            close(pixel, fill_color(&bent, &[0.3], at(x as i32)), 1.0, x as i32);
        }

        tool(&dir, &mut engine, "gradient.presets.select", json!({ "preset": "Bent" })).unwrap();
        assert_eq!(super::super::tools::presets(&engine)["gradient"]["midpoints"], json!([0.3]));
        let mut fresh = session();
        super::super::tools::activate(&dir, &mut fresh).unwrap();
        tool(&dir, &mut fresh, "paint.gradient", gradient(json!({}))).unwrap();
        assert_eq!(row(&fresh), row(&engine), "the current gradient paints with its midpoints");
        tool(&dir, &mut engine, "gradient.presets.new", json!({ "name": "Copy" })).unwrap();
        assert_eq!(listed(&engine, "Copy")["midpoints"], json!([0.3]));

        tool(&dir, &mut engine, "gradient.presets.edit", json!({ "action": "rename", "preset": "Copy", "name": "Kept" })).unwrap();
        assert_eq!(listed(&engine, "Kept")["midpoints"], json!([0.3]));
        tool(&dir, &mut engine, "gradient.presets.edit", json!({ "action": "delete", "preset": "Kept" })).unwrap();
        tool(&dir, &mut engine, "gradient.presets.new", json!({ "name": "Kept", "stops": stops })).unwrap();
        assert!(listed(&engine, "Kept").get("midpoints").is_none(), "a deleted preset's midpoints go with it");

        tool(&dir, &mut engine, "gradient.presets.select", json!({ "stops": stops, "midpoints": [0.6] })).unwrap();
        assert_eq!(super::super::tools::presets(&engine)["gradient"]["midpoints"], json!([0.6]));
        tool(&dir, &mut engine, "gradient.presets.select", json!({ "stops": stops })).unwrap();
        assert!(super::super::tools::presets(&engine)["gradient"].get("midpoints").is_none());

        super::forget(&dir);
        assert_eq!(listed(&engine, "Bent")["midpoints"], json!([0.3]), "midpoints are read back from the profile");
    }
}
