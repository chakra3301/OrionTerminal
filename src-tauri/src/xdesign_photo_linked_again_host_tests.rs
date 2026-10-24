use super::run_with;
use super::tests::{checked, fixture, host, normalize, paired_ids, same, smart, twin, unchanged};
use photocraft_engine::{preset_store::{open, MemBackend}, Session};
use serde_json::json;
use std::sync::{Arc, Weak};

const AGAIN: &str = "edit.transform.again";
const COPY: &str = "edit.transform.againCopy";

fn recipe(engine: &mut Session) {
    engine.journal.push(("edit.transform".into(), json!({"matrix":[1,0,0,1,3,2],"interpolation":"nearest"})));
}

fn pending(engine: &mut Session, name: &str) -> MemBackend {
    let storage = MemBackend::default();
    engine.attach_preset_store(open(Box::new(storage.clone())));
    let mut preset = engine.tools.presets[0].clone();
    preset.name = name.into(); preset.group = "Again owner".into(); preset.builtin = false;
    engine.tools.presets.push(preset); engine.brush_presets_changed();
    storage
}

#[test]
fn linked_again_host_real_dispatch_preserves_native_compound_history_and_immutable_reopen() {
    use super::super::super::{bundle, publish, restore_with_settings, save_view, PhotoSession, MAX_INPUT_BYTES};
    for command in [AGAIN, COPY] {
        for depth in [8,16,32] {
            for embedded in [false,true] {
                let mut f = fixture(depth,"psb");
                let id = if embedded { f.embedded } else { f.active };
                if embedded {
                    f.engine.edit("Choose embedded Again target",|_,active| { *active=Some(id); Ok(()) }).unwrap();
                    normalize(&mut f.engine);
                }
                f.engine.execute("channel.setVisible",json!({"channel":"composite","visible":true})).unwrap();
                f.engine.execute("channel.setVisible",json!({"channel":0,"visible":false})).unwrap();
                recipe(&mut f.engine);
                let before = f.engine.active().unwrap().doc.clone();
                let labels = f.engine.active().unwrap().history.entries();
                let revision = f.engine.active().unwrap().revision;
                let past = f.engine.active().unwrap().history.past_len();
                let journal = f.engine.journal.len();
                let fade = f.engine.edit_state.fade.clone();
                let context = f.engine.active().unwrap().channel_view.clone();
                let mut native = twin(&f.engine);
                let params=json!({"layer":u64::MAX,"coalesce":"ignored-outer-again-key","vendor":{"keep":true}});
                let actual=host(&mut f.engine,command,params.clone()).unwrap();
                let expected=native.execute(command,params.clone()).unwrap();
                assert_eq!(actual,expected);
                let actual_id=f.engine.active().unwrap().active_layer.unwrap();
                let native_id=native.active().unwrap().active_layer.unwrap();
                let pairs=if command==COPY { paired_ids(native.active().unwrap().doc.layer(native_id).unwrap(),f.engine.active().unwrap().doc.layer(actual_id).unwrap()) } else { Vec::new() };
                same(&f.engine,&native,&pairs);
                let after=f.engine.active().unwrap().doc.clone();
                assert_eq!(f.engine.active().unwrap().revision,revision+if command==COPY {2}else{1});
                assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);
                assert_eq!(f.engine.active().unwrap().history.undo_label(),Some(if command==COPY {"Transform Again"}else{"Free Transform"}));
                assert_eq!(f.engine.journal[journal..].iter().map(|entry|entry.0.as_str()).collect::<Vec<_>>(),if command==COPY {vec!["layer.duplicate","edit.transform",COPY]}else{vec!["edit.transform",AGAIN]});
                assert_eq!(f.engine.journal.last(),Some(&(command.into(),params)));
                assert_eq!(f.engine.edit_state.fade,fade);
                let original=smart(&before,id);let transformed=smart(&after,actual_id);
                assert_eq!(transformed.source,original.source);
                assert_eq!(transformed.psd_raw,original.psd_raw);
                assert_eq!(after.layer(actual_id).unwrap().psd_blocks,before.layer(id).unwrap().psd_blocks);
                assert_eq!(transformed.transform.m[4],original.transform.m[4]+3.0);
                assert_eq!(transformed.transform.m[5],original.transform.m[5]+2.0);
                if command==COPY {
                    assert_ne!(actual_id,id);assert_eq!(after.layer(id),before.layer(id));assert_eq!(after.layer(actual_id).unwrap().psd_id,None);
                    if let (photocraft_engine::doc::SmartSource::Embedded{bytes:a,..},photocraft_engine::doc::SmartSource::Embedded{bytes:b,..})=(&original.source,&transformed.source){assert!(Arc::ptr_eq(a,b));}
                }
                let mut session=PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
                let photo=ulid::Ulid::new().to_string();publish(&f.directory.0,&photo,&mut session).unwrap();
                let immutable_file=f.directory.0.join(format!("{}.pcraft",session.version));
                let immutable=bundle::portable_bytes(&immutable_file,MAX_INPUT_BYTES as usize).unwrap();
                std::fs::remove_file(&f.path).unwrap();
                session.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&session.engine,&native,&pairs);
                assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc,&before));
                publish(&f.directory.0,&photo,&mut session).unwrap();save_view(&f.directory.0,&session).unwrap();
                let mut reopened=restore_with_settings(&f.directory.0,&session.version,None,false).unwrap();
                assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(reopened.engine.active().unwrap().history.entries(),labels);
                assert!(reopened.engine.active().unwrap().history.can_redo());assert_eq!(reopened.engine.active().unwrap().channel_view,context);
                reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);
                assert_eq!(smart(&reopened.engine.active().unwrap().doc,actual_id).source,transformed.source);
                assert_eq!(bundle::portable_bytes(&immutable_file,MAX_INPUT_BYTES as usize).unwrap(),immutable);
            }
        }
    }
}

