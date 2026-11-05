use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Document, Layer, LayerMask, Metadata, PixelFormat, Rect, SampleType, Slice, SliceOrigin, SmartFilter, SmartObject};
use photocraft_raster::Surface;
use std::{io::Read, path::PathBuf, sync::atomic::{AtomicBool, Ordering}};

struct Directory(PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
fn directory() -> Directory {
    let path = std::env::temp_dir().join(format!("linked-embed-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&path).unwrap(); Directory(path)
}
fn rgba() -> Vec<u8> { vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255] }
fn encoded(format: &str, pixels: Vec<u8>) -> Vec<u8> {
    match format {
        "png" => {
            let image = photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,pixels).unwrap();
            photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap()
        }
        "psd" | "psb" => {
            use photocraft_psd::{Compression, LayerSpec, PixelData, PsdBuilder, Version};
            let mut builder = PsdBuilder::new(2,2).version(if format == "psb" { Version::Psb } else { Version::Psd }).compression(Compression::Raw);
            builder.push_layer(LayerSpec::new("Known",0,0,2,2,PixelData::Rgba8(pixels.clone())));
            builder.composite(PixelData::Rgba8(pixels)); builder.to_bytes().unwrap()
        }
        "pcraft" => photocraft_engine::smart_cmds::encode_source(&photocraft_io::import("source.png",&encoded("png",pixels)).unwrap().document).unwrap(),
        _ => unreachable!(),
    }
}
fn object_layer(name: &str, source: SmartSource, x: i32, y: i32, format: PixelFormat) -> Layer {
    let mut cache = Surface::new(format); cache.fill_rect(Rect::from_xywh(x,y,1,1),&[0.25,0.5,0.75,1.]);
    let mut object = SmartObject::new(source,Affine::translate(f64::from(x),f64::from(y)),Some(cache));
    object.smart_filters = vec![SmartFilter { command: "filter.cameraRaw".into(), params: json!({"exposure":0,"vendor":{"retain":[null,7]}}), visible: true, opacity: 1., blend: BlendMode::Normal }, SmartFilter { command: "filter.other.offset".into(), params: json!({"x":0,"y":0,"vendor":"keep order"}), visible: false, opacity: 0.63, blend: BlendMode::Multiply }];
    let mut filter_mask = LayerMask::hide_all(); filter_mask.enabled=false; filter_mask.linked=false; filter_mask.density=0.42; filter_mask.feather=1.25; object.filter_mask=Some(filter_mask);
    object.psd_raw=Some(Arc::new(b"retained placed data".to_vec()));
    let mut layer=Layer::new(name,LayerContent::Smart(object)); let mut mask=LayerMask::reveal_all(); mask.linked=false; mask.density=0.6; layer.mask=Some(mask);
    for key in [*b"SoLd",*b"SoLE",*b"PlLd",*b"zzzz"] { layer.psd_blocks.push((key,Arc::new([key.as_slice(),b" retained"].concat()))); }
    layer
}
struct Fixture { directory: Directory, engine: Session, active: LayerId, other: LayerId, embedded: LayerId, raster: LayerId, path: PathBuf, other_path: PathBuf, bytes: Vec<u8> }
fn fixture(depth: u32, format: &str) -> Fixture {
    let directory=directory(); let path=directory.0.join(format!("source.{format}")); let other_path=directory.0.join("other.png"); let bytes=encoded(format,rgba());
    std::fs::write(&path,&bytes).unwrap(); std::fs::write(&other_path,encoded("png",rgba())).unwrap();
    let mut engine=Session::new(); engine.execute("file.new",json!({"width":12,"height":10,"depth":depth})).unwrap(); let format=engine.active().unwrap().doc.pixel_format();
    let active=object_layer("Active linked",SmartSource::Linked{path:path.to_string_lossy().into()},2,1,format);
    let mut other=object_layer("Inactive linked",SmartSource::Linked{path:other_path.to_string_lossy().into()},6,5,format); other.visible=false;
    let embedded=object_layer("Inactive embedded",SmartSource::Embedded{file_name:"original.png".into(),bytes:Arc::new(encoded("png",rgba()))},8,1,format);
    let raster=Layer::raster("Excluded raster",format); let ids=[active.id,other.id,embedded.id,raster.id];
    engine.edit("Embed fixture",|doc,current| {
        doc.layers=vec![active,Layer::group("Retained group",vec![other]),embedded,raster]; *current=Some(ids[0]);
        let mut coverage=Surface::new(PixelFormat::GRAY8); coverage.fill_rect(Rect::from_xywh(3,2,2,3),&[0.5]); doc.selection=Some(coverage.clone()); doc.channels.push(AlphaChannel::new("Retained alpha",coverage.clone())); doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));
        doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(ids[0]),rect:Rect::from_xywh(2,1,1,1),..Default::default()}]; Ok(())
    }).unwrap();
    let index=engine.active_index().unwrap(); engine.execute("document.activate",json!({"document":index})).unwrap();
    let state=engine.active_mut().unwrap(); state.selected_layers=vec![ids[0],ids[1]]; state.layer_anchor=Some(ids[1]); state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5]; engine.tools.background=[0.7,0.6,0.5,0.4];
    let state=engine.active().unwrap(); engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:ids[0],mask:false,label:"Older retained Fade".into()});
    Fixture{directory,engine,active:ids[0],other:ids[1],embedded:ids[2],raster:ids[3],path,other_path,bytes}
}
fn smart(doc: &Document, id: LayerId) -> &SmartObject { let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else { panic!("No Smart Object") }; object }
fn twin(engine: &Session) -> Session {
    let state=engine.active().unwrap(); let mut copy=Session::new(); copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None); *copy.active_mut().unwrap()=state.clone();
    copy.journal=engine.journal.clone(); copy.tools=engine.tools.clone(); copy.presets=engine.presets.clone(); copy.patterns=engine.patterns.clone(); copy.clipboard=engine.clipboard.clone(); copy.style_clipboard=engine.style_clipboard.clone(); copy.edit_state=engine.edit_state.clone();
    super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap(); copy
}
fn same(actual: &Session, expected: &Session) {
    let a=actual.active().unwrap(); let e=expected.active().unwrap(); assert_eq!(a.doc,e.doc); assert_eq!(a.history.entries(),e.history.entries()); assert_eq!(a.history.past_len(),e.history.past_len());
    for index in 0..a.history.past_len() { assert_eq!(a.history.state(index),e.history.state(index)); }
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(e.revision,e.saved_revision,&e.coalesce,e.active_layer,&e.selected_layers,e.layer_anchor,&e.path,&e.last_damage));
    assert_eq!(a.channel_view,e.channel_view); assert_eq!(a.isolated_layers,e.isolated_layers); assert_eq!(a.fx_collapsed,e.fx_collapsed); assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",e.symmetry_path));
    assert_eq!(actual.journal,expected.journal); assert_eq!(actual.edit_state.fade,expected.edit_state.fade); assert_eq!(actual.tools.foreground,expected.tools.foreground); assert_eq!(actual.tools.background,expected.tools.background); assert_eq!(actual.tools.brush,expected.tools.brush);
    assert_eq!(actual.style_clipboard,expected.style_clipboard); assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard)); assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(expected)); assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(expected).unwrap());
}
fn unchanged(engine: &Session, before: &Session) { same(engine,before); assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc)); }
fn host(engine: &mut Session, params: Value) -> Result<Value,String> { super::super::super::execute_view_command(engine,COMMAND,params) }
fn checked(meta: &Metadata, object: &SmartObject) -> Result<Option<super::super::Bytes>,String> { super::super::super::smart::source_bytes_checked(meta,&object.source,||super::super::admit(object)) }
fn source(engine: &Session, id: LayerId, name: &str, bytes: &[u8]) {
    let SmartSource::Embedded{file_name,bytes:actual}=&smart(&engine.active().unwrap().doc,id).source else { panic!("Not embedded") }; assert_eq!(file_name,name); assert_eq!(actual.as_slice(),bytes);
}
fn pixels(engine: &Session, id: LayerId, raw: &[u8]) {
    let doc=&engine.active().unwrap().doc; let object=smart(doc,id); let surface=object.cache.as_ref().unwrap(); let x0=object.transform.m[4] as i32; let y0=object.transform.m[5] as i32;
    let tolerance=match doc.depth { SampleType::U8=>1./255.,SampleType::U16=>2./65535.,SampleType::F32=>1e-6 };
    for y in 0..10 { for x in 0..12 {
        let expected=if (x0..x0+2).contains(&x)&&(y0..y0+2).contains(&y) { let at=((y-y0)*2+x-x0) as usize*4; [raw[at] as f32/255.,raw[at+1] as f32/255.,raw[at+2] as f32/255.,raw[at+3] as f32/255.] } else { [0.;4] };
        let actual=surface.pixel(x,y); for channel in 0..4 { assert!((actual[channel]-expected[channel]).abs()<=tolerance,"{:?}/{id:?}/{x},{y}/{channel}: {} != {}",doc.depth,actual[channel],expected[channel]); } assert_eq!(actual[3],expected[3]);
    } }
}
fn unsafe_filter() -> SmartFilter { SmartFilter{command:"plugin.run".into(),params:json!({"path":"must never execute"}),visible:true,opacity:0.,blend:BlendMode::Normal} }

