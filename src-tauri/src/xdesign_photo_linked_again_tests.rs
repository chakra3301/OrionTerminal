use super::run_with;
use photocraft_engine::{doc::{Affine, AlphaChannel, BlendMode, Document, Layer, LayerContent, LayerId, LayerMask, Metadata, PixelFormat, Rect, SampleType, Slice, SliceOrigin, SmartFilter, SmartObject, SmartSource}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Arc, Weak}};

pub(super) const AGAIN: &str = "edit.transform.again";
pub(super) const COPY: &str = "edit.transform.againCopy";
pub(super) struct Directory(pub(super) PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
pub(super) struct Fixture {
    pub(super) directory: Directory, pub(super) engine: Session,
    pub(super) active: LayerId, pub(super) other: LayerId, pub(super) embedded: LayerId,
    pub(super) group: LayerId, pub(super) raster: LayerId, pub(super) path: PathBuf, pub(super) bytes: Vec<u8>,
}
pub(super) fn rgba() -> Vec<u8> { vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255] }
pub(super) fn encoded(format: &str, pixels: Vec<u8>) -> Vec<u8> {
    match format {
        "png" => {
            let image = photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,pixels).unwrap();
            photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap()
        }
        "psd" | "psb" => {
            use photocraft_psd::{Compression, LayerSpec, PixelData, PsdBuilder, Version};
            let mut builder = PsdBuilder::new(2,2).version(if format == "psb" { Version::Psb } else { Version::Psd }).compression(Compression::Raw);
            builder.push_layer(LayerSpec::new("Known Again source",0,0,2,2,PixelData::Rgba8(pixels.clone())));
            builder.composite(PixelData::Rgba8(pixels)); builder.to_bytes().unwrap()
        }
        "pcraft" => photocraft_engine::smart_cmds::encode_source(&photocraft_io::import("source.png",&encoded("png",pixels)).unwrap().document).unwrap(),
        _ => unreachable!(),
    }
}
fn object(name: &str, source: SmartSource, x: i32, y: i32, format: PixelFormat) -> Layer {
    let mut cache = Surface::new(format);
    cache.write_region(Rect::from_xywh(x,y,2,2), &rgba().into_iter().map(|v| f32::from(v) / 255.0).collect::<Vec<_>>());
    let mut smart = SmartObject::new(source, Affine::translate(f64::from(x),f64::from(y)), Some(cache));
    smart.smart_filters.push(SmartFilter { command:"plugin.run".into(), params:json!({"path":"hidden must not execute","vendor":[null,7]}), visible:false, opacity:0.37, blend:BlendMode::Multiply });
    let mut filter_mask = LayerMask::hide_all(); filter_mask.surface.write_pixel(x,y,&[0.4]);
    filter_mask.enabled=false; filter_mask.linked=false; filter_mask.density=0.7; filter_mask.feather=0.5; smart.filter_mask=Some(filter_mask);
    smart.psd_raw=Some(Arc::new(b"retained Again placed data".to_vec()));
    let mut layer = Layer::new(name,LayerContent::Smart(smart)); layer.psd_id=Some(51);
    let mut mask=LayerMask::reveal_all(); mask.linked=false; mask.density=0.6; layer.mask=Some(mask);
    for key in [*b"SoLd",*b"PlLd",*b"SoLE",*b"zzzz"] { layer.psd_blocks.push((key,Arc::new([key.as_slice(),b" retained"].concat()))); }
    layer
}
pub(super) fn fixture(depth: u32, format: &str) -> Fixture {
    let directory=Directory(std::env::temp_dir().join(format!("linked-again-{}",ulid::Ulid::new())));
    std::fs::create_dir_all(&directory.0).unwrap();
    let bytes=encoded(format,rgba()); let path=directory.0.join(format!("source.{format}")); std::fs::write(&path,&bytes).unwrap();
    let mut engine=Session::new(); engine.execute("file.new",json!({"width":20,"height":20,"depth":depth})).unwrap();
    let format=engine.active().unwrap().doc.pixel_format();
    let first=object("Original Linked",SmartSource::Linked{path:path.to_string_lossy().into()},2,2,format);
    let mut other=object("Repeated Linked",SmartSource::Linked{path:path.to_string_lossy().into()},8,2,format); other.visible=false;
    let embedded=object("Embedded",SmartSource::Embedded{file_name:"embedded.png".into(),bytes:Arc::new(encoded("png",rgba()))},2,8,format);
    let mut raster=Layer::raster("Raster sibling",format); raster.surface_mut().unwrap().fill_rect(Rect::new(8,8,10,10),&[0.25,0.5,0.75,1.]);
    let ids=[first.id,other.id,embedded.id,raster.id]; let group=Layer::group("Nested group",vec![other,Layer::group("Inner",vec![embedded,raster])]); let group_id=group.id;
    engine.edit("Again fixture",|doc,active| {
        doc.layers=vec![first,group]; *active=Some(ids[0]);
        let mut coverage=Surface::new(PixelFormat::GRAY8); coverage.write_pixel(2,2,&[0.5]);
        doc.channels.push(AlphaChannel::new("Retained Alpha",coverage.clone())); doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));
        doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"unrelated global Again data".to_vec())));
        doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(ids[0]),rect:Rect::new(2,2,4,4),..Default::default()}]; Ok(())
    }).unwrap();
    normalize(&mut engine);
    let state=engine.active_mut().unwrap(); state.selected_layers=vec![ids[0],ids[1]]; state.layer_anchor=Some(ids[1]); state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5]; engine.tools.background=[0.7,0.6,0.5,0.4];
    let state=engine.active().unwrap(); engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:ids[0],mask:false,label:"Older Again Fade".into()});
    Fixture{directory,engine,active:ids[0],other:ids[1],embedded:ids[2],group:group_id,raster:ids[3],path,bytes}
}
pub(super) fn normalize(engine: &mut Session) { let index=engine.active_index().unwrap(); engine.execute("document.activate",json!({"document":index})).unwrap(); }
pub(super) fn seed(engine: &mut Session, kind: &str) {
    let state=engine.active().unwrap(); let layer=state.doc.layer(state.active_layer.unwrap()).unwrap();
    let rect=photocraft_engine::transform_cmds::transform_bounds(&state.doc,layer);
    let params=if kind=="quad" {
        json!({"layer":layer.id.0,"rect":[rect.x0,rect.y0,rect.x1,rect.y1],"quad":[[rect.x0+3,rect.y0+2],[rect.x1+3,rect.y0+2],[rect.x1+3,rect.y1+2],[rect.x0+3,rect.y1+2]],"interpolation":"nearest"})
    } else { assert_eq!(kind,"matrix"); json!({"layer":layer.id.0,"matrix":[1,0,0,1,3,2],"interpolation":"nearest"}) };
    engine.execute("edit.transform",params).unwrap(); normalize(engine);
}
pub(super) fn smart(doc: &Document, id: LayerId) -> &SmartObject { let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else { panic!("Expected Smart Object") }; object }
pub(super) fn checked(_: LayerId, metadata: &Metadata, object: &SmartObject) -> Result<Option<super::super::Bytes>,String> { super::super::super::smart::source_bytes_checked(metadata,&object.source,||Ok(())) }
pub(super) fn host(engine: &mut Session, command: &str, params: Value) -> Result<Value,String> { super::super::super::execute_view_command(engine,command,params) }
pub(super) fn twin(engine: &Session) -> Session {
    let state=engine.active().unwrap(); let mut copy=Session::new(); copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None); *copy.active_mut().unwrap()=state.clone();
    copy.journal=engine.journal.clone(); copy.tools=engine.tools.clone(); copy.presets=engine.presets.clone(); copy.patterns=engine.patterns.clone(); copy.clipboard=engine.clipboard.clone(); copy.style_clipboard=engine.style_clipboard.clone(); copy.edit_state=engine.edit_state.clone();
    super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap(); copy
}
pub(super) fn paired_ids(native: &Layer, actual: &Layer) -> Vec<(LayerId,LayerId)> {
    let mut pairs=vec![(native.id,actual.id)];
    match (native.children(),actual.children()) {
        (Some(native),Some(actual)) => { assert_eq!(native.len(),actual.len()); for (n,a) in native.iter().zip(actual) { pairs.extend(paired_ids(n,a)); } }
        (None,None) => {}, _ => panic!("Copied subtree structure differs"),
    }
    pairs
}
pub(super) fn smart_ids(layer: &Layer) -> Vec<LayerId> {
    let mut ids=Vec::new(); if matches!(layer.content,LayerContent::Smart(_)) { ids.push(layer.id); }
    if let Some(children)=layer.children() { for child in children { ids.extend(smart_ids(child)); } } ids
}
fn mapped(id: LayerId, pairs: &[(LayerId,LayerId)]) -> LayerId { pairs.iter().find(|(native,_)| *native==id).map_or(id,|(_,actual)|*actual) }
fn normalized(doc: &Document, pairs: &[(LayerId,LayerId)]) -> Document {
    let mut doc=doc.clone(); for (native,actual) in pairs { if let Some(layer)=doc.layer_mut(*native) { layer.id=*actual; } }
    for slice in &mut doc.slices.list { slice.layer=slice.layer.map(|id|mapped(id,pairs)); } doc
}
fn journal(engine: &Session, pairs: &[(LayerId,LayerId)]) -> Vec<(String,Value)> {
    engine.journal.iter().map(|(command,params)| {
        let mut params=params.clone();
        if command=="layer.duplicate" { if let Some(id)=params.get("layer").and_then(Value::as_u64) { params["layer"]=json!(mapped(LayerId(id),pairs).0); } }
        (command.clone(),params)
    }).collect()
}
pub(super) fn same(actual: &Session, native: &Session, pairs: &[(LayerId,LayerId)]) {
    let a=actual.active().unwrap(); let n=native.active().unwrap();
    assert_eq!(*a.doc,normalized(&n.doc,pairs)); assert_eq!(a.history.entries(),n.history.entries()); assert_eq!(a.history.past_len(),n.history.past_len());
    assert_eq!((a.history.max_states,a.history.max_bytes),(n.history.max_states,n.history.max_bytes));
    for index in 0..a.history.past_len() { assert_eq!(*a.history.state(index).unwrap(),normalized(&n.history.state(index).unwrap(),pairs)); }
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),n.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,&a.path,&a.last_damage),(n.revision,n.saved_revision,&n.coalesce,&n.path,&n.last_damage));
    assert_eq!(a.active_layer,n.active_layer.map(|id|mapped(id,pairs))); assert_eq!(a.selected_layers,n.selected_layers.iter().map(|id|mapped(*id,pairs)).collect::<Vec<_>>()); assert_eq!(a.layer_anchor,n.layer_anchor.map(|id|mapped(id,pairs)));
    let mut view=n.channel_view.clone(); if let Some(mask)=&mut view.layer_mask { mask.layer=mapped(mask.layer,pairs); } assert_eq!(a.channel_view,view);
    assert_eq!(a.isolated_layers,n.isolated_layers.iter().map(|id|mapped(*id,pairs)).collect::<Vec<_>>());
    assert_eq!(a.fx_collapsed,n.fx_collapsed.iter().map(|id|mapped(*id,pairs)).collect::<Vec<_>>());
    assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",n.symmetry_path));
    assert_eq!(actual.journal,journal(native,pairs));
    let mut fade=native.edit_state.fade.clone(); if let Some(fade)=&mut fade { fade.layer=mapped(fade.layer,pairs); } assert_eq!(actual.edit_state.fade,fade);
    assert_eq!(actual.tools.foreground,native.tools.foreground); assert_eq!(actual.tools.background,native.tools.background); assert_eq!(actual.tools.brush,native.tools.brush);
    assert_eq!(actual.style_clipboard,native.style_clipboard); assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",native.clipboard));
    assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(native));
    assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(native).unwrap());
}
pub(super) fn unchanged(actual: &Session, before: &Session) { same(actual,before,&[]); assert!(Arc::ptr_eq(&actual.active().unwrap().doc,&before.active().unwrap().doc)); }
pub(super) fn pixels(engine: &Session, id: LayerId, x0: i32, y0: i32, expected: &[u8]) {
    let state=engine.active().unwrap(); let surface=state.doc.layer(id).unwrap().surface().unwrap();
    let tolerance=match surface.format().sample { SampleType::U8=>1./255.,SampleType::U16=>2./65535.,SampleType::F32=>1e-6 };
    for y in -2..24 { for x in -2..24 {
        let rgba=if (x0..x0+2).contains(&x)&&(y0..y0+2).contains(&y) { let at=((y-y0)*2+x-x0) as usize*4; [expected[at] as f32/255.,expected[at+1] as f32/255.,expected[at+2] as f32/255.,expected[at+3] as f32/255.] } else { [0.;4] };
        let actual=surface.pixel(x,y); for channel in 0..3 { assert!((actual[channel]-rgba[channel]).abs()<=tolerance,"{x},{y}/{channel}: {} != {}",actual[channel],rgba[channel]); } assert_eq!(actual[3],rgba[3]);
    } }
}
fn differential(engine: &mut Session, native: &mut Session, command: &str, params: Value, pairs: &mut Vec<(LayerId,LayerId)>) -> LayerId {
    let actual=run_with(engine,command,&params,checked).unwrap(); let expected=native.execute(command,params).unwrap(); assert_eq!(actual,expected);
    let id=engine.active().unwrap().active_layer.unwrap();
    if command==COPY { let native_id=native.active().unwrap().active_layer.unwrap(); pairs.extend(paired_ids(native.active().unwrap().doc.layer(native_id).unwrap(),engine.active().unwrap().doc.layer(id).unwrap())); }
    same(engine,native,pairs); id
}

