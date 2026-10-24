use photocraft_algo::{
    matting::{self, RefineParams},
    segment::{Sampler, SurfaceSampler},
    selection::Region,
};
use photocraft_engine::{
    doc::{Document, Layer, LayerContent, LayerMask, PixelFormat, Rect, Surface},
    Session,
};
use serde_json::{json, Value};

const MAX_POINTS: usize = 8192;
const MAX_STROKES: usize = 128;
const MAX_REGION: u64 = 16_777_216;
const MAX_WORK: u64 = 67_108_864;
const REPLAY: &str = "select.xdesignRefineEdge";

struct Stroke {
    points: Vec<[f64; 2]>,
    size: f64,
    erase: bool,
    area: Rect,
    segments: Vec<Rect>,
}

struct Composite<'a>(&'a Document);
impl Sampler for Composite<'_> {
    fn rgba(&self, rect: Rect) -> Vec<[f32; 4]> {
        photocraft_compose::render(self.0, rect).px
    }
}

fn pixels(rect: Rect) -> u64 {
    u64::from(rect.width().max(0) as u32) * u64::from(rect.height().max(0) as u32)
}

fn segment_rect(a: [f64; 2], b: [f64; 2], radius: f64, bounds: Rect) -> Rect {
    Rect::new(
        (a[0].min(b[0]) - radius - 1.0)
            .floor()
            .max(f64::from(bounds.x0)) as i32,
        (a[1].min(b[1]) - radius - 1.0)
            .floor()
            .max(f64::from(bounds.y0)) as i32,
        (a[0].max(b[0]) + radius + 1.0)
            .ceil()
            .min(f64::from(bounds.x1)) as i32,
        (a[1].max(b[1]) + radius + 1.0)
            .ceil()
            .min(f64::from(bounds.y1)) as i32,
    )
}

fn parse(params: &Value, bounds: Rect) -> Result<(RefineParams, Vec<Stroke>), String> {
    let fields = [
        ("radius", 0.0, 250.0),
        ("smooth", 0.0, 100.0),
        ("feather", 0.0, 1000.0),
        ("contrast", 0.0, 100.0),
        ("shiftEdge", -100.0, 100.0),
        ("amount", 0.0, 100.0),
    ];
    for (key, min, max) in fields {
        if let Some(value) = params.get(key) {
            if value
                .as_f64()
                .is_none_or(|v| !v.is_finite() || v < min || v > max)
            {
                return Err(format!("Invalid Select and Mask {key}"));
            }
        }
    }
    for key in ["smartRadius", "sampleAllLayers", "decontaminate"] {
        if params.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(format!("Invalid Select and Mask {key}"));
        }
    }
    let refine: RefineParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let brushes = params["edgeBrushes"]
        .as_array()
        .filter(|v| v.len() <= MAX_STROKES)
        .ok_or("Use at most 128 edge-refinement strokes")?;
    let mut strokes = Vec::new();
    let mut points_count = 0;
    let mut work = 0u64;
    for brush in brushes {
        let size = brush["size"]
            .as_f64()
            .filter(|v| v.is_finite() && *v >= 1.0 && *v <= 5000.0)
            .ok_or("Choose an edge brush size between 1 and 5000 pixels")?;
        let erase = brush
            .get("erase")
            .map(|v| v.as_bool().ok_or("Choose refine or erase refinements"))
            .transpose()?
            .unwrap_or(false);
        let values = brush["points"]
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or("Draw an edge-refinement stroke")?;
        points_count += values.len();
        if points_count > MAX_POINTS {
            return Err("Use at most 8192 edge brush points before applying".into());
        }
        let mut points = Vec::new();
        for value in values {
            let xy = value
                .as_array()
                .filter(|v| v.len() == 2)
                .ok_or("Invalid edge brush coordinates")?;
            let x = xy[0]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.0 && *v < f64::from(bounds.x1))
                .ok_or("Edge brush points must be inside the image")?;
            let y = xy[1]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.0 && *v < f64::from(bounds.y1))
                .ok_or("Edge brush points must be inside the image")?;
            points.push([x, y]);
        }
        let mut segments = Vec::new();
        let mut area = Rect::EMPTY;
        for index in 0..points.len().saturating_sub(1).max(1) {
            let a = points[index];
            let b = points[(index + 1).min(points.len() - 1)];
            let rect = segment_rect(a, b, size / 2.0, bounds);
            area = area.union(&rect);
            work = work
                .checked_add(pixels(rect))
                .ok_or("Edge brushing exceeds its work limit")?;
            segments.push(rect);
        }
        let local = RefineParams {
            radius: refine.radius.max((size / 2.0).min(250.0) as f32),
            ..refine
        };
        if pixels(area) > MAX_REGION
            || pixels(area.inflate(local.halo()).intersect(&bounds)) > MAX_REGION
            || work > MAX_WORK
        {
            return Err("This edge brush region exceeds the temporary refinement limit. Use shorter strokes or a smaller brush.".into());
        }
        strokes.push(Stroke {
            points,
            size,
            erase,
            area,
            segments,
        });
    }
    Ok((refine, strokes))
}

