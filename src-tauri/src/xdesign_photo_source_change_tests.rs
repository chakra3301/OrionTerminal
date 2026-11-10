use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Layer, LayerMask, PixelFormat, Rect, SampleType, Slice, SliceOrigin, SmartFilter};
use photocraft_raster::Surface;
use std::{io::Read, path::{Path,PathBuf}, sync::atomic::{AtomicBool,Ordering}};

struct Directory(PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
fn directory() -> Directory { let path=std::env::temp_dir().join(format!("source-change-{}",ulid::Ulid::new()));std::fs::create_dir_all(&path).unwrap();Directory(path) }
fn rgba() -> Vec<u8> { vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255] }
fn encoded(format:&str,pixels:Vec<u8>) -> Vec<u8> {
    match format {
        "png"=>{let image=photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,pixels).unwrap();photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap()},
        "psd"|"psb"=>{use photocraft_psd::{Compression,LayerSpec,PixelData,PsdBuilder,Version};let mut builder=PsdBuilder::new(2,2).version(if format=="psb"{Version::Psb}else{Version::Psd}).compression(Compression::Raw);builder.push_layer(LayerSpec::new("Known",0,0,2,2,PixelData::Rgba8(pixels.clone())));builder.composite(PixelData::Rgba8(pixels));builder.to_bytes().unwrap()},
        "pcraft"=>photocraft_engine::smart_cmds::encode_source(&photocraft_io::import("source.png",&encoded("png",pixels)).unwrap().document).unwrap(),
        _=>unreachable!(),
    }
}
fn object_layer(name:&str,source:SmartSource,x:i32,y:i32,format:PixelFormat) -> Layer {
    let mut cache=Surface::new(format);cache.fill_rect(Rect::from_xywh(x,y,1,1),&[0.25,0.5,0.75,1.]);
    let mut object=SmartObject::new(source,Affine::translate(f64::from(x),f64::from(y)),Some(cache));
    object.smart_filters=vec![SmartFilter{command:"filter.cameraRaw".into(),params:json!({"exposure":0,"vendor":{"retain":[null,7]}}),visible:true,opacity:1.,blend:BlendMode::Normal},SmartFilter{command:"filter.other.offset".into(),params:json!({"horizontal":1,"vertical":0,"undefinedAreas":"transparent","vendor":"non-neutral ordered shift"}),visible:true,opacity:1.,blend:BlendMode::Normal},SmartFilter{command:"filter.other.offset".into(),params:json!({"horizontal":99,"vertical":99}),visible:false,opacity:0.63,blend:BlendMode::Multiply}];
    let mut filter_mask=LayerMask::hide_all();filter_mask.enabled=false;filter_mask.linked=false;filter_mask.density=0.42;filter_mask.feather=1.25;object.filter_mask=Some(filter_mask);object.psd_raw=Some(Arc::new(b"old placed metadata".to_vec()));
    let mut layer=Layer::new(name,LayerContent::Smart(object));let mut mask=LayerMask::reveal_all();mask.linked=false;mask.density=0.6;layer.mask=Some(mask);
    for key in [*b"SoLd",*b"SoLE",*b"PlLd",*b"zzzz"]{layer.psd_blocks.push((key,Arc::new([key.as_slice(),b" retained"].concat())));}layer
}
struct Fixture { directory:Directory,engine:Session,id:LayerId,linked:LayerId,embedded:LayerId,raster:LayerId,donor:PathBuf,bytes:Vec<u8> }
fn fixture(depth:u32,format:&str) -> Fixture {
    let directory=directory();let donor=directory.0.join(format!("new-source.{format}"));let bytes=encoded(format,rgba());std::fs::write(&donor,&bytes).unwrap();
    let mut engine=Session::new();engine.execute("file.new",json!({"width":12,"height":10,"depth":depth})).unwrap();let format=engine.active().unwrap().doc.pixel_format();
    let active=object_layer("Active embedded",SmartSource::Embedded{file_name:"old.png".into(),bytes:Arc::new(encoded("png",[255,0,255,255].repeat(4)))},2,1,format);
    let mut linked=object_layer("Inactive linked",SmartSource::Linked{path:directory.0.join("old-missing.png").to_string_lossy().into()},6,5,format);linked.visible=false;
    let embedded=object_layer("Inactive embedded",SmartSource::Embedded{file_name:"inactive.png".into(),bytes:Arc::new(encoded("png",[0,255,255,255].repeat(4)))},8,1,format);let raster=Layer::raster("Excluded raster",format);let ids=[active.id,linked.id,embedded.id,raster.id];
    engine.edit("Source-change fixture",|doc,current|{doc.layers=vec![active,Layer::group("Retained group",vec![linked]),embedded,raster];*current=Some(ids[0]);let mut coverage=Surface::new(PixelFormat::GRAY8);coverage.fill_rect(Rect::from_xywh(3,2,2,3),&[0.5]);doc.selection=Some(coverage.clone());doc.channels.push(AlphaChannel::new("Retained alpha",coverage.clone()));doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"unrelated global bytes".to_vec())));doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(ids[0]),rect:Rect::from_xywh(2,1,1,1),..Default::default()}];Ok(())}).unwrap();
    let index=engine.active_index().unwrap();engine.execute("document.activate",json!({"document":index})).unwrap();let state=engine.active_mut().unwrap();state.selected_layers=vec![ids[0],ids[1]];state.layer_anchor=Some(ids[1]);state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5];engine.tools.background=[0.7,0.6,0.5,0.4];let state=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:ids[0],mask:false,label:"Older retained Fade".into()});
    Fixture{directory,engine,id:ids[0],linked:ids[1],embedded:ids[2],raster:ids[3],donor,bytes}
}
fn smart(doc:&Document,id:LayerId) -> &SmartObject {let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else{panic!("No Smart Object")};object}
fn twin(engine:&Session) -> Session {
    let state=engine.active().unwrap();let mut copy=Session::new();copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None);*copy.active_mut().unwrap()=state.clone();copy.journal=engine.journal.clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.clipboard=engine.clipboard.clone();copy.style_clipboard=engine.style_clipboard.clone();copy.edit_state=engine.edit_state.clone();super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap();copy
}
fn same(actual:&Session,expected:&Session) {
    let a=actual.active().unwrap();let e=expected.active().unwrap();assert_eq!(a.doc,e.doc);assert_eq!(a.history.entries(),e.history.entries());assert_eq!(a.history.past_len(),e.history.past_len());for index in 0..a.history.past_len(){assert_eq!(a.history.state(index),e.history.state(index));}assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(e.revision,e.saved_revision,&e.coalesce,e.active_layer,&e.selected_layers,e.layer_anchor,&e.path,&e.last_damage));assert_eq!(a.channel_view,e.channel_view);assert_eq!(a.isolated_layers,e.isolated_layers);assert_eq!(a.fx_collapsed,e.fx_collapsed);assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",e.symmetry_path));
    assert_eq!(actual.journal,expected.journal);assert_eq!(actual.edit_state.fade,expected.edit_state.fade);assert_eq!(actual.tools.foreground,expected.tools.foreground);assert_eq!(actual.tools.background,expected.tools.background);assert_eq!(actual.tools.brush,expected.tools.brush);assert_eq!(actual.style_clipboard,expected.style_clipboard);assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard));assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(expected));assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(expected).unwrap());
}
fn unchanged(engine:&Session,before:&Session){same(engine,before);assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));}
fn host(engine:&mut Session,command:&str,params:Value)->Result<Value,String>{super::super::super::execute_view_command(engine,command,params)}
fn request(f:&Fixture)->Value{json!({"path":f.donor.to_string_lossy(),"layer":f.id.0,"vendor":[null,5]})}
fn checked(meta:&Metadata,object:&SmartObject,new_source:&SmartSource)->Result<Option<super::super::Bytes>,String>{super::super::super::smart::source_bytes_checked(meta,new_source,||super::super::admit(object))}
fn disk(path:&Path)->Result<Vec<u8>,String>{super::super::super::input::read_source_file(path)}
fn final_source(engine:&Session,id:LayerId,command:&str,path:&Path,bytes:&[u8]) {
    let source=&smart(&engine.active().unwrap().doc,id).source;
    if command==RELINK_COMMAND{assert_eq!(source,&SmartSource::Linked{path:path.to_string_lossy().into()});}else{let SmartSource::Embedded{file_name,bytes:actual}=source else{panic!("Not embedded")};assert_eq!(file_name,path.file_name().unwrap().to_str().unwrap());assert_eq!(actual.as_slice(),bytes);}
}
fn pixels(engine:&Session,id:LayerId,raw:&[u8],shift:i32) {
    let doc=&engine.active().unwrap().doc;let object=smart(doc,id);let surface=object.cache.as_ref().unwrap();let x0=object.transform.m[4] as i32+shift;let y0=object.transform.m[5] as i32;let tolerance=match doc.depth{SampleType::U8=>1./255.,SampleType::U16=>2./65535.,SampleType::F32=>1e-6};
    for y in 0..10{for x in 0..12{let expected=if(x0..x0+2).contains(&x)&&(y0..y0+2).contains(&y){let at=((y-y0)*2+x-x0)as usize*4;[raw[at]as f32/255.,raw[at+1]as f32/255.,raw[at+2]as f32/255.,raw[at+3]as f32/255.]}else{[0.;4]};let actual=surface.pixel(x,y);for channel in 0..4{assert!((actual[channel]-expected[channel]).abs()<=tolerance,"{:?}/{id:?}/{x},{y}/{channel}: {} != {}",doc.depth,actual[channel],expected[channel]);}assert_eq!(actual[3],expected[3]);}}
}
fn unsafe_filter()->SmartFilter{SmartFilter{command:"plugin.run".into(),params:json!({"path":"must never execute"}),visible:true,opacity:0.,blend:BlendMode::Normal}}
fn make_unsafe(f:&mut Fixture){let id=f.id;f.engine.edit("Unsafe current stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.smart_filters.push(unsafe_filter());Ok(())}).unwrap();}

#[test]
fn source_change_four_formats_three_depths_match_native_non_neutral_pixels_and_detach_only_placed_metadata(){
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{for depth in [8,16,32]{for format in ["png","psd","psb","pcraft"]{
        let mut f=fixture(depth,format);let before=f.engine.active().unwrap().doc.clone();let past=f.engine.active().unwrap().history.past_len();let journal=f.engine.journal.len();let mut native=twin(&f.engine);let params=request(&f);assert_eq!(host(&mut f.engine,command,params.clone()).unwrap(),native.execute(command,params).unwrap());same(&f.engine,&native);final_source(&f.engine,f.id,command,&f.donor,&f.bytes);pixels(&f.engine,f.id,&rgba(),1);
        let after=f.engine.active().unwrap().doc.clone();let mut retained=smart(&after,f.id).clone();retained.source=smart(&before,f.id).source.clone();retained.cache=smart(&before,f.id).cache.clone();retained.psd_raw=smart(&before,f.id).psd_raw.clone();assert_eq!(&retained,smart(&before,f.id));assert!(smart(&after,f.id).psd_raw.is_none());assert_eq!(after.layer(f.id).unwrap().psd_blocks,vec![(*b"zzzz",Arc::new(b"zzzz retained".to_vec()))]);assert_eq!(after.layer(f.id).unwrap().mask,before.layer(f.id).unwrap().mask);
        for id in [f.linked,f.embedded,f.raster]{assert_eq!(after.layer(id),before.layer(id));}assert_eq!(after.metadata,before.metadata);assert_eq!(after.selection,before.selection);assert_eq!(after.channels,before.channels);assert_eq!(after.quick_mask,before.quick_mask);assert_eq!(after.slices.list[0].rect,Rect::new(3,1,5,3));assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);assert_eq!(f.engine.journal.len(),journal+1);
        f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native);assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&f.engine,&native);assert_eq!(f.engine.active().unwrap().doc,after);
    }}}
}

