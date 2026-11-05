use super::super::run_with;
use super::super::tests::{checked, fixture, normalize, same, smart, twin, unchanged};
use photocraft_engine::{doc::{Affine, AlphaChannel, Layer, LayerContent, LayerId, LayerMask, PixelFormat, Rect, SampleType, SmartObject, SmartSource}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::sync::{Arc, Weak};

const APPLY: [&str; 2] = ["edit.transform.warp", "layer.smartObjects.warp"];

fn translated(rect: [i32; 4], dx: f64, dy: f64, interpolation: &str) -> Value {
    let mut points = Vec::new();
    for y in 0..4 {
        for x in 0..4 {
            points.push([
                f64::from(rect[0]) + dx + f64::from(rect[2] - rect[0]) * f64::from(x) / 3.0,
                f64::from(rect[1]) + dy + f64::from(rect[3] - rect[1]) * f64::from(y) / 3.0,
            ]);
        }
    }
    json!({"rect":rect,"mesh":{"us":[0,1],"vs":[0,1],"points":points},"interpolation":interpolation})
}

fn mask(format: PixelFormat, default: f32, rect: Rect, values: &[f32]) -> Surface {
    let mut surface = Surface::with_default(PixelFormat::new(photocraft_engine::doc::ColorMode::Grayscale, format.sample, false), &[default]);
    surface.write_region(rect, values);
    surface.prune();
    surface
}

fn raster(depth: u32, default: f32) -> (Session, LayerId, LayerId) {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":12,"height":10,"depth":depth})).unwrap();
    let format = engine.active().unwrap().doc.pixel_format();
    let mut first = Layer::raster("Selected raster", format);
    first.surface_mut().unwrap().write_region(Rect::new(2, 1, 4, 3), &[
        1., 0., 0., 1., 0., 1., 0., 1.,
        0., 0., 1., 1., 1., 1., 1., 1.,
    ]);
    let mut first_mask = LayerMask::reveal_all();
    first_mask.surface = mask(format, default, Rect::new(2, 1, 4, 3), &[0.2, 0.8, 0.6, 0.3]);
    first_mask.enabled = false;
    first_mask.linked = true;
    first_mask.density = 0.6;
    first_mask.feather = 0.75;
    first.mask = Some(first_mask);
    let mut other = Layer::raster("Unrelated raster", format);
    other.surface_mut().unwrap().fill_rect(Rect::new(8, 6, 10, 8), &[0.2, 0.4, 0.6, 0.5]);
    other.mask = Some(LayerMask::hide_all());
    let ids = (first.id, other.id);
    engine.edit("Gray Warp fixture", |doc, active| {
        doc.layers = vec![first, other];
        *active = Some(ids.0);
        doc.selection = Some(mask(format, 0.0, Rect::new(2, 1, 4, 3), &[0.5, 0.25, 0.75, 1.0]));
        let coverage = mask(format, 0.4, Rect::new(7, 5, 9, 7), &[0.1, 0.3, 0.7, 0.9]);
        doc.channels.push(AlphaChannel::new("Untouched alpha", coverage.clone()));
        doc.quick_mask = Some(AlphaChannel::new("Untouched Quick Mask", coverage));
        Ok(())
    }).unwrap();
    normalize(&mut engine);
    engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    let state = engine.active().unwrap();
    engine.edit_state.fade = Some(photocraft_engine::edit_menu_cmds::FadeSource {
        doc: state.doc.id, revision: state.revision, layer: ids.0, mask: false, label: "Older gray Warp Fade".into(),
    });
    (engine, ids.0, ids.1)
}

fn assert_undo_redo(engine: &mut Session, native: &mut Session, before: &Arc<photocraft_engine::doc::Document>) {
    let after = engine.active().unwrap().doc.clone();
    engine.execute("edit.undo", json!({})).unwrap();
    native.execute("edit.undo", json!({})).unwrap();
    same(engine, native);
    assert!(Arc::ptr_eq(&engine.active().unwrap().doc, before));
    engine.execute("edit.redo", json!({})).unwrap();
    native.execute("edit.redo", json!({})).unwrap();
    same(engine, native);
    assert_eq!(engine.active().unwrap().doc, after);
}

fn enable_smart_alias(engine: &mut Session) -> LayerId {
    let format = engine.active().unwrap().doc.pixel_format();
    let mut cache = Surface::new(format);
    cache.fill_rect(Rect::new(9, 8, 10, 9), &[0.2, 0.4, 0.6, 1.0]);
    let object = SmartObject::new(SmartSource::Embedded { file_name: "must-not-read.bin".into(), bytes: Arc::new(b"unused invalid source".to_vec()) }, Affine::IDENTITY, Some(cache));
    let mut layer = Layer::new("Eligibility-only Smart", LayerContent::Smart(object));
    layer.mask = Some(LayerMask::reveal_all());
    let id = layer.id;
    engine.edit("Native Smart Warp eligibility", |doc, active| { doc.layers.push(layer); *active = Some(id); Ok(()) }).unwrap();
    normalize(engine);
    id
}

#[test]
fn warp_gray_apply_selected_raster_native_all_depths_interpolations_and_mask_defaults() {
    for command in APPLY {
        for depth in [8, 16, 32] {
            for interpolation in ["nearest", "bilinear", "bicubic"] {
                for (index, default) in [0.0, 0.4, 1.0].into_iter().enumerate() {
                    let (mut engine, id, other) = raster(depth, default);
                    if index != 0 {
                        engine.edit("Selected raster native format", |doc, _| {
                            let layer = doc.layer_mut(id).unwrap();
                            if index == 1 {
                                let format = layer.surface().unwrap().format();
                                let opaque = layer.surface().unwrap().convert(PixelFormat::new(format.mode, format.sample, false));
                                *layer.surface_mut().unwrap() = opaque;
                            } else {
                                layer.name = "Background".into();
                                layer.locks.position = true;
                                layer.locks.transparency = true;
                            }
                            Ok(())
                        }).unwrap();
                        normalize(&mut engine);
                    }
                    let idle_smart = (command == APPLY[1]).then(|| enable_smart_alias(&mut engine));
                    let view = &mut engine.active_mut().unwrap().channel_view;
                    view.target = match index {
                        0 => photocraft_engine::channel_cmds::ChannelTarget::Color(1),
                        1 => photocraft_engine::channel_cmds::ChannelTarget::Alpha(0),
                        _ => photocraft_engine::channel_cmds::ChannelTarget::Composite,
                    };
                    if index == 2 && idle_smart.is_none() {
                        view.layer_mask = Some(photocraft_engine::mask_view_cmds::LayerMaskView { layer: id, mode: photocraft_engine::mask_view_cmds::MaskViewMode::Gray });
                    }
                    let before = engine.active().unwrap().doc.clone();
                    let mut native = twin(&engine);
                    let mut params = translated([0, 0, 8, 6], 1.35, -0.6, interpolation);
                    params["layer"] = json!(id.0);
                    params["target"] = [json!({"alpha":0}), json!("quickMask"), json!("mask")][index].clone();
                    let mut reads = 0;
                    let result = run_with(&mut engine, command, &params, |_, _, _| { reads += 1; panic!("Raster Warp must not resolve Smart sources") });
                    assert_eq!(result.unwrap(), native.execute(command, params).unwrap());
                    same(&engine, &native);
                    assert_eq!(reads, 0);
                    assert_eq!(engine.active().unwrap().doc.layer(other), before.layer(other));
                    assert_eq!(engine.active().unwrap().doc.channels, before.channels);
                    assert_eq!(engine.active().unwrap().doc.quick_mask, before.quick_mask);
                    if let Some(id) = idle_smart { assert_eq!(engine.active().unwrap().doc.layer(id), before.layer(id)); }
                    let actual_mask = engine.active().unwrap().doc.layer(id).unwrap().mask.as_ref().unwrap();
                    let old_mask = before.layer(id).unwrap().mask.as_ref().unwrap();
                    assert_eq!((actual_mask.enabled, actual_mask.linked, actual_mask.density, actual_mask.feather), (old_mask.enabled, old_mask.linked, old_mask.density, old_mask.feather));
                    assert_undo_redo(&mut engine, &mut native, &before);
                }
            }
        }
    }
}

#[test]
fn warp_gray_apply_smart_and_nested_group_native_mask_selection_and_source_parity() {
    for command in APPLY {
        for depth in [8, 16, 32] {
            for interpolation in ["nearest", "bilinear", "bicubic"] {
                for group in [false, true] {
                    let mut f = fixture(depth, "png");
                    let target = if group { f.group } else { f.active };
                    f.engine.edit("Gray Smart masks", |doc, _| {
                        let format = doc.pixel_format();
                        for id in [f.active, f.other, f.embedded] {
                            let layer = doc.layer_mut(id).unwrap();
                            layer.mask.as_mut().unwrap().linked = true;
                            layer.mask.as_mut().unwrap().surface = mask(format, 1.0, Rect::new(2, 1, 4, 3), &[0.1, 0.3, 0.7, 0.9]);
                            let LayerContent::Smart(object) = &mut layer.content else { unreachable!() };
                            object.filter_mask.as_mut().unwrap().surface = mask(format, 0.4, Rect::new(2, 1, 4, 3), &[0.2, 0.5, 0.8, 1.0]);
                        }
                        doc.selection = Some(mask(format, 0.4, Rect::new(2, 1, 4, 3), &[0.1, 0.3, 0.7, 0.9]));
                        Ok(())
                    }).unwrap();
                    normalize(&mut f.engine);
                    let before = f.engine.active().unwrap().doc.clone();
                    let mut native = twin(&f.engine);
                    let mut params = translated([0, 0, 16, 12], 1.25, 0.5, interpolation);
                    params["layer"] = json!(target.0);
                    let mut visits = Vec::new();
                    assert_eq!(run_with(&mut f.engine, command, &params, |id, metadata, object| { visits.push(id); checked(id, metadata, object) }).unwrap(), native.execute(command, params).unwrap());
                    same(&f.engine, &native);
                    assert_eq!(visits, if group { vec![f.other, f.embedded] } else { vec![f.active] });
                    for id in [f.active, f.other, f.embedded] {
                        let actual = smart(&f.engine.active().unwrap().doc, id);
                        let original = smart(&before, id);
                        assert_eq!(actual.source, original.source);
                        assert_eq!(actual.psd_raw, original.psd_raw);
                        assert_eq!(actual.smart_filters, original.smart_filters);
                        assert_eq!(f.engine.active().unwrap().doc.layer(id).unwrap().psd_blocks, before.layer(id).unwrap().psd_blocks);
                    }
                    assert_eq!(f.engine.active().unwrap().doc.metadata, before.metadata);
                    assert_undo_redo(&mut f.engine, &mut native, &before);
                }
            }
        }
    }
}

#[test]
fn warp_gray_apply_default_bounds_and_unlinked_mask_keep_native_layer_routing() {
    for command in APPLY {
        let (mut engine, id, _) = raster(16, 0.4);
        engine.edit("Unlinked gray Warp mask", |doc, _| {
            doc.layer_mut(id).unwrap().mask.as_mut().unwrap().linked = false;
            Ok(())
        }).unwrap();
        normalize(&mut engine);
        let idle_smart = (command == APPLY[1]).then(|| enable_smart_alias(&mut engine));
        let before = engine.active().unwrap().doc.clone();
        let mut native = twin(&engine);
        let mut params = translated([2, 1, 4, 3], 3.0, 2.0, "nearest");
        params["layer"] = json!(id.0);
        params.as_object_mut().unwrap().remove("rect");
        params["target"] = json!("mask");
        let result = run_with(&mut engine, command, &params, |_, _, _| panic!("No Smart source")).unwrap();
        assert_eq!(result["rect"], json!([2, 1, 4, 3]));
        assert_eq!(result, native.execute(command, params).unwrap());
        same(&engine, &native);
        assert_eq!(engine.active().unwrap().doc.layer(id).unwrap().mask, before.layer(id).unwrap().mask);
        assert_ne!(engine.active().unwrap().doc.layer(id).unwrap().surface(), before.layer(id).unwrap().surface());
        if let Some(id) = idle_smart { assert_eq!(engine.active().unwrap().doc.layer(id), before.layer(id)); }
    }
}

#[test]
fn warp_gray_apply_identity_and_native_error_priority_are_side_effect_free() {
    for command in APPLY {
        for kind in ["identityLocked", "locked", "badWarp", "badTarget", "emptyRect"] {
            let (mut engine, id, _) = raster(16, 1.0);
            if kind == "identityLocked" || kind == "locked" {
                engine.edit("Locked gray Warp", |doc, _| { doc.layer_mut(id).unwrap().locks.all = true; Ok(()) }).unwrap();
                normalize(&mut engine);
            }
            let before = twin(&engine);
            let mut native = twin(&engine);
            let mut params = translated([0, 0, 8, 6], 3.0, 2.0, "nearest");
            match kind {
                "identityLocked" => params = json!({"style":"none","rect":[0,0,8,6]}),
                "badWarp" => params["mesh"] = json!({"us":[0,1],"vs":[0,1],"points":[]}),
                "badTarget" => params["layer"] = json!(u64::MAX),
                "emptyRect" => params["rect"] = json!([0,0,0,0]),
                _ => {}
            }
            let mut calls = 0;
            let actual = run_with(&mut engine, command, &params, |_, _, _| { calls += 1; panic!("Invalid/native no-op must not resolve") });
            let expected = native.execute(command, params).map_err(|error| error.to_string());
            assert_eq!(actual, expected);
            same(&engine, &native);
            assert_eq!(calls, 0);
            if kind != "identityLocked" { unchanged(&engine, &before); }
            else { assert_eq!(engine.active().unwrap().doc, before.active().unwrap().doc); assert_eq!(engine.active().unwrap().revision, before.active().unwrap().revision); }
        }
    }
}

fn encoded_gray(sample: SampleType, value: f32) -> f32 {
    match sample {
        SampleType::U8 => (value.clamp(0.0, 1.0) * 255.0).round() / 255.0,
        SampleType::U16 => (value.clamp(0.0, 1.0) * 65535.0).round() / 65535.0,
        SampleType::F32 => value,
    }
}

#[test]
fn warp_gray_apply_far_selected_raster_literal_split_mask_selection_and_undo() {
    const DX: i32 = 750_000;
    const DY: i32 = -750_000;
    for command in APPLY {
        for depth in [8, 16, 32] {
            for default in [0.0, 0.4, 1.0] {
                let (mut engine, id, other) = raster(depth, default);
                let idle_smart = (command == APPLY[1]).then(|| enable_smart_alias(&mut engine));
                let before = engine.active().unwrap().doc.clone();
                let journal = engine.journal.len();
                let revision = engine.active().unwrap().revision;
                let fade = engine.edit_state.fade.clone();
                let mut params = translated([2, 1, 4, 3], f64::from(DX), f64::from(DY), "nearest");
                params["layer"] = json!(id.0);
                let result = run_with(&mut engine, command, &params, |_, _, _| panic!("Raster must not read sources")).unwrap();
                assert_eq!(result, json!({"layer":id.0,"changed":true,"rect":[2,1,4,3]}));
                let doc = &engine.active().unwrap().doc;
                let actual = doc.layer(id).unwrap().surface().unwrap();
                let source = before.layer(id).unwrap().surface().unwrap();
                let selection = before.selection.as_ref().unwrap();
                let sample = source.format().sample;
                for y in 1..3 {
                    for x in 2..4 {
                        let pixel = source.pixel(x, y);
                        let k = selection.sample_channel(x, y, 0);
                        for (at, alpha) in [((x, y), encoded_gray(sample, 1.0 - k)), ((x + DX, y + DY), encoded_gray(sample, k))] {
                            let expected = vec![pixel[0], pixel[1], pixel[2], alpha];
                            assert_eq!(actual.pixel(at.0, at.1), expected, "{command}/{depth}/{default}/{at:?}");
                        }
                        let actual_mask = &doc.layer(id).unwrap().mask.as_ref().unwrap().surface;
                        let old_mask = &before.layer(id).unwrap().mask.as_ref().unwrap().surface;
                        assert_eq!(actual_mask.pixel(x + DX, y + DY), old_mask.pixel(x, y));
                        assert_eq!(actual_mask.pixel(x, y), old_mask.default_pixel());
                        assert_eq!(doc.selection.as_ref().unwrap().pixel(x + DX, y + DY), selection.pixel(x, y));
                        assert_eq!(doc.selection.as_ref().unwrap().pixel(x, y), selection.default_pixel());
                    }
                }
                assert_eq!(actual.pixel(DX / 2, DY / 2), vec![0.; 4]);
                assert_eq!(doc.layer(id).unwrap().mask.as_ref().unwrap().surface.pixel(DX / 2, DY / 2), before.layer(id).unwrap().mask.as_ref().unwrap().surface.default_pixel());
                assert_eq!(doc.layer(other), before.layer(other));
                assert_eq!(doc.channels, before.channels);
                assert_eq!(doc.quick_mask, before.quick_mask);
                assert_eq!(doc.metadata, before.metadata);
                if let Some(id) = idle_smart { assert_eq!(doc.layer(id), before.layer(id)); }
                assert_eq!(engine.journal.len(), journal + 1);
                assert_eq!(engine.journal.last(), Some(&(command.into(), params)));
                assert_eq!(engine.active().unwrap().revision, revision + 1);
                assert_eq!(engine.edit_state.fade, fade);
                let after = doc.clone();
                engine.execute("edit.undo", json!({})).unwrap();
                assert!(Arc::ptr_eq(&engine.active().unwrap().doc, &before));
                engine.execute("edit.redo", json!({})).unwrap();
                assert_eq!(engine.active().unwrap().doc, after);
            }
        }
    }
}

#[test]
fn warp_gray_apply_far_group_missing_sources_keep_cache_metadata_and_order() {
    const DX: i32 = 750_000;
    const DY: i32 = -750_000;
    let mut f = fixture(32, "png");
    f.engine.edit("Far group gray masks", |doc, active| {
        let first = doc.remove(f.active).unwrap();
        doc.layer_mut(f.group).unwrap().children_mut().unwrap().insert(0, first);
        *active = Some(f.group);
        for (id, x, y) in [(f.active, 2, 1), (f.other, 8, 1), (f.embedded, 2, 6)] {
            let layer = doc.layer_mut(id).unwrap();
            layer.mask.as_mut().unwrap().linked = true;
            layer.mask.as_mut().unwrap().surface.write_pixel(x, y, &[0.2]);
            let LayerContent::Smart(object) = &mut layer.content else { unreachable!() };
            object.source = SmartSource::Linked { path: format!("missing far group {}", id.0) };
            object.filter_mask.as_mut().unwrap().surface = Surface::with_default(PixelFormat::GRAY8, &[1.0]);
            object.filter_mask.as_mut().unwrap().surface.write_pixel(x, y, &[0.4]);
        }
        Ok(())
    }).unwrap();
    normalize(&mut f.engine);
    let before = f.engine.active().unwrap().doc.clone();
    let mut params = translated([0, 0, 16, 12], f64::from(DX), f64::from(DY), "nearest");
    params["layer"] = json!(f.group.0);
    let mut order = Vec::new();
    run_with(&mut f.engine, APPLY[0], &params, |id, _, _| { order.push(id); Ok(None) }).unwrap();
    assert_eq!(order, vec![f.active, f.other, f.embedded]);
    let after = f.engine.active().unwrap().doc.clone();
    for (id, x, y) in [(f.active, 2, 1), (f.other, 8, 1), (f.embedded, 2, 6)] {
        let original = smart(&before, id);
        let object = smart(&after, id);
        assert_eq!(object.source, original.source);
        assert_eq!(object.psd_raw, original.psd_raw);
        assert_eq!(object.smart_filters, original.smart_filters);
        assert_eq!(after.layer(id).unwrap().psd_blocks, before.layer(id).unwrap().psd_blocks);
        assert_eq!(object.cache.as_ref().unwrap().pixel(x + DX, y + DY), original.cache.as_ref().unwrap().pixel(x, y));
        assert_eq!(object.cache.as_ref().unwrap().pixel(x, y), vec![0.; 4]);
        let filter_mask = &object.filter_mask.as_ref().unwrap().surface;
        let old_filter_mask = &original.filter_mask.as_ref().unwrap().surface;
        assert_eq!(filter_mask.pixel(x + DX, y + DY), old_filter_mask.pixel(x, y));
        assert_eq!(filter_mask.pixel(x, y), old_filter_mask.default_pixel());
        let layer_mask = &after.layer(id).unwrap().mask.as_ref().unwrap().surface;
        let old_layer_mask = &before.layer(id).unwrap().mask.as_ref().unwrap().surface;
        assert_eq!(layer_mask.pixel(x + DX, y + DY), old_layer_mask.pixel(x, y));
        assert_eq!(layer_mask.pixel(x, y), old_layer_mask.default_pixel());
    }
    assert_eq!(after.metadata, before.metadata);
    assert_eq!(after.channels, before.channels);
    assert_eq!(after.quick_mask, before.quick_mask);
    f.engine.execute("edit.undo", json!({})).unwrap();
    assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc, &before));
    f.engine.execute("edit.redo", json!({})).unwrap();
    assert_eq!(f.engine.active().unwrap().doc, after);
    assert_eq!(order.len(), 3);
}

