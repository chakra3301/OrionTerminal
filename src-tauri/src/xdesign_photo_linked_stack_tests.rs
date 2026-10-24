use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Layer, LayerMask, PixelFormat, Rect, SampleType, Size, Slice, SliceOrigin, SmartFilter};
use photocraft_raster::Surface;
use std::{collections::BTreeMap, io::Read, path::PathBuf, sync::atomic::{AtomicBool, Ordering}};

pub(super) struct Directory(pub(super) PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
fn directory() -> Directory { let path = std::env::temp_dir().join(format!("linked-stack-{}", ulid::Ulid::new())); std::fs::create_dir_all(&path).unwrap(); Directory(path) }

const FRAMES: [[[u8; 4]; 4]; 3] = [
    [[255,0,0,255], [255,0,0,255], [0,0,255,255], [255,0,0,85]],
    [[0,255,0,255], [0,0,255,0], [255,255,255,255], [0,255,0,170]],
    [[0,0,255,255], [0,255,0,255], [255,0,0,255], [0,0,255,0]],
];

fn source_doc() -> Document {
    let mut doc = Document::new("Three known stack frames", Size::new(2,2), photocraft_engine::doc::ColorMode::Rgb, SampleType::U8);
    for (index, pixels) in FRAMES.iter().enumerate() {
        let mut layer = Layer::raster(format!("Frame {index}"), PixelFormat::RGBA8);
        let raw: Vec<f32> = pixels.iter().flatten().map(|value| f32::from(*value) / 255.0).collect();
        layer.surface_mut().unwrap().write_region(Rect::new(0,0,2,2), &raw); doc.layers.push(layer);
    }
    let mut hidden = Layer::raster("Hidden outlier", PixelFormat::RGBA8); hidden.surface_mut().unwrap().fill_rect(Rect::new(0,0,2,2), &[1.0;4]); hidden.visible=false; doc.layers.push(hidden); doc
}
fn encode_doc(doc: &Document, format: &str) -> Vec<u8> {
    if format == "pcraft" { photocraft_engine::smart_cmds::encode_source(doc).unwrap() }
    else { photocraft_io::export(doc, &format!("stack.{format}"), &Default::default()).unwrap().bytes }
}
pub(super) fn encoded(format: &str) -> Vec<u8> { encode_doc(&source_doc(), format) }
pub(super) fn command(mode: Option<StackMode>) -> String { format!("layer.smartObjects.stackMode.{}", mode.map_or("none", StackMode::id)) }

fn object_layer(name: &str, source: SmartSource, x: i32, y: i32, format: PixelFormat) -> Layer {
    let mut cache=Surface::new(format); cache.fill_rect(Rect::from_xywh(x,y,1,1), &[0.25,0.5,0.75,1.0]);
    let mut object=SmartObject::new(source,Affine::translate(f64::from(x),f64::from(y)),Some(cache));
    object.smart_filters=vec![
        SmartFilter{command:"filter.other.offset".into(),params:json!({"horizontal":1,"vertical":0,"undefinedAreas":"transparent","vendor":[null,3]}),visible:true,opacity:1.0,blend:BlendMode::Normal},
        SmartFilter{command:"filter.cameraRaw".into(),params:json!({"exposure":2,"future":{"retained":true}}),visible:false,opacity:0.63,blend:BlendMode::Multiply},
    ];
    let mut filter_mask=LayerMask::hide_all(); filter_mask.enabled=false;filter_mask.linked=false;filter_mask.density=0.42;filter_mask.feather=1.25;filter_mask.surface.write_pixel(x,y,&[0.4]);object.filter_mask=Some(filter_mask);object.psd_raw=Some(Arc::new(b"original placed data".to_vec()));
    let mut layer=Layer::new(name,LayerContent::Smart(object)); let mut mask=LayerMask::reveal_all();mask.linked=false;mask.density=0.6;layer.mask=Some(mask);
    for key in [*b"SoLd",*b"SoLE",*b"PlLd",*b"zzzz"] { layer.psd_blocks.push((key,Arc::new([key.as_slice(),b" retained"].concat()))); } layer
}

pub(super) struct Fixture {
    pub(super) directory: Directory, pub(super) engine: Session, pub(super) active: LayerId,
    pub(super) other: LayerId, pub(super) embedded: LayerId, pub(super) raster: LayerId,
    pub(super) path: PathBuf, pub(super) bytes: Vec<u8>,
}
pub(super) fn fixture(depth: u32, format: &str) -> Fixture {
    let directory=directory();let path=directory.0.join(format!("stack.{format}"));let bytes=encoded(format);std::fs::write(&path,&bytes).unwrap();
    let mut engine=Session::new();engine.execute("file.new",json!({"width":12,"height":10,"depth":depth})).unwrap();let fmt=engine.active().unwrap().doc.pixel_format();
    let active=object_layer("Active Linked stack",SmartSource::Linked{path:path.to_string_lossy().into()},2,1,fmt);
    let mut other=object_layer("Inactive Linked stack",SmartSource::Linked{path:path.to_string_lossy().into()},6,5,fmt);other.visible=false;
    let embedded=object_layer("Inactive Embedded stack",SmartSource::Embedded{file_name:format!("embedded.{format}"),bytes:Arc::new(bytes.clone())},8,1,fmt);
    let raster=Layer::raster("Unrelated raster",fmt);let ids=[active.id,other.id,embedded.id,raster.id];
    engine.edit("Stack fixture",|doc,current|{
        doc.layers=vec![active,Layer::group("Hidden nested target",vec![other]),embedded,raster];*current=Some(ids[0]);
        let mut coverage=Surface::new(PixelFormat::GRAY8);coverage.fill_rect(Rect::new(3,2,5,5),&[0.5]);doc.selection=Some(coverage.clone());doc.channels.push(AlphaChannel::new("Retained Alpha",coverage.clone()));doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));
        doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"unrelated global bytes".to_vec())));doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(ids[0]),rect:Rect::from_xywh(2,1,1,1),..Default::default()}];Ok(())
    }).unwrap();let index=engine.active_index().unwrap();engine.execute("document.activate",json!({"document":index})).unwrap();
    let state=engine.active_mut().unwrap();state.selected_layers=vec![ids[0],ids[1]];state.layer_anchor=Some(ids[1]);state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5];engine.tools.background=[0.7,0.6,0.5,0.4];let state=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:ids[0],mask:false,label:"Older retained Fade".into()});
    Fixture{directory,engine,active:ids[0],other:ids[1],embedded:ids[2],raster:ids[3],path,bytes}
}
pub(super) fn smart(doc: &Document,id: LayerId) -> &SmartObject { let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else {panic!("Expected Smart Object")};object }
pub(super) fn twin(engine: &Session) -> Session {
    let state=engine.active().unwrap();let mut copy=Session::new();copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None);*copy.active_mut().unwrap()=state.clone();
    copy.journal=engine.journal.clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.clipboard=engine.clipboard.clone();copy.style_clipboard=engine.style_clipboard.clone();copy.edit_state=engine.edit_state.clone();super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap();copy
}
pub(super) fn same(actual: &Session,native: &Session) {
    let a=actual.active().unwrap();let n=native.active().unwrap();assert_eq!(a.doc,n.doc);assert_eq!(a.history.entries(),n.history.entries());assert_eq!(a.history.past_len(),n.history.past_len());for index in 0..a.history.past_len(){assert_eq!(a.history.state(index),n.history.state(index));}assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),n.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(n.revision,n.saved_revision,&n.coalesce,n.active_layer,&n.selected_layers,n.layer_anchor,&n.path,&n.last_damage));assert_eq!(a.channel_view,n.channel_view);assert_eq!(a.isolated_layers,n.isolated_layers);assert_eq!(a.fx_collapsed,n.fx_collapsed);assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",n.symmetry_path));
    assert_eq!(actual.journal,native.journal);assert_eq!(actual.edit_state.fade,native.edit_state.fade);assert_eq!(actual.tools.foreground,native.tools.foreground);assert_eq!(actual.tools.background,native.tools.background);assert_eq!(actual.tools.brush,native.tools.brush);assert_eq!(actual.style_clipboard,native.style_clipboard);assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",native.clipboard));assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(native));assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(native).unwrap());
}
pub(super) fn unchanged(engine: &Session,before: &Session) {same(engine,before);assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));}
pub(super) fn host(engine: &mut Session,command: &str,params: Value) -> Result<Value,String> {super::super::super::execute_view_command(engine,command,params)}
pub(super) fn checked(metadata: &Metadata,object: &SmartObject) -> Result<Option<super::super::Bytes>,String> {super::super::super::smart::source_bytes_checked(metadata,&object.source,||Ok(()))}
fn retained(engine: &Session,before: &Document,id: LayerId) {
    let doc=&engine.active().unwrap().doc;let mut actual=smart(doc,id).clone();let original=smart(before,id);actual.stack_mode=original.stack_mode;actual.cache=original.cache.clone();assert_eq!(&actual,original);assert_eq!(doc.layer(id).unwrap().psd_blocks,before.layer(id).unwrap().psd_blocks);assert_eq!(doc.layer(id).unwrap().mask,before.layer(id).unwrap().mask);assert_eq!(doc.metadata,before.metadata);assert_eq!(doc.selection,before.selection);assert_eq!(doc.channels,before.channels);assert_eq!(doc.quick_mask,before.quick_mask);
}
fn statistic(values: &[f64],mode: StackMode) -> f64 {
    if values.is_empty(){return 0.0;}let n=values.len() as f64;let mean=values.iter().sum::<f64>()/n;let moment=|power:i32|values.iter().map(|value|(value-mean).powi(power)).sum::<f64>()/n;
    match mode {
        StackMode::Mean=>mean,StackMode::Summation=>values.iter().sum(),StackMode::Minimum=>values.iter().copied().reduce(f64::min).unwrap(),StackMode::Maximum=>values.iter().copied().reduce(f64::max).unwrap(),StackMode::Range=>values.iter().copied().reduce(f64::max).unwrap()-values.iter().copied().reduce(f64::min).unwrap(),
        StackMode::Median=>{let mut ordered=values.to_vec();ordered.sort_by(f64::total_cmp);let center=ordered.len()/2;if ordered.len()%2==0{(ordered[center-1]+ordered[center])/2.0}else{ordered[center]}},
        StackMode::Variance=>moment(2),StackMode::StandardDeviation=>moment(2).sqrt(),StackMode::Skewness=>{let sd=moment(2).sqrt();if sd<1e-6{0.5}else{(moment(3)/sd.powi(3)/4.0+0.5).clamp(0.0,1.0)}},StackMode::Kurtosis=>{let variance=moment(2);if variance<1e-12{0.0}else{(moment(4)/variance.powi(2)/10.0).clamp(0.0,1.0)}},
        StackMode::Entropy=>{if values.len()<2{return 0.0;}let mut histogram=BTreeMap::new();for value in values{*histogram.entry((value.clamp(0.0,1.0)*255.0).round() as u8).or_insert(0usize)+=1;}histogram.values().map(|count|{let probability=*count as f64/n;-probability*probability.log2()}).sum::<f64>()/n.log2()},
    }.clamp(0.0,1.0)
}
fn over(bottom: [f64;4],top: [f64;4]) -> [f64;4] {let alpha=top[3]+bottom[3]*(1.0-top[3]);if alpha==0.0{return[0.0;4];}[(top[0]*top[3]+bottom[0]*bottom[3]*(1.0-top[3]))/alpha,(top[1]*top[3]+bottom[1]*bottom[3]*(1.0-top[3]))/alpha,(top[2]*top[3]+bottom[2]*bottom[3]*(1.0-top[3]))/alpha,alpha]}
fn expected(pixel: usize,mode: Option<StackMode>) -> [f64;4] {
    let samples:Vec<[f64;4]>=FRAMES.iter().map(|frame|frame[pixel].map(|value|f64::from(value)/255.0)).collect();
    if let Some(mode)=mode{let mut result=[0.0;4];let opaque:Vec<_>=samples.iter().filter(|sample|sample[3]>0.0).collect();if opaque.is_empty(){return result;}for channel in 0..3{result[channel]=statistic(&opaque.iter().map(|sample|sample[channel]).collect::<Vec<_>>(),mode);}result[3]=opaque.iter().map(|sample|sample[3]).fold(0.0,f64::max);result}
    else{samples.into_iter().fold([0.0;4],over)}
}
fn quantized(value: f64,sample: SampleType) -> f32 {match sample{SampleType::U8=>(value*255.0).round() as f32/255.0,SampleType::U16=>(value*65535.0).round() as f32/65535.0,SampleType::F32=>value as f32}}
pub(super) fn assert_pixels(engine: &Session,id: LayerId,mode: Option<StackMode>) {
    let doc=&engine.active().unwrap().doc;let object=smart(doc,id);let surface=object.cache.as_ref().unwrap();let x0=object.transform.m[4] as i32+1;let y0=object.transform.m[5] as i32;let tolerance=match doc.depth{SampleType::U8=>1.0/255.0,SampleType::U16=>2.0/65535.0,SampleType::F32=>1e-6};
    for y in -1..12{for x in -1..14{let raw=if(x0..x0+2).contains(&x)&&(y0..y0+2).contains(&y){expected(((y-y0)*2+x-x0) as usize,mode)}else{[0.0;4]};let expected=raw.map(|value|quantized(value,doc.depth));let actual=surface.pixel(x,y);for channel in 0..4{assert!((actual[channel]-expected[channel]).abs()<=tolerance,"{:?}/{mode:?}/{x},{y}/{channel}:{} != {}",doc.depth,actual[channel],expected[channel]);}assert_eq!(actual[3],expected[3],"alpha/{:?}/{mode:?}/{x},{y}",doc.depth);}}
}
fn unsafe_filter() -> SmartFilter {SmartFilter{command:"plugin.run".into(),params:json!({"path":"must never execute"}),visible:true,opacity:0.0,blend:BlendMode::Normal}}

