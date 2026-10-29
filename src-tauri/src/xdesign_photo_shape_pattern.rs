//! Pattern fills and strokes on shape layers. The engine keeps `Fill::Pattern` on a shape but
//! rasterizes it transparent (photocraft vector/src/lib.rs:237), so the host draws those caches.
use std::collections::HashSet;
use std::sync::Arc;

use photocraft_compose::pattern::{render, Placement, Tile};
use photocraft_engine::{
    doc::{pattern::{display_name, find}, Color, Document, Fill, Layer, LayerContent, LayerId, Pattern, Rect, ShapeLayer, Surface},
    pattern_cmds, Session,
};
use photocraft_raster::from_rgba_into;
use serde_json::{json, Value};

/// What the engine builds a pattern-painted shape with before the host swaps the pattern in.
const PLACEHOLDER: &str = "#000000";

struct Paint {
    fill: Fill,
    pattern: Pattern,
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    matches!(command, "shape.create" | "shape.edit" | "shape.info").then(|| run(engine, command, params.clone()))
}

fn run(engine: &mut Session, command: &str, mut params: Value) -> Result<Value, String> {
    let fill = match params.get("fill") { Some(value) => paint(engine, value, &format!("{command}: fill"))?, None => None };
    if fill.is_some() { params["fill"] = json!(PLACEHOLDER); }
    let stroke = stroke_paint(engine, command, &mut params)?;
    let mut result = engine.execute(command, params.clone()).map_err(|e| e.to_string())?;
    let layer = LayerId(result["layer"].as_u64().ok_or("The shape command reported no layer")?);
    // Adding a subpath to a shape keeps that shape's paint, as the engine does.
    if params.get("addTo").is_none() && (fill.is_some() || stroke.is_some()) { apply(engine, layer, fill, stroke)?; }
    report(engine, layer, &mut result);
    Ok(result)
}

fn paint(engine: &Session, value: &Value, at: &str) -> Result<Option<Paint>, String> {
    let Some(key) = value.get("pattern") else { return Ok(None) };
    let key = key.as_str().filter(|key| !key.is_empty()).ok_or_else(|| format!("{at}.pattern must be a pattern preset id"))?;
    let scale = number(value, "scale", 1.0, 1000.0, 100.0).ok_or_else(|| format!("{at}.scale must be a number from 1 to 1000"))?;
    let angle = number(value, "angle", -180.0, 180.0, 0.0).ok_or_else(|| format!("{at}.angle must be a number from -180 to 180"))?;
    let pattern = pattern_cmds::resolve(engine, key).ok_or_else(|| format!("{at}.pattern: no pattern preset \"{key}\""))?;
    let fill = Fill::Pattern { name: pattern.name.clone(), scale: (scale / 100.0) as f32, id: pattern.id.clone(), angle: angle as f32, link: true, phase: (0.0, 0.0) };
    Ok(Some(Paint { fill, pattern }))
}

fn number(value: &Value, key: &str, low: f64, high: f64, default: f64) -> Option<f64> {
    match value.get(key) { None => Some(default), Some(given) => given.as_f64().filter(|given| (low..=high).contains(given)) }
}

/// The stroke's paint is `stroke.fill` (or `stroke.color`), or `pattern`/`scale`/`angle` on the stroke itself.
fn stroke_paint(engine: &Session, command: &str, params: &mut Value) -> Result<Option<Paint>, String> {
    let Some(stroke) = params.get_mut("stroke").and_then(Value::as_object_mut) else { return Ok(None) };
    let given = stroke.get("fill").or_else(|| stroke.get("color"));
    let found = if stroke.contains_key("pattern") {
        if given.is_some() { return Err(format!("{command}: stroke takes a pattern or a colour, not both")); }
        let found = paint(engine, &Value::Object(stroke.clone()), &format!("{command}: stroke"))?;
        for key in ["pattern", "scale", "angle"] { stroke.remove(key); }
        found
    } else {
        match given { Some(value) => paint(engine, value, &format!("{command}: stroke.fill"))?, None => None }
    };
    if found.is_some() {
        stroke.remove("color");
        stroke.insert("fill".into(), json!(PLACEHOLDER));
    }
    Ok(found)
}

