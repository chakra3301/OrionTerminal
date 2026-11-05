use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Document, Layer, LayerMask, Metadata, PixelFormat, Rect, SampleType, Slice, SliceOrigin, SmartFilter, SmartObject};
use photocraft_raster::Surface;
use std::{io::Read, path::PathBuf, sync::{Weak, atomic::{AtomicBool, Ordering}}};

struct Directory(PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
fn directory() -> Directory {
    let path=std::env::temp_dir().join(format!("linked-refresh-all-{}",ulid::Ulid::new()));std::fs::create_dir_all(&path).unwrap();Directory(path)
}
fn rgba() -> Vec<u8> { vec![255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255] }
fn encoded(format:&str, pixels:Vec<u8>) -> Vec<u8> {
    let image=photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,pixels.clone()).unwrap();
    match format {
        "png"=>photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap(),
        "psd"|"psb"=>{use photocraft_psd::{Compression,LayerSpec,PixelData,PsdBuilder,Version};let mut builder=PsdBuilder::new(2,2).version(if format=="psb"{Version::Psb}else{Version::Psd}).compression(Compression::Raw);builder.push_layer(LayerSpec::new("Known",0,0,2,2,PixelData::Rgba8(pixels.clone())));builder.composite(PixelData::Rgba8(pixels));builder.to_bytes().unwrap()},
        "pcraft"=>photocraft_engine::smart_cmds::encode_source(&photocraft_io::import("source.png",&encoded("png",pixels)).unwrap().document).unwrap(),
        _=>unreachable!(),
    }
}
fn unsafe_filter() -> SmartFilter { SmartFilter { command:"plugin.run".into(),params:json!({"path":"must never execute","vendor":[1,null]}),visible:true,opacity:0.,blend:BlendMode::Normal } }
fn smart_layer(name:&str,source:SmartSource,x:i32,y:i32,format:PixelFormat) -> Layer {
    let mut cache=Surface::new(format);cache.fill_rect(Rect::from_xywh(x,y,1,1),&[0.25,0.5,0.75,1.]);
    let mut smart=SmartObject::new(source,Affine::translate(f64::from(x),f64::from(y)),Some(cache));
    smart.smart_filters.push(SmartFilter{command:"filter.cameraRaw".into(),params:json!({"exposure":0,"future":{"preserved":[null,3]}}),visible:true,opacity:1.,blend:BlendMode::Normal});
    let mut filter_mask=LayerMask::hide_all();filter_mask.enabled=false;filter_mask.linked=false;filter_mask.density=0.42;filter_mask.feather=1.25;smart.filter_mask=Some(filter_mask);smart.psd_raw=Some(Arc::new(b"retained placed metadata".to_vec()));
    let mut layer=Layer::new(name,LayerContent::Smart(smart));let mut mask=LayerMask::reveal_all();mask.linked=false;mask.density=0.6;layer.mask=Some(mask);layer.psd_blocks.push((*b"zzzz",Arc::new(b"unknown layer bytes".to_vec())));layer
}
struct Fixture { directory:Directory, engine:Session, ids:[LayerId;4], group:LayerId, embedded:LayerId, raster:LayerId, a:PathBuf, missing:PathBuf, d:PathBuf }
fn fixture(depth:u32,format:&str) -> Fixture {
    let directory=directory();let a=directory.0.join("repeated.png");let missing=directory.0.join("unavailable.png");let d=directory.0.join(format!("last.{format}"));std::fs::write(&a,encoded("png",rgba())).unwrap();std::fs::write(&d,encoded(format,rgba())).unwrap();
    let mut engine=Session::new();engine.execute("file.new",json!({"width":12,"height":10,"depth":depth})).unwrap();let pixel_format=engine.active().unwrap().doc.pixel_format();
    let first=smart_layer("First linked",SmartSource::Linked{path:a.to_string_lossy().into()},1,1,pixel_format);
    let mut repeated=smart_layer("Hidden disabled repeated linked",SmartSource::Linked{path:a.to_string_lossy().into()},5,1,pixel_format);repeated.visible=false;let LayerContent::Smart(smart)=&mut repeated.content else{unreachable!()};smart.filters_enabled=false;smart.smart_filters.push(unsafe_filter());
    let mut unavailable=smart_layer("Missing unsafe linked",SmartSource::Linked{path:missing.to_string_lossy().into()},1,5,pixel_format);let LayerContent::Smart(smart)=&mut unavailable.content else{unreachable!()};smart.smart_filters.push(unsafe_filter());
    let last=smart_layer("Last linked",SmartSource::Linked{path:d.to_string_lossy().into()},5,5,pixel_format);
    let ids=[first.id,repeated.id,unavailable.id,last.id];let nested=Layer::group("Nested linked",vec![unavailable,last]);let mut group=Layer::group("Hidden linked group",vec![repeated,nested]);group.visible=false;let group_id=group.id;
    let embedded=smart_layer("Excluded embedded",SmartSource::Embedded{file_name:"do-not-decode.png".into(),bytes:Arc::new(b"deliberately invalid excluded source".to_vec())},9,1,pixel_format);let embedded_id=embedded.id;let mut raster=Layer::raster("Active raster",pixel_format);raster.surface_mut().unwrap().fill_rect(Rect::from_xywh(9,5,1,1),&[0.8,0.2,0.4,1.]);let raster_id=raster.id;
    engine.edit("Nested refresh sources",|doc,active|{
        doc.layers=vec![first,group,embedded,raster];*active=Some(raster_id);
        let mut coverage=Surface::new(PixelFormat::GRAY8);coverage.fill_rect(Rect::from_xywh(3,2,2,3),&[0.5]);doc.selection=Some(coverage.clone());doc.channels.push(AlphaChannel::new("Retained alpha",coverage.clone()));doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));
        doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(ids[0]),rect:Rect::from_xywh(1,1,1,1),..Default::default()},Slice{id:2,origin:SliceOrigin::Layer,layer:Some(group_id),rect:Rect::from_xywh(5,1,1,1),..Default::default()},Slice{id:3,origin:SliceOrigin::Layer,layer:Some(LayerId(u64::MAX)),..Default::default()}];Ok(())
    }).unwrap();
    let index=engine.active_index().unwrap();engine.execute("document.activate",json!({"document":index})).unwrap();
    let state=engine.active_mut().unwrap();state.selected_layers=vec![raster_id,ids[0]];state.layer_anchor=Some(ids[0]);state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5];engine.tools.background=[0.7,0.6,0.5,0.4];let state=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:raster_id,mask:false,label:"Older retained Fade".into()});
    Fixture{directory,engine,ids,group:group_id,embedded:embedded_id,raster:raster_id,a,missing,d}
}
fn smart(doc:&Document,id:LayerId) -> &SmartObject {let LayerContent::Smart(smart)=&doc.layer(id).unwrap().content else{panic!("No Smart Object")};smart}
fn twin(engine:&Session) -> Session {
    let state=engine.active().unwrap();let mut copy=Session::new();copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None);*copy.active_mut().unwrap()=state.clone();copy.journal=engine.journal.clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.clipboard=engine.clipboard.clone();copy.style_clipboard=engine.style_clipboard.clone();copy.edit_state=engine.edit_state.clone();super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap();copy
}
fn same(actual:&Session,expected:&Session) {
    let a=actual.active().unwrap();let e=expected.active().unwrap();assert_eq!(a.doc,e.doc);assert_eq!(a.history.entries(),e.history.entries());assert_eq!(a.history.past_len(),e.history.past_len());for index in 0..a.history.past_len(){assert_eq!(a.history.state(index),e.history.state(index));}
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(e.revision,e.saved_revision,&e.coalesce,e.active_layer,&e.selected_layers,e.layer_anchor,&e.path,&e.last_damage));assert_eq!(a.channel_view,e.channel_view);assert_eq!(a.isolated_layers,e.isolated_layers);assert_eq!(a.fx_collapsed,e.fx_collapsed);
    assert_eq!(actual.journal,expected.journal);assert_eq!(actual.edit_state.fade,expected.edit_state.fade);assert_eq!(actual.tools.foreground,expected.tools.foreground);assert_eq!(actual.tools.background,expected.tools.background);assert_eq!(actual.tools.brush,expected.tools.brush);assert_eq!(actual.style_clipboard,expected.style_clipboard);assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard));assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(expected));assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(expected).unwrap());
}
fn unchanged(engine:&Session,before:&Session){same(engine,before);assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));}
fn host(engine:&mut Session,params:Value)->Result<Value,String>{super::super::super::execute_view_command(engine,ALL_COMMAND,params)}
fn literal_pixels(engine:&Session,id:LayerId,bytes:&[u8]) {
    let doc=&engine.active().unwrap().doc;let object=smart(doc,id);let surface=object.cache.as_ref().unwrap();let x0=object.transform.m[4] as i32;let y0=object.transform.m[5] as i32;let tolerance=match doc.depth{SampleType::U8=>1./255.,SampleType::U16=>2./65535.,SampleType::F32=>1e-6};
    for y in 0..10 {for x in 0..12 {let expected=if(x0..x0+2).contains(&x)&&(y0..y0+2).contains(&y){let at=((y-y0)*2+x-x0) as usize*4;[bytes[at] as f32/255.,bytes[at+1] as f32/255.,bytes[at+2] as f32/255.,bytes[at+3] as f32/255.]}else{[0.;4]};let actual=surface.pixel(x,y);for channel in 0..4{assert!((actual[channel]-expected[channel]).abs()<=tolerance,"{:?}/{id:?}/{x},{y}/{channel}:{} != {}",doc.depth,actual[channel],expected[channel]);}assert_eq!(actual[3],expected[3]);}}
}
fn checked(meta:&Metadata,object:&SmartObject)->Result<Option<super::super::Bytes>,String>{super::super::super::smart::source_bytes_checked(meta,&object.source,||super::super::admit(object))}

