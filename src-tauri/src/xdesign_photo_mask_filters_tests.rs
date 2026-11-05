use base64::Engine as _;
use photocraft_engine::{channel_cmds::ChannelView, doc::{Document, LayerId, Rect}, DocState, Session};
use serde_json::{json, Value};

const GALLERY: [(&str, &str); 5] = [
    ("filter.blurGallery.fieldBlur", r#"{"pins":[{"x":0.12,"y":0.25,"blur":3},{"x":0.78,"y":0.68,"blur":15}]}"#),
    ("filter.blurGallery.irisBlur", r#"{"pins":[{"x":0.2,"y":0.3,"radiusX":0.2,"radiusY":0.3,"blur":8},{"x":0.8,"y":0.7,"radiusX":0.15,"radiusY":0.2,"blur":15}]}"#),
    ("filter.blurGallery.spinBlur", r#"{"pins":[{"x":0.3,"y":0.4,"radiusX":0.3,"radiusY":0.4,"blurAngle":45},{"x":0.7,"y":0.6,"radiusX":0.2,"radiusY":0.3,"blurAngle":20}]}"#),
    ("filter.blurGallery.pathBlur", r#"{"paths":[{"points":[[0.1,0.3],[0.5,0.7],[0.9,0.3]],"speed":20,"taper":15},{"points":[[0.3,0.1],[0.7,0.9]],"speed":10,"taper":0}]}"#),
    ("filter.blurGallery.tiltShift", r#"{"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25}"#),
];

fn fixture(depth: u32, with_mask: bool) -> (Session, LayerId) {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":32,"height":24,"depth":depth,"background":"#203040"})).unwrap();
    let id = engine.active().unwrap().active_layer.unwrap();
    engine.edit("Mask filter pixels fixture", |doc, _| {
        let bounds = doc.bounds();
        let layer = doc.layer_mut(id).unwrap();
        let surface = layer.surface_mut().unwrap();
        let channels = surface.channels();
        let mut pixels = Vec::with_capacity(32 * 24 * channels);
        for y in 0..24 {
            for x in 0..32 {
                let checker = ((x * 7 + y * 11) % 5) as f32 * 0.025;
                let rgb = [0.12 + x as f32 * 0.021 + checker, 0.18 + y as f32 * 0.026, 0.72 - (x + y) as f32 * 0.012];
                pixels.extend_from_slice(&rgb[..channels.min(3)]);
                if channels == 4 { pixels.push(0.55 + (x % 5) as f32 * 0.09); }
            }
        }
        surface.write_region(bounds, &pixels);
        Ok(())
    }).unwrap();
    if with_mask {
        engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
        engine.edit("Nonuniform layer mask fixture", |doc, _| {
            let area = Rect::from_xywh(5, 3, 22, 18);
            let mask = doc.layer_mut(id).unwrap().mask.as_mut().unwrap();
            let mut values = Vec::with_capacity((area.width() * area.height()) as usize);
            for y in area.y0..area.y1 {
                for x in area.x0..area.x1 {
                    let stripe = ((x * 5 + y * 3) % 17) as f32 / 16.0;
                    values.push(if stripe < 0.19 { 0.0 } else if stripe > 0.81 { 1.0 } else { stripe });
                }
            }
            mask.surface.write_region(area, &values);
            mask.enabled = true;
            mask.linked = false;
            mask.density = 0.73;
            mask.feather = 1.25;
            Ok(())
        }).unwrap();
    }
    engine.execute("select.rect", json!({"x":6,"y":4,"width":21,"height":17})).unwrap();
    (engine, id)
}

fn regions() -> [super::super::preview::PreviewRegion; 2] {
    [
        super::super::preview::PreviewRegion { x:3, y:2, width:17, height:13, scale:1 },
        super::super::preview::PreviewRegion { x:23, y:17, width:9, height:7, scale:2 },
    ]
}

fn materialize_mask(doc: &Document, layer: LayerId) -> photocraft_raster::Surface {
    let bounds = doc.bounds();
    let raw = doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds);
    let mut surface = doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.clone();
    surface.write_region(bounds, &raw);
    surface
}

fn expected_mask(
    doc: &Document,
    layer: LayerId,
    command: &str,
    params: &Value,
) -> photocraft_raster::Surface {
    let mask = materialize_mask(doc, layer);
    let selection = doc.selection.as_ref();
    let selection_bounds = selection.map(photocraft_raster::Surface::content_bounds).filter(|r| !r.is_empty());
    let bounds = selection_bounds.unwrap_or_else(|| doc.bounds());
    let canvas = doc.bounds().union(&mask.content_bounds());
    photocraft_engine::filters::apply_filter_to_surface(command, params, &mask, bounds, selection, canvas)
        .unwrap_or_else(|| panic!("pinned filter has no surface implementation for {command}"))
}

fn expected_doc_with_mask(doc: &Document, layer: LayerId, surface: photocraft_raster::Surface) -> Document {
    let mut expected = doc.clone();
    expected.layer_mut(layer).unwrap().mask.as_mut().unwrap().surface = surface;
    expected
}

fn reference_pixels(
    doc: &Document,
    channels: &ChannelView,
    color: &super::super::display::View,
    region: super::super::preview::PreviewRegion,
) -> Vec<u8> {
    let bounds = doc.bounds();
    let composite = photocraft_compose::render(doc, bounds);
    let full = super::super::view::present(doc, channels, composite, bounds, 1);
    let width = region.width.div_ceil(region.scale);
    let height = region.height.div_ceil(region.scale);
    let mut reduced = photocraft_compose::Buffer::transparent(Rect::from_xywh(0, 0, width, height));
    for oy in 0..height {
        for ox in 0..width {
            let mut sum = [0.0f32; 4];
            let mut count = 0u32;
            for y in oy * region.scale..((oy + 1) * region.scale).min(region.height) {
                for x in ox * region.scale..((ox + 1) * region.scale).min(region.width) {
                    let px = full.px[((region.y + y) * doc.size.width + region.x + x) as usize];
                    let alpha = px[3].clamp(0.0, 1.0);
                    for component in 0..3 { sum[component] += px[component] * alpha; }
                    sum[3] += alpha;
                    count += 1;
                }
            }
            if sum[3] > 0.0 {
                for component in 0..3 { sum[component] /= sum[3]; }
                sum[3] /= count as f32;
            }
            reduced.px[(oy * width + ox) as usize] = sum;
        }
    }
    if channels.is_plain(doc) { color.rgba(&reduced).pixels } else { reduced.to_rgba8().pixels }
}

fn assert_preview_pair(
    preview: &super::super::preview::PreviewWithRegions,
    before: &DocState,
    after: &Document,
    color: &super::super::color_views::Snapshot,
    regions: &[super::super::preview::PreviewRegion],
    label: &str,
) {
    let before_color = color.render(&before.doc).unwrap();
    let after_color = color.render(after).unwrap();
    assert_eq!(preview.original_tiles.as_ref().unwrap().len(), regions.len());
    assert_eq!(preview.tiles.as_ref().unwrap().len(), regions.len());
    for (index, region) in regions.iter().copied().enumerate() {
        let original = base64::engine::general_purpose::STANDARD.decode(&preview.original_tiles.as_ref().unwrap()[index].png).unwrap();
        let filtered = base64::engine::general_purpose::STANDARD.decode(&preview.tiles.as_ref().unwrap()[index].png).unwrap();
        assert_eq!(photocraft_codecs::decode(&original).unwrap().as_u8().unwrap(), reference_pixels(&before.doc, &before.channel_view, &before_color, region), "{label} original {index}");
        assert_eq!(photocraft_codecs::decode(&filtered).unwrap().as_u8().unwrap(), reference_pixels(after, &before.channel_view, &after_color, region), "{label} filtered {index}");
    }
}

fn assert_mask_only_change(before: &DocState, after: &DocState, layer: LayerId, expected: &photocraft_raster::Surface) {
    let old_layer = before.doc.layer(layer).unwrap();
    let new_layer = after.doc.layer(layer).unwrap();
    match (old_layer.surface(), new_layer.surface()) {
        (Some(old), Some(new)) => assert_eq!(old.read_region(before.doc.bounds()), new.read_region(after.doc.bounds()), "pixel surface is untouched"),
        (None, None) => {},
        _ => panic!("target layer content kind changed"),
    }
    let old_mask = old_layer.mask.as_ref().unwrap();
    let new_mask = new_layer.mask.as_ref().unwrap();
    assert_ne!(old_mask.surface.read_region(before.doc.bounds()), new_mask.surface.read_region(after.doc.bounds()), "test requires a real mask edit");
    assert_eq!(new_mask.surface.read_region(after.doc.bounds()), expected.read_region(after.doc.bounds()));
    assert_eq!((new_mask.enabled, new_mask.linked, new_mask.density, new_mask.feather), (old_mask.enabled, old_mask.linked, old_mask.density, old_mask.feather));
    assert_eq!(after.doc.channels, before.doc.channels, "alpha channels remain untouched");
    let mut expected_layer = old_layer.clone();
    expected_layer.mask.as_mut().unwrap().surface = new_mask.surface.clone();
    assert_eq!(new_layer, &expected_layer, "only the raster mask plane changes");
}

fn alpha_route_reference(source: &DocState, tools: &photocraft_engine::ToolState, layer: LayerId, command: &str, params: &Value) -> photocraft_raster::Surface {
    let mut alpha = Session::new();
    alpha.add_document((*source.doc).clone(), None);
    *alpha.active_mut().unwrap() = source.clone();
    alpha.tools = tools.clone();
    let surface = materialize_mask(&source.doc, layer);
    std::sync::Arc::make_mut(&mut alpha.active_mut().unwrap().doc).channels.push(photocraft_engine::doc::AlphaChannel::new("Mask filter oracle", surface));
    alpha.execute("channel.target", json!({"channel":0})).unwrap();
    let mut params = params.clone();
    params["target"] = json!({"channel":0});
    alpha.execute(command, params).unwrap();
    alpha.active().unwrap().doc.channels[0].surface.clone()
}

fn run_mask_preview_and_apply(
    mut engine: Session,
    layer: LayerId,
    command: &str,
    params: Value,
    label: &str,
) -> DocState {
    let state = engine.active().unwrap().clone();
    let before_doc = state.doc.clone();
    let before = state.clone();
    let history = state.history.entries().to_vec();
    let selection = state.doc.selection.clone();
    let tools = engine.tools.clone();
    let mask = state.doc.layer(layer).unwrap().mask.as_ref().unwrap().clone();
    let expected = expected_mask(&state.doc, layer, command, &prepared_tool_params(&tools, command, &params));
    assert_eq!(expected.read_region(state.doc.bounds()), alpha_route_reference(&state, &tools, layer, command, &params).read_region(state.doc.bounds()), "direct expected mask agrees with independent native Alpha route: {label}");

    let snapshot = super::super::color_views::Snapshot::capture(&engine).unwrap();
    let regions = regions();
    let preview = super::super::preview::render_with_color_regions(&state, &snapshot, command, params.clone(), None, Some(&regions)).unwrap();
    let expected_doc = expected_doc_with_mask(&state.doc, layer, expected.clone());
    assert_preview_pair(&preview, &state, &expected_doc, &snapshot, &regions, label);
    assert!(std::sync::Arc::ptr_eq(&before_doc, &engine.active().unwrap().doc));
    assert_eq!(engine.active().unwrap().history.entries(), history);
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap(), &mask);

    let result = super::super::execute_view_command(&mut engine, command, params).unwrap_or_else(|error| panic!("{label}: {error}"));
    let after = engine.active().unwrap();
    assert_mask_only_change(&before, after, layer, &expected);
    assert_eq!(after.doc.selection, selection);
    assert_eq!(after.channel_view, before.channel_view, "channel and mask-view presentation remain unchanged: {label}");
    assert_eq!(after.history.entries().len(), history.len() + 1, "one mask filter edit: {label}");
    assert_eq!(engine.journal.last().unwrap().0, command, "journal retains the actual filter command: {label}");
    assert_eq!(engine.journal.last().unwrap().1["target"], "mask", "journal retains explicit mask routing: {label}");
    assert_eq!(result["layer"], layer.0);
    assert!(result["filter"].is_object());
    after.clone()
}

fn prepared_tool_params(tools: &photocraft_engine::ToolState, command: &str, params: &Value) -> Value {
    let mut prepared = params.clone();
    if command == "filter.render.fibers" {
        prepared["foreground"] = json!(tools.foreground);
        prepared["background"] = json!(tools.background);
    }
    prepared
}

#[test]
fn implicit_gray_mask_view_filters_all_gallery_modes_and_depths() {
    for depth in [8, 16, 32] {
        for (command, encoded) in GALLERY {
            let (mut engine, layer) = fixture(depth, true);
            engine.execute("view.layerMask", json!({"mode":"gray"})).unwrap();
            let state = engine.active().unwrap();
            assert_eq!(state.channel_view.layer_mask.map(|view| view.mode), Some(photocraft_engine::mask_view_cmds::MaskViewMode::Gray));
            let params: Value = serde_json::from_str(encoded).unwrap();
            run_mask_preview_and_apply(engine, layer, command, params, &format!("implicit {depth} {command}"));
        }
    }
}

#[test]
fn explicit_mask_target_filters_all_gallery_modes_and_depths() {
    for depth in [8, 16, 32] {
        for (command, encoded) in GALLERY {
            let (engine, layer) = fixture(depth, true);
            let mut params: Value = serde_json::from_str(encoded).unwrap();
            params["target"] = json!("mask");
            run_mask_preview_and_apply(engine, layer, command, params, &format!("explicit {depth} {command}"));
        }
    }
}

#[test]
fn explicit_mask_target_resolves_layer_override_and_group_masks() {
    for (command, encoded) in GALLERY {
        let (mut engine, target_layer) = fixture(16, true);
        let other = LayerId(engine.execute("layer.new.layer", json!({"name":"Active but not filter target"})).unwrap()["layer"].as_u64().unwrap());
        let mut params: Value = serde_json::from_str(encoded).unwrap();
        params["layer"] = json!(target_layer.0);
        params["target"] = json!("mask");
        let state = engine.active().unwrap();
        assert_eq!(state.active_layer, Some(other));
        let original_other = state.doc.layer(other).unwrap().clone();
        let after = run_mask_preview_and_apply(engine, target_layer, command, params, &format!("layer override {command}"));
        assert_eq!(after.doc.layer(other).unwrap(), &original_other, "explicit `layer` does not disturb the active non-target layer");
    }

    let (mut group_engine, child) = fixture(16, false);
    let group = LayerId(group_engine.execute("layer.groupLayers", json!({})).unwrap()["layer"].as_u64().unwrap());
    group_engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
    group_engine.edit("Pattern group mask", |doc, _| {
        let bounds = doc.bounds();
        let mask = doc.layer_mut(group).unwrap().mask.as_mut().unwrap();
        let mut data = Vec::new();
        for y in 0..bounds.height() { for x in 0..bounds.width() { data.push(if (x / 4 + y / 3) % 2 == 0 { 0.15 } else { 0.95 }); } }
        mask.surface.write_region(bounds, &data);
        mask.density = 0.81;
        mask.feather = 0.6;
        Ok(())
    }).unwrap();
    group_engine.execute("select.rect", json!({"x":4,"y":3,"width":24,"height":18})).unwrap();
    let params = json!({"target":"mask","layer":group.0,"pins":[{"x":0.5,"y":0.5,"blur":14}]});
    run_mask_preview_and_apply(group_engine, group, "filter.blurGallery.fieldBlur", params, "group raster mask");
    assert_ne!(child, group);
}

#[test]
fn mask_filter_repeat_last_undo_and_redo_preserve_the_mask_target() {
    let (mut engine, layer) = fixture(16, true);
    engine.execute("view.layerMask", json!({"mode":"gray"})).unwrap();
    let original = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
    let params = json!({"pins":[{"x":0.15,"y":0.2,"blur":2},{"x":0.75,"y":0.8,"blur":15}]});
    super::super::execute_view_command(&mut engine, "filter.blurGallery.fieldBlur", params.clone()).unwrap();
    let once = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
    assert_ne!(original, once);
    let before_repeat_history = engine.active().unwrap().history.entries().len();
    let once_state = engine.active().unwrap().clone();
    let repeat_expected = expected_mask(&once_state.doc, layer, "filter.blurGallery.fieldBlur", &params);
    super::super::execute_view_command(&mut engine, "filter.lastFilter", json!({})).unwrap();
    let twice = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
    assert_ne!(once, twice);
    assert_eq!(twice, repeat_expected.read_region(engine.active().unwrap().doc.bounds()));
    assert_eq!(engine.active().unwrap().history.entries().len(), before_repeat_history + 1);
    assert_eq!(engine.journal[engine.journal.len() - 2].0, "filter.blurGallery.fieldBlur");
    assert_eq!(engine.journal[engine.journal.len() - 2].1["target"], "mask");
    assert_eq!(engine.journal.last().unwrap().0, "filter.lastFilter");
    assert_eq!(engine.journal.last().unwrap().1, json!({}), "repeat-last invocation retains its own incoming params");
    engine.execute("edit.undo", json!({})).unwrap();
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), once);
    engine.execute("edit.undo", json!({})).unwrap();
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), original);
    engine.execute("edit.redo", json!({})).unwrap();
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), once);
    engine.execute("edit.redo", json!({})).unwrap();
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), twice);
}

