use photocraft_engine::doc::Rect;
use photocraft_raster::Surface;

// The pinned raster stores 256×256 encoded tiles; no geometry dependency is needed.
const SIDE: i64 = 256;
const COORDINATE_ERROR: &str = "Surface translation exceeds the supported raster coordinates";
const ENCODING_ERROR: &str = "The surface has an invalid encoded tile";
type Bounds = [i64; 4];

fn tile_bounds(tx: i64, ty: i64) -> Result<Bounds, String> {
    let x = tx.checked_mul(SIDE).ok_or(COORDINATE_ERROR)?;
    let y = ty.checked_mul(SIDE).ok_or(COORDINATE_ERROR)?;
    let right = x.checked_add(SIDE).ok_or(COORDINATE_ERROR)?;
    let bottom = y.checked_add(SIDE).ok_or(COORDINATE_ERROR)?;
    if x < i64::from(i32::MIN) || y < i64::from(i32::MIN)
        || right > i64::from(i32::MAX) || bottom > i64::from(i32::MAX) {
        return Err(COORDINATE_ERROR.into());
    }
    Ok([x, y, right, bottom])
}

pub(super) fn validate(surface: &Surface) -> Result<(), String> {
    let bytes = surface.format().bytes_per_pixel();
    let expected = (SIDE as usize).checked_mul(SIDE as usize).and_then(|pixels| pixels.checked_mul(bytes)).ok_or(ENCODING_ERROR)?;
    if bytes == 0 || surface.default_bytes().len() != bytes { return Err(ENCODING_ERROR.into()); }
    for (coordinate, tile) in surface.tiles() {
        tile_bounds(i64::from(coordinate.tx), i64::from(coordinate.ty))?;
        if tile.bytes().len() != expected { return Err(ENCODING_ERROR.into()); }
    }
    Ok(())
}

fn intersect(a: Bounds, b: Bounds) -> Bounds {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])]
}
fn empty(bounds: Bounds) -> bool { bounds[0] >= bounds[2] || bounds[1] >= bounds[3] }
fn rect_bounds(rect: Rect) -> Bounds { [i64::from(rect.x0), i64::from(rect.y0), i64::from(rect.x1), i64::from(rect.y1)] }

fn painted(bytes: &[u8], default: &[u8], origin: Bounds, clip: Bounds) -> Option<Bounds> {
    if empty(clip) { return None; }
    let size = default.len();
    let mut result = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    for y in clip[1]..clip[3] {
        for x in clip[0]..clip[2] {
            let at = (((y - origin[1]) * SIDE + x - origin[0]) as usize) * size;
            if &bytes[at..at + size] != default {
                result = [result[0].min(x), result[1].min(y), result[2].max(x + 1), result[3].max(y + 1)];
            }
        }
    }
    (!empty(result)).then_some(result)
}

fn moved(bounds: Bounds, dx: i64, dy: i64) -> Result<Bounds, String> {
    Ok([
        bounds[0].checked_add(dx).ok_or(COORDINATE_ERROR)?, bounds[1].checked_add(dy).ok_or(COORDINATE_ERROR)?,
        bounds[2].checked_add(dx).ok_or(COORDINATE_ERROR)?, bounds[3].checked_add(dy).ok_or(COORDINATE_ERROR)?,
    ])
}

#[cfg(test)]
pub(super) fn translate(source: &Surface, dx: i32, dy: i32) -> Result<Surface, String> {
    translate_crop(source, i64::from(dx), i64::from(dy), None)
}

#[cfg(test)]
pub(super) fn crop(source: &Surface, keep: Rect) -> Result<Surface, String> {
    translate_crop(source, 0, 0, Some(keep))
}