#[test]
fn linked_embed_four_formats_three_depths_match_native_keep_psd_and_literal_pixels() {
    for depth in [8,16,32] { for format in ["png","psd","psb","pcraft"] {
        let mut f=fixture(depth,format); let before=f.engine.active().unwrap().doc.clone(); let past=f.engine.active().unwrap().history.past_len(); let journal=f.engine.journal.len(); let mut native=twin(&f.engine); let params=json!({"layer":f.active.0,"vendor":[null,5]});
        assert_eq!(host(&mut f.engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&f.engine,&native); source(&f.engine,f.active,&format!("source.{format}"),&f.bytes); pixels(&f.engine,f.active,&rgba());
        let after=f.engine.active().unwrap().doc.clone(); let mut retained=smart(&after,f.active).clone(); retained.source=smart(&before,f.active).source.clone(); retained.cache=smart(&before,f.active).cache.clone(); assert_eq!(&retained,smart(&before,f.active));
        assert_eq!(after.layer(f.active).unwrap().psd_blocks,before.layer(f.active).unwrap().psd_blocks); assert_eq!(after.layer(f.active).unwrap().mask,before.layer(f.active).unwrap().mask);
        for id in [f.other,f.embedded,f.raster] { assert_eq!(after.layer(id),before.layer(id)); }
        assert_eq!(after.metadata,before.metadata); assert_eq!(after.selection,before.selection); assert_eq!(after.channels,before.channels); assert_eq!(after.quick_mask,before.quick_mask); assert_eq!(after.slices.list[0].rect,Rect::new(2,1,4,3));
        assert_eq!(f.engine.active().unwrap().history.past_len(),past+1); assert_eq!(f.engine.active().unwrap().history.undo_label(),Some(LABEL)); assert_eq!(f.engine.journal.len(),journal+1);
        f.engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&f.engine,&native); assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
        f.engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&f.engine,&native); assert_eq!(f.engine.active().unwrap().doc,after);
    } }
}

