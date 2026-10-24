use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Document, LayerMask, PixelFormat, Rect, SampleType, Slice, SliceOrigin, SmartFilter};
use photocraft_raster::Surface;
use serde_json::json;
use std::{io::Read, path::PathBuf, sync::{Weak, atomic::{AtomicBool, Ordering}}};

struct Directory(PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
struct Fixture { directory: Directory, engine: Session, active: LayerId, other: LayerId, embedded: LayerId, group: LayerId, raster: LayerId, path: PathBuf, bytes: Vec<u8> }

fn rgba() -> Vec<u8> { vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255] }
fn encoded(format: &str, pixels: Vec<u8>) -> Vec<u8> {
    match format {
        "png" => { let image = photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,pixels).unwrap(); photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap() },
        "psd" | "psb" => {
            use photocraft_psd::{Compression, LayerSpec, PixelData, PsdBuilder, Version};
            let mut builder = PsdBuilder::new(2,2).version(if format == "psb" { Version::Psb } else { Version::Psd }).compression(Compression::Raw);
            builder.push_layer(LayerSpec::new("Known source",0,0,2,2,PixelData::Rgba8(pixels.clone())));
            builder.composite(PixelData::Rgba8(pixels)); builder.to_bytes().unwrap()
        },
        "pcraft" => photocraft_engine::smart_cmds::encode_source(&photocraft_io::import("source.png",&encoded("png",pixels)).unwrap().document).unwrap(),
        _ => unreachable!(),
    }
}
fn object(name: &str, source: SmartSource, x: i32, y: i32, format: PixelFormat) -> Layer {
    let mut cache = Surface::new(format);
    let raw: Vec<f32> = rgba().into_iter().map(|value| f32::from(value) / 255.).collect();
    cache.write_region(Rect::from_xywh(x,y,2,2),&raw);
    let mut smart = SmartObject::new(source,Affine::translate(f64::from(x),f64::from(y)),Some(cache));
    smart.smart_filters.push(SmartFilter { command:"plugin.run".into(), params:json!({"path":"hidden must not run","vendor":[null,7]}), visible:false, opacity:0.37, blend:BlendMode::Multiply });
    let mut filter_mask = LayerMask::hide_all(); filter_mask.surface.write_pixel(x,y,&[0.4]); filter_mask.enabled=false; filter_mask.density=0.7; filter_mask.feather=0.5; smart.filter_mask=Some(filter_mask);
    smart.psd_raw=Some(Arc::new(b"retained placed data".to_vec()));
    let mut layer=Layer::new(name,LayerContent::Smart(smart));
    let mut mask=LayerMask::reveal_all(); mask.linked=false; layer.mask=Some(mask);
    for key in [*b"SoLd",*b"PlLd",*b"SoLE",*b"zzzz"] { layer.psd_blocks.push((key,Arc::new([key.as_slice(),b" retained"].concat()))); }
    layer
}
fn fixture(depth: u32, format: &str) -> Fixture {
    let directory=Directory(std::env::temp_dir().join(format!("linked-presets-{}",ulid::Ulid::new()))); std::fs::create_dir_all(&directory.0).unwrap();
    let bytes=encoded(format,rgba()); let path=directory.0.join(format!("source.{format}")); std::fs::write(&path,&bytes).unwrap();
    let mut engine=Session::new(); engine.execute("file.new",json!({"width":16,"height":16,"depth":depth})).unwrap(); let format=engine.active().unwrap().doc.pixel_format();
    let first=object("First",SmartSource::Linked{path:path.to_string_lossy().into()},2,2,format);
    let mut other=object("Repeated path",SmartSource::Linked{path:path.to_string_lossy().into()},8,2,format); other.visible=false;
    let embedded=object("Embedded",SmartSource::Embedded{file_name:"embedded.png".into(),bytes:Arc::new(encoded("png",rgba()))},2,8,format);
    let mut raster=Layer::raster("Raster",format); raster.surface_mut().unwrap().fill_rect(Rect::new(8,8,10,10),&[0.25,0.5,0.75,1.]);
    let ids=[first.id,other.id,embedded.id,raster.id]; let group=Layer::group("Nested",vec![other,Layer::group("Inner",vec![embedded,raster])]); let group_id=group.id;
    engine.edit("Preset fixture",|doc,active| {
        doc.layers=vec![first,group]; *active=Some(ids[0]);
        let mut coverage=Surface::new(PixelFormat::GRAY8); coverage.write_pixel(2,2,&[0.5]);
        doc.channels.push(AlphaChannel::new("Alpha",coverage.clone())); doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));
        doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"unrelated global metadata".to_vec())));
        doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(ids[0]),rect:Rect::new(2,2,4,4),..Default::default()}]; Ok(())
    }).unwrap(); normalize(&mut engine);
    let state=engine.active_mut().unwrap(); state.selected_layers=vec![ids[0],ids[1]]; state.layer_anchor=Some(ids[1]); state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5]; engine.tools.background=[0.7,0.6,0.5,0.4];
    let state=engine.active().unwrap(); engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:ids[0],mask:false,label:"Older preset Fade".into()});
    Fixture{directory,engine,active:ids[0],other:ids[1],embedded:ids[2],group:group_id,raster:ids[3],path,bytes}
}
fn normalize(engine: &mut Session) { let index=engine.active_index().unwrap(); engine.execute("document.activate",json!({"document":index})).unwrap(); }
fn smart(doc: &Document, id: LayerId) -> &SmartObject { let LayerContent::Smart(smart)=&doc.layer(id).unwrap().content else { panic!("Expected Smart Object") }; smart }
fn checked(_: LayerId, metadata: &Metadata, smart: &SmartObject) -> Result<Option<super::super::Bytes>,String> { super::super::super::smart::source_bytes_checked(metadata,&smart.source,||Ok(())) }
fn host(engine: &mut Session, command: &str, params: Value) -> Result<Value,String> { super::super::super::execute_view_command(engine,command,params) }
fn twin(engine: &Session) -> Session {
    let state=engine.active().unwrap(); let mut copy=Session::new(); copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None); *copy.active_mut().unwrap()=state.clone();
    copy.journal=engine.journal.clone(); copy.tools=engine.tools.clone(); copy.presets=engine.presets.clone(); copy.patterns=engine.patterns.clone(); copy.clipboard=engine.clipboard.clone(); copy.style_clipboard=engine.style_clipboard.clone(); copy.edit_state=engine.edit_state.clone();
    super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap(); copy
}
fn same(actual: &Session, expected: &Session) {
    let a=actual.active().unwrap(); let n=expected.active().unwrap(); assert_eq!(a.doc,n.doc); assert_eq!(a.history.entries(),n.history.entries()); assert_eq!(a.history.past_len(),n.history.past_len());
    for index in 0..a.history.past_len() { assert_eq!(a.history.state(index),n.history.state(index)); }
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),n.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(n.revision,n.saved_revision,&n.coalesce,n.active_layer,&n.selected_layers,n.layer_anchor,&n.path,&n.last_damage));
    assert_eq!(a.channel_view,n.channel_view); assert_eq!(a.isolated_layers,n.isolated_layers); assert_eq!(a.fx_collapsed,n.fx_collapsed); assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",n.symmetry_path));
    assert_eq!(actual.journal,expected.journal); assert_eq!(actual.edit_state.fade,expected.edit_state.fade); assert_eq!(actual.tools.foreground,expected.tools.foreground); assert_eq!(actual.tools.background,expected.tools.background); assert_eq!(actual.tools.brush,expected.tools.brush);
    assert_eq!(actual.style_clipboard,expected.style_clipboard); assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard)); assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(expected));
    assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(expected).unwrap());
}
fn unchanged(actual: &Session, before: &Session) { same(actual,before); assert!(Arc::ptr_eq(&actual.active().unwrap().doc,&before.active().unwrap().doc)); }
fn retained(engine: &Session, before: &Document, id: LayerId) {
    let after=&engine.active().unwrap().doc; let a=smart(after,id); let b=smart(before,id); assert_eq!(a.source,b.source); assert_eq!(a.psd_raw,b.psd_raw); assert_eq!(a.smart_filters,b.smart_filters);
    assert_eq!(a.filter_mask.as_ref().map(|mask|(mask.enabled,mask.linked,mask.density,mask.feather)),b.filter_mask.as_ref().map(|mask|(mask.enabled,mask.linked,mask.density,mask.feather)));
    assert_eq!(after.layer(id).unwrap().psd_blocks,before.layer(id).unwrap().psd_blocks); assert_eq!(after.metadata,before.metadata); assert_eq!(after.channels,before.channels); assert_eq!(after.quick_mask,before.quick_mask);
}
fn mask_pixel(engine: &Session, id: LayerId, x: i32, y: i32) {
    let mask=&smart(&engine.active().unwrap().doc,id).filter_mask.as_ref().unwrap().surface;
    for py in -2..18 { for px in -2..18 { let expected=if (px,py)==(x,y) { 0.4 } else { 0. }; assert!((mask.pixel(px,py)[0]-expected).abs()<=1./255.,"Filter mask {px},{py}"); } }
}
fn permutation(index: usize) -> Vec<u8> {
    let source=rgba(); let order=match index { 0=>[3,2,1,0],1=>[2,0,3,1],2=>[1,3,0,2],3=>[1,0,3,2],_=>[2,3,0,1] };
    order.into_iter().flat_map(|pixel|source[pixel*4..pixel*4+4].iter().copied()).collect()
}
fn pixels(engine: &Session, id: LayerId, rect: Rect, raw: &[u8]) {
    let doc=&engine.active().unwrap().doc; let cache=smart(doc,id).cache.as_ref().unwrap(); let tolerance=match doc.depth { SampleType::U8=>1./255.,SampleType::U16=>2./65535.,SampleType::F32=>1e-6 };
    for y in -2..18 { for x in -2..18 { let expected=if rect.contains(x,y) { let at=((y-rect.y0)*rect.width() as i32+x-rect.x0) as usize*4; [f32::from(raw[at])/255.,f32::from(raw[at+1])/255.,f32::from(raw[at+2])/255.,f32::from(raw[at+3])/255.] } else { [0.;4] }; let actual=cache.pixel(x,y); for c in 0..4 { assert!((actual[c]-expected[c]).abs()<=tolerance,"{x}/{y}/{c}:{} != {}",actual[c],expected[c]); } assert_eq!(actual[3],expected[3]); } }
}
fn into_group(f: &mut Fixture) { let id=f.active; let group=f.group; f.engine.edit("Group preset target",|doc,active| { let first=doc.remove(id).unwrap(); doc.layer_mut(group).unwrap().children_mut().unwrap().insert(0,first); *active=Some(group); Ok(()) }).unwrap(); normalize(&mut f.engine); }
fn unsafe_stack(engine: &mut Session, id: LayerId) { engine.edit("Visible unsafe filter",|doc,_| { let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else { unreachable!() }; smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({"path":"must not run"}),visible:true,opacity:0.,blend:BlendMode::Normal}); Ok(()) }).unwrap(); normalize(engine); }

