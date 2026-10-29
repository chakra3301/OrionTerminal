//! Brush and Pencil Behind and Clear modes, which the pinned engine's blend list lacks
//! (photocraft color/src/blend.rs:11-41; `with_blend_mode` keeps the brush mode for unknown names).
//! Clear is the engine's erase with the tool's brush; Behind strokes Normal onto an emptied copy of the
//! layer and shows the original layer over that paint. Both live in `BrushDraft`, so the feedback and
//! every commit route draw the same pixels.
use photocraft_engine::{brush_cmds::{parse_points, resolve_brush}, channel_cmds::ChannelTarget,
    doc::{Document, LayerId, Rect, Surface}, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const NO_TRANSPARENCY: &str = "Behind and Clear need a layer whose transparency is not locked";

#[derive(Clone, Copy, PartialEq)]
enum Mode { Behind, Clear }

/// Behind or Clear on the Brush or Pencil. The Eraser (`erase`) keeps the engine route, which has no blend mode.
fn requested(command: &str, params: &Value) -> Option<Mode> {
    if !matches!(command, "paint.stroke" | "paint.pencil") || params["erase"] == true {
        return None;
    }
    match params["mode"].as_str()?.to_ascii_lowercase().as_str() {
        "behind" => Some(Mode::Behind),
        "clear" => Some(Mode::Clear),
        _ => None,
    }
}

pub(super) fn applies(command: &str, params: &Value) -> bool {
    requested(command, params).is_some()
}

/// A Behind or Clear stroke about to start: its history label and, for Behind, the session to stroke instead.
pub(super) struct Start {
    pub label: &'static str,
    pub scratch: Option<Session>,
    layer: LayerId,
}

/// Checks the target and rewrites `effective` (the draft's params, target already resolved) for the engine.
pub(super) fn begin(engine: &Session, command: &str, effective: &mut Value) -> Result<Option<Start>, String> {
    let Some(mode) = requested(command, effective) else { return Ok(None) };
    let (tool, label) = if command == "paint.pencil" { ("Pencil", "Pencil") } else { ("Brush", "Brush Tool") };
    let state = engine.active().ok_or("No image document")?;
    // Photoshop greys both modes out wherever there is no transparency to paint behind or clear.
    if effective.get("target").is_some_and(|target| target != "pixels") || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err(format!("{tool}: Behind and Clear need a pixel layer; masks and channels have no transparency"));
    }
    let layer = effective["layer"].as_u64().map(LayerId).or(state.active_layer).ok_or_else(|| format!("{tool}: select a layer"))?;
    let target = state.doc.layer(layer).ok_or_else(|| format!("{tool}: the layer no longer exists"))?;
    if target.locks.pixels || target.locks.all {
        return Err(format!("{tool}: the layer \"{}\" is locked", target.name));
    }
    let surface = target.surface().filter(|surface| surface.format().alpha && !target.locks.transparency).ok_or_else(|| format!("{tool}: {NO_TRANSPARENCY}"))?;
    let invalid = || format!("{tool}: invalid stroke parameters");
    if mode == Mode::Clear {
        let object = effective.as_object_mut().ok_or_else(invalid)?;
        object.remove("mode");
        object.insert("erase".into(), json!(true));
        return Ok(Some(Start { label, scratch: None, layer }));
    }
    let mut scratch = Session::new();
    scratch.add_document(Document::new(label, state.doc.size, state.doc.mode, state.doc.depth), None);
    let mut emptied = state.clone();
    *Arc::make_mut(&mut emptied.doc).layer_mut(layer).and_then(|layer| layer.surface_mut()).ok_or_else(invalid)? = Surface::new(surface.format());
    *scratch.active_mut().ok_or("No image document")? = emptied;
    scratch.tools = engine.tools.clone();
    scratch.presets = engine.presets.clone();
    scratch.patterns = engine.patterns.clone();
    // Auto Erase picks the colour from the layer under the first sample, which the emptied copy lacks.
    if command == "paint.pencil" && effective["autoErase"] == true {
        let color = resolve_brush(engine, effective, command).map_err(|error| error.to_string())?.color;
        let first = parse_points(effective, command).map_err(|error| error.to_string())?.first().map(|point| surface.rgba(point.x.floor() as i32, point.y.floor() as i32));
        let object = effective.as_object_mut().ok_or_else(invalid)?;
        if first.is_some_and(|under| under[3] > 0.0 && (0..3).all(|c| (under[c] - color[c]).abs() < 1.5 / 255.0)) {
            object.remove("color");
            scratch.tools.foreground = engine.tools.background;
        }
        object.remove("autoErase");
    }
    effective["mode"] = json!("normal");
    Ok(Some(Start { label, scratch: Some(scratch), layer }))
}

