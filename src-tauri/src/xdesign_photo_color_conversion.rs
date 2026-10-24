use photocraft_engine::{
    color_cmds::document_profile,
    doc::{ColorMode, Document, Layer, LayerContent, PixelFormat, Rect, SampleType, Surface},
    EngineError, Session,
};
use serde_json::Value;
use std::collections::BTreeSet;

fn surfaces(layers: &mut [Layer], f: &mut impl FnMut(&mut Surface)) {
    for layer in layers {
        if let Some(cache) = &mut layer.fill_cache {
            f(&mut cache.surface);
        }
        match &mut layer.content {
            LayerContent::Raster(surface) => f(surface),
            LayerContent::Text(text) => {
                if let Some(cache) = &mut text.cache {
                    f(cache);
                }
            }
            LayerContent::Shape(shape) => {
                if let Some(cache) = &mut shape.cache {
                    f(cache);
                }
            }
            LayerContent::Smart(smart) => {
                if let Some(cache) = &mut smart.cache {
                    f(cache);
                }
            }
            LayerContent::Group(group) => surfaces(&mut group.children, f),
            _ => {}
        }
    }
}

fn noise(x: i32, y: i32, channel: usize) -> f32 {
    let mut seed = (x as u32).wrapping_mul(0x9e3779b9)
        ^ (y as u32).wrapping_mul(0x85ebca6b)
        ^ (channel as u32).wrapping_add(1).wrapping_mul(0xc2b2ae35);
    seed ^= seed >> 16;
    seed = seed.wrapping_mul(0x7feb352d);
    seed ^= seed >> 15;
    seed = seed.wrapping_mul(0x846ca68b);
    seed ^= seed >> 16;
    ((seed >> 8) as f32 + 0.5) / 16_777_216.0 - 0.5
}

fn fractional(value: f32) -> bool {
    let scaled = value.clamp(0.0, 1.0) * 255.0;
    value.is_finite() && (scaled - scaled.round()).abs() > 0.000_03
}

fn quantize(surface: &Surface, sample: SampleType, dither: bool, domain: Rect) -> Surface {
    let format = PixelFormat {
        sample,
        ..surface.format()
    };
    if !dither || sample != SampleType::U8 {
        return surface.convert(format);
    }
    let colors = format.mode.color_channels();
    let default = surface.default_pixel();
    let mut tiles: BTreeSet<_> = surface.tiles().map(|(coord, _)| *coord).collect();
    let visible_default = !format.alpha || default[colors] > 0.0;
    if visible_default && default[..colors].iter().copied().any(fractional) {
        tiles.extend(domain.tiles());
    }
    let mut output = Surface::with_default(format, &default);
    for tile in tiles {
        let area = tile.rect();
        let mut pixels = surface.read_region(area);
        for (index, pixel) in pixels.chunks_exact_mut(format.channels()).enumerate() {
            if format.alpha && pixel[colors] <= 0.0 {
                continue;
            }
            let x = area.x0 + (index % area.width() as usize) as i32;
            let y = area.y0 + (index / area.width() as usize) as i32;
            // Missing tiles outside the finite image keep their uniform default.
            if surface.tile(tile).is_none() && !domain.contains(x, y) {
                continue;
            }
            for (channel, value) in pixel[..colors].iter_mut().enumerate() {
                if fractional(*value) {
                    *value = (*value * 255.0 + noise(x, y, channel))
                        .round()
                        .clamp(0.0, 255.0)
                        / 255.0;
                }
            }
        }
        output.write_region(area, &pixels);
    }
    output.prune();
    output
}