#[test]
fn linked_presets_all_five_three_depths_match_native_and_independent_literal_pixel_permutations() {
    for depth in [8,16,32] { for (index,command) in COMMANDS.into_iter().enumerate() {
        let mut f=fixture(depth,["png","pcraft","psd","psb","png"][index]); let before=f.engine.active().unwrap().doc.clone(); let past=f.engine.active().unwrap().history.past_len(); let journal=f.engine.journal.len(); let mut native=twin(&f.engine);
        let params=json!({"layer":f.other.0,"target":"mask","matrix":[0,0,0,0,0,0],"coalesce":"ignored-outer","vendor":{"keep":true}});
        assert_eq!(host(&mut f.engine,command,params.clone()).unwrap(),native.execute(command,params.clone()).unwrap()); same(&f.engine,&native); retained(&f.engine,&before,f.active);
        pixels(&f.engine,f.active,Rect::new(2,2,4,4),&permutation(index)); let (mx,my)=match index { 0=>(3,3),1|3=>(3,2),_=>(2,3) }; mask_pixel(&f.engine,f.active,mx,my); assert_eq!(f.engine.active().unwrap().doc.layer(f.group),before.layer(f.group));
        assert_eq!(f.engine.active().unwrap().history.past_len(),past+1); assert_eq!(f.engine.active().unwrap().history.undo_label(),Some("Free Transform")); assert_eq!(f.engine.active().unwrap().coalesce,None);
        assert_eq!(f.engine.journal.len(),journal+2); assert_eq!(f.engine.journal[journal].0,"edit.transform"); assert_eq!(f.engine.journal[journal].1["layer"],json!(f.active.0)); assert_eq!(f.engine.journal[journal].1["interpolation"],"nearest"); assert!(f.engine.journal[journal].1.get("coalesce").is_none()); assert_eq!(f.engine.journal[journal+1],(command.into(),params));
        let after=f.engine.active().unwrap().doc.clone(); f.engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&f.engine,&native); assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before)); f.engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&f.engine,&native); assert_eq!(f.engine.active().unwrap().doc,after);
    } }
}