fn apply(engine: &mut Session, layer: LayerId, fill: Option<Paint>, stroke: Option<Paint>) -> Result<(), String> {
    let state = engine.active_mut().ok_or("No image document is open")?;
    let doc = Arc::make_mut(&mut state.doc);
    for paint in fill.iter().chain(&stroke) { pattern_cmds::ensure_in_doc(doc, &paint.pattern); }
    let Some(LayerContent::Shape(shape)) = doc.layer_mut(layer).map(|layer| &mut layer.content) else { return Err("The shape layer is gone".into()) };
    if let Some(paint) = fill { shape.fill = Some(paint.fill); }
    if let (Some(paint), Some(line)) = (stroke, shape.stroke.as_mut()) { line.paint = paint.fill; }
    Ok(())
}

/// The engine reports a pattern by name and scale only; the host adds its preset id and angle.
fn report(engine: &Session, layer: LayerId, result: &mut Value) {
    let Some(LayerContent::Shape(shape)) = engine.active().and_then(|state| state.doc.layer(layer)).map(|layer| &layer.content) else { return };
    if let Some(value) = shape.fill.as_ref().and_then(described) { result["fill"] = value; }
    if let Some(value) = shape.stroke.as_ref().and_then(|line| described(&line.paint)) { result["stroke"]["fill"] = value; }
}

fn described(fill: &Fill) -> Option<Value> {
    let Fill::Pattern { name, scale, id, angle, .. } = fill else { return None };
    let round = |value: f64| (value * 1000.0).round() / 1000.0;
    Some(json!({"pattern": if id.is_empty() { name } else { id }, "name": display_name(name), "scale": round(f64::from(*scale) * 100.0), "angle": round(f64::from(*angle))}))
}

pub(super) fn before(engine: &Session) -> Option<(usize, Arc<Document>)> {
    Some((engine.active_index()?, engine.active()?.doc.clone()))
}

/// Redraws pattern-painted shapes whose cache the command replaced: the engine redraws a shape
/// whenever it moves, transforms or edits it, and leaves its pattern transparent.
pub(super) fn refresh(engine: &mut Session, before: Option<(usize, Arc<Document>)>) {
    let Some((index, old)) = before else { return };
    if engine.active_index() != Some(index) { return; }
    let Some(state) = engine.active_mut() else { return };
    if Arc::ptr_eq(&old, &state.doc) { return; }
    let drawn: HashSet<_> = old.walk().into_iter().filter_map(|(_, _, layer)| patterned(layer)?.cache.as_ref().map(identity)).filter(|tiles| !tiles.is_empty()).collect();
    let stale: Vec<LayerId> = state.doc.walk().into_iter()
        .filter(|(_, _, layer)| patterned(layer).is_some_and(|shape| shape.cache.as_ref().is_none_or(|cache| !drawn.contains(&identity(cache)))))
        .map(|(_, _, layer)| layer.id)
        .collect();
    if stale.is_empty() { return; }
    let doc = Arc::make_mut(&mut state.doc);
    for id in stale {
        let Some(cache) = doc.layer(id).map(|layer| draw(doc, layer)) else { continue };
        if let Some(LayerContent::Shape(shape)) = doc.layer_mut(id).map(|layer| &mut layer.content) { shape.cache = Some(cache); }
    }
}

fn patterned(layer: &Layer) -> Option<&ShapeLayer> {
    let LayerContent::Shape(shape) = &layer.content else { return None };
    let pattern = |fill: &Fill| matches!(fill, Fill::Pattern { .. });
    (shape.fill.as_ref().is_some_and(pattern) || shape.stroke.as_ref().is_some_and(|line| pattern(&line.paint))).then_some(shape)
}

/// A surface's tiles by address: clones share them, and every redraw allocates new ones.
fn identity(surface: &Surface) -> Vec<(i32, i32, usize)> {
    let mut tiles: Vec<_> = surface.tiles().map(|(at, tile)| (at.tx, at.ty, Arc::as_ptr(tile) as usize)).collect();
    tiles.sort_unstable();
    tiles
}