#[test]
fn linked_again_host_locked_copy_keeps_native_duplicate_undo_boundary_and_successful_preset_flush() {
    let mut f=fixture(16,"png");
    f.engine.edit("Lock Again target",|doc,_|{doc.layer_mut(f.active).unwrap().locks.position=true;Ok(())}).unwrap();normalize(&mut f.engine);
    f.engine.edit("Existing redo before Again refusal",|_,_|Ok(())).unwrap();assert!(f.engine.undo());normalize(&mut f.engine);recipe(&mut f.engine);
    assert!(f.engine.active().unwrap().history.can_redo());
    let mut native=twin(&f.engine);
    let storage=pending(&mut f.engine,"Failed copy still flushes Duplicate Layer");let native_storage=pending(&mut native,"Failed copy still flushes Duplicate Layer");
    let files=storage.files.lock().unwrap().clone();let before=f.engine.active().unwrap().doc.clone();
    let revision=f.engine.active().unwrap().revision;let labels=f.engine.active().unwrap().history.entries();let journal=f.engine.journal.len();let fade=f.engine.edit_state.fade.clone();
    let params=json!({"coalesce":"outer-failure","vendor":[null,7]});
    let actual=host(&mut f.engine,COPY,params.clone()).unwrap_err();let expected=native.execute(COPY,params).unwrap_err().to_string();assert_eq!(actual,expected);assert!(actual.contains("locked"));
    same(&f.engine,&native,&[]);assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
    assert_eq!(f.engine.active().unwrap().revision,revision+2);assert_eq!(f.engine.active().unwrap().history.entries(),labels);assert!(!f.engine.active().unwrap().history.can_redo());assert_eq!(f.engine.active().unwrap().coalesce,None);
    assert_eq!(f.engine.journal.len(),journal+1);assert_eq!(f.engine.journal.last(),Some(&("layer.duplicate".into(),json!({"layer":f.active.0}))));assert_eq!(f.engine.edit_state.fade,fade);
    assert_ne!(*storage.files.lock().unwrap(),files);assert_eq!(*storage.files.lock().unwrap(),*native_storage.files.lock().unwrap());
    assert!(open(Box::new(storage)).presets.iter().any(|preset|preset.name=="Failed copy still flushes Duplicate Layer"));
}