/// Callers supply the admitted finite image/clipboard domain; masks and numeric
/// channels never enter this traversal. Failed conversion leaves `doc` untouched.
pub(super) fn convert<R>(
    doc: &mut Document,
    destination: SampleType,
    dither: bool,
    domain: Rect,
    apply: impl FnOnce(&mut Document) -> photocraft_engine::Result<R>,
) -> photocraft_engine::Result<R> {
    let dither = dither && destination == SampleType::U8;
    let mut working = doc.clone();
    let mut promote = dither;
    surfaces(&mut working.layers, &mut |surface| {
        promote |= surface.format().sample != destination;
    });
    if promote {
        let mut bytes = 0u64;
        surfaces(&mut working.layers, &mut |surface| {
            let fmt = surface.format();
            let mut tile_count = surface.tile_count() as u64;
            let dp = surface.default_pixel();
            if dither && (!fmt.alpha || dp[fmt.mode.color_channels()] > 0.0) {
                // Counting overlap twice is conservative and avoids allocating
                // millions of tile coordinates merely to make the admission.
                tile_count = tile_count.saturating_add(
                    u64::from(domain.width().div_ceil(256) + 1)
                        .saturating_mul(u64::from(domain.height().div_ceil(256) + 1)),
                );
            }
            let channels = fmt.channels().max(5) as u64;
            bytes = bytes.saturating_add(
                tile_count
                    .saturating_mul(256 * 256)
                    .saturating_mul(channels)
                    .saturating_mul(4 * 3 + 4),
            );
        });
        if bytes > super::MAX_INPUT_BYTES {
            return Err(EngineError::Other("Color conversion needs more than the 512MB temporary allocation limit; reduce image dimensions or layer count".into()));
        }
        surfaces(&mut working.layers, &mut |surface| {
            *surface = surface.convert(PixelFormat {
                sample: SampleType::F32,
                ..surface.format()
            });
        });
        working.depth = SampleType::F32;
    } else {
        working.depth = destination;
    }
    let output = apply(&mut working)?;
    if promote {
        surfaces(&mut working.layers, &mut |surface| {
            *surface = quantize(surface, destination, dither, domain);
        });
    }
    working.depth = destination;
    *doc = working;
    Ok(output)
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    let mode = match command {
        "image.mode.rgb" => Some(ColorMode::Rgb),
        "image.mode.grayscale" => Some(ColorMode::Grayscale),
        "image.mode.cmyk" => Some(ColorMode::Cmyk),
        "image.mode.lab" => Some(ColorMode::Lab),
        "edit.convertToProfile" => None,
        "color.profileMismatch"
            if matches!(
                params["action"].as_str(),
                Some("convert" | "convertToWorking")
            ) =>
        {
            None
        }
        _ => return None,
    };
    Some(run(engine, command, params, mode))
}

