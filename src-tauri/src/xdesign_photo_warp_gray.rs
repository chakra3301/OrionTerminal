use photocraft_algo::{transform::Interp, warp::warp_mesh_surface};
use photocraft_engine::doc::{PixelFormat, Rect};
use photocraft_raster::Surface;

const ROW_CHUNK: i64 = 1024;

/// Single-channel mask/selection warp with the pinned native mesh and flattening.
pub(super) fn warp_gray(
    source: &Surface,
    map: &(dyn Fn(f64, f64) -> (f64, f64) + Sync),
    interpolation: Interp,
) -> Surface {
    let default = source.default_pixel().first().copied().unwrap_or(0.0);
    let format = source.format();
    let bounds = source.content_bounds();
    let mut output = Surface::with_default(format, &[default]);
    if bounds.is_empty() {
        return output;
    }

    let mut temporary = Surface::new(PixelFormat::new(format.mode, format.sample, true));
    for y in bounds.y0..bounds.y1 {
        let mut x = bounds.x0;
        while x < bounds.x1 {
            let end = (i64::from(x) + ROW_CHUNK).min(i64::from(bounds.x1)) as i32;
            let row = Rect::new(x, y, end, y + 1);
            let gray = source.read_region(row);
            let opaque: Vec<f32> = gray.iter().flat_map(|value| [*value, 1.0]).collect();
            temporary.write_region(row, &opaque);
            x = end;
        }
    }

    let warped = warp_mesh_surface(&temporary, bounds, map, interpolation);
    let destination = warped.content_bounds();
    // with_default already supplies the exact encoded native default. Filling
    // source.union(destination) would allocate every tile in an empty translation gap.
    for y in destination.y0..destination.y1 {
        let mut x = destination.x0;
        while x < destination.x1 {
            let end = (i64::from(x) + ROW_CHUNK).min(i64::from(destination.x1)) as i32;
            let row = Rect::new(x, y, end, y + 1);
            let pixels = warped.read_region(row);
            let flattened: Vec<f32> = pixels.chunks_exact(2)
                .map(|pixel| pixel[0] * pixel[1] + default * (1.0 - pixel[1]))
                .collect();
            if flattened.iter().any(|value| *value != default) {
                output.write_region(row, &flattened);
            }
            x = end;
        }
    }
    output.prune();
    output
}

#[cfg(test)]
#[path = "xdesign_photo_warp_gray_tests.rs"]
mod tests;