impl Start {
    /// The Behind view of a scratch stroke so far (`None` for Clear, which strokes the document itself).
    pub fn behind(self, source: &Arc<Document>, paint: &Document, damage: Rect) -> Option<Behind> {
        self.scratch.as_ref()?;
        let mut behind = Behind { layer: self.layer, shown: source.clone(), painted: Rect::EMPTY };
        behind.update(source, paint, damage);
        Some(behind)
    }
}

/// The original layer over the paint the scratch stroke has laid so far.
pub(super) struct Behind {
    layer: LayerId,
    shown: Arc<Document>,
    /// Where `shown` may differ from the original layer.
    painted: Rect,
}

impl Behind {
    pub fn document(&self) -> Arc<Document> {
        self.shown.clone()
    }

    /// Recomposites `damage`, where the scratch stroke changed (its smoothing tail is redrawn, so paint can also go away).
    pub fn update(&mut self, source: &Document, paint: &Document, damage: Rect) {
        let (Some(original), Some(paint)) = (source.layer(self.layer).and_then(|layer| layer.surface()), paint.layer(self.layer).and_then(|layer| layer.surface())) else { return };
        let channels = original.format().channels();
        let alpha = channels - 1;
        for y in (damage.y0..damage.y1).step_by(256) {
            let part = Rect::new(damage.x0, y, damage.x1, (y + 256).min(damage.y1));
            let (mut out, painted) = (original.read_region(part), paint.read_region(part));
            let mut changed = false;
            for (pixel, paint) in out.chunks_exact_mut(channels).zip(painted.chunks_exact(channels)) {
                let (below, cover) = (pixel[alpha], paint[alpha]);
                if cover <= 0.0 || below >= 1.0 {
                    continue;
                }
                let a = below + cover * (1.0 - below);
                for c in 0..alpha {
                    pixel[c] = (pixel[c] * below + paint[c] * cover * (1.0 - below)) / a;
                }
                pixel[alpha] = a;
                changed = true;
            }
            if !changed && part.intersect(&self.painted).is_empty() {
                continue;
            }
            if let Some(surface) = Arc::make_mut(&mut self.shown).layer_mut(self.layer).and_then(|layer| layer.surface_mut()) {
                surface.write_region(part, &out);
            }
            if changed {
                self.painted = self.painted.union(&part);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use photocraft_engine::doc::{Color, ColorMode, Document, Layer, Rect, SampleType, Size};
    use photocraft_engine::Session;
    use serde_json::{json, Value};

    const WIDTH: u32 = 48;
    const HEIGHT: u32 = 16;

    /// Opaque red at x < 16, half-transparent green at 16..32, transparent beyond.
    fn session() -> Session {
        let mut doc = Document::new("Paint modes", Size::new(WIDTH, HEIGHT), ColorMode::Rgb, SampleType::F32);
        let mut layer = Layer::raster("Layer 1", doc.pixel_format());
        let surface = layer.surface_mut().unwrap();
        surface.fill_rect(Rect::new(0, 0, 16, HEIGHT as i32), &[1.0, 0.0, 0.0, 1.0]);
        surface.fill_rect(Rect::new(16, 0, 32, HEIGHT as i32), &[0.0, 1.0, 0.0, 0.5]);
        doc.layers.push(layer);
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine
    }
    fn twin(engine: &Session) -> Session {
        let state = engine.active().unwrap().clone();
        let mut twin = Session::new();
        twin.add_document((*state.doc).clone(), None);
        *twin.active_mut().unwrap() = state;
        twin.tools = engine.tools.clone();
        twin
    }
    fn stroke(mode: &str) -> Value {
        json!({"points": [[2, 8], [12, 8], [24, 8], [36, 8], [46, 8]], "size": 8, "hardness": 1, "opacity": 0.6, "color": "#0000ff", "seed": 7, "mode": mode})
    }
    fn pixels(engine: &Session) -> Vec<f32> {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().read_region(state.doc.bounds())
    }
    fn px(engine: &Session, x: i32, y: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, y)
    }
    fn near(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= 1e-3)
    }
    fn run(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, command, params.clone())
    }
    fn label(engine: &Session) -> (usize, Option<String>) {
        let history = &engine.active().unwrap().history;
        (history.past_len(), history.undo_label().map(str::to_owned))
    }
    /// The stroke at Normal on an emptied copy of the layer: each pixel's paint colour and coverage.
    fn paint(engine: &Session, command: &str) -> Vec<f32> {
        let mut empty = twin(engine);
        let layer = empty.active().unwrap().active_layer.unwrap();
        empty.edit("Empty", |doc, _| { let bounds = doc.bounds(); doc.layer_mut(layer).unwrap().surface_mut().unwrap().fill_rect(bounds, &[0.0; 4]); Ok(()) }).unwrap();
        empty.execute(command, stroke("Normal")).unwrap();
        pixels(&empty)
    }

