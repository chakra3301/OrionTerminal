//! Workspace-only channel and mask presentation. Saved composites and exports
//! always use the normal compositor; these buffers never enter image history.
use photocraft_compose::Buffer;
use photocraft_engine::{
    channel_cmds::ChannelView,
    doc::{ColorMode, Document, Rect, Surface},
    mask_view_cmds::MaskViewMode,
};
use photocraft_raster::{from_rgba, to_rgba};

fn plane(surface: &Surface, rect: Rect, factor: u32) -> Vec<f32> {
    let width = rect.width().div_ceil(factor);
    let height = rect.height().div_ceil(factor);
    let mut values = vec![0.0; (width * height) as usize];
    for (y, row) in values.chunks_mut(width as usize).enumerate() {
        surface.sample_row_strided(
            rect.y0 + y as i32 * factor as i32,
            rect.x0,
            factor as i32,
            0,
            row,
        );
    }
    values
}

fn tint(
    buffer: &mut Buffer,
    values: &[f32],
    color: [f32; 3],
    opacity: f32,
    coverage: impl Fn(f32) -> f32,
) {
    for (pixel, value) in buffer.px.iter_mut().zip(values) {
        let alpha = (coverage(value.clamp(0.0, 1.0)) * opacity).clamp(0.0, 1.0);
        let base = pixel[3].clamp(0.0, 1.0) * (1.0 - alpha);
        let total = alpha + base;
        if total > 0.0 {
            for c in 0..3 {
                pixel[c] = (color[c] * alpha + pixel[c] * base) / total;
            }
        }
        pixel[3] = total;
    }
}

pub(super) fn needs_composite(doc: &Document, view: &ChannelView) -> bool {
    if matches!(view.shown_layer_mask(doc), Some((_, MaskViewMode::Gray))) {
        return false;
    }
    view.visible_colors(photocraft_engine::channel_cmds::color_count(doc)) > 0
}

pub(super) fn present(
    doc: &Document,
    view: &ChannelView,
    mut buffer: Buffer,
    rect: Rect,
    factor: u32,
) -> Buffer {
    if view.is_plain(doc) {
        return buffer;
    }
    let mask = view.shown_layer_mask(doc);
    if let Some((mask, MaskViewMode::Gray)) = mask {
        for (pixel, value) in buffer.px.iter_mut().zip(plane(&mask.surface, rect, factor)) {
            *pixel = [value, value, value, 1.0];
        }
        return buffer;
    }
    let colors = photocraft_engine::channel_cmds::color_count(doc);
    let shown: Vec<_> = (0..colors).filter(|c| view.color_visible(*c)).collect();
    let mut alpha = doc
        .channels
        .iter()
        .enumerate()
        .filter(|(i, _)| view.alpha_shown(*i))
        .map(|(_, c)| c);
    if shown.is_empty() {
        if let Some(first) = alpha.next() {
            for (pixel, value) in buffer
                .px
                .iter_mut()
                .zip(plane(&first.surface, rect, factor))
            {
                *pixel = [value, value, value, 1.0];
            }
        } else {
            buffer.px.fill([1.0; 4]);
        }
    } else if shown.len() < colors {
        let format = doc.pixel_format();
        for pixel in &mut buffer.px {
            let a = pixel[3].clamp(0.0, 1.0);
            let rgb = [
                pixel[0] * a + 1.0 - a,
                pixel[1] * a + 1.0 - a,
                pixel[2] * a + 1.0 - a,
                1.0,
            ];
            let mut native = from_rgba(&format, rgb);
            if shown.len() == 1 {
                let value = native[shown[0]];
                let gray = if format.mode == ColorMode::Cmyk {
                    1.0 - value
                } else {
                    value
                };
                *pixel = [gray, gray, gray, 1.0];
            } else {
                for (c, value) in native[..colors].iter_mut().enumerate() {
                    if !view.color_visible(c) {
                        *value = if format.mode == ColorMode::Lab && c > 0 {
                            0.5
                        } else {
                            0.0
                        };
                    }
                }
                *pixel = to_rgba(&format, &native);
                pixel[3] = 1.0;
            }
        }
    }
    for channel in alpha.chain(doc.quick_mask.iter().filter(|_| !view.quick_mask_hidden)) {
        let (color, opacity) = channel
            .spot
            .map(|(color, solidity)| (color, 0.5 + 0.5 * solidity))
            .unwrap_or((channel.color, channel.opacity));
        tint(
            &mut buffer,
            &plane(&channel.surface, rect, factor),
            color.to_rgb(),
            opacity,
            |v| channel.overlay_coverage(v),
        );
    }
    if let Some((mask, MaskViewMode::Overlay)) = mask {
        tint(
            &mut buffer,
            &plane(&mask.surface, rect, factor),
            [1.0, 0.0, 0.0],
            0.5,
            |v| 1.0 - v,
        );
    }
    buffer
}
