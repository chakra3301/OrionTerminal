use super::*;
use photocraft_engine::doc::{Document, Layer, LayerId, Rect};
use super::tests::{fixture, host, same, smart, twin, unchanged};
use std::{io::Read, sync::{Arc, Weak}};

const MEAN: &str = "layer.smartObjects.stackMode.mean";
const MAXIMUM: &str = "layer.smartObjects.stackMode.maximum";
const MINIMUM: &str = "layer.smartObjects.stackMode.minimum";

fn source_bytes(red: f32, blue: f32) -> Vec<u8> {
    let mut source = Session::new();
    source.execute("file.new", json!({"width":2,"height":2,"depth":8})).unwrap();
    source.edit("Independent two-frame source", |doc, active| {
        let mut first = Layer::raster("Red frame", doc.pixel_format());
        first.surface_mut().unwrap().fill_rect(Rect::new(0, 0, 2, 2), &[red, 0., 0., 1.]);
        let mut second = Layer::raster("Blue frame", doc.pixel_format());
        second.surface_mut().unwrap().fill_rect(Rect::new(0, 0, 2, 2), &[0., 0., blue, 1.]);
        *active = Some(second.id); doc.layers = vec![first, second]; Ok(())
    }).unwrap();
    photocraft_engine::smart_cmds::encode_source(&source.active().unwrap().doc).unwrap()
}

fn preserved(engine: &Session, before: &Document, id: LayerId) {
    let after = &engine.active().unwrap().doc; let a = smart(after, id); let b = smart(before, id);
    let mut retained = a.clone(); retained.stack_mode = b.stack_mode; retained.cache = b.cache.clone(); assert_eq!(&retained, b);
    assert_eq!(a.source, b.source); assert_eq!(a.psd_raw, b.psd_raw); assert_eq!(a.smart_filters, b.smart_filters); assert_eq!(a.filter_mask, b.filter_mask);
    assert_eq!(after.layer(id).unwrap().psd_blocks, before.layer(id).unwrap().psd_blocks); assert_eq!(after.layer(id).unwrap().mask, before.layer(id).unwrap().mask); assert_eq!(after.metadata, before.metadata);
    assert_eq!(after.channels, before.channels); assert_eq!(after.quick_mask, before.quick_mask); assert_eq!(after.selection, before.selection);
}

#[test]
fn linked_stack_host_immutable_publication_reopens_native_history_with_cached_redo_and_source_identity() {
    for depth in [8, 16, 32] { for embedded in [false, true] {
        let mut f = fixture(depth, "pcraft"); let id = if embedded { f.embedded } else { f.active };
        f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Color(1);
        let before = f.engine.active().unwrap().doc.clone(); let labels = f.engine.active().unwrap().history.entries();
        let fade = f.engine.edit_state.fade.clone(); let mut native = twin(&f.engine);
        let params = json!({"layer":id.0,"target":"quickMask","vendor":{"keep":[false,7]}});
        assert_eq!(host(&mut f.engine, MEAN, params.clone()).unwrap(), native.execute(MEAN, params).unwrap()); same(&f.engine, &native);
        preserved(&f.engine, &before, id); assert_eq!(f.engine.active().unwrap().doc.layer(f.other), before.layer(f.other)); assert_eq!(f.engine.edit_state.fade, fade);
        let after = f.engine.active().unwrap().doc.clone(); assert_ne!(smart(&after, id).cache, smart(&before, id).cache);
        let mut session = super::super::super::PhotoSession { engine:f.engine, color_settings:None, version:String::new(), original_path:None, writer:Default::default() };
        let photo = ulid::Ulid::new().to_string(); super::super::super::publish(&f.directory.0, &photo, &mut session).unwrap();
        let saved = f.directory.0.join(format!("{}.pcraft", session.version));
        let original_bytes = super::super::super::bundle::portable_bytes(&saved, super::super::super::MAX_INPUT_BYTES as usize).unwrap();
        assert_eq!(std::fs::read(&f.path).unwrap(), f.bytes); std::fs::remove_file(&f.path).unwrap();
        session.engine.execute("edit.undo", json!({})).unwrap(); assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc, &before));
        super::super::super::publish(&f.directory.0, &photo, &mut session).unwrap(); super::super::super::save_view(&f.directory.0, &session).unwrap();
        let mut reopened = super::super::super::restore_with_settings(&f.directory.0, &session.version, None, false).unwrap();
        let state = reopened.engine.active().unwrap(); assert_eq!(state.doc, before); assert_eq!(state.history.entries(), labels); assert!(state.history.can_redo());
        assert_eq!(state.channel_view.target, photocraft_engine::channel_cmds::ChannelTarget::Color(1));
        reopened.engine.execute("edit.redo", json!({})).unwrap(); assert_eq!(reopened.engine.active().unwrap().doc, after); preserved(&reopened.engine, &before, id);
        reopened.engine.execute("edit.undo", json!({})).unwrap(); assert_eq!(reopened.engine.active().unwrap().doc, before);
        assert_eq!(original_bytes, super::super::super::bundle::portable_bytes(&saved, super::super::super::MAX_INPUT_BYTES as usize).unwrap());
    } }
}

