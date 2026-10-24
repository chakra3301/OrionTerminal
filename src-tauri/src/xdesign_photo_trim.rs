use photocraft_engine::{doc::Rect, EngineError, Session};
use serde_json::Value;

const SIDE: i32 = 256;

fn reference(engine: &Session, canvas: Rect, based: &str) -> Result<Option<[f32; 4]>, String> {
    let doc = &engine.active().ok_or_else(|| EngineError::NoDocument.to_string())?.doc;
    let (x, y) = match based {
        "topLeft" => (canvas.x0, canvas.y0),
        "bottomRight" if !canvas.is_empty() => (canvas.x1 - 1, canvas.y1 - 1),
        _ => return Ok(None),
    };
    // Match the native corner's render tile, preserving its clipping and halo context.
    let x0 = x.div_euclid(SIDE) * SIDE;
    let y0 = y.div_euclid(SIDE) * SIDE;
    let rect = Rect::new(x0, y0, x0.saturating_add(SIDE).min(canvas.x1), y0.saturating_add(SIDE).min(canvas.y1));
    let buffer = photocraft_compose::render(doc, rect);
    Ok(Some(buffer.get(x, y)))
}

fn differs(pixel: [f32; 4], reference: Option<[f32; 4]>) -> bool {
    match reference {
        None => pixel[3] > 0.0,
        Some(reference) => (0..4).any(|channel| {
            (pixel[channel] * pixel[3] - reference[channel] * reference[3]).abs() > 0.5 / 255.0
                || (channel == 3 && (pixel[3] - reference[3]).abs() > 0.5 / 255.0)
        }),
    }
}

pub(super) fn bounds(engine: &Session, params: &Value) -> Result<Rect, String> {
    let doc = &engine.active().ok_or_else(|| EngineError::NoDocument.to_string())?.doc;
    let canvas = doc.bounds();
    let based = params.get("basedOn").and_then(Value::as_str).unwrap_or("transparent");
    let reference = reference(engine, canvas, based)?;
    let mut content = Rect::EMPTY;
    let mut x = canvas.x0;
    while x < canvas.x1 {
        let right = x.saturating_add(SIDE).min(canvas.x1);
        // render_bands rounds heights up to whole tiles; restricting width avoids
        // recreating a canvas-wide float band on very wide documents.
        photocraft_compose::render_bands(doc, Rect::new(x, canvas.y0, right, canvas.y1), SIDE, |band| {
            let width = band.rect.width() as usize;
            for (index, pixel) in band.px.iter().enumerate() {
                if differs(*pixel, reference) {
                    let x = band.rect.x0 + (index % width) as i32;
                    let y = band.rect.y0 + (index / width) as i32;
                    let pixel = Rect::new(x, y, x + 1, y + 1);
                    content = if content.is_empty() { pixel } else { content.union(&pixel) };
                }
            }
            Ok::<_, String>(())
        })?;
        x = right;
    }
    if content.is_empty() { return Err(EngineError::Other("nothing to trim to".into()).to_string()); }
    let side = |key: &str| params.get(key).and_then(Value::as_bool).unwrap_or(true);
    Ok(Rect::new(
        if side("left") { content.x0 } else { canvas.x0 },
        if side("top") { content.y0 } else { canvas.y0 },
        if side("right") { content.x1 } else { canvas.x1 },
        if side("bottom") { content.y1 } else { canvas.y1 },
    ))
}

#[cfg(test)]
#[path = "xdesign_photo_trim_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "xdesign_photo_trim_host_tests.rs"]
mod host_tests;