#[test]
fn linked_again_matrix_and_quad_four_formats_three_depths_repeat_literal_source_pixels() {
    for command in [AGAIN,COPY] { for depth in [8,16,32] { for format in ["png","pcraft","psd","psb"] { for kind in ["matrix","quad"] {
        let mut f=fixture(depth,format); seed(&mut f.engine,kind);
        let before=f.engine.active().unwrap().doc.clone(); let past=f.engine.active().unwrap().history.past_len(); let revision=f.engine.active().unwrap().revision; let at=f.engine.journal.len();
        let mut native=twin(&f.engine); let mut pairs=Vec::new();
        let params=json!({"layer":f.raster.0,"target":"quickMask","rect":[99,98,97,96],"interpolation":"missing","coalesce":"ignored-outer","vendor":[null,7]});
        let id=differential(&mut f.engine,&mut native,command,params.clone(),&mut pairs);
        pixels(&f.engine,id,8,6,&rgba());
        assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);
        assert_eq!(f.engine.active().unwrap().revision,revision+if command==COPY {2}else{1});
        assert_eq!(f.engine.active().unwrap().history.undo_label(),Some(if command==COPY {"Transform Again"}else{"Free Transform"}));
        let entries=&f.engine.journal[at..]; assert_eq!(entries.len(),if command==COPY {3}else{2});
        assert_eq!(entries.last(),Some(&(command.into(),params))); assert_eq!(entries[entries.len()-2].0,"edit.transform");
        assert!(entries[entries.len()-2].1.get("coalesce").is_none()); assert!(entries[entries.len()-2].1.get("target").is_none()); assert!(entries[entries.len()-2].1.get("layer").is_none());
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).source,smart(&before,f.active).source);
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).psd_raw,smart(&before,f.active).psd_raw);
        assert_eq!(f.engine.active().unwrap().doc.layer(id).unwrap().psd_blocks,before.layer(f.active).unwrap().psd_blocks);
        assert_eq!(f.engine.active().unwrap().doc.channels,before.channels); assert_eq!(f.engine.active().unwrap().doc.quick_mask,before.quick_mask);
        if command==COPY { assert_ne!(id,f.active); assert_eq!(f.engine.active().unwrap().doc.layer(f.active),before.layer(f.active)); assert_eq!(f.engine.active().unwrap().doc.layer(id).unwrap().psd_id,None); pixels(&f.engine,f.active,5,4,&rgba()); }
        let after=f.engine.active().unwrap().doc.clone(); f.engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&f.engine,&native,&pairs); assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
        f.engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&f.engine,&native,&pairs); assert_eq!(f.engine.active().unwrap().doc,after);
    } } } }
}