#[test]
fn linked_refresh_all_nested_four_formats_three_depths_match_native_order_pixels_and_single_edit() {
    for depth in [8,16,32]{for format in ["png","psd","psb","pcraft"]{
        let mut fixture=fixture(depth,format);assert!(!fixture.missing.exists());let before=fixture.engine.active().unwrap().doc.clone();let past=fixture.engine.active().unwrap().history.past_len();let journal=fixture.engine.journal.len();let mut native=twin(&fixture.engine);let params=json!({"layer":u64::MAX,"vendor":[1,null]});
        let result=host(&mut fixture.engine,params.clone()).unwrap();assert_eq!(result,native.execute(ALL_COMMAND,params).unwrap());assert_eq!(result,json!({"updated":[fixture.ids[0].0,fixture.ids[1].0,fixture.ids[3].0]}));same(&fixture.engine,&native);
        for id in [fixture.ids[0],fixture.ids[1],fixture.ids[3]]{literal_pixels(&fixture.engine,id,&rgba());let original=smart(&before,id);let mut retained=smart(&fixture.engine.active().unwrap().doc,id).clone();retained.cache=original.cache.clone();assert_eq!(&retained,original);}
        let doc=&fixture.engine.active().unwrap().doc;assert_eq!(smart(doc,fixture.ids[2]),smart(&before,fixture.ids[2]));assert_eq!(doc.layer(fixture.embedded),before.layer(fixture.embedded));assert_eq!(doc.layer(fixture.raster),before.layer(fixture.raster));assert_eq!(doc.selection,before.selection);assert_eq!(doc.channels,before.channels);assert_eq!(doc.quick_mask,before.quick_mask);assert_eq!(doc.slices.list[0].rect,Rect::new(1,1,3,3));assert!(doc.slices.list.iter().any(|slice|slice.layer==Some(fixture.group)));assert!(doc.slices.list.iter().all(|slice|slice.layer!=Some(LayerId(u64::MAX))));
        assert_eq!(fixture.engine.active().unwrap().history.past_len(),past+1);assert_eq!(fixture.engine.active().unwrap().history.undo_label(),Some(ALL_LABEL));assert_eq!(fixture.engine.journal.len(),journal+1);
        let after=doc.clone();fixture.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&fixture.engine,&native);assert!(Arc::ptr_eq(&fixture.engine.active().unwrap().doc,&before));fixture.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&fixture.engine,&native);assert_eq!(fixture.engine.active().unwrap().doc,after);
    }}
    let mut fixture=fixture(16,"png");let group=fixture.group;
    fixture.engine.edit("Stale layer slices",|doc,_|{doc.slices.list.iter_mut().find(|slice|slice.layer==Some(group)).unwrap().rect=Rect::from_xywh(99,99,1,1);doc.slices.list.push(Slice{id:3,origin:SliceOrigin::Layer,layer:Some(LayerId(u64::MAX)),..Default::default()});Ok(())}).unwrap();
    assert!(fixture.engine.active().unwrap().doc.slices.list.iter().any(|slice|slice.layer==Some(LayerId(u64::MAX))));let mut native=twin(&fixture.engine);
    host(&mut fixture.engine,json!({})).unwrap();native.execute(ALL_COMMAND,json!({})).unwrap();same(&fixture.engine,&native);
    let slices=&fixture.engine.active().unwrap().doc.slices.list;assert!(slices.iter().all(|slice|slice.layer!=Some(LayerId(u64::MAX))));assert_ne!(slices.iter().find(|slice|slice.layer==Some(group)).unwrap().rect,Rect::from_xywh(99,99,1,1));
}

