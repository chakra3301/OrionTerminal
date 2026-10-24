//! Read-only, multiresolution presentation. Source pixels are averaged in bounded
//! bands, after channel/mask presentation, without a full-document composite.
use super::{view, PhotoTile};
use base64::Engine;
use photocraft_compose::Buffer;
use photocraft_engine::{
    channel_cmds::ChannelView,
    doc::{Document, Rect},
};

pub(super) fn validate_dimensions(width: u32, height: u32, scale: u32) -> Result<(), String> {
    if !scale.is_power_of_two()
        || scale > 64
        || width == 0
        || height == 0
        || width > 512 * scale
        || height > 512 * scale
    {
        return Err("Invalid image tile; use a power-of-two scale from 1 to 64 and at most 512 output pixels per edge".into());
    }
    Ok(())
}

pub(super) fn png(width: u32, height: u32, pixels: Vec<u8>) -> Result<String, String> {
    let image = photocraft_codecs::Image::from_u8(
        width,
        height,
        photocraft_codecs::ChannelLayout::Rgba,
        pixels,
    )
    .map_err(|e| e.to_string())?;
    let bytes =
        // Display tiles are decoded once and discarded: zlib's fast level is ~5x quicker to
        // encode on photographic pixels than the default, which is what kept brush and eraser
        // feedback from tracking the pointer.
        photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &photocraft_codecs::EncodeOptions { png_compression: photocraft_codecs::PngCompression::Fast, ..Default::default() })
            .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub(super) fn reduced(
    doc: &Document,
    channels: Option<&ChannelView>,
    rect: Rect,
    scale: u32,
) -> Buffer {
    let out_rect = Rect::from_xywh(
        0,
        0,
        rect.width().div_ceil(scale),
        rect.height().div_ceil(scale),
    );
    let mut out = Buffer::transparent(out_rect);
    // 4096 × 256 source pixels per band (~16 MiB of RGBA floats).
    // Each column is aligned with the reduction grid. No giant coordinate map.
    let composite = channels.is_none_or(|c| view::needs_composite(doc, c));
    for x in (rect.x0..rect.x1).step_by(4096) {
        let column = Rect::new(x, rect.y0, (x + 4096).min(rect.x1), rect.y1);
        let mut consume = |buffer: Buffer| {
            let source = buffer.rect;
            let buffer = match channels {
                Some(c) => view::present(doc, c, buffer, source, 1),
                None => buffer,
            };
            for (i, pixel) in buffer.px.iter().enumerate() {
                let dx = (source.x0 - rect.x0) as usize + i % source.width() as usize;
                let dy = (source.y0 - rect.y0) as usize + i / source.width() as usize;
                let target = &mut out.px
                    [dy / scale as usize * out_rect.width() as usize + dx / scale as usize];
                let a = pixel[3].clamp(0.0, 1.0);
                for c in 0..3 {
                    target[c] += pixel[c] * a;
                }
                target[3] += a;
            }
            Ok::<(), std::convert::Infallible>(())
        };
        if composite {
            photocraft_compose::render_bands(doc, column, 256, &mut consume).unwrap();
        } else {
            for y in (column.y0..column.y1).step_by(256) {
                consume(Buffer::transparent(Rect::new(
                    column.x0,
                    y,
                    column.x1,
                    (y + 256).min(column.y1),
                )))
                .unwrap();
            }
        }
    }
    for (i, pixel) in out.px.iter_mut().enumerate() {
        let x = (i % out_rect.width() as usize) as u32 * scale;
        let y = (i / out_rect.width() as usize) as u32 * scale;
        let count = (rect.width() - x).min(scale) * (rect.height() - y).min(scale);
        if pixel[3] > 0.0 {
            for c in 0..3 {
                pixel[c] /= pixel[3];
            }
            pixel[3] /= count as f32;
        }
    }
    out
}

