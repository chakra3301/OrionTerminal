use photocraft_engine::{doc::{LayerContent, LayerId, SmartSource}, Session};
use serde_json::{json, Value};
use std::sync::Arc;

const COMMAND: &str = "layer.smartObjects.updateModifiedContent";
const LABEL: &str = "Update Modified Content";
const ALL_COMMAND: &str = "layer.smartObjects.updateAllModifiedContent";
const ALL_LABEL: &str = "Update All Modified Content";
const UNAVAILABLE: &str = "the smart object's contents are unavailable (missing linked file?), so it can't be re-rendered";

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if !matches!(command, COMMAND | ALL_COMMAND) || !(params.is_object() || params.is_null()) { return None; }
    // Smart Object commands retain native active-document/layer enablement, unlike targeted filter edits.
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()));
    }
    if command == ALL_COMMAND { return Some(run_all(engine, params)); }
    let state = engine.active()?;
    let id = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)?;
    let LayerContent::Smart(smart) = &state.doc.layer(id)?.content else { return None; };
    if !matches!(smart.source, SmartSource::Linked { .. }) { return None; }
    Some(run(engine, params, id))
}

fn run(engine: &mut Session, params: &Value, id: LayerId) -> Result<Value, String> {
    run_with(engine, params, id, |meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || super::admit(smart)))
}

fn run_with(engine: &mut Session, params: &Value, id: LayerId, resolve: impl FnOnce(&photocraft_engine::doc::Metadata, &photocraft_engine::doc::SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("No Smart Object")?.content else { return Err("Select a Smart Object".into()); };
    let (file_name, bytes) = resolve(&state.doc.metadata, smart)?.ok_or(UNAVAILABLE)?;
    let mut pinned = smart.clone();
    pinned.source = SmartSource::Embedded { file_name, bytes };
    let draft = super::super::snapshot::capture(state, super::super::snapshot::HistoryPolicy::Discard);
    let mut scratch = Session::new();
    scratch.add_document(photocraft_engine::doc::Document::new("Linked refresh", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
    *scratch.active_mut().ok_or("No refresh document")? = draft;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        scratch.edit(LABEL, |doc, _| {
            let pixels = photocraft_engine::smart_cmds::render(doc, &pinned)?.ok_or_else(|| photocraft_engine::EngineError::Other(UNAVAILABLE.into()))?;
            let LayerContent::Smart(target) = &mut doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?.content else { return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into())); };
            target.cache = Some(pixels);
            Ok(())
        })
    })).map_err(|_| format!("`{COMMAND}` failed with an internal error (logged); the document is unchanged"))?.map_err(|error| error.to_string())?;
    commit(engine, scratch, COMMAND, LABEL, params, &[id], &[id])?;
    Ok(json!({"layer":id.0}))
}

fn run_all(engine: &mut Session, params: &Value) -> Result<Value, String> {
    run_all_with(engine, params, |meta, smart| super::super::smart::source_bytes_checked(meta, &smart.source, || super::admit(smart)))
}

fn run_all_with(engine: &mut Session, params: &Value, mut resolve: impl FnMut(&photocraft_engine::doc::Metadata, &photocraft_engine::doc::SmartObject) -> Result<Option<super::Bytes>, String>) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let ids: Vec<LayerId> = state.doc.walk().into_iter()
        .filter(|(_, _, layer)| matches!(&layer.content, LayerContent::Smart(smart) if matches!(smart.source, SmartSource::Linked { .. })))
        .map(|(_, _, layer)| layer.id).collect();
    let draft = super::super::snapshot::capture(state, super::super::snapshot::HistoryPolicy::Discard);
    let mut scratch = Session::new();
    scratch.add_document(photocraft_engine::doc::Document::new("Linked refresh", draft.doc.size, draft.doc.mode, draft.doc.depth), None);
    *scratch.active_mut().ok_or("No refresh document")? = draft;
    let updated = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        scratch.edit(ALL_LABEL, |doc, _| {
            let mut updated = Vec::new();
            for id in &ids {
                let LayerContent::Smart(smart) = &doc.layer(*id).ok_or(photocraft_engine::EngineError::NoLayer(*id))?.content else {
                    return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into()));
                };
                let Some((file_name, bytes)) = resolve(&doc.metadata, smart).map_err(photocraft_engine::EngineError::Other)? else { continue; };
                let original = smart.source.clone();
                let LayerContent::Smart(target) = &mut doc.layer_mut(*id).ok_or(photocraft_engine::EngineError::NoLayer(*id))?.content else {
                    return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into()));
                };
                target.source = SmartSource::Embedded { file_name, bytes };
                let rendered = photocraft_engine::smart_cmds::refresh(doc, *id)?;
                let LayerContent::Smart(target) = &mut doc.layer_mut(*id).ok_or(photocraft_engine::EngineError::NoLayer(*id))?.content else {
                    return Err(photocraft_engine::EngineError::Other("The Smart Object changed type".into()));
                };
                // Each occurrence makes its own source decision; retire its pin before the next read.
                target.source = original;
                if rendered { updated.push(*id); }
            }
            Ok(updated)
        })
    })).map_err(|_| format!("`{ALL_COMMAND}` failed with an internal error (logged); the document is unchanged"))?.map_err(|error| error.to_string())?;
    commit(engine, scratch, ALL_COMMAND, ALL_LABEL, params, &ids, &updated)?;
    Ok(json!({"updated":updated.iter().map(|id| id.0).collect::<Vec<_>>()}))
}

