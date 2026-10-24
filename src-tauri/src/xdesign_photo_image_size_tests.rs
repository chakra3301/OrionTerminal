use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Color, Effect, Fill, FillCache, FxCommon, FxPaint, LayerMask, NamedPath, Note, Path, PixelFormat, Rect, ShapeLayer, Size, Slice, SliceOrigin, SmartFilter, SmartObject, StrokeFx, StrokePosition, Subpath, TextLayer};
use std::{cell::Cell, path::PathBuf};

struct Directory(PathBuf);
impl Drop for Directory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
fn directory() -> Directory { let path = std::env::temp_dir().join(format!("image-size-{}", ulid::Ulid::new())); std::fs::create_dir_all(&path).unwrap(); Directory(path) }
fn encoded(format: &str) -> Vec<u8> {
    let rgba = vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255];
    match format {
        "png" => { let image = photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,rgba).unwrap(); photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap() }
        "psd" | "psb" => { use photocraft_psd::{Compression,LayerSpec,PixelData,PsdBuilder,Version}; let mut builder = PsdBuilder::new(2,2).version(if format=="psb" {Version::Psb} else {Version::Psd}).compression(Compression::Raw); builder.push_layer(LayerSpec::new("Known",0,0,2,2,PixelData::Rgba8(rgba.clone()))); builder.composite(PixelData::Rgba8(rgba)); builder.to_bytes().unwrap() }
        "pcraft" => { let document = photocraft_io::import("known.png",&encoded("png")).unwrap().document; photocraft_engine::smart_cmds::encode_source(&document).unwrap() }
        _ => unreachable!(),
    }
}