#[test]
fn linked_presets_missing_corrupt_and_empty_uuid_metadata_keep_literal_warped_cache_without_admission() {
    use photocraft_io::linked::{encode_linked_file,LinkedFile};
    for failure in ["missing","corrupt"] { for (index,command) in COMMANDS.into_iter().enumerate() {
        let mut f=fixture(16,"png"); unsafe_stack(&mut f.engine,f.active);
        f.engine.edit("Empty UUID collision",|doc,_| { doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(encode_linked_file(&LinkedFile{uuid:String::new(),file_name:"collision.png".into(),bytes:encoded("png",[255,0,255,255].repeat(4))})))); Ok(()) }).unwrap(); normalize(&mut f.engine);
        if failure=="missing" { std::fs::remove_file(&f.path).unwrap(); } else { std::fs::write(&f.path,b"undecodable preset source").unwrap(); }
        let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); let mut reads=0;
        assert_eq!(run_with(&mut f.engine,command,&json!({}),|id,meta,smart| { reads+=1; checked(id,meta,smart) }).unwrap(),native.execute(command,json!({})).unwrap()); assert_eq!(reads,1); same(&f.engine,&native); retained(&f.engine,&before,f.active); pixels(&f.engine,f.active,Rect::new(2,2,4,4),&permutation(index));
    } }
}

