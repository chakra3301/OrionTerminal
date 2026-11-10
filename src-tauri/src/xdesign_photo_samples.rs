//! Eyedropper samples and histograms beyond the composite's RGB: a CMYK image's inks, and the grey
//! pixels of a layer mask, the Quick Mask or an alpha channel.
use photocraft_engine::doc::{BlendMode, ColorMode, Document, Layer, LayerContent, LayerId, Rect, Surface};
use serde_json::Value;
use std::sync::Arc;

const TARGET: &str = "target must be \"mask\", \"quickMask\" or {\"channel\": <alpha channel index>}";

enum Target {
    Mask(LayerId),
    QuickMask,
    Alpha(usize),
}

/// `xdesign_photo_sample` once the image is read: `[r, g, b]` 0-255, `[c, m, y, k]` 0-100 %, or one grey 0-255.
#[allow(clippy::too_many_arguments)]
pub(super) fn sample(doc: Arc<Document>, layer: Option<u64>, below: bool, above_hidden: Option<bool>, window: [u32; 4], space: Option<&str>, target: Option<&Value>) -> Result<Option<Vec<f32>>, String> {
    let cmyk = match space {
        None | Some("rgb") => false,
        Some("cmyk") => true,
        Some(_) => return Err("space must be rgb or cmyk".into()),
    };
    if let Some(target) = parse_target(target, layer)? {
        if space.is_some() { return Err("space applies to the image's colours, not to a target".into()); }
        let surface = plane(&doc, &target)?;
        let rect = sample_rect(&doc, window)?;
        let sum: f32 = (rect.y0..rect.y1).flat_map(|y| (rect.x0..rect.x1).map(move |x| (x, y))).map(|(x, y)| surface.sample_channel(x, y, 0).clamp(0.0, 1.0)).sum();
        return Ok(Some(vec![sum / (rect.width() * rect.height()) as f32 * 255.0]));
    }
    if cmyk && doc.mode != ColorMode::Cmyk { return Err("CMYK samples need a CMYK image".into()); }
    let mut doc = doc;
    // Current & Below: the layer stays and everything stacked over it goes.
    let (layer, below) = match layer.filter(|_| above_hidden == Some(true)) {
        Some(id) => {
            if !super::hide_above(&mut Arc::make_mut(&mut doc).layers, LayerId(id)) { return Err("That layer no longer exists".into()); }
            (None, false)
        }
        None => (layer, below),
    };
    let [x, y, width, height] = window;
    if !cmyk { return super::sample_layer_view(&doc, layer, below, x, y, width, height).map(|rgb| rgb.map(Vec::from)); }
    let rect = sample_rect(&doc, window)?;
    let shown = super::layer_view(&doc, layer, below)?;
    let (mut sum, mut coverage) = ([0f32; 4], 0f32);
    let mut add = |inks: &[f32], alpha: f32| {
        let alpha = alpha.clamp(0.0, 1.0);
        for (total, ink) in sum.iter_mut().zip(inks) { *total += ink.clamp(0.0, 1.0) * alpha; }
        coverage += alpha;
    };
    match ink_stack(&shown) {
        // Normal blending is linear in ink, so plain layers stack without leaving CMYK.
        Some(stack) => {
            let mut pixels = vec![[0f32; 5]; rect.width() as usize * rect.height() as usize];
            for surface in stack {
                for (out, pixel) in pixels.iter_mut().zip(surface.read_region(rect).chunks_exact(5)) {
                    let alpha = pixel[4].clamp(0.0, 1.0);
                    let under = out[4] * (1.0 - alpha);
                    let total = alpha + under;
                    if total > 0.0 { for channel in 0..4 { out[channel] = (pixel[channel].clamp(0.0, 1.0) * alpha + out[channel] * under) / total; } }
                    out[4] = total;
                }
            }
            for pixel in &pixels { add(&pixel[..4], pixel[4]); }
        }
        // Anything else composites in RGB, so its inks are what Flatten Image would separate it into.
        None => {
            let format = doc.pixel_format();
            for pixel in photocraft_compose::render(&shown, rect).px { add(&photocraft_raster::from_rgba(&format, pixel), pixel[3]); }
        }
    }
    Ok((coverage > 0.0).then(|| sum.iter().map(|value| value / coverage * 100.0).collect()))
}

