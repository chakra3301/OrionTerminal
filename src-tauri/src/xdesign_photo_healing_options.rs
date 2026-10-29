//! Photoshop healing options the pinned engine has no parameter for: the eight healing modes (with
//! Replace), Spot Healing's sampled layers, Healing Brush's Pattern source and Diffusion, and
//! Ignore Adjustment Layers when Clone Stamp or Healing Brush sample several layers.
use super::{from_rgba_into, BlendMode, Document, PixelFormat, Rect, Region, SampleLayers, Session};
use photocraft_compose::pattern::{render, Placement, Tile};
use photocraft_engine::{commands::blend_from_str, doc::LayerContent, pattern_cmds};
use serde_json::Value;

const MODES: [&str; 8] = ["Normal", "Replace", "Multiply", "Screen", "Darken", "Lighten", "Color", "Luminosity"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Heal {
    Blend(BlendMode),
    /// Healed pixels replace the layer's outright inside the stroke, so a soft brush edge keeps its
    /// grain instead of averaging two textures.
    Replace,
}
impl Heal {
    pub(super) fn blend(self) -> BlendMode {
        match self {
            Self::Blend(mode) => mode,
            Self::Replace => BlendMode::Normal,
        }
    }
}

fn tool(command: &str) -> &'static str {
    match command {
        "paint.spotHealing" => "Spot Healing Brush",
        "paint.healingBrush" => "Healing Brush",
        "paint.patch" => "Patch Tool",
        _ => "Clone Stamp",
    }
}

fn text<'a>(command: &str, params: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("{}: {key} must be a string", tool(command))),
    }
}

fn flag(command: &str, params: &Value, key: &str) -> Result<bool, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{}: {key} must be true or false", tool(command))),
    }
}

pub(super) fn heal_mode(command: &str, params: &Value) -> Result<Heal, String> {
    let Some(name) = text(command, params, "mode")? else { return Ok(Heal::Blend(BlendMode::Normal)) };
    match MODES.iter().find(|mode| mode.eq_ignore_ascii_case(name)) {
        Some(&"Replace") => Ok(Heal::Replace),
        Some(mode) => blend_from_str(mode).map(Heal::Blend).ok_or_else(|| format!("{}: mode \"{mode}\" is unavailable", tool(command))),
        None => Err(format!("{}: unknown mode \"{name}\" ({})", tool(command), MODES.join(", "))),
    }
}

pub(super) fn sample_layers(command: &str, params: &Value) -> Result<SampleLayers, String> {
    match text(command, params, "sampleLayer")?.unwrap_or("current") {
        "current" => Ok(SampleLayers::Current),
        "currentAndBelow" => Ok(SampleLayers::CurrentAndBelow),
        "all" => Ok(SampleLayers::All),
        other => Err(format!("{}: unknown sampleLayer \"{other}\" (current, currentAndBelow, all)", tool(command))),
    }
}

/// Photoshop's Diffusion slider: a whole number from 1 to 7, 5 by default.
pub(super) fn diffusion(command: &str, params: &Value) -> Result<u8, String> {
    let Some(value) = params.get("diffusion").filter(|value| !value.is_null()) else { return Ok(5) };
    value
        .as_u64()
        .filter(|value| (1..=7).contains(value))
        .map(|value| value as u8)
        .or_else(|| value.as_f64().filter(|value| value.fract() == 0.0 && (1.0..=7.0).contains(value)).map(|value| value as u8))
        .ok_or_else(|| format!("{}: diffusion must be a whole number from 1 to 7", tool(command)))
}

pub(super) fn ignore_adjustments(command: &str, params: &Value) -> Result<bool, String> {
    flag(command, params, "ignoreAdjustmentLayers")
}

/// Healing Brush's Source: `sampled` pixels (the Clone Source) or a `pattern`.
pub(super) fn pattern_source(command: &str, params: &Value) -> Result<bool, String> {
    match text(command, params, "sourceType")?.unwrap_or("sampled") {
        "sampled" => Ok(false),
        "pattern" => Ok(true),
        other => Err(format!("{}: unknown sourceType \"{other}\" (sampled, pattern)", tool(command))),
    }
}