#[test]
fn warp_gray_apply_late_source_failure_and_panic_leave_owner_and_pins_unchanged() {
    for panic in [false, true] {
        let mut f = fixture(16, "png");
        f.engine.edit("Atomic group gray Warp", |doc, active| {
            let first = doc.remove(f.active).unwrap();
            doc.layer_mut(f.group).unwrap().children_mut().unwrap().insert(0, first);
            *active = Some(f.group);
            for id in [f.active, f.other, f.embedded] { doc.layer_mut(id).unwrap().mask.as_mut().unwrap().linked = true; }
            Ok(())
        }).unwrap();
        normalize(&mut f.engine);
        let before = twin(&f.engine);
        let mut order = Vec::new();
        let mut pins: Vec<Weak<Vec<u8>>> = Vec::new();
        let error = run_with(&mut f.engine, APPLY[0], &translated([0, 0, 16, 12], 3.0, 2.0, "nearest"), |id, metadata, object| {
            order.push(id);
            if order.len() == 2 {
                assert!(pins.iter().all(|pin| pin.upgrade().is_none()));
                if panic { panic!("Injected gray Warp resolver panic"); }
                return Err("Injected late gray Warp source refusal".into());
            }
            let (name, bytes) = checked(id, metadata, object)?.unwrap();
            let bytes = Arc::new((*bytes).clone());
            pins.push(Arc::downgrade(&bytes));
            Ok(Some((name, bytes)))
        }).unwrap_err();
        assert!(if panic { error.contains("internal error") } else { error.contains("Injected late gray Warp") });
        assert_eq!(order, vec![f.active, f.other]);
        assert!(pins.iter().all(|pin| pin.upgrade().is_none()));
        unchanged(&f.engine, &before);
    }
}