#[test]
fn ordinary_filters_keep_parameter_preparation_for_mask_targets() {
    let cases = [
        ("filter.blur.gaussianBlur", json!({"radius":2.75})),
        ("filter.other.custom", json!({"kernel":[0,0,-1,0,0,0,-1,5,-1,0,0,-1,0,0,0,0,0,0,0,0,0,0,0,0,0],"scale":1,"offset":0})),
        ("filter.noise.addNoise", json!({"amount":27.5,"distribution":"gaussian","monochromatic":false,"seed":0x12345678u64})),
        ("filter.render.fibers", json!({"variance":28,"strength":12,"seed":831})),
    ];
    for (command, mut params) in cases {
        params["target"] = json!("mask");
        let (mut engine, layer) = fixture(16, true);
        engine.execute("tools.setColors", json!({"foreground":"#e73b9a","background":"#168bd2"})).unwrap();
        let expected_params = prepared_tool_params(&engine.tools, command, &params);
        let state = engine.active().unwrap().clone();
        let expected = expected_mask(&state.doc, layer, command, &expected_params);
        let before = state.clone();
        let history = state.history.entries().len();
        super::super::execute_view_command(&mut engine, command, params.clone()).unwrap();
        let after = engine.active().unwrap();
        assert_mask_only_change(&before, after, layer, &expected);
        assert_eq!(after.history.entries().len(), history + 1, "{command}");
        assert_eq!(engine.journal.last().unwrap().0, command);
        assert_eq!(engine.journal.last().unwrap().1["target"], "mask");
    }
}