#[test]
fn linked_presets_nested_group_order_repeated_paths_embedded_and_source_pin_retirement_match_native() {
    let mut f=fixture(16,"png"); into_group(&mut f); let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); let mut visits=Vec::new(); let mut pins:Vec<Weak<Vec<u8>>>=Vec::new();
    assert_eq!(run_with(&mut f.engine,COMMANDS[0],&json!({"layer":f.raster.0}),|id,meta,object| { assert!(pins.iter().all(|pin|pin.upgrade().is_none())); visits.push(id); assert_eq!(object.source,smart(&before,id).source); let result=checked(id,meta,object)?; if matches!(object.source,SmartSource::Linked{..}) { pins.push(Arc::downgrade(&result.as_ref().unwrap().1)); } Ok(result) }).unwrap(),native.execute(COMMANDS[0],json!({"layer":f.raster.0})).unwrap());
    same(&f.engine,&native); assert_eq!(visits,vec![f.active,f.other,f.embedded]); assert!(pins.iter().all(|pin|pin.upgrade().is_none()));
    for (id,x,y) in [(f.active,8,8),(f.other,2,8),(f.embedded,8,2)] { retained(&f.engine,&before,id); pixels(&f.engine,id,Rect::from_xywh(x,y,2,2),&permutation(0)); mask_pixel(&f.engine,id,x+1,y+1); }
    let mut f=fixture(16,"png"); into_group(&mut f); let before=f.engine.active().unwrap().doc.clone(); let red=[255,0,0,255].repeat(4); let blue=[0,0,255,255].repeat(4); let mut visits=Vec::new(); let mut pins:Vec<Weak<Vec<u8>>>=Vec::new();
    run_with(&mut f.engine,COMMANDS[0],&json!({}),|id,meta,object| { assert!(pins.iter().all(|pin|pin.upgrade().is_none())); visits.push(id); if id==f.active { std::fs::write(&f.path,encoded("png",red.clone())).unwrap(); } else if id==f.other { std::fs::write(&f.path,encoded("png",blue.clone())).unwrap(); } let result=checked(id,meta,object)?; if matches!(object.source,SmartSource::Linked{..}) { pins.push(Arc::downgrade(&result.as_ref().unwrap().1)); } Ok(result) }).unwrap();
    assert_eq!(visits,vec![f.active,f.other,f.embedded]); assert!(pins.iter().all(|pin|pin.upgrade().is_none())); pixels(&f.engine,f.active,Rect::new(8,8,10,10),&red); pixels(&f.engine,f.other,Rect::new(2,8,4,10),&blue); pixels(&f.engine,f.embedded,Rect::new(8,2,10,4),&permutation(0)); for id in visits { retained(&f.engine,&before,id); }
}