/// Whether `params` ask for an option only the host implements. Every option is validated here, so
/// a bad value fails before either the native or the host stroke runs.
pub(super) fn host_only(command: &str, params: &Value) -> Result<bool, String> {
    match command {
        "paint.spotHealing" => {
            let heal = heal_mode(command, params)?;
            Ok(heal != Heal::Blend(BlendMode::Normal) || sample_layers(command, params)? != SampleLayers::Current)
        }
        "paint.healingBrush" => {
            let heal = heal_mode(command, params)?;
            let which = sample_layers(command, params)?;
            let diffusion = diffusion(command, params)?;
            let pattern = pattern_source(command, params)?;
            let ignore = ignore_adjustments(command, params)?;
            Ok(heal == Heal::Replace || diffusion != 5 || pattern || ignore && which != SampleLayers::Current)
        }
        "paint.cloneStamp" => {
            let which = sample_layers(command, params)?;
            Ok(ignore_adjustments(command, params)? && which != SampleLayers::Current)
        }
        _ => Ok(false),
    }
}

/// The document as sampled with adjustment layers hidden.
pub(super) fn without_adjustments(doc: &Document) -> Document {
    let mut out = doc.clone();
    for (path, _, layer) in doc.walk() {
        if matches!(layer.content, LayerContent::Adjustment(_)) {
            if let Some(layer) = out.layer_at_mut(&path) {
                layer.visible = false;
            }
        }
    }
    out
}

pub(super) fn replace_coverage(cov: &mut [f32]) {
    for value in cov.iter_mut().filter(|value| **value > 0.0) {
        *value = 1.0;
    }
}

pub(super) struct PatternSource {
    tile: Tile,
    place: Placement,
}
impl PatternSource {
    /// The Pattern source, as Pattern Stamp tiles it: aligned to the image origin, or centred
    /// where the stroke starts when Aligned is off.
    pub(super) fn new(engine: &Session, command: &str, params: &Value, first: (f64, f64)) -> Result<Option<Self>, String> {
        if !pattern_source(command, params)? {
            return Ok(None);
        }
        let key = text(command, params, "pattern")?.unwrap_or("");
        let pattern = pattern_cmds::resolve(engine, key).ok_or_else(|| if key.is_empty() { format!("{}: choose a pattern", tool(command)) } else { format!("{}: no pattern \"{key}\"", tool(command)) })?;
        let tile = Tile::new(&pattern).ok_or_else(|| format!("{}: the pattern is empty", tool(command)))?;
        let phase = if params["aligned"].as_bool().unwrap_or(true) { (0.0, 0.0) } else { ((first.0 - f64::from(pattern.width) / 2.0) as f32, (first.1 - f64::from(pattern.height) / 2.0) as f32) };
        Ok(Some(Self { tile, place: Placement::new(Rect::EMPTY, false, phase, 1.0, 0.0) }))
    }
    pub(super) fn region(&self, rect: Rect, fmt: &PixelFormat) -> Region {
        let n = fmt.channels();
        let mut out = Region::new(rect, n);
        let mut encoded = [0.0f32; 8];
        for (index, pixel) in render(&self.tile, &self.place, rect).into_iter().enumerate() {
            from_rgba_into(fmt, pixel, &mut encoded);
            out.data[index * n..(index + 1) * n].copy_from_slice(&encoded[..n]);
        }
        out
    }
}

