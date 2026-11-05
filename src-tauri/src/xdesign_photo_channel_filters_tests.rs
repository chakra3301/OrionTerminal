use photocraft_engine::{doc::{ColorMode, LayerContent, LayerId, PixelFormat, Rect}, DocState, Session};
use serde_json::{json, Value};

fn commands() -> Vec<(&'static str, Value)> {
    vec![
        ("filter.cameraRaw", json!({"exposure":-2.0,"contrast":18.0,"temperature":7.0})),
        ("filter.lensCorrection", json!({"profile":"generic","distortion":-42,"vertical":14,"horizontal":-9,"vignetteAmount":-35,"edge":"color","edgeColor":"#c44870"})),
        ("filter.adaptiveWideAngle", json!({"model":"fisheye","focalLength":12,"cropFactor":1.5,"scale":92,"interpolation":"bicubic","constraints":[{"a":[2,4],"b":[29,7],"orientation":"horizontal"},{"a":[8,3],"b":[11,21],"orientation":"vertical"}]})),
        ("filter.liquify", json!({"strokes":[{"tool":"forwardWarp","size":14,"points":[[7,8],[14,12],[23,16]]}]})),
        ("edit.puppetWarp", json!({"pins":[{"src":[6,6],"dst":[6,6]},{"src":[25,6],"dst":[25,6]},{"src":[7,19],"dst":[13,21]},{"src":[25,19],"dst":[25,19]}]})),
        ("edit.perspectiveWarp", json!({"planes":[{"src":[[0,0],[32,0],[32,24],[0,24]],"dst":[[2,1],[30,0],[32,23],[0,22]]}]})),
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChannelRoute { AlphaImplicit, AlphaExplicit, QuickMaskImplicit, QuickMaskExplicit }

impl ChannelRoute {
    fn is_alpha(self) -> bool { matches!(self, Self::AlphaImplicit | Self::AlphaExplicit) }
    fn is_explicit(self) -> bool { matches!(self, Self::AlphaExplicit | Self::QuickMaskExplicit) }
}

fn fixture(depth: u32, route: ChannelRoute) -> (Session, LayerId) {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":32,"height":24,"depth":depth,"background":"#203040"})).unwrap();
    let layer = engine.active().unwrap().active_layer.unwrap();
    engine.edit("Nonuniform channel source", |doc, _| {
        let bounds = doc.bounds();
        let surface = doc.layer_mut(layer).unwrap().surface_mut().unwrap();
        let channels = surface.channels();
        let mut data = Vec::with_capacity((bounds.width() * bounds.height()) as usize * channels);
        for y in 0..bounds.height() {
            for x in 0..bounds.width() {
                let n = ((x * 7 + y * 11) % 19) as f32 / 19.0;
                data.extend_from_slice(&[0.12 + n * 0.6, 0.18 + y as f32 * 0.017, 0.72 - x as f32 * 0.013][..channels.min(3)]);
                if channels == 4 { data.push(0.35 + (x % 7) as f32 * 0.08); }
            }
        }
        surface.write_region(bounds, &data);
        let mut soft = photocraft_raster::Surface::new(PixelFormat::GRAY8);
        let inner = Rect::from_xywh(4, 3, 24, 18);
        let mut coverage = Vec::new();
        for y in inner.y0..inner.y1 {
            for x in inner.x0..inner.x1 {
                coverage.push(match (x * 5 + y * 3) % 7 { 0 => 0.0, 1 => 0.2, 2 => 0.45, 3 => 0.7, 4 => 0.9, _ => 1.0 });
            }
        }
        soft.write_region(inner, &coverage);
        doc.selection = Some(soft);
        Ok(())
    }).unwrap();
    engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
    engine.edit("Independent layer mask", |doc, _| {
        let bounds = doc.bounds();
        let mask = &mut doc.layer_mut(layer).unwrap().mask.as_mut().unwrap().surface;
        let mut values = Vec::new();
        for y in bounds.y0..bounds.y1 { for x in bounds.x0..bounds.x1 { values.push(((x * 7 + y * 3) % 11) as f32 / 10.0); }}
        mask.write_region(bounds, &values);
        Ok(())
    }).unwrap();

    if route.is_alpha() {
        engine.execute("channel.new", json!({"name":"Nonuniform source","fill":"black"})).unwrap();
        engine.edit("Nonuniform alpha plane", |doc, _| {
            let bounds = doc.bounds();
            let plane = &mut doc.channels[0].surface;
            let mut coverage = Vec::with_capacity((bounds.width() * bounds.height()) as usize);
            for y in bounds.y0..bounds.y1 { for x in bounds.x0..bounds.x1 {
                coverage.push(match (x * 3 + y * 5) % 9 { 0 => 0.0, 1 => 0.12, 2 => 0.28, 3 => 0.43, 4 => 0.58, 5 => 0.72, 6 => 0.86, _ => 1.0 });
            }}
            plane.write_region(bounds, &coverage);
            Ok(())
        }).unwrap();
        engine.execute("channel.target", json!({"channel":0})).unwrap();
    } else {
        engine.execute("select.editInQuickMaskMode", json!({})).unwrap();
    }
    assert_eq!(target_surface(engine.active().unwrap(), route).format().sample, engine.active().unwrap().doc.depth, "Alpha and Quick Mask planes retain document sample depth");
    (engine, layer)
}

fn target_params(route: ChannelRoute, mut params: Value) -> Value {
    if route.is_explicit() {
        params["target"] = if route.is_alpha() { json!({"channel":0}) } else { json!("quickMask") };
    }
    params
}

fn target_surface(state: &DocState, route: ChannelRoute) -> photocraft_raster::Surface {
    if route.is_alpha() { state.doc.channels[0].surface.clone() }
    else { state.doc.quick_mask.as_ref().unwrap().surface.clone() }
}

fn grayscale_raster_reference(source: &DocState, layer: LayerId, route: ChannelRoute, command: &str, params: &Value) -> photocraft_raster::Surface {
    let mut expected = Session::new();
    expected.add_document((*source.doc).clone(), None);
    *expected.active_mut().unwrap() = source.clone();
    let mut plane = target_surface(source, route);
    let bounds = source.doc.bounds();
    let raw = plane.read_region(bounds);
    plane.write_region(bounds, &raw);
    let source_format = plane.format();
    let source_default = plane.default_pixel();
    let depth = plane.format().sample;
    let state = expected.active_mut().unwrap();
    state.channel_view = Default::default();
    let doc = std::sync::Arc::make_mut(&mut state.doc);
    let target = doc.layer_mut(layer).unwrap();
    target.content = LayerContent::Raster(plane);
    target.mask = None;
    doc.mode = ColorMode::Grayscale;
    doc.depth = depth;
    doc.icc_profile = None;
    doc.channels.clear();
    doc.quick_mask = None;
    let mut native_params = params.clone();
    if let Some(object) = native_params.as_object_mut() { object.remove("target"); object.remove("layer"); }
    expected.execute(command, native_params).unwrap_or_else(|error| panic!("pinned grayscale Raster oracle for {command}: {error}"));
    let filtered = expected.active().unwrap().doc.layer(layer).unwrap().surface().unwrap();
    if filtered.format() == source_format && filtered.default_pixel() == source_default { return filtered.clone(); }
    let base = photocraft_raster::to_rgba(&source_format, &source_default);
    let mut normalized = photocraft_raster::Surface::new(source_format);
    normalized.fill_rect(bounds, &source_default);
    for y in (bounds.y0..bounds.y1).step_by(256) {
        for x in (bounds.x0..bounds.x1).step_by(4096) {
            let rect = Rect::new(x, y, x.saturating_add(4096).min(bounds.x1), y.saturating_add(256).min(bounds.y1));
            let raw = filtered.read_region(rect);
            let mut values = Vec::with_capacity((rect.width() * rect.height()) as usize * source_format.channels());
            for pixel in raw.chunks_exact(filtered.channels()) {
                let rgba = photocraft_raster::to_rgba(&filtered.format(), pixel);
                let alpha = rgba[3].clamp(0.0, 1.0);
                let flat = [rgba[0] * alpha + base[0] * (1.0-alpha), rgba[1] * alpha + base[1] * (1.0-alpha), rgba[2] * alpha + base[2] * (1.0-alpha), 1.0];
                let offset = values.len(); values.resize(offset + source_format.channels(), 0.0);
                photocraft_raster::from_rgba_into(&source_format, flat, &mut values[offset..]);
            }
            normalized.write_region(rect, &values);
        }
    }
    normalized
}

fn independent_expected_doc(source: &DocState, route: ChannelRoute, plane: photocraft_raster::Surface) -> DocState {
    let mut expected = source.clone();
    let doc = std::sync::Arc::make_mut(&mut expected.doc);
    if route.is_alpha() { doc.channels[0].surface = plane; }
    else { doc.quick_mask.as_mut().unwrap().surface = plane; }
    expected
}

fn assert_untouched_sources(before: &DocState, after: &DocState, layer: LayerId, route: ChannelRoute) {
    assert_eq!(after.doc.layers, before.doc.layers, "all layer content and metadata stay untouched");
    assert_eq!(after.doc.layer(layer).unwrap().content, before.doc.layer(layer).unwrap().content, "source layer content is unchanged");
    assert_eq!(after.doc.layer(layer).unwrap().mask, before.doc.layer(layer).unwrap().mask, "unrelated layer mask is unchanged");
    assert_eq!(after.doc.selection, before.doc.selection, "soft selection is retained");
    assert_eq!(after.channel_view, before.channel_view, "active channel view is retained");
    if route.is_alpha() {
        let mut expected = before.doc.channels.clone();
        expected[0].surface = after.doc.channels[0].surface.clone();
        assert_eq!(after.doc.channels, expected, "only the targeted alpha sample plane changes; channel metadata is retained");
        assert_eq!(after.doc.quick_mask, before.doc.quick_mask);
    } else {
        assert_eq!(after.doc.channels, before.doc.channels, "alpha channels and metadata stay untouched");
        let old = before.doc.quick_mask.as_ref().unwrap();
        let new = after.doc.quick_mask.as_ref().unwrap();
        assert_eq!((&new.name, new.spot, new.color, new.opacity, new.indicates), (&old.name, old.spot, old.color, old.opacity, old.indicates));
        assert_eq!(new.surface.format(), old.surface.format());
    }
}

#[test]
fn six_native_handlers_target_soft_alpha_and_quick_mask_with_preview_apply_history() {
    for depth in [8, 16, 32] {
        for route in [ChannelRoute::AlphaImplicit, ChannelRoute::AlphaExplicit, ChannelRoute::QuickMaskImplicit, ChannelRoute::QuickMaskExplicit] {
            for (command, base_params) in commands() {
                let (mut engine, layer) = fixture(depth, route);
                let params = target_params(route, base_params);
                let source = engine.active().unwrap().clone();
                let source_doc = source.doc.clone();
                let source_history = source.history.entries().to_vec();
                let original_surface = target_surface(&source, route);
                let expected_surface = grayscale_raster_reference(&source, layer, route, command, &params);
                assert_ne!(original_surface.read_region(source.doc.bounds()), expected_surface.read_region(source.doc.bounds()), "non-vacuous channel oracle: {depth}/{route:?}/{command}");
                let expected_doc = independent_expected_doc(&source, route, expected_surface.clone());

                let color = super::super::color_views::Snapshot::capture(&engine).unwrap();
                let preview = super::super::preview::render_with_color(&source, &color, command, params.clone(), None)
                    .unwrap_or_else(|error| panic!("Preview {command}/{route:?}/{depth}: {error}"));
                let expected_png = super::super::render_view_preview(&expected_doc.doc, &expected_doc.channel_view).unwrap().png;
                assert_eq!(preview.png, expected_png, "preview matches independent grayscale-raster output: {depth}/{route:?}/{command}");
                assert!(std::sync::Arc::ptr_eq(&source_doc, &engine.active().unwrap().doc), "preview does not mutate source document");
                assert_eq!(source.history.entries(), source_history);

                super::super::execute_view_command(&mut engine, command, params.clone())
                    .unwrap_or_else(|error| panic!("Apply {command}/{route:?}/{depth}: {error}"));
                let applied = engine.active().unwrap().clone();
                assert_eq!(target_surface(&applied, route).read_region(applied.doc.bounds()), expected_surface.read_region(applied.doc.bounds()), "applied plane equals independent pinned Raster output");
                assert_ne!(original_surface.read_region(applied.doc.bounds()), target_surface(&applied, route).read_region(applied.doc.bounds()));
                assert_untouched_sources(&source, &applied, layer, route);
                assert_eq!(applied.history.entries().len(), source_history.len() + 1, "one undo step");
                assert_eq!(engine.journal.last().unwrap().0, command);
                if route.is_explicit() {
                    assert_eq!(engine.journal.last().unwrap().1["target"], if route.is_alpha() { json!({"channel":0}) } else { json!("quickMask") });
                }

                engine.execute("edit.undo", json!({})).unwrap();
                assert_eq!(engine.active().unwrap().doc, source.doc);
                engine.execute("edit.redo", json!({})).unwrap();
                assert_eq!(engine.active().unwrap().doc, applied.doc, "redo restores targeted plane exactly");
            }
        }
    }
}

#[test]
fn channel_handlers_refuse_missing_or_invalid_targets_atomically() {
    for (command, params) in [
        ("filter.cameraRaw", json!({"target":{"channel":99},"exposure":-2})),
        ("filter.lensCorrection", json!({"target":"quickMask","distortion":-35})),
        ("edit.perspectiveWarp", json!({"target":{"channel":99},"planes":[{"src":[[0,0],[32,0],[32,24],[0,24]],"dst":[[2,1],[30,0],[32,23],[0,22]]}]})),
    ] {
        let (mut engine, _) = fixture(16, ChannelRoute::AlphaImplicit);
        if params["target"] == json!("quickMask") {
            engine.active_mut().unwrap().doc = std::sync::Arc::new({ let mut doc = (*engine.active().unwrap().doc).clone(); doc.quick_mask = None; doc });
        }
        let state = engine.active().unwrap().doc.clone();
        let history = engine.active().unwrap().history.entries().to_vec();
        let journal = engine.journal.clone();
        assert!(super::super::execute_view_command(&mut engine, command, params).is_err(), "missing or invalid target must be rejected: {command}");
        assert!(std::sync::Arc::ptr_eq(&state, &engine.active().unwrap().doc));
        assert_eq!(engine.active().unwrap().history.entries(), history);
        assert_eq!(engine.journal, journal);
    }
}

#[test]
fn channel_targets_do_not_require_an_active_pixel_layer_and_preserve_group_or_smart_masks() {
    let (mut engine, layer) = fixture(16, ChannelRoute::AlphaExplicit);
    engine.execute("channel.new", json!({"name":"No active layer target","fill":"white"})).unwrap();
    engine.active_mut().unwrap().active_layer = None;
    let original_layer = engine.active().unwrap().doc.layer(layer).unwrap().clone();
    let old = engine.active().unwrap().doc.channels[0].surface.read_region(engine.active().unwrap().doc.bounds());
    super::super::execute_view_command(&mut engine, "filter.cameraRaw", json!({"target":{"channel":0},"exposure":-2})).unwrap();
    assert_ne!(engine.active().unwrap().doc.channels[0].surface.read_region(engine.active().unwrap().doc.bounds()), old);
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap(), &original_layer);

    for make_smart in [false, true] {
        let (mut source, _child) = fixture(16, ChannelRoute::QuickMaskExplicit);
        source.execute("channel.target", json!({"channel":"composite"})).unwrap();
        let parent = if make_smart {
            source.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
            source.active().unwrap().active_layer.unwrap()
        } else {
            let id = LayerId(source.execute("layer.groupLayers", json!({})).unwrap()["layer"].as_u64().unwrap());
            id
        };
        source.execute("layer.layerMask.revealAll", json!({})).unwrap();
        let before_content = source.active().unwrap().doc.layer(parent).unwrap().content.clone();
        let before_mask = source.active().unwrap().doc.layer(parent).unwrap().mask.clone();
        let before_quick_mask = source.active().unwrap().doc.quick_mask.as_ref().unwrap().surface.read_region(source.active().unwrap().doc.bounds());
        super::super::execute_view_command(&mut source, "filter.lensCorrection", json!({"target":"quickMask","profile":"generic","distortion":-30,"edge":"black"})).unwrap();
        let after = source.active().unwrap();
        assert_ne!(after.doc.quick_mask.as_ref().unwrap().surface.read_region(after.doc.bounds()), before_quick_mask);
        assert_eq!(after.doc.layer(parent).unwrap().content, before_content);
        assert_eq!(after.doc.layer(parent).unwrap().mask, before_mask, "channel edit cannot route into group or Smart Object masks");
    }
}

#[test]
fn repeat_last_replays_raw_and_lens_settings_on_alpha_and_quick_mask_targets() {
    for (command, params) in [
        ("filter.cameraRaw", json!({"exposure":-2.0,"contrast":12.0})),
        ("filter.lensCorrection", json!({"profile":"generic","distortion":-38,"edge":"white"})),
    ] {
        for route in [ChannelRoute::AlphaExplicit, ChannelRoute::QuickMaskExplicit] {
            let (mut engine, _) = fixture(16, route);
            let params = target_params(route, params.clone());
            let history = engine.active().unwrap().history.entries().len();
            let original = target_surface(engine.active().unwrap(), route).read_region(engine.active().unwrap().doc.bounds());
            super::super::execute_view_command(&mut engine, command, params.clone()).unwrap_or_else(|error| panic!("{command}/{route:?}: {error}"));
            let once = target_surface(engine.active().unwrap(), route).read_region(engine.active().unwrap().doc.bounds());
            assert_ne!(original, once);
            super::super::execute_view_command(&mut engine, "filter.lastFilter", json!({})).unwrap_or_else(|error| panic!("Repeat Last {command}/{route:?}: {error}"));
            let twice = target_surface(engine.active().unwrap(), route).read_region(engine.active().unwrap().doc.bounds());
            assert_ne!(once, twice);
            assert_eq!(engine.active().unwrap().history.entries().len(), history + 2);
            assert_eq!(engine.journal[engine.journal.len()-2].0, command);
            assert_eq!(engine.journal[engine.journal.len()-2].1["target"], params["target"]);
            assert_eq!(engine.journal.last().unwrap().0, "filter.lastFilter");
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(target_surface(engine.active().unwrap(), route).read_region(engine.active().unwrap().doc.bounds()), once);
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(target_surface(engine.active().unwrap(), route).read_region(engine.active().unwrap().doc.bounds()), original);
            engine.execute("edit.redo", json!({})).unwrap();
            engine.execute("edit.redo", json!({})).unwrap();
            assert_eq!(target_surface(engine.active().unwrap(), route).read_region(engine.active().unwrap().doc.bounds()), twice);
        }
    }
}

#[test]
fn channel_filter_fade_blends_only_the_raw_coverage_plane_and_refuses_stale_state() {
    let (mut engine, layer) = fixture(16, ChannelRoute::AlphaExplicit);
    let source = engine.active().unwrap().doc.clone();
    let bounds = engine.active().unwrap().doc.bounds();
    let original = engine.active().unwrap().doc.channels[0].surface.read_region(bounds);
    let pixels = engine.active().unwrap().doc.layer(layer).unwrap().content.clone();
    super::super::execute_view_command(&mut engine, "filter.cameraRaw", json!({"target":{"channel":0},"exposure":-2.0})).unwrap();
    let filtered = engine.active().unwrap().doc.channels[0].surface.read_region(bounds);
    assert_ne!(original, filtered);
    super::super::execute_view_command(&mut engine, "edit.fade", json!({"opacity":50,"mode":"normal"})).unwrap();
    let faded = engine.active().unwrap().doc.channels[0].surface.read_region(bounds);
    for ((before, after), blended) in original.iter().zip(&filtered).zip(&faded) {
        assert!((blended - (before + (after - before) * 0.5)).abs() <= 1.0 / 255.0, "channel Fade blends raw alpha coverage with native quantization");
    }
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().content, pixels, "channel Fade does not touch image pixels");
    assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc) == false);

    let (mut stale, _) = fixture(16, ChannelRoute::QuickMaskExplicit);
    super::super::execute_view_command(&mut stale, "filter.lensCorrection", json!({"target":"quickMask","profile":"generic","distortion":-25})).unwrap();
    stale.execute("edit.undo", json!({})).unwrap();
    let doc = stale.active().unwrap().doc.clone();
    let history = stale.active().unwrap().history.entries().to_vec();
    assert!(super::super::execute_view_command(&mut stale, "edit.fade", json!({"opacity":50,"mode":"normal"})).is_err(), "Fade cannot apply after Undo invalidates its source revision");
    assert!(std::sync::Arc::ptr_eq(&doc, &stale.active().unwrap().doc));
    assert_eq!(stale.active().unwrap().history.entries(), history);
}

