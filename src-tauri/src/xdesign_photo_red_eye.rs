//! The Red Eye Tool, which the pinned engine has no command for. A click corrects the red pupil nearest it within a
//! search square; a dragged box corrects every red pupil inside the box.
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{ColorMode, LayerId, Rect},
    EngineError, Session,
};
use photocraft_raster::from_rgba_into;
use serde_json::{json, Value};

pub(super) const COMMAND: &str = "paint.redEye";
/// Pixels at least this red, as (r - max(g, b)) / r, seed a pupil.
const RED: f32 = 0.35;
/// Smaller red specks are noise, not pupils.
const MIN_PUPIL: usize = 4;
const MAX_AREA: u64 = 1 << 23;

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    (command == COMMAND).then(|| correct(engine, params))
}

fn percent(params: &Value, key: &str) -> Result<f32, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(0.5),
        Some(value) => value.as_f64().filter(|v| v.is_finite() && (1.0..=100.0).contains(v)).map(|v| (v / 100.0) as f32).ok_or_else(|| format!("Red Eye {key} must be 1..100 %, not {value}")),
    }
}

fn redness([r, g, b, a]: [f32; 4]) -> f32 {
    if a <= 0.0 || r < 0.1 { 0.0 } else { ((r - g.max(b)) / r).max(0.0) }
}

fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The searched area: the box, or for a click a square reaching an eighth of the shorter image side (at least 16 px).
fn area(params: &Value, bounds: Rect) -> Result<(Rect, Option<(i32, i32)>), String> {
    let number = |key: &str| params[key].as_f64().filter(|v| v.is_finite() && v.abs() < 1e9).ok_or_else(|| format!("Red Eye needs a numeric {key}"));
    let (x, y) = (number("x")?, number("y")?);
    if params.get("width").is_some() || params.get("height").is_some() {
        let (width, height) = (number("width")?.max(0.0), number("height")?.max(0.0));
        return Ok((Rect::new(x.floor() as i32, y.floor() as i32, (x + width).ceil() as i32, (y + height).ceil() as i32).intersect(&bounds), None));
    }
    let (cx, cy) = (x.floor() as i32, y.floor() as i32);
    let reach = ((bounds.width().min(bounds.height()) as f64 / 8.0).round() as i32).max(16);
    Ok((Rect::new(cx - reach, cy - reach, cx + reach + 1, cy + reach + 1).intersect(&bounds), Some((cx, cy))))
}

struct Pupil { count: usize, sx: f64, sy: f64, nearest: i64 }

/// 4-connected runs of red pixels in `area`; a click keeps only the one nearest it.
fn pupils(red: &[bool], width: usize, area: Rect, click: Option<(i32, i32)>) -> Vec<Pupil> {
    let mut seen = vec![false; red.len()];
    let mut found = Vec::new();
    let mut queue = Vec::new();
    for start in 0..red.len() {
        if !red[start] || seen[start] { continue; }
        seen[start] = true;
        queue.push(start);
        let mut pupil = Pupil { count: 0, sx: 0.0, sy: 0.0, nearest: i64::MAX };
        while let Some(index) = queue.pop() {
            let (x, y) = (index % width, index / width);
            let (px, py) = (area.x0 + x as i32, area.y0 + y as i32);
            pupil.count += 1;
            pupil.sx += f64::from(px) + 0.5;
            pupil.sy += f64::from(py) + 0.5;
            if let Some((cx, cy)) = click { pupil.nearest = pupil.nearest.min(i64::from(px - cx).pow(2) + i64::from(py - cy).pow(2)); }
            let height = red.len() / width;
            for (nx, ny) in [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)] {
                if nx < width && ny < height && red[ny * width + nx] && !seen[ny * width + nx] {
                    seen[ny * width + nx] = true;
                    queue.push(ny * width + nx);
                }
            }
        }
        if pupil.count >= MIN_PUPIL { found.push(pupil); }
    }
    if click.is_some() {
        found.sort_by_key(|pupil| pupil.nearest);
        found.truncate(1);
    }
    found
}