/// Diffusion above 5: the edge mismatch is averaged over nearby known pixels before the membrane
/// spreads it, so grain along the edge no longer blotches a smooth area.
pub(super) fn smooth_mismatch(delta: &mut [f32], mask: &[bool], w: usize, h: usize, ch: usize, diffusion: u8, scale: f32) {
    if diffusion <= 5 || w == 0 || h == 0 {
        return;
    }
    let radius = ((scale * 2f32.powi(i32::from(diffusion) - 8)).round() as usize).max(1);
    let mut weight: Vec<f32> = mask.iter().map(|hole| if *hole { 0.0 } else { 1.0 }).collect();
    let mut sums: Vec<f32> = delta.iter().enumerate().map(|(i, value)| value * weight[i / ch]).collect();
    for _ in 0..3 {
        box_blur(&mut sums, w, h, ch, radius);
        box_blur(&mut weight, w, h, 1, radius);
    }
    for (i, known) in mask.iter().map(|hole| !hole).enumerate() {
        if known && weight[i] > 1e-6 {
            for c in 0..ch {
                delta[i * ch + c] = sums[i * ch + c] / weight[i];
            }
        }
    }
}

/// Diffusion below 5: the membrane's correction fades with distance from the healed edge, so the
/// sampled texture and tone survive further inside.
pub(super) fn confine_correction(correction: &mut [f32], mask: &[bool], w: usize, h: usize, ch: usize, diffusion: u8, scale: f32) {
    if diffusion >= 5 || w == 0 || h == 0 {
        return;
    }
    let reach = (scale * 2f32.powi(i32::from(diffusion) - 5)).max(1.0);
    for (i, distance) in edge_distance(mask, w, h).into_iter().enumerate() {
        if mask[i] {
            let keep = (-distance / reach).exp();
            correction[i * ch..(i + 1) * ch].iter_mut().for_each(|value| *value *= keep);
        }
    }
}

/// Chamfer distance of each hole pixel to the nearest known pixel (known pixels are 0).
pub(super) fn edge_distance(mask: &[bool], w: usize, h: usize) -> Vec<f32> {
    let far = (w + h) as f32 * 2.0;
    let mut d: Vec<f32> = mask.iter().map(|hole| if *hole { far } else { 0.0 }).collect();
    let diagonal = std::f32::consts::SQRT_2;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let mut v = d[i];
            if x > 0 { v = v.min(d[i - 1] + 1.0); }
            if y > 0 {
                v = v.min(d[i - w] + 1.0);
                if x > 0 { v = v.min(d[i - w - 1] + diagonal); }
                if x + 1 < w { v = v.min(d[i - w + 1] + diagonal); }
            }
            d[i] = v;
        }
    }
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            let i = y * w + x;
            let mut v = d[i];
            if x + 1 < w { v = v.min(d[i + 1] + 1.0); }
            if y + 1 < h {
                v = v.min(d[i + w] + 1.0);
                if x + 1 < w { v = v.min(d[i + w + 1] + diagonal); }
                if x > 0 { v = v.min(d[i + w - 1] + diagonal); }
            }
            d[i] = v;
        }
    }
    d
}