#[test]
fn ordinary_channel_filters_match_the_pinned_channel_route_at_each_depth() {
    for depth in [8, 16, 32] { for route in [ChannelRoute::AlphaExplicit, ChannelRoute::QuickMaskExplicit] {
        for (command, params) in [("filter.blur.gaussianBlur", json!({"radius":3})), ("filter.noise.addNoise", json!({"amount":17,"seed":882,"monochromatic":true,"distribution":"gaussian"})), ("filter.other.custom", json!({"kernel":[0,-1,0,-1,5,-1,0,-1,0],"size":3,"scale":1,"offset":0})), ("filter.render.fibers", json!({"variance":9,"strength":17,"seed":885}))] {
            let (mut actual, layer) = fixture(depth, route); let source = actual.active().unwrap().clone(); let params = target_params(route, params);
            let mut reference = Session::new(); reference.add_document((*source.doc).clone(), None); *reference.active_mut().unwrap() = source.clone(); reference.tools = actual.tools.clone();
            reference.execute(command, params.clone()).unwrap();
            super::super::execute_view_command(&mut actual, command, params).unwrap();
            assert_eq!(target_surface(actual.active().unwrap(), route).read_region(source.doc.bounds()), target_surface(reference.active().unwrap(), route).read_region(source.doc.bounds()), "native ordinary route {depth}/{route:?}/{command}");
            assert_untouched_sources(&source, actual.active().unwrap(), layer, route);
            assert!(super::can_fade(&actual)); assert!(actual.edit_state.fade.is_none(), "native layer Fade cannot represent a channel");
        }
    }}
}