#[test]
fn mask_filter_refuses_missing_locked_and_invalid_targets_atomically() {
    let mut no_mask = Session::new();
    no_mask.execute("file.new", json!({"width":32,"height":24,"depth":16})).unwrap();
    let id = no_mask.active().unwrap().active_layer.unwrap();
    let source = no_mask.active().unwrap().doc.clone();
    let history = no_mask.active().unwrap().history.entries().to_vec();
    let journal = no_mask.journal.clone();
    assert!(super::super::execute_view_command(&mut no_mask, "filter.blurGallery.fieldBlur", json!({"target":"mask","pins":[{"x":0.5,"y":0.5,"blur":10}]})).is_err());
    assert!(std::sync::Arc::ptr_eq(&source, &no_mask.active().unwrap().doc));
    assert_eq!(no_mask.active().unwrap().history.entries(), history);
    assert_eq!(no_mask.journal, journal);
    assert!(no_mask.active().unwrap().doc.layer(id).unwrap().mask.is_none());

    let (mut locked, layer) = fixture(16, true);
    locked.execute("layer.setProps", json!({"layer":layer.0,"locks":{"all":true}})).unwrap();
    let source = locked.active().unwrap().doc.clone();
    let history = locked.active().unwrap().history.entries().to_vec();
    let journal = locked.journal.clone();
    assert!(super::super::execute_view_command(&mut locked, "filter.blurGallery.fieldBlur", json!({"target":"mask","pins":[{"x":0.5,"y":0.5,"blur":10}]})).is_err());
    assert!(std::sync::Arc::ptr_eq(&source, &locked.active().unwrap().doc));
    assert_eq!(locked.active().unwrap().history.entries(), history);
    assert_eq!(locked.journal, journal);

    let (mut invalid, _) = fixture(16, true);
    let source = invalid.active().unwrap().doc.clone();
    let history = invalid.active().unwrap().history.entries().to_vec();
    let journal = invalid.journal.clone();
    assert!(super::super::execute_view_command(&mut invalid, "filter.blurGallery.fieldBlur", json!({"target":"mask","layer":u64::MAX,"pins":[{"x":0.5,"y":0.5,"blur":10}]})).is_err());
    assert!(std::sync::Arc::ptr_eq(&source, &invalid.active().unwrap().doc));
    assert_eq!(invalid.active().unwrap().history.entries(), history);
    assert_eq!(invalid.journal, journal);
}

