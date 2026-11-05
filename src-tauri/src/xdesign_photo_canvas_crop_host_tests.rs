use super::tests::{fixture, host, normalize, same, smart, twin, unchanged};
use photocraft_engine::{preset_store::{open, MemBackend}, Session};
use serde_json::json;
use std::sync::Arc;

const CANVAS: &str = "image.canvasSize";
const CROP: &str = "image.crop";

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("xdesign-canvas-host-{}", ulid::Ulid::new()));
        std::fs::create_dir(&path).unwrap(); Self(path)
    }
}
impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

fn pending(engine: &mut Session, name: &str) -> MemBackend {
    let storage = MemBackend::default();
    engine.attach_preset_store(open(Box::new(storage.clone())));
    let mut preset = engine.tools.presets[0].clone();
    preset.name = name.into(); preset.group = "Canvas owner".into(); preset.builtin = false;
    engine.tools.presets.push(preset); engine.brush_presets_changed(); storage
}

fn explicit_view(engine: &mut Session) {
    engine.execute("channel.setVisible", json!({"channel":"composite","visible":true})).unwrap();
    for index in 0..engine.active().unwrap().doc.channels.len() {
        engine.execute("channel.setVisible", json!({"channel":index,"visible":false})).unwrap();
    }
}

#[test]
fn canvas_crop_host_real_dispatch_preserves_immutable_reopen_and_undo_redo_without_smart_reads() {
    use super::super::super::{bundle, publish, restore_with_settings, save_view, PhotoSession, MAX_INPUT_BYTES};
    for depth in [8, 16, 32] {
        for (command, delete) in [(CANVAS, false), (CROP, false), (CROP, true)] {
            let mut f = fixture(depth, "rgb");
            explicit_view(&mut f.engine);
            let before = f.engine.active().unwrap().doc.clone();
            let before_labels = f.engine.active().unwrap().history.entries();
            let before_view = f.engine.active().unwrap().channel_view.clone();
            let revision = f.engine.active().unwrap().revision;
            let past = f.engine.active().unwrap().history.past_len();
            let journal = f.engine.journal.len();
            let fade = f.engine.edit_state.fade.clone();
            let mut native = twin(&f.engine);
            let params = if command == CANVAS {
                json!({"relative":true,"width":5.5,"height":-2.5,"anchor":"bottomRight","extensionColor":"foreground","vendor":{"retain":true}})
            } else {
                json!({"x":-1.4,"y":1.49,"width":12.49,"height":9.51,"deleteCroppedPixels":delete,"vendor":{"retain":true}})
            };
            let actual = host(&mut f.engine, command, params.clone()).unwrap();
            let expected = native.execute(command, params.clone()).unwrap();
            assert_eq!(actual, expected); same(&f.engine, &native);
            let after = f.engine.active().unwrap().doc.clone();
            assert_eq!(f.engine.active().unwrap().revision, revision + 1);
            assert_eq!(f.engine.active().unwrap().history.past_len(), past + 1);
            assert_eq!(f.engine.journal.len(), journal + 1);
            assert_eq!(f.engine.journal.last(), Some(&(command.into(), params)));
            assert_eq!(f.engine.edit_state.fade, fade);
            for id in [f.smart, f.embedded] {
                assert_eq!(smart(&after, id).source, smart(&before, id).source);
                assert_eq!(smart(&after, id).psd_raw, smart(&before, id).psd_raw);
                assert_eq!(smart(&after, id).filter_mask, smart(&before, id).filter_mask);
                assert_eq!(after.layer(id).unwrap().psd_blocks, before.layer(id).unwrap().psd_blocks);
            }
            let directory = Directory::new();
            let mut session = PhotoSession { engine:f.engine, color_settings:None, version:String::new(), original_path:None, writer:Default::default() };
            let photo = ulid::Ulid::new().to_string();
            publish(&directory.0, &photo, &mut session).unwrap();
            let old_file = directory.0.join(format!("{}.pcraft", session.version));
            let old_bytes = bundle::portable_bytes(&old_file, MAX_INPUT_BYTES as usize).unwrap();
            session.engine.execute("edit.undo", json!({})).unwrap();
            native.execute("edit.undo", json!({})).unwrap(); same(&session.engine, &native);
            assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc, &before));
            publish(&directory.0, &photo, &mut session).unwrap(); save_view(&directory.0, &session).unwrap();
            let mut reopened = restore_with_settings(&directory.0, &session.version, None, false).unwrap();
            assert_eq!(reopened.engine.active().unwrap().doc, before);
            assert_eq!(reopened.engine.active().unwrap().history.entries(), before_labels);
            assert_eq!(reopened.engine.active().unwrap().channel_view, before_view);
            assert!(reopened.engine.active().unwrap().history.can_redo());
            reopened.engine.execute("edit.redo", json!({})).unwrap();
            assert_eq!(reopened.engine.active().unwrap().doc, after);
            assert_eq!(bundle::portable_bytes(&old_file, MAX_INPUT_BYTES as usize).unwrap(), old_bytes);
        }
    }
}