#[test]
fn smart_object_channels_use_all_wide_interpolations_without_changing_smart_content() {
    for route in [ChannelRoute::AlphaExplicit, ChannelRoute::QuickMaskExplicit] { for interpolation in ["nearest", "bilinear", "bicubic"] {
        let (mut engine, _) = fixture(16, route); engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        let source = engine.active().unwrap().clone(); let layer = source.active_layer.unwrap();
        let params = target_params(route, json!({"model":"fisheye","focalLength":12,"scale":92,"interpolation":interpolation,"constraints":[{"a":[2,4],"b":[29,7],"orientation":"horizontal"}]}));
        let expected = grayscale_raster_reference(&source, layer, route, "filter.adaptiveWideAngle", &params);
        super::super::execute_view_command(&mut engine, "filter.adaptiveWideAngle", params).unwrap();
        assert_eq!(target_surface(engine.active().unwrap(), route).read_region(source.doc.bounds()), expected.read_region(source.doc.bounds()));
        assert_untouched_sources(&source, engine.active().unwrap(), layer, route);
    }}
}

#[test]
fn channel_fade_availability_and_invalid_repeat_are_guarded_by_the_current_history() {
    let (mut engine, _) = fixture(16, ChannelRoute::AlphaExplicit);
    assert!(!super::can_fade(&engine));
    super::super::execute_view_command(&mut engine, "filter.cameraRaw", json!({"target":{"channel":0},"exposure":-2})).unwrap();
    assert!(super::can_fade(&engine)); engine.journal.push(("view.zoom".into(), json!({}))); assert!(super::can_fade(&engine));
    let source = engine.active().unwrap().doc.clone(); let history = engine.active().unwrap().history.entries().to_vec(); let journal = engine.journal.clone();
    assert!(super::super::execute_view_command(&mut engine, "filter.lastFilter", Value::Null).is_err());
    assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc)); assert_eq!(engine.active().unwrap().history.entries(), history); assert_eq!(engine.journal, journal);
    assert!(super::super::execute_view_command(&mut engine, "edit.fade", json!({"opacity":"bad"})).is_err()); assert!(super::can_fade(&engine));
    super::super::execute_view_command(&mut engine, "edit.fade", json!({"opacity":50})).unwrap(); assert!(!super::can_fade(&engine));
    engine.execute("edit.undo", json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc, source); assert!(!super::can_fade(&engine));
}

