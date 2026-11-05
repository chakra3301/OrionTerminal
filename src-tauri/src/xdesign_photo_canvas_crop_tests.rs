use super::*;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Color, Fill, FillCache, LayerMask, PixelFormat, Slice, SliceOrigin, SmartFilter, SmartObject, SmartSource, TextLayer, VectorMask};

pub(super) struct Fixture {
    pub(super) engine: Session,
    pub(super) raster: LayerId,
    pub(super) smart: LayerId,
    pub(super) embedded: LayerId,
    pub(super) group: LayerId,
    pub(super) text: LayerId,
    pub(super) shape: LayerId,
    pub(super) fill: LayerId,
}

pub(super) fn normalize(engine: &mut Session) {
    let index = engine.active_index().unwrap();
    engine.execute("document.activate", json!({"document":index})).unwrap();
}

fn color_surface(format: PixelFormat, x: i32, y: i32) -> Surface {
    let default = photocraft_raster::from_rgba(&format, [0.1, 0.2, 0.3, 0.]);
    let mut surface = Surface::with_default(format, &default);
    surface.write_pixel(x, y, &photocraft_raster::from_rgba(&format, [0.7, 0.2, 0.4, 1.]));
    surface.write_pixel(x + 2, y + 1, &photocraft_raster::from_rgba(&format, [0.9, 0.8, 0.1, 0.]));
    surface
}

