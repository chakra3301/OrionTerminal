//! Patch Tool options the pinned engine has no parameter for: Normal mode's Diffusion, and the
//! Content-Aware mode with Structure, Color and Sample All Layers. The plan (selection, drag offset,
//! Source/Destination) follows PhotoCraft 47f9306f retouch_cmds/patch.rs, whose helpers are private.
use super::{admission, healing_options, healing_publish, healing_solve::heal_region_diffused, healing_sources::Sources, inpaint, poisson, BlendMode, CompleteParams, Document, Interrupt, LayerId, Rect, Region, SampleLayers, Session, Surface, Target};
use serde_json::Value;

const CMD: &str = "Patch Tool";
const MAX_PIXELS: u64 = 16 << 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Normal { diffusion: u8 },
    ContentAware { structure: u8, color: u8, all_layers: bool },
}

fn whole(params: &Value, key: &str, range: std::ops::RangeInclusive<u64>, default: u8) -> Result<u8, String> {
    let Some(value) = params.get(key).filter(|value| !value.is_null()) else { return Ok(default) };
    value
        .as_u64()
        .or_else(|| value.as_f64().filter(|value| value.fract() == 0.0 && *value >= 0.0).map(|value| value as u64))
        .filter(|value| range.contains(value))
        .map(|value| value as u8)
        .ok_or_else(|| format!("{CMD}: {key} must be a whole number from {} to {}", range.start(), range.end()))
}

fn kind(params: &Value) -> Result<Kind, String> {
    let diffusion = healing_options::diffusion("paint.patch", params)?;
    let structure = whole(params, "structure", 1..=7, 4)?;
    let color = whole(params, "colorAdaptation", 0..=10, 0)?;
    let all_layers = match params.get("sampleAllLayers") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err(format!("{CMD}: sampleAllLayers must be true or false")),
    };
    match params.get("type") {
        None | Some(Value::Null) => Ok(Kind::Normal { diffusion }),
        Some(Value::String(value)) if value == "normal" => Ok(Kind::Normal { diffusion }),
        Some(Value::String(value)) if value == "contentAware" => Ok(Kind::ContentAware { structure, color, all_layers }),
        Some(Value::String(value)) => Err(format!("{CMD}: unknown type \"{value}\" (normal, contentAware)")),
        Some(_) => Err(format!("{CMD}: type must be a string")),
    }
}

/// Whether `params` need the host patch; every option is validated first.
pub(super) fn host_only(params: &Value) -> Result<bool, String> {
    Ok(kind(params)? != Kind::Normal { diffusion: 5 })
}

struct Plan {
    layer: LayerId,
    area: Rect,
    dst_shift: (i32, i32),
    src_shift: (i32, i32),
    destination: bool,
}

fn plan(engine: &Session, params: &Value) -> Result<Plan, String> {
    let destination = match params.get("mode").and_then(Value::as_str).unwrap_or("source") {
        "source" => false,
        "destination" => true,
        other => return Err(format!("{CMD}: unknown mode \"{other}\" (source, destination)")),
    };
    let offset = params["offset"].as_array().filter(|offset| offset.len() >= 2).and_then(|offset| Some((offset[0].as_f64()?, offset[1].as_f64()?))).ok_or_else(|| format!("{CMD}: missing offset ([dx, dy])"))?;
    if [offset.0, offset.1].iter().any(|value| !value.is_finite() || value.abs() >= 1e7) {
        return Err(format!("{CMD}: offset must be two finite numbers"));
    }
    let (dx, dy) = (offset.0.round() as i32, offset.1.round() as i32);
    if params.get("target").is_some_and(|target| !target.is_null() && target != "pixels") {
        return Err(format!("{CMD}: Diffusion and Content-Aware patch layer pixels only"));
    }
    let state = engine.active().ok_or("No image document")?;
    let layer = params["layer"].as_u64().map(LayerId).or(state.active_layer).ok_or("No active layer")?;
    let canvas = state.doc.bounds();
    let selection = state.doc.selection.as_ref().ok_or_else(|| format!("{CMD}: select the area to patch first"))?;
    let outside = selection.default_pixel().first().copied().unwrap_or(0.0);
    let area = if outside > 0.0 { canvas } else { selection.content_bounds().intersect(&canvas) };
    if area.is_empty() {
        return Err(format!("{CMD}: the selection is empty"));
    }
    let pixels = u64::from(area.width()) * u64::from(area.height());
    if pixels > MAX_PIXELS {
        return Err(format!("{CMD}: the selection is too large to patch ({pixels} pixels, at most {MAX_PIXELS})"));
    }
    if (dx, dy) == (0, 0) {
        return Err(format!("{CMD}: drag the selection to the area to sample from"));
    }
    if !canvas.contains_rect(&area.translate(dx, dy)) {
        return Err(format!("{CMD}: the dragged patch must stay inside the canvas"));
    }
    let (dst_shift, src_shift) = if destination { ((dx, dy), (-dx, -dy)) } else { ((0, 0), (dx, dy)) };
    Ok(Plan { layer, area, dst_shift, src_shift, destination })
}