#[test]
fn source_change_relink_new_path_metadata_authority_and_replace_disk_ignore_the_same_collision(){
    use photocraft_io::linked::{encode_linked_file,LinkedFile};
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{let mut f=fixture(16,"png");let blue=[0,0,255,255].repeat(4);let disk_pixels=rgba();let bytes=encoded("png",blue.clone());let mut blocks=encode_linked_file(&LinkedFile{uuid:f.donor.to_string_lossy().into(),file_name:"metadata.png".into(),bytes});blocks.extend(encode_linked_file(&LinkedFile{uuid:f.donor.to_string_lossy().into(),file_name:"later.png".into(),bytes:encoded("png",[255,0,255,255].repeat(4))}));f.engine.edit("New-path metadata",|doc,_|{doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(blocks)));Ok(())}).unwrap();let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);let params=request(&f);host(&mut f.engine,command,params.clone()).unwrap();native.execute(command,params).unwrap();same(&f.engine,&native);pixels(&f.engine,f.id,if command==RELINK_COMMAND{&blue}else{&disk_pixels},1);final_source(&f.engine,f.id,command,&f.donor,&f.bytes);assert_eq!(f.engine.active().unwrap().doc.metadata,before.metadata);}
}

#[test]
fn source_change_relink_reads_new_source_once_and_keeps_reference_after_donor_deletion(){
    let mut f=fixture(16,"png");let path=f.donor.to_string_lossy().into_owned();let params=request(&f);let mut reads=0;let mut weak=None;let before_source=smart(&f.engine.active().unwrap().doc,f.id).source.clone();
    run_relink_with(&mut f.engine,&params,f.id,&path,|meta,object,new_source|{reads+=1;assert_eq!(object.source,before_source);assert_eq!(new_source,&SmartSource::Linked{path:path.clone()});let source=checked(meta,object,new_source)?;weak=source.as_ref().map(|(_,bytes)|Arc::downgrade(bytes));std::fs::remove_file(&f.donor).unwrap();Ok(source)}).unwrap();
    assert_eq!(reads,1);assert!(weak.unwrap().upgrade().is_none(),"transient relink pin must retire");final_source(&f.engine,f.id,RELINK_COMMAND,&f.donor,&[]);pixels(&f.engine,f.id,&rgba(),1);assert!(!f.donor.exists());
}