#[test]
fn linked_stack_all_twelve_modes_three_depths_three_formats_match_native_and_independent_statistics() {
    for (mode,literal) in [(StackMode::Entropy,0.579380164285695),(StackMode::Kurtosis,0.15),(StackMode::Maximum,1.0),(StackMode::Mean,0.3333333333333333),(StackMode::Median,0.0),(StackMode::Minimum,0.0),(StackMode::Range,1.0),(StackMode::Skewness,0.676776695296637),(StackMode::StandardDeviation,0.4714045207910317),(StackMode::Summation,1.0),(StackMode::Variance,0.2222222222222222)]{let pixel=expected(0,Some(mode));for channel in 0..3{assert!((pixel[channel]-literal).abs()<1e-12,"literal {mode:?}/{channel}");}assert_eq!(pixel[3],1.0);}
    assert_eq!(expected(0,None),[0.0,0.0,1.0,1.0]);assert_eq!(expected(1,Some(StackMode::Mean)),[0.5,0.5,0.0,1.0]);assert_eq!(expected(3,Some(StackMode::Mean)),[0.5,0.5,0.0,170.0/255.0]);
    for depth in [8,16,32]{for format in ["pcraft","psd","psb"]{for mode in StackMode::ALL.into_iter().map(Some).chain([None]){
        let mut f=fixture(depth,format);let before=f.engine.active().unwrap().doc.clone();let past=f.engine.active().unwrap().history.past_len();let journal=f.engine.journal.len();let mut native=twin(&f.engine);let command=command(mode);let params=json!({"layer":f.active.0,"vendor":[null,7]});
        assert_eq!(host(&mut f.engine,&command,params.clone()).unwrap(),native.execute(&command,params).unwrap());same(&f.engine,&native);assert_eq!(smart(&f.engine.active().unwrap().doc,f.active).stack_mode,mode);assert_pixels(&f.engine,f.active,mode);retained(&f.engine,&before,f.active);
        for id in [f.other,f.embedded,f.raster]{assert_eq!(f.engine.active().unwrap().doc.layer(id),before.layer(id));}assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);assert_eq!(f.engine.journal.len(),journal+1);assert_eq!(f.engine.active().unwrap().doc.slices.list[0].rect,Rect::new(3,1,5,3));
    }}}
}