#[test]
fn explicit_pixel_and_alpha_targets_override_a_live_quick_mask() {
    for (command, base_params) in [("filter.cameraRaw", json!({"exposure":-2})), ("filter.lensCorrection", json!({"distortion":-30,"edge":"white"}))] {
        let (mut engine, layer) = fixture(16, ChannelRoute::QuickMaskImplicit); let source = engine.active().unwrap().clone(); let mut params = base_params; params["target"] = json!("pixels");
        let mut reference = Session::new(); reference.add_document((*source.doc).clone(), None); *reference.active_mut().unwrap() = source.clone(); reference.execute(command, params.clone()).unwrap();
        super::super::execute_view_command(&mut engine, command, params).unwrap();
        assert_eq!(engine.active().unwrap().doc, reference.active().unwrap().doc); assert_eq!(engine.active().unwrap().doc.quick_mask, source.doc.quick_mask);
        assert_ne!(engine.active().unwrap().doc.layer(layer).unwrap().content, source.doc.layer(layer).unwrap().content);
    }
    let (mut engine, layer) = fixture(16, ChannelRoute::AlphaExplicit); engine.execute("select.editInQuickMaskMode", json!({})).unwrap();
    let source = engine.active().unwrap().clone(); let params = json!({"target":{"channel":0},"exposure":-2}); let expected = grayscale_raster_reference(&source, layer, ChannelRoute::AlphaExplicit, "filter.cameraRaw", &params);
    super::super::execute_view_command(&mut engine, "filter.cameraRaw", params).unwrap();
    assert_eq!(engine.active().unwrap().doc.channels[0].surface.read_region(source.doc.bounds()), expected.read_region(source.doc.bounds()));
    assert_eq!(engine.active().unwrap().doc.quick_mask, source.doc.quick_mask); assert_eq!(engine.active().unwrap().doc.layer(layer), source.doc.layer(layer));
}