#[test]
fn linked_embed_metadata_first_authority_beats_disk_and_retains_exact_source_name_bytes() {
    use photocraft_io::linked::{encode_linked_file,LinkedFile};
    let mut f=fixture(16,"png"); let blue=[0,0,255,255].repeat(4); let bytes=encoded("png",blue.clone());
    let mut blocks=encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"metadata-authority.png".into(),bytes:bytes.clone()});
    blocks.extend(encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"ignored-later.png".into(),bytes:encoded("png",rgba())}));
    f.engine.edit("Linked metadata",|doc,_|{doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(blocks)));Ok(())}).unwrap(); std::fs::write(&f.path,b"disk must not decode").unwrap();
    let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); host(&mut f.engine,json!({})).unwrap(); native.execute(COMMAND,json!({})).unwrap(); same(&f.engine,&native);
    source(&f.engine,f.active,"metadata-authority.png",&bytes); pixels(&f.engine,f.active,&blue); assert_eq!(f.engine.active().unwrap().doc.metadata,before.metadata); assert_eq!(smart(&f.engine.active().unwrap().doc,f.active).psd_raw,smart(&before,f.active).psd_raw);
}

#[test]
fn linked_embed_one_checked_read_survives_deleted_file_and_keeps_its_pin_as_final_source() {
    let mut f=fixture(16,"png"); let mut reads=0; let mut pin=None;
    run_with(&mut f.engine,&json!({}),f.active,|meta,object| { reads+=1; let resolved=checked(meta,object)?; pin=resolved.as_ref().map(|(_,bytes)|Arc::downgrade(bytes)); std::fs::remove_file(&f.path).unwrap(); Ok(resolved) }).unwrap();
    assert_eq!(reads,1); assert!(!f.path.exists()); source(&f.engine,f.active,"source.png",&f.bytes); pixels(&f.engine,f.active,&rgba());
    let retained=pin.unwrap().upgrade().expect("final embedded bytes must remain owned"); let SmartSource::Embedded{bytes,..}=&smart(&f.engine.active().unwrap().doc,f.active).source else { unreachable!() }; assert!(Arc::ptr_eq(bytes,&retained));
}