#[test]
fn linked_again_host_outer_coalesce_does_not_merge_nested_transform_steps_or_replace_fade() {
    for command in [AGAIN,COPY] {
        let mut f=fixture(16,"pcraft");recipe(&mut f.engine);let mut native=twin(&f.engine);
        let storage=pending(&mut f.engine,"Successful Again owner");let native_storage=pending(&mut native,"Successful Again owner");let files=storage.files.lock().unwrap().clone();
        let past=f.engine.active().unwrap().history.past_len();let revision=f.engine.active().unwrap().revision;let fade=f.engine.edit_state.fade.clone();let mut pairs=Vec::new();
        for index in 1..=2 {
            let params=json!({"coalesce":"same-outer-key"});let result=host(&mut f.engine,command,params.clone()).unwrap();let expected=native.execute(command,params).unwrap();
            assert_eq!(result,expected);
            if command==COPY {pairs.extend(paired_ids(native.active().unwrap().doc.layer(native.active().unwrap().active_layer.unwrap()).unwrap(),f.engine.active().unwrap().doc.layer(f.engine.active().unwrap().active_layer.unwrap()).unwrap()));}
            same(&f.engine,&native,&pairs);assert_eq!(f.engine.active().unwrap().history.past_len(),past+index);assert_eq!(f.engine.active().unwrap().revision,revision+index as u64*if command==COPY{2}else{1});assert_eq!(f.engine.active().unwrap().coalesce,None);assert_eq!(f.engine.edit_state.fade,fade);
        }
        assert_ne!(*storage.files.lock().unwrap(),files);assert_eq!(*storage.files.lock().unwrap(),*native_storage.files.lock().unwrap());
    }
}

#[test]
fn linked_again_host_late_checked_refusal_and_panic_do_not_publish_history_journal_or_pending_presets() {
    for command in [AGAIN,COPY] {
        for panic in [false,true] {
            let mut f=fixture(32,"psd");
            f.engine.edit("Again group target",|_,active|{*active=Some(f.group);Ok(())}).unwrap();normalize(&mut f.engine);recipe(&mut f.engine);
            let storage=pending(&mut f.engine,"Private source refusal must not flush");let files=storage.files.lock().unwrap().clone();let before=twin(&f.engine);let mut visits=Vec::new();let mut pins:Vec<Weak<Vec<u8>>>=Vec::new();
            let error=run_with(&mut f.engine,command,&json!({"coalesce":"not-committed"}),|id,metadata,object|{
                visits.push(id);
                if visits.len()==2 {assert!(pins.iter().all(|pin|pin.upgrade().is_none()));if panic{panic!("Injected Again checked source panic");}return Err("Injected late Again source cap".into());}
                let(name,bytes)=checked(id,metadata,object)?.unwrap();let bytes=Arc::new((*bytes).clone());pins.push(Arc::downgrade(&bytes));Ok(Some((name,bytes)))
            }).unwrap_err();
            assert!(if panic{error.contains("internal error")}else{error.contains("Injected late Again source cap")});assert_eq!(visits.len(),2);assert!(pins.iter().all(|pin|pin.upgrade().is_none()));unchanged(&f.engine,&before);assert_eq!(*storage.files.lock().unwrap(),files);
        }
    }
}

#[test]
fn linked_again_host_failed_geometry_keeps_prior_immutable_bytes_and_has_no_outer_success_record() {
    use super::super::super::{bundle, publish, PhotoSession, MAX_INPUT_BYTES};
    let mut f=fixture(8,"psb");f.engine.edit("Locked published Again target",|doc,_|{doc.layer_mut(f.active).unwrap().locks.all=true;Ok(())}).unwrap();normalize(&mut f.engine);recipe(&mut f.engine);
    let mut session=PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
    publish(&f.directory.0,&ulid::Ulid::new().to_string(),&mut session).unwrap();let version=session.version.clone();let path=f.directory.0.join(format!("{version}.pcraft"));let bytes=bundle::portable_bytes(&path,MAX_INPUT_BYTES as usize).unwrap();let before=session.engine.active().unwrap().doc.clone();let journal=session.engine.journal.len();
    let mut native=twin(&session.engine);let params=json!({"vendor":"real dispatch failure"});
    assert_eq!(host(&mut session.engine,COPY,params.clone()).unwrap_err(),native.execute(COPY,params).unwrap_err().to_string());same(&session.engine,&native,&[]);
    assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc,&before));assert_eq!(session.version,version);assert_eq!(session.engine.journal.len(),journal+1);assert_eq!(session.engine.journal.last().unwrap().0,"layer.duplicate");assert_eq!(bundle::portable_bytes(&path,MAX_INPUT_BYTES as usize).unwrap(),bytes);
}
