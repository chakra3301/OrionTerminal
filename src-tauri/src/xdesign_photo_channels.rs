//! Current-document channel compositing. PhotoCraft evaluates sources/blends;
//! the host fixes mask routing and commits one edit without temporary channels.
use photocraft_engine::{
    channel_cmds::{ChanRef, ChannelTarget},
    doc::{AlphaChannel, LayerId},
    DocState, Session,
};
use photocraft_raster::Surface;
use serde_json::{json, Value};

pub(super) const MAX_COMPOSITE_PIXELS: u64 = super::MAX_PIXELS;

#[derive(Clone, Copy)]
pub(super) enum Target {
    Pixels(LayerId),
    Mask(LayerId),
    Alpha(usize),
    QuickMask,
}

fn source_spec(params: &Value, key: &str) -> Value {
    if let Some(source) = params.get(key) {
        return source.clone();
    }
    let mut source = serde_json::Map::new();
    for (name, suffix) in [
        ("document", "Document"),
        ("layer", "Layer"),
        ("channel", "Channel"),
        ("invert", "Invert"),
    ] {
        if let Some(value) = params
            .get(format!("{key}{suffix}"))
            .filter(|v| !v.is_null())
        {
            source.insert(name.into(), value.clone());
        }
    }
    Value::Object(source)
}

fn check_source(engine: &Session, source: &Value) -> Result<(), String> {
    let current = engine.active().ok_or("No image document")?;
    let state = if let Some(index) = source.get("document").filter(|v| !v.is_null()) {
        index.as_u64().and_then(|i| engine.documents().get(i as usize)).ok_or("Invalid source image")?
    } else { current };
    if !source.is_object() {
        return Err("Channel source must be an object".into());
    }
    if state.doc.size != current.doc.size { return Err("Source images must match the target dimensions".into()); }
    let layer = match source.get("layer").filter(|v| !v.is_null()) {
        None => None,
        Some(v) if v.as_str() == Some("merged") => None,
        Some(v) => Some(LayerId(v.as_u64().ok_or("Invalid source layer")?)),
    };
    if layer.is_some_and(|id| state.doc.layer(id).is_none()) {
        return Err("The source layer no longer exists".into());
    }
    if source.get("invert").is_some_and(|v| !v.is_boolean()) {
        return Err("Source inversion must be true or false".into());
    }
    let channel = photocraft_engine::channel_cmds::parse_ref(
        source.get("channel").unwrap_or(&json!("composite")),
        &state.doc,
    )
    .ok_or("Unknown source channel")?;
    match channel {
        ChanRef::Alpha(i) if i >= state.doc.channels.len() => {
            Err("The source channel no longer exists".into())
        }
        ChanRef::Color(i) if i >= photocraft_engine::channel_cmds::color_count(&state.doc) => {
            Err("The source color channel no longer exists".into())
        }
        ChanRef::QuickMask if state.doc.quick_mask.is_none() => {
            Err("Not in Quick Mask mode".into())
        }
        ChanRef::LayerMask | ChanRef::VectorMask | ChanRef::Transparency => {
            let layer = layer
                .or(state.active_layer)
                .and_then(|id| state.doc.layer(id))
                .ok_or("Choose a source layer")?;
            if channel == ChanRef::LayerMask && layer.mask.is_none() {
                return Err("The source layer has no mask".into());
            }
            if channel == ChanRef::VectorMask && layer.vector_mask.is_none() {
                return Err("The source layer has no vector mask".into());
            }
            Ok(())
        }
        ChanRef::Composite | ChanRef::Color(_)
            if layer
                .is_some_and(|id| state.doc.layer(id).is_none_or(|l| l.surface().is_none())) =>
        {
            Err("Choose merged pixels or a pixel layer for this source channel".into())
        }
        _ => Ok(()),
    }
}