#[test]
fn linked_presets_checked_decision_survives_donor_deletion_and_metadata_first_authority() {
    use photocraft_io::linked::{encode_linked_file,LinkedFile};
    let mut f=fixture(32,"psb"); let before=f.engine.active().unwrap().doc.clone(); let mut reads=0;
    run_with(&mut f.engine,COMMANDS[1],&Value::Null,|id,meta,object| { reads+=1; let bytes=checked(id,meta,object)?; std::fs::remove_file(&f.path).unwrap(); Ok(bytes) }).unwrap(); assert_eq!(reads,1); retained(&f.engine,&before,f.active); pixels(&f.engine,f.active,Rect::new(2,2,4,4),&permutation(1));
    let mut f=fixture(16,"png"); let blue=[0,0,255,255].repeat(4); let mut block=encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"authority.psd".into(),bytes:encoded("psd",blue.clone())}); block.extend(encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"ignored.png".into(),bytes:f.bytes.clone()}));
    f.engine.edit("Metadata source authority",|doc,_| { doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(block))); Ok(()) }).unwrap(); normalize(&mut f.engine); std::fs::write(&f.path,b"invalid disk bytes").unwrap(); let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine);
    assert_eq!(host(&mut f.engine,COMMANDS[3],json!({})).unwrap(),native.execute(COMMANDS[3],json!({})).unwrap()); same(&f.engine,&native); retained(&f.engine,&before,f.active); pixels(&f.engine,f.active,Rect::new(2,2,4,4),&blue);
}

#[test]
fn linked_presets_caps_growth_panics_unsafe_and_late_group_errors_leave_owner_arc_and_context_unchanged() {
    for failure in ["cap","growth","panic","unsafe"] {
        let mut f=fixture(16,"png"); if failure=="cap" { std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap(); } if failure=="unsafe" { unsafe_stack(&mut f.engine,f.active); }
        let before=twin(&f.engine); let error=match failure {
            "cap" | "unsafe" => host(&mut f.engine,COMMANDS[0],json!({})).unwrap_err(),
            "panic" => run_with(&mut f.engine,COMMANDS[0],&json!({}),|_,_,_| panic!("Injected preset reader panic")).unwrap_err(),
            _ => { struct Growing { read:usize, max:usize } impl Read for Growing { fn read(&mut self,out:&mut[u8])->std::io::Result<usize> { self.max=self.max.max(out.len()); out.fill(7); self.read+=out.len(); Ok(out.len()) } } let mut reader=Growing{read:0,max:0}; let error=run_with(&mut f.engine,COMMANDS[0],&json!({}),|_,_,_| super::super::super::smart::replay_read_with_limit(&mut reader,32).map(|bytes|Some(("growing.png".into(),Arc::new(bytes))))).unwrap_err(); assert_eq!(reader.read,33); assert!(reader.max<=64*1024); error },
        };
        if failure=="panic" { assert!(error.contains(COMMANDS[0])); assert!(error.contains("internal error")); } else if failure=="unsafe" { assert!(error.contains("does not support")); } else { assert!(error.contains("512MB")); } unchanged(&f.engine,&before);
    }
    let mut f=fixture(16,"png"); into_group(&mut f); let before=twin(&f.engine); let mut visits=Vec::new(); let error=run_with(&mut f.engine,COMMANDS[0],&json!({}),|id,meta,object| { visits.push(id); if id==f.other { return Err("Injected late preset source refusal".into()); } checked(id,meta,object) }).unwrap_err(); assert!(error.contains("Injected late")); assert_eq!(visits,vec![f.active,f.other]); unchanged(&f.engine,&before);
}