#[test]
fn canvas_crop_host_zero_offset_edits_keep_native_coalescing_history_journal_and_real_presets() {
    for command in [CANVAS, CROP] {
        let mut f = fixture(16, "rgb"); normalize(&mut f.engine);
        let mut native = twin(&f.engine);
        let storage = pending(&mut f.engine, "Canvas owner success");
        let native_storage = pending(&mut native, "Canvas owner success");
        let files = storage.files.lock().unwrap().clone();
        let past = f.engine.active().unwrap().history.past_len();
        let revision = f.engine.active().unwrap().revision;
        let before = f.engine.active().unwrap().doc.clone();
        let size = before.size;
        let params = if command == CANVAS {
            json!({"width":size.width,"height":size.height,"extensionColor":"transparent","coalesce":"canvas-zero-offset"})
        } else {
            json!({"x":0,"y":0,"width":size.width,"height":size.height,"deleteCroppedPixels":false,"coalesce":"canvas-zero-offset"})
        };
        for index in 1..=2 {
            assert_eq!(host(&mut f.engine, command, params.clone()).unwrap(), native.execute(command, params.clone()).unwrap());
            same(&f.engine, &native);
            assert_eq!(f.engine.active().unwrap().history.past_len(), past + 1);
            assert_eq!(f.engine.active().unwrap().revision, revision + index);
            assert_eq!(f.engine.journal.last(), Some(&(command.into(), params.clone())));
        }
        assert_ne!(*storage.files.lock().unwrap(), files);
        assert_eq!(*storage.files.lock().unwrap(), *native_storage.files.lock().unwrap());
        assert!(open(Box::new(storage)).presets.iter().any(|preset| preset.name == "Canvas owner success"));
        f.engine.execute("edit.undo", json!({})).unwrap();
        native.execute("edit.undo", json!({})).unwrap(); same(&f.engine, &native);
        assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc, &before));
    }
}

#[test]
fn canvas_crop_host_refusal_keeps_pending_presets_journal_and_published_version_bytes() {
    use super::super::super::{bundle, publish, PhotoSession, MAX_INPUT_BYTES};
    let mut f = fixture(8, "rgb");
    f.engine.edit("Clear crop fixture selection", |doc, _| { doc.selection = None; Ok(()) }).unwrap();
    normalize(&mut f.engine);
    let directory = Directory::new();
    let mut session = PhotoSession { engine:f.engine, color_settings:None, version:String::new(), original_path:None, writer:Default::default() };
    publish(&directory.0, &ulid::Ulid::new().to_string(), &mut session).unwrap();
    let version = session.version.clone();
    let file = directory.0.join(format!("{version}.pcraft"));
    let bytes = bundle::portable_bytes(&file, MAX_INPUT_BYTES as usize).unwrap();
    let storage = pending(&mut session.engine, "Refused canvas must not flush");
    let files = storage.files.lock().unwrap().clone();
    let before = twin(&session.engine);
    for (command, params) in [(CROP, json!({"x":0,"y":0,"width":0,"height":1})), (CANVAS, json!({"width":300000,"height":300000}))] {
        assert!(host(&mut session.engine, command, params).is_err());
        unchanged(&session.engine, &before);
        assert_eq!(*storage.files.lock().unwrap(), files);
        assert_eq!(session.version, version);
        assert_eq!(bundle::portable_bytes(&file, MAX_INPUT_BYTES as usize).unwrap(), bytes);
    }
}