fn fixture(depth: u32, rich: bool) -> (Session, LayerId) {
    let mut engine = Session::new(); engine.execute("file.new",json!({"width":8,"height":6,"depth":depth})).unwrap();
    engine.edit("Resize fixture",|doc,active| {
        let mut raster = Layer::raster("Original",doc.pixel_format());
        for y in -1..4 { for x in -2..5 { raster.surface_mut().unwrap().write_pixel(x,y,&[(x+2) as f32/6.,(y+1) as f32/4.,0.75,if (x+y)%2==0 {1.} else {0.4}]); } }
        let mut mask = LayerMask::reveal_all(); mask.surface.fill_rect(Rect::new(0,1,3,3),&[0.25]); mask.linked=false; mask.density=0.75; mask.feather=0.5; raster.mask=Some(mask);
        let id = raster.id; let mut children = vec![Layer::raster("Nested",doc.pixel_format())];
        children[0].surface_mut().unwrap().fill_rect(Rect::new(2,2,4,3),&[0.2,0.4,0.8,1.]);
        if rich {
            let mut fill = Layer::new("Fill",LayerContent::Fill(Fill::Solid(Color::BLACK)));
            let mut pixels = Surface::new(doc.pixel_format()); pixels.fill_rect(Rect::new(1,1,3,3),&[0.6,0.3,0.1,1.]);
            fill.fill_cache=Some(FillCache {fill:Fill::Solid(Color::BLACK),surface:pixels.clone()});
            let shape = ShapeLayer {path:Path::new(vec![Subpath::polygon(&[(1.,1.),(4.,1.),(4.,3.),(1.,3.)])]),fill:Some(Fill::Solid(Color::WHITE)),stroke:None,live:None,cache:Some(pixels.clone()),psd_raw:Some(Arc::new(b"old shape".to_vec()))};
            let text = TextLayer {text:"Resize".into(),size_pt:4.,transform:Affine::translate(1.,4.),cache:Some(pixels),psd_raw:Some(Arc::new(b"old text".to_vec())),..Default::default()};
            children.extend([fill,Layer::new("Shape",LayerContent::Shape(shape)),Layer::new("Text",LayerContent::Text(text))]);
            raster.effects.items.push(Effect::Stroke(StrokeFx {common:FxCommon::new(BlendMode::Normal,1.),size:3.,position:StrokePosition::Outside,paint:FxPaint::Color(Color::WHITE)})); raster.effects.psd_raw=Some(Arc::new(b"old effects".to_vec())); raster.effects.reference=Some((2.,1.));
        }
        let mut group = Layer::group("Outer",vec![Layer::group("Inner",children)]);
        group.mask=Some(LayerMask::reveal_all());
        doc.layers=vec![raster,group]; *active=Some(id);
        let mut coverage=Surface::new(PixelFormat::GRAY8); coverage.fill_rect(Rect::new(1,1,4,3),&[0.5]);
        doc.selection=Some(coverage.clone()); doc.channels.push(AlphaChannel::new("Alpha",coverage.clone())); doc.quick_mask=Some(AlphaChannel::new("Quick Mask",coverage));
        doc.guides.horizontal=vec![2.]; doc.guides.vertical=vec![3.];
        doc.paths.push(NamedPath {name:"Saved path".into(),path:Path::new(vec![Subpath::polyline(&[(2.,1.),(4.,3.)])]),psd_raw:None});
        doc.work_path=Some(Path::new(vec![Subpath::polygon(&[(1.,1.),(2.,1.),(1.,2.)])]));
        doc.notes.push(Note {position:[2.,1.],popup:[2.,1.,4.,3.],..Default::default()});
        doc.measurement.ruler=Some(photocraft_engine::doc::Ruler {start:[2.,1.],end:[4.,3.],protractor:Some([5.,4.])});
        doc.slices.list=vec![Slice {id:1,rect:Rect::new(1,1,4,3),..Default::default()},Slice {id:2,origin:SliceOrigin::Layer,layer:Some(id),..Default::default()}];
        doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"retained resize metadata".to_vec())));
        Ok(())
    }).unwrap();
    let id=engine.active().unwrap().active_layer.unwrap();
    engine.execute("document.activate",json!({"document":engine.active_index().unwrap()})).unwrap();
    engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5]; engine.tools.background=[0.7,0.6,0.5,1.];
    let state=engine.active().unwrap(); engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource {doc:state.doc.id,revision:state.revision,layer:id,mask:false,label:"Earlier resize Fade".into()});
    (engine,id)
}
fn twin(engine: &Session) -> Session {
    let state=engine.active().unwrap(); let mut copy=Session::new(); copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None); *copy.active_mut().unwrap()=state.clone();
    copy.tools=engine.tools.clone(); copy.presets=engine.presets.clone(); copy.patterns=engine.patterns.clone(); copy.journal=engine.journal.clone(); copy.edit_state=engine.edit_state.clone(); copy.clipboard=engine.clipboard.clone(); copy.style_clipboard=engine.style_clipboard.clone();
    super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap(); copy
}
fn same(actual: &Session, expected: &Session) {
    let a=actual.active().unwrap(); let e=expected.active().unwrap();
    assert_eq!(a.doc,e.doc); assert_eq!(a.history.entries(),e.history.entries()); assert_eq!(a.history.past_len(),e.history.past_len());
    for index in 0..a.history.past_len() {assert_eq!(a.history.state(index),e.history.state(index));}
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(e.revision,e.saved_revision,&e.coalesce,e.active_layer,&e.selected_layers,e.layer_anchor,&e.path,&e.last_damage));
    assert_eq!(a.channel_view,e.channel_view); assert_eq!(a.isolated_layers,e.isolated_layers); assert_eq!(a.fx_collapsed,e.fx_collapsed); assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",e.symmetry_path));
    assert_eq!(actual.journal,expected.journal); assert_eq!(actual.edit_state.fade,expected.edit_state.fade); assert_eq!(actual.tools.foreground,expected.tools.foreground); assert_eq!(actual.tools.background,expected.tools.background); assert_eq!(actual.tools.brush,expected.tools.brush);
    assert_eq!(actual.style_clipboard,expected.style_clipboard); assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard)); assert_eq!(super::super::tools::presets(actual),super::super::tools::presets(expected));
    assert_eq!(super::super::color_views::key(actual).unwrap(),super::super::color_views::key(expected).unwrap());
}
fn unchanged(actual: &Session, expected: &Session) {same(actual,expected); assert!(Arc::ptr_eq(&actual.active().unwrap().doc,&expected.active().unwrap().doc));}
fn host(engine: &mut Session, params: Value) -> Result<Value,String> {super::super::execute_view_command(engine,COMMAND,params)}
fn object(doc: &Document, id: LayerId) -> &SmartObject {let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else {panic!("No Smart Object")}; object}
fn add_smart(engine: &mut Session, source: SmartSource) -> LayerId {
    engine.edit("Resize Smart Object",|doc,active| {
        let mut stale=Surface::new(doc.pixel_format()); stale.fill_rect(Rect::new(2,1,3,2),&[0.25,0.5,0.75,1.]);
        let mut smart=SmartObject::new(source,Affine::translate(2.,1.),Some(stale));
        smart.smart_filters=vec![SmartFilter {command:"filter.other.offset".into(),params:json!({"horizontal":1,"vertical":0,"undefinedAreas":"transparent"}),blend:BlendMode::Normal,opacity:1.,visible:true}];
        let mut filter_mask=LayerMask::reveal_all(); filter_mask.surface.fill_rect(Rect::new(2,1,3,2),&[0.4]); filter_mask.density=0.75; filter_mask.feather=0.5; smart.filter_mask=Some(filter_mask);
        smart.psd_raw=Some(Arc::new(b"retained resize placed data".to_vec()));
        let mut layer=Layer::new("Resize Smart",LayerContent::Smart(smart)); layer.psd_blocks.push((*b"zzzz",Arc::new(b"retained placed block".to_vec())));
        let id=doc.insert_above(*active,layer); *active=Some(id); Ok(id)
    }).unwrap()
}