#[test]
fn linked_refresh_all_resolves_each_depth_first_occurrence_and_drops_encoded_pin_before_next_read() {
    let mut fixture=fixture(16,"png");let red=[255,0,0,255].repeat(4);let blue=[0,0,255,255].repeat(4);let mut visits=Vec::new();let mut retired:Vec<Weak<Vec<u8>>>=Vec::new();let mut repeated=0;
    let result=run_all_with(&mut fixture.engine,&json!({}),|meta,object|{
        assert!(retired.iter().all(|weak|weak.upgrade().is_none()),"previous encoded occurrence pin retained");visits.push((object.transform.m[4] as i32,object.transform.m[5] as i32));
        if matches!(&object.source,SmartSource::Linked{path}if path.as_str()==fixture.a.to_string_lossy().as_ref()){repeated+=1;std::fs::write(&fixture.a,encoded("png",if repeated==1{red.clone()}else{blue.clone()})).unwrap();}
        let resolved=checked(meta,object)?;if let Some((_,bytes))=&resolved{retired.push(Arc::downgrade(bytes));}Ok(resolved)
    }).unwrap();
    assert_eq!(visits,vec![(1,1),(5,1),(1,5),(5,5)]);assert_eq!(repeated,2);assert_eq!(result,json!({"updated":[fixture.ids[0].0,fixture.ids[1].0,fixture.ids[3].0]}));assert!(retired.iter().all(|weak|weak.upgrade().is_none()));literal_pixels(&fixture.engine,fixture.ids[0],&red);literal_pixels(&fixture.engine,fixture.ids[1],&blue);literal_pixels(&fixture.engine,fixture.ids[3],&rgba());
    assert!(fixture.ids.iter().all(|id|matches!(smart(&fixture.engine.active().unwrap().doc,*id).source,SmartSource::Linked{..})));
}

