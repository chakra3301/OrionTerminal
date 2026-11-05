use super::bounds;
use super::super::{run_with, tests::{fixture, normalize, same, smart, twin, unchanged}};
use photocraft_engine::{doc::{BlendMode, Color, Fill, GradientStyle, Layer, LayerContent, LayerId, PixelFormat, Rect, VectorMask}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::sync::Arc;

const TRIM:&str="image.trim";

fn pixels(width:u32,height:u32,default:[f32;4],marks:&[(i32,i32,[f32;4])])->Session {
    let mut engine=Session::new();
    engine.execute("file.new",json!({"width":width,"height":height,"depth":32,"background":"transparent"})).unwrap();
    let mut surface=Surface::with_default(PixelFormat::RGBA32F,&default);
    for &(x,y,pixel) in marks {surface.write_pixel(x,y,&pixel);}
    let layer=Layer::new("Trim literals",LayerContent::Raster(surface));let id=layer.id;
    engine.edit("Literal Trim fixture",|doc,active|{doc.layers=vec![layer];*active=Some(id);Ok(())}).unwrap();
    normalize(&mut engine);engine
}

fn native(engine:&mut Session,params:Value) {
    let before=engine.active().unwrap().doc.clone();let revision=engine.active().unwrap().revision;
    let past=engine.active().unwrap().history.past_len();let journal=engine.journal.len();let mut expected=twin(engine);
    let result=expected.execute(TRIM,params.clone());
    match result {
        Ok(value)=>{
            assert_eq!(run_with(engine,TRIM,&params).unwrap(),value);same(engine,&expected);
            assert_eq!(engine.active().unwrap().revision,revision+1);assert_eq!(engine.active().unwrap().history.past_len(),past+1);
            assert_eq!(engine.active().unwrap().history.undo_label(),Some("Trim"));
            assert_eq!(engine.journal.len(),journal+1);assert_eq!(engine.journal.last(),Some(&(TRIM.into(),params)));
            let after=engine.active().unwrap().doc.clone();
            engine.execute("edit.undo",json!({})).unwrap();expected.execute("edit.undo",json!({})).unwrap();same(engine,&expected);
            assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));
            engine.execute("edit.redo",json!({})).unwrap();expected.execute("edit.redo",json!({})).unwrap();same(engine,&expected);
            assert_eq!(engine.active().unwrap().doc,after);
        }
        Err(error)=>{let saved=twin(engine);assert_eq!(run_with(engine,TRIM,&params).unwrap_err(),error.to_string());unchanged(engine,&saved);}
    }
}

#[test]
fn trim_native_modes_depths_reference_corners_and_side_flags_preserve_complete_state() {
    for depth in [8,16,32] {for mode in ["rgb","gray","cmyk"] {for based in ["transparent","topLeft","bottomRight","unknown"] {
        let mut f=fixture(depth,mode);
        native(&mut f.engine,json!({"basedOn":based,"left":true,"right":false,"top":false,"bottom":true,"vendor":{"keep":"original journal"}}));
    }}}
    for flags in 0..16 {let mut engine=pixels(9,7,[0.;4],&[(2,1,[1.,0.,0.,1.]),(6,4,[0.,1.,0.,0.2])]);
        let params=json!({"left":flags&1!=0,"top":flags&2!=0,"right":flags&4!=0,"bottom":flags&8!=0});
        let expected=Rect::new(if flags&1!=0{2}else{0},if flags&2!=0{1}else{0},if flags&4!=0{7}else{9},if flags&8!=0{5}else{7});
        assert_eq!(bounds(&engine,&params).unwrap(),expected);native(&mut engine,params);
    }
}

#[test]
fn trim_literal_premultiplied_color_and_alpha_squared_thresholds_are_strict() {
    // Alpha delta .0015 is below .5/255, but .9015²-.9² is above it.
    let mut alpha=pixels(6,5,[0.,0.,0.,0.9],&[(2,3,[0.,0.,0.,0.9015])]);
    assert_eq!(bounds(&alpha,&json!({"basedOn":"topLeft"})).unwrap(),Rect::new(2,3,3,4));native(&mut alpha,json!({"basedOn":"topLeft"}));
    // A raw red delta .002 is above .5/255, but premultiplied by alpha .5 is below.
    let mut color=pixels(7,5,[0.5,0.,0.,0.5],&[(1,1,[0.502,0.,0.,0.5]),(4,2,[0.51,0.,0.,0.5])]);
    assert_eq!(bounds(&color,&json!({"basedOn":"topLeft"})).unwrap(),Rect::new(4,2,5,3));native(&mut color,json!({"basedOn":"topLeft"}));
    let mut exact=pixels(6,5,[0.,0.,0.,1.],&[(1,1,[0.5/255.,0.,0.,1.]),(4,3,[0.5001/255.,0.,0.,1.])]);
    assert_eq!(bounds(&exact,&json!({"basedOn":"topLeft"})).unwrap(),Rect::new(4,3,5,4));native(&mut exact,json!({"basedOn":"topLeft"}));
    let mut soft=pixels(7,5,[0.;4],&[(2,3,[1.,0.4,0.2,1e-6]),(6,0,[0.8,0.2,0.5,0.])]);
    assert_eq!(bounds(&soft,&json!({})).unwrap(),Rect::new(2,3,3,4));native(&mut soft,json!({}));
}

