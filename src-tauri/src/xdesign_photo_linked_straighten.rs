use photocraft_engine::{doc::Rect, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const COMMAND: &str = "image.analysis.straightenLayer";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != COMMAND || params.get("start").is_some() || params.get("end").is_some() { return None; }
    Some(run_with(engine, params, |engine, command, params| {
        super::super::preview::validate_geometry_input(engine, command, &params)?;
        if let Some(result) = super::rotation::execute(engine, command, &params) { return result; }
        if let Some(result) = super::transform::execute(engine, command, &params) { return result; }
        engine.execute(command, params).map_err(|error| error.to_string())
    }))
}

fn inscribed(w: f64, h: f64, angle: f64) -> (f64, f64) {
    let (sa, ca) = (angle.sin().abs(), angle.cos().abs());
    let long_w = w >= h;
    let (long, short) = if long_w { (w, h) } else { (h, w) };
    if short <= 2.0 * sa * ca * long || (sa - ca).abs() < 1e-10 {
        let x = 0.5 * short;
        if long_w { (x / sa, x / ca) } else { (x / ca, x / sa) }
    } else {
        let c2 = ca * ca - sa * sa;
        ((w * ca - h * sa) / c2, (h * ca - w * sa) / c2)
    }
}

pub(super) fn run_with(engine: &mut Session, params: &Value,
    mut step: impl FnMut(&mut Session, &str, Value) -> Result<Value, String>) -> Result<Value, String> {
    if !(params.is_object() || params.is_null()) || engine.disabled_reason(COMMAND).is_some() {
        return engine.execute(COMMAND, params.clone()).map_err(|error| error.to_string());
    }
    let state = engine.active().ok_or("No image document")?;
    let ruler = state.doc.measurement.ruler.ok_or("no ruler line")?;
    let (dx, dy) = (ruler.end[0] - ruler.start[0], ruler.end[1] - ruler.start[1]);
    let angle = (-dy).atan2(dx).to_degrees();
    let rotation = angle - 90.0 * (angle / 90.0).round();
    if rotation.abs() < 1e-9 {
        return engine.execute(COMMAND, params.clone()).map_err(|error| error.to_string());
    }
    let active_background = state.active_layer.and_then(|id| state.doc.layer(id))
        .is_some_and(|layer| layer.name == "Background" && layer.locks.position);
    let crop = params.get("crop").and_then(Value::as_bool).unwrap_or(active_background || state.active_layer.is_none());
    let (width, height) = (f64::from(state.doc.size.width), f64::from(state.doc.size.height));
    let before = state.doc.clone();
    let history = state.history.clone();
    // Native Straighten is a compound, with nested revisions/journals and one final history step.
    // Refreshing after the compound would render canvas-dependent filters against the cropped canvas.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if crop {
            step(engine, "image.rotation.arbitrary", json!({"angle":rotation,"direction":"cw"}))?;
            let size = engine.active().ok_or("No rotated image")?.doc.size;
            let (cw, ch) = inscribed(width, height, rotation.to_radians());
            let (nw, nh) = (f64::from(size.width), f64::from(size.height));
            let (cw, ch) = (cw.floor().clamp(1.0, nw), ch.floor().clamp(1.0, nh));
            step(engine, "image.crop", json!({"x":((nw-cw)/2.0).round(),"y":((nh-ch)/2.0).round(),"width":cw,"height":ch}))?;
        } else {
            let (cx, cy) = (width / 2.0, height / 2.0);
            let (sn, cs) = rotation.to_radians().sin_cos();
            let matrix = [cs, sn, -sn, cs, cx - (cs * cx - sn * cy), cy - (sn * cx + cs * cy)];
            step(engine, "edit.transform", json!({"matrix":matrix}))?;
        }
        let state = engine.active_mut().ok_or("No straightened image")?;
        let mut document = (*state.doc).clone();
        document.measurement.ruler = None;
        state.doc = Arc::new(document);
        let clean = state.saved_revision == state.revision;
        state.revision += 1;
        if clean { state.saved_revision = state.revision; }
        state.last_damage = Some(Rect::EMPTY);
        Ok::<_, String>(())
    })).map_err(|_| "Straighten failed with an internal error".to_owned()).and_then(|result| result);
    let state = engine.active_mut().ok_or("No image document")?;
    if let Err(error) = result {
        state.history = history;
        state.doc = before;
        state.revision += 1;
        state.last_damage = None;
        return Err(error);
    }
    // Recover the public history target without importing the SDK's private dependency.
    let mut probe = std::mem::take(&mut state.history);
    probe.record("Target probe", state.doc.clone(), Default::default());
    let (_, layers) = probe.undo(state.doc.clone()).ok_or("Missing straighten history target")?;
    state.history = history;
    state.history.record("Straighten", before, layers);
    state.history.trim(&state.doc);
    state.coalesce = None;
    let size = state.doc.size;
    let index = engine.active_index().ok_or("No image document")?;
    engine.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
    engine.journal.push((COMMAND.into(), params.clone()));
    Ok(json!({"angle":(rotation*10_000.0).round()/10_000.0,"cropped":crop,"width":size.width,"height":size.height}))
}