#[test]
fn linked_stack_single_group_unwrap_and_multiple_groups_use_native_frame_boundaries() {
    for format in ["pcraft","psd","psb"]{let mut f=fixture(16,format);let mut doc=source_doc();let layers=std::mem::take(&mut doc.layers);doc.layers=vec![Layer::group("Single nested stack",layers)];std::fs::write(&f.path,encode_doc(&doc,format)).unwrap();let mut native=twin(&f.engine);let command=command(Some(StackMode::Mean));host(&mut f.engine,&command,json!({})).unwrap();native.execute(&command,json!({})).unwrap();same(&f.engine,&native);assert_pixels(&f.engine,f.active,Some(StackMode::Mean));}
    let mut f=fixture(32,"pcraft");let mut doc=source_doc();let mut layers=std::mem::take(&mut doc.layers);let second=layers.remove(2);let hidden=layers.pop().unwrap();doc.layers=vec![Layer::group("Composite first frame",layers),Layer::group("Composite second frame",vec![second]),hidden];std::fs::write(&f.path,encode_doc(&doc,"pcraft")).unwrap();let mut native=twin(&f.engine);let command=command(Some(StackMode::Mean));host(&mut f.engine,&command,json!({})).unwrap();native.execute(&command,json!({})).unwrap();same(&f.engine,&native);let pixel=smart(&f.engine.active().unwrap().doc,f.active).cache.as_ref().unwrap().pixel(3,1);assert_eq!(pixel,vec![0.0,0.5,0.5,1.0]);assert_ne!(pixel,expected(0,Some(StackMode::Mean)).map(|value|value as f32).to_vec());
}