#[test]
fn linked_refresh_all_missing_sources_skip_unsafe_admission_and_zero_updates_still_record_native_history() {
    for zero_linked in [false,true]{let mut fixture=fixture(16,"png");if zero_linked{fixture.engine.edit("No linked sources",|doc,_|{doc.layers.retain(|layer|[fixture.embedded,fixture.raster].contains(&layer.id));Ok(())}).unwrap();}else{std::fs::remove_file(&fixture.a).unwrap();std::fs::remove_file(&fixture.d).unwrap();}
        let before=fixture.engine.active().unwrap().doc.clone();let past=fixture.engine.active().unwrap().history.past_len();let mut native=twin(&fixture.engine);let mut reads=0;
        let result=run_all_with(&mut fixture.engine,&Value::Null,|meta,object|{reads+=1;super::super::super::smart::source_bytes_checked(meta,&object.source,||panic!("missing source must not enter admission"))}).unwrap();assert_eq!(result,native.execute(ALL_COMMAND,Value::Null).unwrap());assert_eq!(result,json!({"updated":[]}));same(&fixture.engine,&native);assert_eq!(reads,if zero_linked{0}else{4});
        assert_eq!(fixture.engine.active().unwrap().history.past_len(),past+1);assert_eq!(fixture.engine.active().unwrap().history.undo_label(),Some(ALL_LABEL));assert!(fixture.engine.journal.last().unwrap().1.is_null());assert_eq!(fixture.engine.active().unwrap().doc.layers,before.layers);
    }
}