    #[test]
    fn clear_erases_by_the_brush_coverage_as_one_tool_step() {
        for (command, tool) in [("paint.stroke", "Brush Tool"), ("paint.pencil", "Pencil")] {
            let mut engine = session();
            let before = pixels(&engine);
            let (past, _) = label(&engine);
            let mut expected = twin(&engine);
            let mut erase = stroke("Normal");
            erase.as_object_mut().unwrap().remove("mode");
            erase["erase"] = json!(true);
            expected.execute(command, erase).unwrap();
            run(&mut engine, command, &stroke("clear")).unwrap();
            assert_eq!(pixels(&engine), pixels(&expected), "{command}");
            assert!(near(px(&engine, 24, 8), [0.0, 1.0, 0.0, 0.5 * 0.4]), "{command}: {:?}", px(&engine, 24, 8));
            assert!(near(px(&engine, 40, 8), [0.0; 4]), "{command}: {:?}", px(&engine, 40, 8));
            assert_eq!(px(&engine, 8, 0), [1.0, 0.0, 0.0, 1.0], "{command}");
            assert_eq!(label(&engine), (past + 1, Some(tool.to_owned())), "{command}");
            assert_eq!(engine.journal.last(), Some(&(command.to_owned(), stroke("clear"))), "{command}");
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(pixels(&engine), before, "{command}");
        }
    }

    #[test]
    fn behind_paints_only_where_the_layer_is_transparent() {
        for (command, tool) in [("paint.stroke", "Brush Tool"), ("paint.pencil", "Pencil")] {
            let mut engine = session();
            let (past, _) = label(&engine);
            let original = pixels(&engine);
            let paint = paint(&engine, command);
            run(&mut engine, command, &stroke("Behind")).unwrap();
            let actual = pixels(&engine);
            for ((d, p), out) in original.chunks_exact(4).zip(paint.chunks_exact(4)).zip(actual.chunks_exact(4)) {
                let a = d[3] + p[3] * (1.0 - d[3]);
                let expected: Vec<f32> = if a <= 0.0 { d.to_vec() } else { (0..3).map(|c| (d[c] * d[3] + p[c] * p[3] * (1.0 - d[3])) / a).chain([a]).collect() };
                assert!(expected.iter().zip(out).all(|(e, o)| (e - o).abs() <= 1e-5), "{command}: {d:?} under {p:?} gave {out:?}");
            }
            assert_eq!(px(&engine, 8, 8), [1.0, 0.0, 0.0, 1.0], "{command}");
            assert!(near(px(&engine, 40, 8), [0.0, 0.0, 1.0, 0.6]), "{command}: {:?}", px(&engine, 40, 8));
            assert!(near(px(&engine, 24, 8), [0.0, 0.625, 0.375, 0.8]), "{command}: {:?}", px(&engine, 24, 8));
            assert_eq!(label(&engine), (past + 1, Some(tool.to_owned())), "{command}");
        }
    }