pub(super) fn target(state: &DocState, params: &Value) -> Result<Target, String> {
    let layer = || {
        state
            .active_layer
            .ok_or("Select a pixel layer or layer mask")
    };
    match params.get("target") {
        Some(v) if v.as_str() == Some("mask") => Ok(Target::Mask(layer()?)),
        Some(v) if v.as_str() == Some("quickMask") => Ok(Target::QuickMask),
        Some(v) if v.as_str() == Some("pixels") => Ok(Target::Pixels(layer()?)),
        Some(v) => v["channel"]
            .as_u64()
            .and_then(|i| usize::try_from(i).ok())
            .map(Target::Alpha)
            .ok_or_else(|| "Invalid Apply Image target".into()),
        None => match state.channel_view.target {
            ChannelTarget::Alpha(i) => Ok(Target::Alpha(i)),
            ChannelTarget::Composite if state.doc.quick_mask.is_some() => Ok(Target::QuickMask),
            ChannelTarget::Composite
                if photocraft_engine::mask_view_cmds::current(state).is_some() =>
            {
                Ok(Target::Mask(layer()?))
            }
            _ => Ok(Target::Pixels(layer()?)),
        },
    }
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    execute_checked(engine, command, params, false)
}

pub(super) fn execute_checked(engine: &mut Session, command: &str, params: &Value, workspace: bool) -> Option<Result<Value, String>> {
    if ![
        "image.applyImage",
        "image.calculations",
        "select.loadSelection",
    ]
    .contains(&command)
    {
        return None;
    }
    Some((|| {
        let state = engine.active().ok_or("No image document")?;
        if u64::from(state.doc.size.width) * u64::from(state.doc.size.height) > MAX_COMPOSITE_PIXELS
        {
            return Err("The image exceeds the 256 megapixel editing limit".into());
        }
        if !params.is_object() || params.to_string().len() > 1024 * 1024 {
            return Err("Invalid channel compositing parameters".into());
        }
        let mut checked = params.clone();
        if command == "select.loadSelection" {
            check_source(engine, params)?;
        } else {
            photocraft_engine::channel_cmds::Blending::parse(params)?;
            for key in if command == "image.applyImage" {
                vec!["source"]
            } else {
                vec!["source1", "source2"]
            } {
                let source = source_spec(params, key);
                check_source(engine, &source)?;
                checked[key] = source;
            }
            let mask = source_spec(params, "mask");
            if mask.get("channel").is_some_and(|v| v != "none") {
                check_source(engine, &mask)?;
                checked["mask"] = mask;
            } else {
                checked["mask"] = Value::Null;
            }
            for (key, min, max) in [
                ("opacity", 0.0, 100.0),
                ("scale", 1.0, 2.0),
                ("offset", -255.0, 255.0),
            ] {
                if checked.get(key).is_some_and(|v| {
                    v.as_f64()
                        .is_none_or(|n| !n.is_finite() || n < min || n > max)
                }) {
                    return Err(format!("{key} is outside its supported range"));
                }
            }
            if params
                .get("preserveTransparency")
                .is_some_and(|v| !v.is_boolean())
            {
                return Err("Preserve transparency must be true or false".into());
            }
        }
        if command == "image.calculations" {
            if params
                .get("result")
                .is_some_and(|v| !["newChannel", "selection"].contains(&v.as_str().unwrap_or("")) && !(workspace && v == "newDocument"))
            {
                return Err("New image output must be handled by the XDesign workspace".into());
            }
            if params
                .get("name")
                .is_some_and(|v| v.as_str().is_none_or(|n| n.len() > 512))
            {
                return Err("Channel name must contain at most 512 bytes".into());
            }
            let result = super::channel_bands::execute(engine, command, &checked, params)?;
            if let Some(channel) = result["channel"].as_u64() {
                // Present the new editable result, with no second history step.
                if let Some(state) = engine.active_mut() {
                    state.channel_view.layer_mask = None;
                    state.channel_view.quick_mask_hidden = true;
                }
                engine
                    .execute("channel.target", json!({"channel":channel}))
                    .map_err(|e| e.to_string())?;
            }
            return Ok(result);
        }
        if command == "select.loadSelection" {
            return super::channel_bands::execute(engine, command, &checked, params);
        }
        super::channel_bands::execute(engine, command, &checked, params)
    })())
}