#[test]
fn photo_reply_exposes_channel_fade_and_retains_native_pixel_fade_availability() {
    let (engine, _) = fixture(16, ChannelRoute::AlphaExplicit);
    let mut session = super::super::PhotoSession { engine, color_settings: None, version: "channel-fade-test".into(), original_path: None, writer: Default::default() };
    let metadata = |session: &super::super::PhotoSession| super::super::reply(std::path::Path::new("/tmp"), "channel-fade-test", session, Vec::new()).unwrap().state["canFade"].clone();
    assert_eq!(metadata(&session), false);
    super::super::execute_view_command(&mut session.engine, "filter.cameraRaw", json!({"target":{"channel":0},"exposure":-2})).unwrap(); assert_eq!(metadata(&session), true);
    session.engine.execute("edit.undo", json!({})).unwrap(); assert_eq!(metadata(&session), false);
    super::super::execute_view_command(&mut session.engine, "filter.cameraRaw", json!({"target":"pixels","exposure":-2})).unwrap(); assert!(session.engine.is_enabled("edit.fade")); assert_eq!(metadata(&session), true);
}

#[test]
fn empty_or_identity_native_warps_keep_mask_and_channel_history_unchanged() {
    for target in [json!("mask"), json!({"channel":0}), json!("quickMask")] {
        for (command, mut params) in [("filter.liquify", json!({"strokes":[]})), ("edit.puppetWarp", json!({"pins":[]})), ("edit.perspectiveWarp", json!({"planes":[{"src":[[0,0],[32,0],[32,24],[0,24]],"dst":[[0,0],[32,0],[32,24],[0,24]]}]}))] {
            let route = if target == "quickMask" { ChannelRoute::QuickMaskExplicit } else { ChannelRoute::AlphaExplicit };
            let (mut engine, _) = fixture(16, route); params["target"] = target.clone();
            let source = engine.active().unwrap().doc.clone(); let history = engine.active().unwrap().history.entries().to_vec(); let entries = engine.journal.len();
            let result = super::super::execute_view_command(&mut engine, command, params).unwrap();
            assert_eq!(result["changed"], false); assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.entries(), history); assert_eq!(engine.journal.len(), entries + 1);
            assert!(!super::can_fade(&engine));
        }
        let route = if target == "quickMask" { ChannelRoute::QuickMaskExplicit } else { ChannelRoute::AlphaExplicit };
        let (mut engine, _) = fixture(16, route); let source = engine.active().unwrap().doc.clone(); let history = engine.active().unwrap().history.entries().to_vec(); let journal = engine.journal.clone();
        assert!(super::super::execute_view_command(&mut engine, "edit.perspectiveWarp", json!({"target":target,"planes":[]})).is_err());
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc)); assert_eq!(engine.active().unwrap().history.entries(), history); assert_eq!(engine.journal, journal);
    }
}

