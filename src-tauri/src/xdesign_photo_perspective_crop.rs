use photocraft_algo::transform::Homography;
use photocraft_engine::{
    doc::{Affine, Document, Layer, LayerContent, Path, Rect, SampleType, Size, Surface},
    smart_cmds, Session,
};
use serde_json::{json, Value};

pub(super) const COMMAND: &str = "image.xdesignPerspectiveCrop";
const MAX_WORK: u64 = 67_108_864;
const MAX_BYTES: u64 = 512 * 1024 * 1024;

struct Crop {
    size: Size,
    to_source: Homography,
    to_output: Homography,
    interpolation: String,
}

fn map(h: &Homography, p: [f64; 2]) -> Result<[f64; 2], String> {
    let denominator = h.0[6] * p[0] + h.0[7] * p[1] + h.0[8];
    let (x, y) = h.apply(p[0], p[1]);
    if denominator.abs() < 1e-8
        || !x.is_finite()
        || !y.is_finite()
        || x.abs() > 1_000_000.0
        || y.abs() > 1_000_000.0
    {
        return Err(
            "This crop projects document content beyond the supported coordinate range".into(),
        );
    }
    Ok([x, y])
}

fn box_map(h: &Homography, b: [f64; 4]) -> Result<[f64; 4], String> {
    let corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
    let first = h.0[6] * b[0] + h.0[7] * b[1] + h.0[8];
    let mut output = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for p in corners {
        if (h.0[6] * p[0] + h.0[7] * p[1] + h.0[8]) * first <= 0.0 {
            return Err("This crop crosses a perspective horizon in document content".into());
        }
        let q = map(h, p)?;
        output = [
            output[0].min(q[0]),
            output[1].min(q[1]),
            output[2].max(q[0]),
            output[3].max(q[1]),
        ];
    }
    Ok(output)
}

fn rect_map(h: &Homography, r: Rect) -> Result<Rect, String> {
    if r.is_empty() {
        return Ok(r);
    }
    let b = box_map(h, [r.x0 as f64, r.y0 as f64, r.x1 as f64, r.y1 as f64])?;
    Ok(Rect::new(
        b[0].floor() as i32,
        b[1].floor() as i32,
        b[2].ceil() as i32,
        b[3].ceil() as i32,
    ))
}

fn parse(params: &Value, doc: &Document) -> Result<Crop, String> {
    let size = |key: &str| {
        params[key]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 100_000)
            .map(|v| v as u32)
            .ok_or_else(|| format!("Choose a whole {key} between 1 and 100000 pixels"))
    };
    let size = Size::new(size("width")?, size("height")?);
    if size.width as u64 * size.height as u64 > super::MAX_PIXELS {
        return Err("The corrected crop exceeds the 256 megapixel image limit".into());
    }
    let values = params["quad"]
        .as_array()
        .filter(|v| v.len() == 4)
        .ok_or("Place four crop corners in clockwise order")?;
    let mut quad = [[0.0; 2]; 4];
    for (i, value) in values.iter().enumerate() {
        let point = value
            .as_array()
            .filter(|v| v.len() == 2)
            .ok_or("Each crop corner needs X and Y coordinates")?;
        for axis in 0..2 {
            let limit = if axis == 0 {
                doc.size.width
            } else {
                doc.size.height
            };
            quad[i][axis] = point[axis]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.0 && *v <= limit as f64)
                .ok_or("Keep crop corners inside the source image")?;
        }
    }
    for i in 0..4 {
        let (a, b, c) = (quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]);
        if (a[0] - b[0]).hypot(a[1] - b[1]) < 1.0
            || (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 1e-6
        {
            return Err("Use a convex clockwise crop with edges at least one pixel long".into());
        }
    }
    let interpolation = params
        .get("interpolation")
        .map(|v| v.as_str().ok_or("Choose a crop interpolation method"))
        .transpose()?
        .unwrap_or("bicubic");
    if !["nearest", "bilinear", "bicubic"].contains(&interpolation) {
        return Err("Choose nearest, bilinear or bicubic crop interpolation".into());
    }
    let to_source =
        Homography::rect_to_quad([0.0, 0.0, size.width as f64, size.height as f64], quad)
            .ok_or("The crop corners cannot define a perspective transform")?;
    let to_output = to_source
        .inverse()
        .ok_or("The crop perspective is singular")?;
    box_map(
        &to_output,
        [0.0, 0.0, doc.size.width as f64, doc.size.height as f64],
    )?;
    Ok(Crop {
        size,
        to_source,
        to_output,
        interpolation: interpolation.into(),
    })
}