#[test]
fn image_size_all_filters_anisotropic_nested_masks_fills_text_shapes_marks_and_effects_match_native() {
    for depth in [8,16,32] { for filter in ["nearest","nearestNeighbor","bilinear","bicubic","lanczos","preserveDetails","unknown-native-default"] { for (width,height) in [(12,3),(4,12)] {
        let (mut engine,_)=fixture(depth,true); let before=engine.active().unwrap().doc.clone(); let mut native=twin(&engine);
        let params=json!({"width":width,"height":height,"resample":filter,"resolution":110.5,"vendor":{"retain":[null,1]}});
        assert_eq!(host(&mut engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&engine,&native);
        let doc=&engine.active().unwrap().doc; assert_eq!(doc.size,Size::new(width,height)); assert_eq!(doc.resolution_dpi,110.5); assert_eq!(doc.notes[0].position,[2.*width as f64/8.,height as f64/6.]);
        assert_eq!(doc.guides.horizontal,vec![2.*height as f32/6.]); assert_eq!(doc.guides.vertical,vec![3.*width as f32/8.]); assert_eq!(doc.metadata,before.metadata);
        assert_eq!(doc.layers[0].mask.as_ref().unwrap().surface.default_pixel(),vec![1.]);
        let scale=((width as f64/8.+height as f64/6.)/2.) as f32;
        assert_eq!(doc.layers[0].effects.psd_raw,if scale==1. {before.layers[0].effects.psd_raw.clone()} else {None});
        let Effect::Stroke(stroke)=&doc.layers[0].effects.items[0] else{unreachable!()}; assert_eq!(stroke.size,3.*scale);
        for (_,_,layer) in doc.walk() {match &layer.content {LayerContent::Text(text)=>assert!(text.cache.is_some()&&text.psd_raw.is_some()),LayerContent::Shape(shape)=>assert!(shape.cache.is_some()),_=>{}}}
    } } }
}

#[test]
fn image_size_nearest_has_independent_pixels_coverage_and_original_undo_identity() {
    for depth in [8,16,32] {
        let (mut engine,id)=fixture(depth,false); let before=engine.active().unwrap().doc.clone(); let mut native=twin(&engine); let params=json!({"width":16,"height":12,"resample":"nearest"});
        host(&mut engine,params.clone()).unwrap(); native.execute(COMMAND,params).unwrap(); same(&engine,&native);
        let doc=&engine.active().unwrap().doc; let actual=doc.layer(id).unwrap().surface().unwrap(); let original=before.layer(id).unwrap().surface().unwrap();
        for y in -2i32..12 {for x in -4i32..16 {
            let expected=original.pixel(x.div_euclid(2),y.div_euclid(2)); let pixel=actual.pixel(x,y); assert_eq!(pixel[3],expected[3]);
            for channel in 0..3 {let tolerance=if depth==32 {1e-7} else {0.}; assert!((pixel[channel]-expected[channel]).abs()<=tolerance,"{depth}/{x},{y}/{channel}:{} != {}",pixel[channel],expected[channel]);}
        }}
        assert_eq!(doc.selection.as_ref().unwrap(),&doc.channels[0].surface); assert_eq!(doc.quick_mask.as_ref().unwrap().surface,doc.channels[0].surface);
        let after=doc.clone(); engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&engine,&native); assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));
        engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&engine,&native); assert_eq!(engine.active().unwrap().doc,after);
    }
}