#[test]
fn linked_embed_missing_is_unavailable_before_unsafe_stack_admission_and_atomic() {
    let mut f=fixture(16,"png"); f.engine.edit("Unsafe missing source",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(f.active).unwrap().content else{unreachable!()};object.smart_filters.push(unsafe_filter());Ok(())}).unwrap(); std::fs::remove_file(&f.path).unwrap();
    let before=twin(&f.engine); let mut native=twin(&f.engine); let mut calls=0;
    let error=run_with(&mut f.engine,&json!({}),f.active,|meta,object|{calls+=1;super::super::super::smart::source_bytes_checked(meta,&object.source,||panic!("missing source must not enter admission"))}).unwrap_err();
    assert_eq!(calls,1); assert_eq!(error,native.execute(COMMAND,json!({})).unwrap_err().to_string()); assert!(error.contains("can't be read")); unchanged(&f.engine,&before); unchanged(&native,&before);
    assert_eq!(host(&mut f.engine,json!({})).unwrap_err(),error);unchanged(&f.engine,&before);
}

#[test]
fn linked_embed_corrupt_sparse_oversize_unsafe_and_growing_reader_refuse_atomically() {
    for failure in ["corrupt","oversize","unsafe","growing"] {
        let mut f=fixture(16,"png");
        match failure {
            "oversize"=>std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap(),
            "unsafe"=>{f.engine.edit("Unsupported source stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(f.active).unwrap().content else{unreachable!()};object.smart_filters.push(unsafe_filter());Ok(())}).unwrap();std::fs::write(&f.path,b"must refuse before decode").unwrap();},
            "corrupt"=>std::fs::write(&f.path,b"corrupt source").unwrap(),
            _=>{},
        }
        let before=twin(&f.engine);
        let error=if failure=="growing" {
            struct Growing { read:usize, max:usize }
            impl Read for Growing { fn read(&mut self,out:&mut[u8])->std::io::Result<usize>{self.max=self.max.max(out.len());out.fill(0x7a);self.read+=out.len();Ok(out.len())} }
            let mut reader=Growing{read:0,max:0}; let error=run_with(&mut f.engine,&json!({}),f.active,|_,_|super::super::super::smart::replay_read_with_limit(&mut reader,32).map(|bytes|Some(("growing.png".into(),Arc::new(bytes))))).unwrap_err(); assert_eq!(reader.read,33); assert!(reader.max<=64*1024); error
        } else { host(&mut f.engine,json!({})).unwrap_err() };
        unchanged(&f.engine,&before);
        match failure { "oversize"|"growing"=>assert!(error.contains("512MB")), "unsafe"=>assert!(error.contains("does not support")), _=>{let mut native=twin(&before);assert_eq!(error,native.execute(COMMAND,json!({})).unwrap_err().to_string());unchanged(&native,&before);} }
    }
}

#[test]
fn linked_embed_null_default_and_non_u64_targets_preserve_native_active_fallback() {
    for params in [Value::Null,json!({}),json!({"layer":null}),json!({"layer":"bad"}),json!({"layer":-1}),json!({"layer":1.5})] {
        let mut f=fixture(8,"png"); let mut native=twin(&f.engine); assert_eq!(host(&mut f.engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&f.engine,&native); source(&f.engine,f.active,"source.png",&f.bytes); pixels(&f.engine,f.active,&rgba());
    }
}

#[test]
fn linked_embed_active_linked_enablement_allows_inactive_linked_and_embedded_targets_coalesced() {
    for target_embedded in [false,true] {
        let mut f=fixture(32,"png"); let id=if target_embedded{f.embedded}else{f.other};
        if target_embedded {std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();}
        let before=f.engine.active().unwrap().doc.clone(); let past=f.engine.active().unwrap().history.past_len(); let mut native=twin(&f.engine);
        for _ in 0..3 { let params=json!({"layer":id.0,"coalesce":"embed-inactive","target":"quickMask"}); assert_eq!(host(&mut f.engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&f.engine,&native); }
        source(&f.engine,id,if target_embedded{"original.png"}else{"other.png"},&encoded("png",rgba())); pixels(&f.engine,id,&rgba()); assert_eq!(smart(&f.engine.active().unwrap().doc,f.active),smart(&before,f.active)); assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);
        if target_embedded {let SmartSource::Embedded{bytes:original,..}=&smart(&before,id).source else{unreachable!()};let SmartSource::Embedded{bytes:current,..}=&smart(&f.engine.active().unwrap().doc,id).source else{unreachable!()};assert!(Arc::ptr_eq(original,current));}
        let after=f.engine.active().unwrap().doc.clone(); f.engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&f.engine,&native); assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before)); f.engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&f.engine,&native); assert_eq!(f.engine.active().unwrap().doc,after);
    }
}