fn correct(engine: &mut Session, params: &Value) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason("paint.stroke") {
        return Err(reason);
    }
    let (pupil_size, darken) = (percent(params, "pupilSize")?, percent(params, "darken")?);
    let state = engine.active().ok_or("No image document")?;
    if state.doc.mode != ColorMode::Rgb {
        return Err("The Red Eye Tool works only on RGB images".into());
    }
    if !super::history::effective_target(state).is_null() || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err("The Red Eye Tool works on the layer's pixels, not a mask or a single channel".into());
    }
    let layer = params["layer"].as_u64().map(LayerId).or(state.active_layer).ok_or("No active layer")?;
    let target = state.doc.layer(layer).ok_or("The layer no longer exists")?;
    if target.locks.pixels || target.locks.all {
        return Err(format!("Could not use the Red Eye Tool because the layer \"{}\" is locked", target.name));
    }
    let surface = target.surface().ok_or("Could not use the Red Eye Tool because the target layer is not a pixel layer")?;
    let (area, click) = area(params, state.doc.bounds())?;
    if area.is_empty() {
        return Ok(json!({"corrected": 0}));
    }
    if u64::from(area.width()) * u64::from(area.height()) > MAX_AREA {
        return Err("Drag a smaller box around the eyes".into());
    }
    let width = area.width() as usize;
    let mut pixels = vec![[0.0; 4]; width * area.height() as usize];
    surface.read_rgba_into(area, &mut pixels);
    let coverage: Vec<f32> = match &state.doc.selection {
        Some(selection) => { let stride = selection.format().channels(); selection.read_region(area).iter().step_by(stride).copied().collect() }
        None => vec![1.0; pixels.len()],
    };
    let red: Vec<bool> = pixels.iter().zip(&coverage).map(|(&pixel, &cover)| cover > 0.0 && redness(pixel) >= RED).collect();
    let found = pupils(&red, width, area, click);
    if found.is_empty() {
        return Ok(json!({"corrected": 0}));
    }
    // Pupil Size scales the corrected disc from half to one and a half times the red area; only reddish pixels in it change.
    let mut weight = vec![0.0f32; pixels.len()];
    let mut touched = Rect::EMPTY;
    for pupil in &found {
        let (cx, cy) = (pupil.sx / pupil.count as f64, pupil.sy / pupil.count as f64);
        let radius = (pupil.count as f64 / std::f64::consts::PI).sqrt() * (0.5 + f64::from(pupil_size)) + 0.5;
        let disc = Rect::new((cx - radius - 1.0).floor() as i32, (cy - radius - 1.0).floor() as i32, (cx + radius + 1.0).ceil() as i32, (cy + radius + 1.0).ceil() as i32).intersect(&area);
        touched = touched.union(&disc);
        for py in disc.y0..disc.y1 {
            for px in disc.x0..disc.x1 {
                let index = (py - area.y0) as usize * width + (px - area.x0) as usize;
                let inside = (radius - (f64::from(px) + 0.5 - cx).hypot(f64::from(py) + 0.5 - cy) + 0.5).clamp(0.0, 1.0) as f32;
                if inside > 0.0 { weight[index] = weight[index].max(inside * smoothstep(0.15, 0.45, redness(pixels[index])) * coverage[index]); }
            }
        }
    }
    let keep = 1.0 - darken;
    let format = surface.format();
    let channels = format.channels();
    // Only the corrected discs are written, so untouched tiles stay shared with the previous history state.
    let mut raw = surface.read_region(touched);
    let mut encoded = [0.0; 8];
    for (offset, (py, px)) in (touched.y0..touched.y1).flat_map(|py| (touched.x0..touched.x1).map(move |px| (py, px))).enumerate() {
        let index = (py - area.y0) as usize * width + (px - area.x0) as usize;
        let w = weight[index];
        if w <= 0.0 { continue; }
        let [r, g, b, a] = pixels[index];
        let fixed = [(g + b) / 2.0 * keep, g * keep, b * keep];
        let out = [r + (fixed[0] - r) * w, g + (fixed[1] - g) * w, b + (fixed[2] - b) * w, a];
        let samples = from_rgba_into(&format, out, &mut encoded);
        raw[offset * channels..][..samples].copy_from_slice(&encoded[..samples]);
    }
    engine
        .edit("Red Eye Tool", |doc, _| {
            let surface = doc.layer_mut(layer).and_then(|layer| layer.surface_mut()).ok_or_else(|| EngineError::Other("not a pixel layer".into()))?;
            surface.write_region(touched, &raw);
            surface.prune();
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((COMMAND.into(), params.clone()));
    Ok(json!({"corrected": found.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// White skin-toned image with red pupils (and a darker iris ring) at the given centres.
    fn eyes(centres: &[(i32, i32)]) -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"name": "Eyes", "width": 80, "height": 40, "background": "white"})).unwrap();
        engine.execute("edit.fill", json!({"color": "#e0b090"})).unwrap();
        for &(x, y) in centres {
            engine.execute("select.rect", json!({"x": x - 7, "y": y - 7, "width": 15, "height": 15, "ellipse": true})).unwrap();
            engine.execute("edit.fill", json!({"color": "#406080"})).unwrap();
            engine.execute("select.rect", json!({"x": x - 4, "y": y - 4, "width": 9, "height": 9, "ellipse": true})).unwrap();
            engine.execute("edit.fill", json!({"color": "#e02020"})).unwrap();
        }
        engine.execute("select.deselect", json!({})).unwrap();
        engine
    }
    fn px(engine: &Session, x: i32, y: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, y)
    }
    fn run(engine: &mut Session, params: Value) -> Result<Value, String> {
        execute(engine, COMMAND, &params).expect("the Red Eye Tool is handled here")
    }
    fn fixed(pixel: [f32; 4]) -> bool { redness(pixel) < 0.1 && pixel[0] < 0.3 }

    #[test]
    fn a_click_darkens_only_the_nearest_red_pupil_in_one_history_step() {
        let mut engine = eyes(&[(15, 20), (60, 20)]);
        let (past, skin, iris) = (engine.active().unwrap().history.past_len(), px(&engine, 2, 2), px(&engine, 15, 14));
        assert_eq!(run(&mut engine, json!({"x": 17.4, "y": 21.2})).unwrap(), json!({"corrected": 1}));
        assert!(fixed(px(&engine, 15, 20)), "{:?}", px(&engine, 15, 20));
        assert!(redness(px(&engine, 60, 20)) > 0.8, "the other eye is outside the click's reach");
        assert_eq!((px(&engine, 2, 2), px(&engine, 15, 14)), (skin, iris));
        let history = &engine.active().unwrap().history;
        assert_eq!((history.past_len(), history.undo_label()), (past + 1, Some("Red Eye Tool")));
        assert_eq!(engine.journal.last().map(|(command, _)| command.as_str()), Some(COMMAND));
    }

    #[test]
    fn a_box_corrects_every_pupil_inside_it() {
        let mut engine = eyes(&[(15, 20), (60, 20)]);
        assert_eq!(run(&mut engine, json!({"x": 0, "y": 5, "width": 80, "height": 30})).unwrap(), json!({"corrected": 2}));
        assert!(fixed(px(&engine, 15, 20)) && fixed(px(&engine, 60, 20)));
    }

    #[test]
    fn darken_amount_and_pupil_size_shape_the_correction() {
        let luminance = |darken: u32| { let mut engine = eyes(&[(15, 20)]); run(&mut engine, json!({"x": 15, "y": 20, "darken": darken})).unwrap(); let [r, g, b, _] = px(&engine, 15, 20); r + g + b };
        assert!(luminance(80) < luminance(20) * 0.5);
        let changed = |pupil: u32| { let mut engine = eyes(&[(15, 20)]); let all: Vec<(i32, i32)> = (0..40).flat_map(|y| (0..80).map(move |x| (x, y))).collect(); let before: Vec<_> = all.iter().map(|&(x, y)| px(&engine, x, y)).collect(); run(&mut engine, json!({"x": 15, "y": 20, "pupilSize": pupil})).unwrap(); all.iter().zip(&before).filter(|&(&(x, y), &old)| px(&engine, x, y) != old).count() };
        assert!(changed(1) < changed(100), "{} vs {}", changed(1), changed(100));
    }

    #[test]
    fn nothing_red_changes_nothing_and_records_no_step() {
        let mut engine = eyes(&[(15, 20)]);
        let past = engine.active().unwrap().history.past_len();
        assert_eq!(run(&mut engine, json!({"x": 70, "y": 35})).unwrap(), json!({"corrected": 0}));
        assert_eq!(engine.active().unwrap().history.past_len(), past);
        engine.execute("select.rect", json!({"x": 40, "y": 0, "width": 40, "height": 40})).unwrap();
        assert_eq!(run(&mut engine, json!({"x": 15, "y": 20})).unwrap(), json!({"corrected": 0}), "the selection excludes the eye");
    }

    #[test]
    fn rejects_bad_options_and_targets_it_cannot_correct() {
        let mut engine = eyes(&[(15, 20)]);
        assert!(run(&mut engine, json!({"x": 15, "y": 20, "pupilSize": 0})).is_err());
        assert!(run(&mut engine, json!({"y": 20})).is_err());
        engine.execute("image.mode.grayscale", json!({})).unwrap();
        assert_eq!(run(&mut engine, json!({"x": 15, "y": 20})).unwrap_err(), "The Red Eye Tool works only on RGB images");
    }
}