pub(super) fn fixture(depth: u32, mode: &str) -> Fixture {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":16,"height":12,"depth":depth,"mode":mode,"background":"transparent"})).unwrap();
    let shape_id = LayerId(engine.execute("shape.create", json!({"name":"Sharp shape","rect":[13,9,5,4],"fill":[0.8,0.3,0.5,1.]})).unwrap()["layer"].as_u64().unwrap());
    let shape_layer = engine.active().unwrap().doc.layer(shape_id).unwrap().clone();
    let LayerContent::Shape(shape) = &shape_layer.content else { unreachable!() };
    let vector_path = shape.path.clone();
    let format = engine.active().unwrap().doc.pixel_format();
    let raster = Layer::new("Pixels", LayerContent::Raster(color_surface(format, 2, 3)));
    let raster_id = raster.id;
    let mut text = Layer::new("Cached text", LayerContent::Text(TextLayer { text:"".into(), transform:Affine::translate(3.,4.), cache:Some(color_surface(format,3,4)), ..Default::default() }));
    text.locks.all = true;
    let text_id = text.id;
    let fill_value = Fill::Solid(Color::BLACK);
    let mut fill = Layer::new("External fill", LayerContent::Fill(fill_value.clone()));
    fill.fill_cache = Some(FillCache { fill:fill_value, surface:color_surface(format,4,2) });
    let fill_id = fill.id;
    let mut linked = SmartObject::new(SmartSource::Linked { path:"/missing/canvas-crop-must-not-read.psb".into() }, Affine::translate(2.,1.), Some(color_surface(format,2,1)));
    linked.smart_filters.push(SmartFilter { command:"plugin.run".into(), params:json!({"mustNotRun":true}), blend:BlendMode::Normal, opacity:1., visible:true });
    linked.psd_raw = Some(Arc::new(b"unchanged raw placed data".to_vec()));
    let mut filter_mask = LayerMask::reveal_all();
    filter_mask.surface.write_pixel(6,4,&[0.4]);
    filter_mask.enabled = false;
    filter_mask.linked = false;
    linked.filter_mask = Some(filter_mask);
    let mut linked = Layer::new("Missing source", LayerContent::Smart(linked));
    let smart_id = linked.id;
    for key in [*b"SoLd", *b"SoLE", *b"PlLd", *b"zzzz"] { linked.psd_blocks.push((key,Arc::new(key.to_vec()))); }
    let embedded = Layer::new("Corrupt embedded", LayerContent::Smart(SmartObject::new(SmartSource::Embedded { file_name:"bad.png".into(), bytes:Arc::new(b"must not decode".to_vec()) },Affine::translate(7.,5.),Some(color_surface(format,7,5)))));
    let embedded_id = embedded.id;
    let group = Layer::group("Nested",vec![text,Layer::group("Inner",vec![linked,embedded,fill,shape_layer])]);
    let group_id = group.id;
    engine.edit("Canvas fixture", |doc, active| {
        doc.layers = vec![raster,group];
        *active = Some(smart_id);
        fn masks(layers:&mut[Layer],path:&photocraft_engine::doc::Path) { for (index,layer) in layers.iter_mut().enumerate() {
            let mut mask=LayerMask::reveal_all();
            mask.surface.write_pixel(1+index as i32,2,&[0.3]);
            mask.enabled=index%2==0; mask.linked=index%2!=0; mask.density=0.6; mask.feather=1.25;
            layer.mask=Some(mask);
            let mut vector=VectorMask::new(path.clone());vector.enabled=index%2!=0;vector.linked=index%2==0;vector.feather=0.75;layer.vector_mask=Some(vector);
            layer.effects.reference=Some((2.5,3.75));
            if let Some(children)=layer.children_mut(){masks(children,path);}
        }}
        masks(&mut doc.layers,&vector_path);
        doc.work_path=Some(vector_path.clone());
        let mut selection=Surface::new(PixelFormat::GRAY8);
        selection.fill_rect(Rect::new(2,2,7,6),&[0.5]);
        doc.selection=Some(selection.clone());
        let mut alpha=Surface::with_default(PixelFormat::GRAY8,&[0.4]);
        alpha.write_pixel(-2,3,&[0.9]);
        alpha.write_pixel(20,4,&[0.1]);
        doc.channels=vec![AlphaChannel::new("Alpha",alpha)];
        doc.quick_mask=Some(AlphaChannel::new("Quick Mask",selection));
        doc.guides.horizontal=vec![3.]; doc.guides.vertical=vec![5.];
        doc.slices.list=vec![Slice{id:1,origin:SliceOrigin::Layer,layer:Some(raster_id),rect:Rect::new(2,3,5,5),..Default::default()}];
        doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"retained global".to_vec())));
        Ok(())
    }).unwrap();
    normalize(&mut engine);
    let state=engine.active_mut().unwrap();
    state.selected_layers=vec![smart_id,raster_id]; state.layer_anchor=Some(raster_id);
    state.channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground=[0.2,0.3,0.4,0.5]; engine.tools.background=[0.7,0.6,0.5,0.4];
    let state=engine.active().unwrap();
    engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource { doc:state.doc.id,revision:state.revision,layer:smart_id,mask:false,label:"Older Fade".into() });
    Fixture { engine,raster:raster_id,smart:smart_id,embedded:embedded_id,group:group_id,text:text_id,shape:shape_id,fill:fill_id }
}

pub(super) fn smart(doc:&Document,id:LayerId)->&SmartObject {
    let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else {panic!("Expected Smart Object")}; object
}

pub(super) fn twin(engine:&Session)->Session {
    let state=engine.active().unwrap(); let mut copy=Session::new();
    copy.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None);
    *copy.active_mut().unwrap()=state.clone(); copy.journal=engine.journal.clone(); copy.tools=engine.tools.clone();
    copy.presets=engine.presets.clone(); copy.patterns=engine.patterns.clone(); copy.edit_state=engine.edit_state.clone();
    copy.clipboard=engine.clipboard.clone(); copy.style_clipboard=engine.style_clipboard.clone();
    super::super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap(); copy
}

