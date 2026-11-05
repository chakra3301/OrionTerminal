use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{ColorMode, Document, Layer, LayerId, PixelFormat, Rect, SampleType, Surface},
    edit_cmds::Clip,
    DocState, Session,
};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Target {
    Mask(LayerId),
    Alpha(usize),
    QuickMask,
    Color(LayerId, usize),
}
pub(super) fn target(engine: &Session, params: &Value) -> Result<Option<Target>, String> {
    let state = engine
        .active()
        .ok_or("Open an image before using its clipboard")?;
    let layer = || {
        state
            .active_layer
            .ok_or("Select a layer before editing its channel")
    };
    let result = match params.get("target") {
        Some(value) if value == "pixels" => None,
        Some(value) if value == "mask" => Some(Target::Mask(layer()?)),
        Some(value) if value == "quickMask" => Some(Target::QuickMask),
        Some(value) if value["channel"].as_u64().is_some() => Some(Target::Alpha(
            usize::try_from(value["channel"].as_u64().unwrap())
                .map_err(|_| "Invalid clipboard channel")?,
        )),
        Some(value) if value["color"].as_u64().is_some() => Some(Target::Color(
            layer()?,
            usize::try_from(value["color"].as_u64().unwrap())
                .map_err(|_| "Invalid clipboard color channel")?,
        )),
        Some(_) => return Err("Invalid image clipboard target".into()),
        None => match state.channel_view.target {
            ChannelTarget::Alpha(index) => Some(Target::Alpha(index)),
            ChannelTarget::Color(index) => Some(Target::Color(layer()?, index)),
            ChannelTarget::Composite if state.doc.quick_mask.is_some() => Some(Target::QuickMask),
            ChannelTarget::Composite => photocraft_engine::mask_view_cmds::current(state)
                .map(|view| Target::Mask(view.layer)),
        },
    };
    if let Some(target) = result {
        if let Target::Color(id, index) = target {
            if index >= state.doc.pixel_format().mode.color_channels()
                || state.doc.layer(id).is_none()
            {
                return Err("The clipboard color channel no longer exists".into());
            }
        } else {
            surface(state, target)?;
        }
    }
    Ok(result)
}
fn surface(state: &DocState, target: Target) -> Result<&Surface, String> {
    match target {
        Target::Alpha(index) => state
            .doc
            .channels
            .get(index)
            .map(|channel| &channel.surface)
            .ok_or("The clipboard channel no longer exists".into()),
        Target::QuickMask => state
            .doc
            .quick_mask
            .as_ref()
            .map(|mask| &mask.surface)
            .ok_or("Not in Quick Mask mode".into()),
        Target::Mask(id) => state
            .doc
            .layer(id)
            .and_then(|layer| layer.mask.as_ref())
            .map(|mask| &mask.surface)
            .ok_or("The clipboard layer mask no longer exists".into()),
        Target::Color(id, index) => {
            let surface = state
                .doc
                .layer(id)
                .and_then(Layer::surface)
                .ok_or("The selected color channel has no layer pixels")?;
            if index >= surface.format().mode.color_channels()
                || surface.format().mode != state.doc.pixel_format().mode
            {
                return Err("The selected color channel does not match the layer format".into());
            }
            Ok(surface)
        }
    }
}
fn editable(state: &DocState, target: Target) -> Result<(), String> {
    surface(state, target)?;
    if let Target::Mask(id) | Target::Color(id, _) = target {
        let layer = state
            .doc
            .layer(id)
            .ok_or("The clipboard layer no longer exists")?;
        if layer.locks.all || matches!(target, Target::Color(_, _)) && layer.locks.pixels {
            return Err("The clipboard target is locked".into());
        }
        if matches!(target, Target::Color(_, _))
            && !matches!(
                layer.content,
                photocraft_engine::doc::LayerContent::Raster(_)
            )
        {
            return Err("Rasterize the layer before changing its color channel".into());
        }
    }
    Ok(())
}
fn regions(area: Rect) -> impl Iterator<Item = Rect> {
    (area.y0..area.y1).step_by(256).flat_map(move |y| {
        (area.x0..area.x1).step_by(512).map(move |x| {
            Rect::from_xywh(
                x,
                y,
                (area.x1 - x).min(512) as u32,
                (area.y1 - y).min(256) as u32,
            )
        })
    })
}
fn admit(area: Rect) -> Result<(), String> {
    if area.is_empty()
        || u64::from(area.width()) * u64::from(area.height()) > super::super::MAX_PIXELS
    {
        return Err("The clipboard area is empty or exceeds the image editing limit".into());
    }
    Ok(())
}
fn replace(
    doc: &mut Document,
    target: Target,
    surface: Surface,
) -> Result<(), photocraft_engine::EngineError> {
    match target {
        Target::Mask(id) => {
            doc.layer_mut(id)
                .and_then(|layer| layer.mask.as_mut())
                .ok_or_else(|| {
                    photocraft_engine::EngineError::Other("Missing clipboard mask".into())
                })?
                .surface = surface
        }
        Target::Alpha(index) => {
            doc.channels
                .get_mut(index)
                .ok_or_else(|| {
                    photocraft_engine::EngineError::Other("Missing clipboard channel".into())
                })?
                .surface = surface
        }
        Target::QuickMask => {
            doc.quick_mask
                .as_mut()
                .ok_or_else(|| photocraft_engine::EngineError::Other("Missing Quick Mask".into()))?
                .surface = surface
        }
        Target::Color(id, _) => {
            *doc.layer_mut(id)
                .and_then(Layer::surface_mut)
                .ok_or_else(|| {
                    photocraft_engine::EngineError::Other("Missing clipboard layer".into())
                })? = surface
        }
    }
    Ok(())
}
pub(super) fn copy(
    engine: &mut Session,
    target: Target,
    command: &str,
    params: &Value,
) -> Result<Clip, String> {
    let state = engine.active().cloned().ok_or("No clipboard source")?;
    if command == "edit.cut" {
        editable(&state, target)?;
    }
    let merged_color = command == "edit.copyMerged" && matches!(target, Target::Color(_, _));
    let original = if merged_color {
        None
    } else {
        Some(surface(&state, target)?)
    };
    let area = state
        .doc
        .selection
        .as_ref()
        .map_or(state.doc.bounds(), |mask| {
            mask.content_bounds().intersect(&state.doc.bounds())
        });
    admit(area)?;
    let sample = if command == "edit.copyMerged" && matches!(target, Target::Color(_, _)) {
        state.doc.depth
    } else {
        original
            .ok_or("No clipboard source pixels")?
            .format()
            .sample
    };
    let mut copied = Surface::new(PixelFormat::new(ColorMode::Grayscale, sample, true));
    for rect in regions(area) {
        let (data, count) = if command == "edit.copyMerged" && matches!(target, Target::Color(_, _))
        {
            let format = state.doc.pixel_format();
            (
                photocraft_compose::render(&state.doc, rect)
                    .px
                    .into_iter()
                    .flat_map(|pixel| photocraft_raster::from_rgba(&format, pixel))
                    .collect::<Vec<f32>>(),
                format.channels(),
            )
        } else {
            {
                let original = original.ok_or("No clipboard source pixels")?;
                (original.read_region(rect), original.channels())
            }
        };
        let channel = match target {
            Target::Color(_, index) => index,
            _ => 0,
        };
        let mask = state
            .doc
            .selection
            .as_ref()
            .map(|mask| photocraft_algo::selection::mask_from_surface(Some(mask), rect));
        let values: Vec<f32> = data
            .chunks_exact(count)
            .enumerate()
            .flat_map(|(index, pixel)| {
                [
                    pixel[channel],
                    mask.as_ref().map_or(1.0, |mask| mask[index]),
                ]
            })
            .collect();
        copied.write_region(rect, &values);
    }
    copied.prune();
    let bounds = copied.content_bounds();
    admit(bounds)?;
    if command == "edit.cut" {
        let original = original.ok_or("No clipboard source pixels")?;
        let mut output = original.clone();
        let channel = match target {
            Target::Color(_, index) => index,
            _ => 0,
        };
        let background = photocraft_raster::from_rgba(
            &PixelFormat::new(ColorMode::Grayscale, SampleType::F32, false),
            engine.tools.background,
        )[0];
        for rect in regions(area) {
            let mut data = original.read_region(rect);
            let mask = state
                .doc
                .selection
                .as_ref()
                .map(|mask| photocraft_algo::selection::mask_from_surface(Some(mask), rect));
            for (index, pixel) in data.chunks_exact_mut(original.channels()).enumerate() {
                let weight = mask.as_ref().map_or(1.0, |mask| mask[index]);
                if weight > 0.0 {
                    pixel[channel] += (background - pixel[channel]) * weight;
                }
            }
            output.write_region(rect, &data);
        }
        output.prune();
        engine
            .edit("Cut channel", move |doc, _| replace(doc, target, output))
            .map_err(|error| error.to_string())?;
        engine.journal.push((command.into(), params.clone()));
    }
    Ok(Clip {
        surface: copied,
        bounds,
    })
}
pub(super) fn question(engine: &Session, target: Target, command: &str) -> Result<(), String> {
    let state = engine.active().ok_or("No paste target")?;
    editable(state, target)?;
    admit(state.doc.bounds())?;
    if matches!(
        command,
        "edit.pasteSpecial.pasteInto" | "edit.pasteSpecial.pasteOutside"
    ) && state.doc.selection.is_none()
    {
        return Err("Paste Into or Outside needs a selection".into());
    }
    Ok(())
}
pub(super) fn paste(
    engine: &mut Session,
    target: Target,
    clip: &Clip,
    command: &str,
    params: &Value,
) -> Result<Value, String> {
    question(engine, target, command)?;
    let state = engine.active().cloned().ok_or("No paste target")?;
    let original = surface(&state, target)?;
    let mut proxy = Session::new();
    let mut doc = Document::new(
        "Clipboard geometry",
        state.doc.size,
        ColorMode::Grayscale,
        SampleType::F32,
    );
    doc.selection = state.doc.selection.clone();
    proxy.add_document(doc, None);
    proxy.clipboard = Some(Clip {
        surface: clip.surface.convert(PixelFormat::new(
            ColorMode::Grayscale,
            SampleType::F32,
            true,
        )),
        bounds: clip.bounds,
    });
    let geometry = proxy
        .execute(command, params.clone())
        .map_err(|error| error.to_string())?;
    let pasted = proxy.active().ok_or("No pasted clipboard geometry")?;
    let layer = pasted
        .doc
        .layer(pasted.active_layer.ok_or("No clipboard geometry layer")?)
        .ok_or("Missing clipboard geometry")?;
    let source = layer.surface().ok_or("Missing pasted pixels")?;
    let area = source.content_bounds().intersect(&state.doc.bounds());
    let mut output = original.clone();
    let channel = match target {
        Target::Color(_, index) => index,
        _ => 0,
    };
    for rect in regions(area) {
        let pixels = source.read_region(rect);
        let mut data = original.read_region(rect);
        let mask = layer
            .mask
            .as_ref()
            .map(|mask| photocraft_algo::selection::mask_from_surface(Some(&mask.surface), rect))
            .or_else(|| {
                state
                    .doc
                    .selection
                    .as_ref()
                    .map(|mask| photocraft_algo::selection::mask_from_surface(Some(mask), rect))
            });
        for (index, (old, new)) in data
            .chunks_exact_mut(original.channels())
            .zip(pixels.chunks_exact(source.channels()))
            .enumerate()
        {
            let weight = new[1].clamp(0.0, 1.0) * mask.as_ref().map_or(1.0, |mask| mask[index]);
            if weight > 0.0 {
                old[channel] += (new[0] - old[channel]) * weight;
            }
        }
        output.write_region(rect, &data);
    }
    output.prune();
    engine
        .edit("Paste channel", move |doc, _| {
            replace(doc, target, output)?;
            doc.selection = None;
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.journal.push((command.into(), params.clone()));
    Ok(
        json!({"offset":geometry["offset"],"target":match target{Target::Mask(id)=>json!({"mask":id.0}),Target::Alpha(index)=>json!({"channel":index}),Target::QuickMask=>json!("quickMask"),Target::Color(id,index)=>json!({"layer":id.0,"color":index})}}),
    )
}

#[cfg(test)]
mod tests {
    use super::super::tests::{fixture, serial, session};
    use super::super::{copy as copy_pixels, paste as paste_pixels, question as paste_question};
    use super::*;
    use std::sync::Arc;
    fn prepared(mode: &str, depth: u32, kind: usize) -> (Session, Target, Value) {
        let mut engine = fixture(
            mode,
            depth,
            match mode {
                "rgb" => "display-p3",
                "gray" => "sgray",
                "cmyk" => "coated-cmyk",
                _ => "lab-d50",
            },
        );
        let id = engine.active().unwrap().active_layer.unwrap();
        let mut plane = Surface::new(PixelFormat::new(
            ColorMode::Grayscale,
            engine.active().unwrap().doc.depth,
            false,
        ));
        for y in -2..18 {
            for x in -2..22 {
                plane.write_pixel(x, y, &[((x + 2 + 3 * (y + 2)) % 17) as f32 / 16.0]);
            }
        }
        let mut doc = (*engine.active().unwrap().doc).clone();
        let (target, params) = match kind {
            0 => {
                let mut mask = photocraft_engine::doc::LayerMask::reveal_all();
                mask.surface = plane;
                mask.density = 0.73;
                mask.feather = 1.2;
                mask.linked = false;
                doc.layer_mut(id).unwrap().mask = Some(mask);
                (Target::Mask(id), json!({"target":"mask"}))
            }
            1 => {
                doc.channels
                    .push(photocraft_engine::doc::AlphaChannel::new("Coverage", plane));
                (Target::Alpha(0), json!({}))
            }
            2 => {
                doc.quick_mask = Some(photocraft_engine::doc::AlphaChannel::new(
                    "Quick Mask",
                    plane,
                ));
                (Target::QuickMask, json!({}))
            }
            _ => (
                Target::Color(id, 0),
                if mode == "gray" {
                    json!({"target":{"color":0}})
                } else {
                    json!({})
                },
            ),
        };
        engine.active_mut().unwrap().doc = Arc::new(doc);
        engine.active_mut().unwrap().channel_view.target = match target {
            Target::Alpha(index) => ChannelTarget::Alpha(index),
            Target::Color(_, index) => ChannelTarget::Color(index),
            _ => ChannelTarget::Composite,
        };
        engine
            .execute(
                "select.rect",
                json!({"x":3,"y":2,"width":10,"height":8,"feather":1}),
            )
            .unwrap();
        (engine, target, params)
    }
    fn check_pixels(before: &DocState, target: Target, command: &str) -> Clip {
        let source = if command == "edit.copyMerged" && matches!(target, Target::Color(_, _)) {
            photocraft_compose::flatten_to_surface(&before.doc, before.doc.pixel_format(), None)
        } else {
            surface(before, target).unwrap().clone()
        };
        let channel = match target {
            Target::Color(_, index) => index,
            _ => 0,
        };
        let mut gray = Surface::new(PixelFormat::new(
            ColorMode::Grayscale,
            source.format().sample,
            true,
        ));
        let bounds = before.doc.bounds();
        for y in bounds.y0..bounds.y1 {
            for x in bounds.x0..bounds.x1 {
                gray.write_pixel(x, y, &[source.sample_channel(x, y, channel), 1.0]);
            }
        }
        let mut native = Session::new();
        let mut doc = Document::new(
            "Plane oracle",
            before.doc.size,
            ColorMode::Grayscale,
            source.format().sample,
        );
        doc.selection = before.doc.selection.clone();
        let mut layer = Layer::raster("Plane", gray.format());
        *layer.surface_mut().unwrap() = gray;
        doc.layers.push(layer);
        native.add_document(doc, None);
        native.execute("edit.copy", json!({})).unwrap();
        native.clipboard.unwrap()
    }
    #[test]
    fn clipboard_planes_copy_cut_and_merged_match_native_gray_lift_and_keep_other_channels_metadata_and_undo(
    ) {
        let _guard = serial();
        for mode in ["rgb", "gray", "cmyk", "lab"] {
            for depth in [8, 16, 32] {
                for kind in 0..4 {
                    for command in ["edit.copy", "edit.copyMerged", "edit.cut"] {
                        let (mut engine, target, params) = prepared(mode, depth, kind);
                        let before = engine.active().unwrap().clone();
                        let expected = check_pixels(&before, target, command);
                        let (_, pixels) = copy_pixels(&mut engine, command, params).unwrap();
                        assert!(pixels.numeric, "{mode}/{depth}/{kind}/{command}");
                        assert_eq!(pixels.clip.bounds, expected.bounds);
                        assert_eq!(pixels.clip.surface.format(), expected.surface.format());
                        assert_eq!(
                            pixels.clip.surface.read_region(expected.bounds),
                            expected.surface.read_region(expected.bounds),
                            "{mode}/{depth}/{kind}/{command}"
                        );
                        if command == "edit.cut" {
                            let original = surface(&before, target).unwrap();
                            let mut cleared = original.clone();
                            let channel = match target {
                                Target::Color(_, index) => index,
                                _ => 0,
                            };
                            let bg = photocraft_raster::from_rgba(
                                &PixelFormat::new(ColorMode::Grayscale, SampleType::F32, false),
                                engine.tools.background,
                            )[0];
                            let area = before
                                .doc
                                .selection
                                .as_ref()
                                .unwrap()
                                .content_bounds()
                                .intersect(&before.doc.bounds());
                            for y in area.y0..area.y1 {
                                for x in area.x0..area.x1 {
                                    let mut value =
                                        original.read_region(Rect::from_xywh(x, y, 1, 1));
                                    let weight = before
                                        .doc
                                        .selection
                                        .as_ref()
                                        .unwrap()
                                        .sample_channel(x, y, 0);
                                    if weight > 0.0 {
                                        value[channel] += (bg - value[channel]) * weight;
                                    }
                                    cleared.write_pixel(x, y, &value);
                                }
                            }
                            cleared.prune();
                            let mut expected_doc = (*before.doc).clone();
                            replace(&mut expected_doc, target, cleared).unwrap();
                            assert_eq!(
                                &*engine.active().unwrap().doc,
                                &expected_doc,
                                "{mode}/{depth}/{kind}"
                            );
                            assert_eq!(
                                engine.active().unwrap().history.past_len(),
                                before.history.past_len() + 1
                            );
                            engine.execute("edit.undo", json!({})).unwrap();
                            assert_eq!(&*engine.active().unwrap().doc, &*before.doc);
                        } else {
                            assert!(Arc::ptr_eq(&before.doc, &engine.active().unwrap().doc));
                            assert_eq!(
                                engine.active().unwrap().history.past_len(),
                                before.history.past_len()
                            );
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn clipboard_planes_paste_every_variant_uses_native_geometry_and_numeric_alpha_without_touching_other_pixels(
    ) {
        let _guard = serial();
        let mut source = fixture("rgb", 16, "display-p3");
        source
            .execute(
                "select.rect",
                json!({"x":3,"y":2,"width":10,"height":8,"feather":1}),
            )
            .unwrap();
        let (_, image) = copy_pixels(&mut source, "edit.copy", json!({})).unwrap();
        let (mut gray, _, params) = prepared("rgb", 32, 1);
        let (_, plane) = copy_pixels(&mut gray, "edit.copy", params).unwrap();
        for pixels in [image, plane] {
            let retained = pixels.clip.surface.read_region(pixels.clip.bounds);
            for mode in ["rgb", "gray", "cmyk", "lab"] {
                for depth in [8, 16, 32] {
                    for kind in 0..4 {
                        for command in [
                            "edit.paste",
                            "edit.pasteSpecial.pasteInPlace",
                            "edit.pasteSpecial.pasteInto",
                            "edit.pasteSpecial.pasteOutside",
                        ] {
                            let (mut engine, target, mut params) = prepared(mode, depth, kind);
                            params["center"] = json!([10.5, 8.25]);
                            let before = engine.active().unwrap().clone();
                            assert!(paste_question(&mut engine, &pixels, command, &params)
                                .unwrap()
                                .is_none());
                            let settings = engine.color.settings.clone();
                            let mut oracle = Session::new();
                            let mut doc = Document::new(
                                "Geometry oracle",
                                before.doc.size,
                                ColorMode::Grayscale,
                                SampleType::F32,
                            );
                            doc.selection = before.doc.selection.clone();
                            oracle.add_document(doc, None);
                            oracle.clipboard = Some(Clip {
                                surface: pixels.clip.surface.convert(PixelFormat::new(
                                    ColorMode::Grayscale,
                                    SampleType::F32,
                                    true,
                                )),
                                bounds: pixels.clip.bounds,
                            });
                            let geometry = oracle.execute(command, params.clone()).unwrap();
                            let pasted = oracle.active().unwrap();
                            let layer = pasted.doc.layer(pasted.active_layer.unwrap()).unwrap();
                            let top = layer.surface().unwrap();
                            let original = surface(&before, target).unwrap();
                            let mut expected = original.clone();
                            let channel = match target {
                                Target::Color(_, index) => index,
                                _ => 0,
                            };
                            let area = top.content_bounds().intersect(&before.doc.bounds());
                            for y in area.y0..area.y1 {
                                for x in area.x0..area.x1 {
                                    let mut old = original.read_region(Rect::from_xywh(x, y, 1, 1));
                                    let coverage = layer
                                        .mask
                                        .as_ref()
                                        .map(|mask| mask.surface.sample_channel(x, y, 0))
                                        .or_else(|| {
                                            before
                                                .doc
                                                .selection
                                                .as_ref()
                                                .map(|mask| mask.sample_channel(x, y, 0))
                                        })
                                        .unwrap_or(1.0);
                                    let alpha =
                                        top.sample_channel(x, y, 1).clamp(0.0, 1.0) * coverage;
                                    if alpha > 0.0 {
                                        old[channel] +=
                                            (top.sample_channel(x, y, 0) - old[channel]) * alpha;
                                    }
                                    expected.write_pixel(x, y, &old);
                                }
                            }
                            expected.prune();
                            let mut expected_doc = (*before.doc).clone();
                            replace(&mut expected_doc, target, expected).unwrap();
                            expected_doc.selection = None;
                            let result = paste_pixels(
                                &mut engine,
                                &pixels,
                                command,
                                params,
                                None,
                                &settings,
                            )
                            .unwrap();
                            assert_eq!(result["offset"], geometry["offset"]);
                            assert_eq!(
                                &*engine.active().unwrap().doc,
                                &expected_doc,
                                "{mode}/{depth}/{kind}/{command}"
                            );
                            assert_eq!(
                                engine.active().unwrap().history.past_len(),
                                before.history.past_len() + 1
                            );
                            assert_eq!(engine.active().unwrap().channel_view, before.channel_view);
                            assert!(engine.clipboard.is_none());
                            engine.execute("edit.undo", json!({})).unwrap();
                            assert_eq!(&*engine.active().unwrap().doc, &*before.doc);
                            engine.execute("edit.redo", json!({})).unwrap();
                            assert_eq!(&*engine.active().unwrap().doc, &expected_doc);
                        }
                    }
                }
            }
            assert_eq!(
                pixels.clip.surface.read_region(pixels.clip.bounds),
                retained
            );
        }
    }
    #[test]
    fn clipboard_planes_black_and_layerless_channels_copy_and_become_tagged_gray_images() {
        let _guard = serial();
        for depth in [8, 16, 32] {
            let (mut engine, target, params) = prepared("rgb", depth, 1);
            let mut doc = (*engine.active().unwrap().doc).clone();
            doc.channels[0].surface =
                Surface::new(photocraft_engine::channel_cmds::channel_format(&doc));
            doc.layers.clear();
            doc.selection = None;
            engine.active_mut().unwrap().doc = Arc::new(doc);
            engine.active_mut().unwrap().active_layer = None;
            assert_eq!(target, Target::Alpha(0));
            let (_, copied) = copy_pixels(&mut engine, "edit.copy", params.clone()).unwrap();
            assert_eq!(copied.clip.bounds, engine.active().unwrap().doc.bounds());
            assert!(copied
                .clip
                .surface
                .read_region(copied.clip.bounds)
                .chunks_exact(2)
                .all(|pixel| pixel == [0.0, 1.0]));
            let settings = engine.color.settings.clone();
            paste_pixels(&mut engine, &copied, "edit.paste", params, None, &settings).unwrap();
            assert!(engine.active().unwrap().doc.layers.is_empty());
            let mut image = Session::new();
            let settings = image.color.settings.clone();
            paste_pixels(
                &mut image,
                &copied,
                "file.newFromClipboard",
                json!({}),
                None,
                &settings,
            )
            .unwrap();
            let state = image.active().unwrap();
            assert_eq!(state.doc.mode, ColorMode::Grayscale);
            assert_eq!(state.doc.depth, copied.clip.surface.format().sample);
            assert_eq!(
                state.doc.icc_profile.as_ref().unwrap(),
                &copied.profile_data
            );
            assert_eq!(state.history.past_len(), 0);
        }
    }
    #[test]
    fn clipboard_planes_locked_missing_and_failed_publication_targets_roll_back_and_retry_native_reopen(
    ) {
        let _guard = serial();
        let (mut source, _, params) = prepared("rgb", 16, 0);
        let (_, pixels) = copy_pixels(&mut source, "edit.copy", params).unwrap();
        super::super::set(pixels.clone()).unwrap();
        let (mut target, plane, params) = prepared("rgb", 16, 1);
        let before = target.active().unwrap().clone();
        let settings = target.color.settings.clone();
        for params in [
            json!({"target":true}),
            json!({"target":{"channel":64}}),
            json!({"target":"mask"}),
        ] {
            assert!(
                paste_pixels(&mut target, &pixels, "edit.paste", params, None, &settings).is_err()
            );
            assert!(Arc::ptr_eq(&before.doc, &target.active().unwrap().doc));
        }
        let (mut locked, _, locked_params) = prepared("rgb", 8, 0);
        Arc::make_mut(&mut locked.active_mut().unwrap().doc)
            .layers
            .last_mut()
            .unwrap()
            .locks
            .all = true;
        let before = locked.active().unwrap().doc.clone();
        assert!(copy_pixels(&mut locked, "edit.cut", locked_params.clone()).is_err());
        assert!(paste_pixels(
            &mut locked,
            &pixels,
            "edit.paste",
            locked_params,
            None,
            &settings
        )
        .is_err());
        assert!(Arc::ptr_eq(&before, &locked.active().unwrap().doc));
        let directory = std::env::temp_dir().join(format!("xdesign-plane-{}", ulid::Ulid::new()));
        std::fs::create_dir(&directory).unwrap();
        let occupied = directory.join("occupied");
        std::fs::write(&occupied, b"keep").unwrap();
        let mut target = session(target);
        let version = target.version.clone();
        let before = target.engine.active().unwrap().clone();
        let journal = target.engine.journal.clone();
        let request = ulid::Ulid::new().to_string();
        let project = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        assert!(super::super::commit_existing(
            &mut target,
            &occupied,
            &request,
            &project,
            &photo,
            "edit.paste",
            &params,
            None,
            None,
            vec![]
        )
        .is_err());
        assert!(Arc::ptr_eq(
            &before.doc,
            &target.engine.active().unwrap().doc
        ));
        assert_eq!(target.version, version);
        assert_eq!(target.engine.journal, journal);
        assert!(super::super::receipt(
            &request,
            &project,
            &photo,
            &Some(version.clone()),
            "edit.paste",
            &params
        )
        .unwrap()
        .is_none());
        assert!(Arc::ptr_eq(&super::super::current().unwrap(), &pixels));
        let response = super::super::commit_existing(
            &mut target,
            &directory.join("image"),
            &request,
            &project,
            &photo,
            "edit.paste",
            &params,
            None,
            None,
            vec![],
        )
        .unwrap();
        assert_ne!(response.document.version, version);
        let restored =
            super::super::super::restore(&directory.join("image"), &target.version, None).unwrap();
        assert_eq!(
            &*restored.engine.active().unwrap().doc,
            &*target.engine.active().unwrap().doc
        );
        assert_eq!(
            surface(restored.engine.active().unwrap(), plane)
                .unwrap()
                .read_region(before.doc.bounds()),
            surface(target.engine.active().unwrap(), plane)
                .unwrap()
                .read_region(before.doc.bounds())
        );
        assert_eq!(
            restored.engine.active().unwrap().history.past_len(),
            before.history.past_len() + 1
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }
    #[test]
    fn clipboard_planes_copy_merged_color_allows_group_targets_and_numeric_values_do_not_apply_color_policy(
    ) {
        let _guard = serial();
        let (mut engine, _, _) = prepared("rgb", 32, 3);
        engine.execute("layer.groupLayers", json!({})).unwrap();
        let id = engine.active().unwrap().active_layer.unwrap();
        engine.active_mut().unwrap().channel_view.target = ChannelTarget::Color(0);
        let (_, pixels) = copy_pixels(&mut engine, "edit.copyMerged", json!({})).unwrap();
        assert!(pixels.numeric);
        assert!(engine.active().unwrap().doc.layer(id).unwrap().is_group());
        let (target, plane, params) = prepared("cmyk", 16, 1);
        let mut first = session(target);
        for policy in [
            photocraft_engine::color_cmds::Policy::Off,
            photocraft_engine::color_cmds::Policy::Preserve,
            photocraft_engine::color_cmds::Policy::Convert,
        ] {
            let before = first.engine.active().unwrap().clone();
            first.engine.color.settings.policy_cmyk = policy;
            let settings = first.engine.color.settings.clone();
            paste_pixels(
                &mut first.engine,
                &pixels,
                "edit.paste",
                params.clone(),
                None,
                &settings,
            )
            .unwrap();
            let value = surface(first.engine.active().unwrap(), plane)
                .unwrap()
                .read_region(before.doc.bounds());
            first.engine.execute("edit.undo", json!({})).unwrap();
            let fixed = first.engine.color.settings.clone();
            paste_pixels(
                &mut first.engine,
                &pixels,
                "edit.paste",
                params.clone(),
                Some("numbers"),
                &fixed,
            )
            .unwrap();
            assert_eq!(
                surface(first.engine.active().unwrap(), plane)
                    .unwrap()
                    .read_region(before.doc.bounds()),
                value
            );
            first.engine.execute("edit.undo", json!({})).unwrap();
        }
    }

    #[test]
    fn clipboard_planes_gray_coverage_pastes_back_to_color_images_through_reviewed_icc_conversion()
    {
        let _guard = serial();
        let (mut source, _, params) = prepared("rgb", 16, 1);
        let (_, pixels) = copy_pixels(&mut source, "edit.copy", params).unwrap();
        let retained = pixels.clip.surface.read_region(pixels.clip.bounds);
        for (mode, profile) in [("rgb", "srgb"), ("cmyk", "coated-cmyk"), ("lab", "lab-d50")] {
            for depth in [8, 16, 32] {
                let mut actual = fixture(mode, depth, profile);
                actual.color.settings.dither = false;
                let before = actual.active().unwrap().clone();
                let report = paste_question(&mut actual, &pixels, "edit.paste", &json!({}))
                    .unwrap()
                    .unwrap();
                assert_eq!(report["canKeepNumbers"], false);
                let settings = actual.color.settings.clone();
                assert!(paste_pixels(
                    &mut actual,
                    &pixels,
                    "edit.paste",
                    json!({}),
                    Some("numbers"),
                    &settings
                )
                .is_err());
                assert!(Arc::ptr_eq(&before.doc, &actual.active().unwrap().doc));
                let mut converted = Document::new(
                    "Coverage oracle",
                    before.doc.size,
                    ColorMode::Grayscale,
                    if pixels.clip.surface.format().sample == before.doc.depth {
                        before.doc.depth
                    } else {
                        SampleType::F32
                    },
                );
                converted.icc_profile = Some(pixels.profile_data.clone());
                let mut layer = Layer::raster("Coverage", pixels.clip.surface.format());
                *layer.surface_mut().unwrap() = pixels.clip.surface.convert(PixelFormat {
                    sample: converted.depth,
                    ..pixels.clip.surface.format()
                });
                converted.layers.push(layer);
                photocraft_engine::color_cmds::convert_document(
                    &mut converted,
                    &photocraft_engine::color_cmds::document_profile(&before.doc),
                    settings.intent(),
                    settings.bpc,
                )
                .unwrap();
                let mut expected = Session::new();
                expected.add_document((*before.doc).clone(), None);
                *expected.active_mut().unwrap() = before.clone();
                expected.clipboard = Some(Clip {
                    surface: converted.layers[0].surface().unwrap().convert(PixelFormat {
                        sample: before.doc.depth,
                        ..converted.layers[0].surface().unwrap().format()
                    }),
                    bounds: pixels.clip.bounds,
                });
                expected.execute("edit.paste", json!({})).unwrap();
                paste_pixels(
                    &mut actual,
                    &pixels,
                    "edit.paste",
                    json!({}),
                    Some("convert"),
                    &settings,
                )
                .unwrap();
                let actual_layer = actual
                    .active()
                    .unwrap()
                    .doc
                    .layer(actual.active().unwrap().active_layer.unwrap())
                    .unwrap();
                let expected_layer = expected
                    .active()
                    .unwrap()
                    .doc
                    .layer(expected.active().unwrap().active_layer.unwrap())
                    .unwrap();
                let area = actual_layer
                    .surface()
                    .unwrap()
                    .content_bounds()
                    .union(&expected_layer.surface().unwrap().content_bounds());
                assert_eq!(
                    actual_layer.surface().unwrap().read_region(area),
                    expected_layer.surface().unwrap().read_region(area)
                );
                assert_eq!(
                    actual.active().unwrap().doc.icc_profile,
                    before.doc.icc_profile
                );
                actual.execute("edit.undo", json!({})).unwrap();
                assert_eq!(&*actual.active().unwrap().doc, &*before.doc);
            }
        }
        assert_eq!(
            pixels.clip.surface.read_region(pixels.clip.bounds),
            retained
        );
    }
}