#[test]
fn trim_bottom_right_reference_and_malformed_defaults_match_native_without_guessing() {
    for params in [Value::Null,json!({}),json!({"basedOn":null,"left":"false","top":0}),json!({"basedOn":"bottomRight"}),json!({"basedOn":"topLeft"}),json!({"basedOn":"topLeft","x":-100,"y":-100,"width":1,"height":1,"deleteCroppedPixels":false})] {
        let mut engine=pixels(8,6,[0.2,0.4,0.6,0.8],&[(1,1,[0.9,0.1,0.3,0.6]),(7,5,[0.8,0.7,0.2,0.7])]);native(&mut engine,params);
    }
    let mut empty=pixels(5,4,[0.;4],&[(1,1,[1.,0.2,0.3,0.])]);
    for params in [json!({}),json!({"basedOn":"topLeft"}),json!({"basedOn":"bottomRight","left":false,"right":false,"top":false,"bottom":false})] {native(&mut empty,params);}
}

#[test]
fn trim_retains_translated_selection_clips_content_only_and_leaves_filter_masks_stationary() {
    for depth in [8,16,32] {let mut f=fixture(depth,"rgb");let id=f.raster;
        f.engine.edit("Visible literal pixels",|doc,_|{for layer in &mut doc.layers{layer.visible=layer.id==id;}Ok(())}).unwrap();normalize(&mut f.engine);
        let before=f.engine.active().unwrap().doc.clone();let old_selection=before.selection.as_ref().unwrap();
        assert_eq!(bounds(&f.engine,&json!({})).unwrap(),Rect::new(2,3,3,4));native(&mut f.engine,json!({}));
        let doc=&f.engine.active().unwrap().doc;
        assert!(doc.selection.is_some());assert_eq!(doc.selection.as_ref().unwrap().pixel(0,-1),old_selection.pixel(2,2));
        assert_eq!(doc.selection.as_ref().unwrap().pixel(4,2),old_selection.pixel(6,5));
        assert_eq!(doc.channels[0].surface.pixel(-4,0),before.channels[0].surface.pixel(-2,3));
        assert_eq!(doc.channels[0].surface.pixel(18,1),before.channels[0].surface.pixel(20,4));
        assert_eq!(doc.layer(id).unwrap().mask.as_ref().unwrap().surface.pixel(-1,-1),before.layer(id).unwrap().mask.as_ref().unwrap().surface.pixel(1,2));
        for smart_id in [f.smart,f.embedded] {assert_eq!(smart(doc,smart_id).source,smart(&before,smart_id).source);assert_eq!(smart(doc,smart_id).filter_mask,smart(&before,smart_id).filter_mask);}
        assert_eq!(doc.layer(id).unwrap().surface().unwrap().content_bounds(),Rect::new(0,0,1,1));
    }
}