fn commit(engine: &mut Session, mut scratch: Session, command: &str, label: &str, params: &Value, sources: &[LayerId], updated: &[LayerId]) -> Result<(), String> {
    // Same-index activation is nonjournaled and runs native view/slice posthooks.
    // Refresh cannot dispatch against the private pin: single-refresh enablement requires Linked.
    let index = scratch.active_index().ok_or("No refresh document")?;
    scratch.execute("document.activate", json!({"document":index})).map_err(|error| error.to_string())?;
    let computed = scratch.close(index).ok_or("No completed refresh")?;
    let original = engine.active().ok_or("No image document")?;
    let mut refreshed = updated.iter().peekable();
    for id in sources {
        let Some(LayerContent::Smart(before)) = original.doc.layer(*id).map(|layer| &layer.content) else { return Err("The refresh source no longer exists".into()); };
        let Some(LayerContent::Smart(after)) = computed.doc.layer(*id).map(|layer| &layer.content) else { return Err("The refreshed Smart Object changed type".into()); };
        if after.source != before.source { return Err("Linked refresh changed its source reference".into()); }
        if refreshed.peek().is_some_and(|next| *next == id) {
            if after.cache.is_none() { return Err("Linked refresh produced no cache".into()); }
            refreshed.next();
        }
    }
    if refreshed.next().is_some() { return Err("Linked refresh produced an unexpected target order".into()); }
    let document = Arc::try_unwrap(computed.doc).unwrap_or_else(|doc| (*doc).clone());
    super::super::mask_filters::edit_history(engine, label, params, |doc, layer| { *doc = document; *layer = computed.active_layer; Ok(()) })?;
    let state = engine.active_mut().ok_or("No image document")?;
    state.channel_view = computed.channel_view;
    state.selected_layers = computed.selected_layers;
    state.layer_anchor = computed.layer_anchor;
    engine.sync_preset_store();
    engine.journal.push((command.into(), params.clone()));
    Ok(())
}