#[test]
fn linked_refresh_all_late_corrupt_oversize_unsafe_and_growing_read_errors_are_atomic() {
    for failure in ["corrupt","oversize","unsafe","growing"]{
        let mut fixture=fixture(16,"png");if failure=="corrupt"{std::fs::write(&fixture.d,b"corrupt later source").unwrap();}if failure=="oversize"{std::fs::OpenOptions::new().write(true).open(&fixture.d).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();}if failure=="unsafe"{fixture.engine.edit("Unsafe final stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(fixture.ids[3]).unwrap().content else{unreachable!()};object.smart_filters.push(unsafe_filter());Ok(())}).unwrap();std::fs::write(&fixture.d,b"must refuse before decode").unwrap();}
        let before=twin(&fixture.engine);let mut visited=Vec::new();let error=run_all_with(&mut fixture.engine,&json!({}),|meta,object|{
            visited.push((object.transform.m[4] as i32,object.transform.m[5] as i32));
            if failure=="growing"&&object.transform.m[5]==5.&&object.transform.m[4]==5.{struct Growing{read:usize,max:usize}impl Read for Growing{fn read(&mut self,out:&mut[u8])->std::io::Result<usize>{self.max=self.max.max(out.len());out.fill(0x7a);self.read+=out.len();Ok(out.len())}}let mut reader=Growing{read:0,max:0};let result=super::super::super::smart::replay_read_with_limit(&mut reader,32);assert_eq!(reader.read,33);assert!(reader.max<=64*1024);return result.map(|bytes|Some(("growing.png".into(),Arc::new(bytes))));}
            checked(meta,object)
        }).unwrap_err();assert_eq!(visited,vec![(1,1),(5,1),(1,5),(5,5)]);unchanged(&fixture.engine,&before);
        match failure{"oversize"|"growing"=>assert!(error.contains("512MB")),"unsafe"=>assert!(error.contains("does not support")),_=>{let mut native=twin(&before);assert_eq!(error,native.execute(ALL_COMMAND,json!({})).unwrap_err().to_string());unchanged(&native,&before);}}
    }
}

#[test]
fn linked_refresh_all_metadata_authority_precedes_disk_and_preserves_raw_blocks_and_references() {
    use photocraft_io::linked::{encode_linked_file,LinkedFile};let mut fixture=fixture(16,"png");let blue=[0,0,255,255].repeat(4);let mut blocks=encode_linked_file(&LinkedFile{uuid:fixture.a.to_string_lossy().into(),file_name:"authoritative.png".into(),bytes:encoded("png",blue.clone())});blocks.extend(encode_linked_file(&LinkedFile{uuid:fixture.a.to_string_lossy().into(),file_name:"later.png".into(),bytes:encoded("png",rgba())}));
    fixture.engine.edit("Native linked metadata",|doc,_|{doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(blocks)));Ok(())}).unwrap();std::fs::write(&fixture.a,b"disk must not decode").unwrap();let before=fixture.engine.active().unwrap().doc.clone();let mut native=twin(&fixture.engine);assert_eq!(host(&mut fixture.engine,json!({})).unwrap(),native.execute(ALL_COMMAND,json!({})).unwrap());same(&fixture.engine,&native);
    literal_pixels(&fixture.engine,fixture.ids[0],&blue);literal_pixels(&fixture.engine,fixture.ids[1],&blue);literal_pixels(&fixture.engine,fixture.ids[3],&rgba());assert_eq!(fixture.engine.active().unwrap().doc.metadata,before.metadata);for id in fixture.ids{assert_eq!(smart(&fixture.engine.active().unwrap().doc,id).source,smart(&before,id).source);}
}