#[test]
fn source_change_replace_reads_disk_once_and_final_embedded_bytes_survive_donor_mutation(){
    let mut f=fixture(16,"psb");let path=f.donor.to_string_lossy().into_owned();let params=request(&f);let mut reads=0;let mut data_pointer=std::ptr::null();
    run_replace_with(&mut f.engine,&params,&path,|actual|{reads+=1;assert_eq!(actual,f.donor.as_path());let bytes=disk(actual)?;data_pointer=bytes.as_ptr();std::fs::write(actual,b"mutated after opened-handle read").unwrap();Ok(bytes)}).unwrap();
    assert_eq!(reads,1);final_source(&f.engine,f.id,REPLACE_COMMAND,&f.donor,&f.bytes);pixels(&f.engine,f.id,&rgba(),1);let SmartSource::Embedded{bytes,..}=&smart(&f.engine.active().unwrap().doc,f.id).source else{unreachable!()};assert_eq!(bytes.as_ptr(),data_pointer);std::fs::remove_file(&f.donor).unwrap();
}

#[test]
fn source_change_relink_target_errors_precede_source_and_missing_precedes_admission(){
    for target in ["stale","raster"]{let mut f=fixture(8,"png");std::fs::write(&f.donor,b"corrupt donor").unwrap();let params=json!({"path":f.donor.to_string_lossy(),"layer":if target=="stale"{u64::MAX}else{f.raster.0}});let before=twin(&f.engine);let mut native=twin(&f.engine);assert_eq!(host(&mut f.engine,RELINK_COMMAND,params.clone()).unwrap_err(),native.execute(RELINK_COMMAND,params).unwrap_err().to_string());unchanged(&f.engine,&before);}
    let mut f=fixture(16,"png");make_unsafe(&mut f);std::fs::remove_file(&f.donor).unwrap();let before=twin(&f.engine);let path=f.donor.to_string_lossy().into_owned();let params=request(&f);let mut reads=0;
    let error=run_relink_with(&mut f.engine,&params,f.id,&path,|meta,_,new_source|{reads+=1;super::super::super::smart::source_bytes_checked(meta,new_source,||panic!("missing donor must not enter stack admission"))}).unwrap_err();assert_eq!(reads,1);let mut native=twin(&before);assert_eq!(error,native.execute(RELINK_COMMAND,params.clone()).unwrap_err().to_string());assert_eq!(host(&mut f.engine,RELINK_COMMAND,params).unwrap_err(),error);unchanged(&f.engine,&before);
}