#[test]
fn image_size_linked_and_embedded_four_formats_three_depths_keep_source_metadata_and_native_sharp_refresh() {
    for depth in [8,16,32] {for format in ["png","psd","psb","pcraft"] {for embedded in [false,true] {
        let dir=directory(); let path=dir.0.join(format!("source.{format}")); let bytes=encoded(format); std::fs::write(&path,&bytes).unwrap(); let (mut engine,_)=fixture(depth,false);
        let source=if embedded {SmartSource::Embedded {file_name:format!("source.{format}"),bytes:Arc::new(bytes.clone())}} else {SmartSource::Linked {path:path.to_string_lossy().into()}};
        let id=add_smart(&mut engine,source); let before=engine.active().unwrap().doc.clone(); let mut native=twin(&engine); let params=json!({"width":16,"height":12,"resample":"nearest"});
        assert_eq!(host(&mut engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&engine,&native);
        let after=object(&engine.active().unwrap().doc,id); assert_eq!(after.source,object(&before,id).source); assert_eq!(after.psd_raw,object(&before,id).psd_raw); assert_eq!(after.transform,Affine {m:[2.,0.,0.,2.,4.,2.]}); assert_ne!(after.cache,object(&before,id).cache);
        assert_eq!(std::fs::read(&path).unwrap(),bytes);
    }}}
}

#[test]
fn image_size_missing_and_corrupt_refresh_keep_native_resized_cached_pixels() {
    for status in ["missing","corrupt"] {
        let dir=directory(); let path=dir.0.join("source.png"); if status!="missing" {std::fs::write(&path,if status=="corrupt" {b"not an image".to_vec()} else {encoded("png")}).unwrap();}
        let (mut engine,_)=fixture(32,false); let id=add_smart(&mut engine,SmartSource::Linked {path:path.to_string_lossy().into()});
        let before=engine.active().unwrap().doc.clone(); let mut native=twin(&engine); let params=json!({"width":16,"height":12,"resample":"nearest"});
        assert_eq!(host(&mut engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&engine,&native);
        let expected=photocraft_algo::resample::resize_surface(object(&before,id).cache.as_ref().unwrap(),2.,2.,Resample::Nearest);
        assert_eq!(object(&engine.active().unwrap().doc,id).cache.as_ref().unwrap(),&expected);
    }
}

#[test]
fn image_size_each_occurrence_reads_once_retires_pin_and_uses_only_that_source_decision() {
    let dir=directory(); let path=dir.0.join("source.png"); let bytes=encoded("png"); std::fs::write(&path,&bytes).unwrap(); let (mut engine,_)=fixture(16,false);
    let id=add_smart(&mut engine,SmartSource::Linked {path:path.to_string_lossy().into()}); let other=add_smart(&mut engine,SmartSource::Linked {path:path.to_string_lossy().into()});
    let mut native=twin(&engine); let params=json!({"width":16,"height":12,"resample":"nearest"}); native.execute(COMMAND,params.clone()).unwrap();
    let mut reads=Vec::new(); let mut previous:Option<std::sync::Weak<Vec<u8>>>=None;
    run_with(&mut engine,&params,16,12,2.,2.,Resample::Nearest,|doc,ids| {assert_eq!(ids,&[id,other]); super::super::linked_replay::refresh_ids_with(doc,ids,|actual,meta,smart| {
        if let Some(pin)=previous.take() {assert!(pin.upgrade().is_none(),"previous encoded pin must retire before next read"); std::fs::write(&path,&bytes).unwrap();}
        reads.push(actual); let result=super::super::smart::source_bytes_checked(meta,&smart.source,||Ok(()))?; previous=result.as_ref().map(|(_,bytes)|Arc::downgrade(bytes)); std::fs::remove_file(&path).unwrap(); Ok(result)
    }) }).unwrap();
    assert_eq!(reads,vec![id,other]); assert!(previous.unwrap().upgrade().is_none()); assert!(!path.exists()); same(&engine,&native);
}

#[test]
fn image_size_preparation_source_failure_and_panic_are_atomic_without_preset_flush() {
    use photocraft_engine::preset_store::{open,MemBackend};
    for failure in ["source","panic","area"] {
        let (mut engine,_)=fixture(16,false); let backend=MemBackend::default(); engine.attach_preset_store(open(Box::new(backend.clone())));
        let mut preset=engine.tools.presets[0].clone(); preset.name="Pending resize".into(); preset.builtin=false; engine.tools.presets.push(preset); engine.brush_presets_changed();
        let files=backend.files.lock().unwrap().clone(); let before=twin(&engine); let calls=Cell::new(0);
        let params=json!({"width":16,"height":12}); let result=run_with(&mut engine,&params,if failure=="area" {20000} else {16},if failure=="area" {20000} else {12},2.,2.,Resample::Bicubic,|_,_| {calls.set(calls.get()+1); if failure=="panic" {panic!("injected resize panic")}; Err("checked source refused".into())});
        let error=result.unwrap_err(); assert_eq!(calls.get(),if failure=="area" {0} else {1}); if failure=="panic" {assert!(error.contains("internal error"));} else if failure=="source" {assert_eq!(error,"checked source refused");}
        unchanged(&engine,&before); assert_eq!(*backend.files.lock().unwrap(),files);
    }
}

#[test]
fn image_size_real_late_source_cap_and_unsupported_stack_refuse_atomically_but_missing_unsafe_source_falls_back() {
    for failure in ["lateCap","unsupported","missingUnsafe","corruptUnsafe"] {
        let dir=directory(); let first=dir.0.join("first.png"); let late=dir.0.join("late.png"); std::fs::write(&first,encoded("png")).unwrap();
        if failure=="lateCap" {std::fs::File::create(&late).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();}
        else if failure=="corruptUnsafe" {std::fs::write(&late,b"not an image").unwrap();}
        else if failure=="unsupported" {std::fs::write(&late,encoded("png")).unwrap();}
        let (mut engine,_)=fixture(16,false); let first_id=add_smart(&mut engine,SmartSource::Linked {path:first.to_string_lossy().into()}); let late_id=add_smart(&mut engine,SmartSource::Linked {path:late.to_string_lossy().into()});
        if failure!="lateCap" {engine.edit("Unsupported late stack",|doc,_| {let LayerContent::Smart(object)=&mut doc.layer_mut(late_id).unwrap().content else{unreachable!()}; object.smart_filters.push(SmartFilter {command:"plugin.run".into(),params:json!({"mustNotRun":true}),blend:BlendMode::Normal,opacity:1.,visible:true}); Ok(())}).unwrap();}
        let before=twin(&engine); let params=json!({"width":16,"height":12,"resample":"nearest"});
        if matches!(failure,"lateCap"|"unsupported") {
            let mut visits=Vec::new(); let error=run_with(&mut engine,&params,16,12,2.,2.,Resample::Nearest,|doc,ids| super::super::linked_replay::refresh_ids_with(doc,ids,|id,metadata,object| {visits.push(id); super::super::smart::source_bytes_checked(metadata,&object.source,||Ok(()))})).unwrap_err();
            assert_eq!(visits,vec![first_id,late_id]); assert!(error.contains(if failure=="lateCap" {"512MB"} else {"does not support"})); unchanged(&engine,&before);
        } else {
            let mut native=twin(&engine); host(&mut engine,params.clone()).unwrap(); native.execute(COMMAND,params).unwrap(); same(&engine,&native);
            let expected=photocraft_algo::resample::resize_surface(object(&before.active().unwrap().doc,late_id).cache.as_ref().unwrap(),2.,2.,Resample::Nearest);
            assert_eq!(object(&engine.active().unwrap().doc,late_id).cache.as_ref().unwrap(),&expected);
        }
    }
}

#[test]
fn image_size_defaults_none_identity_and_mixed_coalescing_keep_native_history_fade_and_presets() {
    use photocraft_engine::preset_store::{open,MemBackend};
    let (mut engine,_)=fixture(16,false); let backend=MemBackend::default(); engine.attach_preset_store(open(Box::new(backend.clone()))); let mut preset=engine.tools.presets[0].clone(); preset.name="Resize preset".into(); preset.builtin=false; engine.tools.presets.push(preset); engine.brush_presets_changed(); let mut native=twin(&engine);
    let requests=[json!({"width":12,"height":9,"coalesce":"resize-drag"}),json!({"width":4,"height":3,"resample":"nearest","coalesce":"resize-drag"}),json!({"width":4,"resolution":200,"coalesce":"resize-drag"}),json!({"width":1e308,"height":1e308,"resample":"none","resolution":300.5}),json!({"width":"invalid","height":null}),Value::Null];
    for params in requests {assert_eq!(host(&mut engine,params.clone()).unwrap(),native.execute(COMMAND,params).unwrap()); same(&engine,&native);}
    assert!(open(Box::new(backend)).presets.iter().any(|preset|preset.name=="Resize preset"));
}

#[test]
fn image_size_extreme_sparse_downscale_uses_streamed_halo_without_unsafe_native_reference() {
    let mut engine=Session::new(); engine.execute("file.new",json!({"width":1,"height":1,"depth":32})).unwrap();
    engine.edit("Sparse oversized canvas",|doc,active| {doc.size=Size::new(20000,20000); let mut layer=Layer::raster("Sparse",doc.pixel_format()); layer.surface_mut().unwrap().write_pixel(9999,9999,&[1.,0.,0.,1.]); *active=Some(layer.id); doc.layers=vec![layer]; Ok(())}).unwrap();
    let id=engine.active().unwrap().active_layer.unwrap(); let before=engine.active().unwrap().doc.clone();
    let value=host(&mut engine,json!({"width":1,"height":1})).unwrap(); assert_eq!(value,json!({"width":1,"height":1}));
    let pixel=engine.active().unwrap().doc.layer(id).unwrap().surface().unwrap().pixel(0,0);
    assert_eq!(&pixel[..3],&[0.,0.,0.]); assert!(pixel[3]>2.499e-9&&pixel[3]<2.501e-9,"independent central sample alpha {:?}",pixel);
    let after=engine.active().unwrap().doc.clone(); engine.execute("edit.undo",json!({})).unwrap(); assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before)); engine.execute("edit.redo",json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc,after);
}