/// The fill, then the stroke over it, as the engine draws a shape, with pattern paint tiled
/// from the shape's frame.
fn draw(doc: &Document, layer: &Layer) -> Surface {
    let format = doc.pixel_format();
    let mut cache = Surface::new(format);
    let LayerContent::Shape(shape) = &layer.content else { return cache };
    let frame = photocraft_compose::paint_bounds(layer).unwrap_or(Rect::EMPTY);
    let fill = shape.fill.is_some().then(|| part(doc, ShapeLayer { stroke: None, cache: None, ..shape.clone() }, frame));
    let stroke = shape.stroke.is_some().then(|| part(doc, ShapeLayer { fill: None, cache: None, ..shape.clone() }, frame));
    let parts: Vec<_> = [fill, stroke].into_iter().flatten().filter(|(rect, _)| !rect.is_empty()).collect();
    let Some(area) = parts.iter().map(|(rect, _)| *rect).reduce(|a, b| a.union(&b)) else { return cache };
    let width = area.width() as usize;
    let mut out = vec![[0.0f32; 4]; width * area.height() as usize];
    for (rect, px) in &parts {
        let w = rect.width() as usize;
        for (i, s) in px.iter().enumerate() {
            let (x, y) = ((rect.x0 - area.x0) as usize + i % w, (rect.y0 - area.y0) as usize + i / w);
            let o = &mut out[y * width + x];
            let (sa, da) = (s[3], o[3]);
            let a = sa + da * (1.0 - sa);
            if a > 0.0 {
                for k in 0..3 { o[k] = (s[k] * sa + o[k] * da * (1.0 - sa)) / a; }
            }
            o[3] = a;
        }
    }
    let channels = format.channels();
    let mut values = vec![0.0f32; out.len() * channels];
    for (p, v) in out.iter().zip(values.chunks_exact_mut(channels)) {
        if p[3] > 0.0 { from_rgba_into(&format, *p, v); }
    }
    cache.write_region(area, &values);
    cache.prune();
    cache
}

/// A fill-only or stroke-only shape over its pixel bounds (straight RGBA): a pattern is drawn
/// as white for its coverage, then tinted with the tile (transparent if the preset is missing,
/// as the compositor does for fill layers).
fn part(doc: &Document, mut shape: ShapeLayer, frame: Rect) -> (Rect, Vec<[f32; 4]>) {
    let Some(paint) = shape.fill.as_mut().or_else(|| shape.stroke.as_mut().map(|line| &mut line.paint)) else { return (Rect::EMPTY, Vec::new()) };
    let pattern = match paint {
        Fill::Pattern { name, scale, id, angle, link, phase } => {
            let tiled = find(&doc.patterns, id, name).and_then(Tile::new).map(|tile| (tile, Placement::new(frame, *link, *phase, *scale, *angle)));
            *paint = Fill::Solid(Color::WHITE);
            Some(tiled)
        }
        _ => None,
    };
    let surface = photocraft_vector::render_shape(&shape, doc.pixel_format(), doc.bounds());
    let rect = surface.content_bounds().intersect(&doc.bounds());
    if rect.is_empty() { return (Rect::EMPTY, Vec::new()); }
    let mut px = vec![[0.0f32; 4]; rect.width() as usize * rect.height() as usize];
    surface.read_rgba_into(rect, &mut px);
    if let Some(tiled) = pattern {
        let colours = tiled.map(|(tile, place)| render(&tile, &place, rect));
        for (i, p) in px.iter_mut().enumerate() {
            let c = colours.as_ref().map_or([0.0; 4], |colours| colours[i]);
            *p = [c[0], c[1], c[2], c[3] * p[3]];
        }
    }
    (rect, px)
}

#[cfg(test)]
mod tests {
    use photocraft_engine::doc::{ColorMode, Document, Fill, Layer, LayerContent, Pattern, PixelFormat, Rect, SampleType, ShapeLayer, Size, Surface};
    use photocraft_engine::Session;
    use serde_json::{json, Value};

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
    const GREEN: [f32; 4] = [0.0, 1.0, 0.0, 1.0];

