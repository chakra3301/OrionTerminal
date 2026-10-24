use super::super::tests::{fixture, host, normalize, same, smart, twin, unchanged, Fixture};
use photocraft_engine::{doc::{LayerContent, PixelFormat, Rect}, preset_store::{open, MemBackend}, Session};
use photocraft_raster::Surface;
use serde_json::json;
use std::sync::Arc;

const COMMAND: &str = "image.trim";

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        let path=std::env::temp_dir().join(format!("xdesign-trim-host-{}",ulid::Ulid::new()));
        std::fs::create_dir(&path).unwrap();Self(path)
    }
}
impl Drop for Directory { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }

fn prepared(depth:u32,based:&str)->Fixture {
    let mut f=fixture(depth,"rgb");let raster=f.raster;let group=f.group;
    f.engine.edit("Trim host source",|doc,_| {
        let format=doc.pixel_format();let mut surface=Surface::new(format);
        if based!="transparent" { surface.fill_rect(doc.bounds(),&[0.25,0.5,0.75,1.]); }
        surface.fill_rect(Rect::new(3,2,11,9),&[0.9,0.2,0.4,1.]);
        surface.write_pixel(20,20,&[0.1,0.8,0.2,1.]);
        let layer=doc.layer_mut(raster).unwrap();
        *layer.surface_mut().unwrap()=surface;
        if let Some(mask)=&mut layer.mask {mask.enabled=false;}
        if let Some(mask)=&mut layer.vector_mask {mask.enabled=false;}
        doc.layer_mut(group).unwrap().visible=false;
        let mut selection=Surface::new(PixelFormat::GRAY8);
        selection.fill_rect(Rect::new(1,1,14,10),&[0.5]);doc.selection=Some(selection);
        Ok(())
    }).unwrap();
    normalize(&mut f.engine);
    f.engine.execute("channel.setVisible",json!({"channel":"composite","visible":true})).unwrap();
    for index in 0..f.engine.active().unwrap().doc.channels.len() {
        f.engine.execute("channel.setVisible",json!({"channel":index,"visible":false})).unwrap();
    }
    f
}

fn pending(engine:&mut Session,name:&str)->MemBackend {
    let storage=MemBackend::default();engine.attach_preset_store(open(Box::new(storage.clone())));
    let mut preset=engine.tools.presets[0].clone();preset.name=name.into();preset.group="Trim owner".into();preset.builtin=false;
    engine.tools.presets.push(preset);engine.brush_presets_changed();storage
}

#[test]
fn sparse_trim_host_actual_dispatch_publish_reopen_retains_translated_selection_and_sources() {
    use super::super::super::super::{bundle,publish,restore_with_settings,save_view,PhotoSession,MAX_INPUT_BYTES};
    for depth in [8,16,32] {for based in ["transparent","topLeft","bottomRight"] {
        let mut f=prepared(depth,based);let before=f.engine.active().unwrap().doc.clone();
        let before_labels=f.engine.active().unwrap().history.entries();let before_view=f.engine.active().unwrap().channel_view.clone();
        let past=f.engine.active().unwrap().history.past_len();let revision=f.engine.active().unwrap().revision;let journal=f.engine.journal.len();let fade=f.engine.edit_state.fade.clone();
        let mut native=twin(&f.engine);
        let params=json!({"basedOn":based,"top":true,"left":true,"right":true,"bottom":true,"deleteCroppedPixels":false,"coalesce":"trim host","vendor":{"retain":[null,7]}});
        let actual=host(&mut f.engine,COMMAND,params.clone()).unwrap();let expected=native.execute(COMMAND,params.clone()).unwrap();
        assert_eq!(actual,expected);assert_eq!(actual,json!({"x":3,"y":2,"width":8,"height":7}));same(&f.engine,&native);
        let after=f.engine.active().unwrap().doc.clone();let selection=after.selection.as_ref().expect("Native Trim retains selection");
        assert_eq!(selection.content_bounds(),Rect::new(-2,-1,11,8));
        assert_eq!(selection.pixel(-2,-1),before.selection.as_ref().unwrap().pixel(1,1));
        assert_eq!(selection.pixel(10,7),before.selection.as_ref().unwrap().pixel(13,9));
        assert_eq!(after.layer(f.raster).unwrap().surface().unwrap().pixel(17,18),after.layer(f.raster).unwrap().surface().unwrap().default_pixel());
        assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);assert_eq!(f.engine.active().unwrap().history.undo_label(),Some("Trim"));
        assert_eq!(f.engine.active().unwrap().revision,revision+1);assert_eq!(f.engine.journal.len(),journal+1);
        assert_eq!(f.engine.journal.last(),Some(&(COMMAND.into(),params)));assert_eq!(f.engine.edit_state.fade,fade);
        for id in [f.smart,f.embedded] {
            assert_eq!(smart(&after,id).source,smart(&before,id).source);assert_eq!(smart(&after,id).psd_raw,smart(&before,id).psd_raw);
            assert_eq!(smart(&after,id).smart_filters,smart(&before,id).smart_filters);assert_eq!(smart(&after,id).filter_mask,smart(&before,id).filter_mask);
            assert_eq!(after.layer(id).unwrap().psd_blocks,before.layer(id).unwrap().psd_blocks);
        }
        let directory=Directory::new();let photo=ulid::Ulid::new().to_string();
        let mut session=PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
        publish(&directory.0,&photo,&mut session).unwrap();let old_file=directory.0.join(format!("{}.pcraft",session.version));
        let old_bytes=bundle::portable_bytes(&old_file,MAX_INPUT_BYTES as usize).unwrap();
        session.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&session.engine,&native);
        assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc,&before));
        publish(&directory.0,&photo,&mut session).unwrap();save_view(&directory.0,&session).unwrap();
        let mut reopened=restore_with_settings(&directory.0,&session.version,None,false).unwrap();
        assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(reopened.engine.active().unwrap().history.entries(),before_labels);
        assert_eq!(reopened.engine.active().unwrap().channel_view,before_view);assert!(reopened.engine.active().unwrap().history.can_redo());
        reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);
        assert_eq!(reopened.engine.active().unwrap().doc.selection,after.selection);
        assert_eq!(bundle::portable_bytes(&old_file,MAX_INPUT_BYTES as usize).unwrap(),old_bytes);
    }}
}