// Native dense translation allocates default-only gap tiles. Remove only those representational tiles.
pub(super) fn canonical(doc:&Document)->Document {
    let mut doc=doc.clone();
    fn layers(nodes:&mut[Layer]) {for layer in nodes {
        if let Some(mask)=&mut layer.mask{mask.surface.prune();}
        if let Some(cache)=&mut layer.fill_cache{cache.surface.prune();}
        match &mut layer.content {
            LayerContent::Raster(surface)=>surface.prune(),
            LayerContent::Text(text)=>{if let Some(cache)=&mut text.cache{cache.prune();}},
            LayerContent::Shape(shape)=>{if let Some(cache)=&mut shape.cache{cache.prune();}},
            LayerContent::Smart(smart)=>{if let Some(cache)=&mut smart.cache{cache.prune();}if let Some(mask)=&mut smart.filter_mask{mask.surface.prune();}},
            _=>{},
        }
        if let Some(children)=layer.children_mut(){layers(children);}
    }}
    layers(&mut doc.layers);
    for channel in doc.channels.iter_mut().chain(doc.quick_mask.as_mut()){channel.surface.prune();}
    if let Some(selection)=&mut doc.selection{selection.prune();}
    doc
}

pub(super) fn same(actual:&Session,native:&Session) {
    let a=actual.active().unwrap();let n=native.active().unwrap();
    assert_eq!(canonical(&a.doc),canonical(&n.doc));
    assert_eq!(a.history.entries(),n.history.entries()); assert_eq!(a.history.past_len(),n.history.past_len());
    for index in 0..a.history.past_len(){assert_eq!(canonical(&a.history.state(index).unwrap()),canonical(&n.history.state(index).unwrap()));}
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),n.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.history.max_states,a.history.max_bytes),(n.history.max_states,n.history.max_bytes));
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(n.revision,n.saved_revision,&n.coalesce,n.active_layer,&n.selected_layers,n.layer_anchor,&n.path,&n.last_damage));
    assert_eq!(a.channel_view,n.channel_view); assert_eq!(a.isolated_layers,n.isolated_layers); assert_eq!(a.fx_collapsed,n.fx_collapsed);
    assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",n.symmetry_path));
    assert_eq!(actual.journal,native.journal); assert_eq!(actual.edit_state.fade,native.edit_state.fade);
    assert_eq!(actual.tools.foreground,native.tools.foreground); assert_eq!(actual.tools.background,native.tools.background); assert_eq!(actual.tools.brush,native.tools.brush);
    assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",native.clipboard)); assert_eq!(actual.style_clipboard,native.style_clipboard);
    assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(native));
    assert_eq!(super::super::super::color_views::key(actual).unwrap(),super::super::super::color_views::key(native).unwrap());
}

pub(super) fn unchanged(engine:&Session,before:&Session) { same(engine,before);assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc)); }
pub(super) fn host(engine:&mut Session,command:&str,params:Value)->Result<Value,String> { super::super::super::execute_view_command(engine,command,params) }

fn run_native(f:&mut Fixture,command:&str,params:Value) {
    let before=f.engine.active().unwrap().doc.clone(); let past=f.engine.active().unwrap().history.past_len();
    let mut native=twin(&f.engine); let expected=native.execute(command,params.clone()).unwrap();
    assert_eq!(run_with(&mut f.engine,command,&params).unwrap(),expected); same(&f.engine,&native);
    for id in [f.smart,f.embedded] {
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).source,smart(&before,id).source);
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).filter_mask,smart(&before,id).filter_mask);
        assert_eq!(smart(&f.engine.active().unwrap().doc,id).psd_raw,smart(&before,id).psd_raw);
        assert_eq!(f.engine.active().unwrap().doc.layer(id).unwrap().psd_blocks,before.layer(id).unwrap().psd_blocks);
    }
    for id in [f.group,f.text,f.fill] {let layer=f.engine.active().unwrap().doc.layer(id).unwrap();let old=before.layer(id).unwrap();assert_eq!(layer.name,old.name);assert_eq!(layer.locks,old.locks);}
    assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);
    let after=f.engine.active().unwrap().doc.clone();
    f.engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&f.engine,&native);
    assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
    f.engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&f.engine,&native);
    assert_eq!(f.engine.active().unwrap().doc,after);
}