#[test]
fn linked_stack_missing_unsafe_sources_commit_every_requested_mode_and_retain_cached_or_empty_fallback() {
    for cache in [false,true]{for mode in StackMode::ALL.into_iter().map(Some).chain([None]){let mut f=fixture(16,"pcraft");let id=f.active;f.engine.edit("Missing unsafe stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.smart_filters.push(unsafe_filter());if !cache{object.cache=None;}Ok(())}).unwrap();let index=f.engine.active_index().unwrap();f.engine.execute("document.activate",json!({"document":index})).unwrap();std::fs::remove_file(&f.path).unwrap();let before=f.engine.active().unwrap().doc.clone();let past=f.engine.active().unwrap().history.past_len();let mut native=twin(&f.engine);let command=command(mode);let mut reads=0;
        let result=run_with(&mut f.engine,&command,&Value::Null,|meta,object|{reads+=1;assert_eq!(object.stack_mode,mode);super::super::super::smart::source_bytes_checked(meta,&object.source,||panic!("missing source reached admission"))}).unwrap();assert_eq!(result,native.execute(&command,Value::Null).unwrap());assert_eq!(result,json!({"stackMode":mode.map(StackMode::id)}));assert_eq!(reads,1);same(&f.engine,&native);assert_eq!(smart(&f.engine.active().unwrap().doc,f.active).cache,smart(&before,f.active).cache);retained(&f.engine,&before,f.active);assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);
    }}
}

