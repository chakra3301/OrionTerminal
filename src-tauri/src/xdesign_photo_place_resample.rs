use photocraft_algo::resample::{resize_surface, scaled_rect, Resample};
use photocraft_engine::doc::Rect;
use photocraft_raster::Surface;

const ALLOCATION_ERROR: &str = "Not enough memory to resize the image";
const LIMIT_ERROR: &str = "Resampled image or workspace exceeds the editing limit";

// The native image module is private; preserve its exact raw-channel arithmetic here.
fn premultiply(data: &mut [f32], ch: usize, alpha: bool) {
    if !alpha { return; }
    for px in data.chunks_exact_mut(ch) {
        let a = px[ch - 1];
        for v in px.iter_mut().take(ch - 1) { *v *= a; }
    }
}

fn unpremultiply(data: &mut [f32], ch: usize, alpha: bool) {
    if !alpha { return; }
    for px in data.chunks_exact_mut(ch) {
        let a = px[ch - 1];
        for v in px.iter_mut().take(ch - 1) { *v = if a > 1e-7 { *v / a } else { 0.0 }; }
    }
}

fn support(filter: Resample) -> f64 {
    match filter {
        Resample::Nearest => 0.5,
        Resample::Bilinear => 1.0,
        Resample::Bicubic => 2.0,
        Resample::Lanczos | Resample::PreserveDetails => 3.0,
    }
}

fn weight(filter: Resample, x: f64) -> f64 {
    let x = x.abs();
    match filter {
        Resample::Nearest => if x <= 0.5 { 1.0 } else { 0.0 },
        Resample::Bilinear => (1.0 - x).max(0.0),
        Resample::Bicubic => {
            let a = -0.5;
            if x < 1.0 { (a + 2.0) * x * x * x - (a + 3.0) * x * x + 1.0 }
            else if x < 2.0 { a * x * x * x - 5.0 * a * x * x + 8.0 * a * x - 4.0 * a }
            else { 0.0 }
        }
        Resample::Lanczos | Resample::PreserveDetails => {
            if x < 1e-9 { 1.0 }
            else if x < 3.0 {
                let px = std::f64::consts::PI * x;
                3.0 * px.sin() * (px / 3.0).sin() / (px * px)
            } else { 0.0 }
        }
    }
}

fn window(output: i32, scale: f64, filter: Resample) -> (f64, i64, i64) {
    let stretch = if scale < 1.0 { 1.0 / scale } else { 1.0 };
    let center = (f64::from(output) + 0.5) / scale - 0.5;
    if filter == Resample::Nearest && scale >= 1.0 {
        let sample = (center + 0.5).floor() as i32;
        return (center, i64::from(sample), i64::from(sample) + 1);
    }
    let low = (center - support(filter) * stretch).ceil() as i32;
    let high = (center + support(filter) * stretch).floor() as i32;
    (center, i64::from(low), i64::from(high) + 1)
}

fn within_budget(dimensions: &[u64]) -> bool {
    dimensions.iter().try_fold(1u64, |total, value| total.checked_mul(*value))
        .is_some_and(|cells| cells <= super::super::MAX_PIXELS)
}

fn raster_bounds_safe(x0: i64, y0: i64, x1: i64, y1: i64) -> bool {
    // TileCoord is available through Rect's public iterator; the geom crate is not a direct dependency.
    let Some(tile) = Rect::new(0, 0, 1, 1).tiles().next() else { return false; };
    let size = i64::from(tile.rect().width());
    [(x0, x1), (y0, y1)].iter().all(|&(low, high)| {
        low < high && low >= i64::from(i32::MIN) && high <= i64::from(i32::MAX)
            && low.div_euclid(size) * size >= i64::from(i32::MIN)
            && ((high - 1).div_euclid(size) + 1) * size <= i64::from(i32::MAX)
    })
}