#[test]
fn canvas_crop_canvas_native_modes_depths_anchors_relative_rounding_and_zero_offset() {
    for depth in [8,16,32] { for mode in ["rgb","gray","cmyk"] { for params in [
        Value::Null,json!({}),json!({"width":21,"height":17,"anchor":"topLeft"}),json!({"width":21,"height":17,"anchor":"bottomRight"}),
        json!({"relative":true,"width":-2.5,"height":3.5,"anchor":"center"}),json!({"relative":true,"width":-200,"height":-100,"anchor":"right"}),
        json!({"width":20.5,"height":15.5,"anchor":"TopLeft"}),
    ] {run_native(&mut fixture(depth,mode),CANVAS,params);} }}
}

#[test]
fn canvas_crop_crop_native_modes_depths_delete_and_selection_fallback() {
    for depth in [8,16,32] {for mode in ["rgb","gray","cmyk"] {for params in [
        Value::Null,json!({}),json!({"x":1.5,"y":-1.5,"width":8.4,"height":7.6}),
        json!({"x":-2,"y":-3,"width":22,"height":19,"deleteCroppedPixels":false}),
        json!({"x":2,"y":2,"width":5,"height":4,"deleteCroppedPixels":false}),
        json!({"x":0,"y":0,"width":0,"height":-3}),
    ] {run_native(&mut fixture(depth,mode),CROP,params);} }}
}

#[test]
fn canvas_crop_background_native_extension_restores_default_holes_owner_colors_and_offcanvas_pixels() {
    for depth in [8,16,32] {for mode in ["rgb","gray","cmyk"] {for extension in ["background","foreground","white","black","transparent","##12abz9","unknown"] {
        let mut f=fixture(depth,mode);let id=f.raster;
        f.engine.edit("Locked Background",|doc,_|{let layer=doc.layer_mut(id).unwrap();layer.name="Background".into();layer.locks.transparency=true;let pixel=photocraft_raster::from_rgba(&layer.surface().unwrap().format(),[0.1,0.5,0.8,1.]);layer.surface_mut().unwrap().write_pixel(-5,1,&pixel);Ok(())}).unwrap();
        normalize(&mut f.engine);
        run_native(&mut f,CANVAS,json!({"width":22,"height":18,"anchor":"center","extensionColor":extension}));
        let surface=f.engine.active().unwrap().doc.layer(id).unwrap().surface().unwrap();
        let expected=photocraft_raster::from_rgba(&surface.format(),[0.1,0.5,0.8,1.]);let mut encoded=Surface::new(surface.format());encoded.write_pixel(0,0,&expected);
        assert_eq!(surface.pixel(-2,4),encoded.pixel(0,0));
        assert_eq!(surface.pixel(4,5),surface.default_pixel());
    }}}
}

#[test]
fn canvas_crop_shape_only_refresh_keeps_text_smart_cache_and_filter_mask_semantics() {
    for command in [CANVAS,CROP] {let mut f=fixture(32,"rgb");let before=f.engine.active().unwrap().doc.clone();
        let params=if command==CANVAS{json!({"width":22,"height":18,"anchor":"topLeft"})}else{json!({"x":-1,"y":-2,"width":18,"height":16})};
        let geometry=geometry(&f.engine,command,&params).unwrap();run_native(&mut f,command,params);
        let doc=&f.engine.active().unwrap().doc;
        let LayerContent::Shape(after)=&doc.layer(f.shape).unwrap().content else{unreachable!()};
        let LayerContent::Shape(old)=&before.layer(f.shape).unwrap().content else{unreachable!()};
        assert_ne!(after.cache,old.cache);
        for id in [f.smart,f.embedded] {let source=smart(&before,id).cache.as_ref().unwrap();let result=smart(doc,id).cache.as_ref().unwrap();assert_eq!(result.pixel(2+geometry.dx,1+geometry.dy),source.pixel(2,1));assert_eq!(smart(doc,id).filter_mask,smart(&before,id).filter_mask);}
        assert_eq!(doc.metadata,before.metadata);
    }
}