#[test]
fn linked_refresh_all_null_explicit_ignored_targets_and_coalescing_match_native_once() {
    let mut fixture=fixture(32,"png");let before=fixture.engine.active().unwrap().doc.clone();let past=fixture.engine.active().unwrap().history.past_len();let mut native=twin(&fixture.engine);
    for params in [json!({"coalesce":"all-refresh","layer":u64::MAX,"target":"quickMask"}),json!({"coalesce":"all-refresh","layer":null}),json!({"coalesce":"all-refresh","width":"ignored"})]{assert_eq!(host(&mut fixture.engine,params.clone()).unwrap(),native.execute(ALL_COMMAND,params).unwrap());same(&fixture.engine,&native);}
    assert_eq!(fixture.engine.active().unwrap().history.past_len(),past+1);assert_eq!(fixture.engine.active().unwrap().history.undo_label(),Some(ALL_LABEL));let after=fixture.engine.active().unwrap().doc.clone();fixture.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&fixture.engine,&native);assert!(Arc::ptr_eq(&fixture.engine.active().unwrap().doc,&before));fixture.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&fixture.engine,&native);assert_eq!(fixture.engine.active().unwrap().doc,after);
}

#[test]
fn linked_refresh_all_alpha_quick_mask_and_layer_mask_views_do_not_redirect_refresh() {
    for context in ["alpha","quickMask","mask"]{
        let mut fixture=fixture(16,"png");match context{
            "alpha"=>fixture.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0),
            "quickMask"=>fixture.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Composite,
            _=>{fixture.engine.select_layer(fixture.ids[0]).unwrap();fixture.engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},
        }
        let before=fixture.engine.active().unwrap().doc.clone();let mut native=twin(&fixture.engine);let params=json!({"target":"pixels","layer":u64::MAX});assert_eq!(host(&mut fixture.engine,params.clone()).unwrap(),native.execute(ALL_COMMAND,params).unwrap());same(&fixture.engine,&native);
        let doc=&fixture.engine.active().unwrap().doc;assert_eq!(doc.selection,before.selection);assert_eq!(doc.channels,before.channels);assert_eq!(doc.quick_mask,before.quick_mask);for id in fixture.ids{assert_eq!(doc.layer(id).unwrap().mask,before.layer(id).unwrap().mask);}for id in [fixture.ids[0],fixture.ids[1],fixture.ids[3]]{literal_pixels(&fixture.engine,id,&rgba());}
    }
}

#[test]
fn linked_refresh_all_pending_owner_preset_flush_matches_native_only_after_complete_success() {
    use photocraft_engine::preset_store::{open,MemBackend};let mut fixture=fixture(16,"png");let mut native=twin(&fixture.engine);let actual=MemBackend::default();let expected=MemBackend::default();fixture.engine.attach_preset_store(open(Box::new(actual.clone())));native.attach_preset_store(open(Box::new(expected.clone())));
    for owner in [&mut fixture.engine,&mut native]{let mut preset=owner.tools.presets[0].clone();preset.name="Pending Update All brush".into();preset.group="Update All owner".into();preset.builtin=false;owner.tools.presets.push(preset);owner.brush_presets_changed();}
    let files=actual.files.lock().unwrap().clone();let before=twin(&fixture.engine);std::fs::write(&fixture.d,b"last source corrupt").unwrap();assert!(host(&mut fixture.engine,json!({})).is_err());assert!(native.execute(ALL_COMMAND,json!({})).is_err());same(&fixture.engine,&native);unchanged(&fixture.engine,&before);assert_eq!(*actual.files.lock().unwrap(),files);assert_eq!(*expected.files.lock().unwrap(),files);
    std::fs::write(&fixture.d,encoded("png",rgba())).unwrap();host(&mut fixture.engine,json!({})).unwrap();native.execute(ALL_COMMAND,json!({})).unwrap();same(&fixture.engine,&native);let after=actual.files.lock().unwrap().clone();assert_ne!(after,files);assert_eq!(after,*expected.files.lock().unwrap());assert!(open(Box::new(actual)).presets.iter().any(|preset|preset.name=="Pending Update All brush"));
}