fn checked_geometry(source: &Surface, sx: f64, sy: f64) -> Result<Rect, String> {
    if ![sx, sy].iter().all(|value| value.is_finite() && *value > 0.0 && (1.0 / value).is_finite()) {
        return Err("Invalid placement scale".into());
    }
    let Some(tile) = Rect::new(0, 0, 1, 1).tiles().next() else { return Err(LIMIT_ERROR.into()); };
    let size = i64::from(tile.rect().width());
    if source.tiles().any(|(tile, _)| {
        let (x, y) = (i64::from(tile.tx) * size, i64::from(tile.ty) * size);
        !raster_bounds_safe(x, y, x + size, y + size)
    }) { return Err(LIMIT_ERROR.into()); }
    let bounds = source.content_bounds();
    if bounds.is_empty() { return Ok(Rect::EMPTY); }
    let width = (i64::from(bounds.x1) - i64::from(bounds.x0)) as u64;
    let height = (i64::from(bounds.y1) - i64::from(bounds.y0)) as u64;
    if !within_budget(&[width, height]) { return Err(LIMIT_ERROR.into()); }
    let coordinates = [
        (f64::from(bounds.x0) * sx).floor(), (f64::from(bounds.y0) * sy).floor(),
        (f64::from(bounds.x1) * sx).ceil(), (f64::from(bounds.y1) * sy).ceil(),
    ];
    if coordinates.iter().any(|value| !value.is_finite() || *value < f64::from(i32::MIN) || *value > f64::from(i32::MAX)) {
        return Err(LIMIT_ERROR.into());
    }
    let destination = scaled_rect(bounds, sx, sy);
    if !raster_bounds_safe(i64::from(destination.x0), i64::from(destination.y0), i64::from(destination.x1), i64::from(destination.y1)) {
        return Err(LIMIT_ERROR.into());
    }
    let dw = (i64::from(destination.x1) - i64::from(destination.x0)) as u64;
    let dh = (i64::from(destination.y1) - i64::from(destination.y0)) as u64;
    if !within_budget(&[dw, dh])
        || !within_budget(&[width, source.format().channels() as u64])
        || !within_budget(&[dw, source.format().channels() as u64])
        || !within_budget(&[dw, (std::mem::size_of::<Kernel>() as u64).div_ceil(4)]) {
        return Err(LIMIT_ERROR.into());
    }
    Ok(destination)
}

fn native_safe(destination: Rect, sx: f64, sy: f64, channels: usize, filter: Resample) -> bool {
    let width = u64::from(destination.width());
    let height = u64::from(destination.height());
    let (_, x0, _) = window(destination.x0, sx, filter);
    let (_, _, x1) = window(destination.x1 - 1, sx, filter);
    for (length, scale) in [(width, sx), (height, sy)] {
        let stretch = if scale < 1.0 { 1.0 / scale } else { 1.0 };
        let taps = if filter == Resample::Nearest && scale >= 1.0 { Some(1) }
            else { ((2.0 * support(filter) * stretch).floor() as u64).checked_add(1) };
        if !taps.is_some_and(|taps| within_budget(&[length, taps])) { return false; }
    }
    let read_width = (x1 - x0) as u64;
    // Native retains parallel band buffers: these are per-intermediate limits, not aggregate memory.
    let mut y = i64::from(destination.y0);
    while y < i64::from(destination.y1) {
        let end = (y + 64).min(i64::from(destination.y1));
        let (_, low, _) = window(y as i32, sy, filter);
        let (_, _, high) = window((end - 1) as i32, sy, filter);
        let read_height = (high - low) as u64;
        if !raster_bounds_safe(x0, low, x1, high)
            || !within_budget(&[read_width, read_height, channels as u64])
            || !within_budget(&[width, read_height, channels as u64])
            || !within_budget(&[width, (end - y) as u64, channels as u64]) { return false; }
        y = end;
    }
    true
}

struct Kernel {
    center: f64,
    stretch: f64,
    sum: f64,
    low: i64,
    high: i64,
    filter: Resample,
    nearest: bool,
}