#[test]
fn linked_embed_mask_alpha_quick_mask_and_stale_slice_posthooks_match_native() {
    for context in ["alpha","quickMask","mask","disabled","staleSlices"] {
        let mut f=fixture(16,"png"); match context {
            "quickMask"=>f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Composite,
            "mask"=>{f.engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},
            "disabled"=>{f.engine.edit("Disabled unsafe stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(f.active).unwrap().content else{unreachable!()};object.filters_enabled=false;object.smart_filters.push(unsafe_filter());Ok(())}).unwrap();},
            "staleSlices"=>{f.engine.edit("Stale slices",|doc,_|{doc.slices.list[0].rect=Rect::from_xywh(99,99,1,1);doc.slices.list.push(Slice{id:2,origin:SliceOrigin::Layer,layer:Some(LayerId(u64::MAX)),..Default::default()});Ok(())}).unwrap();},
            _=>{},
        }
        let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); host(&mut f.engine,json!({"target":"pixels"})).unwrap();native.execute(COMMAND,json!({"target":"pixels"})).unwrap();same(&f.engine,&native);
        let doc=&f.engine.active().unwrap().doc;assert_eq!(doc.selection,before.selection);assert_eq!(doc.quick_mask,before.quick_mask);assert_eq!(doc.channels,before.channels);assert_eq!(doc.layer(f.active).unwrap().mask,before.layer(f.active).unwrap().mask); assert_eq!(doc.slices.list.len(),1);assert_eq!(doc.slices.list[0].rect,Rect::new(2,1,4,3));pixels(&f.engine,f.active,&rgba());
    }
}

#[test]
fn linked_embed_pending_owner_store_flushes_only_after_success_like_native() {
    use photocraft_engine::preset_store::{open,MemBackend};
    let mut f=fixture(16,"png");let mut native=twin(&f.engine);let actual=MemBackend::default();let expected=MemBackend::default();f.engine.attach_preset_store(open(Box::new(actual.clone())));native.attach_preset_store(open(Box::new(expected.clone())));
    for owner in [&mut f.engine,&mut native] {let mut preset=owner.tools.presets[0].clone();preset.name="Pending Embed brush".into();preset.group="Embed owner".into();preset.builtin=false;owner.tools.presets.push(preset);owner.brush_presets_changed();}
    let files=actual.files.lock().unwrap().clone();let before=twin(&f.engine);std::fs::write(&f.path,b"corrupt source").unwrap();assert!(host(&mut f.engine,json!({})).is_err());assert!(native.execute(COMMAND,json!({})).is_err());same(&f.engine,&native);unchanged(&f.engine,&before);assert_eq!(*actual.files.lock().unwrap(),files);assert_eq!(*expected.files.lock().unwrap(),files);
    std::fs::write(&f.path,&f.bytes).unwrap();host(&mut f.engine,json!({})).unwrap();native.execute(COMMAND,json!({})).unwrap();same(&f.engine,&native);let after=actual.files.lock().unwrap().clone();assert_ne!(after,files);assert_eq!(after,*expected.files.lock().unwrap());assert!(open(Box::new(actual)).presets.iter().any(|preset|preset.name=="Pending Embed brush"));
}

#[test]
fn linked_embed_host_publication_reopens_linked_before_embedded_after_and_immutable_source_bytes() {
    let mut f=fixture(16,"psb");f.engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);let before=f.engine.active().unwrap().doc.clone();let labels=f.engine.active().unwrap().history.entries();host(&mut f.engine,json!({})).unwrap();let after=f.engine.active().unwrap().doc.clone();
    let mut session=super::super::super::PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap();let path=f.directory.0.join(format!("{}.pcraft",session.version));let bytes=super::super::super::bundle::portable_bytes(&path,super::super::super::MAX_INPUT_BYTES as usize).unwrap();
    std::fs::remove_file(&f.path).unwrap();std::fs::remove_file(&f.other_path).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap();super::super::super::save_view(&f.directory.0,&session).unwrap();let mut reopened=super::super::super::restore_with_settings(&f.directory.0,&session.version,None,false).unwrap();
    let state=reopened.engine.active().unwrap();assert_eq!(state.doc,before);assert_eq!(state.history.entries(),labels);assert!(state.history.can_redo());assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));assert!(matches!(smart(&state.doc,f.active).source,SmartSource::Linked{..}));
    reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);source(&reopened.engine,f.active,"source.psb",&f.bytes);pixels(&reopened.engine,f.active,&rgba());reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(bytes,super::super::super::bundle::portable_bytes(&path,super::super::super::MAX_INPUT_BYTES as usize).unwrap());
}