fn selection(
    doc: &Document,
    rect: Rect,
    scale: u32,
    overlay: bool,
) -> Result<(String, bool, Option<String>), String> {
    use std::fmt::Write;
    let Some(surface) = doc.selection.as_ref() else {
        return Ok((String::new(), false, None));
    };
    let width = rect.width().div_ceil(scale) as usize;
    let height = rect.height().div_ceil(scale) as usize;
    let stride = width + 2;
    let mut values = vec![0f32; stride * (height + 2)];
    let mut counts = vec![0u32; values.len()];
    let step = scale as i32;
    let origin_x = rect.x0 - step;
    let origin_y = rect.y0 - step;
    let left = origin_x.max(0);
    let right = (rect.x0 + (width as i32 + 1) * step).min(doc.size.width as i32);
    let top = origin_y.max(0);
    let bottom = (rect.y0 + (height as i32 + 1) * step).min(doc.size.height as i32);
    let channels = surface.channels();
    let mut row = Vec::new();
    // Read one bounded source row at a time, including neighboring cells so a
    // tile boundary is never mistaken for a selection boundary.
    for y in top..bottom {
        surface.read_region_into(Rect::new(left, y, right, y + 1), &mut row);
        for (i, pixel) in row.chunks_exact(channels).enumerate() {
            let cell = ((y - origin_y) / step) as usize * stride
                + ((left + i as i32 - origin_x) / step) as usize;
            values[cell] += pixel[0].clamp(0.0, 1.0);
            counts[cell] += 1;
        }
    }
    for (value, count) in values.iter_mut().zip(counts) {
        if count > 0 {
            *value /= count as f32;
        }
    }
    let selected = |x: usize, y: usize| values[y * stride + x] >= 0.5;
    let sx = |x: usize| (x as u32 * scale).min(rect.width());
    let sy = |y: usize| (y as u32 * scale).min(rect.height());
    let mut path = String::new();
    let mut segments = 0;
    let mut truncated = false;
    'contours: for horizontal in [true, false] {
        let (across, along) = if horizontal {
            (height, width)
        } else {
            (width, height)
        };
        for a in 0..=across {
            let mut start = None;
            for b in 0..=along {
                let edge = b < along
                    && if horizontal {
                        selected(b + 1, a) != selected(b + 1, a + 1)
                    } else {
                        selected(a, b + 1) != selected(a + 1, b + 1)
                    };
                if edge && start.is_none() {
                    start = Some(b);
                }
                if !edge {
                    if let Some(first) = start.take() {
                        if horizontal {
                            let _ = write!(path, "M{} {}H{}", sx(first), sy(a), sx(b));
                        } else {
                            let _ = write!(path, "M{} {}V{}", sx(a), sy(first), sy(b));
                        }
                        segments += 1;
                        if segments > 16_384 {
                            truncated = true;
                            path.clear();
                            break 'contours;
                        }
                    }
                }
            }
        }
    }
    // Complex contours fall back to coverage rather than disappearing. Coverage
    // also represents feathering and selections too soft to cross 50%.
    let selection_png = if overlay || truncated {
        let mut pixels = Vec::with_capacity(width * height * 4);
        for y in 1..=height {
            for x in 1..=width {
                pixels.extend_from_slice(&[
                    45,
                    165,
                    255,
                    (values[y * stride + x] * 115.0).round() as u8,
                ]);
            }
        }
        Some(png(width as u32, height as u32, pixels)?)
    } else {
        None
    };
    Ok((path, truncated, selection_png))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render(
    doc: &Document,
    channels: Option<&ChannelView>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    scale: u32,
    selection_only: bool,
    overlay: bool,
) -> Result<PhotoTile, String> {
    render_with_color(doc,channels,None,x,y,width,height,scale,selection_only,overlay)
}
pub(super) fn render_with_color(
    doc: &Document,
    channels: Option<&ChannelView>,
    color: Option<&super::display::View>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    scale: u32,
    selection_only: bool,
    overlay: bool,
) -> Result<PhotoTile, String> {
    render_internal(doc, channels, color, x, y, width, height, scale, selection_only, overlay, true)
}

pub(super) fn render_color_region(doc: &Document, channels: &ChannelView, color: Option<&super::display::View>, x: u32, y: u32, width: u32, height: u32, scale: u32) -> Result<PhotoTile, String> {
    render_internal(doc, Some(channels), color, x, y, width, height, scale, false, false, false)
}

pub(super) fn rgba(doc: &Document, channels: Option<&ChannelView>, color: Option<&super::display::View>, rect: Rect, scale: u32) -> Result<Vec<u8>, String> {
    let buffer = if scale == 1 {
        let buffer = if channels.is_some_and(|c| !view::needs_composite(doc, c)) {
            Buffer::transparent(rect)
        } else {
            photocraft_compose::render(doc, rect)
        };
        match channels {
            Some(c) => view::present(doc, c, buffer, rect, 1),
            None => buffer,
        }
    } else {
        reduced(doc, channels, rect, scale)
    };
    let rgba=if channels.is_none_or(|c|c.is_plain(doc)) {match color{Some(color)=>color.rgba(&buffer),None=>super::display::rgba(doc,&buffer)?}}else{buffer.to_rgba8()};
    Ok(rgba.pixels)
}