#[test]
fn linked_presets_outer_coalesce_is_ignored_across_four_views_with_native_dual_journals_and_older_fade() {
    for view in ["alpha","color","quickMask","mask"] {
        let mut f=fixture(16,"pcraft"); match view { "color"=>f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1),"quickMask"=>f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Composite,"mask"=>{ f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Composite; f.engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap(); },_=>{} }
        f.engine.edit("Soft preset selection",|doc,_| { let mut selection=Surface::new(PixelFormat::GRAY8); selection.write_region(Rect::new(2,2,4,4),&[0.25,0.5,0.75,1.]); doc.selection=Some(selection); Ok(()) }).unwrap(); normalize(&mut f.engine);
        f.engine.active_mut().unwrap().coalesce=Some("same-outer-key".into());
        let before=f.engine.active().unwrap().doc.clone(); let fade=f.engine.edit_state.fade.clone(); let past=f.engine.active().unwrap().history.past_len(); let journal=f.engine.journal.len(); let mut native=twin(&f.engine);
        for (index,command) in [COMMANDS[3],COMMANDS[4]].into_iter().enumerate() { let params=json!({"target":{"channel":999},"layer":u64::MAX,"coalesce":"same-outer-key"}); assert_eq!(host(&mut f.engine,command,params.clone()).unwrap(),native.execute(command,params).unwrap()); same(&f.engine,&native); retained(&f.engine,&before,f.active); assert_eq!(f.engine.edit_state.fade,fade); assert_eq!(f.engine.active().unwrap().history.past_len(),past+index+1); assert_eq!(f.engine.active().unwrap().coalesce,None); assert_eq!(f.engine.journal.len(),journal+2*(index+1)); }
        pixels(&f.engine,f.active,Rect::new(2,2,4,4),&permutation(0)); let after=f.engine.active().unwrap().doc.clone(); for _ in 0..2 { f.engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&f.engine,&native); } assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before)); for _ in 0..2 { f.engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&f.engine,&native); } assert_eq!(f.engine.active().unwrap().doc,after);
    }
}

#[test]
fn linked_presets_owner_pending_presets_flush_after_success_only_and_match_native_store() {
    use photocraft_engine::preset_store::{open,MemBackend};
    let mut f=fixture(16,"psd"); let mut native=twin(&f.engine); let actual=MemBackend::default(); let expected=MemBackend::default(); f.engine.attach_preset_store(open(Box::new(actual.clone()))); native.attach_preset_store(open(Box::new(expected.clone())));
    for engine in [&mut f.engine,&mut native] { let mut preset=engine.tools.presets[0].clone(); preset.name="Pending preset-transform owner brush".into(); preset.group="Preset transforms".into(); preset.builtin=false; engine.tools.presets.push(preset); engine.brush_presets_changed(); }
    let files=actual.files.lock().unwrap().clone(); let before=twin(&f.engine); assert!(run_with(&mut f.engine,COMMANDS[2],&json!({}),|_,_,_|Err("Injected preset refusal".into())).is_err()); unchanged(&f.engine,&before); assert_eq!(*actual.files.lock().unwrap(),files);
    assert_eq!(host(&mut f.engine,COMMANDS[2],json!({})).unwrap(),native.execute(COMMANDS[2],json!({})).unwrap()); same(&f.engine,&native); assert_ne!(*actual.files.lock().unwrap(),files); assert_eq!(*actual.files.lock().unwrap(),*expected.files.lock().unwrap()); assert!(open(Box::new(actual)).presets.iter().any(|preset|preset.name=="Pending preset-transform owner brush"));
}

#[test]
fn linked_presets_actual_host_publication_reopen_undo_redo_keeps_immutable_sources_and_dual_journal() {
    for command in COMMANDS { let mut f=fixture(16,"psb"); let before=f.engine.active().unwrap().doc.clone(); let labels=f.engine.active().unwrap().history.entries(); let mut native=twin(&f.engine); let params=json!({"coalesce":"ignored"}); assert_eq!(host(&mut f.engine,command,params.clone()).unwrap(),native.execute(command,params).unwrap()); same(&f.engine,&native); let after=f.engine.active().unwrap().doc.clone();
        let mut session=super::super::super::PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()}; let photo=ulid::Ulid::new().to_string(); super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap(); let immutable_file=f.directory.0.join(format!("{}.pcraft",session.version)); let immutable=super::super::super::bundle::portable_bytes(&immutable_file,super::super::super::MAX_INPUT_BYTES as usize).unwrap(); std::fs::remove_file(&f.path).unwrap(); session.engine.execute("edit.undo",json!({})).unwrap(); super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap(); super::super::super::save_view(&f.directory.0,&session).unwrap(); let mut reopened=super::super::super::restore_with_settings(&f.directory.0,&session.version,None,false).unwrap();
        assert_eq!(reopened.engine.active().unwrap().doc,before); assert_eq!(reopened.engine.active().unwrap().history.entries(),labels); assert!(reopened.engine.active().unwrap().history.can_redo()); assert_eq!(reopened.engine.active().unwrap().channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Alpha(0)); reopened.engine.execute("edit.redo",json!({})).unwrap(); assert_eq!(reopened.engine.active().unwrap().doc,after); retained(&reopened.engine,&before,f.active); reopened.engine.execute("edit.undo",json!({})).unwrap(); assert_eq!(reopened.engine.active().unwrap().doc,before); assert_eq!(super::super::super::bundle::portable_bytes(&immutable_file,super::super::super::MAX_INPUT_BYTES as usize).unwrap(),immutable);
    }
}