fn path_map(path: &mut Path, h: &Homography) -> Result<(), String> {
    for subpath in &mut path.subpaths {
        for knot in &mut subpath.knots {
            if knot.anchor != knot.in_ctrl || knot.anchor != knot.out_ctrl {
                return Err("Perspective crop of curved document paths or vector masks is not available yet. The image has not been changed.".into());
            }
            let p = map(h, [knot.anchor.x, knot.anchor.y])?;
            knot.anchor.x = p[0];
            knot.anchor.y = p[1];
            knot.in_ctrl = knot.anchor;
            knot.out_ctrl = knot.anchor;
        }
    }
    Ok(())
}

fn wrapped(layer: &Layer) -> bool {
    matches!(
        layer.content,
        LayerContent::Text(_) | LayerContent::Shape(_) | LayerContent::Fill(_)
    ) || matches!(&layer.content, LayerContent::Smart(sm) if !sm.smart_filters.is_empty() || sm.warp.is_some() || sm.stack_mode.is_some())
}

fn source_region(layer: &Layer, canvas: Rect) -> Rect {
    let mut region = layer
        .surface()
        .map_or(Rect::EMPTY, Surface::content_bounds)
        .union(&canvas);
    if let Some(children) = layer.children() {
        for child in children {
            region = region.union(&source_region(child, canvas));
        }
    }
    if layer.effects.enabled && !layer.effects.items.is_empty() {
        region = region.inflate(256);
    }
    region
}

fn admit(doc: &Document, crop: &Crop) -> Result<(), String> {
    if doc.timeline.is_some()
        || doc.has_artboards()
        || !doc.layer_comps.is_empty()
        || doc.last_document_state.is_some()
        || doc.variables != Default::default()
    {
        return Err("Perspective crop of timelines, artboards, layer comps or data-driven documents is not available yet. The image has not been changed.".into());
    }
    let pixels = crop.size.width as u64 * crop.size.height as u64;
    // Surface allocations are tile-sized even for tiny corrected images.
    let tiled_pixels =
        ((crop.size.width as u64 + 255) / 256) * ((crop.size.height as u64 + 255) / 256) * 65_536;
    let mut bytes = 0u64;
    let mut work = 0u64;
    let mut charge = |surface: &Surface| {
        bytes += tiled_pixels
            * (surface.format().bytes_per_pixel() + surface.format().sample.bytes()) as u64;
        work += pixels;
    };
    for (_, _, layer) in doc.walk() {
        if layer.video.is_some() {
            return Err("Perspective crop of video layers is not available yet. The image has not been changed.".into());
        }
        if !wrapped(layer) {
            if let Some(mask) = &layer.vector_mask {
                path_map(&mut mask.path.clone(), &crop.to_output)?;
            }
        }
        if let Some(surface) = layer.surface() {
            charge(surface);
        } else if wrapped(layer) {
            charge(&Surface::new(doc.pixel_format()));
        }
        if let Some(mask) = &layer.mask {
            charge(&mask.surface);
        }
        if let LayerContent::Smart(sm) = &layer.content {
            if let Some(mask) = &sm.filter_mask {
                charge(&mask.surface);
            }
        }
        if let Some(surface) = layer.surface() {
            rect_map(&crop.to_output, surface.content_bounds())?;
        }
    }
    for channel in &doc.channels {
        charge(&channel.surface);
    }
    if let Some(mask) = &doc.quick_mask {
        charge(&mask.surface);
    }
    let mut conversion_peak = 0u64;
    for (_, _, layer) in doc.walk().into_iter().filter(|(_, _, l)| wrapped(l)) {
        let region = source_region(layer, doc.bounds());
        rect_map(&crop.to_output, region)?;
        conversion_peak = conversion_peak.max(region.width() as u64 * region.height() as u64 * 48);
    }
    if work > MAX_WORK || bytes.saturating_add(conversion_peak) > MAX_BYTES {
        return Err("This perspective crop exceeds the 64 megapixel layer-work or 512MiB temporary allocation estimate. Reduce the output size or work on a smaller document.".into());
    }
    Ok(())
}

fn cubic(x: f64) -> f64 {
    let x = x.abs();
    if x <= 1.0 {
        1.5 * x * x * x - 2.5 * x * x + 1.0
    } else if x < 2.0 {
        -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0
    } else {
        0.0
    }
}