#[test]
fn ordinary_channel_filters_preserve_native_coalescing_and_history_fade_source() {
    for route in [ChannelRoute::AlphaExplicit, ChannelRoute::QuickMaskExplicit] {
        let (mut engine, layer) = fixture(16, route); let source = engine.active().unwrap().clone(); let past = source.history.past_len();
        let mut reference = Session::new(); reference.add_document((*source.doc).clone(), None); *reference.active_mut().unwrap() = source.clone();
        for radius in [2, 4] {
            let params = target_params(route, json!({"radius":radius,"coalesce":"channel-blur-slider"}));
            reference.execute("filter.blur.gaussianBlur", params.clone()).unwrap();
            super::super::execute_view_command(&mut engine, "filter.blur.gaussianBlur", params).unwrap();
            assert_eq!(engine.active().unwrap().doc, reference.active().unwrap().doc);
            assert_eq!(engine.active().unwrap().history.entries(), reference.active().unwrap().history.entries());
            assert_eq!(engine.active().unwrap().coalesce, reference.active().unwrap().coalesce);
        }
        assert_eq!(engine.active().unwrap().history.past_len(), past + 1); assert!(super::can_fade(&engine));
        assert_untouched_sources(&source, engine.active().unwrap(), layer, route);
        engine.execute("edit.undo", json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc, source.doc); assert!(!super::can_fade(&engine));
    }
}