#[test]
fn linked_again_quad_uses_current_active_bounds_and_ignores_recorded_and_outer_targets() {
    for command in [AGAIN,COPY] { for depth in [8,16,32] {
        let mut f=fixture(depth,"png"); seed(&mut f.engine,"quad"); f.engine.select_layer(f.other).unwrap(); normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone(); let at=f.engine.journal.len(); let mut native=twin(&f.engine); let mut pairs=Vec::new();
        let id=differential(&mut f.engine,&mut native,command,json!({"layer":f.active.0,"target":{"channel":0},"matrix":[1,0,0,1,100,100],"coalesce":false}),&mut pairs);
        pixels(&f.engine,id,11,4,&rgba()); assert_eq!(f.engine.active().unwrap().doc.layer(f.active),before.layer(f.active));
        let inner=&f.engine.journal[at+usize::from(command==COPY)];
        assert_eq!(inner.0,"edit.transform"); assert_eq!(inner.1,json!({"rect":[8.,2.,10.,4.],"quad":[[11.,4.],[13.,4.],[13.,6.],[11.,6.]],"interpolation":"nearest"}));
    } }
}

#[test]
fn linked_again_rotation_matrix_repeated_has_independent_half_turn_pixel_permutation() {
    let half_turn=vec![255,255,255,255, 0,0,255,255, 0,255,0,255, 255,0,0,255];
    for command in [AGAIN,COPY] { for depth in [8,16,32] {
        let mut f=fixture(depth,"png"); f.engine.execute("edit.transform",json!({"matrix":[0,1,-1,0,12,0],"interpolation":"nearest"})).unwrap(); normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); let mut pairs=Vec::new();
        let id=differential(&mut f.engine,&mut native,command,json!({}),&mut pairs); pixels(&f.engine,id,8,8,&half_turn);
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).source,smart(&before,f.active).source);
    } }
}