/// Separable box sum of `radius`, clamped at the edges (a sum, not a mean: callers normalise).
fn box_blur(data: &mut [f32], w: usize, h: usize, ch: usize, radius: usize) {
    let mut line: Vec<f64> = Vec::new();
    for pass in 0..2 {
        let (count, len) = if pass == 0 { (h, w) } else { (w, h) };
        for outer in 0..count {
            let at = |inner: usize| if pass == 0 { outer * w + inner } else { inner * w + outer };
            // Prefix sums keep the cost per pixel independent of the radius (Diffusion 7 on a
            // large brush reaches radii of hundreds of pixels).
            line.clear();
            line.resize((len + 1) * ch, 0.0f64);
            for inner in 0..len {
                for c in 0..ch {
                    line[(inner + 1) * ch + c] = line[inner * ch + c] + f64::from(data[at(inner) * ch + c]);
                }
            }
            for inner in 0..len {
                let (lo, hi) = (inner.saturating_sub(radius), (inner + radius).min(len - 1));
                for c in 0..ch {
                    data[at(inner) * ch + c] = (line[(hi + 1) * ch + c] - line[lo * ch + c]) as f32;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::RetouchStroke;
    use photocraft_engine::{doc::{Document, LayerId}, Session};
    use serde_json::{json, Value};
    use std::sync::Arc;

    /// A purple image with a dark dot at (24,24).
    fn image(depth: u64) -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 48, "height": 48, "depth": depth, "mode": "rgb", "background": "#905080"})).unwrap();
        engine.execute("paint.stroke", json!({"points": [[24, 24]], "size": 7, "hardness": 100, "color": "#101010", "seed": 3})).unwrap();
        engine
    }
    fn active(engine: &Session) -> LayerId {
        engine.active().unwrap().active_layer.unwrap()
    }
    fn px(doc: &Document, layer: LayerId, x: i32, y: i32) -> [f32; 4] {
        doc.layer(layer).unwrap().surface().unwrap().rgba(x, y)
    }
    fn near(a: [f32; 4], b: [f32; 4], tolerance: f32) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= tolerance)
    }
    const PURPLE: [f32; 4] = [0x90 as f32 / 255.0, 0x50 as f32 / 255.0, 0x80 as f32 / 255.0, 1.0];
    fn live(engine: &Session, command: &str, params: &Value) -> Result<Arc<Document>, String> {
        let mut stroke = RetouchStroke::begin(engine, command, params)?;
        stroke.push(params)?;
        Ok(stroke.document())
    }
    fn isolated(engine: &Session) -> Session {
        let mut copy = Session::new();
        let state = engine.active().unwrap().clone();
        copy.add_document((*state.doc).clone(), None);
        *copy.active_mut().unwrap() = state;
        copy.tools = engine.tools.clone();
        copy.presets = engine.presets.clone();
        copy
    }
    fn spot(extra: Value) -> Value {
        let mut params = json!({"points": [[24, 24], [25, 24]], "size": 16, "hardness": 100, "type": "contentAware", "seed": 11});
        params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        params
    }

    #[test]
    fn spot_healing_sample_all_layers_heals_the_composite_onto_an_empty_layer() {
        let mut engine = image(8);
        engine.execute("layer.new.layer", json!({"name": "Heal"})).unwrap();
        let layer = active(&engine);
        let all = live(&engine, "paint.spotHealing", &spot(json!({"sampleLayer": "all"}))).unwrap();
        assert!(near(px(&all, layer, 24, 24), PURPLE, 0.08), "{:?}", px(&all, layer, 24, 24));
        let below = live(&engine, "paint.spotHealing", &spot(json!({"sampleLayer": "currentAndBelow"}))).unwrap();
        assert!(near(px(&below, layer, 24, 24), PURPLE, 0.08));
        let current = live(&engine, "paint.spotHealing", &spot(json!({"sampleLayer": "current"}))).unwrap();
        assert!(px(&current, layer, 24, 24)[3] < 0.05);
    }

    #[test]
    fn spot_healing_modes_blend_the_heal_and_replace_keeps_soft_edges_unmixed() {
        let engine = image(8);
        let layer = active(&engine);
        let original = engine.active().unwrap().doc.clone();
        let normal = live(&engine, "paint.spotHealing", &spot(json!({"mode": "Normal"}))).unwrap();
        assert!(near(px(&normal, layer, 24, 24), PURPLE, 0.08));
        let darken = live(&engine, "paint.spotHealing", &spot(json!({"mode": "Darken"}))).unwrap();
        assert!(near(px(&darken, layer, 24, 24), px(&original, layer, 24, 24), 0.02), "Darken keeps the darker dot");
        let lighten = live(&engine, "paint.spotHealing", &spot(json!({"mode": "lighten"}))).unwrap();
        assert!(near(px(&lighten, layer, 24, 24), PURPLE, 0.08));
        let soft = |mode: &str| live(&engine, "paint.spotHealing", &spot(json!({"mode": mode, "hardness": 0}))).unwrap();
        let (normal, replace) = (soft("Normal"), soft("Replace"));
        let mut wider = false;
        for y in 8..40 {
            for x in 8..40 {
                let (o, n, r) = (px(&original, layer, x, y), px(&normal, layer, x, y), px(&replace, layer, x, y));
                for c in 0..3 {
                    assert!((n[c] - o[c]).abs() <= (r[c] - o[c]).abs() + 2.0 / 255.0, "{x},{y}");
                    wider |= (r[c] - o[c]).abs() > (n[c] - o[c]).abs() + 0.03;
                }
            }
        }
        assert!(wider, "Replace applies the soft edge at full strength");
    }

    #[test]
    fn host_options_commit_as_one_history_step_and_preview_without_an_identity() {
        let mut engine = image(8);
        engine.execute("layer.new.layer", json!({"name": "Heal"})).unwrap();
        let layer = active(&engine);
        let params = spot(json!({"sampleLayer": "all", "mode": "Replace"}));
        let expected = live(&engine, "paint.spotHealing", &params).unwrap();
        let (preview, damage) = super::super::super::retouch_document(&engine, None, "paint.spotHealing", &params).unwrap();
        assert_eq!(px(&preview, layer, 24, 24), px(&expected, layer, 24, 24));
        assert!(!damage.is_empty());
        let past = engine.active().unwrap().history.past_len();
        super::super::super::super::execute_view_command(&mut engine, "paint.spotHealing", params.clone()).unwrap();
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Spot Healing Brush")));
        assert_eq!(px(&state.doc, layer, 24, 24), px(&expected, layer, 24, 24));
        assert_eq!(engine.journal.last().unwrap().0, "paint.spotHealing");
        let before = engine.active().unwrap().doc.clone();
        assert!(super::super::super::super::execute_view_command(&mut engine, "paint.spotHealing", spot(json!({"mode": "Overlay"}))).is_err());
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        assert!(super::super::super::host_retouch(&mut engine, "paint.spotHealing", &spot(json!({}))).is_none(), "native options stay native");
        assert!(super::super::super::host_retouch(&mut engine, "paint.stroke", &json!({"points": [[1, 1]]})).is_none());
    }

    #[test]
    fn healing_options_reject_unknown_and_out_of_range_values() {
        let engine = image(8);
        for (command, params, needle) in [
            ("paint.spotHealing", spot(json!({"mode": "Overlay"})), "unknown mode \"Overlay\""),
            ("paint.spotHealing", spot(json!({"mode": 3})), "mode must be a string"),
            ("paint.spotHealing", spot(json!({"sampleLayer": "everything"})), "unknown sampleLayer"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "source": [8, 8], "size": 9, "mode": "Overlay", "seed": 1}), "unknown mode"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "source": [8, 8], "size": 9, "diffusion": 0, "seed": 1}), "diffusion must be a whole number from 1 to 7"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "source": [8, 8], "size": 9, "diffusion": 8, "seed": 1}), "diffusion"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "source": [8, 8], "size": 9, "diffusion": 2.5, "seed": 1}), "diffusion"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "source": [8, 8], "size": 9, "diffusion": "5", "seed": 1}), "diffusion"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "size": 9, "sourceType": "texture", "seed": 1}), "unknown sourceType"),
            ("paint.healingBrush", json!({"points": [[24, 24]], "size": 9, "sourceType": "pattern", "pattern": "no-such-pattern", "seed": 1}), "no pattern \"no-such-pattern\""),
            ("paint.cloneStamp", json!({"points": [[24, 24]], "source": [8, 8], "size": 9, "sampleLayer": "all", "ignoreAdjustmentLayers": "yes", "seed": 1}), "ignoreAdjustmentLayers must be true or false"),
        ] {
            let error = live(&engine, command, &params).map(|_| ()).unwrap_err();
            assert!(error.contains(needle), "{command}: {error}");
            assert!(super::host_only(command, &params).is_err() || needle.starts_with("no pattern"), "{command}: {params}");
        }
    }

    fn healing(extra: Value) -> Value {
        let mut params = json!({"points": [[22, 24], [27, 25]], "source": [10, 10], "size": 12, "hardness": 60, "seed": 21});
        params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        params
    }

    #[test]
    fn healing_brush_replace_mode_applies_the_soft_edge_unmixed() {
        let engine = image(8);
        let layer = active(&engine);
        let original = engine.active().unwrap().doc.clone();
        let normal = live(&engine, "paint.healingBrush", &healing(json!({"hardness": 0}))).unwrap();
        let replace = live(&engine, "paint.healingBrush", &healing(json!({"hardness": 0, "mode": "Replace"}))).unwrap();
        let mut wider = false;
        for y in 8..40 {
            for x in 8..40 {
                let (o, n, r) = (px(&original, layer, x, y), px(&normal, layer, x, y), px(&replace, layer, x, y));
                for c in 0..3 {
                    assert!((n[c] - o[c]).abs() <= (r[c] - o[c]).abs() + 2.0 / 255.0);
                    wider |= (r[c] - o[c]).abs() > (n[c] - o[c]).abs() + 0.03;
                }
            }
        }
        assert!(wider);
    }

    #[test]
    fn healing_brush_pattern_source_heals_pattern_texture_without_a_clone_source() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 64, "height": 48, "depth": 8, "mode": "rgb", "background": "#606060"})).unwrap();
        let layer = active(&engine);
        let params = json!({"points": [[8, 24], [56, 24]], "size": 20, "hardness": 100, "sourceType": "pattern", "seed": 5});
        let healed = live(&engine, "paint.healingBrush", &params).unwrap();
        let row: Vec<f32> = (12..52).map(|x| px(&healed, layer, x, 24)[0]).collect();
        let (low, high) = row.iter().fold((f32::MAX, f32::MIN), |(l, h), v| (l.min(*v), h.max(*v)));
        assert!(high - low > 0.1, "the pattern's checkerboard texture shows: {low}..{high}");
        assert!(near(px(&healed, layer, 32, 2), px(&engine.active().unwrap().doc, layer, 32, 2), 0.0));
        let sampled = live(&engine, "paint.healingBrush", &json!({"points": [[8, 24]], "size": 20, "seed": 5}));
        assert!(sampled.is_err(), "Sampled still needs a clone source");
    }

    #[test]
    fn healing_brush_diffusion_five_is_the_native_heal_and_other_values_change_it() {
        // A cyan band sampled onto tan, across a dark line that makes the edge mismatch uneven.
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 64, "height": 48, "depth": 32, "mode": "rgb", "background": "#806040"})).unwrap();
        engine.execute("paint.stroke", json!({"points": [[0, 10], [64, 10]], "size": 20, "hardness": 100, "color": "#20b0c0", "seed": 2})).unwrap();
        engine.execute("paint.stroke", json!({"points": [[30, 24], [30, 44]], "size": 3, "hardness": 100, "color": "#202020", "seed": 2})).unwrap();
        let layer = active(&engine);
        let params = |diffusion: Option<u8>| {
            let mut params = json!({"points": [[20, 34], [44, 34]], "source": [32, 10], "size": 12, "hardness": 100, "seed": 9});
            if let Some(diffusion) = diffusion { params["diffusion"] = json!(diffusion); }
            params
        };
        let pixels = |doc: &Document| doc.layer(layer).unwrap().surface().unwrap().read_region(doc.bounds());
        let mut native = isolated(&engine);
        native.execute("paint.healingBrush", params(None)).unwrap();
        let native = pixels(&native.active().unwrap().doc);
        assert_eq!(pixels(&live(&engine, "paint.healingBrush", &params(Some(5))).unwrap()), native);
        assert!(!super::host_only("paint.healingBrush", &params(Some(5))).unwrap());
        for diffusion in [1, 3, 6, 7] {
            assert!(super::host_only("paint.healingBrush", &params(Some(diffusion))).unwrap());
            let changed = pixels(&live(&engine, "paint.healingBrush", &params(Some(diffusion))).unwrap());
            assert_ne!(changed, native, "diffusion {diffusion}");
        }
        // Low diffusion keeps more of the sampled cyan inside; 5 adapts it to the tan surround.
        let centre = |diffusion: u8| px(&live(&engine, "paint.healingBrush", &params(Some(diffusion))).unwrap(), layer, 36, 34)[2];
        assert!(centre(1) > centre(5) + 0.1, "{} vs {}", centre(1), centre(5));
    }

    #[test]
    fn ignore_adjustment_layers_samples_the_composite_without_them() {
        for command in ["paint.cloneStamp", "paint.healingBrush"] {
            let mut engine = Session::new();
            engine.execute("file.new", json!({"width": 48, "height": 48, "depth": 8, "mode": "rgb", "background": "#905080"})).unwrap();
            engine.execute("layer.new.layer", json!({"name": "Retouch"})).unwrap();
            let layer = active(&engine);
            engine.execute("layer.newAdjustmentLayer.invert", json!({})).unwrap();
            engine.execute("layer.select", json!({"layer": layer.0})).unwrap();
            let params = |ignore: bool| json!({"points": [[24, 24], [26, 24]], "source": [10, 10], "size": 12, "hardness": 100, "sampleLayer": "all", "ignoreAdjustmentLayers": ignore, "seed": 4});
            let ignored = live(&engine, command, &params(true)).unwrap();
            assert!(near(px(&ignored, layer, 25, 24), PURPLE, 0.03), "{command}: {:?}", px(&ignored, layer, 25, 24));
            let inverted = live(&engine, command, &params(false)).unwrap();
            assert!(near(px(&inverted, layer, 25, 24), [1.0 - PURPLE[0], 1.0 - PURPLE[1], 1.0 - PURPLE[2], 1.0], 0.03), "{command}");
            assert!(super::host_only(command, &params(true)).unwrap());
            assert!(!super::host_only(command, &params(false)).unwrap());
            let mut current = params(true);
            current["sampleLayer"] = json!("current");
            assert!(!super::host_only(command, &current).unwrap(), "Current Layer never samples adjustment layers");
        }
    }

    fn naive_box_sum(data: &[f32], w: usize, h: usize, ch: usize, radius: usize) -> Vec<f32> {
        let mut out = vec![0.0; data.len()];
        for y in 0..h {
            for x in 0..w {
                for c in 0..ch {
                    let mut sum = 0.0;
                    for yy in y.saturating_sub(radius)..=(y + radius).min(h - 1) {
                        for xx in x.saturating_sub(radius)..=(x + radius).min(w - 1) {
                            sum += data[(yy * w + xx) * ch + c];
                        }
                    }
                    out[(y * w + x) * ch + c] = sum;
                }
            }
        }
        out
    }

    #[test]
    fn box_sums_match_the_window_sum_at_every_radius() {
        let (w, h, ch) = (13, 7, 2);
        let data: Vec<f32> = (0..w * h * ch).map(|i| ((i * 37) % 11) as f32 / 10.0 - 0.3).collect();
        for radius in [1, 2, 5, 6, 20] {
            let mut blurred = data.clone();
            super::box_blur(&mut blurred, w, h, ch, radius);
            let expected = naive_box_sum(&data, w, h, ch, radius);
            for (got, want) in blurred.iter().zip(&expected) {
                assert!((got - want).abs() < 1e-3, "radius {radius}: {got} vs {want}");
            }
        }
    }

    #[test]
    fn diffusion_seven_on_a_large_brush_smooths_in_linear_time() {
        let (w, h, ch) = (1024, 1024, 4);
        let mask: Vec<bool> = (0..w * h).map(|i| (i % w) > w / 2).collect();
        let mut delta: Vec<f32> = (0..w * h * ch).map(|i| (i % 7) as f32 / 7.0).collect();
        let started = std::time::Instant::now();
        super::smooth_mismatch(&mut delta, &mask, w, h, ch, 7, 1000.0);
        assert!(started.elapsed() < std::time::Duration::from_secs(3), "took {:?}", started.elapsed());
        assert!(delta.iter().all(|value| value.is_finite()));
    }
}