#[allow(clippy::too_many_arguments)]
fn render_internal(doc: &Document, channels: Option<&ChannelView>, color: Option<&super::display::View>, x: u32, y: u32, width: u32, height: u32, scale: u32, selection_only: bool, overlay: bool, selection_feedback: bool) -> Result<PhotoTile, String> {
    validate_dimensions(width, height, scale)?;
    if x >= doc.size.width || y >= doc.size.height {
        return Err("Image tile is outside the document".into());
    }
    let rect = Rect::from_xywh(
        x as i32,
        y as i32,
        width.min(doc.size.width - x),
        height.min(doc.size.height - y),
    );
    let pixel_width = rect.width().div_ceil(scale);
    let pixel_height = rect.height().div_ceil(scale);
    let color = if selection_only {
        String::new()
    } else {
        png(pixel_width, pixel_height, rgba(doc, channels, color, rect, scale)?)?
    };
    let (selection_path, selection_truncated, selection_png) =
        if selection_feedback { selection(doc, rect, scale, overlay)? } else { (String::new(), false, None) };
    Ok(PhotoTile {
        x,
        y,
        width: rect.width(),
        height: rect.height(),
        png: color,
        selection_path,
        selection_truncated,
        scale,
        pixel_width,
        pixel_height,
        selection_png,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::PixelFormat;
    use photocraft_engine::doc::Surface;
    use photocraft_engine::Session;
    use serde_json::json;
    use std::sync::Arc;

    fn pixels(encoded: &str) -> Vec<u8> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        photocraft_codecs::decode(&bytes)
            .unwrap()
            .as_u8()
            .unwrap()
            .to_vec()
    }
    fn image(width: u32, height: u32) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":width,"height":height,"background":"transparent"}),
            )
            .unwrap();
        engine
    }

    #[test]
    fn color_regions_preserve_pixels_without_generating_unused_selection_feedback() {
        let mut engine = image(512, 512);
        let doc = Arc::make_mut(&mut engine.active_mut().unwrap().doc);
        let mut coverage = Surface::new(PixelFormat::GRAY8);
        let values: Vec<_> = (0..512 * 512).map(|index| if index % 512 % 3 == 1 && index / 512 % 3 == 1 { 1.0 } else { 0.0 }).collect();
        coverage.write_region(Rect::from_xywh(0, 0, 512, 512), &values); doc.selection = Some(coverage);
        let original = doc.clone();
        let legacy = render_with_color(doc, Some(&Default::default()), None, 0, 0, 512, 512, 1, false, false).unwrap();
        assert!(legacy.selection_truncated); assert!(legacy.selection_png.is_some());
        let region = render_color_region(doc, &Default::default(), None, 0, 0, 512, 512, 1).unwrap();
        assert_eq!(region.png, legacy.png); assert!(region.selection_path.is_empty()); assert!(!region.selection_truncated); assert!(region.selection_png.is_none());
        assert_eq!((region.x, region.y, region.width, region.height, region.scale, region.pixel_width, region.pixel_height), (0, 0, 512, 512, 1, 512, 512));
        assert_eq!(*doc, original);
    }

    #[test]
    fn reduced_pixels_match_premultiplied_area_average_including_partial_cells() {
        let mut engine = image(7, 5);
        engine.execute("paint.stroke", json!({"points":[[2,2,1],[5,3,1]],"size":3,"hardness":0.4,"opacity":0.6,"color":"#ff2040","seed":17})).unwrap();
        let state = engine.active().unwrap();
        let revision = state.revision;
        let full = photocraft_compose::render(&state.doc, Rect::from_xywh(0, 0, 7, 5));
        let tile = render(&state.doc, None, 0, 0, 7, 5, 2, false, false).unwrap();
        assert_eq!((tile.pixel_width, tile.pixel_height), (4, 3));
        let mut expected = Buffer::transparent(Rect::from_xywh(0, 0, 4, 3));
        for y in 0..3 {
            for x in 0..4 {
                let mut sum = [0f32; 4];
                let mut count = 0;
                for sy in y * 2..(y * 2 + 2).min(5) {
                    for sx in x * 2..(x * 2 + 2).min(7) {
                        let p = full.get(sx, sy);
                        for c in 0..3 {
                            sum[c] += p[c] * p[3];
                        }
                        sum[3] += p[3];
                        count += 1;
                    }
                }
                if sum[3] > 0.0 {
                    for c in 0..3 {
                        sum[c] /= sum[3];
                    }
                    sum[3] /= count as f32;
                }
                expected.px[(y * 4 + x) as usize] = sum;
            }
        }
        assert_eq!(pixels(&tile.png), expected.to_rgba8().pixels);
        assert_eq!(engine.active().unwrap().revision, revision);
    }

    #[test]
    fn reduced_channel_views_average_coverage_before_reduction() {
        let mut engine = image(4, 2);
        engine
            .execute("channel.new", json!({"name":"Coverage"}))
            .unwrap();
        engine
            .execute("channel.target", json!({"channel":0}))
            .unwrap();
        let state = engine.active_mut().unwrap();
        let doc = Arc::make_mut(&mut state.doc);
        doc.channels[0].surface.write_region(
            Rect::from_xywh(0, 0, 4, 2),
            &[0., 1., 0., 1., 0., 1., 0., 1.],
        );
        let tile = render(
            &state.doc,
            Some(&state.channel_view),
            0,
            0,
            4,
            2,
            2,
            false,
            false,
        )
        .unwrap();
        assert_eq!(
            pixels(&tile.png),
            vec![128, 128, 128, 255, 128, 128, 128, 255]
        );
    }

    #[test]
    fn selection_coverage_keeps_feathering_holes_image_edges_and_tile_neighbors() {
        let mut engine = image(7, 5);
        let doc = Arc::make_mut(&mut engine.active_mut().unwrap().doc);
        let mut mask = Surface::new(PixelFormat::GRAY8);
        mask.write_region(Rect::from_xywh(0, 0, 7, 5), &vec![1.; 35]);
        mask.write_region(Rect::from_xywh(2, 2, 2, 2), &[0.; 4]);
        mask.write_pixel(6, 4, &[0.25]);
        doc.selection = Some(mask);
        let tile = render(doc, None, 0, 0, 7, 5, 2, true, true).unwrap();
        assert!(tile.png.is_empty());
        assert!(tile.selection_path.contains("M0 0H7"));
        assert!(tile.selection_path.contains("M2 2H4"));
        assert!(tile.selection_path.contains("M2 2V4"));
        let coverage = pixels(tile.selection_png.as_ref().unwrap());
        assert_eq!(coverage[3], 115);
        assert_eq!(coverage[(4 + 1) * 4 + 3], 0);
        assert_eq!(*coverage.last().unwrap(), 29);
        let neighbor = render(doc, None, 2, 0, 4, 4, 2, true, false).unwrap();
        assert!(!neighbor.selection_path.contains("M0 0V"));
        assert!(neighbor.selection_path.contains("M0 2V4"));
    }

    #[test]
    fn large_selection_only_tiles_remain_bounded_and_do_not_compose_color() {
        let mut engine = image(32768, 64);
        engine.execute("select.all", json!({})).unwrap();
        let state = engine.active().unwrap();
        let tile = render(&state.doc, None, 0, 0, 32768, 64, 64, true, true).unwrap();
        assert_eq!((tile.pixel_width, tile.pixel_height), (512, 1));
        assert!(tile.png.is_empty());
        assert!(tile.selection_path.contains("M0 0H32768"));
        assert_eq!(pixels(tile.selection_png.as_ref().unwrap()).len(), 512 * 4);
        for scale in [0, 3, 65, 128, u32::MAX] {
            assert!(validate_dimensions(10, 10, scale).is_err());
        }
        assert!(validate_dimensions(1025, 10, 2).is_err());
        assert!(render(&state.doc, None, 32768, 0, 1, 1, 1, true, false).is_err());
    }

    #[test]
    fn complex_contours_fall_back_to_bounded_coverage() {
        let mut engine = image(256, 256);
        let doc = Arc::make_mut(&mut engine.active_mut().unwrap().doc);
        let mut mask = Surface::new(PixelFormat::GRAY8);
        let values: Vec<f32> = (0..256 * 256)
            .map(|i| {
                if i / 256 % 3 == 1 && i % 256 % 3 == 1 {
                    1.
                } else {
                    0.
                }
            })
            .collect();
        mask.write_region(Rect::from_xywh(0, 0, 256, 256), &values);
        doc.selection = Some(mask);
        let tile = render(doc, None, 0, 0, 256, 256, 1, true, false).unwrap();
        assert!(tile.selection_truncated);
        assert!(tile.selection_path.is_empty());
        assert_eq!(
            pixels(tile.selection_png.as_ref().unwrap()).len(),
            256 * 256 * 4
        );
    }
}