fn run(
    engine: &mut Session,
    command: &str,
    params: &Value,
    mode: Option<ColorMode>,
) -> Result<Value, String> {
    if !params.is_object() {
        return Err("Invalid color conversion parameters".into());
    }
    for key in ["bpc", "dither"] {
        if params.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(format!("Color conversion {key} must be true or false"));
        }
    }
    if params.get("intent").is_some_and(|value| !value.is_string()) {
        return Err("Invalid color conversion rendering intent".into());
    }
    if let Some(reason) = engine.disabled_reason(command) {
        return Err(reason);
    }
    let doc = &engine.active().ok_or("No image document")?.doc;
    if doc.mode == ColorMode::Multichannel
        || mode.is_some_and(|mode| mode == doc.mode && params.get("profile").is_none())
    {
        return engine
            .execute(command, params.clone())
            .map_err(|error| error.to_string());
    }
    let destination = if command == "color.profileMismatch" {
        engine.color.working(doc.mode)
    } else {
        let spec = params["profile"]
            .as_str()
            .or(mode.map(|_| "working"))
            .ok_or("Choose a destination color profile")?;
        engine
            .color
            .resolve(spec, Some(doc), mode)
            .map_err(|error| error.to_string())?
    };
    let sample = doc.depth;
    let domain = doc.bounds();
    let dither = params["dither"]
        .as_bool()
        .unwrap_or(engine.color.settings.dither)
        && !document_profile(doc).same_colors(&destination);
    let mut isolated = Session::new();
    let color = super::color_views::Snapshot::capture(engine)?;
    isolated.color = color.native(doc)?;
    let label = if command == "color.profileMismatch" {
        "Convert to Working Space"
    } else if mode.is_some() {
        "Mode Change"
    } else {
        "Convert to Profile"
    };
    let output = engine
        .edit(label, |doc, _| {
            convert(doc, sample, dither, domain, |working| {
                isolated.add_document(working.clone(), None);
                let output = isolated.execute(command, params.clone())?;
                *working = (*isolated.active().ok_or(EngineError::NoDocument)?.doc).clone();
                Ok(output)
            })
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((command.into(), params.clone()));
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(depth: u32) -> Session {
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":32,"height":12,"depth":depth}))
            .unwrap();
        engine
            .edit("Color gradient", |doc, _| {
                let mut values = Vec::new();
                for y in 0..12 {
                    for x in 0..32 {
                        values.extend_from_slice(&[
                            0.2 + x as f32 * 0.009,
                            0.25 + y as f32 * 0.015,
                            0.55,
                            128.0 / 255.0,
                        ]);
                    }
                }
                let area = doc.bounds();
                doc.layers[0]
                    .surface_mut()
                    .unwrap()
                    .write_region(area, &values);
                Ok(())
            })
            .unwrap();
        engine
            .execute("edit.assignProfile", json!({"profile":"display-p3"}))
            .unwrap();
        engine
    }

    #[test]
    fn conversion_dither_is_bounded_unbiased_deterministic_and_keeps_alpha_endpoints_and_defaults()
    {
        let fmt = PixelFormat::new(ColorMode::Rgb, SampleType::F32, true);
        let domain = Rect::new(-7, -3, 513, 9);
        let input =
            Surface::with_default(fmt, &[80.25 / 255.0, 110.75 / 255.0, 1.0, 128.0 / 255.0]);
        let output = quantize(&input, SampleType::U8, true, domain);
        assert_eq!(output, quantize(&input, SampleType::U8, true, domain));
        let pixels = output.read_region(domain);
        let mut sum = [0.0f64; 2];
        let mut high = [0usize; 2];
        for pixel in pixels.chunks_exact(4) {
            for (channel, base) in [(0, 80.0), (1, 110.0)] {
                let value = pixel[channel] * 255.0;
                assert!((value - base).abs() < 0.0001 || (value - base - 1.0).abs() < 0.0001);
                sum[channel] += f64::from(value);
                high[channel] += usize::from(value > base + 0.5);
            }
            assert_eq!(pixel[2], 1.0);
            assert_eq!(pixel[3], 128.0 / 255.0);
        }
        let count = (domain.width() * domain.height()) as f64;
        assert!((sum[0] / count - 80.25).abs() < 0.03);
        assert!((sum[1] / count - 110.75).abs() < 0.03);
        assert!(high
            .iter()
            .all(|count| *count > 0 && *count < pixels.len() / 4));
        assert_eq!(
            output.pixel(600, 20),
            vec![80.0 / 255.0, 111.0 / 255.0, 1.0, 128.0 / 255.0]
        );
        for sample in [SampleType::U16, SampleType::F32] {
            assert_eq!(
                quantize(&input, sample, true, domain),
                quantize(&input, sample, false, domain)
            );
        }
        let transparent = Surface::with_default(fmt, &[0.25, 0.4, 0.7, 0.0]);
        assert_eq!(
            quantize(&transparent, SampleType::U8, true, domain).tile_count(),
            0
        );
        let integer = Surface::with_default(fmt, &[80.0 / 255.0, 0.0, 1.0, 1.0]);
        assert_eq!(
            quantize(&integer, SampleType::U8, true, domain).tile_count(),
            0
        );
    }

    #[test]
    fn conversion_precision_matches_float_cms_and_retains_detail_missing_from_source_depth_quantization(
    ) {
        for source_depth in [8, 16, 32] {
            let engine = fixture(source_depth);
            let original = engine.active().unwrap().doc.clone();
            let destination = engine.color.resolve("srgb", Some(&original), None).unwrap();
            for sample in [SampleType::U8, SampleType::U16, SampleType::F32] {
                let mut actual = (*original).clone();
                let area = actual.bounds();
                convert(&mut actual, sample, false, area, |working| {
                    photocraft_engine::color_cmds::convert_document(
                        working,
                        &destination,
                        engine.color.settings.intent(),
                        true,
                    )
                })
                .unwrap();
                let mut expected = (*original).clone();
                if original.depth != sample {
                    expected.depth = SampleType::F32;
                    let surface = expected.layers[0].surface_mut().unwrap();
                    *surface = surface.convert(PixelFormat {
                        sample: SampleType::F32,
                        ..surface.format()
                    });
                }
                photocraft_engine::color_cmds::convert_document(
                    &mut expected,
                    &destination,
                    engine.color.settings.intent(),
                    true,
                )
                .unwrap();
                let surface = expected.layers[0].surface_mut().unwrap();
                *surface = surface.convert(PixelFormat {
                    sample,
                    ..surface.format()
                });
                expected.depth = sample;
                assert_eq!(actual, expected, "{source_depth}/{sample:?}");
                let converted = actual.layers[0].surface().unwrap().read_region(area);
                let before = original.layers[0].surface().unwrap().read_region(area);
                assert!(converted
                    .chunks_exact(4)
                    .zip(before.chunks_exact(4))
                    .all(|(a, b)| (a[3] - b[3]).abs()
                        <= if sample == SampleType::U8 {
                            1.0 / 255.0
                        } else {
                            1.0 / 65535.0
                        }));
                if source_depth == 8 && sample != SampleType::U8 {
                    assert!(converted
                        .chunks_exact(4)
                        .any(|pixel| (pixel[0] * 255.0 - (pixel[0] * 255.0).round()).abs() > 0.01));
                    let mut prematurely_rounded = (*original).clone();
                    prematurely_rounded.depth = sample;
                    photocraft_engine::color_cmds::convert_document(
                        &mut prematurely_rounded,
                        &destination,
                        engine.color.settings.intent(),
                        true,
                    )
                    .unwrap();
                    let low = prematurely_rounded.layers[0]
                        .surface()
                        .unwrap()
                        .convert(actual.pixel_format());
                    assert_ne!(
                        actual.layers[0].surface().unwrap().read_region(area),
                        low.read_region(area)
                    );
                }
            }
            assert_eq!(&*original, &*engine.active().unwrap().doc);
        }
    }

    #[test]
    fn conversion_command_preview_apply_defaults_override_undo_reopen_and_validation() {
        for depth in [8, 16, 32] {
            let mut engine = fixture(depth);
            let before = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.past_len();
            let journal = engine.journal.clone();
            let params = json!({"profile":"srgb","intent":"perceptual","bpc":false});
            let snapshot = super::super::color_views::Snapshot::capture(&engine).unwrap();
            let preview = super::super::preview::render_with_color(
                engine.active().unwrap(),
                &snapshot,
                "edit.convertToProfile",
                params.clone(),
                None,
            )
            .unwrap();
            execute(&mut engine, "edit.convertToProfile", &params)
                .unwrap()
                .unwrap();
            let after = engine.active().unwrap().doc.clone();
            let view = super::super::display::View::new(&engine.color, &after).unwrap();
            assert_eq!(
                preview.png,
                super::super::render_color_view_preview(&after, &Default::default(), Some(&view))
                    .unwrap()
                    .png
            );
            assert_eq!(engine.active().unwrap().history.past_len(), history + 1);
            assert_eq!(engine.journal.len(), journal.len() + 1);
            let mut disabled = Session::new();
            disabled.add_document((*before).clone(), None);
            let mut params_disabled = params.clone();
            params_disabled["dither"] = json!(false);
            execute(&mut disabled, "edit.convertToProfile", &params_disabled)
                .unwrap()
                .unwrap();
            let area = before.bounds();
            let a = after.layers[0].surface().unwrap().read_region(area);
            let b = disabled.active().unwrap().doc.layers[0]
                .surface()
                .unwrap()
                .read_region(area);
            assert_eq!(a == b, depth != 8);
            let old = before.layers[0].surface().unwrap().read_region(area);
            assert!(a
                .chunks_exact(4)
                .zip(old.chunks_exact(4))
                .all(|(a, b)| a[3] == b[3]));
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(&*engine.active().unwrap().doc, &*before);
            engine.execute("edit.redo", json!({})).unwrap();
            assert_eq!(&*engine.active().unwrap().doc, &*after);
            for name in ["converted.psd", "converted.psb", "converted.png"] {
                let data = photocraft_io::export(&after, name, &Default::default())
                    .unwrap()
                    .bytes;
                let reopened = photocraft_io::import(name, &data).unwrap().document;
                assert_eq!(reopened.icc_profile, after.icc_profile);
                // PNG is a flattened export; PSD/PSB layer samples retain the conversion.
                if !name.ends_with("png") {
                    assert_eq!(reopened.layers[0].surface().unwrap().read_region(area), a);
                }
            }
            for invalid in [
                json!({"profile":"srgb","dither":"yes"}),
                json!({"profile":"srgb","intent":"unknown"}),
                json!({"profile":"srgb","bpc":null}),
            ] {
                let history = engine.active().unwrap().history.past_len();
                let journal = engine.journal.clone();
                assert!(execute(&mut engine, "edit.convertToProfile", &invalid)
                    .unwrap()
                    .is_err());
                assert!(
                    std::sync::Arc::ptr_eq(&after, &engine.active().unwrap().doc)
                        || *after == *engine.active().unwrap().doc
                );
                assert_eq!(engine.active().unwrap().history.past_len(), history);
                assert_eq!(engine.journal, journal);
            }
        }
    }

    #[test]
    fn conversion_mode_import_noop_matching_profile_and_preallocation_failure() {
        for (command, mode) in [
            ("image.mode.rgb", ColorMode::Rgb),
            ("image.mode.grayscale", ColorMode::Grayscale),
            ("image.mode.cmyk", ColorMode::Cmyk),
            ("image.mode.lab", ColorMode::Lab),
        ] {
            let mut engine = fixture(8);
            let before = engine.active().unwrap().doc.clone();
            let past = engine.active().unwrap().history.past_len();
            let params = if mode == ColorMode::Rgb {
                json!({"profile":"srgb"})
            } else {
                json!({})
            };
            execute(&mut engine, command, &params).unwrap().unwrap();
            assert_eq!(engine.active().unwrap().doc.mode, mode);
            assert_eq!(engine.active().unwrap().doc.depth, SampleType::U8);
            assert_eq!(engine.active().unwrap().history.past_len(), past + 1);
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(&*engine.active().unwrap().doc, &*before);
        }
        let mut engine = fixture(8);
        let original = engine.active().unwrap().doc.clone();
        let past = engine.active().unwrap().history.past_len();
        assert_eq!(
            execute(&mut engine, "image.mode.rgb", &json!({}))
                .unwrap()
                .unwrap(),
            Value::Null
        );
        assert!(std::sync::Arc::ptr_eq(
            &original,
            &engine.active().unwrap().doc
        ));
        assert_eq!(engine.active().unwrap().history.past_len(), past);
        execute(
            &mut engine,
            "edit.convertToProfile",
            &json!({"profile":"document"}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(engine.active().unwrap().doc.layers, original.layers);
        let mut converted = fixture(8);
        let mut imported = fixture(8);
        // Match identity as well as values to compare the resulting document.
        *imported.active_mut().unwrap() = converted.active().unwrap().clone();
        execute(
            &mut converted,
            "edit.convertToProfile",
            &json!({"profile":"working"}),
        )
        .unwrap()
        .unwrap();
        let report = super::super::color_settings::analyze(&imported).unwrap();
        super::super::color_import::apply(&mut imported, &report, &json!({"action":"convert"}))
            .unwrap();
        assert_eq!(
            &*converted.active().unwrap().doc,
            &*imported.active().unwrap().doc
        );
        assert_eq!(imported.active().unwrap().history.past_len(), 0);
        let mut huge = Document::new(
            "Admission",
            photocraft_engine::doc::Size::new(65536, 65536),
            ColorMode::Rgb,
            SampleType::U8,
        );
        let mut layer = Layer::raster("Uniform", huge.pixel_format());
        *layer.surface_mut().unwrap() =
            Surface::with_default(huge.pixel_format(), &[0.4, 0.5, 0.6, 1.0]);
        huge.layers.push(layer);
        let before = huge.clone();
        let domain = huge.bounds();
        let mut applied = false;
        assert!(convert(&mut huge, SampleType::U8, true, domain, |_| {
            applied = true;
            Ok(())
        })
        .is_err());
        assert!(!applied);
        assert_eq!(huge, before);
    }

    #[test]
    fn conversion_traverses_nested_color_pixels_and_preserves_masks_channels_selection_and_failed_source(
    ) {
        let mut engine = fixture(8);
        engine
            .execute(
                "select.rect",
                json!({"x":2,"y":1,"width":12,"height":6,"feather":1}),
            )
            .unwrap();
        engine
            .edit("Nested numeric planes", |doc, _| {
                let plane = Surface::with_default(
                    PixelFormat::new(ColorMode::Grayscale, SampleType::U16, false),
                    &[0.37],
                );
                let mut mask = photocraft_engine::doc::LayerMask::reveal_all();
                mask.surface = plane.clone();
                mask.density = 0.73;
                mask.feather = 1.2;
                mask.linked = false;
                doc.layers[0].mask = Some(mask);
                doc.layers[0]
                    .surface_mut()
                    .unwrap()
                    .write_pixel(-2, -1, &[0.35, 0.4, 0.6, 0.8]);
                doc.channels.push(photocraft_engine::doc::AlphaChannel::new(
                    "Alpha",
                    plane.clone(),
                ));
                doc.quick_mask = Some(photocraft_engine::doc::AlphaChannel::new(
                    "Quick Mask",
                    plane,
                ));
                doc.layers = vec![Layer::group("Nested", std::mem::take(&mut doc.layers))];
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        execute(
            &mut engine,
            "edit.convertToProfile",
            &json!({"profile":"srgb","dither":true}),
        )
        .unwrap()
        .unwrap();
        let after = engine.active().unwrap().doc.clone();
        let old = &before.layers[0].children().unwrap()[0];
        let new = &after.layers[0].children().unwrap()[0];
        assert_eq!(old.mask, new.mask);
        assert_eq!(before.channels, after.channels);
        assert_eq!(before.quick_mask, after.quick_mask);
        assert_eq!(before.selection, after.selection);
        assert_ne!(
            old.surface().unwrap().pixel(-2, -1),
            new.surface().unwrap().pixel(-2, -1)
        );
        assert_eq!(
            old.surface().unwrap().pixel(-2, -1)[3],
            new.surface().unwrap().pixel(-2, -1)[3]
        );
        let mut failed = (*before).clone();
        let area = failed.bounds();
        assert!(convert(&mut failed, SampleType::U8, true, area, |doc| {
            doc.name = "Discarded working image".into();
            Err::<(), _>(EngineError::Other("Injected conversion failure".into()))
        })
        .is_err());
        assert_eq!(failed, *before);
    }
}