fn stencil(stroke: &Stroke) -> Vec<f32> {
    let width = stroke.area.width() as usize;
    let mut coverage = vec![0.0f32; width * stroke.area.height() as usize];
    for (index, rect) in stroke.segments.iter().enumerate() {
        let a = stroke.points[index];
        let b = stroke.points[(index + 1).min(stroke.points.len() - 1)];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let length = dx * dx + dy * dy;
        for y in rect.y0..rect.y1 {
            for x in rect.x0..rect.x1 {
                let px = f64::from(x) + 0.5;
                let py = f64::from(y) + 0.5;
                let t = if length > 0.0 {
                    ((px - a[0]) * dx + (py - a[1]) * dy) / length
                } else {
                    0.0
                }
                .clamp(0.0, 1.0);
                let distance = (px - a[0] - t * dx).hypot(py - a[1] - t * dy);
                let value = (stroke.size / 2.0 + 0.5 - distance).clamp(0.0, 1.0) as f32;
                let at = (y - stroke.area.y0) as usize * width + (x - stroke.area.x0) as usize;
                coverage[at] = coverage[at].max(value);
            }
        }
    }
    coverage
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    if command != REPLAY && (command != "select.refineEdge" || params.get("edgeBrushes").is_none())
    {
        return None;
    }
    Some(run(engine, params))
}