#[test]
fn linked_refresh_all_host_publication_reopens_immutable_linked_history_with_redo_and_color_view() {
    let mut fixture=fixture(16,"psb");fixture.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);let before=fixture.engine.active().unwrap().doc.clone();let labels=fixture.engine.active().unwrap().history.entries();host(&mut fixture.engine,json!({"coalesce":"published-all"})).unwrap();let after=fixture.engine.active().unwrap().doc.clone();
    let mut session=super::super::super::PhotoSession{engine:fixture.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();super::super::super::publish(&fixture.directory.0,&photo,&mut session).unwrap();let path=fixture.directory.0.join(format!("{}.pcraft",session.version));let bytes=super::super::super::bundle::portable_bytes(&path,super::super::super::MAX_INPUT_BYTES as usize).unwrap();
    std::fs::remove_file(&fixture.a).unwrap();std::fs::remove_file(&fixture.d).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();super::super::super::publish(&fixture.directory.0,&photo,&mut session).unwrap();super::super::super::save_view(&fixture.directory.0,&session).unwrap();let mut reopened=super::super::super::restore_with_settings(&fixture.directory.0,&session.version,None,false).unwrap();let state=reopened.engine.active().unwrap();assert_eq!(state.doc,before);assert_eq!(state.history.entries(),labels);assert!(state.history.can_redo());assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));
    reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);for id in [fixture.ids[0],fixture.ids[1],fixture.ids[3]]{literal_pixels(&reopened.engine,id,&rgba());assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);}reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(bytes,super::super::super::bundle::portable_bytes(&path,super::super::super::MAX_INPUT_BYTES as usize).unwrap());
}

#[test]
fn linked_refresh_all_no_document_invalid_parameters_and_active_job_keep_native_precedence() {
    let mut empty=Session::new();let error=execute(&mut empty,ALL_COMMAND,&json!({})).unwrap().unwrap_err();assert_eq!(error,empty.execute(ALL_COMMAND,json!({})).unwrap_err().to_string());assert!(empty.journal.is_empty());
    for params in [json!([]),json!(42),json!("invalid")]{let mut fixture=fixture(8,"png");let before=twin(&fixture.engine);let mut native=twin(&fixture.engine);assert!(execute(&mut fixture.engine,ALL_COMMAND,&params).is_none());assert_eq!(host(&mut fixture.engine,params.clone()).unwrap_err(),native.execute(ALL_COMMAND,params).unwrap_err().to_string());unchanged(&fixture.engine,&before);}
    let mut fixture=fixture(8,"png");let release=Arc::new(AtomicBool::new(false));let worker=release.clone();struct Release(Arc<AtomicBool>);impl Drop for Release{fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}let _release=Release(release.clone());
    let started=fixture.engine.start_job("all-refresh-test",json!({}),"Retained Update All job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected native job")};let before=twin(&fixture.engine);std::fs::remove_file(&fixture.a).unwrap();std::fs::remove_file(&fixture.d).unwrap();let error=host(&mut fixture.engine,json!({})).unwrap_err();assert_eq!(error,fixture.engine.execute(ALL_COMMAND,json!({})).unwrap_err().to_string());assert!(error.contains("Retained Update All job"));unchanged(&fixture.engine,&before);release.store(true,Ordering::Relaxed);fixture.engine.wait_job(job).unwrap();
}