    /// A 60×40 image and a 4 px preset of vertical stripes: two red columns, then two blue.
    fn session() -> (Session, String) {
        let mut doc = Document::new("Patterns", Size::new(60, 40), ColorMode::Rgb, SampleType::U8);
        doc.layers.push(Layer::raster("Background", doc.pixel_format()));
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine.set_active(0);
        let base = engine.active().unwrap().doc.layers[0].id;
        engine.active_mut().unwrap().active_layer = Some(base);
        let mut tile = Surface::new(PixelFormat::RGBA8);
        tile.fill_rect(Rect::new(0, 0, 2, 4), &RED);
        tile.fill_rect(Rect::new(2, 0, 4, 4), &BLUE);
        let stripes = Pattern::new("Stripes", tile, 4, 4);
        let id = stripes.id.clone();
        engine.patterns.items.push(stripes);
        (engine, id)
    }
    fn run(engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, command, params)
    }
    fn past(engine: &Session) -> usize {
        engine.active().unwrap().history.past_len()
    }
    fn shape(engine: &Session) -> ShapeLayer {
        let state = engine.active().unwrap();
        let layer = state.doc.layer(state.active_layer.unwrap()).unwrap();
        match &layer.content { LayerContent::Shape(shape) => shape.clone(), _ => panic!("{} is not a shape", layer.name) }
    }
    fn px(engine: &Session, x: i32, y: i32) -> [f32; 4] {
        let mut out = [[0.0; 4]];
        shape(engine).cache.expect("the shape is drawn").read_rgba_into(Rect::new(x, y, x + 1, y + 1), &mut out);
        out[0]
    }
    fn near(actual: [f32; 4], expected: [f32; 4]) -> bool {
        actual.iter().zip(expected).all(|(a, e)| (a - e).abs() < 0.01)
    }
    fn paint(id: &str, scale: f64, angle: f64) -> Value {
        json!({"pattern": id, "name": "Stripes", "scale": scale, "angle": angle})
    }

    #[test]
    fn a_pattern_fill_paints_the_shape_from_its_preset_in_one_step() {
        let (mut engine, id) = session();
        let info = run(&mut engine, "shape.create", json!({"kind": "rect", "rect": [8, 8, 32, 22], "fill": {"pattern": id}})).unwrap();
        assert_eq!(past(&engine), 1);
        assert_eq!(info["fill"], paint(&id, 100.0, 0.0));
        assert!(matches!(&shape(&engine).fill, Some(Fill::Pattern { id: p, scale, angle, link: true, .. }) if *p == id && *scale == 1.0 && *angle == 0.0));
        assert!(engine.active().unwrap().doc.patterns.iter().any(|p| p.id == id), "the preset is copied into the image");
        assert!(near(px(&engine, 8, 10), RED) && near(px(&engine, 9, 29), RED), "{:?}", px(&engine, 8, 10));
        assert!(near(px(&engine, 10, 10), BLUE) && near(px(&engine, 39, 10), BLUE));
        assert_eq!(px(&engine, 5, 5)[3], 0.0);
        assert_eq!(px(&engine, 40, 10)[3], 0.0);
    }

    #[test]
    fn scale_and_angle_place_the_pattern_and_round_trip_through_shape_info() {
        let (mut engine, id) = session();
        let info = run(&mut engine, "shape.create", json!({"kind": "rect", "rect": [8, 8, 32, 22], "fill": {"pattern": id, "scale": 200}})).unwrap();
        let layer = info["layer"].clone();
        assert!(near(px(&engine, 10, 10), RED) && near(px(&engine, 14, 10), BLUE));
        run(&mut engine, "shape.edit", json!({"layer": layer, "fill": {"pattern": id, "angle": 90}})).unwrap();
        assert_eq!(past(&engine), 2);
        assert!(near(px(&engine, 10, 10), RED) && near(px(&engine, 12, 10), RED) && near(px(&engine, 10, 8), BLUE));
        let info = run(&mut engine, "shape.info", json!({"layer": layer})).unwrap();
        assert_eq!(info["fill"], paint(&id, 100.0, 90.0));
        let kept = shape(&engine).fill;
        run(&mut engine, "shape.edit", json!({"layer": layer, "fill": info["fill"]})).unwrap();
        assert_eq!(shape(&engine).fill, kept);
        assert!(near(px(&engine, 10, 8), BLUE));
    }

    #[test]
    fn a_pattern_stroke_paints_along_the_outline() {
        let (mut engine, id) = session();
        let stroke = json!({"width": 4, "align": "inside", "fill": {"pattern": id}});
        let info = run(&mut engine, "shape.create", json!({"kind": "rect", "rect": [8, 8, 32, 22], "fill": "#00ff00", "stroke": stroke})).unwrap();
        assert_eq!(info["stroke"]["fill"], paint(&id, 100.0, 0.0));
        assert_eq!(info["stroke"]["width"], json!(4.0));
        assert_eq!(info["fill"], json!("#00ff00"));
        assert!(near(px(&engine, 8, 20), RED) && near(px(&engine, 10, 20), BLUE));
        assert!(near(px(&engine, 24, 20), GREEN));
        let shorthand = json!({"width": 4, "align": "inside", "pattern": id, "scale": 200});
        let info = run(&mut engine, "shape.create", json!({"kind": "rect", "rect": [8, 8, 32, 22], "fill": null, "stroke": shorthand})).unwrap();
        assert_eq!(info["stroke"]["fill"], paint(&id, 200.0, 0.0));
        assert!(near(px(&engine, 10, 9), RED) && near(px(&engine, 14, 9), BLUE));
        assert_eq!(px(&engine, 24, 20)[3], 0.0);
    }

    #[test]
    fn edits_that_redraw_the_shape_keep_its_pattern() {
        let (mut engine, id) = session();
        let info = run(&mut engine, "shape.create", json!({"kind": "rect", "rect": [8, 8, 32, 22], "fill": {"pattern": id}})).unwrap();
        let layer = info["layer"].clone();
        run(&mut engine, "layer.translate", json!({"layer": layer, "dx": 2, "dy": 0})).unwrap();
        assert!(near(px(&engine, 10, 10), RED) && near(px(&engine, 12, 10), BLUE), "the Move tool redraws it linked to the shape");
        run(&mut engine, "shape.edit", json!({"layer": layer, "rect": [10, 8, 20, 22]})).unwrap();
        assert!(matches!(shape(&engine).fill, Some(Fill::Pattern { .. })));
        assert!(near(px(&engine, 10, 10), RED) && near(px(&engine, 29, 10), BLUE));
        assert_eq!(px(&engine, 30, 10)[3], 0.0);
        run(&mut engine, "edit.undo", json!({})).unwrap();
        assert!(near(px(&engine, 41, 10), BLUE), "undo restores the moved shape's pattern");
        run(&mut engine, "shape.edit", json!({"layer": layer, "fill": "#00ff00"})).unwrap();
        assert!(near(px(&engine, 10, 10), GREEN));
        assert_eq!(run(&mut engine, "shape.info", json!({"layer": layer})).unwrap()["fill"], json!("#00ff00"));
    }

    #[test]
    fn bad_pattern_paints_are_refused() {
        let (mut engine, id) = session();
        for paints in [
            json!({"fill": {"pattern": "Nope"}}),
            json!({"fill": {"pattern": ""}}),
            json!({"fill": {"pattern": 7}}),
            json!({"fill": {"pattern": id, "scale": 0}}),
            json!({"fill": {"pattern": id, "scale": 1001}}),
            json!({"fill": {"pattern": id, "scale": "big"}}),
            json!({"fill": {"pattern": id, "angle": 181}}),
            json!({"fill": {"pattern": id, "angle": -180.5}}),
            json!({"stroke": {"width": 3, "pattern": id, "fill": "#ff0000"}}),
            json!({"stroke": {"width": 3, "fill": {"pattern": id, "scale": 0.5}}}),
        ] {
            let mut params = json!({"kind": "rect", "rect": [8, 8, 32, 22]});
            params.as_object_mut().unwrap().extend(paints.as_object().unwrap().clone());
            assert!(run(&mut engine, "shape.create", params.clone()).is_err(), "{params}");
            assert_eq!(past(&engine), 0, "{params}");
        }
    }
}