fn separate_mask_handlers() -> [(&'static str, Value); 6] { [
    ("filter.cameraRaw", json!({"exposure":-2.0,"contrast":18.0,"temperature":7.0})),
    ("filter.lensCorrection", json!({"profile":"generic","distortion":-42,"vertical":14,"horizontal":-9,"vignetteAmount":-35,"edge":"color","edgeColor":"#c44870"})),
    ("filter.adaptiveWideAngle", json!({"model":"fisheye","focalLength":12,"cropFactor":1.5,"scale":92,"interpolation":"bicubic","constraints":[{"a":[2,4],"b":[29,7],"orientation":"horizontal"},{"a":[8,3],"b":[11,21],"orientation":"vertical"}]})),
    ("filter.liquify", json!({"strokes":[{"tool":"forwardWarp","size":14,"pressure":1.0,"points":[[7,8],[14,12],[23,16]]}]})),
    ("edit.puppetWarp", json!({"pins":[{"src":[6,6],"dst":[6,6]},{"src":[25,6],"dst":[25,6]},{"src":[7,19],"dst":[13,21]},{"src":[25,19],"dst":[25,19]}]})),
    ("edit.perspectiveWarp", json!({"planes":[{"src":[[0,0],[32,0],[32,24],[0,24]],"dst":[[2,1],[30,0],[32,23],[0,22]]}]})),
] }