impl Kernel {
    fn new(output: i32, scale: f64, filter: Resample) -> Self {
        let stretch = if scale < 1.0 { 1.0 / scale } else { 1.0 };
        let (center, low, high) = window(output, scale, filter);
        let nearest = filter == Resample::Nearest && scale >= 1.0;
        let sum = if nearest { 1.0 } else {
            (low..high).map(|sample| weight(filter, (sample as f64 - center) / stretch)).sum()
        };
        Self { center, stretch, sum, low, high, filter, nearest }
    }

    fn at(&self, sample: i64) -> f32 {
        if self.nearest { return 1.0; }
        let value = weight(self.filter, (sample as f64 - self.center) / self.stretch);
        (if self.sum.abs() > 1e-12 { value / self.sum } else { value }) as f32
    }
}

fn buffer(length: usize) -> Result<Vec<f32>, String> {
    let mut values = Vec::new();
    values.try_reserve_exact(length).map_err(|_| ALLOCATION_ERROR.to_owned())?;
    values.resize(length, 0.0);
    Ok(values)
}

fn finish(mut output: Surface, destination: Rect, sx: f64, sy: f64, filter: Resample) -> Result<Surface, String> {
    if filter == Resample::PreserveDetails && (sx > 1.0 || sy > 1.0) {
        let params = photocraft_algo::FilterParams::UnsharpMask { amount: 30.0, radius: 0.6 * sx.max(sy) as f32, threshold: 0.0 };
        let photocraft_algo::Halo::Radius(halo) = params.halo() else { return Err(LIMIT_ERROR.into()); };
        let content = output.content_bounds();
        if !content.is_empty() {
            let h = i64::from(halo);
            let width = i64::from(content.x1) - i64::from(content.x0) + 2 * h;
            let height = i64::from(content.y1) - i64::from(content.y0) + 2 * h;
            let tile = 2048i64;
            if i64::from(content.x0) - 2 * h < i64::from(i32::MIN)
                || i64::from(content.y0) - 2 * h < i64::from(i32::MIN)
                || i64::from(content.x1) + 2 * h > i64::from(i32::MAX) - tile
                || i64::from(content.y1) + 2 * h > i64::from(i32::MAX) - tile
                || !raster_bounds_safe(i64::from(content.x0) - 2 * h, i64::from(content.y0) - 2 * h,
                    i64::from(content.x1) + 2 * h + tile, i64::from(content.y1) + 2 * h + tile)
                || !within_budget(&[width as u64, height as u64])
                || !within_budget(&[(width.min(tile) + 2 * h) as u64, (height.min(tile) + 2 * h) as u64, output.format().channels() as u64]) {
                return Err(LIMIT_ERROR.into());
            }
        }
        let area = photocraft_algo::output_area(&params, content, destination, None);
        output = photocraft_algo::apply(&output, &params, area, destination, None);
    }
    Ok(output)
}

pub(super) fn resize(source: &Surface, scale: f64) -> Result<Surface, String> {
    let destination = checked_geometry(source, scale, scale)?;
    if !destination.is_empty() && !native_safe(destination, scale, scale, source.format().channels(), Resample::Bicubic)
        && source.default_pixel().iter().any(|value| *value != 0.0) {
        return Err("Streamed placement requires a zero default pixel".into());
    }
    resize_xy(source, scale, scale, Resample::Bicubic)
}

pub(crate) fn resize_xy(source: &Surface, sx: f64, sy: f64, filter: Resample) -> Result<Surface, String> {
    let destination = checked_geometry(source, sx, sy)?;
    if destination.is_empty() { return Ok(Surface::with_default(source.format(), &source.default_pixel())); }
    let base_filter = if filter == Resample::PreserveDetails { Resample::Lanczos } else { filter };
    let output = if native_safe(destination, sx, sy, source.format().channels(), base_filter) {
        resize_surface(source, sx, sy, base_filter)
    } else { stream(source, destination, sx, sy, base_filter)? };
    finish(output, destination, sx, sy, filter)
}

#[cfg(test)]
pub(super) fn streamed(source: &Surface, scale: f64) -> Result<Surface, String> {
    if source.default_pixel().iter().any(|value| *value != 0.0) { return Err("Streamed placement requires a zero default pixel".into()); }
    streamed_xy(source, scale, scale, Resample::Bicubic)
}