#[test]
fn source_change_replace_read_decode_then_target_then_stack_error_priority_matches_native(){
    for bad_target in [true,false]{for donor_valid in [true,false]{let mut f=fixture(16,"png");make_unsafe(&mut f);if !donor_valid{std::fs::write(&f.donor,b"corrupt donor").unwrap();}let params=json!({"path":f.donor.to_string_lossy(),"layer":if bad_target{u64::MAX}else{f.id.0}});let before=twin(&f.engine);let mut native=twin(&f.engine);let error=host(&mut f.engine,REPLACE_COMMAND,params.clone()).unwrap_err();if bad_target||!donor_valid{assert_eq!(error,native.execute(REPLACE_COMMAND,params).unwrap_err().to_string());}else{assert!(error.contains("does not support"));}unchanged(&f.engine,&before);}}
    let mut f=fixture(8,"png");let params=json!({"path":f.donor.to_string_lossy(),"layer":u64::MAX});let path=f.donor.to_string_lossy().into_owned();let before=twin(&f.engine);let mut reads=0;
    let error=run_replace_with(&mut f.engine,&params,&path,|_|{reads+=1;Err("independent read failure".into())}).unwrap_err();assert_eq!(reads,1);assert!(error.contains("independent read failure"));assert!(error.contains("can't read"));unchanged(&f.engine,&before);
    let mut panics=0;let error=run_replace_with(&mut f.engine,&params,&path,|_|{panics+=1;panic!("independent predecode reader panic")}).unwrap_err();assert_eq!(panics,1);assert!(error.contains(REPLACE_COMMAND));assert!(error.contains("failed with an internal error"));assert!(error.contains("the document is unchanged"));unchanged(&f.engine,&before);
}