#[test]
fn fallback_channels_coalesce_separate_and_layerless_filters_and_fade_from_gesture_start() {
    for route in [ChannelRoute::AlphaExplicit,ChannelRoute::QuickMaskExplicit] {
        for layerless in [false,true] {
            let (mut engine,layer)=fixture(16,route);
            if layerless { let state=engine.active_mut().unwrap();state.active_layer=None;state.selected_layers.clear();state.layer_anchor=None; }
            let source=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();
            let command=if layerless {"filter.blur.gaussianBlur"} else {"filter.cameraRaw"};
            for value in [1,2] {
                let params=target_params(route,if layerless {json!({"radius":value,"coalesce":""})} else {json!({"exposure":-value,"coalesce":""})});
                let mut reference_source=engine.active().unwrap().clone();reference_source.active_layer=Some(layer);reference_source.selected_layers=vec![layer];
                let expected=grayscale_raster_reference(&reference_source,layer,route,command,&params);
                super::execute(&mut engine,command,&params).unwrap().unwrap();
                assert_eq!(target_surface(engine.active().unwrap(),route).read_region(source.bounds()),expected.read_region(source.bounds()));
                assert_eq!(engine.active().unwrap().history.past_len(),past+1);assert_eq!(engine.active().unwrap().coalesce,Some(String::new()));assert!(super::can_fade(&engine));
            }
            let grouped=engine.active().unwrap().doc.clone();
            super::execute(&mut engine,"edit.fade",&json!({"opacity":0})).unwrap().unwrap();
            assert_eq!(target_surface(engine.active().unwrap(),route).read_region(source.bounds()),target_surface(&{let mut state=engine.active().unwrap().clone();state.doc=source.clone();state},route).read_region(source.bounds()));
            engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,grouped);
            engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,source);
        }
    }
}

