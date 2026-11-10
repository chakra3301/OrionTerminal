use super::{display, render_view_preview, PhotoViewPreview};
use base64::Engine;
use photocraft_engine::{doc::Surface, DocState};
use serde_json::Value;

pub(super) const COMMANDS: [&str; 3] =
    ["select.refineEdge", "select.focusArea", "select.colorRange"];
pub(super) fn validate(view: &str) -> Result<(), String> {
    if ["mask", "overlay", "black", "white", "transparent", "result"].contains(&view) {
        Ok(())
    } else {
        Err("Choose a supported selection preview view".into())
    }
}
pub(super) fn params(command: &str, mut params: Value, view: &str) -> Result<Value, String> {
    // Edge views inspect the native refined coverage before output conversion.
    if command == "select.refineEdge" && view != "result" {
        if !["selection", "layerMask", "newLayer", "newLayerWithMask"].contains(
            &params
                .get("output")
                .and_then(Value::as_str)
                .unwrap_or("selection"),
        ) {
            return Err("Choose a supported Select and Mask output".into());
        }
        params["output"] = Value::String("selection".into());
        params["decontaminate"] = Value::Bool(false);
    }
    Ok(params)
}
fn coverage(surface: Option<&Surface>, x0: u32, y0: u32, x1: u32, y1: u32, row: &mut [f32]) -> f32 {
    let Some(surface) = surface else {
        return 0.0;
    };
    let mut sum = 0.0f64;
    for y in y0..y1 {
        let mut x = x0;
        while x < x1 {
            let length = (x1 - x).min(row.len() as u32) as usize;
            surface.sample_row_strided(y as i32, x as i32, 1, 0, &mut row[..length]);
            sum += row[..length]
                .iter()
                .map(|value| f64::from(value.clamp(0.0, 1.0)))
                .sum::<f64>();
            x += length as u32;
        }
    }
    (sum / f64::from((x1 - x0) * (y1 - y0))) as f32
}
fn span(index: u32, source: u32, output: u32) -> (u32, u32) {
    let start = (u64::from(index) * u64::from(source) / u64::from(output)) as u32;
    let end = (u64::from(index + 1) * u64::from(source) / u64::from(output)) as u32;
    (start, end.max(start + 1).min(source))
}
pub(super) fn render(state: &DocState, view: &str) -> Result<PhotoViewPreview, String> {
    render_with_color(state,view,None)
}
pub(super) fn render_with_color(state:&DocState,view:&str,color:Option<&super::display::View>)->Result<PhotoViewPreview,String>{
    validate(view)?;
    let doc = &state.doc;
    if view == "result" {
        return super::render_color_view_preview(doc, &Default::default(),color);
    }
    let factor = doc.size.width.max(doc.size.height).div_ceil(2048).max(1);
    let width = doc.size.width.div_ceil(factor);
    let height = doc.size.height.div_ceil(factor);
    let mut rgba = if view == "mask" {
        vec![0; width as usize * height as usize * 4]
    } else {
        {let buffer=photocraft_compose::render_reduced(doc,width,height);match color{Some(color)=>color.rgba(&buffer),None=>display::rgba(doc,&buffer)?}}.pixels
    };
    let mut row = vec![0.0; 4096];
    for y in 0..height {
        for x in 0..width {
            let (x0, x1) = span(x, doc.size.width, width);
            let (y0, y1) = span(y, doc.size.height, height);
            let selected = coverage(doc.selection.as_ref(), x0, y0, x1, y1, &mut row);
            let pixel = &mut rgba[((y * width + x) * 4) as usize..][..4];
            if view == "mask" {
                let gray = (selected * 255.0).round() as u8;
                pixel.copy_from_slice(&[gray, gray, gray, 255]);
            } else if view == "transparent" {
                pixel[3] = (f32::from(pixel[3]) * selected).round() as u8;
            } else if view == "overlay" {
                let tint = (1.0 - selected) * 0.5;
                let base = f32::from(pixel[3]) / 255.0 * (1.0 - tint);
                let total = tint + base;
                if total > 0.0 {
                    for c in 0..3 {
                        pixel[c] = (((if c == 0 { 255.0 } else { 0.0 }) * tint
                            + f32::from(pixel[c]) * base)
                            / total)
                            .round() as u8;
                    }
                }
                pixel[3] = (total * 255.0).round() as u8;
            } else {
                let alpha = f32::from(pixel[3]) / 255.0 * selected;
                let background = if view == "white" { 255.0 } else { 0.0 };
                for c in 0..3 {
                    pixel[c] =
                        (f32::from(pixel[c]) * alpha + background * (1.0 - alpha)).round() as u8;
                }
                pixel[3] = 255;
            }
        }
    }
    let image = photocraft_codecs::Image::from_u8(
        width,
        height,
        photocraft_codecs::ChannelLayout::Rgba,
        rgba,
    )
    .map_err(|error| error.to_string())?;
    let png =
        photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &photocraft_codecs::EncodeOptions { png_compression: photocraft_codecs::PngCompression::Fast, ..Default::default() })
            .map_err(|error| error.to_string())?;
    Ok(PhotoViewPreview {
        width,
        height,
        png: base64::engine::general_purpose::STANDARD.encode(png),
        result: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::{
        doc::{ColorMode, PixelFormat, Rect, SampleType},
        Session,
    };
    use serde_json::json;
    const GRAY_FLOAT: PixelFormat = PixelFormat {
        mode: ColorMode::Grayscale,
        sample: SampleType::F32,
        alpha: false,
    };
    fn pixels(preview: PhotoViewPreview) -> Vec<u8> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(preview.png)
            .unwrap();
        photocraft_codecs::decode(&bytes)
            .unwrap()
            .as_u8()
            .unwrap()
            .to_vec()
    }
    #[test]
    fn selection_workspaces_views_keep_soft_coverage_alpha_and_source_state() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":4,"height":2,"background":"transparent"}),
            )
            .unwrap();
        engine
            .edit("Selection view fixture", |doc, _| {
                let bounds = doc.bounds();
                doc.layers[0]
                    .surface_mut()
                    .unwrap()
                    .fill_rect(bounds, &[0.25, 0.5, 0.75, 0.5]);
                let mut mask = Surface::new(GRAY_FLOAT);
                mask.fill_rect(bounds, &[0.25]);
                doc.selection = Some(mask);
                Ok(())
            })
            .unwrap();
        let state = engine.active().unwrap();
        let source = state.doc.clone();
        let history = state.history.entries().to_vec();
        let original = display::rgba(
            &state.doc,
            &photocraft_compose::render_reduced(&state.doc, 4, 2),
        )
        .unwrap()
        .pixels;
        assert_eq!(
            pixels(render(state, "mask").unwrap())[..4],
            [64, 64, 64, 255]
        );
        let transparent = pixels(render(state, "transparent").unwrap());
        assert_eq!(&transparent[..3], &original[..3]);
        assert_eq!(
            transparent[3],
            (f32::from(original[3]) * 0.25).round() as u8
        );
        for view in ["black", "white"] {
            let rendered = pixels(render(state, view).unwrap());
            let alpha = f32::from(original[3]) / 255.0 * 0.25;
            for c in 0..3 {
                assert_eq!(
                    rendered[c],
                    (f32::from(original[c]) * alpha
                        + if view == "white" {
                            255.0 * (1.0 - alpha)
                        } else {
                            0.0
                        })
                    .round() as u8
                );
            }
            assert_eq!(rendered[3], 255);
        }
        let overlay = pixels(render(state, "overlay").unwrap());
        let base = f32::from(original[3]) / 255.0 * 0.625;
        let total = 0.375 + base;
        assert_eq!(
            overlay[0],
            ((255.0 * 0.375 + f32::from(original[0]) * base) / total).round() as u8
        );
        assert_eq!(
            overlay[1],
            (f32::from(original[1]) * base / total).round() as u8
        );
        assert_eq!(overlay[3], (total * 255.0).round() as u8);
        assert_eq!(
            render(state, "result").unwrap().png,
            render_view_preview(&state.doc, &Default::default())
                .unwrap()
                .png
        );
        assert!(render(state, "unknown").is_err());
        assert!(std::sync::Arc::ptr_eq(
            &source,
            &engine.active().unwrap().doc
        ));
        assert_eq!(history, engine.active().unwrap().history.entries());
    }
    #[test]
    fn selection_workspaces_reduction_matches_native_cells_with_bounded_row_reads() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":4097,"height":3,"background":"#0000ff"}),
            )
            .unwrap();
        engine
            .edit("Reduced selection fixture", |doc, _| {
                let mut mask = Surface::new(GRAY_FLOAT);
                mask.fill_rect(Rect::new(2, 0, 3, 3), &[1.0]);
                doc.selection = Some(mask);
                doc.layers[0]
                    .surface_mut()
                    .unwrap()
                    .fill_rect(Rect::new(2, 0, 3, 3), &[1.0, 0.0, 0.0, 1.0]);
                Ok(())
            })
            .unwrap();
        let state = engine.active().unwrap();
        let rendered = render(state, "mask").unwrap();
        assert_eq!((rendered.width, rendered.height), (1366, 1));
        let mask = pixels(rendered);
        assert_eq!(mask[..4], [0, 0, 0, 255]);
        assert_eq!(mask[4..8], [85, 85, 85, 255]);
        let source = display::rgba(
            &state.doc,
            &photocraft_compose::render_reduced(&state.doc, 1366, 1),
        )
        .unwrap()
        .pixels;
        let black = pixels(render(state, "black").unwrap());
        assert_eq!(black[..4], [0, 0, 0, 255]);
        for c in 0..3 {
            assert_eq!(black[4 + c], (f32::from(source[4 + c]) / 3.0).round() as u8);
        }
        let mut surface = Surface::new(GRAY_FLOAT);
        surface.fill_rect(Rect::new(0, 0, 8193, 2), &[0.5]);
        let mut row = vec![0.0; 4096];
        assert_eq!(coverage(Some(&surface), 0, 0, 8193, 2, &mut row), 0.5);
        assert_eq!(row.len(), 4096);
        assert_eq!(span(0, 4097, 1366), (0, 2));
        assert_eq!(span(1, 4097, 1366), (2, 5));
        assert_eq!(span(1365, 4097, 1366), (4094, 4097));
    }
}