#[test]
fn source_change_missing_corrupt_oversize_unsafe_and_bounded_growing_failures_are_atomic(){
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{for failure in ["missing","corrupt","oversize","unsafe","growing"]{let mut f=fixture(16,"png");match failure{"missing"=>std::fs::remove_file(&f.donor).unwrap(),"corrupt"=>std::fs::write(&f.donor,b"corrupt source").unwrap(),"oversize"=>std::fs::OpenOptions::new().write(true).open(&f.donor).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap(),"unsafe"=>make_unsafe(&mut f),_=>{}}let before=twin(&f.engine);let params=request(&f);let path=f.donor.to_string_lossy().into_owned();
        let error=if failure=="growing"{struct Growing{read:usize,max:usize}impl Read for Growing{fn read(&mut self,out:&mut[u8])->std::io::Result<usize>{self.max=self.max.max(out.len());out.fill(0x7a);self.read+=out.len();Ok(out.len())}}let mut reader=Growing{read:0,max:0};let error=if command==RELINK_COMMAND{run_relink_with(&mut f.engine,&params,f.id,&path,|_,_,_|super::super::super::smart::replay_read_with_limit(&mut reader,32).map(|bytes|Some(("growing.png".into(),Arc::new(bytes))))).unwrap_err()}else{run_replace_with(&mut f.engine,&params,&path,|_|super::super::super::smart::replay_read_with_limit(&mut reader,32)).unwrap_err()};assert_eq!(reader.read,33);assert!(reader.max<=64*1024);error}else{host(&mut f.engine,command,params.clone()).unwrap_err()};unchanged(&f.engine,&before);
        match failure{"oversize"|"growing"=>assert!(error.contains("512MB")),"unsafe"=>assert!(error.contains("does not support")),_=>{let mut native=twin(&before);assert_eq!(error,native.execute(command,params).unwrap_err().to_string());unchanged(&native,&before);}}
    }}
}