/// `xdesign_photo_histogram` once the image is read; a target gives one grey histogram.
pub(super) fn histogram(doc: &Document, layer: Option<u64>, below: bool, space: &str, target: Option<&Value>) -> Result<Vec<Vec<u32>>, String> {
    let Some(target) = parse_target(target, layer)? else { return super::histograms(doc, layer, below, space) };
    let surface = plane(doc, &target)?;
    // The same density as the composite's 384 px thumbnail.
    let step = doc.size.width.max(doc.size.height).div_ceil(384).max(1);
    let mut bins = vec![0u32; 256];
    let mut row = vec![0f32; doc.size.width.div_ceil(step) as usize];
    for y in (0..doc.size.height).step_by(step as usize) {
        surface.sample_row_strided(y as i32, 0, step as i32, 0, &mut row);
        for value in &row { bins[(value.clamp(0.0, 1.0) * 255.0).round() as usize] += 1; }
    }
    Ok(vec![bins])
}

/// `xdesign_photo_auto_colors`: Find Dark & Light Colors' shadow and highlight colours and Snap Neutral
/// Midtones' nearly neutral average, 0-255, read from the pixels the histogram counts.
pub(super) fn auto_colors(doc: &Document, layer: Option<u64>, below: bool, shadow_clip: f64, highlight_clip: f64) -> Result<Value, String> {
    for (name, clip) in [("shadowClip", shadow_clip), ("highlightClip", highlight_clip)] {
        if !(0.0..=9.99).contains(&clip) { return Err(format!("{name} must be a percentage from 0 to 9.99")); }
    }
    let image = photocraft_compose::thumbnail(&super::layer_view(doc, layer, below)?, 384);
    // Threshold's Rec. 601 grey, as the luminosity histogram weighs it.
    let mut pixels: Vec<([f32; 3], f32)> = image.pixels.chunks_exact(4).filter(|pixel| pixel[3] > 0).map(|pixel| {
        let rgb = [pixel[0], pixel[1], pixel[2]].map(f32::from);
        (rgb, 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])
    }).collect();
    if pixels.is_empty() { return Err("There are no visible pixels to find colours in".into()); }
    pixels.sort_by(|a, b| a.1.total_cmp(&b.1));
    let count = |clip: f64| ((pixels.len() as f64 * clip / 100.0).round() as usize).clamp(1, pixels.len());
    let (dark, light) = (count(shadow_clip), count(highlight_clip));
    let mean = |set: &mut dyn Iterator<Item = [f32; 3]>| {
        let (sum, n) = set.fold(([0f32; 3], 0usize), |(sum, n), rgb| ([sum[0] + rgb[0], sum[1] + rgb[1], sum[2] + rgb[2]], n + 1));
        (n > 0).then(|| sum.map(|total| total / n as f32))
    };
    // Nearly neutral: under 25 % HSB saturation (the UI's Snap rule), outside the shadow and highlight sets.
    let middle = pixels.get(dark..pixels.len().saturating_sub(light)).unwrap_or_default();
    let neutral = mean(&mut middle.iter().map(|(rgb, _)| *rgb).filter(|rgb| {
        let (max, min) = (rgb[0].max(rgb[1]).max(rgb[2]), rgb[0].min(rgb[1]).min(rgb[2]));
        max > 0.0 && (max - min) / max < 0.25
    }));
    Ok(serde_json::json!({
        "dark": mean(&mut pixels[..dark].iter().map(|(rgb, _)| *rgb)),
        "light": mean(&mut pixels[pixels.len() - light..].iter().map(|(rgb, _)| *rgb)),
        "neutral": neutral,
    }))
}

fn parse_target(value: Option<&Value>, layer: Option<u64>) -> Result<Option<Target>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(name)) if name == "mask" => layer.map(|id| Some(Target::Mask(LayerId(id)))).ok_or_else(|| "a mask target needs the layer whose mask to read".into()),
        Some(Value::String(name)) if name == "quickMask" => Ok(Some(Target::QuickMask)),
        Some(Value::Object(object)) if object.len() == 1 => {
            let index = object.get("channel").and_then(Value::as_u64).and_then(|index| usize::try_from(index).ok()).ok_or(TARGET)?;
            Ok(Some(Target::Alpha(index)))
        }
        Some(_) => Err(TARGET.into()),
    }
}