#[test]
fn image_size_pcraft_roundtrip_reopens_exact_completed_document_and_leaves_original_bytes() {
    let dir=directory(); let (mut engine,_)=fixture(16,true); let original=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap(); let path=dir.0.join("original.pcraft"); std::fs::write(&path,&original).unwrap();
    host(&mut engine,json!({"width":12,"height":9,"resample":"lanczos"})).unwrap(); let doc=&engine.active().unwrap().doc;
    let output=photocraft_format::save_to_bytes(doc,&Default::default()).unwrap(); let reopened=photocraft_format::load_from_bytes(&output).unwrap(); assert_eq!(reopened,**doc); assert_eq!(std::fs::read(&path).unwrap(),original);
}

#[test]
fn image_size_actual_host_immutable_versions_restore_redo_and_view_with_no_source_overwrite() {
    let dir=directory(); let (mut engine,_)=fixture(16,true); let before=engine.active().unwrap().doc.clone(); let labels=engine.active().unwrap().history.entries();
    host(&mut engine,json!({"width":12,"height":9,"resample":"lanczos"})).unwrap(); let after=engine.active().unwrap().doc.clone();
    let mut session=super::super::PhotoSession {engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()}; let photo=ulid::Ulid::new().to_string();
    super::super::publish(&dir.0,&photo,&mut session).unwrap(); let saved=dir.0.join(format!("{}.pcraft",session.version)); let bytes=super::super::bundle::portable_bytes(&saved,super::super::MAX_INPUT_BYTES as usize).unwrap();
    session.engine.execute("edit.undo",json!({})).unwrap(); super::super::publish(&dir.0,&photo,&mut session).unwrap(); super::super::save_view(&dir.0,&session).unwrap();
    let mut reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap(); let state=reopened.engine.active().unwrap(); assert_eq!(state.doc,before); assert_eq!(state.history.entries(),labels); assert!(state.history.can_redo()); assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Alpha(0));
    reopened.engine.execute("edit.redo",json!({})).unwrap(); assert_eq!(reopened.engine.active().unwrap().doc,after); assert_eq!(bytes,super::super::bundle::portable_bytes(&saved,super::super::MAX_INPUT_BYTES as usize).unwrap());
}