#[test]
fn source_change_mixed_command_coalescing_keeps_first_label_exact_journal_and_older_fade(){
    for first in [RELINK_COMMAND,REPLACE_COMMAND]{let mut f=fixture(32,"png");let before=f.engine.active().unwrap().doc.clone();let fade=f.engine.edit_state.fade.clone();let past=f.engine.active().unwrap().history.past_len();let journal=f.engine.journal.len();let mut native=twin(&f.engine);for command in [first,if first==RELINK_COMMAND{REPLACE_COMMAND}else{RELINK_COMMAND},first]{let params=json!({"path":f.donor.to_string_lossy(),"coalesce":"mixed-source","layer":f.id.0});host(&mut f.engine,command,params.clone()).unwrap();native.execute(command,params).unwrap();same(&f.engine,&native);assert_eq!(f.engine.edit_state.fade,fade);}assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);assert_eq!(f.engine.active().unwrap().history.undo_label(),Some(if first==RELINK_COMMAND{RELINK_LABEL}else{REPLACE_LABEL}));assert_eq!(f.engine.journal.len(),journal+3);let after=f.engine.active().unwrap().doc.clone();f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native);assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&f.engine,&native);assert_eq!(f.engine.active().unwrap().doc,after);}
}

#[test]
fn source_change_active_embedded_enablement_and_inactive_targets_preserve_native_fallback(){
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{for target in ["default","null","string","negative","fractional","linked","embedded"]{let mut f=fixture(8,"png");let (value,id)=match target{"default"=>(None,f.id),"null"=>(Some(Value::Null),f.id),"string"=>(Some(json!("bad")),f.id),"negative"=>(Some(json!(-1)),f.id),"fractional"=>(Some(json!(1.5)),f.id),"linked"=>(Some(json!(f.linked.0)),f.linked),_=>(Some(json!(f.embedded.0)),f.embedded)};let mut params=json!({"path":f.donor.to_string_lossy()});if let Some(value)=value{params["layer"]=value;}let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);assert_eq!(host(&mut f.engine,command,params.clone()).unwrap(),native.execute(command,params).unwrap());same(&f.engine,&native);final_source(&f.engine,id,command,&f.donor,&f.bytes);pixels(&f.engine,id,&rgba(),1);if id!=f.id{assert_eq!(f.engine.active().unwrap().doc.layer(f.id),before.layer(f.id));}}}
}