#[test]
fn linked_stack_corrupt_empty_and_decoded_unsafe_sources_preserve_native_error_priority_and_owner_identity() {
    for mode in [Some(StackMode::Mean),None]{for bytes in [b"corrupt stacked image".as_slice(),b"".as_slice()]{let mut f=fixture(16,"psd");let id=f.active;f.engine.edit("Corrupt unsafe stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.smart_filters.push(unsafe_filter());Ok(())}).unwrap();std::fs::write(&f.path,bytes).unwrap();let before=twin(&f.engine);let mut native=twin(&f.engine);let command=command(mode);let error=host(&mut f.engine,&command,json!({})).unwrap_err();assert_eq!(error,native.execute(&command,json!({})).unwrap_err().to_string());assert!(!error.contains("Bounded linked-source"));unchanged(&f.engine,&before);unchanged(&native,&before);}}
    for (enabled,visible) in [(true,true),(false,true),(true,false)]{let mut f=fixture(16,"pcraft");let id=f.active;f.engine.edit("Available unsafe stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.filters_enabled=enabled;let mut filter=unsafe_filter();filter.visible=visible;object.smart_filters.push(filter);Ok(())}).unwrap();let before=twin(&f.engine);let command=command(Some(StackMode::Mean));if enabled&&visible{assert!(host(&mut f.engine,&command,json!({})).unwrap_err().contains("does not support"));unchanged(&f.engine,&before);}else{let mut native=twin(&f.engine);host(&mut f.engine,&command,json!({})).unwrap();native.execute(&command,json!({})).unwrap();same(&f.engine,&native);}}
}

#[test]
fn linked_stack_metadata_first_source_authority_ignores_changed_disk_and_preserves_global_bytes() {
    use photocraft_io::linked::{encode_linked_file,LinkedFile};let mut f=fixture(16,"pcraft");let mut block=encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"metadata.psb".into(),bytes:encoded("psb")});block.extend(encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"ignored.psd".into(),bytes:b"ignored invalid later bytes".to_vec()}));f.engine.edit("Metadata stack authority",|doc,_|{doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(block)));Ok(())}).unwrap();std::fs::write(&f.path,b"changed unreadable disk source").unwrap();let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);let command=command(Some(StackMode::Median));host(&mut f.engine,&command,json!({})).unwrap();native.execute(&command,json!({})).unwrap();same(&f.engine,&native);assert_pixels(&f.engine,f.active,Some(StackMode::Median));retained(&f.engine,&before,f.active);
}