#[test]
fn linked_stack_host_mixed_modes_coalesce_first_label_keep_older_fade_and_exact_native_context() {
    for view in ["color", "alpha", "quickMask", "mask"] {
        let mut f = fixture(16, "pcraft");
        match view {
            "alpha" => f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Alpha(0),
            "quickMask" => f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Composite,
            "mask" => { host(&mut f.engine, "view.layerMask", json!({"mode":"gray","layer":f.active.0})).unwrap(); },
            _ => f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Color(1),
        }
        let before = f.engine.active().unwrap().doc.clone(); let fade = f.engine.edit_state.fade.clone();
        let past = f.engine.active().unwrap().history.past_len(); let journal = f.engine.journal.len(); let mut native = twin(&f.engine);
        for command in [MAXIMUM, MINIMUM] {
            let params = json!({"coalesce":"stack-host-gesture","layer":f.active.0,"target":{"channel":0}});
            assert_eq!(host(&mut f.engine, command, params.clone()).unwrap(), native.execute(command, params).unwrap()); same(&f.engine, &native);
        }
        assert_eq!(f.engine.active().unwrap().history.past_len(), past + 1); assert_eq!(f.engine.active().unwrap().history.undo_label(), Some("Stack Mode: Maximum"));
        assert_eq!(f.engine.journal.len(), journal + 2); assert_eq!(f.engine.edit_state.fade, fade); preserved(&f.engine, &before, f.active);
        let after = f.engine.active().unwrap().doc.clone();
        f.engine.execute("edit.undo", json!({})).unwrap(); native.execute("edit.undo", json!({})).unwrap(); same(&f.engine, &native); assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc, &before));
        f.engine.execute("edit.redo", json!({})).unwrap(); native.execute("edit.redo", json!({})).unwrap(); same(&f.engine, &native); assert_eq!(f.engine.active().unwrap().doc, after);
    }
}