fn run_separate_mask_handler(mut engine: Session, layer: LayerId, command: &str, params: Value, label: &str) -> DocState {
    let before = engine.active().unwrap().clone();
    let before_doc = before.doc.clone();
    let old_layer = before.doc.layer(layer).unwrap().clone();
    let source_history = before.history.entries().to_vec();
    let source_journal = engine.journal.clone();
    let source_selection = before.doc.selection.clone();
    let source_mask = old_layer.mask.as_ref().unwrap().clone();
    let expected = direct_raster_handler_reference(&before, layer, command, &params);
    let color = super::super::color_views::Snapshot::capture(&engine).unwrap();
    let preview = super::super::preview::render_with_color(&before, &color, command, params.clone(), None).unwrap();
    let expected_doc = expected_doc_with_mask(&before.doc, layer, expected.clone());
    let display = color.render(&expected_doc).unwrap();
    assert_eq!(preview.png, super::super::render_color_view_preview(&expected_doc, &before.channel_view, Some(&display)).unwrap().png, "fit preview matches independent separate-handler mask result: {label}");
    assert!(std::sync::Arc::ptr_eq(&before_doc, &engine.active().unwrap().doc));
    let _result = super::super::execute_view_command(&mut engine, command, params)
        .unwrap_or_else(|error| panic!("{label}: {error}"));
    let after = engine.active().unwrap();
    let new_layer = after.doc.layer(layer).unwrap();
    assert_ne!(source_mask.surface.read_region(before.doc.bounds()), new_layer.mask.as_ref().unwrap().surface.read_region(after.doc.bounds()), "separate handler must edit actual mask samples: {label}");
    assert_eq!(new_layer.mask.as_ref().unwrap().surface.read_region(after.doc.bounds()), expected.read_region(after.doc.bounds()), "mask samples match the pinned filter or grayscale-raster command reference: {label}");
    assert_eq!((new_layer.mask.as_ref().unwrap().enabled, new_layer.mask.as_ref().unwrap().linked, new_layer.mask.as_ref().unwrap().density, new_layer.mask.as_ref().unwrap().feather), (source_mask.enabled, source_mask.linked, source_mask.density, source_mask.feather), "mask metadata is preserved: {label}");
    assert_eq!(new_layer.content, old_layer.content, "layer pixels/content stay unchanged: {label}");
    assert_eq!(new_layer.mask.as_ref().unwrap().surface.format(), source_mask.surface.format(), "mask depth is retained: {label}");
    assert_eq!(new_layer.mask.as_ref().unwrap().surface.default_pixel(), source_mask.surface.default_pixel(), "mask defaults survive resampling: {label}");
    assert_eq!(new_layer.mask.as_ref().unwrap().surface.read_region(Rect::from_xywh(1000, 1000, 1, 1)), source_mask.surface.read_region(Rect::from_xywh(1000, 1000, 1, 1)), "unstored mask samples remain unchanged: {label}");
    assert_eq!(after.doc.channels, before.doc.channels, "alpha channels are untouched: {label}");
    assert_eq!(after.doc.selection, source_selection, "selection is preserved: {label}");
    assert_eq!(after.channel_view, before.channel_view, "channel/mask view is preserved: {label}");
    assert_eq!(after.history.entries().len(), source_history.len() + 1, "single undoable mask edit: {label}");
    assert_eq!(engine.journal.len(), source_journal.len() + 1, "one operation journal entry: {label}");
    assert_eq!(engine.journal.last().unwrap().0, command, "journal records separate native handler: {label}");
    assert_eq!(engine.journal.last().unwrap().1["target"], "mask", "journal records mask routing: {label}");
    assert_eq!(before.doc, before_doc, "source snapshot remains immutable");
    after.clone()
}

