use photocraft_engine::Session;
use serde_json::Value;

const LIMIT_ERROR: &str = "Requested dimensions exceed the 256 megapixel editing limit";

fn resolved_size(engine: &Session, command: &str, params: &Value) -> Option<(u32, u32)> {
    if !["image.imageSize", "image.canvasSize", "image.rotation.arbitrary"].contains(&command) { return None; }
    let state = engine.active()?;
    let (width, height) = (state.doc.size.width, state.doc.size.height);
    if command == "image.rotation.arbitrary" {
        // Match native f32 parsing before trigonometry; invalid inputs and no-ops stay SDK-owned.
        let angle = f64::from(params.get("angle").and_then(Value::as_f64).unwrap_or(0.) as f32);
        if !angle.is_finite() || angle.abs() > 3600. { return None; }
        let angle = match params.get("direction").and_then(Value::as_str).unwrap_or("cw") {
            "cw" => angle,
            "ccw" => -angle,
            _ => return None,
        };
        if angle.rem_euclid(360.).abs() < 1e-9 { return None; }
        let size = photocraft_engine::mode_cmds::rotated_size(state.doc.size, angle);
        return Some((size.width, size.height));
    }
    let requested = match command {
        "image.imageSize" => {
            // Native no-resample edits resolution only, even when its reply reports requested sizes.
            if params.get("resample").and_then(Value::as_str) == Some("none") { return Some((width, height)); }
            match (params.get("width").and_then(Value::as_f64), params.get("height").and_then(Value::as_f64)) {
                (Some(w), Some(h)) => (w, h),
                (Some(w), None) => (w, w * f64::from(height) / f64::from(width.max(1))),
                (None, Some(h)) => (h * f64::from(width) / f64::from(height.max(1)), h),
                (None, None) => (f64::from(width), f64::from(height)),
            }
        }
        "image.canvasSize" => {
            let relative = params.get("relative").and_then(Value::as_bool).unwrap_or(false);
            let w = params.get("width").and_then(Value::as_f64).unwrap_or(if relative { 0. } else { f64::from(width) });
            let h = params.get("height").and_then(Value::as_f64).unwrap_or(if relative { 0. } else { f64::from(height) });
            if relative { (f64::from(width) + w, f64::from(height) + h) } else { (w, h) }
        }
        _ => unreachable!(),
    };
    Some((requested.0.round().clamp(1., 300_000.) as u32, requested.1.round().clamp(1., 300_000.) as u32))
}

fn admit(engine: &Session, command: &str, params: &Value, limit: u64) -> Result<(), String> {
    if !["image.imageSize", "image.canvasSize", "image.rotation.arbitrary"].contains(&command) { return Ok(()); }
    // The SDK owns argument, document and job errors, which precede native geometry parsing.
    if !(params.is_object() || params.is_null()) || engine.disabled_reason(command).is_some() { return Ok(()); }
    let Some((width, height)) = resolved_size(engine, command, params) else { return Ok(()); };
    if width == 0 || height == 0 || u64::from(width).checked_mul(u64::from(height)).is_none_or(|pixels| pixels > limit) {
        return Err(LIMIT_ERROR.into());
    }
    Ok(())
}

pub(super) fn validate(engine: &Session, command: &str, params: &Value) -> Result<(), String> {
    // Canvas admission does not bound native sparse warp footprints, gray buffers or decoded sources.
    admit(engine, command, params, super::super::MAX_PIXELS)
}

#[cfg(test)]
pub(super) fn validate_with_limit(engine: &Session, command: &str, params: &Value, limit: u64) -> Result<(), String> {
    admit(engine, command, params, limit)
}

#[cfg(test)]
#[path = "xdesign_photo_geometry_admission_tests.rs"]
mod tests;