#[test]
fn linked_stack_sparse_cap_and_growing_reader_refuse_before_authoritative_edit() {
    let mut f=fixture(16,"pcraft");std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();let before=twin(&f.engine);let command=command(Some(StackMode::Mean));assert!(host(&mut f.engine,&command,json!({})).unwrap_err().contains("512MB"));unchanged(&f.engine,&before);
    struct Growing{count:usize,max:usize}impl Read for Growing{fn read(&mut self,out:&mut[u8])->std::io::Result<usize>{self.max=self.max.max(out.len());self.count+=out.len();out.fill(0x7a);Ok(out.len())}}
    let mut f=fixture(16,"psd");let before=twin(&f.engine);let mut reader=Growing{count:0,max:0};let error=run_with(&mut f.engine,&command,&json!({}),|_,_|super::super::super::smart::replay_read_with_limit(&mut reader,32).map(|bytes|Some(("growing.psd".into(),Arc::new(bytes))))).unwrap_err();assert!(error.contains("512MB"));assert_eq!(reader.count,33);assert!(reader.max<=64*1024);unchanged(&f.engine,&before);
}

#[test]
fn linked_stack_repeated_modes_use_the_requested_statistic_or_composite_cache_without_changing_source() {
    let mut f=fixture(32,"pcraft");let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);
    for mode in [Some(StackMode::Mean),Some(StackMode::Maximum),None,Some(StackMode::Mean)]{let command=command(mode);let mut reads=0;let result=run_with(&mut f.engine,&command,&json!({}),|meta,object|{reads+=1;assert_eq!(object.stack_mode,mode);assert_eq!(object.source,smart(&before,f.active).source);checked(meta,object)}).unwrap();assert_eq!(result,native.execute(&command,json!({})).unwrap());assert_eq!(reads,1);same(&f.engine,&native);assert_pixels(&f.engine,f.active,mode);retained(&f.engine,&before,f.active);}
}