#[test]
fn canvas_crop_native_gray_mask_channel_view_and_content_only_delete_rules() {
    for target in [photocraft_engine::channel_cmds::ChannelTarget::Composite,photocraft_engine::channel_cmds::ChannelTarget::Alpha(0),photocraft_engine::channel_cmds::ChannelTarget::Color(0)] {
        let mut f=fixture(16,"rgb");f.engine.active_mut().unwrap().channel_view.target=target;normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone();run_native(&mut f,CROP,json!({"x":2,"y":2,"width":5,"height":4,"deleteCroppedPixels":true}));
        let doc=&f.engine.active().unwrap().doc;assert!(doc.selection.is_none());
        assert_eq!(doc.channels[0].surface.pixel(-4,1),before.channels[0].surface.pixel(-2,3));
        assert_eq!(doc.channels[0].surface.pixel(18,2),before.channels[0].surface.pixel(20,4));
        assert_eq!(doc.layer(f.raster).unwrap().mask.as_ref().unwrap().surface.pixel(-1,0),before.layer(f.raster).unwrap().mask.as_ref().unwrap().surface.pixel(1,2));
        assert_eq!(smart(doc,f.smart).filter_mask,smart(&before,f.smart).filter_mask);
    }
}

#[test]
fn canvas_crop_far_sparse_surfaces_use_literal_coordinates_raw_bits_and_aligned_arc_retention() {
    for command in [CANVAS,CROP] {for depth in [8,16,32] {let mut f=fixture(depth,"rgb");let id=f.raster;
        f.engine.edit("Far sparse pixels",|doc,_|{let format=doc.pixel_format();let mut surface=Surface::new(format);surface.write_pixel(-750_003,750_007,&[0.8,0.2,0.6,0.]);surface.write_pixel(750_011,-750_013,&[0.1,0.7,0.4,1.]);*doc.layer_mut(id).unwrap().surface_mut().unwrap()=surface;Ok(())}).unwrap();normalize(&mut f.engine);
        let original=f.engine.active().unwrap().doc.clone();let source=original.layer(id).unwrap().surface().unwrap();
        let params=if command==CANVAS{json!({"width":528,"height":524,"anchor":"center","extensionColor":"transparent"})}else{json!({"x":-256,"y":-256,"width":16,"height":12,"deleteCroppedPixels":false})};
        let value=run_with(&mut f.engine,command,&params).unwrap();if command==CANVAS{assert_eq!(value["offset"],json!([256,256]));}
        let doc=&f.engine.active().unwrap().doc;let result=doc.layer(id).unwrap().surface().unwrap();
        assert_eq!(result.tile_count(),2);assert_eq!(result.pixel(-749_747,750_263),source.pixel(-750_003,750_007));assert_eq!(result.pixel(750_267,-749_757),source.pixel(750_011,-750_013));
        for (coord,tile) in source.tiles(){let shifted=result.tiles().find(|(out,_)|out.tx==coord.tx+1&&out.ty==coord.ty+1).unwrap().1;assert!(Arc::ptr_eq(tile,shifted));}
        assert_eq!(smart(doc,f.smart).source,smart(&original,f.smart).source);assert_eq!(smart(doc,f.smart).filter_mask,smart(&original,f.smart).filter_mask);
        f.engine.execute("edit.undo",json!({})).unwrap();assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&original));
    }}
}

#[test]
fn canvas_crop_far_sparse_delete_crops_only_content_and_never_reads_distant_default_gaps() {
    let mut f=fixture(32,"rgb");let id=f.raster;
    f.engine.edit("Far crop fixture",|doc,_|{let surface=doc.layer_mut(id).unwrap().surface_mut().unwrap();surface.write_pixel(750_000,750_000,&[0.9,0.1,0.2,1.]);let mut selection=Surface::new(PixelFormat::GRAY8);selection.write_pixel(750_000,750_000,&[1.]);doc.selection=Some(selection);Ok(())}).unwrap();normalize(&mut f.engine);
    let before=f.engine.active().unwrap().doc.clone();let source=before.layer(id).unwrap().surface().unwrap().pixel(750_000,750_000);
    assert_eq!(run_with(&mut f.engine,CROP,&json!({"x":749_999,"y":749_999,"width":3,"height":3})).unwrap(),json!({"x":749_999,"y":749_999,"width":3,"height":3}));
    let doc=&f.engine.active().unwrap().doc;let surface=doc.layer(id).unwrap().surface().unwrap();assert_eq!(surface.pixel(1,1),source);assert_eq!(surface.tile_count(),1);assert!(doc.selection.is_none());
    assert_eq!(doc.channels[0].surface.pixel(-750_001,-749_996),before.channels[0].surface.pixel(-2,3));
    assert_eq!(smart(doc,f.smart).filter_mask,smart(&before,f.smart).filter_mask);
}