#[test]
fn linked_again_projective_quad_repeats_known_rational_map_on_current_bounds() {
    let project=|x:f64,y:f64| [x/(1.0+0.05*x),y/(1.0+0.05*x)];
    for command in [AGAIN,COPY] { for depth in [8,16,32] {
        let mut f=fixture(depth,"png");
        let quad=[[2.,2.],[4.,2.],[4.,4.],[2.,4.]].map(|[x,y]|project(x,y));
        f.engine.execute("edit.transform",json!({"rect":[2,2,4,4],"quad":quad,"interpolation":"nearest"})).unwrap(); normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone();
        let bounds=before.layer(f.active).unwrap().surface().unwrap().content_bounds();
        let at=f.engine.journal.len(); let mut native=twin(&f.engine); let mut pairs=Vec::new();
        let id=differential(&mut f.engine,&mut native,command,json!({"rect":[0,0,1,1]}),&mut pairs);
        let inner=&f.engine.journal[at+usize::from(command==COPY)].1;
        assert_eq!(inner["rect"],json!([f64::from(bounds.x0),f64::from(bounds.y0),f64::from(bounds.x1),f64::from(bounds.y1)]));
        let corners=[[bounds.x0,bounds.y0],[bounds.x1,bounds.y0],[bounds.x1,bounds.y1],[bounds.x0,bounds.y1]];
        for (index,[x,y]) in corners.into_iter().enumerate() {
            let expected=project(f64::from(x),f64::from(y));
            for axis in 0..2 {assert!((inner["quad"][index][axis].as_f64().unwrap()-expected[axis]).abs()<1e-9);}
        }
        let placement=photocraft_engine::smart_cmds::placement(smart(&f.engine.active().unwrap().doc,id));
        for [x,y] in [[2.,2.],[4.,2.],[4.,4.],[2.,4.]] {
            let first=project(x,y);let expected=project(first[0],first[1]);let actual=placement.apply(x-2.0,y-2.0);
            assert!((actual.0-expected[0]).abs()<1e-9);assert!((actual.1-expected[1]).abs()<1e-9);
        }
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).source,smart(&before,f.active).source);
    } }
}