fn coverage(selection: &Surface, rect: Rect) -> Vec<f32> {
    let n = selection.channels().max(1);
    selection.read_region(rect).chunks_exact(n).map(|px| px[0].clamp(0.0, 1.0)).collect()
}

/// The patched document, its damage and the history label.
pub(super) fn patch(engine: &Session, params: &Value, ctl: &Interrupt) -> Result<(Document, Rect, &'static str), String> {
    let kind = kind(params)?;
    let plan = plan(engine, params)?;
    let state = engine.active().ok_or("No image document")?;
    let pre = &state.doc;
    let selection = pre.selection.as_ref().ok_or_else(|| format!("{CMD}: select the area to patch first"))?;
    let canvas = pre.bounds();
    let mut doc = (**pre).clone();
    let locked = Target::Pixels(plan.layer).surface(&mut doc)?.1;
    let surface = pre.layer(plan.layer).and_then(|layer| layer.surface()).ok_or("Not a pixel layer")?;
    let fmt = surface.format();
    let dst_area = plan.area.translate(plan.dst_shift.0, plan.dst_shift.1);
    let (sx, sy) = plan.src_shift;
    let mut sources = Sources::default();
    let which = if matches!(kind, Kind::ContentAware { all_layers: true, .. }) { SampleLayers::All } else { SampleLayers::Current };
    let read = |rect: Rect, sources: &mut Sources| if which == SampleLayers::Current { sources.read(surface, rect, ctl) } else { sources.compose(pre, Some(plan.layer), which, rect, fmt, ctl) };
    // As native: the repaired area plus a two-pixel Dirichlet ring, where both it and its texture lie on the canvas.
    let ring = dst_area.inflate(2).intersect(&canvas).intersect(&canvas.translate(-sx, -sy));
    if ring.is_empty() {
        return Ok((doc, Rect::EMPTY, label(&plan)));
    }
    let dst = read(ring, &mut sources)?;
    let mut src = read(ring.translate(sx, sy), &mut sources)?;
    src.rect = ring;
    let cov = coverage(selection, ring.translate(-plan.dst_shift.0, -plan.dst_shift.1));
    let mask: Vec<bool> = cov.iter().map(|value| *value > 0.0).collect();
    let scale = plan.area.width().min(plan.area.height()) as f32;
    let published = match kind {
        Kind::Normal { diffusion } => {
            let healed = heal_region_diffused(&fmt, &src, &dst, &mask, diffusion, scale, ctl)?;
            let (surface, _) = Target::Pixels(plan.layer).surface(&mut doc)?;
            healing_publish::apply(surface, ring, &cov, ring, 1.0, None, locked, &healed, BlendMode::Normal, ctl)?
        }
        Kind::ContentAware { structure, color, .. } => {
            let context = dst_area.inflate(band(structure, scale) as i32 + 12).intersect(&canvas);
            let mut placed = read(context, &mut sources)?;
            let solved = heal_region_diffused(&fmt, &src, &dst, &mask, 5, scale, ctl)?;
            let healed = healing_publish::PaintSource::patch(&solved, ring, ctl)?.into_owned();
            drop(solved);
            let weight = f32::from(color) / 10.0;
            let (w, n) = (ring.width() as usize, placed.ch);
            for (i, inside) in mask.iter().enumerate() {
                if *inside {
                    let (x, y) = (ring.x0 + (i % w) as i32, ring.y0 + (i / w) as i32);
                    let (s, h, p) = (src.index(x, y) * n, healed.index(x, y) * n, placed.index(x, y) * n);
                    for c in 0..n {
                        placed.data[p + c] = src.data[s + c] + weight * (healed.data[h + c] - src.data[s + c]);
                    }
                }
            }
            drop((src, dst, healed));
            let context_cov = coverage(selection, context.translate(-plan.dst_shift.0, -plan.dst_shift.1));
            let hole: Vec<bool> = context_cov.iter().map(|value| *value > 0.0).collect();
            let (w, h) = (context.width() as usize, context.height() as usize);
            let reach = band(structure, scale);
            let seam: Vec<bool> = healing_options::edge_distance(&hole, w, h).into_iter().zip(&hole).map(|(distance, inside)| *inside && distance <= reach).collect();
            let seed = match params.get("seed") {
                None | Some(Value::Null) => 1,
                Some(value) => value.as_u64().ok_or_else(|| format!("{CMD}: seed must be a whole number"))?,
            };
            let fill = CompleteParams { seed, ..CompleteParams::default() };
            admission::check(ctl)?;
            let synthesized = match inpaint::complete_with(w, h, n, &placed.data, &seam, &fill, ctl).map_err(|_| "The patch was canceled".to_string())? {
                Some(pixels) => pixels,
                None => poisson::membrane_fill_with(w, h, n, &placed.data, &seam, ctl).map_err(|_| "The patch was canceled".to_string())?,
            };
            let result = Region { rect: context, ch: n, data: synthesized };
            let (surface, _) = Target::Pixels(plan.layer).surface(&mut doc)?;
            healing_publish::apply(surface, context, &context_cov, context, 1.0, None, locked, &result, BlendMode::Normal, ctl)?
        }
    };
    Ok((doc, published.damage, label(&plan)))
}