#[test]
fn source_change_channel_mask_disabled_and_stale_slice_posthooks_preserve_actual_pixels(){
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{for context in ["alpha","quickMask","mask","disabled","staleSlices"]{let mut f=fixture(16,"png");let id=f.id;match context{"quickMask"=>f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Composite,"mask"=>{f.engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},"disabled"=>{make_unsafe(&mut f);f.engine.edit("Disabled stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.filters_enabled=false;Ok(())}).unwrap();},"staleSlices"=>{f.engine.edit("Stale slices",|doc,_|{doc.slices.list[0].rect=Rect::from_xywh(99,99,1,1);doc.slices.list.push(Slice{id:2,origin:SliceOrigin::Layer,layer:Some(LayerId(u64::MAX)),..Default::default()});Ok(())}).unwrap();},_=>{}}let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);let mut params=request(&f);params["target"]=json!("pixels");host(&mut f.engine,command,params.clone()).unwrap();native.execute(command,params).unwrap();same(&f.engine,&native);let doc=&f.engine.active().unwrap().doc;assert_eq!(doc.selection,before.selection);assert_eq!(doc.quick_mask,before.quick_mask);assert_eq!(doc.channels,before.channels);assert_eq!(doc.layer(id).unwrap().mask,before.layer(id).unwrap().mask);assert_eq!(doc.slices.list.len(),1);pixels(&f.engine,id,&rgba(),if context=="disabled"{0}else{1});}}
}

#[test]
fn source_change_pending_owner_preset_store_flushes_only_after_success_for_both_commands(){
    use photocraft_engine::preset_store::{open,MemBackend};
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{let mut f=fixture(16,"png");let mut native=twin(&f.engine);let actual=MemBackend::default();let expected=MemBackend::default();f.engine.attach_preset_store(open(Box::new(actual.clone())));native.attach_preset_store(open(Box::new(expected.clone())));for owner in [&mut f.engine,&mut native]{let mut preset=owner.tools.presets[0].clone();preset.name="Pending source-change brush".into();preset.group="Source-change owner".into();preset.builtin=false;owner.tools.presets.push(preset);owner.brush_presets_changed();}let files=actual.files.lock().unwrap().clone();let before=twin(&f.engine);std::fs::write(&f.donor,b"corrupt source").unwrap();let params=request(&f);assert!(host(&mut f.engine,command,params.clone()).is_err());assert!(native.execute(command,params.clone()).is_err());same(&f.engine,&native);unchanged(&f.engine,&before);assert_eq!(*actual.files.lock().unwrap(),files);assert_eq!(*expected.files.lock().unwrap(),files);std::fs::write(&f.donor,&f.bytes).unwrap();host(&mut f.engine,command,params.clone()).unwrap();native.execute(command,params).unwrap();same(&f.engine,&native);let after=actual.files.lock().unwrap().clone();assert_ne!(after,files);assert_eq!(after,*expected.files.lock().unwrap());assert!(open(Box::new(actual)).presets.iter().any(|preset|preset.name=="Pending source-change brush"));}
}

#[test]
fn source_change_immutable_host_publication_reopens_history_after_donor_removal(){
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{let mut f=fixture(16,"psb");f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);let before=f.engine.active().unwrap().doc.clone();let labels=f.engine.active().unwrap().history.entries();let params=request(&f);host(&mut f.engine,command,params).unwrap();let after=f.engine.active().unwrap().doc.clone();let mut session=super::super::super::PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap();let path=f.directory.0.join(format!("{}.pcraft",session.version));let bytes=super::super::super::bundle::portable_bytes(&path,super::super::super::MAX_INPUT_BYTES as usize).unwrap();std::fs::remove_file(&f.donor).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap();super::super::super::save_view(&f.directory.0,&session).unwrap();let mut reopened=super::super::super::restore_with_settings(&f.directory.0,&session.version,None,false).unwrap();let state=reopened.engine.active().unwrap();assert_eq!(state.doc,before);assert_eq!(state.history.entries(),labels);assert!(state.history.can_redo());assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);final_source(&reopened.engine,f.id,command,&f.donor,&f.bytes);pixels(&reopened.engine,f.id,&rgba(),1);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(bytes,super::super::super::bundle::portable_bytes(&path,super::super::super::MAX_INPUT_BYTES as usize).unwrap());}
}

#[test]
fn source_change_checked_disk_helper_regular_symlink_directory_missing_and_sparse_policy(){
    let mut f=fixture(8,"png");assert_eq!(disk(&f.donor).unwrap(),f.bytes);let empty=f.directory.0.join("empty.png");std::fs::write(&empty,[]).unwrap();assert!(disk(&empty).unwrap().is_empty());assert_eq!(disk(&f.directory.0).unwrap_err(),"Smart-object source is not a regular file");let missing=f.directory.0.join("missing.png");let error=disk(&missing).unwrap_err();assert!(!error.contains("512MB"));
    let before=twin(&f.engine);let params=json!({"path":f.directory.0.to_string_lossy()});let error=host(&mut f.engine,REPLACE_COMMAND,params).unwrap_err();assert!(error.contains("Smart-object source is not a regular file"));assert!(!error.contains("512MB"));unchanged(&f.engine,&before);
    #[cfg(unix)]{let link=f.directory.0.join("source-link.png");std::os::unix::fs::symlink(&f.donor,&link).unwrap();assert_eq!(disk(&link).unwrap(),f.bytes);for command in [RELINK_COMMAND,REPLACE_COMMAND]{let params=json!({"path":link.to_string_lossy()});let mut native=twin(&f.engine);host(&mut f.engine,command,params.clone()).unwrap();native.execute(command,params).unwrap();same(&f.engine,&native);final_source(&f.engine,f.id,command,&link,&f.bytes);pixels(&f.engine,f.id,&rgba(),1);}let directory_link=f.directory.0.join("directory-link");std::os::unix::fs::symlink(&f.directory.0,&directory_link).unwrap();assert_eq!(disk(&directory_link).unwrap_err(),"Smart-object source is not a regular file");}
    std::fs::OpenOptions::new().write(true).open(&f.donor).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();assert!(disk(&f.donor).unwrap_err().contains("512MB"));
}

#[test]
fn source_change_native_no_document_path_parameter_target_and_job_precedence(){
    for command in [RELINK_COMMAND,REPLACE_COMMAND]{let mut empty=Session::new();assert_eq!(host(&mut empty,command,json!({})).unwrap_err(),empty.execute(command,json!({})).unwrap_err().to_string());for scenario in ["activeRaster","noActive","null","array","string","number","missingPath","emptyPath","invalidPath"]{let mut f=fixture(8,"png");let params=match scenario{"activeRaster"=>{f.engine.select_layer(f.raster).unwrap();request(&f)},"noActive"=>{f.engine.active_mut().unwrap().active_layer=None;request(&f)},"null"=>Value::Null,"array"=>json!([]),"string"=>json!("invalid"),"number"=>json!(42),"missingPath"=>json!({}),"emptyPath"=>json!({"path":""}),_=>json!({"path":17})};let before=twin(&f.engine);let mut native=twin(&f.engine);assert_eq!(host(&mut f.engine,command,params.clone()).unwrap_err(),native.execute(command,params).unwrap_err().to_string());unchanged(&f.engine,&before);}
        let mut f=fixture(8,"png");let release=Arc::new(AtomicBool::new(false));let worker=release.clone();struct Release(Arc<AtomicBool>);impl Drop for Release{fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}let _release=Release(release.clone());let started=f.engine.start_job("source-change-test",json!({}),"Retained source-change job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected native job")};let before=twin(&f.engine);std::fs::remove_file(&f.donor).unwrap();let params=request(&f);let error=host(&mut f.engine,command,params.clone()).unwrap_err();assert_eq!(error,f.engine.execute(command,params).unwrap_err().to_string());assert!(error.contains("Retained source-change job"));unchanged(&f.engine,&before);release.store(true,Ordering::Relaxed);f.engine.wait_job(job).unwrap();
    }
}