#[test]
fn linked_again_nested_group_copy_preserves_psd_sources_order_and_retires_each_pin() {
    for command in [AGAIN,COPY] { for depth in [8,16,32] {
        let mut f=fixture(depth,"png");
        f.engine.edit("Again group scope",|doc,active|{let first=doc.remove(f.active).unwrap(); doc.layer_mut(f.group).unwrap().children_mut().unwrap().insert(0,first); *active=Some(f.group); Ok(())}).unwrap(); normalize(&mut f.engine); seed(&mut f.engine,"matrix");
        let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); let mut visits=Vec::new(); let mut pins:Vec<Weak<Vec<u8>>>=Vec::new();
        let result=run_with(&mut f.engine,command,&json!({"layer":f.raster.0,"coalesce":"ignored-group"}),|id,meta,object|{
            assert!(pins.iter().all(|pin|pin.upgrade().is_none())); visits.push(id);
            let (name,bytes)=checked(id,meta,object)?.unwrap(); let bytes=Arc::new((*bytes).clone()); pins.push(Arc::downgrade(&bytes)); Ok(Some((name,bytes)))
        }).unwrap();
        assert_eq!(result,native.execute(command,json!({"layer":f.raster.0,"coalesce":"ignored-group"})).unwrap());
        let id=f.engine.active().unwrap().active_layer.unwrap(); let native_id=native.active().unwrap().active_layer.unwrap();
        let pairs=if command==COPY {paired_ids(native.active().unwrap().doc.layer(native_id).unwrap(),f.engine.active().unwrap().doc.layer(id).unwrap())}else{Vec::new()}; same(&f.engine,&native,&pairs);
        let expected=smart_ids(f.engine.active().unwrap().doc.layer(id).unwrap());
        assert_eq!(visits,expected); assert_eq!(visits.len(),3); assert!(pins.iter().all(|pin|pin.upgrade().is_none()));
        for ((actual,original),(x,y)) in visits.iter().zip([f.active,f.other,f.embedded]).zip([(8,6),(14,6),(8,12)]) {
            pixels(&f.engine,*actual,x,y,&rgba()); let a=smart(&f.engine.active().unwrap().doc,*actual); let b=smart(&before,original);
            assert_eq!(a.source,b.source); assert_eq!(a.psd_raw,b.psd_raw); assert_eq!(a.smart_filters,b.smart_filters); assert_eq!(f.engine.active().unwrap().doc.layer(*actual).unwrap().psd_blocks,before.layer(original).unwrap().psd_blocks);
            if command==COPY {assert_eq!(f.engine.active().unwrap().doc.layer(*actual).unwrap().psd_id,None);}
        }
        if command==COPY {assert_eq!(f.engine.active().unwrap().doc.layer(f.group),before.layer(f.group));}
    } }
}