#[test]
fn fallback_coalescing_noops_and_errors_do_not_consume_the_gesture_key() {
    let (mut engine,_)=fixture(16,ChannelRoute::AlphaExplicit);
    super::execute(&mut engine,"filter.cameraRaw",&json!({"target":{"channel":0},"exposure":-1,"coalesce":"gesture"})).unwrap().unwrap();
    let doc=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();let revision=engine.active().unwrap().revision;let journal=engine.journal.len();
    let noop=super::execute(&mut engine,"filter.liquify",&json!({"target":{"channel":0},"strokes":[],"coalesce":"other"})).unwrap().unwrap();assert_eq!(noop["changed"],false);
    assert!(std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past);assert_eq!(engine.active().unwrap().revision,revision);assert_eq!(engine.active().unwrap().coalesce.as_deref(),Some("gesture"));assert_eq!(engine.journal.len(),journal+1);
    let recorded=engine.journal.clone();
    assert!(super::execute(&mut engine,"edit.perspectiveWarp",&json!({"target":{"channel":0},"planes":[],"coalesce":"other"})).unwrap().is_err());
    assert!(std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past);assert_eq!(engine.active().unwrap().revision,revision);assert_eq!(engine.active().unwrap().coalesce.as_deref(),Some("gesture"));assert_eq!(engine.journal,recorded);
    super::execute(&mut engine,"filter.cameraRaw",&json!({"target":{"channel":0},"exposure":-1,"coalesce":"gesture"})).unwrap().unwrap();assert_eq!(engine.active().unwrap().history.past_len(),past);
}

#[test]
fn fallback_coalesced_commit_failure_restores_moved_history_without_revision_or_journal_changes() {
    let (mut engine,_)=fixture(16,ChannelRoute::AlphaExplicit);
    let params=json!({"target":{"channel":0},"exposure":-1,"coalesce":"gesture"});
    super::execute(&mut engine,"filter.cameraRaw",&params).unwrap().unwrap();
    let state=engine.active().unwrap();let doc=state.doc.clone();let entries=state.history.entries();let revision=state.revision;let journal=engine.journal.clone();let max_states=state.history.max_states;let max_bytes=state.history.max_bytes;
    let surface=target_surface(state,ChannelRoute::AlphaExplicit);
    assert!(super::edit_plane(&mut engine,"Invalid target",super::Target::Alpha(999),surface,&params).is_err());
    let state=engine.active().unwrap();assert!(std::sync::Arc::ptr_eq(&doc,&state.doc));assert_eq!(state.history.entries(),entries);assert_eq!(state.revision,revision);assert_eq!(state.coalesce.as_deref(),Some("gesture"));assert_eq!(state.history.max_states,max_states);assert_eq!(state.history.max_bytes,max_bytes);assert_eq!(engine.journal,journal);
    engine.execute("edit.undo",json!({})).unwrap();assert!(!std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc));
}

#[test]
fn mixed_channel_filters_keep_first_coalesced_label_for_fade_marker_and_source() {
    let (mut engine,layer)=fixture(16,ChannelRoute::AlphaExplicit);let source=engine.active().unwrap().clone();let bounds=source.doc.bounds();let past=source.history.past_len();let original=target_surface(&source,ChannelRoute::AlphaExplicit).read_region(bounds);
    super::execute(&mut engine,"filter.cameraRaw",&json!({"target":{"channel":0},"exposure":-1,"coalesce":"mixed-channel"})).unwrap().unwrap();
    let label=engine.active().unwrap().history.undo_label().unwrap().to_owned();
    super::execute(&mut engine,"filter.lensCorrection",&json!({"target":{"channel":0},"profile":"generic","distortion":-25,"coalesce":"mixed-channel"})).unwrap().unwrap();
    let state=engine.active().unwrap();assert_eq!(state.history.past_len(),past+1);assert_eq!(state.history.undo_label(),Some(label.as_str()));assert_ne!(target_surface(state,ChannelRoute::AlphaExplicit).read_region(bounds),original);
    assert_eq!(engine.journal.last().unwrap().1[super::FADE_MARKER]["label"],label);assert!(super::can_fade(&engine));
    let result=super::execute(&mut engine,"edit.fade",&json!({"opacity":0,"mode":"normal"})).unwrap().unwrap();assert_eq!(result["faded"],label);
    assert_eq!(target_surface(engine.active().unwrap(),ChannelRoute::AlphaExplicit).read_region(bounds),original);assert_eq!(engine.active().unwrap().history.undo_label(),Some(format!("Fade {label}").as_str()));assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().content,source.doc.layer(layer).unwrap().content);
}

#[test]
fn repeat_channel_filter_retains_fade_eligibility_and_zero_opacity_restores_pre_repeat_plane(){
    for depth in [8,16,32]{for route in [ChannelRoute::AlphaExplicit,ChannelRoute::QuickMaskImplicit]{
        let(mut engine,_)=fixture(depth,route);let params=target_params(route,json!({"exposure":-1}));
        super::super::execute_view_command(&mut engine,"filter.cameraRaw",params).unwrap();
        let source=engine.active().unwrap().clone();let original=target_surface(&source,route).read_region(source.doc.bounds());
        super::super::execute_view_command(&mut engine,"filter.lastFilter",json!({})).unwrap();assert!(super::can_fade(&engine));
        super::super::execute_view_command(&mut engine,"edit.fade",json!({"opacity":0})).unwrap();assert_eq!(target_surface(engine.active().unwrap(),route).read_region(source.doc.bounds()),original);
    }}
}