fn direct_raster_handler_reference(source: &DocState, layer: LayerId, command: &str, params: &Value) -> photocraft_raster::Surface {
    let mut scratch = Session::new();
    scratch.add_document((*source.doc).clone(), None);
    *scratch.active_mut().unwrap() = source.clone();
    scratch.active_mut().unwrap().channel_view = Default::default();
    let mask = materialize_mask(&source.doc, layer);
    let draft = std::sync::Arc::make_mut(&mut scratch.active_mut().unwrap().doc);
    draft.mode = photocraft_engine::doc::ColorMode::Grayscale; draft.depth = mask.format().sample; draft.icc_profile = None;
    let target = draft.layer_mut(layer).unwrap();
    target.locks.pixels = false; target.locks.position = false; target.locks.transparency = false;
    target.content = photocraft_engine::doc::LayerContent::Raster(mask);
    target.mask = None;
    let mut raster_params = params.clone();
    if let Some(object) = raster_params.as_object_mut() {
        object.remove("target");
        object.remove("layer");
    }
    scratch.execute(command, raster_params).unwrap_or_else(|error| panic!("grayscale raster reference {command}: {error}"));
    let output = scratch.active().unwrap().doc.layer(layer).unwrap().surface().unwrap();
    let original = &source.doc.layer(layer).unwrap().mask.as_ref().unwrap().surface;
    if output.format() == original.format() && output.default_pixel() == original.default_pixel() { return output.clone(); }
    let mut plane = original.clone(); let defaults = original.default_pixel();
    let bounds = source.doc.bounds();
    let raw = output.read_region(bounds);
    let values: Vec<_> = raw.chunks_exact(output.channels()).map(|pixel| {
        let rgba = photocraft_raster::to_rgba(&output.format(), pixel);
        rgba[0] * rgba[3].clamp(0.0, 1.0) + defaults[0] * (1.0 - rgba[3].clamp(0.0, 1.0))
    }).collect();
    plane.write_region(bounds, &values); plane
}

#[test]
fn separate_handlers_route_implicit_and_explicit_masks_at_all_depths() {
    for depth in [8, 16, 32] {
        for (command, encoded) in separate_mask_handlers() {
            for implicit in [true, false] {
                let (mut engine, layer) = fixture(depth, true);
                let mut params = encoded.clone();
                if implicit {
                    engine.execute("view.layerMask", json!({"mode":"gray"})).unwrap();
                } else {
                    params["target"] = json!("mask");
                }
                run_separate_mask_handler(engine, layer, command, params, &format!("{depth}-bit {} {command}", if implicit { "implicit" } else { "explicit" }));
            }
        }
    }
}