#[test]
fn warp_gray_apply_coalescing_and_success_only_owner_preset_store_match_native() {
    use photocraft_engine::preset_store::{open, MemBackend};
    let mut f = fixture(16, "png");
    let mut native = twin(&f.engine);
    let actual_store = MemBackend::default();
    let native_store = MemBackend::default();
    f.engine.attach_preset_store(open(Box::new(actual_store.clone())));
    native.attach_preset_store(open(Box::new(native_store.clone())));
    let mut preset = f.engine.tools.presets[0].clone();
    preset.name = "Gray Warp owner pending preset".into();
    preset.group = "Gray Warp".into();
    preset.builtin = false;
    for engine in [&mut f.engine, &mut native] {
        engine.tools.presets.push(preset.clone());
        engine.brush_presets_changed();
    }
    let files = actual_store.files.lock().unwrap().clone();
    let before = twin(&f.engine);
    let doc = f.engine.active().unwrap().doc.clone();
    let past = f.engine.active().unwrap().history.past_len();
    let fade = f.engine.edit_state.fade.clone();
    let mut params = translated([0, 0, 16, 12], 1.0, 1.0, "nearest");
    params["coalesce"] = json!("gray-warp-group");
    assert!(run_with(&mut f.engine, APPLY[0], &params, |_, _, _| Err("Gray Warp refusal".into())).unwrap_err().contains("Gray Warp refusal"));
    unchanged(&f.engine, &before);
    assert_eq!(*actual_store.files.lock().unwrap(), files);
    for command in APPLY {
        assert_eq!(run_with(&mut f.engine, command, &params, checked).unwrap(), native.execute(command, params.clone()).unwrap());
        same(&f.engine, &native);
        assert_eq!(f.engine.active().unwrap().history.past_len(), past + 1);
        assert_eq!(f.engine.active().unwrap().history.undo_label(), Some("Warp"));
        assert_eq!(f.engine.edit_state.fade, fade);
    }
    assert_ne!(*actual_store.files.lock().unwrap(), files);
    assert_eq!(*actual_store.files.lock().unwrap(), *native_store.files.lock().unwrap());
    assert!(open(Box::new(actual_store)).presets.iter().any(|entry| entry.name == "Gray Warp owner pending preset"));
    assert_undo_redo(&mut f.engine, &mut native, &doc);
}