/// Crop in source coordinates, then translate. All-default allocated tiles are
/// omitted; the pinned dense implementation leaves such tiles inside its bounds.
pub(super) fn translate_crop(source: &Surface, dx: i64, dy: i64, keep_source: Option<Rect>) -> Result<Surface, String> {
    validate(source)?;
    let mut output = Surface::with_default(source.format(), &source.default_pixel());
    let pixel_bytes = source.format().bytes_per_pixel();
    for (coordinate, tile) in source.tiles() {
        let original = tile_bounds(i64::from(coordinate.tx), i64::from(coordinate.ty))?;
        let Some(all) = painted(tile.bytes(), source.default_bytes(), original, original) else { continue };
        let clipped = keep_source.map_or(all, |keep| intersect(all, rect_bounds(keep)));
        let Some(retained) = painted(tile.bytes(), source.default_bytes(), original, clipped) else { continue };
        let destination = moved(retained, dx, dy)?;
        let tx0 = destination[0].div_euclid(SIDE);
        let ty0 = destination[1].div_euclid(SIDE);
        let tx1 = (destination[2] - 1).div_euclid(SIDE);
        let ty1 = (destination[3] - 1).div_euclid(SIDE);
        // A full translated tile remains addressable by every public raster API,
        // including content_bounds and later tile scans.
        tile_bounds(tx0, ty0)?; tile_bounds(tx1, ty1)?;
        if dx.rem_euclid(SIDE) == 0 && dy.rem_euclid(SIDE) == 0 && retained == all {
            let mut target = *coordinate;
            target.tx = i32::try_from(i64::from(coordinate.tx) + dx / SIDE).map_err(|_| COORDINATE_ERROR)?;
            target.ty = i32::try_from(i64::from(coordinate.ty) + dy / SIDE).map_err(|_| COORDINATE_ERROR)?;
            output.put_tiles(std::iter::once((target, tile.clone())));
            continue;
        }
        for ty in ty0..=ty1 { for tx in tx0..=tx1 {
            let target_bounds = tile_bounds(tx, ty)?;
            let part = intersect(destination, target_bounds);
            let mut target = *coordinate;
            target.tx = i32::try_from(tx).map_err(|_| COORDINATE_ERROR)?;
            target.ty = i32::try_from(ty).map_err(|_| COORDINATE_ERROR)?;
            let destination_bytes = output.tile_mut(target).bytes_mut();
            let width = (part[2] - part[0]) as usize * pixel_bytes;
            for y in part[1]..part[3] {
                let source_x = part[0].checked_sub(dx).ok_or(COORDINATE_ERROR)?;
                let source_y = y.checked_sub(dy).ok_or(COORDINATE_ERROR)?;
                let from = (((source_y - original[1]) * SIDE + source_x - original[0]) as usize) * pixel_bytes;
                let to = (((y - target_bounds[1]) * SIDE + part[0] - target_bounds[0]) as usize) * pixel_bytes;
                destination_bytes[to..to + width].copy_from_slice(&tile.bytes()[from..from + width]);
            }
        } }
    }
    output.prune();
    Ok(output)
}

/// Overlay allocated source-tile intersections only; missing source tiles leave
/// the target unchanged. Restoring holes requires a separate sparse operation.
#[cfg(test)]
pub(super) fn copy_into(source: &Surface, target: &mut Surface, keep: Rect) -> Result<(), String> {
    if source.format() != target.format() { return Err("Surface copy requires matching pixel formats".into()); }
    validate(source)?; validate(target)?;
    let keep = rect_bounds(keep);
    let pixel_bytes = source.format().bytes_per_pixel();
    for (coordinate, tile) in source.tiles() {
        let bounds = tile_bounds(i64::from(coordinate.tx), i64::from(coordinate.ty))?;
        let part = intersect(bounds, keep);
        if empty(part) { continue; }
        if part == bounds {
            target.put_tiles(std::iter::once((*coordinate, tile.clone())));
            continue;
        }
        let destination = target.tile_mut(*coordinate).bytes_mut();
        let width = (part[2] - part[0]) as usize * pixel_bytes;
        for y in part[1]..part[3] {
            let from = (((y - bounds[1]) * SIDE + part[0] - bounds[0]) as usize) * pixel_bytes;
            destination[from..from + width].copy_from_slice(&tile.bytes()[from..from + width]);
        }
    }
    target.prune();
    Ok(())
}

#[cfg(test)]
#[path = "xdesign_photo_sparse_surfaces_tests.rs"]
mod tests;