#[test]
fn separate_handlers_route_group_and_smart_object_masks_without_changing_content() {
    for (command, params) in [
        ("filter.cameraRaw", json!({"exposure":-2.5,"target":"mask"})),
        ("edit.perspectiveWarp", json!({"planes":[{"src":[[0,0],[32,0],[32,24],[0,24]],"dst":[[3,0],[29,1],[32,23],[1,22]]}],"target":"mask"})),
    ] {
        let (mut engine, child) = fixture(16, false);
        let group = LayerId(engine.execute("layer.groupLayers", json!({})).unwrap()["layer"].as_u64().unwrap());
        engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
        engine.edit("Nonuniform group mask", |doc, _| {
            let mask = &mut doc.layer_mut(group).unwrap().mask.as_mut().unwrap().surface;
            mask.write_region(Rect::from_xywh(7, 5, 16, 12), &(0..16 * 12).map(|i| (i % 11) as f32 / 10.0).collect::<Vec<_>>()); Ok(())
        }).unwrap();
        let before_child = engine.active().unwrap().doc.layer(child).unwrap().clone();
        let after = run_separate_mask_handler(engine, group, command, params, &format!("group mask {command}"));
        assert_eq!(after.doc.layer(child).unwrap(), &before_child);
    }

    let (mut smart, _) = fixture(32, false);
    smart.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
    let layer = smart.active().unwrap().active_layer.unwrap();
    smart.execute("layer.layerMask.revealAll", json!({})).unwrap();
    smart.edit("Nonuniform Smart Object mask", |doc, _| {
        doc.layer_mut(layer).unwrap().mask.as_mut().unwrap().surface.write_region(Rect::from_xywh(4, 3, 24, 18), &(0..24 * 18).map(|i| (i % 13) as f32 / 12.0).collect::<Vec<_>>()); Ok(())
    }).unwrap();
    let before_smart = smart.active().unwrap().doc.layer(layer).unwrap().content.clone();
    let after = run_separate_mask_handler(smart, layer, "filter.adaptiveWideAngle", json!({"scale":92,"interpolation":"nearest","constraints":[{"a":[3,5],"b":[28,8],"orientation":"horizontal"}],"target":"mask"}), "wide-angle raster mask on Smart Object");
    assert_eq!(after.doc.layer(layer).unwrap().content, before_smart, "raster mask filtering must not become a Smart Filter or alter embedded content");
    assert!(after.doc.layer(layer).unwrap().mask.is_some());
}

#[test]
fn raw_and_lens_mask_filters_repeat_last_undo_and_redo() {
    for (command, params) in [
        ("filter.cameraRaw", json!({"exposure":-2.0,"contrast":12.0})),
        ("filter.lensCorrection", json!({"profile":"generic","distortion":-38,"edge":"white"})),
    ] {
        let (mut engine, layer) = fixture(16, true);
        engine.execute("view.layerMask", json!({"mode":"gray"})).unwrap();
        let initial = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
        let base_history = engine.active().unwrap().history.entries().len();
        super::super::execute_view_command(&mut engine, command, params.clone()).unwrap_or_else(|error| panic!("{command}: {error}"));
        let once = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
        assert_ne!(initial, once, "{command} must actually change mask samples");
        assert_eq!(engine.journal.last().unwrap().0, command);
        assert_eq!(engine.journal.last().unwrap().1["target"], "mask");
        let pre_repeat = engine.active().unwrap().doc.clone();
        super::super::execute_view_command(&mut engine, "filter.lastFilter", json!({})).unwrap_or_else(|error| panic!("repeat {command}: {error}"));
        let twice = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
        assert_ne!(once, twice, "Last Filter repeats the stored {command} on the mask");
        assert_eq!(engine.journal[engine.journal.len()-2].0, command);
        assert_eq!(engine.journal[engine.journal.len()-2].1["target"], "mask");
        assert_eq!(engine.journal.last().unwrap().0, "filter.lastFilter");
        assert_eq!(engine.journal.last().unwrap().1, json!({}));
        assert_eq!(engine.active().unwrap().history.entries().len(), base_history + 2);
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), once);
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), initial);
        engine.execute("edit.redo", json!({})).unwrap();
        assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), once);
        engine.execute("edit.redo", json!({})).unwrap();
        assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), twice);
        assert_ne!(pre_repeat, engine.active().unwrap().doc);
    }
}

#[test]
fn separate_handler_invalid_geometry_fails_without_mutating_mask_or_journal() {
    for (command, params) in [
        ("filter.lensCorrection", json!({"straighten":[[1,2],[1,2]],"target":"mask"})),
        ("filter.adaptiveWideAngle", json!({"constraints":[{"a":[1,2],"b":[1,2],"orientation":"horizontal"}],"target":"mask"})),
    ] {
        let (mut engine, layer) = fixture(16, true);
        let doc = engine.active().unwrap().doc.clone();
        let history = engine.active().unwrap().history.entries().to_vec();
        let journal = engine.journal.clone();
        let mask = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
        assert!(super::super::execute_view_command(&mut engine, command, params).is_err(), "invalid geometry must refuse: {command}");
        assert!(std::sync::Arc::ptr_eq(&doc, &engine.active().unwrap().doc));
        assert_eq!(engine.active().unwrap().history.entries(), history);
        assert_eq!(engine.journal, journal);
        assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds()), mask);
    }
}