#[test]
fn canvas_crop_parameter_job_and_arithmetic_refusals_preserve_owner_state() {
    for command in [CANVAS,CROP] {for params in [json!([]),json!("wrong")] {let mut f=fixture(16,"rgb");let before=twin(&f.engine);let mut native=twin(&f.engine);assert_eq!(run_with(&mut f.engine,command,&params).unwrap_err(),native.execute(command,params).unwrap_err().to_string());unchanged(&f.engine,&before);}}
    for params in [json!({"width":20_000,"height":20_000}),json!({"x":i64::MAX,"y":0,"width":2,"height":1}),json!({"x":i32::MIN,"y":0,"width":2,"height":1})] {
        let command=if params.get("x").is_some(){CROP}else{CANVAS};let mut f=fixture(16,"rgb");let before=twin(&f.engine);let error=run_with(&mut f.engine,command,&params).unwrap_err();assert!(error.contains("limit")||error.contains("coordinates"));unchanged(&f.engine,&before);
    }
    let mut f=fixture(16,"rgb");Arc::make_mut(&mut f.engine.active_mut().unwrap().doc).selection=None;let before=twin(&f.engine);let mut native=twin(&f.engine);
    assert_eq!(run_with(&mut f.engine,CROP,&json!({})).unwrap_err(),native.execute(CROP,json!({})).unwrap_err().to_string());unchanged(&f.engine,&before);
    for command in [CANVAS,CROP] {let mut empty=Session::new();let mut native=Session::new();assert_eq!(run_with(&mut empty,command,&Value::Null).unwrap_err(),native.execute(command,Value::Null).unwrap_err().to_string());assert!(empty.journal.is_empty());}
    use std::sync::atomic::{AtomicBool,Ordering};
    let mut f=fixture(16,"rgb");let release=Arc::new(AtomicBool::new(false));let worker=release.clone();
    struct Release(Arc<AtomicBool>);impl Drop for Release{fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}let _release=Release(release.clone());
    let started=f.engine.start_job("canvas-job",json!({}),"Retained canvas job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();
    let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected job")};let before=twin(&f.engine);
    for command in [CANVAS,CROP] {let params=json!({"width":20_000,"height":20_000});let expected=f.engine.execute(command,params.clone()).unwrap_err().to_string();assert_eq!(run_with(&mut f.engine,command,&params).unwrap_err(),expected);unchanged(&f.engine,&before);}
    release.store(true,Ordering::Relaxed);f.engine.wait_job(job).unwrap();
}

#[test]
fn canvas_crop_coalescing_first_label_fade_and_byte_budget_follow_actual_fresh_pixels() {
    for command in [CANVAS,CROP] {let mut f=fixture(8,"rgb");let before=f.engine.active().unwrap().doc.clone();let mut native=twin(&f.engine);
        for engine in [&mut f.engine,&mut native] {engine.active_mut().unwrap().history.max_states=3;engine.active_mut().unwrap().history.max_bytes=256*256*4*64;}
        for step in 0..3 {let params=if command==CANVAS{json!({"width":18+step,"height":14+step,"coalesce":"same draft"})}else{json!({"x":0,"y":0,"width":15-step,"height":11-step,"coalesce":"same draft"})};assert_eq!(run_with(&mut f.engine,command,&params).unwrap(),native.execute(command,params).unwrap());same(&f.engine,&native);}
        assert_eq!(f.engine.active().unwrap().history.undo_label(),Some(if command==CANVAS{"Canvas Size"}else{"Crop"}));
        f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native);assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
    }
}