#[test]
fn linked_again_missing_and_corrupt_sources_keep_native_fallback_without_admitting_unsafe_filters() {
    for command in [AGAIN,COPY] { for missing in [false,true] {
        let mut f=fixture(16,"png"); seed(&mut f.engine,"matrix");
        f.engine.edit("Unavailable Again source",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(f.active).unwrap().content else{unreachable!()}; object.smart_filters[0].visible=true; Ok(())}).unwrap(); normalize(&mut f.engine);
        if missing {std::fs::remove_file(&f.path).unwrap();}else{std::fs::write(&f.path,b"invalid Again source bytes").unwrap();}
        let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); let mut pairs=Vec::new();
        let id=differential(&mut f.engine,&mut native,command,json!({}),&mut pairs); pixels(&f.engine,id,8,6,&rgba());
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).source,smart(&before,f.active).source); assert!(smart(&f.engine.active().unwrap().doc,id).smart_filters[0].visible);
    } }
}

#[test]
fn linked_again_available_unsafe_oversize_and_growing_sources_refuse_atomically() {
    for command in [AGAIN,COPY] {
        let mut f=fixture(16,"png"); seed(&mut f.engine,"matrix");
        f.engine.edit("Unsafe available Again stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(f.active).unwrap().content else{unreachable!()}; object.smart_filters[0].visible=true; Ok(())}).unwrap(); normalize(&mut f.engine);
        let before=twin(&f.engine); let mut calls=0;
        let error=run_with(&mut f.engine,command,&json!({}),|id,meta,object|{calls+=1;checked(id,meta,object)}).unwrap_err();
        assert!(error.contains("does not support")); assert_eq!(calls,1); unchanged(&f.engine,&before);
        let mut f=fixture(16,"png");seed(&mut f.engine,"matrix");let before=twin(&f.engine);
        std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES+1).unwrap();
        let error=super::execute(&mut f.engine,command,&json!({})).expect("Again must own this Smart source boundary").unwrap_err();
        assert!(error.contains("512MB"));unchanged(&f.engine,&before);
        struct Growing { read:usize, largest:usize }
        impl std::io::Read for Growing {
            fn read(&mut self, output:&mut [u8])->std::io::Result<usize> {self.largest=self.largest.max(output.len());output.fill(0x7a);self.read+=output.len();Ok(output.len())}
        }
        let mut f=fixture(16,"png");seed(&mut f.engine,"matrix");let before=twin(&f.engine);let mut reader=Growing{read:0,largest:0};
        let error=run_with(&mut f.engine,command,&json!({}),|_,_,_|super::super::super::smart::replay_read_with_limit(&mut reader,32).map(|bytes|Some(("growing.png".into(),Arc::new(bytes))))).unwrap_err();
        assert!(error.contains("512MB"));assert_eq!(reader.read,33);assert!(reader.largest<=64*1024);unchanged(&f.engine,&before);
    }
}