#[test]
fn sparse_trim_host_zero_offset_coalesces_once_and_flushes_only_owner_presets() {
    let mut f=prepared(16,"transparent");let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);
    let storage=pending(&mut f.engine,"Trim owner success");let native_storage=pending(&mut native,"Trim owner success");let files=storage.files.lock().unwrap().clone();
    let past=f.engine.active().unwrap().history.past_len();let revision=f.engine.active().unwrap().revision;let journal=f.engine.journal.len();let fade=f.engine.edit_state.fade.clone();
    let params=json!({"basedOn":"transparent","top":false,"left":false,"bottom":false,"right":false,"coalesce":"same trim","extensionColor":"foreground","vendor":[1,2,3]});
    for step in 1..=2 {
        assert_eq!(host(&mut f.engine,COMMAND,params.clone()).unwrap(),native.execute(COMMAND,params.clone()).unwrap());same(&f.engine,&native);
        assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);assert_eq!(f.engine.active().unwrap().history.undo_label(),Some("Trim"));
        assert_eq!(f.engine.active().unwrap().revision,revision+step);assert_eq!(f.engine.journal.len(),journal+step as usize);
        assert_eq!(f.engine.journal.last(),Some(&(COMMAND.into(),params.clone())));assert_eq!(f.engine.edit_state.fade,fade);
        assert_eq!(f.engine.active().unwrap().doc.selection,before.selection);
    }
    assert_ne!(*storage.files.lock().unwrap(),files);assert_eq!(*storage.files.lock().unwrap(),*native_storage.files.lock().unwrap());
    assert!(open(Box::new(storage)).presets.iter().any(|preset|preset.name=="Trim owner success"));
    f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native);
    assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
}

#[test]
fn sparse_trim_host_empty_refusal_keeps_pending_presets_owner_arc_and_immutable_bytes() {
    use super::super::super::super::{bundle,publish,PhotoSession,MAX_INPUT_BYTES};
    for based in ["transparent","topLeft","bottomRight"] {
        let mut f=prepared(8,"transparent");let raster=f.raster;
        f.engine.edit("Uniform trim refusal",|doc,_|{let format=doc.pixel_format();let mut surface=Surface::new(format);if based!="transparent"{surface.fill_rect(doc.bounds(),&[0.25,0.5,0.75,1.]);}let layer=doc.layer_mut(raster).unwrap();let LayerContent::Raster(target)=&mut layer.content else{unreachable!()};*target=surface;Ok(())}).unwrap();normalize(&mut f.engine);
        let directory=Directory::new();let mut session=PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
        publish(&directory.0,&ulid::Ulid::new().to_string(),&mut session).unwrap();let version=session.version.clone();
        let file=directory.0.join(format!("{version}.pcraft"));let bytes=bundle::portable_bytes(&file,MAX_INPUT_BYTES as usize).unwrap();
        let storage=pending(&mut session.engine,"Refused trim must not flush");let files=storage.files.lock().unwrap().clone();let before=twin(&session.engine);let mut native=twin(&session.engine);
        let params=json!({"basedOn":based,"left":false,"coalesce":"refused trim"});let expected=native.execute(COMMAND,params.clone()).unwrap_err().to_string();
        assert!(expected.contains("nothing to trim to"));assert_eq!(host(&mut session.engine,COMMAND,params).unwrap_err(),expected);unchanged(&session.engine,&before);
        assert_eq!(*storage.files.lock().unwrap(),files);assert_eq!(session.version,version);assert_eq!(bundle::portable_bytes(&file,MAX_INPUT_BYTES as usize).unwrap(),bytes);
    }
}