#[test]
fn mask_filter_fade_blends_only_raw_mask_and_remains_undoable() {
    let (mut engine, layer) = fixture(16, true);
    let source = engine.active().unwrap().clone();
    let bounds = source.doc.bounds();
    let original = source.doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds);
    super::super::execute_view_command(&mut engine, "filter.blurGallery.fieldBlur", json!({"target":"mask","blur":12})).unwrap();
    let filtered = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds);
    assert_ne!(filtered, original); assert!(engine.is_enabled("edit.fade"));
    assert!(engine.edit_state.fade.as_ref().unwrap().mask);
    super::super::execute_view_command(&mut engine, "edit.fade", json!({"opacity":50,"mode":"normal"})).unwrap();
    let faded = engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds);
    for ((before, after), blended) in original.iter().zip(&filtered).zip(&faded) {
        assert!((blended - (before + (after - before) * 0.5)).abs() <= 1.0 / 255.0, "Fade uses the raw grayscale mask, including quantization");
    }
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().content, source.doc.layer(layer).unwrap().content);
    engine.execute("edit.undo", json!({})).unwrap();
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds), filtered);
}

#[test]
fn mask_filter_preserves_disabled_metadata_and_unstored_canvas_defaults() {
    let (mut engine, layer) = fixture(8, true);
    engine.edit("Disabled mask fixture", |doc, _| { doc.layer_mut(layer).unwrap().mask.as_mut().unwrap().enabled = false; Ok(()) }).unwrap();
    let before = engine.active().unwrap().clone();
    let params = json!({"target":"mask","radius":2.75});
    let expected = expected_mask(&before.doc, layer, "filter.blur.gaussianBlur", &params);
    let default = before.doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.default_pixel();
    super::super::execute_view_command(&mut engine, "filter.blur.gaussianBlur", params).unwrap();
    assert_mask_only_change(&before, engine.active().unwrap(), layer, &expected);
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.default_pixel(), default);
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(Rect::from_xywh(1000, 1000, 1, 1))[0], default[0]);
}

#[test]
fn fallback_mask_filter_coalescing_matches_native_keys_undo_redo_and_repeat_outer_context() {
    for key in ["mask-slider", ""] {
        let (mut engine, layer) = fixture(16, true);
        let source = engine.active().unwrap().doc.clone();
        let past = engine.active().unwrap().history.past_len();
        let mut reference = Session::new();reference.add_document((*source).clone(),None);
        let reference_past = reference.active().unwrap().history.past_len();
        for radius in [2,4] {
            let params=json!({"radius":radius,"coalesce":key});
            reference.execute("filter.blur.gaussianBlur",params.clone()).unwrap();
            let expected=expected_mask(&engine.active().unwrap().doc,layer,"filter.blur.gaussianBlur",&params);
            super::execute(&mut engine,"filter.blur.gaussianBlur",&json!({"radius":radius,"target":"mask","coalesce":key})).unwrap().unwrap();
            assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(source.bounds()),expected.read_region(source.bounds()));
            assert_eq!(engine.active().unwrap().history.past_len()-past,reference.active().unwrap().history.past_len()-reference_past);
            assert_eq!(engine.active().unwrap().coalesce,reference.active().unwrap().coalesce);
        }
        let grouped=engine.active().unwrap().doc.clone();
        engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,source);assert_eq!(engine.active().unwrap().coalesce,None);
        engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,grouped);assert_eq!(engine.active().unwrap().coalesce,None);
        super::execute(&mut engine,"filter.lastFilter",&json!({})).unwrap().unwrap();assert_eq!(engine.active().unwrap().history.past_len(),past+2);assert_eq!(engine.active().unwrap().coalesce,None);assert_eq!(engine.journal.last().unwrap().0,"filter.lastFilter");
        for outer in [json!({"coalesce":key}),json!({"coalesce":key}),json!({"coalesce":"other"}),json!({})] {
            super::execute(&mut engine,"filter.lastFilter",&outer).unwrap().unwrap();
        }
        assert_eq!(engine.active().unwrap().history.past_len(),past+5);
        assert_eq!(engine.journal.last().unwrap().0,"filter.lastFilter");
    }
}

#[test]
fn mixed_mask_filters_keep_first_coalesced_history_label_and_fade_gesture_start() {
    let (mut engine,layer)=fixture(16,true);let source=engine.active().unwrap().doc.clone();let bounds=source.bounds();let past=engine.active().unwrap().history.past_len();
    let original=source.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds);
    super::execute(&mut engine,"filter.blur.gaussianBlur",&json!({"target":"mask","radius":3,"coalesce":"mixed-mask"})).unwrap().unwrap();
    let label=engine.active().unwrap().history.undo_label().unwrap().to_owned();
    super::execute(&mut engine,"filter.cameraRaw",&json!({"target":"mask","exposure":-1,"coalesce":"mixed-mask"})).unwrap().unwrap();
    let state=engine.active().unwrap();assert_eq!(state.history.past_len(),past+1);assert_eq!(state.history.undo_label(),Some(label.as_str()));assert_ne!(state.doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds),original);
    assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,label);assert!(engine.is_enabled("edit.fade"));
    let result=super::super::execute_view_command(&mut engine,"edit.fade",json!({"opacity":0,"mode":"normal"})).unwrap();assert_eq!(result["faded"],label);
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(bounds),original);assert_eq!(engine.active().unwrap().history.undo_label(),Some(format!("Fade {label}").as_str()));
    assert_eq!(engine.active().unwrap().doc.layer(layer).unwrap().content,source.layer(layer).unwrap().content);
}