    #[test]
    fn live_feedback_commits_the_previewed_behind_and_clear_pixels() {
        for command in ["paint.stroke", "paint.pencil"] {
            for mode in ["Behind", "Clear"] {
                let mut engine = session();
                let mut reference = twin(&engine);
                let full = stroke(mode);
                let mut first = full.clone();
                first["points"] = json!(full["points"].as_array().unwrap()[..2]);
                let identity = format!("paint-modes-{}", ulid::Ulid::new());
                let source = engine.active().unwrap().doc.clone();
                super::super::stroke::render_with_identity(&engine, Some(&identity), command, &first, 0, 0, 0, 0, 1).unwrap();
                super::super::stroke::render_with_identity(&engine, Some(&identity), command, &full, 0, 0, 0, 0, 1).unwrap();
                assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc), "{command}/{mode}");
                let live = super::super::stroke::commit_feedback(&mut engine, &identity, command, &full).expect("the live draft commits").unwrap();
                let direct = run(&mut reference, command, &full).unwrap();
                assert_eq!(live, direct, "{command}/{mode}");
                assert_eq!(pixels(&engine), pixels(&reference), "{command}/{mode}");
                assert_eq!(label(&engine), label(&reference), "{command}/{mode}");
                assert!((px(&engine, 8, 8)[3] - if mode == "Behind" { 1.0 } else { 0.4 }).abs() <= 1e-5, "{command}/{mode}");
                super::super::stroke::release(&identity, 7).unwrap();
            }
        }
    }

    #[test]
    fn behind_and_clear_refuse_layers_without_free_transparency() {
        let mut background = Session::new();
        background.add_document(Document::with_background("Paint modes", Size::new(WIDTH, HEIGHT), ColorMode::Rgb, SampleType::F32, Color::WHITE), None);
        let mut cases: Vec<(Session, Value, &str)> = vec![(background, json!({}), "Behind and Clear need a layer whose transparency is not locked")];
        let mut locked = session();
        let layer = locked.active().unwrap().active_layer.unwrap();
        locked.edit("Lock", |doc, _| { doc.layer_mut(layer).unwrap().locks.transparency = true; Ok(()) }).unwrap();
        cases.push((locked, json!({}), "Behind and Clear need a layer whose transparency is not locked"));
        let mut pixels_locked = session();
        pixels_locked.edit("Lock", |doc, _| { doc.layer_mut(layer_of(doc)).unwrap().locks.pixels = true; Ok(()) }).unwrap();
        cases.push((pixels_locked, json!({}), "the layer \"Layer 1\" is locked"));
        let mut masked = session();
        masked.execute("layer.layerMask.revealAll", json!({})).unwrap();
        cases.push((masked, json!({"target": "mask"}), "need a pixel layer"));
        cases.push((session(), json!({"target": {"channel": 0}}), "need a pixel layer"));
        for (engine, extra, message) in &mut cases {
            for (command, tool) in [("paint.stroke", "Brush"), ("paint.pencil", "Pencil")] {
                for mode in ["Behind", "Clear"] {
                    let mut params = stroke(mode);
                    params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
                    let before = engine.active().unwrap().doc.clone();
                    let error = run(engine, command, &params).unwrap_err();
                    assert!(error.starts_with(&format!("{tool}: ")) && error.contains(*message), "{command}/{mode}/{extra}: {error}");
                    let identity = format!("paint-modes-{}", ulid::Ulid::new());
                    let live = super::super::stroke::render_with_identity(engine, Some(&identity), command, &params, 0, 0, 0, 0, 1).err();
                    assert_eq!(live.as_ref(), Some(&error), "{command}/{mode}/{extra}");
                    assert!(std::sync::Arc::ptr_eq(&before, &engine.active().unwrap().doc), "{command}/{mode}/{extra}");
                }
            }
        }
    }

    fn layer_of(doc: &Document) -> photocraft_engine::doc::LayerId {
        doc.layers.last().unwrap().id
    }

    #[test]
    fn the_eraser_keeps_its_own_route_and_auto_erase_reads_the_original_pixels() {
        let mut engine = session();
        let mut expected = twin(&engine);
        let mut erase = stroke("Behind");
        erase["erase"] = json!(true);
        expected.execute("paint.stroke", erase.clone()).unwrap();
        run(&mut engine, "paint.stroke", &erase).unwrap();
        assert_eq!(pixels(&engine), pixels(&expected));
        assert_eq!(label(&engine).1.as_deref(), Some("Eraser"));

        // Auto Erase starts on a foreground-coloured pixel, so the Pencil paints the background colour behind.
        let mut engine = session();
        let mut params = stroke("Behind");
        params["points"] = json!([[20, 8], [46, 8]]);
        params["color"] = json!("#00ff00");
        params["autoErase"] = json!(true);
        run(&mut engine, "paint.pencil", &params).unwrap();
        let background = engine.tools.background;
        assert!(near(px(&engine, 40, 8), [background[0], background[1], background[2], 0.6]), "{:?}", px(&engine, 40, 8));
        let behind = |c: usize| (if c == 1 { 0.5 } else { 0.0 } + background[c] * 0.3) / 0.8;
        assert!(near(px(&engine, 24, 8), [behind(0), behind(1), behind(2), 0.8]), "{:?}", px(&engine, 24, 8));
    }
}