/// Structure 7 keeps the dragged texture to within a pixel of the edge; lower values re-synthesize
/// a wider seam from the surroundings.
fn band(structure: u8, scale: f32) -> f32 {
    (scale * f32::from(8 - structure) / 32.0).round().max(1.0)
}

fn label(plan: &Plan) -> &'static str {
    if plan.destination { "Patch (Destination)" } else { "Patch" }
}

#[cfg(test)]
mod tests {
    use photocraft_engine::{doc::{Document, LayerId}, Session};
    use photocraft_raster::Interrupt;
    use serde_json::{json, Value};
    use std::sync::Arc;

    /// Tan on the left, cyan on the right, with a dark line across the tan patch area.
    fn image() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 96, "height": 64, "depth": 32, "mode": "rgb", "background": "#806040"})).unwrap();
        engine.execute("select.rect", json!({"x": 56, "y": 0, "width": 40, "height": 64})).unwrap();
        engine.execute("edit.fill", json!({"color": "#20b0c0"})).unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        engine.execute("paint.stroke", json!({"points": [[20, 12], [20, 52]], "size": 3, "hardness": 100, "color": "#202020", "seed": 2})).unwrap();
        engine.execute("select.rect", json!({"x": 8, "y": 16, "width": 32, "height": 32})).unwrap();
        engine
    }
    fn layer(engine: &Session) -> LayerId {
        engine.active().unwrap().active_layer.unwrap()
    }
    fn px(doc: &Document, layer: LayerId, x: i32, y: i32) -> [f32; 4] {
        doc.layer(layer).unwrap().surface().unwrap().rgba(x, y)
    }
    fn pixels(doc: &Document, layer: LayerId) -> Vec<f32> {
        doc.layer(layer).unwrap().surface().unwrap().read_region(doc.bounds())
    }
    fn patch(engine: &Session, extra: Value) -> Result<Document, String> {
        let mut params = json!({"offset": [56, 0], "seed": 3});
        params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        super::patch(engine, &params, &Interrupt::NONE).map(|(doc, _, _)| doc)
    }

    #[test]
    fn normal_patch_diffusion_five_is_native_and_other_values_change_it() {
        let engine = image();
        let layer = layer(&engine);
        for mode in ["source", "destination"] {
            let params = json!({"offset": if mode == "source" { json!([56, 0]) } else { json!([48, 0]) }, "mode": mode});
            let mut native = Session::new();
            native.add_document((*engine.active().unwrap().doc).clone(), None);
            *native.active_mut().unwrap() = engine.active().unwrap().clone();
            native.execute("paint.patch", params.clone()).unwrap();
            let (host, _, label) = super::patch(&engine, &params, &Interrupt::NONE).unwrap();
            assert_eq!(pixels(&host, layer), pixels(&native.active().unwrap().doc, layer), "{mode}");
            assert_eq!(label, if mode == "source" { "Patch" } else { "Patch (Destination)" });
        }
        assert!(!super::host_only(&json!({"offset": [56, 0], "diffusion": 5})).unwrap());
        let native = pixels(&patch(&engine, json!({})).unwrap(), layer);
        for diffusion in [1, 3, 6, 7] {
            assert!(super::host_only(&json!({"diffusion": diffusion})).unwrap());
            assert_ne!(pixels(&patch(&engine, json!({"diffusion": diffusion})).unwrap(), layer), native, "{diffusion}");
        }
        let blue = |diffusion: u8| px(&patch(&engine, json!({"diffusion": diffusion})).unwrap(), layer, 30, 32)[2];
        assert!(blue(1) > blue(5) + 0.1, "low diffusion keeps more of the cyan texture: {} vs {}", blue(1), blue(5));
    }

    #[test]
    fn content_aware_color_and_structure_shape_the_patch() {
        let engine = image();
        let layer = layer(&engine);
        let original = engine.active().unwrap().doc.clone();
        let cyan = px(&original, layer, 80, 32);
        let ca = |structure: u8, color: u8| patch(&engine, json!({"type": "contentAware", "structure": structure, "colorAdaptation": color})).unwrap();
        let (plain, adapted) = (ca(4, 0), ca(4, 10));
        let centre = |doc: &Document| px(doc, layer, 26, 32);
        assert!((centre(&plain)[2] - cyan[2]).abs() < 0.02, "Color 0 keeps the dragged colour: {:?}", centre(&plain));
        assert!(centre(&adapted)[2] < cyan[2] - 0.2, "Color 10 adapts it to the tan surround: {:?}", centre(&adapted));
        let (strict, loose) = (ca(7, 0), ca(1, 0));
        let seam = |doc: &Document| (10..16).map(|x| (px(doc, layer, x, 32)[2] - cyan[2]).abs()).sum::<f32>();
        assert!(seam(&loose) > seam(&strict) + 0.3, "low Structure re-synthesizes a wider seam: {} vs {}", seam(&loose), seam(&strict));
        assert_eq!(px(&plain, layer, 4, 4), px(&original, layer, 4, 4), "outside the selection is untouched");
        assert_eq!(pixels(&ca(4, 0), layer), pixels(&plain, layer), "deterministic");
    }

    #[test]
    fn content_aware_sample_all_layers_patches_an_empty_layer() {
        let mut engine = image();
        engine.execute("layer.new.layer", json!({"name": "Patch"})).unwrap();
        let layer = layer(&engine);
        let all = patch(&engine, json!({"type": "contentAware", "sampleAllLayers": true})).unwrap();
        assert!(px(&all, layer, 26, 32)[3] > 0.99);
        let current = patch(&engine, json!({"type": "contentAware"})).unwrap();
        assert!(px(&current, layer, 26, 32)[3] < 0.01);
    }

    #[test]
    fn patch_options_reject_bad_values() {
        let engine = image();
        for (extra, needle) in [
            (json!({"type": "magic"}), "unknown type \"magic\""),
            (json!({"type": 1}), "type must be a string"),
            (json!({"diffusion": 0}), "diffusion must be a whole number from 1 to 7"),
            (json!({"type": "contentAware", "structure": 0}), "structure must be a whole number from 1 to 7"),
            (json!({"type": "contentAware", "structure": 8}), "structure"),
            (json!({"type": "contentAware", "structure": 2.5}), "structure"),
            (json!({"type": "contentAware", "colorAdaptation": 11}), "colorAdaptation must be a whole number from 0 to 10"),
            (json!({"type": "contentAware", "colorAdaptation": -1}), "colorAdaptation"),
            (json!({"type": "contentAware", "seed": "x"}), "seed must be a whole number"),
            (json!({"type": "contentAware", "sampleAllLayers": "yes"}), "sampleAllLayers must be true or false"),
            (json!({"type": "contentAware", "target": "mask"}), "layer pixels only"),
            (json!({"type": "contentAware", "offset": [0, 0]}), "drag the selection"),
            (json!({"type": "contentAware", "offset": [90, 0]}), "inside the canvas"),
        ] {
            let error = patch(&engine, extra.clone()).map(|_| ()).unwrap_err();
            assert!(error.contains(needle), "{extra}: {error}");
        }
        let mut empty = image();
        empty.execute("select.deselect", json!({})).unwrap();
        assert!(patch(&empty, json!({"type": "contentAware"})).unwrap_err().contains("select the area"));
    }

    #[test]
    fn host_patch_commits_one_history_step_and_previews_the_same_pixels() {
        let mut engine = image();
        let layer = layer(&engine);
        let params = json!({"offset": [56, 0], "type": "contentAware", "colorAdaptation": 5, "seed": 3});
        let expected = patch(&engine, json!({"colorAdaptation": 5, "type": "contentAware"})).unwrap();
        let (preview, damage) = super::super::super::patch_preview(&engine, &params, 262_144, 1).unwrap();
        assert_eq!(pixels(&preview, layer), pixels(&expected, layer));
        assert!(!damage.is_empty());
        let past = engine.active().unwrap().history.past_len();
        super::super::super::super::execute_view_command(&mut engine, "paint.patch", params.clone()).unwrap();
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Patch")));
        assert_eq!(pixels(&state.doc, layer), pixels(&expected, layer));
        assert_eq!(engine.journal.last().unwrap().0, "paint.patch");
        assert!(engine.is_enabled("edit.fade"));
        let before = engine.active().unwrap().doc.clone();
        assert!(super::super::super::super::execute_view_command(&mut engine, "paint.patch", json!({"offset": [56, 0], "type": "contentAware", "structure": 9})).is_err());
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        assert!(super::super::super::host_retouch(&mut engine, "paint.patch", &json!({"offset": [56, 0]})).is_none(), "plain Normal stays native");
    }
}