fn warp(source: &Surface, crop: &Crop, coverage: bool) -> Surface {
    let source_format = source.format();
    let mut format = source_format;
    if !coverage {
        format.alpha = true;
    }
    let n = format.channels();
    let alpha = format.alpha.then_some(n - 1);
    let mut default = source.default_pixel();
    if !source_format.alpha && format.alpha {
        default.push(1.0);
    }
    let mut output = if coverage {
        Surface::with_default(format, &default)
    } else {
        Surface::new(format)
    };
    let mut sample = vec![0.0f32; n];
    let mut values = vec![0.0f64; n];
    for y0 in (0..crop.size.height as i32).step_by(64) {
        for x0 in (0..crop.size.width as i32).step_by(64) {
            let region = Rect::new(
                x0,
                y0,
                (x0 + 64).min(crop.size.width as i32),
                (y0 + 64).min(crop.size.height as i32),
            );
            let mut data = vec![0.0f32; region.width() as usize * region.height() as usize * n];
            for y in region.y0..region.y1 {
                for x in region.x0..region.x1 {
                    let (sx, sy) = crop.to_source.apply(x as f64 + 0.5, y as f64 + 0.5);
                    let (sx, sy) = (sx - 0.5, sy - 0.5);
                    let nearest = crop.interpolation == "nearest";
                    let bicubic = crop.interpolation == "bicubic";
                    let base_x = if nearest { sx.round() } else { sx.floor() } as i32;
                    let base_y = if nearest { sy.round() } else { sy.floor() } as i32;
                    let range = if nearest {
                        0..=0
                    } else if bicubic {
                        -1..=2
                    } else {
                        0..=1
                    };
                    values.fill(0.0);
                    for dy in range.clone() {
                        let wy = if nearest {
                            1.0
                        } else if bicubic {
                            cubic(sy - (base_y + dy) as f64)
                        } else {
                            (1.0 - (sy - (base_y + dy) as f64).abs()).max(0.0)
                        };
                        for dx in range.clone() {
                            let wx = if nearest {
                                1.0
                            } else if bicubic {
                                cubic(sx - (base_x + dx) as f64)
                            } else {
                                (1.0 - (sx - (base_x + dx) as f64).abs()).max(0.0)
                            };
                            source.read_pixel(base_x + dx, base_y + dy, &mut sample);
                            if !source_format.alpha && format.alpha {
                                sample[n - 1] = 1.0;
                            }
                            let a = alpha.map_or(1.0, |index| sample[index] as f64);
                            for c in 0..n {
                                values[c] += sample[c] as f64
                                    * wx
                                    * wy
                                    * if Some(c) == alpha { 1.0 } else { a };
                            }
                        }
                    }
                    let offset =
                        ((y - y0) as usize * region.width() as usize + (x - x0) as usize) * n;
                    let a = alpha.map_or(1.0, |index| values[index].clamp(0.0, 1.0));
                    for c in 0..n {
                        let raw_alpha = alpha.map_or(1.0, |index| values[index]);
                        let value = if Some(c) == alpha {
                            a
                        } else if raw_alpha > 1e-12 {
                            values[c] / raw_alpha
                        } else {
                            0.0
                        };
                        data[offset + c] = if coverage || format.sample != SampleType::F32 {
                            value.clamp(0.0, 1.0) as f32
                        } else {
                            value as f32
                        };
                    }
                }
            }
            output.write_region(region, &data);
        }
    }
    output.prune();
    output
}

fn layer_map(
    layer: &Layer,
    doc: &Document,
    crop: &Crop,
    converted: &mut usize,
) -> Result<Layer, String> {
    let mut out = layer.clone();
    if wrapped(layer) {
        let mut inner = layer.clone();
        inner.excluded_channels = 0;
        inner.blend_if = Default::default();
        let smart = smart_cmds::layer_to_smart(doc, &inner).map_err(|e| e.to_string())?;
        out.content = smart.content;
        // Original content blocks stay in the embedded source. A stale TySh
        // on the outer placed layer makes PSD readers reopen it as type.
        out.psd_blocks.clear();
        out.mask = None;
        out.vector_mask = None;
        out.fill_cache = None;
        out.effects = Default::default();
        out.fill_opacity = 1.0;
        *converted += 1;
    }
    match &mut out.content {
        LayerContent::Raster(surface) => *surface = warp(surface, crop, false),
        LayerContent::Group(group) => {
            group.children = group
                .children
                .iter()
                .map(|l| layer_map(l, doc, crop, converted))
                .collect::<Result<_, _>>()?;
        }
        LayerContent::Smart(sm) => {
            let h = crop.to_output.mul(&smart_cmds::placement(sm));
            let norm = h.0[8];
            if norm.abs() < 1e-8 {
                return Err("The corrected Smart Object placement is singular".into());
            }
            let m = h.0.map(|v| v / norm);
            sm.perspective = Some(m);
            let origin = map(&h, [0.0, 0.0])?;
            let x = map(&h, [1.0, 0.0])?;
            let y = map(&h, [0.0, 1.0])?;
            sm.transform = Affine {
                m: [
                    x[0] - origin[0],
                    x[1] - origin[1],
                    y[0] - origin[0],
                    y[1] - origin[1],
                    origin[0],
                    origin[1],
                ],
            };
            if let Some(cache) = &sm.cache {
                sm.cache = Some(warp(cache, crop, false));
            }
            if let Some(mask) = &mut sm.filter_mask {
                mask.surface = warp(&mask.surface, crop, true);
            }
            sm.psd_raw = None;
            out.psd_blocks
                .retain(|(key, _)| ![b"SoLd", b"PlLd", b"SoLE"].contains(&key));
        }
        LayerContent::Adjustment(_) => {}
        _ => return Err("The perspective crop could not preserve this layer".into()),
    }
    if let Some(mask) = &mut out.mask {
        mask.surface = warp(&mask.surface, crop, true);
    }
    if let Some(mask) = &mut out.vector_mask {
        path_map(&mut mask.path, &crop.to_output)?;
    }
    if let Some(reference) = &mut out.effects.reference {
        let p = map(&crop.to_output, [reference.0, reference.1])?;
        *reference = (p[0], p[1]);
    }
    Ok(out)
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    if command != COMMAND {
        return None;
    }
    Some(run(engine, params))
}