fn run(engine: &mut Session, params: &Value) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason("select.refineEdge") {
        return Err(reason);
    }
    let source = engine.active().ok_or("No image document")?.clone();
    let (refine, strokes) = parse(params, source.doc.bounds())?;
    let mut native = params.clone();
    native
        .as_object_mut()
        .ok_or("Invalid edge refinement options")?
        .remove("edgeBrushes");
    let mut output = native
        .get("output")
        .and_then(Value::as_str)
        .unwrap_or("selection")
        .to_owned();
    if !["selection", "layerMask", "newLayer", "newLayerWithMask"].contains(&output.as_str()) {
        return Err("Choose a supported Select and Mask output".into());
    }
    let decontaminate = params["decontaminate"].as_bool().unwrap_or(false);
    if decontaminate && ["selection", "layerMask"].contains(&output.as_str()) {
        output = "newLayerWithMask".into();
    }
    let mut isolated = Session::new();
    isolated.add_document((*source.doc).clone(), None);
    let mut draft = source.clone();
    draft.history = Default::default();
    draft.channel_view = Default::default();
    *isolated.active_mut().ok_or("No refinement preview")? = draft;
    super::color_views::Snapshot::capture(engine)?.install(&mut isolated)?;
    native["output"] = json!("selection");
    native["decontaminate"] = json!(false);
    isolated
        .execute("select.refineEdge", native)
        .map_err(|error| error.to_string())?;
    let baseline = isolated
        .active()
        .ok_or("No refinement preview")?
        .doc
        .selection
        .clone()
        .unwrap_or_else(|| Surface::new(PixelFormat::GRAY8));
    let mut combined = baseline.clone();
    let original = source
        .doc
        .selection
        .as_ref()
        .ok_or("Make a selection before refining its edges")?;
    let layer = source
        .active_layer
        .and_then(|id| source.doc.layer(id))
        .and_then(|layer| layer.surface());
    let composite = Composite(&source.doc);
    let surface = layer.map(SurfaceSampler);
    let sampler: &dyn Sampler = if params["sampleAllLayers"].as_bool().unwrap_or(false) {
        &composite
    } else {
        surface
            .as_ref()
            .map_or(&composite as &dyn Sampler, |value| value as &dyn Sampler)
    };
    for stroke in &strokes {
        let target = if stroke.erase {
            baseline.clone()
        } else {
            let local = RefineParams {
                radius: refine.radius.max((stroke.size / 2.0).min(250.0) as f32),
                ..refine
            };
            let region = matting::refine_mask(
                sampler,
                &matting::surface_reader(original),
                original.content_bounds(),
                stroke
                    .area
                    .inflate(local.halo())
                    .intersect(&source.doc.bounds()),
                &local,
            );
            region
                .as_ref()
                .map(matting::region_surface)
                .unwrap_or_else(|| Surface::new(PixelFormat::GRAY8))
        };
        let weights = stencil(stroke);
        let desired = target.read_region(stroke.area);
        let mut current = combined.read_region(stroke.area);
        for ((value, desired), weight) in current.iter_mut().zip(desired).zip(weights) {
            *value += (desired - *value) * weight;
        }
        combined.write_region(stroke.area, &current);
    }
    combined.prune();
    let selected = !combined.content_bounds().is_empty();
    let active = source.active_layer;
    let mut document = (*source.doc).clone();
    let mut next_active = active;
    let result = match output.as_str() {
        "selection" => {
            document.selection = selected.then_some(combined);
            json!({"output":output,"selected":document.selection.is_some()})
        }
        "layerMask" => {
            let id = active.ok_or("Select a layer for this output")?;
            document
                .layer_mut(id)
                .ok_or("Select a layer for this output")?
                .mask = Some(LayerMask {
                surface: combined,
                ..LayerMask::reveal_all()
            });
            document.selection = None;
            json!({"output":output,"layer":id.0,"selected":false})
        }
        _ => {
            let bbox = combined.content_bounds();
            let mut mask = Vec::with_capacity(pixels(bbox) as usize);
            for y in bbox.y0..bbox.y1 {
                let mut x = bbox.x0;
                while x < bbox.x1 {
                    let end = (x + 4096).min(bbox.x1);
                    mask.extend(
                        combined
                            .read_region(Rect::new(x, y, end, y + 1))
                            .iter()
                            .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8),
                    );
                    x = end;
                }
            }
            let region = Region { bbox, mask };
            let id = active.ok_or("Select a layer for this output")?;
            let original_layer = document.layer(id).ok_or("Select a layer for this output")?;
            let pixels = original_layer
                .surface()
                .ok_or("This output needs a layer with pixels")?;
            let pixels = if decontaminate {
                matting::decontaminate(
                    pixels,
                    &region,
                    refine.radius,
                    params["amount"].as_f64().unwrap_or(100.0) as f32,
                )
            } else {
                pixels.clone()
            };
            let name = format!("{} copy", original_layer.name);
            let (pixels, mask) = if output == "newLayerWithMask" {
                (
                    pixels,
                    Some(LayerMask {
                        surface: combined,
                        ..LayerMask::reveal_all()
                    }),
                )
            } else {
                (matting::masked_copy(&pixels, &region), None)
            };
            let mut layer = Layer::new(name, LayerContent::Raster(pixels));
            layer.mask = mask;
            let new_id = document.insert_above(Some(id), layer);
            document.layer_mut(id).ok_or("No source layer")?.visible = false;
            document.selection = None;
            next_active = Some(new_id);
            json!({"output":output,"layer":new_id.0,"selected":false})
        }
    };
    engine
        .edit("Select and Mask", |doc, active| {
            *doc = document;
            *active = next_active;
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    // Native playback rejects this host recipe instead of ignoring its brushes.
    engine.journal.push((REPLAY.into(), params.clone()));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{AlphaChannel, ColorMode, SampleType};

    fn fixture(depth: u32) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":48,"height":32,"depth":depth,"background":"#808080"}),
            )
            .unwrap();
        engine
            .edit("Edge fixture", |doc, active| {
                let mut data = Vec::new();
                for y in 0..32 {
                    for x in 0..48 {
                        let v = (x as f32 / 48.0 + y as f32 / 64.0).min(1.0);
                        data.extend([v, 0.35, v * 0.7, 1.0]);
                    }
                }
                doc.layer_mut(active.unwrap())
                    .unwrap()
                    .surface_mut()
                    .unwrap()
                    .write_region(Rect::new(0, 0, 48, 32), &data);
                doc.channels.push(AlphaChannel::new(
                    "Coverage",
                    Surface::with_default(
                        PixelFormat::new(ColorMode::Grayscale, SampleType::U16, false),
                        &[0.37],
                    ),
                ));
                Ok(())
            })
            .unwrap();
        engine
            .execute("select.rect", json!({"x":13,"y":7,"width":22,"height":18}))
            .unwrap();
        engine
            .execute("edit.assignProfile", json!({"profile":"display-p3"}))
            .unwrap();
        engine
    }

    #[test]
    fn selection_edge_brush_local_coverage_numeric_view_original_undo_and_host_replay() {
        let mut engine = fixture(16);
        let before = engine.active().unwrap().clone();
        engine.active_mut().unwrap().channel_view.target =
            photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
        let params = json!({"radius":0,"edgeBrushes":[{"points":[[13,10],[13,21]],"size":10,"erase":false}],"output":"selection"});
        execute(&mut engine, "select.refineEdge", &params)
            .unwrap()
            .unwrap();
        let after = engine.active().unwrap().doc.clone();
        let source = before.doc.selection.as_ref().unwrap();
        let result = after.selection.as_ref().unwrap();
        assert!(source != result);
        assert_eq!(after.layers, before.doc.layers);
        assert_eq!(after.channels, before.doc.channels);
        assert_eq!(after.icc_profile, before.doc.icc_profile);
        for y in 0..32 {
            for x in 0..48 {
                if !(7..19).contains(&x) || !(4..27).contains(&y) {
                    assert_eq!(source.pixel(x, y), result.pixel(x, y));
                }
            }
        }
        assert_eq!(
            engine.active().unwrap().history.past_len(),
            before.history.past_len() + 1
        );
        assert_eq!(
            engine.active().unwrap().channel_view.target,
            photocraft_engine::channel_cmds::ChannelTarget::Alpha(0)
        );
        assert_eq!(engine.journal.last().unwrap().0, REPLAY);
        let mut replay = Session::new();
        replay.add_document((*before.doc).clone(), None);
        *replay.active_mut().unwrap() = before.clone();
        super::super::execute_view_command(&mut replay, REPLAY, params.clone()).unwrap();
        assert!(&*replay.active().unwrap().doc == &*after);
        assert!(replay.execute(REPLAY, params).is_err());
        engine.execute("edit.undo", json!({})).unwrap();
        assert!(&*engine.active().unwrap().doc == &*before.doc);
        engine.execute("edit.redo", json!({})).unwrap();
        assert!(&*engine.active().unwrap().doc == &*after);
    }

    #[test]
    fn selection_edge_brush_covering_canvas_matches_native_radius_and_all_outputs_depths() {
        for depth in [8, 16, 32] {
            for output in ["selection", "layerMask", "newLayer", "newLayerWithMask"] {
                let mut actual = fixture(depth);
                let before = actual.active().unwrap().clone();
                let mut expected = Session::new();
                expected.add_document((*before.doc).clone(), None);
                *expected.active_mut().unwrap() = before.clone();
                expected
                    .execute(
                        "select.refineEdge",
                        json!({"radius":250,"output":output,"sampleAllLayers":true}),
                    )
                    .unwrap();
                execute(&mut actual,"select.refineEdge",&json!({"radius":0,"output":output,"sampleAllLayers":true,"edgeBrushes":[{"points":[[24,16]],"size":2000,"erase":false}]})).unwrap().unwrap();
                let mut oracle = (*expected.active().unwrap().doc).clone();
                if output.starts_with("newLayer") {
                    oracle.layers.last_mut().unwrap().id =
                        actual.active().unwrap().active_layer.unwrap();
                }
                assert!(
                    &*actual.active().unwrap().doc == &oracle,
                    "depth={depth},output={output}"
                );
                assert_eq!(
                    actual.active().unwrap().history.past_len(),
                    before.history.past_len() + 1
                );
            }
        }
    }

    #[test]
    fn selection_edge_brush_erasure_decontamination_preview_and_immutable_reopen() {
        let mut actual = fixture(32);
        let before = actual.active().unwrap().clone();
        let mut expected = Session::new();
        expected.add_document((*before.doc).clone(), None);
        *expected.active_mut().unwrap() = before.clone();
        expected
            .execute(
                "select.refineEdge",
                json!({"radius":3,"output":"selection"}),
            )
            .unwrap();
        let params = json!({"radius":3,"output":"selection","edgeBrushes":[{"points":[[13,10],[13,21]],"size":12,"erase":false},{"points":[[24,16]],"size":2000,"erase":true}]});
        execute(&mut actual, "select.refineEdge", &params)
            .unwrap()
            .unwrap();
        assert!(&*actual.active().unwrap().doc == &*expected.active().unwrap().doc);
        actual.execute("edit.undo", json!({})).unwrap();
        let params = json!({"radius":3,"output":"selection","decontaminate":true,"amount":42,"edgeBrushes":[{"points":[[13,10],[13,21]],"size":12,"erase":false}]});
        let preview = super::super::preview::render_with_selection_view(
            actual.active().unwrap(),
            "select.refineEdge",
            params.clone(),
            Some("result"),
        )
        .unwrap();
        let result = execute(&mut actual, "select.refineEdge", &params)
            .unwrap()
            .unwrap();
        assert_eq!(result["output"], "newLayerWithMask");
        let after = actual.active().unwrap().doc.clone();
        assert_eq!(
            preview.png,
            super::super::render_view_preview(&after, &Default::default())
                .unwrap()
                .png
        );
        let dir = std::env::temp_dir().join(format!("xdesign-edge-brush-{}", ulid::Ulid::new()));
        let mut session = super::super::PhotoSession {
            engine: actual,
            color_settings: None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        super::super::publish(&dir, &ulid::Ulid::new().to_string(), &mut session).unwrap();
        let mut reopened = super::super::restore(&dir, &session.version, None).unwrap();
        assert_eq!(
            super::super::reply(&dir, &ulid::Ulid::new().to_string(), &reopened, Vec::new())
                .unwrap()
                .state["features"]["selectionEdgeBrush"],
            true
        );
        assert!(&*reopened.engine.active().unwrap().doc == &*after);
        reopened.engine.execute("edit.undo", json!({})).unwrap();
        assert!(&*reopened.engine.active().unwrap().doc == &*before.doc);
        for name in ["edges.psd", "edges.psb", "edges.png"] {
            let exported = photocraft_io::export(&after, name, &Default::default()).unwrap();
            let imported = photocraft_io::import(name, &exported.bytes)
                .unwrap()
                .document;
            assert_eq!(imported.size, after.size);
            assert_eq!(imported.icc_profile, after.icc_profile);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selection_edge_brush_invalid_options_bounds_and_work_limit_do_not_mutate_source() {
        let mut engine = fixture(8);
        for params in [
            json!({"edgeBrushes":"bad"}),
            json!({"edgeBrushes":[{"size":0,"points":[[1,1]]}]}),
            json!({"edgeBrushes":[{"size":10,"points":[[48,2]]}]}),
            json!({"edgeBrushes":[{"size":10,"points":[[1,1,1]]}]}),
            json!({"edgeBrushes":[{"size":10,"erase":"bad","points":[[1,1]]}]}),
            json!({"output":"bad","edgeBrushes":[]}),
            json!({"radius":251,"edgeBrushes":[]}),
            json!({"sampleAllLayers":"bad","edgeBrushes":[]}),
            json!({"edgeBrushes":[{"size":10,"points":vec![[1,1];8193]}]}),
            json!({"edgeBrushes":vec![json!({"size":10,"points":[[1,1]]});129]}),
        ] {
            let before = engine.active().unwrap().clone();
            let journal = engine.journal.clone();
            assert!(execute(&mut engine, "select.refineEdge", &params)
                .unwrap()
                .is_err());
            assert!(std::sync::Arc::ptr_eq(
                &engine.active().unwrap().doc,
                &before.doc
            ));
            assert_eq!(engine.journal, journal);
            assert_eq!(
                engine.active().unwrap().history.past_len(),
                before.history.past_len()
            );
        }
        assert!(parse(
            &json!({"edgeBrushes":[{"size":5000,"points":[[3000,3000]]}]}),
            Rect::new(0, 0, 10000, 10000)
        )
        .is_err());
        assert!(execute(&mut engine, "select.refineEdge", &json!({"radius":3})).is_none());
    }
}