#[test]
fn linked_stack_native_active_enablement_explicit_target_and_as_u64_defaults_precede_source_reads() {
    let command=command(Some(StackMode::Mean));
    for target in [Value::Null,json!({}),json!({"layer":null}),json!({"layer":-1}),json!({"layer":"wrong"})]{let mut f=fixture(16,"pcraft");let mut native=twin(&f.engine);assert_eq!(host(&mut f.engine,&command,target.clone()).unwrap(),native.execute(&command,target).unwrap());same(&f.engine,&native);assert_pixels(&f.engine,f.active,Some(StackMode::Mean));}
    for target in ["inactiveLinked","inactiveEmbedded"]{let mut f=fixture(16,"pcraft");let id=if target=="inactiveLinked"{f.other}else{f.embedded};if target=="inactiveEmbedded"{std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();}let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);let params=json!({"layer":id.0});host(&mut f.engine,&command,params.clone()).unwrap();native.execute(&command,params).unwrap();same(&f.engine,&native);assert_pixels(&f.engine,id,Some(StackMode::Mean));assert_eq!(f.engine.active().unwrap().doc.layer(f.active),before.layer(f.active));retained(&f.engine,&before,id);if id==f.embedded{let(SmartSource::Embedded{bytes:a,..},SmartSource::Embedded{bytes:b,..})=(&smart(&before,id).source,&smart(&f.engine.active().unwrap().doc,id).source)else{unreachable!()};assert!(Arc::ptr_eq(a,b));}}
    for invalid in ["stale","raster","activeRaster","noActive","array","string","unknown"]{let mut f=fixture(8,"pcraft");let mut params=json!({});let actual_command=if invalid=="unknown"{"layer.smartObjects.stackMode.future"}else{&command};match invalid{"stale"=>params["layer"]=json!(u64::MAX),"raster"=>params["layer"]=json!(f.raster.0),"activeRaster"=>{f.engine.active_mut().unwrap().active_layer=Some(f.raster);params["layer"]=json!(f.active.0);},"noActive"=>f.engine.active_mut().unwrap().active_layer=None,"array"=>params=json!([]),"string"=>params=json!("wrong"),_=>{}}std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();let before=twin(&f.engine);let mut native=twin(&f.engine);let mut reads=0;assert_eq!(run_with(&mut f.engine,actual_command,&params,|meta,object|{reads+=1;checked(meta,object)}).unwrap_err(),native.execute(actual_command,params).unwrap_err().to_string());assert_eq!(reads,0);unchanged(&f.engine,&before);}
    let mut empty=Session::new();assert_eq!(host(&mut empty,&command,json!({})).unwrap_err(),empty.execute(&command,json!({})).unwrap_err().to_string());
}

#[test]
fn linked_stack_active_job_refusal_happens_before_any_source_resolution() {
    let mut f=fixture(8,"pcraft");let release=Arc::new(AtomicBool::new(false));let worker=release.clone();struct Release(Arc<AtomicBool>);impl Drop for Release{fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}let _release=Release(release.clone());let started=f.engine.start_job("stack-test",json!({}),"Retained stack job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected native job")};let before=twin(&f.engine);std::fs::remove_file(&f.path).unwrap();let command=command(Some(StackMode::Mean));let mut reads=0;let error=run_with(&mut f.engine,&command,&json!({"layer":u64::MAX}),|meta,object|{reads+=1;checked(meta,object)}).unwrap_err();assert_eq!(error,f.engine.execute(&command,json!({"layer":u64::MAX})).unwrap_err().to_string());assert!(error.contains("Retained stack job"));assert_eq!(reads,0);unchanged(&f.engine,&before);release.store(true,Ordering::Relaxed);f.engine.wait_job(job).unwrap();
}