#[test]
fn warp_gray_apply_far_immutable_publication_reopen_and_cached_redo_preserve_old_versions() {
    use super::super::super::super::{bundle, publish, restore_with_settings, save_view, PhotoSession, MAX_INPUT_BYTES};
    for command in APPLY {
        for depth in [8, 16, 32] {
            for group in [false, true] {
                let mut f = fixture(depth, "psb");
                let target = if group {
                    f.engine.edit("Published far gray group", |doc, _| {
                        for id in [f.other, f.embedded] { doc.layer_mut(id).unwrap().mask.as_mut().unwrap().linked = true; }
                        Ok(())
                    }).unwrap();
                    normalize(&mut f.engine);
                    f.group
                } else {
                    let (mut engine, id, _) = raster(depth, 1.0);
                    if command == APPLY[1] { enable_smart_alias(&mut engine); }
                    f.engine = engine;
                    id
                };
                f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Color(1);
                f.engine.execute("channel.setVisible", json!({"channel":"composite","visible":true})).unwrap();
                f.engine.execute("channel.setVisible", json!({"channel":0,"visible":false})).unwrap();
                let before = f.engine.active().unwrap().doc.clone();
                let labels = f.engine.active().unwrap().history.entries();
                let fade = f.engine.edit_state.fade.clone();
                let context = f.engine.active().unwrap().channel_view.clone();
                let mut params = translated([0, 0, 16, 12], 750_000.0, -750_000.0, "nearest");
                params["layer"] = json!(target.0);
                let journal = f.engine.journal.len();
                let result = super::super::tests::host(&mut f.engine, command, params.clone()).unwrap();
                assert_eq!(result["changed"], json!(true));
                assert_eq!(result["layer"], json!(target.0));
                assert_eq!(f.engine.journal.len(), journal + 1);
                assert_eq!(f.engine.journal.last(), Some(&(command.into(), params)));
                assert_eq!(f.engine.edit_state.fade, fade);
                let after = f.engine.active().unwrap().doc.clone();
                assert_eq!(after.metadata, before.metadata);
                assert_eq!(after.channels, before.channels);
                assert_eq!(after.quick_mask, before.quick_mask);
                let after_selection = after.selection.as_ref().unwrap();
                let old_selection = before.selection.as_ref().unwrap();
                assert_eq!(after_selection.pixel(750_002, -749_999), old_selection.pixel(2, 1));
                assert_eq!(after_selection.pixel(2, 1), old_selection.default_pixel());
                if group {
                    for id in [f.active, f.other, f.embedded] {
                        assert_eq!(smart(&after, id).source, smart(&before, id).source);
                        assert_eq!(smart(&after, id).psd_raw, smart(&before, id).psd_raw);
                        assert_eq!(after.layer(id).unwrap().psd_blocks, before.layer(id).unwrap().psd_blocks);
                    }
                    let moved = smart(&after, f.other).cache.as_ref().unwrap();
                    let tolerance = match moved.format().sample { SampleType::U8 => 1.0 / 255.0, SampleType::U16 => 2.0 / 65535.0, SampleType::F32 => 1e-6 };
                    // Native Offset processes the document canvas; off-canvas
                    // placed pixels retain the unfiltered source appearance.
                    for (x, expected) in [(750_008, [1., 0., 0.]), (750_009, [0., 1., 0.])] {
                        let pixel = moved.pixel(x, -749_999);
                        for channel in 0..3 { assert!((pixel[channel] - expected[channel]).abs() <= tolerance); }
                        assert_eq!(pixel[3], 1.0);
                    }
                } else {
                    let moved = after.layer(target).unwrap().surface().unwrap();
                    let sample = moved.format().sample;
                    let k = old_selection.sample_channel(2, 1, 0);
                    assert_eq!(moved.pixel(750_002, -749_999), vec![1., 0., 0., encoded_gray(sample, k)]);
                    assert_eq!(moved.pixel(2, 1), vec![1., 0., 0., encoded_gray(sample, 1.0 - k)]);
                }
                let mut session = PhotoSession { engine: f.engine, color_settings: None, version: String::new(), original_path: None, writer: Default::default() };
                let photo = ulid::Ulid::new().to_string();
                publish(&f.directory.0, &photo, &mut session).unwrap();
                let immutable_file = f.directory.0.join(format!("{}.pcraft", session.version));
                let immutable = bundle::portable_bytes(&immutable_file, MAX_INPUT_BYTES as usize).unwrap();
                std::fs::remove_file(&f.path).unwrap();
                session.engine.execute("edit.undo", json!({})).unwrap();
                assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc, &before));
                publish(&f.directory.0, &photo, &mut session).unwrap();
                save_view(&f.directory.0, &session).unwrap();
                let mut reopened = restore_with_settings(&f.directory.0, &session.version, None, false).unwrap();
                assert_eq!(reopened.engine.active().unwrap().doc, before);
                assert_eq!(reopened.engine.active().unwrap().history.entries(), labels);
                assert!(reopened.engine.active().unwrap().history.can_redo());
                assert_eq!(reopened.engine.active().unwrap().channel_view, context);
                reopened.engine.execute("edit.redo", json!({})).unwrap();
                assert_eq!(reopened.engine.active().unwrap().doc, after);
                reopened.engine.execute("edit.undo", json!({})).unwrap();
                assert_eq!(reopened.engine.active().unwrap().doc, before);
                assert_eq!(bundle::portable_bytes(&immutable_file, MAX_INPUT_BYTES as usize).unwrap(), immutable);
            }
        }
    }
}