#[test]
fn linked_again_metadata_authority_one_decision_survives_disk_removal_and_retires_pin() {
    use photocraft_io::linked::{encode_linked_file,LinkedFile};
    for command in [AGAIN,COPY] {
        let mut f=fixture(32,"png"); seed(&mut f.engine,"matrix"); let blue=[0,0,255,255].repeat(4);
        let mut block=encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"authority.psb".into(),bytes:encoded("psb",blue.clone())});
        block.extend(encode_linked_file(&LinkedFile{uuid:f.path.to_string_lossy().into(),file_name:"ignored.png".into(),bytes:f.bytes.clone()}));
        f.engine.edit("Again metadata authority",|doc,_|{doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(block)));Ok(())}).unwrap(); normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone(); let mut native=twin(&f.engine); let mut calls=0; let mut weak=None;
        let result=run_with(&mut f.engine,command,&json!({}),|id,meta,object|{calls+=1;let source=checked(id,meta,object)?;weak=source.as_ref().map(|(_,bytes)|Arc::downgrade(bytes));std::fs::remove_file(&f.path).unwrap();Ok(source)}).unwrap();
        assert_eq!(result,native.execute(command,json!({})).unwrap()); let id=f.engine.active().unwrap().active_layer.unwrap(); let native_id=native.active().unwrap().active_layer.unwrap();
        let pairs=if command==COPY {paired_ids(native.active().unwrap().doc.layer(native_id).unwrap(),f.engine.active().unwrap().doc.layer(id).unwrap())}else{Vec::new()}; same(&f.engine,&native,&pairs);
        assert_eq!(calls,1); assert!(weak.unwrap().upgrade().is_none()); pixels(&f.engine,id,8,6,&blue); assert_eq!(smart(&f.engine.active().unwrap().doc,id).source,smart(&before,f.active).source);
    }
}

#[test]
fn linked_again_copy_repeated_steps_ignore_outer_coalesce_and_preserve_all_prior_copies() {
    let mut f=fixture(16,"png"); seed(&mut f.engine,"matrix"); let before=f.engine.active().unwrap().doc.clone(); let past=f.engine.active().unwrap().history.past_len(); let revision=f.engine.active().unwrap().revision; let mut native=twin(&f.engine); let mut pairs=Vec::new(); let mut previous=Vec::new();
    for (index,(x,y)) in [(8,6),(11,8),(14,10)].into_iter().enumerate() {
        let snapshot=f.engine.active().unwrap().doc.clone(); let at=f.engine.journal.len();
        let id=differential(&mut f.engine,&mut native,COPY,json!({"layer":f.active.0,"coalesce":"ignored-repeated-copy","target":"mask"}),&mut pairs);
        assert_eq!(f.engine.active().unwrap().history.past_len(),past+index+1); assert_eq!(f.engine.active().unwrap().revision,revision+2*(index as u64+1)); assert_eq!(f.engine.journal.len(),at+3);
        for old in &previous {assert_eq!(f.engine.active().unwrap().doc.layer(*old),snapshot.layer(*old));} previous.push(id); pixels(&f.engine,id,x,y,&rgba());
        assert_eq!(f.engine.active().unwrap().doc.layer(f.active),before.layer(f.active));
    }
    let after=f.engine.active().unwrap().doc.clone(); f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native,&pairs); assert_eq!(f.engine.active().unwrap().doc.layers.len(),after.layers.len()-1);
    f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&f.engine,&native,&pairs);assert_eq!(f.engine.active().unwrap().doc,after);
}