#[test]
fn linked_presets_native_parameter_empty_bounds_locks_and_target_errors_precede_source_reads() {
    for mode in ["array","string","null","noActive","staleActive","empty","selectionEmpty","locked","raster"] {
        let mut f=fixture(8,"png"); let params=match mode { "array"=>json!([]),"string"=>json!("bad"),"null"=>Value::Null,_=>json!({"layer":u64::MAX,"target":"quickMask"}) };
        match mode { "noActive"=>f.engine.active_mut().unwrap().active_layer=None,"staleActive"=>f.engine.active_mut().unwrap().active_layer=Some(LayerId(u64::MAX)),"empty"=>{ let id=f.active; f.engine.edit("Empty Smart cache",|doc,_| { let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else { unreachable!() }; smart.cache=None; Ok(()) }).unwrap(); normalize(&mut f.engine); },"selectionEmpty"=>{ f.engine.edit("Selection outside source",|doc,_| { let mut selection=Surface::new(PixelFormat::GRAY8); selection.write_pixel(14,14,&[1.]); doc.selection=Some(selection); Ok(()) }).unwrap(); normalize(&mut f.engine); },"locked"=>{ let id=f.active; f.engine.edit("Locked preset target",|doc,_| { doc.layer_mut(id).unwrap().locks.all=true; Ok(()) }).unwrap(); normalize(&mut f.engine); },"raster"=>{ f.engine.active_mut().unwrap().active_layer=Some(f.raster); },_=>{} }
        let before=twin(&f.engine); let mut native=twin(&f.engine); let mut reads=0; let actual=run_with(&mut f.engine,COMMANDS[0],&params,|_,_,_| { reads+=1; Ok(None) }); let expected=native.execute(COMMANDS[0],params).map_err(|error|error.to_string());
        if matches!(mode,"null"|"raster") { assert_eq!(actual.unwrap(),expected.unwrap()); same(&f.engine,&native); assert_eq!(reads,usize::from(mode=="null")); } else { assert_eq!(actual.unwrap_err(),expected.unwrap_err()); assert_eq!(reads,0); unchanged(&f.engine,&before); }
    }
    let mut empty=Session::new(); let mut reads=0; let error=run_with(&mut empty,COMMANDS[0],&json!({}),|_,_,_| { reads+=1; panic!("No-document preset read a source") }).unwrap_err(); assert_eq!(error,empty.execute(COMMANDS[0],json!({})).unwrap_err().to_string()); assert_eq!(reads,0);
}

#[test]
fn linked_presets_pending_native_job_refuses_before_source_resolution() {
    let mut f=fixture(8,"png"); let release=Arc::new(AtomicBool::new(false)); let worker=release.clone(); struct Release(Arc<AtomicBool>); impl Drop for Release { fn drop(&mut self) { self.0.store(true,Ordering::Relaxed); } } let _release=Release(release.clone());
    let started=f.engine.start_job("preset-test",json!({}),"Retained preset job",true,move |context| { while !worker.load(Ordering::Relaxed) { context.check()?; std::thread::yield_now(); } Ok(()) },|_,_|Ok(Value::Null)).unwrap(); let photocraft_engine::jobs::Started::Job(job)=started else { panic!("Expected native job") };
    let before=twin(&f.engine); let mut reads=0; let actual=run_with(&mut f.engine,COMMANDS[0],&json!({}),|_,_,_| { reads+=1; panic!("Busy preset read source") }).unwrap_err(); let expected=f.engine.execute(COMMANDS[0],json!({})).unwrap_err().to_string(); assert_eq!(actual,expected); assert!(actual.contains("Retained preset job")); assert_eq!(reads,0); unchanged(&f.engine,&before); release.store(true,Ordering::Relaxed); f.engine.wait_job(job).unwrap();
}