#[test]
fn trim_strip_compositing_uses_global_gradient_vector_mask_and_blend_context() {
    let mut f=fixture(32,"rgb");
    let path_id=LayerId(f.engine.execute("shape.create",json!({"rect":[100,0,7900,5],"fill":[1.,1.,1.,1.]})).unwrap()["layer"].as_u64().unwrap());
    let LayerContent::Shape(path_shape)=&f.engine.active().unwrap().doc.layer(path_id).unwrap().content else{unreachable!()};let path=path_shape.path.clone();
    f.engine.edit("Global gradient Trim context",|doc,active|{
        doc.size=photocraft_engine::doc::Size::new(8201,5);
        let mut base=Surface::new(PixelFormat::RGBA32F);base.fill_rect(doc.bounds(),&[0.2,0.3,0.4,1.]);
        let bottom=Layer::new("Backdrop",LayerContent::Raster(base));let id=bottom.id;
        let mut gradient=Layer::new("Global gradient",LayerContent::Fill(Fill::gradient(vec![(0.,Color::BLACK),(1.,Color::WHITE)],13.,85.,GradientStyle::Linear,false)));
        gradient.blend=BlendMode::Multiply;gradient.opacity=0.73;
        gradient.vector_mask=Some(VectorMask::new(path));
        let mut group=Layer::group("Isolated compositing context",vec![bottom,gradient]);group.opacity=0.81;
        doc.layers=vec![group];doc.selection=None;doc.channels.clear();doc.quick_mask=None;*active=Some(id);Ok(())
    }).unwrap();normalize(&mut f.engine);
    for based in ["topLeft","bottomRight","transparent"] {let mut engine=twin(&f.engine);native(&mut engine,json!({"basedOn":based}));}
    let mut boundary=pixels(515,519,[0.;4],&[(255,255,[1.,0.,0.,1.]),(256,256,[0.,1.,0.,0.3]),(513,517,[0.,0.,1.,0.7])]);
    assert_eq!(bounds(&boundary,&json!({})).unwrap(),Rect::new(255,255,514,518));native(&mut boundary,json!({}));
}

#[test]
fn trim_wide_sparse_literal_crosses_scan_boundaries_without_dense_reference() {
    // No whole-canvas native Trim here: only two literal sparse marks and the checked scanner.
    let mut engine=pixels(300_000,3,[0.;4],&[(65_535,1,[0.2,0.4,0.6,1.]),(262_145,1,[0.8,0.1,0.5,0.25]),(-750_000,750_000,[1.,0.,0.,1.])]);
    let before=engine.active().unwrap().doc.clone();let surface=before.layers[0].surface().unwrap();
    let params=json!({"basedOn":"transparent","right":false});
    assert_eq!(bounds(&engine,&params).unwrap(),Rect::new(65_535,1,300_000,2));
    assert_eq!(run_with(&mut engine,TRIM,&params).unwrap(),json!({"x":65_535,"y":1,"width":234_465,"height":1}));
    let after=engine.active().unwrap().doc.clone();let output=after.layers[0].surface().unwrap();
    assert_eq!(output.pixel(0,0),surface.pixel(65_535,1));assert_eq!(output.pixel(196_610,0),surface.pixel(262_145,1));
    assert_eq!(output.pixel(-815_535,749_999),output.default_pixel());assert_eq!(output.tile_count(),2);
    engine.execute("edit.undo",json!({})).unwrap();assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));
    engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);
}

#[test]
fn trim_noop_side_flags_coalescing_preserve_original_journal_and_older_fade() {
    let mut f=fixture(16,"rgb");let before=f.engine.active().unwrap().doc.clone();let fade=f.engine.edit_state.fade.clone();let past=f.engine.active().unwrap().history.past_len();let mut expected=twin(&f.engine);
    let params=json!({"left":false,"right":false,"top":false,"bottom":false,"coalesce":"trim gesture","basedOn":"transparent","vendor":[1,2]});
    for _ in 0..2 {assert_eq!(run_with(&mut f.engine,TRIM,&params).unwrap(),expected.execute(TRIM,params.clone()).unwrap());same(&f.engine,&expected);}
    assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);assert_eq!(f.engine.edit_state.fade,fade);
    assert_eq!(f.engine.journal.last(),Some(&(TRIM.into(),params)));
    f.engine.execute("edit.undo",json!({})).unwrap();assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
}

#[test]
fn trim_invalid_parameters_empty_canvas_and_active_job_keep_native_error_priority() {
    for params in [json!([]),json!("invalid")] {let mut f=fixture(8,"rgb");native(&mut f.engine,params);}
    let mut empty=Session::new();let mut expected=Session::new();assert_eq!(run_with(&mut empty,TRIM,&Value::Null).unwrap_err(),expected.execute(TRIM,Value::Null).unwrap_err().to_string());
    use std::sync::atomic::{AtomicBool,Ordering};
    let mut engine=pixels(5,4,[0.;4],&[]);let release=Arc::new(AtomicBool::new(false));let worker=release.clone();
    struct Release(Arc<AtomicBool>);impl Drop for Release{fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}let _release=Release(release.clone());
    let started=engine.start_job("trim-job",json!({}),"Trim job priority",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();
    let photocraft_engine::jobs::Started::Job(job)=started else{panic!("Expected job")};let before=twin(&engine);
    let expected=engine.execute(TRIM,json!({})).unwrap_err().to_string();assert_eq!(run_with(&mut engine,TRIM,&json!({})).unwrap_err(),expected);unchanged(&engine,&before);
    release.store(true,Ordering::Relaxed);engine.wait_job(job).unwrap();
}