#[test]
fn linked_again_native_history_limits_and_existing_redo_keep_exact_trim_purge_rules() {
    for command in [AGAIN,COPY] { for max_states in [1,2,50] {
        let mut f=fixture(16,"png");seed(&mut f.engine,"matrix");
        f.engine.edit("Redo state before successful Again",|_,_|Ok(())).unwrap();
        assert!(f.engine.undo());normalize(&mut f.engine);
        assert!(f.engine.active().unwrap().history.can_redo());
        f.engine.active_mut().unwrap().history.max_states=max_states;
        let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);let mut pairs=Vec::new();
        let id=differential(&mut f.engine,&mut native,command,json!({"coalesce":"ignored-limited-history"}),&mut pairs);
        pixels(&f.engine,id,8,6,&rgba());assert!(!f.engine.active().unwrap().history.can_redo());
        if command==COPY&&max_states==1 {assert!(!f.engine.active().unwrap().history.can_undo());}
        let after=f.engine.active().unwrap().doc.clone();
        if native.active().unwrap().history.can_undo() {
            f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native,&pairs);
            assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
            f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&f.engine,&native,&pairs);assert_eq!(f.engine.active().unwrap().doc,after);
        }
    } }
}

#[test]
fn linked_again_byte_budget_uses_fresh_growing_and_shrinking_source_before_native_trim() {
    let wide_image=photocraft_codecs::Image::from_u8(320,2,photocraft_codecs::ChannelLayout::Rgba,[255,0,0,255].repeat(640)).unwrap();
    let wide=photocraft_codecs::encode(&wide_image,photocraft_codecs::Format::Png,&Default::default()).unwrap();
    for command in [AGAIN,COPY] { for growth in [false,true] {
        let mut f=fixture(8,"png");
        if !growth {std::fs::write(&f.path,&wide).unwrap();}
        seed(&mut f.engine,"matrix");
        for version in 1..=4 {
            f.engine.edit(&format!("Distinct budget raster version {version}"),|doc,_| {
                doc.layer_mut(f.raster).unwrap().surface_mut().unwrap().write_pixel(8,8,&[version as f32/8.0,0.4,0.6,1.0]);Ok(())
            }).unwrap();
        }
        f.engine.edit("Existing redo before byte-budget Again",|_,_|Ok(())).unwrap();
        assert!(f.engine.undo());assert!(f.engine.active().unwrap().history.can_redo());
        normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone();
        let format=before.pixel_format();let one_tile=256usize*256*format.bytes_per_pixel();assert_eq!(one_tile,256*256*4);
        let budget=f.engine.active().unwrap().history.pixel_bytes(&before)+one_tile;
        f.engine.active_mut().unwrap().history.max_bytes=budget;
        let mut native=twin(&f.engine);let mut fallback=twin(&f.engine);
        let LayerContent::Smart(fallback_smart)=&mut Arc::make_mut(&mut fallback.active_mut().unwrap().doc).layer_mut(f.active).unwrap().content else {unreachable!()};
        fallback_smart.source=SmartSource::Embedded{file_name:String::new(),bytes:Arc::new(Vec::new())};
        std::fs::write(&f.path,if growth {&wide}else{&f.bytes}).unwrap();
        let result=run_with(&mut f.engine,command,&json!({}),checked).unwrap();
        let expected=native.execute(command,json!({})).unwrap();assert_eq!(result,expected);
        fallback.execute(command,json!({})).unwrap();
        assert_ne!(native.active().unwrap().history.entries(),fallback.active().unwrap().history.entries(),"The fixture must distinguish fresh source trim from fallback-cache trim: {command}/{growth}");
        let actual_id=f.engine.active().unwrap().active_layer.unwrap();let native_id=native.active().unwrap().active_layer.unwrap();
        let pairs=if command==COPY {paired_ids(native.active().unwrap().doc.layer(native_id).unwrap(),f.engine.active().unwrap().doc.layer(actual_id).unwrap())}else{Vec::new()};
        same(&f.engine,&native,&pairs);
        assert!(!f.engine.active().unwrap().history.can_redo());
        assert_eq!(f.engine.active().unwrap().history.max_bytes,budget);
        let cache=smart(&f.engine.active().unwrap().doc,actual_id).cache.as_ref().unwrap();
        assert_eq!(cache.content_bounds(),Rect::new(8,6,if growth{328}else{10},8));
        assert_eq!(cache.tile_count(),if growth{2}else{1});
        assert_eq!(cache.pixel(8,6),vec![1.,0.,0.,1.]);
        assert_eq!(smart(&f.engine.active().unwrap().doc,actual_id).source,smart(&before,f.active).source);
        let after=f.engine.active().unwrap().doc.clone();
        f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native,&pairs);
        assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
        f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&f.engine,&native,&pairs);assert_eq!(f.engine.active().unwrap().doc,after);
    } }
}