#[cfg(test)]
pub(crate) fn streamed_xy(source: &Surface, sx: f64, sy: f64, filter: Resample) -> Result<Surface, String> {
    let destination = checked_geometry(source, sx, sy)?;
    if destination.is_empty() { return Ok(Surface::with_default(source.format(), &source.default_pixel())); }
    finish(stream(source, destination, sx, sy, filter)?, destination, sx, sy, filter)
}

fn horizontal(row: Option<&[f32]>, defaults: &[f32], kernels: &[Kernel], bounds: Rect, zero: bool, output: &mut [f32]) {
    let channels = defaults.len();
    output.fill(0.0);
    for (x, kernel) in kernels.iter().enumerate() {
        let target = &mut output[x * channels..(x + 1) * channels];
        let (low, high) = if zero { (kernel.low.max(i64::from(bounds.x0)), kernel.high.min(i64::from(bounds.x1))) }
            else { (kernel.low, kernel.high) };
        for sample in low..high {
            let pixel = match row {
                Some(row) if sample >= i64::from(bounds.x0) && sample < i64::from(bounds.x1) => {
                    let start = (sample - i64::from(bounds.x0)) as usize * channels;
                    &row[start..start + channels]
                }
                _ => defaults,
            };
            let value = kernel.at(sample);
            for channel in 0..channels { target[channel] += pixel[channel] * value; }
        }
    }
}

fn stream(source: &Surface, destination: Rect, sx: f64, sy: f64, filter: Resample) -> Result<Surface, String> {
    let format = source.format();
    let defaults = source.default_pixel();
    let bounds = source.content_bounds();
    let mut output = Surface::with_default(format, &defaults);
    let channels = format.channels();
    let mut premultiplied = defaults.clone();
    premultiply(&mut premultiplied, channels, format.alpha);
    let zero = premultiplied.iter().all(|value| *value == 0.0);
    let row_length = (bounds.width() as usize).checked_mul(channels).ok_or(ALLOCATION_ERROR)?;
    let result_length = (destination.width() as usize).checked_mul(channels).ok_or(ALLOCATION_ERROR)?;
    let mut row = buffer(row_length)?;
    let mut samples = buffer(result_length)?;
    let mut default_row = buffer(result_length)?;
    let mut result = buffer(result_length)?;
    let mut kernels = Vec::new();
    kernels.try_reserve_exact(destination.width() as usize).map_err(|_| ALLOCATION_ERROR.to_owned())?;
    for x in destination.x0..destination.x1 { kernels.push(Kernel::new(x, sx, filter)); }
    if !zero { horizontal(None, &premultiplied, &kernels, bounds, false, &mut default_row); }
    for y in destination.y0..destination.y1 {
        result.fill(0.0);
        let vertical = Kernel::new(y, sy, filter);
        let (low, high) = if zero { (vertical.low.max(i64::from(bounds.y0)), vertical.high.min(i64::from(bounds.y1))) }
            else { (vertical.low, vertical.high) };
        for source_y in low..high {
            let horizontal_row = if source_y >= i64::from(bounds.y0) && source_y < i64::from(bounds.y1) {
                source.read_region_into(Rect::new(bounds.x0, source_y as i32, bounds.x1, source_y as i32 + 1), &mut row);
                premultiply(&mut row, channels, format.alpha);
                horizontal(Some(&row), &premultiplied, &kernels, bounds, zero, &mut samples);
                &samples
            } else { &default_row };
            let value = vertical.at(source_y);
            for (target, sample) in result.iter_mut().zip(horizontal_row) { *target += sample * value; }
        }
        if format.alpha { for pixel in result.chunks_exact_mut(channels) { pixel[channels - 1] = pixel[channels - 1].clamp(0.0, 1.0); } }
        unpremultiply(&mut result, channels, format.alpha);
        output.write_region(Rect::new(destination.x0, y, destination.x1, y + 1), &result);
    }
    output.prune();
    Ok(output)
}

#[cfg(test)]
#[path = "xdesign_photo_resample_tests.rs"]
mod tests;