pub(super) fn selection_preview(state: &DocState) -> Result<super::PhotoViewPreview, String> {
    let mut doc = (*state.doc).clone();
    let surface = doc
        .selection
        .clone()
        .unwrap_or_else(|| Surface::new(photocraft_engine::channel_cmds::channel_format(&doc)));
    let index = doc.channels.len();
    doc.channels
        .push(AlphaChannel::new("Selection preview", surface));
    let mut view = state.channel_view.clone();
    view.target = ChannelTarget::Alpha(index);
    view.color_hidden = vec![true; photocraft_engine::channel_cmds::color_count(&doc)];
    view.alpha_visible = (0..doc.channels.len()).map(|i| i == index).collect();
    view.layer_mask = None;
    view.quick_mask_hidden = true;
    super::render_view_preview(&doc, &view)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn banded_selection_load_supports_more_than_sixteen_megapixels() {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":4097,"height":4096,"background":"transparent"})).unwrap();
        engine.execute("channel.new",json!({"name":"Large alpha","fill":"white"})).unwrap();
        let before=engine.active().unwrap().doc.clone();
        execute(&mut engine,"select.loadSelection",&json!({"channel":0,"operation":"new"})).unwrap().unwrap();
        let doc=&engine.active().unwrap().doc;assert_eq!(doc.selection.as_ref().unwrap().read_region(Rect::from_xywh(4096,4095,1,1)),vec![1.0]);
        engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc.selection.is_some(),before.selection.is_some());
    }
    use photocraft_engine::doc::{ColorMode, PixelFormat, Rect, SampleType};

    fn fixture(mode: &str, depth: u32) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":20,"mode":mode,"depth":depth,"background":"#4080b0"}),
            )
            .unwrap();
        engine
            .execute("layer.layerMask.revealAll", json!({}))
            .unwrap();
        engine
            .execute("channel.new", json!({"name":"Source A","fill":"black"}))
            .unwrap();
        engine
            .execute("channel.new", json!({"name":"Source B","fill":"black"}))
            .unwrap();
        engine
            .edit("Sources", |doc, _| {
                let bounds = doc.bounds();
                doc.channels[0].surface.fill_rect(bounds, &[0.25]);
                doc.channels[1].surface.fill_rect(bounds, &[0.75]);
                doc.channels[1].surface.write_pixel(-4, 2, &[0.9]);
                Ok(())
            })
            .unwrap();
        engine
            .execute("channel.target", json!({"channel":"composite"}))
            .unwrap();
        engine
    }

    fn run(engine: &mut Session, command: &str, params: Value) -> Value {
        execute(engine, command, &params).unwrap().unwrap()
    }

    fn equal_surface(a: &Surface, b: &Surface, area: Rect) {
        assert_eq!(a.format(), b.format());
        assert_eq!(a.read_region(area), b.read_region(area));
    }

    #[test]
    fn all_channel_blends_match_native_pixels_in_every_editable_mode_and_depth() {
        for mode in ["rgb", "gray", "cmyk", "lab"] {
            for depth in [8, 16, 32] {
                for blend in [
                    "normal",
                    "darken",
                    "multiply",
                    "colorBurn",
                    "linearBurn",
                    "lighten",
                    "screen",
                    "colorDodge",
                    "linearDodge",
                    "overlay",
                    "softLight",
                    "hardLight",
                    "vividLight",
                    "linearLight",
                    "pinLight",
                    "hardMix",
                    "difference",
                    "exclusion",
                    "divide",
                    "add",
                    "subtract",
                ] {
                    let mut host = fixture(mode, depth);
                    let mut native = fixture(mode, depth);
                    let params = json!({"source":{"channel":0,"invert":true},"blending":blend,"opacity":60,"scale":1.5,"offset":10,"preserveTransparency":true,"mask":{"channel":1}});
                    run(&mut host, "image.applyImage", params.clone());
                    native.execute("image.applyImage", params).unwrap();
                    let a = host.active().unwrap();
                    let b = native.active().unwrap();
                    equal_surface(
                        a.doc
                            .layer(a.active_layer.unwrap())
                            .unwrap()
                            .surface()
                            .unwrap(),
                        b.doc
                            .layer(b.active_layer.unwrap())
                            .unwrap()
                            .surface()
                            .unwrap(),
                        a.doc.bounds(),
                    );
                }
            }
        }
    }

    #[test]
    fn apply_image_mask_keeps_pixels_metadata_off_canvas_coverage_and_one_undo() {
        for nonpixel in [false, true] {
            let mut engine = fixture("rgb", 16);
            if nonpixel {
                engine
                    .execute("layer.newAdjustmentLayer.levels", json!({}))
                    .unwrap();
                engine
                    .execute("layer.layerMask.revealAll", json!({}))
                    .unwrap();
            }
            let id = engine.active().unwrap().active_layer.unwrap();
            engine
                .edit("Mask metadata", |doc, _| {
                    let mask = doc.layer_mut(id).unwrap().mask.as_mut().unwrap();
                    mask.density = 0.6;
                    mask.feather = 2.0;
                    mask.enabled = false;
                    mask.surface.write_pixel(-4, 2, &[0.4]);
                    let mut selection = Surface::new(PixelFormat::GRAY8);
                    selection.fill_rect(Rect::from_xywh(2, 2, 8, 8), &[0.5]);
                    doc.selection = Some(selection);
                    Ok(())
                })
                .unwrap();
            let before = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.entries().len();
            run(
                &mut engine,
                "image.applyImage",
                json!({"source":{"channel":0},"target":"mask","blending":"normal","opacity":100}),
            );
            let after = engine.active().unwrap();
            let layer = after.doc.layer(id).unwrap();
            let mask = layer.mask.as_ref().unwrap();
            assert!((mask.surface.sample_channel(4, 4, 0) - 0.625).abs() < 2.0 / 255.0);
            assert_eq!(mask.surface.sample_channel(18, 18, 0), 1.0);
            assert_eq!(
                mask.surface.sample_channel(-4, 2, 0),
                before
                    .layer(id)
                    .unwrap()
                    .mask
                    .as_ref()
                    .unwrap()
                    .surface
                    .sample_channel(-4, 2, 0)
            );
            assert_eq!(
                (mask.density, mask.feather, mask.enabled),
                (0.6, 2.0, false)
            );
            if let (Some(a), Some(b)) = (layer.surface(), before.layer(id).unwrap().surface()) {
                equal_surface(a, b, before.bounds());
            }
            assert_eq!(after.doc.channels.len(), before.channels.len());
            assert_eq!(after.history.entries().len(), history + 1);
            let bytes = photocraft_format::save_to_bytes(&after.doc, &Default::default()).unwrap();
            let reopened = photocraft_format::load_from_bytes(&bytes).unwrap();
            equal_surface(
                &reopened.layer(id).unwrap().mask.as_ref().unwrap().surface,
                &mask.surface,
                before.bounds(),
            );
            engine.execute("edit.undo", json!({})).unwrap();
            equal_surface(
                &engine
                    .active()
                    .unwrap()
                    .doc
                    .layer(id)
                    .unwrap()
                    .mask
                    .as_ref()
                    .unwrap()
                    .surface,
                &before.layer(id).unwrap().mask.as_ref().unwrap().surface,
                before.bounds(),
            );
        }
    }

    #[test]
    fn self_sources_alpha_quick_mask_and_color_targets_use_original_pixels() {
        let mut engine = fixture("rgb", 32);
        engine
            .execute("channel.target", json!({"channel":1}))
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        run(
            &mut engine,
            "image.applyImage",
            json!({"source":{"channel":1,"invert":true},"blending":"normal"}),
        );
        let after = engine.active().unwrap();
        assert!((after.doc.channels[1].surface.sample_channel(4, 4, 0) - 0.25).abs() < 0.001);
        assert_eq!(
            after.doc.channels[1].surface.sample_channel(-4, 2, 0),
            before.channels[1].surface.sample_channel(-4, 2, 0)
        );
        engine
            .execute("select.editInQuickMaskMode", json!({"on":true}))
            .unwrap();
        run(
            &mut engine,
            "image.applyImage",
            json!({"source":{"channel":0},"blending":"normal"}),
        );
        assert!(
            (engine
                .active()
                .unwrap()
                .doc
                .quick_mask
                .as_ref()
                .unwrap()
                .surface
                .sample_channel(4, 4, 0)
                - 0.25)
                .abs()
                < 0.001
        );
        engine
            .execute("select.editInQuickMaskMode", json!({"on":false}))
            .unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        engine
            .execute("channel.target", json!({"channel":"red"}))
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        let id = engine.active().unwrap().active_layer.unwrap();
        run(
            &mut engine,
            "image.applyImage",
            json!({"source":{"channel":0},"blending":"normal"}),
        );
        let old = before
            .layer(id)
            .unwrap()
            .surface()
            .unwrap()
            .read_region(Rect::from_xywh(4, 4, 1, 1));
        let new = engine
            .active()
            .unwrap()
            .doc
            .layer(id)
            .unwrap()
            .surface()
            .unwrap()
            .read_region(Rect::from_xywh(4, 4, 1, 1));
        assert!((new[0] - 0.25).abs() < 0.001);
        assert_eq!(&new[1..], &old[1..]);
    }

    #[test]
    fn calculations_produce_named_channels_and_soft_selections_with_one_history_step() {
        for result in ["newChannel", "selection"] {
            let mut engine = fixture("rgb", 8);
            let before = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.entries().len();
            let reply = run(
                &mut engine,
                "image.calculations",
                json!({"source1":{"channel":0},"source2":{"channel":1},"blending":"multiply","opacity":50,"mask":{"channel":0},"result":result,"name":"Soft detail"}),
            );
            let state = engine.active().unwrap();
            let output = if result == "newChannel" {
                assert_eq!(reply["channel"], 2);
                assert_eq!(state.channel_view.target, ChannelTarget::Alpha(2));
                assert_eq!(state.doc.channels[2].name, "Soft detail");
                &state.doc.channels[2].surface
            } else {
                state.doc.selection.as_ref().unwrap()
            };
            assert!((output.sample_channel(4, 4, 0) - 0.6796875).abs() < 2.0 / 255.0);
            assert_eq!(state.history.entries().len(), history + 1);
            equal_surface(
                state
                    .doc
                    .layer(state.active_layer.unwrap())
                    .unwrap()
                    .surface()
                    .unwrap(),
                before
                    .layer(state.active_layer.unwrap())
                    .unwrap()
                    .surface()
                    .unwrap(),
                before.bounds(),
            );
            let bytes = photocraft_format::save_to_bytes(&state.doc, &Default::default()).unwrap();
            let reopened = photocraft_format::load_from_bytes(&bytes).unwrap();
            let restored = if result == "newChannel" {
                &reopened.channels[2].surface
            } else {
                reopened.selection.as_ref().unwrap()
            };
            equal_surface(restored, output, before.bounds());
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(
                engine.active().unwrap().doc.channels.len(),
                before.channels.len()
            );
            assert!(engine.active().unwrap().doc.selection.is_none());
        }
    }

    #[test]
    fn composite_previews_show_real_coverage_match_apply_and_leave_source_history_untouched() {
        use base64::Engine;
        for (command, params) in [
            (
                "image.applyImage",
                json!({"source":{"channel":0},"blending":"normal","target":"mask"}),
            ),
            (
                "image.calculations",
                json!({"source1":{"channel":0},"source2":{"channel":1},"blending":"screen","result":"newChannel"}),
            ),
            (
                "image.calculations",
                json!({"source1":{"channel":0},"source2":{"channel":1},"blending":"screen","result":"selection"}),
            ),
            (
                "select.loadSelection",
                json!({"channel":0,"operation":"new","invert":true}),
            ),
        ] {
            let mut engine = fixture("rgb", 8);
            if command == "image.applyImage" {
                engine
                    .execute("view.layerMask", json!({"mode":"gray"}))
                    .unwrap();
            }
            let before = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.entries().to_vec();
            let preview =
                super::super::preview::render(engine.active().unwrap(), command, params.clone())
                    .unwrap();
            assert!(std::sync::Arc::ptr_eq(
                &before,
                &engine.active().unwrap().doc
            ));
            assert_eq!(engine.active().unwrap().history.entries(), history);
            run(&mut engine, command, params.clone());
            let state = engine.active().unwrap();
            let applied = if command == "select.loadSelection" || params["result"] == "selection" {
                selection_preview(state).unwrap()
            } else {
                super::super::render_view_preview(&state.doc, &state.channel_view).unwrap()
            };
            assert_eq!(preview.png, applied.png);
            let decoded = photocraft_codecs::decode(
                &base64::engine::general_purpose::STANDARD
                    .decode(preview.png)
                    .unwrap(),
            )
            .unwrap();
            let pixel = &decoded.as_u8().unwrap()[..4];
            assert_eq!(pixel[0], pixel[1]);
            assert_eq!(pixel[1], pixel[2]);
            assert_eq!(pixel[3], 255);
            assert!(pixel[0] > 0 && pixel[0] < 255);
        }
    }

    #[test]
    fn failed_and_unhandled_document_outputs_leave_the_engine_unchanged() {
        let mut engine = fixture("rgb", 8);
        for (command, params) in [
            ("image.calculations", json!({"result":"newDocument"})),
            ("image.calculations", json!({"source1":{"document":1}})),
            (
                "image.calculations",
                json!({"source1":{"channel":{"color":99}}}),
            ),
            ("image.applyImage", json!({"source":{"layer":999}})),
            ("image.applyImage", json!({"source":{"channel":99}})),
            ("image.applyImage", json!({"opacity":-1})),
            ("image.applyImage", json!({"scale":3})),
            ("image.applyImage", json!({"offset":256})),
            ("image.applyImage", json!({"target":{"channel":99}})),
        ] {
            let before = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.entries().to_vec();
            assert!(execute(&mut engine, command, &params).unwrap().is_err());
            assert!(std::sync::Arc::ptr_eq(
                &before,
                &engine.active().unwrap().doc
            ));
            assert_eq!(engine.active().unwrap().history.entries(), history);
            assert_eq!(engine.documents().len(), 1);
        }
        engine
            .edit("Lock", |doc, active| {
                doc.layer_mut(active.unwrap()).unwrap().locks.all = true;
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        assert!(
            execute(&mut engine, "image.applyImage", &json!({"target":"mask"}))
                .unwrap()
                .is_err()
        );
        assert!(std::sync::Arc::ptr_eq(
            &before,
            &engine.active().unwrap().doc
        ));
        let mut huge = Session::new();
        huge.execute("file.new", json!({"width":17000,"height":17000}))
            .unwrap();
        assert!(execute(&mut huge, "image.calculations", &json!({}))
            .unwrap()
            .unwrap_err()
            .contains("256 megapixel"));
        // The adapter also honors locked transparency on a fully empty layer.
        let mut empty = Session::new();
        empty
            .execute(
                "file.new",
                json!({"width":20,"height":20,"background":"transparent"}),
            )
            .unwrap();
        empty
            .execute("channel.new", json!({"fill":"white"}))
            .unwrap();
        empty
            .execute("channel.target", json!({"channel":"composite"}))
            .unwrap();
        empty
            .edit("Lock transparency", |doc, active| {
                doc.layer_mut(active.unwrap()).unwrap().locks.transparency = true;
                Ok(())
            })
            .unwrap();
        run(
            &mut empty,
            "image.applyImage",
            json!({"source":{"channel":0},"blending":"normal"}),
        );
        let state = empty.active().unwrap();
        let pixels = state
            .doc
            .layer(state.active_layer.unwrap())
            .unwrap()
            .surface()
            .unwrap();
        assert_eq!(
            pixels.format(),
            PixelFormat::new(ColorMode::Rgb, SampleType::U8, true)
        );
        assert_eq!(pixels.sample_channel(3, 3, 3), 0.0);
    }

    #[test]
    fn new_calculation_channels_clear_previous_mask_overlays_without_changing_masks() {
        for quick in [true, false] {
            let mut engine = fixture("rgb", 8);
            if quick {
                engine
                    .execute("select.editInQuickMaskMode", json!({"on":true}))
                    .unwrap();
            } else {
                engine
                    .execute("view.layerMask", json!({"mode":"overlay"}))
                    .unwrap();
            }
            let before = engine.active().unwrap().doc.clone();
            let preview = super::super::preview::render(
                engine.active().unwrap(),
                "image.calculations",
                json!({"source1":{"channel":0},"source2":{"channel":1}}),
            )
            .unwrap();
            run(
                &mut engine,
                "image.calculations",
                json!({"source1":{"channel":0},"source2":{"channel":1}}),
            );
            let state = engine.active().unwrap();
            assert!(state.channel_view.layer_mask.is_none());
            assert!(state.channel_view.quick_mask_hidden);
            assert_eq!(
                preview.png,
                super::super::render_view_preview(&state.doc, &state.channel_view)
                    .unwrap()
                    .png
            );
            if quick {
                equal_surface(
                    &state.doc.quick_mask.as_ref().unwrap().surface,
                    &before.quick_mask.as_ref().unwrap().surface,
                    before.bounds(),
                );
            }
        }
    }

    #[test]
    fn load_selection_combines_soft_coverage_without_touching_pixels_or_channels() {
        for (operation, expected) in [
            ("new", 0.25),
            ("add", 0.5),
            ("subtract", 0.25),
            ("intersect", 0.25),
        ] {
            let mut engine = fixture("rgb", 16);
            engine
                .edit("Soft selection", |doc, _| {
                    let mut selection = Surface::new(PixelFormat::GRAY8);
                    selection.fill_rect(doc.bounds(), &[0.5]);
                    doc.selection = Some(selection);
                    Ok(())
                })
                .unwrap();
            let before = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.entries().len();
            run(
                &mut engine,
                "select.loadSelection",
                json!({"channel":0,"operation":operation}),
            );
            let state = engine.active().unwrap();
            assert!(
                (state
                    .doc
                    .selection
                    .as_ref()
                    .unwrap()
                    .sample_channel(4, 4, 0)
                    - expected)
                    .abs()
                    < 2.0 / 255.0
            );
            assert_eq!(state.history.entries().len(), history + 1);
            for (a, b) in state.doc.channels.iter().zip(&before.channels) {
                equal_surface(&a.surface, &b.surface, before.bounds());
            }
            equal_surface(
                state
                    .doc
                    .layer(state.active_layer.unwrap())
                    .unwrap()
                    .surface()
                    .unwrap(),
                before
                    .layer(state.active_layer.unwrap())
                    .unwrap()
                    .surface()
                    .unwrap(),
                before.bounds(),
            );
            engine.execute("edit.undo", json!({})).unwrap();
            equal_surface(
                engine.active().unwrap().doc.selection.as_ref().unwrap(),
                before.selection.as_ref().unwrap(),
                before.bounds(),
            );
        }
    }
}
