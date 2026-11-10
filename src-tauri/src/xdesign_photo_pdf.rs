use photocraft_engine::doc::{ColorMode, Document};
use photocraft_engine::print_cmds::{print_pdf, Marks, PrintImage, PrintPage};
use photocraft_engine::Session;
use serde_json::json;

/// Save a Copy as Photoshop PDF: one page the size of the image at its resolution, holding the
/// flattened composite with the document's colour profile, as the engine's printer-managed print does.
pub(super) fn photoshop_pdf(doc: &Document) -> Result<Vec<u8>, String> {
    let mut temp = Session::new();
    temp.add_document(doc.clone(), None);
    if !matches!(doc.mode, ColorMode::Rgb | ColorMode::Grayscale | ColorMode::Cmyk) {
        temp.execute("image.mode.rgb", json!({})).map_err(|e| e.to_string())?;
    }
    let d = &temp.active().ok_or("No image document")?.doc;
    let icc = d.icc_profile.as_ref().map(|v| v.to_vec());
    let to8 = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    let (width, height) = (d.size.width, d.size.height);
    let image = if matches!(d.mode, ColorMode::Rgb | ColorMode::Grayscale) {
        let gray = d.mode == ColorMode::Grayscale;
        let buf = photocraft_compose::flatten(d).over_background([1.0, 1.0, 1.0]);
        let data = if gray { buf.px.iter().map(|p| to8(p[0])).collect() } else { buf.px.iter().flat_map(|p| [to8(p[0]), to8(p[1]), to8(p[2])]).collect() };
        PrintImage { width, height, channels: if gray { 1 } else { 3 }, data, icc }
    } else {
        temp.execute("layer.flattenImage", json!({})).map_err(|e| e.to_string())?;
        let d = &temp.active().ok_or("No image document")?.doc;
        let fmt = d.pixel_format();
        let (k, n) = (fmt.mode.color_channels(), fmt.channels());
        let surface = d.layers.first().and_then(|l| l.surface()).ok_or("The image has no pixels")?;
        let data = surface.read_region(d.bounds()).chunks_exact(n).flat_map(|px| px[..k].iter().map(|&v| to8(v))).collect();
        PrintImage { width, height, channels: k, data, icc }
    };
    let dpi = Some(f64::from(doc.resolution_dpi)).filter(|dpi| *dpi > 0.0).unwrap_or(72.0);
    let paper = (f64::from(width) * 72.0 / dpi, f64::from(height) * 72.0 / dpi);
    Ok(print_pdf(&PrintPage { paper, image, rect: (0.0, 0.0, paper.0, paper.1), marks: Marks::default(), description: None, label: None }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pdf(mode: &str, width: u32, height: u32, resolution: f64) -> String {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": width, "height": height, "mode": mode, "resolution": resolution})).unwrap();
        String::from_utf8_lossy(&photoshop_pdf(&engine.active().unwrap().doc).unwrap()).into_owned()
    }

    #[test]
    fn saves_one_page_the_size_of_the_image_at_its_resolution() {
        let rgb = pdf("rgb", 300, 150, 150.0);
        assert!(rgb.starts_with("%PDF-"));
        assert!(rgb.contains("/MediaBox [0 0 144.00 72.00]"), "{rgb}");
        assert!(rgb.contains("/Width 300 /Height 150"), "{rgb}");
        assert!(rgb.contains("/Count 1"));
        assert!(rgb.contains("DeviceRGB"));
        let gray = pdf("gray", 72, 72, 72.0);
        assert!(gray.contains("/MediaBox [0 0 72.00 72.00]") && gray.contains("DeviceGray"), "{gray}");
        let cmyk = pdf("cmyk", 8, 4, 72.0);
        assert!(cmyk.contains("/MediaBox [0 0 8.00 4.00]") && cmyk.contains("DeviceCMYK"), "{cmyk}");
        let lab = pdf("lab", 8, 4, 72.0);
        assert!(lab.contains("/MediaBox [0 0 8.00 4.00]") && lab.contains("DeviceRGB"), "{lab}");
        assert!(pdf("rgb", 1, 1, 300.0).contains("/MediaBox [0 0 0.24 0.24]"));
    }
}