fn plane<'a>(doc: &'a Document, target: &Target) -> Result<&'a Surface, String> {
    match target {
        Target::Mask(id) => doc.layer(*id).ok_or("That layer no longer exists")?.mask.as_ref().map(|mask| &mask.surface).ok_or_else(|| "That layer has no layer mask".into()),
        Target::QuickMask => doc.quick_mask.as_ref().map(|channel| &channel.surface).ok_or_else(|| "The image is not in Quick Mask mode".into()),
        Target::Alpha(index) => doc.channels.get(*index).map(|channel| &channel.surface).ok_or_else(|| format!("The image has no alpha channel {index}")),
    }
}

/// The eyedropper's window, as `sample_layer_view` reads it.
fn sample_rect(doc: &Document, [x, y, width, height]: [u32; 4]) -> Result<Rect, String> {
    let (right, bottom) = (x.saturating_add(width.clamp(1, 101)).min(doc.size.width), y.saturating_add(height.clamp(1, 101)).min(doc.size.height));
    if x >= right || y >= bottom { return Err("Sample inside the image".into()); }
    Ok(Rect::new(x as i32, y as i32, right as i32, bottom as i32))
}

/// The visible layers' stored inks, bottom first, when every one is a plain CMYK pixel layer: the
/// RGB composite would carry them through RGB and back, which changes the black generation.
fn ink_stack(shown: &Document) -> Option<Vec<&Surface>> {
    let stack: Option<Vec<&Surface>> = shown.layers.iter().filter(|layer| layer.visible).map(|layer| match &layer.content {
        LayerContent::Raster(surface) if plain(layer) && surface.format().mode == ColorMode::Cmyk && surface.format().alpha => Some(surface),
        _ => None,
    }).collect();
    stack.filter(|stack| !stack.is_empty())
}