#[test]
fn linked_stack_host_owner_pending_preset_store_flushes_only_after_a_successful_checked_commit() {
    use photocraft_engine::preset_store::{open, MemBackend};
    let mut f = fixture(16, "pcraft"); let mut native = twin(&f.engine); let actual_store = MemBackend::default(); let native_store = MemBackend::default();
    f.engine.attach_preset_store(open(Box::new(actual_store.clone()))); native.attach_preset_store(open(Box::new(native_store.clone())));
    for owner in [&mut f.engine, &mut native] {
        let mut preset = owner.tools.presets[0].clone(); preset.name = "Pending stack owner brush".into(); preset.group = "Stack owner".into(); preset.builtin = false;
        owner.tools.presets.push(preset); owner.brush_presets_changed();
    }
    let files = actual_store.files.lock().unwrap().clone(); let before = twin(&f.engine);
    let error = run_with(&mut f.engine, MEAN, &json!({}), |_, _| Err("Injected stack source refusal".into())).unwrap_err();
    assert!(error.contains("Injected stack source refusal")); unchanged(&f.engine, &before); assert_eq!(*actual_store.files.lock().unwrap(), files);
    std::fs::write(&f.path, b"invalid stack source bytes").unwrap();
    assert_eq!(host(&mut f.engine, MEAN, json!({})).unwrap_err(), native.execute(MEAN, json!({})).unwrap_err().to_string());
    unchanged(&f.engine, &before); assert_eq!(*actual_store.files.lock().unwrap(), files); assert_eq!(*native_store.files.lock().unwrap(), files);
    std::fs::write(&f.path, &f.bytes).unwrap();
    assert_eq!(host(&mut f.engine, MEAN, json!({})).unwrap(), native.execute(MEAN, json!({})).unwrap()); same(&f.engine, &native);
    assert_ne!(*actual_store.files.lock().unwrap(), files); assert_eq!(*actual_store.files.lock().unwrap(), *native_store.files.lock().unwrap());
    assert!(open(Box::new(actual_store)).presets.iter().any(|preset| preset.name == "Pending stack owner brush"));
}

#[test]
fn linked_stack_host_resolves_one_source_decision_and_retires_each_private_encoded_pin() {
    let mut f = fixture(32, "pcraft"); let original = f.engine.active().unwrap().doc.clone();
    let mut weak: Option<Weak<Vec<u8>>> = None;
    for (command, red, blue) in [(MEAN, 1., 0.), (MAXIMUM, 0., 1.)] {
        let mut reads = 0;
        run_with(&mut f.engine, command, &json!({"layer":f.active.0}), |meta, target| {
            reads += 1; assert_eq!(meta, &original.metadata); assert_eq!(target.source, smart(&original, f.active).source);
            if let Some(previous) = &weak { assert!(previous.upgrade().is_none()); }
            let bytes = Arc::new(source_bytes(red, blue)); weak = Some(Arc::downgrade(&bytes));
            std::fs::write(&f.path, b"disk changes after the source decision").unwrap();
            Ok(Some(("pinned.pcraft".into(), bytes)))
        }).unwrap();
        assert_eq!(reads, 1); assert!(weak.as_ref().unwrap().upgrade().is_none()); preserved(&f.engine, &original, f.active);
        let cache = smart(&f.engine.active().unwrap().doc, f.active).cache.as_ref().unwrap();
        let expected = if command == MEAN { [0.5, 0., 0., 1.] } else { [0., 0., 1., 1.] };
        for y in 0..6 { for x in 0..7 { let actual = cache.pixel(x, y); let want = if (3..5).contains(&x) && (1..3).contains(&y) { expected } else { [0.;4] }; for channel in 0..4 { assert!((actual[channel] - want[channel]).abs() <= 1e-6, "{command}/{x},{y}/{channel}: {} != {}", actual[channel], want[channel]); } assert_eq!(actual[3], want[3]); } }
    }
}

#[test]
fn linked_stack_host_resolver_panics_and_bounded_growth_preserve_owner_arc_history_and_context() {
    for panic in [false, true] {
        let mut f = fixture(16, "pcraft"); let before = twin(&f.engine); let mut calls = 0;
        let error = run_with(&mut f.engine, MEAN, &json!({"coalesce":"stack-refusal"}), |_, _| {
            calls += 1; if panic { panic!("Injected stack source panic"); }
            struct Growing(usize); impl Read for Growing { fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> { self.0 += out.len(); out.fill(7); Ok(out.len()) } }
            let mut reader = Growing(0); let result = super::super::super::smart::replay_read_with_limit(&mut reader, 32); assert_eq!(reader.0, 33);
            result.map(|bytes| Some(("growing.pcraft".into(), Arc::new(bytes))))
        }).unwrap_err();
        assert_eq!(calls, 1); if panic { assert!(error.contains(MEAN)); assert!(error.contains("internal error")); } else { assert!(error.contains("512MB")); }
        unchanged(&f.engine, &before);
    }
}