#[test]
fn linked_embed_native_enablement_target_parameter_and_job_errors_precede_source_reads() {
    let mut empty=Session::new();let error=host(&mut empty,json!({})).unwrap_err();assert_eq!(error,empty.execute(COMMAND,json!({})).unwrap_err().to_string());assert!(empty.journal.is_empty());
    for scenario in ["activeRaster","activeEmbedded","noActive","invalidLayer","rasterTarget","array","string","number"] {
        let mut f=fixture(8,"png");let params=match scenario {
            "activeRaster"=>{f.engine.select_layer(f.raster).unwrap();json!({"layer":f.other.0})},
            "activeEmbedded"=>{f.engine.select_layer(f.embedded).unwrap();json!({"layer":f.other.0})},
            "noActive"=>{f.engine.active_mut().unwrap().active_layer=None;json!({"layer":f.other.0})},
            "invalidLayer"=>json!({"layer":u64::MAX}),"rasterTarget"=>json!({"layer":f.raster.0}),"array"=>json!([]),"string"=>json!("invalid"),_=>json!(42),
        };std::fs::remove_file(&f.path).unwrap();std::fs::remove_file(&f.other_path).unwrap();let before=twin(&f.engine);let mut native=twin(&f.engine);assert_eq!(host(&mut f.engine,params.clone()).unwrap_err(),native.execute(COMMAND,params).unwrap_err().to_string());unchanged(&f.engine,&before);unchanged(&native,&before);
    }
    let mut f=fixture(8,"png");let release=Arc::new(AtomicBool::new(false));let worker=release.clone();struct Release(Arc<AtomicBool>);impl Drop for Release{fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}let _release=Release(release.clone());
    let started=f.engine.start_job("embed-test",json!({}),"Retained Embed job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected native job")};let before=twin(&f.engine);std::fs::remove_file(&f.path).unwrap();let error=host(&mut f.engine,json!({})).unwrap_err();assert_eq!(error,f.engine.execute(COMMAND,json!({})).unwrap_err().to_string());assert!(error.contains("Retained Embed job"));unchanged(&f.engine,&before);release.store(true,Ordering::Relaxed);f.engine.wait_job(job).unwrap();
}