fn plain(layer: &Layer) -> bool {
    !layer.clipped
        && layer.blend == BlendMode::Normal
        && layer.opacity >= 1.0
        && layer.fill_opacity >= 1.0
        && !layer.mask.as_ref().is_some_and(|mask| mask.enabled)
        && !layer.vector_mask.as_ref().is_some_and(|mask| mask.enabled)
        && !photocraft_compose::effects::has_effects(layer)
        && layer.excluded_channels == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Layer, LayerMask, Rect, SampleType, Size};
    use photocraft_engine::Session;
    use serde_json::json;

    /// A 4 × 4 CMYK image: a flat ink layer under an opaque black layer over its right half.
    fn cmyk_image() -> (Arc<Document>, u64, u64) {
        let mut doc = Document::new("Inks", Size::new(4, 4), ColorMode::Cmyk, SampleType::U8);
        let mut inks = Layer::raster("Inks", doc.pixel_format());
        inks.surface_mut().unwrap().write_region(doc.bounds(), &[0.5, 0.2, 0.1, 0.3, 1.0].repeat(16));
        let mut black = Layer::raster("Black", doc.pixel_format());
        black.surface_mut().unwrap().write_region(Rect::new(2, 0, 4, 4), &[0.0, 0.0, 0.0, 1.0, 1.0].repeat(8));
        let ids = (inks.id.0, black.id.0);
        doc.layers.push(inks);
        doc.layers.push(black);
        (Arc::new(doc), ids.0, ids.1)
    }

    fn close(actual: &[f32], expected: &[f32], tolerance: f32) -> bool {
        actual.len() == expected.len() && actual.iter().zip(expected).all(|(a, b)| (a - b).abs() <= tolerance)
    }

    #[test]
    fn cmyk_samples_read_the_documents_own_inks() {
        let (doc, inks, black) = cmyk_image();
        let cmyk = Some("cmyk");
        let flat = sample(doc.clone(), None, false, None, [0, 0, 2, 4], cmyk, None).unwrap().unwrap();
        assert!(close(&flat, &[50.0, 20.0, 10.0, 30.0], 0.5), "{flat:?}");
        let alone = sample(doc.clone(), Some(black), false, None, [3, 1, 1, 1], cmyk, None).unwrap().unwrap();
        assert!(close(&alone, &[0.0, 0.0, 0.0, 100.0], 1e-3), "a layer on its own reads its stored inks: {alone:?}");
        let under = sample(doc.clone(), Some(inks), false, Some(true), [3, 1, 1, 1], cmyk, None).unwrap().unwrap();
        assert!(close(&under, &[50.0, 20.0, 10.0, 30.0], 0.5), "Current & Below drops the black layer: {under:?}");
        let stacked = sample(doc.clone(), None, false, None, [2, 0, 2, 2], cmyk, None).unwrap().unwrap();
        assert!(close(&stacked, &[0.0, 0.0, 0.0, 100.0], 1e-3), "plain layers stack in ink: {stacked:?}");
        let mut veiled = (*doc).clone();
        veiled.layer_mut(LayerId(black)).unwrap().surface_mut().unwrap().write_region(Rect::new(2, 0, 3, 1), &[0.0, 0.0, 0.0, 1.0, 0.5]);
        let mixed = sample(Arc::new(veiled), None, false, None, [2, 0, 1, 1], cmyk, None).unwrap().unwrap();
        assert!(close(&mixed, &[25.0, 10.0, 5.0, 65.0], 0.5), "half-covered black over the inks: {mixed:?}");
        // Anything but plain pixel layers composites in RGB, and is separated the way Flatten Image separates it.
        let mut multiplied = (*doc).clone();
        multiplied.layer_mut(LayerId(black)).unwrap().blend = BlendMode::Multiply;
        let multiplied = Arc::new(multiplied);
        let separated = sample(multiplied.clone(), None, false, None, [2, 0, 2, 2], cmyk, None).unwrap().unwrap();
        let px = photocraft_compose::render(&multiplied, Rect::new(2, 0, 3, 1)).px[0];
        let expected: Vec<f32> = photocraft_raster::from_rgba(&doc.pixel_format(), px)[..4].iter().map(|v| v * 100.0).collect();
        assert!(close(&separated, &expected, 0.01), "{separated:?} vs {expected:?}");
        assert_eq!(sample(doc.clone(), Some(black), false, None, [0, 0, 1, 1], cmyk, None).unwrap(), None, "transparent pixels have no inks");
        let rgb = sample(doc.clone(), None, false, None, [0, 0, 1, 1], None, None).unwrap().unwrap();
        assert_eq!(rgb.len(), 3, "without a space the sample stays RGB");
        assert_eq!(sample(doc, None, false, None, [0, 0, 1, 1], Some("rgb"), None).unwrap().unwrap(), rgb);
    }

    #[test]
    fn cmyk_samples_need_a_cmyk_image_and_a_known_space() {
        let (cmyk, ..) = cmyk_image();
        let rgb = Arc::new(Document::new("RGB", Size::new(4, 4), ColorMode::Rgb, SampleType::U8));
        for (doc, space, message) in [
            (rgb.clone(), "cmyk", "CMYK samples need a CMYK image"),
            (cmyk.clone(), "lab", "space must be rgb or cmyk"),
            (cmyk.clone(), "", "space must be rgb or cmyk"),
        ] {
            let error = sample(doc, None, false, None, [0, 0, 1, 1], Some(space), None).unwrap_err();
            assert!(error.contains(message), "{space}: {error}");
        }
        assert!(sample(cmyk, None, false, None, [9, 0, 1, 1], Some("cmyk"), None).unwrap_err().contains("Sample inside the image"));
    }

    /// A 4 × 4 RGB image whose layer mask hides the right half, an alpha channel saved from the
    /// left-half selection, and Quick Mask on over the top-left quarter.
    fn masked_image() -> (Arc<Document>, u64, u64) {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 4, "height": 4, "background": "#808080"})).unwrap();
        let plain = engine.active().unwrap().active_layer.unwrap().0;
        engine.execute("layer.new.layer", json!({})).unwrap();
        let masked = engine.active().unwrap().active_layer.unwrap();
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 2, "height": 4})).unwrap();
        engine.execute("select.saveSelection", json!({})).unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        let mut mask = LayerMask::reveal_all();
        mask.surface.write_region(Rect::new(2, 0, 4, 4), &[0.0; 8]);
        Arc::make_mut(&mut engine.active_mut().unwrap().doc).layer_mut(masked).unwrap().mask = Some(mask);
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": 2, "height": 2})).unwrap();
        engine.execute("select.editInQuickMaskMode", json!({})).unwrap();
        (engine.active().unwrap().doc.clone(), masked.0, plain)
    }

    #[test]
    fn mask_quick_mask_and_channel_targets_read_their_grey_pixels() {
        let (doc, masked, _) = masked_image();
        let quick = doc.quick_mask.as_ref().unwrap().surface.sample_channel(0, 0, 0);
        for (target, layer, window, expected) in [
            (json!("mask"), Some(masked), [0, 0, 4, 4], 127.5),
            (json!("mask"), Some(masked), [2, 1, 1, 1], 0.0),
            (json!({"channel": 0}), None, [1, 3, 1, 1], 255.0),
            (json!({"channel": 0}), None, [0, 0, 4, 1], 127.5),
            (json!("quickMask"), None, [0, 0, 1, 1], quick * 255.0),
            (json!("quickMask"), None, [3, 3, 1, 1], (1.0 - quick) * 255.0),
        ] {
            let value = sample(doc.clone(), layer, false, None, window, None, Some(&target)).unwrap().unwrap();
            assert!(close(&value, &[expected], 0.01), "{target} {window:?}: {value:?}");
        }
        let mask = histogram(&doc, Some(masked), false, "rgb", Some(&json!("mask"))).unwrap();
        assert_eq!(mask.len(), 1, "one grey histogram");
        assert_eq!((mask[0][0], mask[0][255], mask[0].iter().sum::<u32>()), (8, 8, 16));
        let channel = histogram(&doc, None, false, "luminosity", Some(&json!({"channel": 0}))).unwrap();
        assert_eq!((channel[0][0], channel[0][255]), (8, 8));
        let quick_mask = histogram(&doc, None, false, "rgb", Some(&json!("quickMask"))).unwrap();
        assert_eq!(quick_mask[0].iter().sum::<u32>(), 16);
        assert_eq!(histogram(&doc, None, false, "rgb", Some(&Value::Null)).unwrap().len(), 4, "no target keeps the composite histogram");
    }

    #[test]
    fn bad_targets_are_refused() {
        let (doc, masked, plain) = masked_image();
        let no_quick = {
            let mut doc = (*doc).clone();
            doc.quick_mask = None;
            Arc::new(doc)
        };
        for (doc, target, layer, space, message) in [
            (doc.clone(), json!("mask"), None, None, "a mask target needs the layer whose mask to read"),
            (doc.clone(), json!("mask"), Some(plain), None, "That layer has no layer mask"),
            (doc.clone(), json!("mask"), Some(u64::MAX), None, "That layer no longer exists"),
            (no_quick, json!("quickMask"), None, None, "The image is not in Quick Mask mode"),
            (doc.clone(), json!({"channel": 1}), None, None, "The image has no alpha channel 1"),
            (doc.clone(), json!({"channel": -1}), None, None, "target must be"),
            (doc.clone(), json!({"channel": "Alpha 1"}), None, None, "target must be"),
            (doc.clone(), json!({"channel": 0, "name": "x"}), None, None, "target must be"),
            (doc.clone(), json!("alpha"), None, None, "target must be"),
            (doc.clone(), json!(3), None, None, "target must be"),
            (doc.clone(), json!("mask"), Some(masked), Some("cmyk"), "space applies to the image's colours, not to a target"),
        ] {
            let error = sample(doc.clone(), layer, false, None, [0, 0, 1, 1], space, Some(&target)).unwrap_err();
            assert!(error.contains(message), "{target}: {error}");
            if space.is_none() {
                let error = histogram(&doc, layer, false, "rgb", Some(&target)).unwrap_err();
                assert!(error.contains(message), "histogram {target}: {error}");
            }
        }
        assert!(sample(doc, Some(masked), false, None, [4, 0, 1, 1], None, Some(&json!("mask"))).unwrap_err().contains("Sample inside the image"));
    }

    /// A 10 × 10 RGB image: a dark blue and a dark red, a pale yellow and a saturated light orange,
    /// 48 near-greys and 48 saturated reds.
    fn toned_image() -> Document {
        let mut doc = Document::new("Tones", Size::new(10, 10), ColorMode::Rgb, SampleType::U8);
        let mut pixels = vec![[0.0, 0.0, 40.0], [20.0, 0.0, 0.0], [255.0, 255.0, 200.0], [255.0, 230.0, 180.0]];
        pixels.extend([[120.0, 128.0, 136.0]; 48]);
        pixels.extend([[200.0, 50.0, 50.0]; 48]);
        let data: Vec<f32> = pixels.iter().flat_map(|rgb: &[f32; 3]| [rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0, 1.0]).collect();
        let mut layer = Layer::raster("Tones", doc.pixel_format());
        layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
        doc.layers.push(layer);
        doc
    }
    fn colors(value: &Value, key: &str) -> Vec<f32> {
        value[key].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect()
    }

    #[test]
    fn auto_colors_average_the_darkest_lightest_and_nearly_neutral_pixels() {
        let doc = toned_image();
        let found = auto_colors(&doc, None, false, 1.0, 1.0).unwrap();
        assert!(close(&colors(&found, "dark"), &[0.0, 0.0, 40.0], 0.01), "the darkest 1 % by luminosity: {found}");
        assert!(close(&colors(&found, "light"), &[255.0, 255.0, 200.0], 0.01), "{found}");
        assert!(close(&colors(&found, "neutral"), &[120.0, 128.0, 136.0], 0.01), "saturated pixels are not neutral: {found}");
        let wider = auto_colors(&doc, None, false, 2.0, 2.0).unwrap();
        assert!(close(&colors(&wider, "dark"), &[10.0, 0.0, 20.0], 0.01), "{wider}");
        assert!(close(&colors(&wider, "light"), &[255.0, 242.5, 190.0], 0.01), "{wider}");
        let least = auto_colors(&doc, None, false, 0.0, 0.0).unwrap();
        assert_eq!((colors(&least, "dark"), colors(&least, "light")), (vec![0.0, 0.0, 40.0], vec![255.0, 255.0, 200.0]), "at least one pixel each");
        let mut colourful = doc.clone();
        let tones = colourful.layers[0].id;
        for rect in [Rect::new(4, 0, 10, 1), Rect::new(0, 1, 10, 6)] {
            let red = [200.0 / 255.0, 50.0 / 255.0, 50.0 / 255.0, 1.0].repeat((rect.width() * rect.height()) as usize);
            colourful.layer_mut(tones).unwrap().surface_mut().unwrap().write_region(rect, &red);
        }
        assert_eq!(auto_colors(&colourful, None, false, 1.0, 1.0).unwrap()["neutral"], Value::Null, "no nearly neutral pixel");
    }

    #[test]
    fn auto_colors_refuse_bad_clips_and_layers_without_pixels() {
        let mut doc = toned_image();
        let empty = Layer::raster("Empty", doc.pixel_format());
        let empty_id = empty.id.0;
        doc.layers.push(empty);
        for (shadow, highlight, message) in [
            (-0.1, 0.1, "shadowClip must be a percentage from 0 to 9.99"),
            (10.0, 0.1, "shadowClip must be a percentage from 0 to 9.99"),
            (0.1, 9.991, "highlightClip must be a percentage from 0 to 9.99"),
            (0.1, f64::NAN, "highlightClip must be a percentage from 0 to 9.99"),
        ] {
            assert_eq!(auto_colors(&doc, None, false, shadow, highlight).unwrap_err(), message);
        }
        assert_eq!(auto_colors(&doc, Some(empty_id), false, 0.1, 0.1).unwrap_err(), "There are no visible pixels to find colours in");
        assert!(auto_colors(&doc, Some(u64::MAX), false, 0.1, 0.1).is_err());
        assert!(auto_colors(&doc, Some(empty_id), true, 0.1, 0.1).is_ok(), "the image below the empty layer has pixels");
    }
}