#[cfg(test)]
#[path = "xdesign_photo_linked_refresh_all_tests.rs"]
mod all_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{Affine, BlendMode, Document, Layer, LayerMask, Rect, Slice, SliceOrigin, SmartFilter, SmartObject};
    use std::path::PathBuf;

    struct Temp(PathBuf);
    impl Drop for Temp { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    fn temp() -> Temp {
        let path = std::env::temp_dir().join(format!("linked-refresh-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&path).unwrap(); Temp(path)
    }
    fn rgba() -> Vec<u8> {
        vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255,
             0,255,255,255, 255,0,255,255, 255,255,0,255, 0,0,0,255,
             255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]
    }
    fn encoded(format: &str) -> Vec<u8> {
        let image = photocraft_codecs::Image::from_u8(4,3,photocraft_codecs::ChannelLayout::Rgba,rgba()).unwrap();
        match format {
            "png" => photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap(),
            "psd" | "psb" => {
                use photocraft_psd::{Compression,LayerSpec,PixelData,PsdBuilder,Version};
                let mut builder=PsdBuilder::new(4,3).version(if format=="psb"{Version::Psb}else{Version::Psd}).compression(Compression::Raw);
                builder.push_layer(LayerSpec::new("Known",0,0,4,3,PixelData::Rgba8(rgba())));
                builder.composite(PixelData::Rgba8(rgba())); builder.to_bytes().unwrap()
            }
            "pcraft" => {
                let png=encoded("png");let source=photocraft_io::import("source.png",&png).unwrap().document;
                photocraft_engine::smart_cmds::encode_source(&source).unwrap()
            }
            _ => unreachable!(),
        }
    }
    fn smart(doc: &Document,id: LayerId) -> &SmartObject {
        let LayerContent::Smart(smart)=&doc.layer(id).unwrap().content else{panic!("No Smart Object")};smart
    }
    fn fixture(depth:u32,format:&str) -> (Temp,Session,LayerId,PathBuf) {
        let dir=temp();let path=dir.0.join(format!("source.{format}"));std::fs::write(&path,encoded(format)).unwrap();
        let mut engine=Session::new();engine.execute("file.new",json!({"width":12,"height":10,"depth":depth})).unwrap();
        engine.edit("Linked source",|doc,active|{
            let mut cache=photocraft_raster::Surface::new(doc.pixel_format());cache.fill_rect(Rect::from_xywh(2,1,1,1),&[0.25,0.5,0.75,1.]);
            let mut object=SmartObject::new(SmartSource::Linked{path:path.to_string_lossy().into()},Affine::translate(2.,1.),Some(cache));
            object.smart_filters=vec![SmartFilter{command:"filter.cameraRaw".into(),params:json!({"exposure":0,"vendor":{"retain":[1,null]}}),visible:true,opacity:1.,blend:BlendMode::Normal}];
            let mut mask=LayerMask::hide_all();mask.enabled=false;mask.linked=false;mask.density=0.42;mask.feather=1.25;object.filter_mask=Some(mask);
            object.psd_raw=Some(Arc::new(b"retained placed data".to_vec()));
            let mut layer=Layer::new("Linked",LayerContent::Smart(object));layer.psd_blocks.push((*b"zzzz",Arc::new(b"retained unknown".to_vec())));
            *active=Some(layer.id);doc.layers=vec![layer];Ok(())
        }).unwrap();
        let id=engine.active().unwrap().active_layer.unwrap();
        engine.tools.foreground=[0.2,0.3,0.4,0.5];engine.tools.background=[0.7,0.6,0.5,0.4];
        let state=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:id,mask:false,label:"Older Fade".into()});
        (dir,engine,id,path)
    }
    fn twin(engine:&Session) -> Session {
        let state=engine.active().unwrap();let mut copy=Session::new();copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None);
        *copy.active_mut().unwrap()=state.clone();copy.journal=engine.journal.clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.clipboard=engine.clipboard.clone();copy.style_clipboard=engine.style_clipboard.clone();copy.edit_state=engine.edit_state.clone();
        super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap();copy
    }
    fn same(actual:&Session,expected:&Session) {
        let a=actual.active().unwrap();let e=expected.active().unwrap();assert_eq!(a.doc,e.doc);assert_eq!(a.history.entries(),e.history.entries());assert_eq!(a.history.past_len(),e.history.past_len());
        for index in 0..a.history.past_len(){assert_eq!(a.history.state(index),e.history.state(index));}
        assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());
        assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(e.revision,e.saved_revision,&e.coalesce,e.active_layer,&e.selected_layers,e.layer_anchor,&e.path,&e.last_damage));
        assert_eq!(format!("{:?}",a.channel_view),format!("{:?}",e.channel_view));assert_eq!(a.isolated_layers,e.isolated_layers);assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",e.symmetry_path));assert_eq!(a.fx_collapsed,e.fx_collapsed);
        assert_eq!(actual.journal,expected.journal);assert_eq!(actual.edit_state.fade,expected.edit_state.fade);assert_eq!(actual.tools.foreground,expected.tools.foreground);assert_eq!(actual.tools.background,expected.tools.background);assert_eq!(actual.tools.brush,expected.tools.brush);
        assert_eq!(actual.style_clipboard,expected.style_clipboard);assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard));assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(expected));
        assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(expected).unwrap());
    }
    fn unchanged(actual:&Session,before:&Session){same(actual,before);assert!(Arc::ptr_eq(&actual.active().unwrap().doc,&before.active().unwrap().doc));}
    fn translated_pixels(engine:&Session,id:LayerId,depth:u32) {
        let surface=smart(&engine.active().unwrap().doc,id).cache.as_ref().unwrap();let raw=rgba();
        let tolerance=if depth==8 {1./255.}else{2./65535.};
        for y in 0..10 {for x in 0..12 {
            let expected=if (2..6).contains(&x)&&(1..4).contains(&y){let at=((y-1)*4+x-2) as usize*4;[raw[at] as f32/255.,raw[at+1] as f32/255.,raw[at+2] as f32/255.,1.]}else{[0.;4]};
            for (channel,(actual,expected)) in surface.pixel(x,y).iter().zip(expected).enumerate(){assert!((actual-expected).abs()<=tolerance,"{depth} ({x},{y})/{channel}: {actual} != {expected}");}
            assert_eq!(surface.pixel(x,y)[3],expected[3],"exact alpha {x},{y}");
        }}
    }

    #[test]
    fn linked_refresh_four_formats_three_depths_match_native_and_independent_translated_pixels() {
        for depth in [8,16,32] {for format in ["png","psd","psb","pcraft"] {
            let(dir,mut engine,id,path)=fixture(depth,format);let original=smart(&engine.active().unwrap().doc,id).clone();let before=engine.active().unwrap().doc.clone();let mut expected=twin(&engine);let request=json!({"layer":id.0,"vendor":"journal-only"});
            let value=expected.execute(COMMAND,request.clone()).unwrap();assert_eq!(execute(&mut engine,COMMAND,&request).unwrap().unwrap(),value);same(&engine,&expected);translated_pixels(&engine,id,depth);
            let after=smart(&engine.active().unwrap().doc,id);let mut retained=after.clone();retained.cache=original.cache.clone();assert_eq!(retained,original);
            let refreshed=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,refreshed);
            let bundle=photocraft_format::save_to_bytes(&refreshed,&Default::default()).unwrap();let saved=dir.0.join("immutable.pcraft");std::fs::write(&saved,&bundle).unwrap();std::fs::write(path,b"externally changed after saving").unwrap();
            let reopened=photocraft_format::load_from_bytes(&std::fs::read(&saved).unwrap()).unwrap();assert_eq!(smart(&reopened,id).source,original.source);assert_eq!(smart(&reopened,id).smart_filters,original.smart_filters);assert_eq!(smart(&reopened,id).filter_mask,original.filter_mask);
            let mut reopened_engine=Session::new();reopened_engine.add_document(reopened,None);translated_pixels(&reopened_engine,id,depth);assert_eq!(bundle,std::fs::read(saved).unwrap());assert_eq!(bundle,photocraft_format::save_to_bytes(&refreshed,&Default::default()).unwrap());
        }}
    }

    #[test]
    fn linked_refresh_native_posthooks_refit_group_and_layer_slices_without_extra_journal_or_history() {
        let(_dir,mut engine,id,_)=fixture(16,"png");
        engine.edit("Grouped layer slices",|doc,_|{
            let layer=doc.layers.remove(0);let group=Layer::group("Group",vec![layer]);let group_id=group.id;doc.layers.push(group);
            for (slice_id,layer) in [(7,id),(8,group_id)]{doc.slices.list.push(Slice{id:slice_id,origin:SliceOrigin::Layer,layer:Some(layer),rect:Rect::from_xywh(2,1,1,1),outsets:[1,2,3,4],..Default::default()});}
            doc.slices.list.push(Slice{id:9,origin:SliceOrigin::Layer,layer:Some(LayerId(u64::MAX)),..Default::default()});Ok(())
        }).unwrap();
        let before=engine.active().unwrap().history.past_len();let journal=engine.journal.len();let mut expected=twin(&engine);expected.execute(COMMAND,json!({"layer":id.0})).unwrap();execute(&mut engine,COMMAND,&json!({"layer":id.0})).unwrap().unwrap();same(&engine,&expected);
        assert_eq!(engine.active().unwrap().history.past_len(),before+1);assert_eq!(engine.journal.len(),journal+1);assert_eq!(engine.active().unwrap().doc.slices.list.len(),2);
        for slice in &engine.active().unwrap().doc.slices.list {assert_eq!(slice.rect,Rect::new(0,0,10,7));}
        let mut activation=twin(&engine);let original=twin(&activation);let index=activation.active_index().unwrap();activation.execute("document.activate",json!({"document":index})).unwrap();same(&activation,&original);assert!(Arc::ptr_eq(&activation.active().unwrap().doc,&original.active().unwrap().doc));
    }

    #[test]
    fn linked_refresh_null_defaults_explicit_inactive_target_and_coalescing_match_native() {
        let(_dir,mut engine,id,path)=fixture(32,"png");
        engine.edit("Second linked source",|doc,active|{let layer=doc.layer(id).unwrap().duplicate();let other=doc.insert_above(Some(id),layer);*active=Some(other);Ok(())}).unwrap();
        let before=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();let mut expected=twin(&engine);
        for request in [json!({"layer":id.0,"coalesce":"refresh"}),json!({"layer":null,"coalesce":"refresh"}),json!({"layer":"active","coalesce":"refresh"}),json!({"layer":-1,"coalesce":"refresh"})] {
            assert_eq!(execute(&mut engine,COMMAND,&request).unwrap().unwrap(),expected.execute(COMMAND,request).unwrap());same(&engine,&expected);
        }
        assert_eq!(engine.active().unwrap().history.past_len(),past+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some(LABEL));let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);
        let mut expected=twin(&engine);assert_eq!(execute(&mut engine,COMMAND,&Value::Null).unwrap().unwrap(),expected.execute(COMMAND,Value::Null).unwrap());same(&engine,&expected);assert!(engine.journal.last().unwrap().1.is_null());assert!(path.exists());
    }

    #[test]
    fn linked_refresh_missing_corrupt_limit_and_available_only_stack_admission_are_atomic() {
        let(_dir,mut engine,id,path)=fixture(16,"png");
        engine.edit("Unsafe imported filter",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({"path":"never read"}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();
        std::fs::remove_file(&path).unwrap();let before=twin(&engine);let mut expected=twin(&engine);let request=json!({"layer":id.0});assert_eq!(execute(&mut engine,COMMAND,&request).unwrap().unwrap_err(),expected.execute(COMMAND,request.clone()).unwrap_err().to_string());unchanged(&engine,&before);
        std::fs::write(&path,encoded("png")).unwrap();assert!(execute(&mut engine,COMMAND,&request).unwrap().unwrap_err().contains("does not support"));unchanged(&engine,&before);
        let file=std::fs::File::create(&path).unwrap();file.set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();drop(file);assert!(execute(&mut engine,COMMAND,&request).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);
        engine.edit("Hide unsupported entry",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters[1].visible=false;Ok(())}).unwrap();std::fs::write(&path,b"not a source image").unwrap();let before=twin(&engine);assert!(execute(&mut engine,COMMAND,&request).unwrap().is_err());unchanged(&engine,&before);
        std::fs::write(&path,encoded("png")).unwrap();let mut expected=twin(&engine);expected.execute(COMMAND,request.clone()).unwrap();execute(&mut engine,COMMAND,&request).unwrap().unwrap();same(&engine,&expected);
        engine.edit("Globally disabled unsupported stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters[1].visible=true;smart.filters_enabled=false;Ok(())}).unwrap();let mut expected=twin(&engine);expected.execute(COMMAND,request.clone()).unwrap();execute(&mut engine,COMMAND,&request).unwrap().unwrap();same(&engine,&expected);
    }

    #[test]
    fn linked_refresh_metadata_source_is_authoritative_over_disk_alias_and_preserved() {
        let(_dir,mut engine,id,path)=fixture(16,"png");let payload=encoded("psb");
        engine.edit("PSD embedded linked authority",|doc,_|{
            doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(photocraft_io::linked::encode_linked_file(&photocraft_io::linked::LinkedFile{uuid:path.to_string_lossy().into(),file_name:"actual.psb".into(),bytes:payload.clone()}))));Ok(())
        }).unwrap();
        let file=std::fs::File::create(&path).unwrap();file.set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();drop(file);
        let before=engine.active().unwrap().doc.metadata.psd_global_blocks.clone();let mut expected=twin(&engine);expected.execute(COMMAND,json!({"layer":id.0})).unwrap();execute(&mut engine,COMMAND,&json!({"layer":id.0})).unwrap().unwrap();same(&engine,&expected);translated_pixels(&engine,id,16);assert_eq!(engine.active().unwrap().doc.metadata.psd_global_blocks,before);
    }

    #[test]
    fn linked_refresh_native_enablement_invalid_targets_and_unrelated_commands_do_not_read_sources() {
        let(_dir,mut engine,id,path)=fixture(16,"png");let file=std::fs::File::create(&path).unwrap();file.set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();drop(file);
        for request in [json!({"layer":u64::MAX}),json!([]),json!("bad parameters")] {
            let before=twin(&engine);let mut expected=twin(&engine);let error=super::super::super::execute_view_command(&mut engine,COMMAND,request.clone()).unwrap_err();assert_eq!(error,expected.execute(COMMAND,request).unwrap_err().to_string());assert!(!error.contains("512MB"));unchanged(&engine,&before);
        }
        assert!(execute(&mut engine,"layer.smartObjects.relinkToFile",&json!({})).is_none());assert!(execute(&mut engine,"edit.freeTransform",&json!({})).is_none());
        engine.edit("Active embedded source",|doc,active|{let format=doc.pixel_format();let other=doc.insert_above(Some(id),Layer::raster("Active raster",format));*active=Some(other);Ok(())}).unwrap();let before=twin(&engine);let mut expected=twin(&engine);let request=json!({"layer":id.0});let error=execute(&mut engine,COMMAND,&request).unwrap().unwrap_err();assert_eq!(error,expected.execute(COMMAND,request).unwrap_err().to_string());assert!(!error.contains("512MB"));unchanged(&engine,&before);
    }

    #[test]
    fn linked_refresh_one_resolved_source_survives_file_deletion_without_publishing_the_pin() {
        let(_dir,mut engine,id,path)=fixture(16,"png");let source=smart(&engine.active().unwrap().doc,id).source.clone();let mut reads=0;
        run_with(&mut engine,&json!({"layer":id.0}),id,|meta,smart|{
            reads+=1;let resolved=super::super::super::smart::source_bytes_checked(meta,&smart.source,||super::super::admit(smart))?;
            std::fs::remove_file(&path).unwrap();Ok(resolved)
        }).unwrap();
        assert_eq!(reads,1);assert!(!path.exists());assert_eq!(smart(&engine.active().unwrap().doc,id).source,source);translated_pixels(&engine,id,16);
        let bundle=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap();let reopened=photocraft_format::load_from_bytes(&bundle).unwrap();assert_eq!(smart(&reopened,id).source,source);assert_eq!(smart(&reopened,id).cache,smart(&engine.active().unwrap().doc,id).cache);
    }

    #[test]
    fn linked_refresh_selection_channel_mask_and_active_job_match_native_without_side_effects() {
        for context in ["alpha","quickMask","mask"] {
            let(_dir,mut engine,id,_)=fixture(16,"png");engine.execute("select.rect",json!({"x":3,"y":2,"width":2,"height":2})).unwrap();
            match context {
                "alpha"=>{engine.execute("channel.new",json!({"name":"Retained alpha","fill":"white"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();},
                "quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},
                _=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},
            }
            let mut expected=twin(&engine);let params=json!({"layer":id.0});assert_eq!(execute(&mut engine,COMMAND,&params).unwrap().unwrap(),expected.execute(COMMAND,params).unwrap());same(&engine,&expected);
        }
        use std::sync::atomic::{AtomicBool,Ordering};
        let(_dir,mut engine,id,path)=fixture(16,"png");let release=Arc::new(AtomicBool::new(false));let worker=release.clone();
        let started=engine.start_job("refresh-test",json!({}),"Retained active job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();
        let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected active job")};std::fs::remove_file(path).unwrap();let before=twin(&engine);let error=execute(&mut engine,COMMAND,&json!({"layer":id.0})).unwrap().unwrap_err();release.store(true,Ordering::Relaxed);assert!(error.contains("Retained active job")&&error.contains("still running"));unchanged(&engine,&before);engine.wait_job(job).unwrap();
    }

    #[test]
    fn linked_refresh_owner_pending_preset_store_sync_matches_native_only_after_success() {
        use photocraft_engine::preset_store::{open,MemBackend};
        let(_dir,mut engine,id,path)=fixture(16,"png");let mut expected=twin(&engine);
        let actual_backend=MemBackend::default();let native_backend=MemBackend::default();
        engine.attach_preset_store(open(Box::new(actual_backend.clone())));expected.attach_preset_store(open(Box::new(native_backend.clone())));
        for owner in [&mut engine,&mut expected] {
            let mut preset=owner.tools.presets[0].clone();preset.name="Pending refresh brush".into();preset.group="Pending group".into();preset.builtin=false;owner.tools.presets.push(preset);owner.brush_presets_changed();
        }
        let before=actual_backend.files.lock().unwrap().clone();assert_eq!(before,*native_backend.files.lock().unwrap());std::fs::remove_file(&path).unwrap();let request=json!({"layer":id.0});
        assert!(execute(&mut engine,COMMAND,&request).unwrap().is_err());assert!(expected.execute(COMMAND,request.clone()).is_err());same(&engine,&expected);assert_eq!(*actual_backend.files.lock().unwrap(),before);assert_eq!(*native_backend.files.lock().unwrap(),before);
        std::fs::write(path,encoded("png")).unwrap();execute(&mut engine,COMMAND,&request).unwrap().unwrap();expected.execute(COMMAND,request).unwrap();same(&engine,&expected);
        let actual=actual_backend.files.lock().unwrap().clone();assert_ne!(actual,before);assert_eq!(actual,*native_backend.files.lock().unwrap());let reopened=open(Box::new(actual_backend));assert!(reopened.presets.iter().any(|preset|preset.name=="Pending refresh brush"));assert!(reopened.warnings.is_empty());
    }

    #[test]
    fn linked_refresh_changed_file_replays_non_neutral_stack_with_independent_linear_light_oracle() {
        for depth in [8,16,32] {
            let(_dir,mut engine,id,path)=fixture(depth,"png");execute(&mut engine,COMMAND,&json!({"layer":id.0})).unwrap().unwrap();
            engine.edit("One stop lower",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters[0].params["exposure"]=json!(-1);Ok(())}).unwrap();
            let image=photocraft_codecs::Image::from_u8(4,3,photocraft_codecs::ChannelLayout::Rgba,[255,0,0,255].repeat(12)).unwrap();std::fs::write(path,photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap()).unwrap();
            let mut expected=twin(&engine);expected.execute(COMMAND,json!({"layer":id.0})).unwrap();execute(&mut engine,COMMAND,&json!({"layer":id.0})).unwrap().unwrap();same(&engine,&expected);
            let half=1.055_f64*0.5_f64.powf(1./2.4)-0.055;let tolerance=if depth==8{1./255.}else{2./65535.};let surface=smart(&engine.active().unwrap().doc,id).cache.as_ref().unwrap();
            for y in 0..10 {for x in 0..12 {let inside=(2..6).contains(&x)&&(1..4).contains(&y);let pixel=surface.pixel(x,y);let expected=if inside{[half,0.,0.,1.]}else{[0.;4]};for (channel,(actual,expected)) in pixel.iter().zip(expected).enumerate(){assert!((*actual as f64-expected).abs()<=tolerance,"{depth}/{x},{y}/{channel}: {actual} != {expected}");}assert_eq!(pixel[3],if inside{1.}else{0.});}}
        }
    }

    #[test]
    fn linked_refresh_host_immutable_publication_reopens_history_color_view_and_redo() {
        let(dir,mut engine,id,path)=fixture(16,"png");let before=engine.active().unwrap().doc.clone();let labels=engine.active().unwrap().history.entries();
        engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);
        super::super::super::execute_view_command(&mut engine,COMMAND,json!({"layer":id.0,"coalesce":"published-refresh"})).unwrap();let after=engine.active().unwrap().doc.clone();
        let mut session=super::super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();
        super::super::super::publish(&dir.0,&photo,&mut session).unwrap();let first_path=dir.0.join(format!("{}.pcraft",session.version));let first=super::super::super::bundle::portable_bytes(&first_path,super::super::super::MAX_INPUT_BYTES as usize).unwrap();
        std::fs::remove_file(path).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();super::super::super::publish(&dir.0,&photo,&mut session).unwrap();super::super::super::save_view(&dir.0,&session).unwrap();
        let mut reopened=super::super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();let state=reopened.engine.active().unwrap();assert_eq!(state.doc,before);assert_eq!(state.history.entries(),labels);assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));assert!(state.history.can_redo());assert_eq!(smart(&state.doc,id).source,smart(&before,id).source);
        reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);translated_pixels(&reopened.engine,id,16);
        assert_eq!(first,super::super::super::bundle::portable_bytes(&first_path,super::super::super::MAX_INPUT_BYTES as usize).unwrap());
    }
}
