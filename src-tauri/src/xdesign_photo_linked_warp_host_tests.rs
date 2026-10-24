use super::*;
use super::tests::{fixture, host, same, smart, stored, translated, twin, unchanged, APPLY, MESH};

fn parameters(command: &str) -> Value {
    if APPLY.contains(&command) { translated() }
    else if command == MESH[4] { json!({"size":3}) }
    else { json!({}) }
}

fn prepare(engine: &mut Session, id: LayerId, command: &str) {
    if MESH.contains(&command) {
        stored(engine, id);
        if command == MESH[3] { host(engine, MESH[0], json!({})).unwrap(); }
    }
}

fn retained_source(engine: &Session, before: &Document, id: LayerId) {
    let doc = &engine.active().unwrap().doc;
    let actual = smart(doc, id); let original = smart(before, id);
    assert_eq!(actual.source, original.source);
    assert_eq!(actual.psd_raw, original.psd_raw);
    assert_eq!(doc.layer(id).unwrap().psd_blocks, before.layer(id).unwrap().psd_blocks);
    assert_eq!(doc.metadata, before.metadata);
}

#[test]
fn linked_warp_host_all_seven_commands_three_depths_publish_immutable_history_and_reopen_cached_redo() {
    for depth in [8, 16, 32] {
        for command in APPLY.into_iter().chain(MESH) {
            let mut f = fixture(depth, "psb");
            prepare(&mut f.engine, f.active, command);
            f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Color(1);
            let before = f.engine.active().unwrap().doc.clone();
            let labels = f.engine.active().unwrap().history.entries();
            let mut native = twin(&f.engine);
            let params = parameters(command);
            assert_eq!(host(&mut f.engine, command, params.clone()).unwrap(), native.execute(command, params).unwrap());
            same(&f.engine, &native); retained_source(&f.engine, &before, f.active);
            let after = f.engine.active().unwrap().doc.clone();
            let mut session = super::super::super::PhotoSession { engine:f.engine, color_settings:None, version:String::new(), original_path:None, writer:Default::default() };
            let photo = ulid::Ulid::new().to_string();
            super::super::super::publish(&f.directory.0, &photo, &mut session).unwrap();
            let immutable_file = f.directory.0.join(format!("{}.pcraft", session.version));
            let immutable = super::super::super::bundle::portable_bytes(&immutable_file, super::super::super::MAX_INPUT_BYTES as usize).unwrap();
            std::fs::remove_file(&f.path).unwrap();
            session.engine.execute("edit.undo", json!({})).unwrap();
            super::super::super::publish(&f.directory.0, &photo, &mut session).unwrap();
            super::super::super::save_view(&f.directory.0, &session).unwrap();
            let mut reopened = super::super::super::restore_with_settings(&f.directory.0, &session.version, None, false).unwrap();
            let state = reopened.engine.active().unwrap();
            assert_eq!(state.doc, before); assert_eq!(state.history.entries(), labels); assert!(state.history.can_redo());
            assert_eq!(state.channel_view.target, photocraft_engine::channel_cmds::ChannelTarget::Color(1));
            reopened.engine.execute("edit.redo", json!({})).unwrap();
            assert_eq!(reopened.engine.active().unwrap().doc, after);
            retained_source(&reopened.engine, &before, f.active);
            reopened.engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(reopened.engine.active().unwrap().doc, before);
            assert_eq!(super::super::super::bundle::portable_bytes(&immutable_file, super::super::super::MAX_INPUT_BYTES as usize).unwrap(), immutable);
        }
    }
}

#[test]
fn linked_warp_host_mixed_apply_and_mesh_coalesce_native_first_label_views_and_older_fade() {
    for view in ["alpha", "color", "quickMask", "mask"] {
        let mut f = fixture(16, "pcraft");
        match view {
            "color" => f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Color(1),
            "quickMask" => f.engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Composite,
            "mask" => { f.engine.execute("view.layerMask", json!({"mode":"gray"})).unwrap(); },
            _ => {}
        }
        let before = f.engine.active().unwrap().doc.clone();
        let past = f.engine.active().unwrap().history.past_len();
        let journal = f.engine.journal.len();
        let fade = f.engine.edit_state.fade.clone();
        let mut native = twin(&f.engine);
        for command in [APPLY[0], MESH[4], MESH[0], MESH[3]] {
            let mut params = parameters(command); params["coalesce"] = json!("mixed-warp");
            assert_eq!(host(&mut f.engine, command, params.clone()).unwrap(), native.execute(command, params).unwrap());
            same(&f.engine, &native);
            assert_eq!(f.engine.active().unwrap().history.past_len(), past + 1);
            assert_eq!(f.engine.active().unwrap().history.undo_label(), Some("Warp"));
            assert_eq!(f.engine.edit_state.fade, fade);
            retained_source(&f.engine, &before, f.active);
        }
        assert_eq!(f.engine.journal.len(), journal + 4);
        let after = f.engine.active().unwrap().doc.clone();
        f.engine.execute("edit.undo", json!({})).unwrap(); native.execute("edit.undo", json!({})).unwrap();
        same(&f.engine, &native); assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc, &before));
        f.engine.execute("edit.redo", json!({})).unwrap(); native.execute("edit.redo", json!({})).unwrap();
        same(&f.engine, &native); assert_eq!(f.engine.active().unwrap().doc, after);
    }
}

#[test]
fn linked_warp_host_pending_preset_store_flushes_only_after_successful_apply_or_stored_edit() {
    use photocraft_engine::preset_store::{open, MemBackend};
    for command in [APPLY[0], MESH[4]] {
        let mut f = fixture(16, "psd"); prepare(&mut f.engine, f.active, command);
        let mut native = twin(&f.engine);
        let actual = MemBackend::default(); let expected = MemBackend::default();
        f.engine.attach_preset_store(open(Box::new(actual.clone()))); native.attach_preset_store(open(Box::new(expected.clone())));
        for engine in [&mut f.engine, &mut native] {
            let mut preset = engine.tools.presets[0].clone();
            preset.name = "Pending Warp owner brush".into(); preset.group = "Warp owner".into(); preset.builtin = false;
            engine.tools.presets.push(preset); engine.brush_presets_changed();
        }
        let files = actual.files.lock().unwrap().clone(); let before = twin(&f.engine); let params = parameters(command);
        let refusal = if command == APPLY[0] {
            run_with(&mut f.engine, command, &params, |_,_,_| Err("Injected Warp source refusal".into()))
        } else {
            mesh::run_with(&mut f.engine, command, &params, |_,_| Err("Injected Warp source refusal".into()))
        };
        assert!(refusal.unwrap_err().contains("Injected Warp source refusal"));
        unchanged(&f.engine, &before); assert_eq!(*actual.files.lock().unwrap(), files);
        assert_eq!(host(&mut f.engine, command, params.clone()).unwrap(), native.execute(command, params).unwrap());
        same(&f.engine, &native);
        let after = actual.files.lock().unwrap().clone(); assert_ne!(after, files); assert_eq!(after, *expected.files.lock().unwrap());
        assert!(open(Box::new(actual)).presets.iter().any(|preset| preset.name == "Pending Warp owner brush"));
    }
}