fn run(engine: &mut Session, params: &Value) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason("image.crop") {
        return Err(reason);
    }
    let doc = &engine.active().ok_or("No image document")?.doc;
    let crop = parse(params, doc)?;
    admit(doc, &crop)?;
    let mut draft = (**doc).clone();
    for path in &mut draft.paths {
        path_map(&mut path.path, &crop.to_output)?;
        path.psd_raw = None;
    }
    if let Some(path) = &mut draft.work_path {
        path_map(path, &crop.to_output)?;
    }
    for note in &mut draft.notes {
        note.position = map(&crop.to_output, note.position)?;
        note.popup = box_map(&crop.to_output, note.popup)?;
    }
    for group in &mut draft.measurement.count_groups {
        for p in &mut group.points {
            *p = map(&crop.to_output, *p)?;
        }
    }
    if let Some(ruler) = &mut draft.measurement.ruler {
        ruler.start = map(&crop.to_output, ruler.start)?;
        ruler.end = map(&crop.to_output, ruler.end)?;
        if let Some(p) = &mut ruler.protractor {
            *p = map(&crop.to_output, *p)?;
        }
    }
    for slice in &mut draft.slices.list {
        slice.rect = rect_map(&crop.to_output, slice.rect)?;
    }
    let axial = [
        crop.to_output.0[1],
        crop.to_output.0[3],
        crop.to_output.0[6],
        crop.to_output.0[7],
    ]
    .iter()
    .all(|v| v.abs() < 1e-9);
    let removed_guides =
        !axial && (!draft.guides.horizontal.is_empty() || !draft.guides.vertical.is_empty());
    if axial {
        for y in &mut draft.guides.horizontal {
            *y = map(&crop.to_output, [0.0, *y as f64])?[1] as f32;
        }
        for x in &mut draft.guides.vertical {
            *x = map(&crop.to_output, [*x as f64, 0.0])?[0] as f32;
        }
    } else {
        draft.guides = Default::default();
    }
    let mut converted = 0;
    draft.layers = doc
        .layers
        .iter()
        .map(|l| layer_map(l, doc, &crop, &mut converted))
        .collect::<Result<_, _>>()?;
    for channel in &mut draft.channels {
        channel.surface = warp(&channel.surface, &crop, true);
    }
    if let Some(mask) = &mut draft.quick_mask {
        mask.surface = warp(&mask.surface, &crop, true);
    }
    draft.size = crop.size;
    draft.selection = None;
    engine
        .edit("Perspective Crop", |doc, _| {
            *doc = draft;
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    engine.journal.push((COMMAND.into(), params.clone()));
    Ok(
        json!({"width":crop.size.width,"height":crop.size.height,"convertedLayers":converted,"removedGuides":removed_guides}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{
        AlphaChannel, Color, ColorMode, Fill, LayerMask, NamedPath, Note, PixelFormat, Subpath,
    };

    fn fixture(mode: ColorMode, depth: SampleType) -> Session {
        let mut doc = Document::new("Perspective source", Size::new(24, 20), mode, depth);
        let mut layer = Layer::raster("Background", doc.pixel_format());
        layer.locks.position = true;
        layer.locks.transparency = true;
        let n = doc.pixel_format().channels();
        let mut data = Vec::new();
        for y in 0..20 {
            for x in 0..24 {
                let mut pixel = vec![0.0; n];
                for (c, value) in pixel[..n - 1].iter_mut().enumerate() {
                    *value = (x + y + c as i32) as f32 / 64.0;
                }
                if depth == SampleType::F32 && mode == ColorMode::Rgb {
                    pixel[0] = 2.0 + x as f32 / 32.0;
                    pixel[1] = -0.5 + y as f32 / 32.0;
                }
                pixel[n - 1] = 1.0;
                data.extend(pixel);
            }
        }
        layer
            .surface_mut()
            .unwrap()
            .write_region(doc.bounds(), &data);
        let mut mask = LayerMask::reveal_all();
        mask.density = 0.8;
        mask.feather = 1.25;
        mask.linked = false;
        mask.surface.fill_rect(Rect::new(6, 4, 12, 14), &[0.25]);
        layer.mask = Some(mask.clone());
        doc.layers.push(layer);
        let mut channel = AlphaChannel::new(
            "Spot ink",
            Surface::with_default(
                PixelFormat::new(ColorMode::Grayscale, depth, false),
                &[0.37],
            ),
        );
        channel.spot = Some((Color::rgb(0.2, 0.5, 0.7), 0.6));
        channel.opacity = 0.3;
        doc.channels.push(channel);
        doc.quick_mask = Some(AlphaChannel::new("Quick Mask", mask.surface));
        let mut engine = Session::new();
        engine.add_document(doc, None);
        engine
            .execute("select.rect", json!({"x":3,"y":4,"width":10,"height":8}))
            .unwrap();
        engine.active_mut().unwrap().channel_view.target =
            photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
        engine
    }

    fn params() -> Value {
        json!({"quad":[[2,2],[21,1],[23,18],[1,19]],"width":14,"height":12,"interpolation":"bilinear"})
    }
    fn apply(engine: &mut Session, params: Value) -> Value {
        super::super::execute_view_command(engine, "image.xdesignPerspectiveCrop", params).unwrap()
    }

    #[test]
    fn perspective_crop_filtered_smart_source_retains_filter_order_after_refresh() {
        let mut engine = fixture(ColorMode::Rgb, SampleType::U16);
        engine.active_mut().unwrap().channel_view = Default::default();
        engine
            .edit("Leave Quick Mask", |doc, _| {
                doc.quick_mask = None;
                doc.selection = None;
                Ok(())
            })
            .unwrap();
        engine
            .execute("layer.smartObjects.convertToSmartObject", json!({}))
            .unwrap();
        engine
            .execute("filter.blur.gaussianBlur", json!({"radius":1}))
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        let mut options = params();
        options["interpolation"] = json!("bicubic");
        let result = apply(&mut engine, options);
        assert_eq!(result["convertedLayers"], 1);
        let after = engine.active().unwrap().doc.clone();
        let original = &before.layers[0];
        let layer = &after.layers[0];
        assert_eq!(original.id, layer.id);
        let LayerContent::Smart(outer) = &layer.content else {
            panic!("No outer projective placement")
        };
        assert!(outer.smart_filters.is_empty());
        let (name, bytes) = smart_cmds::source_bytes(&after.metadata, &outer.source).unwrap();
        let source = smart_cmds::decode_source(&name, &bytes).unwrap();
        let LayerContent::Smart(inner) = &source.layers[0].content else {
            panic!("The original editable filtered Smart Object is missing")
        };
        let LayerContent::Smart(old) = &original.content else {
            panic!("Missing original Smart Object")
        };
        assert_eq!(inner.smart_filters, old.smart_filters);
        assert_eq!(inner.filters_enabled, old.filters_enabled);
        let mut refreshed = (*after).clone();
        smart_cmds::refresh(&mut refreshed, layer.id).unwrap();
        let cached = layer.surface().unwrap().read_region(after.bounds());
        let regenerated = refreshed.layers[0]
            .surface()
            .unwrap()
            .read_region(after.bounds());
        let maximum = cached
            .iter()
            .zip(&regenerated)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            maximum < 3.0 / 65535.0,
            "Smart source refresh changed projective/filter order by {maximum}"
        );
    }

    #[test]
    fn perspective_crop_analytical_float_values_and_premultiplied_alpha_keep_hdr() {
        let mut engine = fixture(ColorMode::Rgb, SampleType::F32);
        let crop = parse(&params(), &engine.active().unwrap().doc).unwrap();
        let quad = [[2.0, 2.0], [21.0, 1.0], [23.0, 18.0], [1.0, 19.0]];
        for (source, output) in
            quad.into_iter()
                .zip([[0.0, 0.0], [14.0, 0.0], [14.0, 12.0], [0.0, 12.0]])
        {
            let actual = map(&crop.to_output, source).unwrap();
            assert!((actual[0] - output[0]).abs() < 1e-8 && (actual[1] - output[1]).abs() < 1e-8);
        }
        apply(&mut engine, params());
        let pixels = engine.active().unwrap().doc.layers[0].surface().unwrap();
        for y in 0..12 {
            for x in 0..14 {
                let (sx, sy) = crop.to_source.apply(x as f64 + 0.5, y as f64 + 0.5);
                let actual = pixels.pixel(x, y);
                assert!((actual[0] as f64 - (2.0 + (sx - 0.5) / 32.0)).abs() < 1e-6);
                assert!((actual[1] as f64 - (-0.5 + (sy - 0.5) / 32.0)).abs() < 1e-6);
                assert_eq!(actual[3], 1.0);
            }
        }
        let mut doc = Document::new("Alpha", Size::new(2, 2), ColorMode::Rgb, SampleType::F32);
        let mut layer = Layer::raster("Pixels", doc.pixel_format());
        layer.surface_mut().unwrap().write_region(
            doc.bounds(),
            &[
                2.0, 0.0, 0.0, 1.0, 0.0, 0.0, 9.0, 0.0, 2.0, 0.0, 0.0, 1.0, 0.0, 0.0, 9.0, 0.0,
            ],
        );
        doc.layers.push(layer);
        let mut alpha = Session::new();
        alpha.add_document(doc, None);
        apply(
            &mut alpha,
            json!({"quad":[[0,0],[2,0],[2,2],[0,2]],"width":1,"height":2,"interpolation":"bilinear"}),
        );
        let pixel = alpha.active().unwrap().doc.layers[0]
            .surface()
            .unwrap()
            .pixel(0, 0);
        assert_eq!(pixel, vec![2.0, 0.0, 0.0, 0.5]);
    }

    #[test]
    fn perspective_crop_mode_depth_masks_metadata_background_identity_and_one_step_history() {
        for mode in [
            ColorMode::Rgb,
            ColorMode::Grayscale,
            ColorMode::Cmyk,
            ColorMode::Lab,
        ] {
            for depth in [SampleType::U8, SampleType::U16, SampleType::F32] {
                let mut engine = fixture(mode, depth);
                let before = engine.active().unwrap().clone();
                let journal = engine.journal.len();
                let options = json!({"quad":[[2,2],[22,2],[22,18],[2,18]],"width":10,"height":8,"interpolation":"nearest"});
                apply(&mut engine, options.clone());
                let state = engine.active().unwrap();
                let after = state.doc.clone();
                assert_eq!(after.layers[0].id, before.doc.layers[0].id);
                assert_eq!(after.layers[0].locks, before.doc.layers[0].locks);
                assert_eq!(after.layers[0].name, "Background");
                assert_eq!(after.mode, mode);
                assert_eq!(after.depth, depth);
                assert!(after.selection.is_none());
                assert_eq!(state.channel_view, before.channel_view);
                assert_eq!(state.selected_layers(), before.selected_layers());
                assert_eq!(state.history.past_len(), before.history.past_len() + 1);
                assert_eq!(after.channels[0].spot, before.doc.channels[0].spot);
                assert_eq!(after.channels[0].opacity, before.doc.channels[0].opacity);
                assert_eq!(after.layers[0].mask.as_ref().unwrap().density, 0.8);
                for y in 0..8 {
                    for x in 0..10 {
                        let source = before.doc.layers[0]
                            .surface()
                            .unwrap()
                            .pixel(2 * x + 3, 2 * y + 3);
                        assert_eq!(after.layers[0].surface().unwrap().pixel(x, y), source);
                        assert_eq!(
                            after.layers[0].mask.as_ref().unwrap().surface.pixel(x, y),
                            before.doc.layers[0]
                                .mask
                                .as_ref()
                                .unwrap()
                                .surface
                                .pixel(2 * x + 3, 2 * y + 3)
                        );
                    }
                }
                assert_eq!(
                    after.channels[0].surface.default_pixel(),
                    before.doc.channels[0].surface.default_pixel()
                );
                assert_eq!(engine.journal.len(), journal + 1);
                assert!(engine.execute(COMMAND, options.clone()).is_err());
                let mut replay = Session::new();
                replay.add_document((*before.doc).clone(), None);
                *replay.active_mut().unwrap() = before.clone();
                apply(&mut replay, options);
                assert!(&*replay.active().unwrap().doc == &*after);
                assert!(engine.undo());
                assert!(&*engine.active().unwrap().doc == &*before.doc);
                assert!(engine.redo());
                assert!(&*engine.active().unwrap().doc == &*after);
            }
        }
    }

    #[test]
    fn perspective_crop_nested_groups_and_independent_masks_transform_once() {
        let mut engine = fixture(ColorMode::Rgb, SampleType::U16);
        engine
            .edit("Nested group", |doc, _| {
                let child = doc.layers.remove(0);
                let mut sibling = child.duplicate();
                sibling.name = "Sibling".into();
                let mut nested = Layer::group("Nested", vec![child]);
                nested.mask = Some(LayerMask::reveal_all());
                doc.layers = vec![Layer::group("Root", vec![nested, sibling])];
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        apply(
            &mut engine,
            json!({"quad":[[2,2],[22,2],[22,18],[2,18]],"width":10,"height":8,"interpolation":"nearest"}),
        );
        let after = &engine.active().unwrap().doc;
        assert_eq!(after.layer_count(), before.layer_count());
        let source = before.layers[0].children().unwrap()[0].children().unwrap()[0]
            .surface()
            .unwrap();
        let result = after.layers[0].children().unwrap()[0].children().unwrap()[0]
            .surface()
            .unwrap();
        assert_eq!(result.pixel(2, 3), source.pixel(7, 9));
        assert_eq!(
            after.layers[0].children().unwrap()[0]
                .mask
                .as_ref()
                .unwrap()
                .surface
                .default_pixel(),
            vec![1.0]
        );
        assert!(engine.undo());
        assert!(&*engine.active().unwrap().doc == &*before);
    }

    #[test]
    fn perspective_crop_paths_notes_measurement_slices_and_axis_guides_move_together() {
        let mut engine = fixture(ColorMode::Rgb, SampleType::U16);
        engine
            .edit("Marks", |doc, _| {
                doc.paths.push(NamedPath {
                    name: "Saved".into(),
                    path: Path::new(vec![Subpath::polyline(&[(4.0, 6.0), (8.0, 10.0)])]),
                    psd_raw: None,
                });
                doc.notes.push(Note {
                    position: [4.0, 6.0],
                    popup: [4.0, 6.0, 8.0, 10.0],
                    ..Default::default()
                });
                doc.guides.horizontal = vec![6.0];
                doc.guides.vertical = vec![8.0];
                doc.measurement.ruler = Some(photocraft_engine::doc::Ruler {
                    start: [4.0, 6.0],
                    end: [8.0, 10.0],
                    protractor: Some([10.0, 12.0]),
                });
                doc.slices.list.push(photocraft_engine::doc::Slice {
                    id: 1,
                    rect: Rect::new(4, 6, 8, 10),
                    ..Default::default()
                });
                Ok(())
            })
            .unwrap();
        apply(
            &mut engine,
            json!({"quad":[[2,2],[22,2],[22,18],[2,18]],"width":10,"height":8}),
        );
        let doc = &engine.active().unwrap().doc;
        let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-8);
        near(doc.notes[0].position[0], 1.0);
        near(doc.notes[0].position[1], 2.0);
        near(doc.paths[0].path.subpaths[0].knots[1].anchor.x, 3.0);
        assert_eq!(doc.guides.horizontal, vec![2.0]);
        assert_eq!(doc.guides.vertical, vec![3.0]);
        let b = doc.slices.list[0].rect;
        assert!(b.contains(1, 2) && b.x1 >= 3 && b.y1 >= 4);
        near(doc.measurement.ruler.unwrap().protractor.unwrap()[1], 5.0);
    }

    #[test]
    fn perspective_crop_editable_sources_preview_immutable_reopen_and_generated_exports() {
        let mut engine = fixture(ColorMode::Rgb, SampleType::U16);
        engine
            .execute(
                "type.create",
                json!({"text":"Edit me","font":"Arial","size":8,"x":3,"y":12}),
            )
            .unwrap();
        engine
            .edit("Fill", |doc, _| {
                doc.layers.push(Layer::new(
                    "Editable fill",
                    LayerContent::Fill(Fill::Solid(Color::rgb(0.1, 0.5, 0.2))),
                ));
                Ok(())
            })
            .unwrap();
        engine
            .execute(
                "shape.create",
                json!({"kind":"ellipse","rect":[5,5,10,8],"fill":"#4040ff"}),
            )
            .unwrap();
        let bytes = photocraft_io::export(
            &engine.active().unwrap().doc,
            "before-crop.psd",
            &Default::default(),
        )
        .unwrap()
        .bytes;
        let imported = photocraft_io::import("before-crop.psd", &bytes)
            .unwrap()
            .document;
        assert!(imported
            .layers
            .iter()
            .any(|l| l.psd_blocks.iter().any(|(key, _)| key == b"TySh")));
        engine = Session::new();
        engine.add_document(imported, None);
        let before = engine.active().unwrap().clone();
        let preview = super::super::preview::render(&before, COMMAND, params()).unwrap();
        assert!(&*engine.active().unwrap().doc == &*before.doc);
        let result = apply(&mut engine, params());
        assert_eq!(result["convertedLayers"], 3);
        let after = engine.active().unwrap().doc.clone();
        assert_eq!(after.layers.len(), before.doc.layers.len());
        for (old, new) in before.doc.layers.iter().zip(&after.layers).skip(1) {
            assert_eq!(old.id, new.id);
            let LayerContent::Smart(sm) = &new.content else {
                panic!("Editable layer did not retain a Smart Object source")
            };
            let (name, bytes) = smart_cmds::source_bytes(&after.metadata, &sm.source).unwrap();
            let source = smart_cmds::decode_source(&name, &bytes).unwrap();
            assert_eq!(
                source.layers[0].content.kind_name(),
                old.content.kind_name()
            );
            assert!(sm.perspective.is_some());
        }
        let actual = super::super::render_view_preview(
            &engine.active().unwrap().doc,
            &engine.active().unwrap().channel_view,
        )
        .unwrap();
        assert_eq!(preview.png, actual.png);
        assert_eq!(preview.width, 14);
        assert_eq!(preview.height, 12);
        let root =
            std::env::temp_dir().join(format!("xdesign-perspective-crop-{}", ulid::Ulid::new()));
        let mut session = super::super::PhotoSession {
            engine,
            color_settings: None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        super::super::publish(&root, &ulid::Ulid::new().to_string(), &mut session).unwrap();
        let mut reopened = super::super::restore(&root, &session.version, None).unwrap();
        assert!(&*reopened.engine.active().unwrap().doc == &*after);
        assert!(reopened.engine.undo());
        if &*reopened.engine.active().unwrap().doc != &*before.doc {
            let restored = &reopened.engine.active().unwrap().doc;
            eprintln!("Undo document metadata equality: metadata={} paths={} channels={} quick_mask={} measurement={} notes={} text_styles={} slices={} timeline={}",restored.metadata==before.doc.metadata,restored.paths==before.doc.paths,restored.channels==before.doc.channels,restored.quick_mask==before.doc.quick_mask,restored.measurement==before.doc.measurement,restored.notes==before.doc.notes,restored.text_styles==before.doc.text_styles,restored.slices==before.doc.slices,restored.timeline==before.doc.timeline);
            for (a, b) in restored.layers.iter().zip(&before.doc.layers) {
                eprintln!("Undo {}: whole={} content={} mask={} vector_mask={} effects={} psd_blocks={} cache={}",a.content.kind_name(),a==b,a.content==b.content,a.mask==b.mask,a.vector_mask==b.vector_mask,a.effects==b.effects,a.psd_blocks==b.psd_blocks,a.fill_cache==b.fill_cache);
                if let (LayerContent::Shape(x), LayerContent::Shape(y)) = (&a.content, &b.content) {
                    eprintln!(
                        "Shape path={} fill={} stroke={} live={} cache={} raw={}",
                        x.path == y.path,
                        x.fill == y.fill,
                        x.stroke == y.stroke,
                        x.live == y.live,
                        x.cache == y.cache,
                        x.psd_raw == y.psd_raw
                    );
                    for (p, q) in x
                        .path
                        .subpaths
                        .iter()
                        .flat_map(|s| &s.knots)
                        .zip(y.path.subpaths.iter().flat_map(|s| &s.knots))
                    {
                        if p != q {
                            eprintln!("Shape differing knot: restored={p:?}, original={q:?}");
                            break;
                        }
                    }
                }
            }
        }
        assert!(&*reopened.engine.active().unwrap().doc == &*before.doc);
        for name in ["perspective.psd", "perspective.psb", "perspective.png"] {
            let bytes = photocraft_io::export(&after, name, &Default::default())
                .unwrap()
                .bytes;
            let doc = photocraft_io::import(name, &bytes).unwrap().document;
            assert_eq!(doc.size, after.size);
            assert_eq!(doc.depth, SampleType::U16);
            if !name.ends_with("png") {
                assert_eq!(doc.layers.len(), after.layers.len());
                assert!(matches!(doc.layers[1].content, LayerContent::Smart(_)));
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn perspective_crop_invalid_geometry_resources_and_unsupported_documents_leave_everything_untouched(
    ) {
        let mut engine = fixture(ColorMode::Rgb, SampleType::U16);
        for options in [
            json!({}),
            json!({"quad":[[0,0],[24,20],[24,0],[0,20]],"width":4,"height":4}),
            json!({"quad":[[0,0],[24,0],[24,20],[0,20]],"width":100_000,"height":100_000}),
            json!({"quad":[[-1,0],[24,0],[24,20],[0,20]],"width":4,"height":4}),
            json!({"quad":[[0,0],[24,0],[24,20],[0,20]],"width":4.5,"height":4}),
            json!({"quad":[[0,0],[24,0],[24,20],[0,20]],"width":4,"height":4,"interpolation":"magic"}),
            json!({"quad":[[0,0],[24,0],[24,20],[0,20]],"width":20_000,"height":10_000}),
        ] {
            let before = engine.active().unwrap().clone();
            let journal = engine.journal.len();
            assert!(execute(&mut engine, COMMAND, &options).unwrap().is_err());
            assert!(&*engine.active().unwrap().doc == &*before.doc);
            assert_eq!(
                engine.active().unwrap().history.past_len(),
                before.history.past_len()
            );
            assert_eq!(engine.journal.len(), journal);
            assert_eq!(engine.active().unwrap().channel_view, before.channel_view);
        }
        engine
            .edit("Curved saved path", |doc, _| {
                let mut path = Subpath::polyline(&[(2.0, 2.0), (10.0, 10.0)]);
                path.knots[0].out_ctrl.x = 4.0;
                doc.work_path = Some(Path::new(vec![path]));
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().clone();
        assert!(execute(&mut engine, COMMAND, &params())
            .unwrap()
            .unwrap_err()
            .contains("curved"));
        assert!(&*engine.active().unwrap().doc == &*before.doc);
        assert!(super::super::command_supported(COMMAND));
    }
}
