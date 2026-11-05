use super::*;
use photocraft_engine::{doc::{AlphaChannel, Document, Layer, LayerId, LayerMask, PixelFormat, Rect, Size}, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};

const IMAGE: &str = "image.imageSize";
const CANVAS: &str = "image.canvasSize";
const ROTATION: &str = "image.rotation.arbitrary";

fn fixture(depth: u32) -> (Session, LayerId) {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":4,"height":3,"depth":depth})).unwrap();
    engine.edit("Geometry source", |doc, active| {
        let mut layer = Layer::raster("Background", doc.pixel_format()); layer.locks.transparency = true;
        for y in 0..3 { for x in 0..4 { layer.surface_mut().unwrap().write_pixel(x,y,&[x as f32/3.,y as f32/2.,((x+y)%2) as f32,1.]); } }
        let mut coverage = Surface::new(PixelFormat::GRAY8);
        coverage.fill_rect(Rect::from_xywh(1,1,2,1), &[1.]);
        let mut mask = LayerMask::hide_all(); mask.surface = coverage.clone(); mask.linked = false; mask.density = 0.75; mask.feather = 0.5; layer.mask = Some(mask);
        doc.channels.push(AlphaChannel::new("Auxiliary alpha",coverage.clone()));
        doc.quick_mask = Some(AlphaChannel::new("Quick Mask",coverage.clone())); doc.selection = Some(coverage);
        *active = Some(layer.id); doc.layers = vec![layer]; Ok(())
    }).unwrap();
    let id = engine.active().unwrap().active_layer.unwrap();
    engine.active_mut().unwrap().channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
    engine.tools.foreground = [0.2,0.3,0.4,0.5]; engine.tools.background = [0.7,0.6,0.5,1.];
    let state = engine.active().unwrap();
    engine.edit_state.fade = Some(photocraft_engine::edit_menu_cmds::FadeSource { doc:state.doc.id, revision:state.revision, layer:id, mask:false, label:"Retained earlier Fade".into() });
    (engine,id)
}

fn twin(engine: &Session) -> Session {
    let state = engine.active().unwrap(); let mut copy = Session::new();
    copy.add_document(Document::new("Geometry twin",state.doc.size,state.doc.mode,state.doc.depth),None);
    *copy.active_mut().unwrap() = state.clone(); copy.tools = engine.tools.clone(); copy.presets = engine.presets.clone(); copy.patterns = engine.patterns.clone(); copy.edit_state = engine.edit_state.clone(); copy.journal = engine.journal.clone();
    copy.clipboard = engine.clipboard.clone(); copy.style_clipboard = engine.style_clipboard.clone(); copy
}

fn same(actual: &Session, expected: &Session) {
    let a = actual.active().unwrap(); let e = expected.active().unwrap();
    assert_eq!(a.doc,e.doc); assert_eq!(a.history.entries(),e.history.entries()); assert_eq!(a.history.past_len(),e.history.past_len());
    for index in 0..a.history.past_len() { assert_eq!(a.history.state(index),e.history.state(index)); }
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());
    assert_eq!((a.revision,a.saved_revision,&a.coalesce,a.active_layer,&a.selected_layers,a.layer_anchor,&a.path,&a.last_damage),(e.revision,e.saved_revision,&e.coalesce,e.active_layer,&e.selected_layers,e.layer_anchor,&e.path,&e.last_damage));
    assert_eq!(a.channel_view,e.channel_view); assert_eq!(a.isolated_layers,e.isolated_layers); assert_eq!(a.fx_collapsed,e.fx_collapsed);
    assert_eq!(actual.journal,expected.journal); assert_eq!(actual.edit_state.fade,expected.edit_state.fade);
    assert_eq!(actual.tools.foreground,expected.tools.foreground); assert_eq!(actual.tools.background,expected.tools.background); assert_eq!(actual.tools.brush,expected.tools.brush);
    assert_eq!(super::super::super::tools::presets(actual),super::super::super::tools::presets(expected));
    assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard)); assert_eq!(actual.style_clipboard,expected.style_clipboard);
}

fn unchanged(actual: &Session, before: &Session) { same(actual,before); assert!(Arc::ptr_eq(&actual.active().unwrap().doc,&before.active().unwrap().doc)); }
fn execute(engine: &mut Session, command: &str, params: Value) -> Result<Value,String> { super::super::super::execute_view_command(engine,command,params) }

#[test]
fn geometry_admission_resolves_native_float_defaults_aspect_relative_and_clamp() {
    let (engine,_) = fixture(8);
    let cases = [
        (IMAGE,json!({"width":6.6}),(7,5)), (IMAGE,json!({"height":5.6}),(7,6)),
        (IMAGE,json!({"width":5.5,"height":4.5}),(6,5)), (IMAGE,json!({"width":0,"height":-2.4}),(1,1)),
        (IMAGE,json!({"width":"8","height":null}),(4,3)), (IMAGE,Value::Null,(4,3)),
        (IMAGE,json!({"width":1e308,"height":1}),(300_000,1)),
        (CANVAS,json!({"relative":true,"width":2.6,"height":-1.6}),(7,1)),
        (CANVAS,json!({"relative":true,"width":-100}),(1,3)),
        (CANVAS,json!({"relative":true,"width":"3","height":null}),(4,3)),
        (CANVAS,json!({"relative":"true","width":5.5}),(6,3)),
        (CANVAS,json!({"width":1,"height":1e308}),(1,300_000)),
        (CANVAS,json!({}),(4,3)),
    ];
    for (command,params,expected) in cases { assert_eq!(resolved_size(&engine,command,&params),Some(expected),"{command}/{params}"); }
    assert_eq!(resolved_size(&engine,"image.crop",&json!({"width":99})),None);
    assert_eq!(resolved_size(&engine,IMAGE,&json!({"resample":"none","width":20000,"height":20000})),Some((4,3)));
}

#[test]
fn geometry_admission_injected_boundary_uses_final_area_and_preserves_borrowed_state() {
    let (engine,_) = fixture(16); let before = twin(&engine);
    for command in [IMAGE,CANVAS] {
        assert!(validate_with_limit(&engine,command,&json!({}),12).is_ok());
        assert_eq!(validate_with_limit(&engine,command,&json!({}),11).unwrap_err(),LIMIT_ERROR);
        assert!(validate_with_limit(&engine,command,&json!({"width":0,"height":0}),1).is_ok());
        assert!(validate_with_limit(&engine,command,&json!({"width":5.5,"height":4.5}),30).is_ok());
        assert!(validate_with_limit(&engine,command,&json!({"width":5.5,"height":4.5}),29).is_err());
    }
    assert!(validate_with_limit(&engine,IMAGE,&json!({"width":8}),48).is_ok());
    assert!(validate_with_limit(&engine,IMAGE,&json!({"width":8}),47).is_err());
    assert!(validate_with_limit(&engine,CANVAS,&json!({"relative":true,"width":4,"height":3}),48).is_ok());
    assert!(validate_with_limit(&engine,CANVAS,&json!({"relative":true,"width":4,"height":3}),47).is_err());
    assert!(validate_with_limit(&engine,IMAGE,&json!({"width":1e308,"height":1,"resample":"none"}),12).is_ok());
    unchanged(&engine,&before);
}

#[test]
fn geometry_admission_image_size_nearest_three_depths_matches_native_and_literal_pixels() {
    for depth in [8,16,32] {
        let (mut engine,id) = fixture(depth); let before = engine.active().unwrap().doc.clone(); let mut native = twin(&engine);
        let params = json!({"width":8,"resample":"nearest","coalesce":"geometry-test"});
        assert_eq!(execute(&mut engine,IMAGE,params.clone()).unwrap(),native.execute(IMAGE,params).unwrap()); same(&engine,&native);
        let doc = &engine.active().unwrap().doc; assert_eq!(doc.size,Size::new(8,6));
        let source = before.layer(id).unwrap().surface().unwrap(); let actual = doc.layer(id).unwrap().surface().unwrap();
        for y in 0..6 { for x in 0..8 { assert_eq!(actual.pixel(x,y),source.pixel(x/2,y/2),"{depth} nearest({x},{y})"); } }
        assert_ne!(doc.selection,before.selection); assert_ne!(doc.channels[0].surface,before.channels[0].surface); assert_ne!(doc.quick_mask,before.quick_mask);
        assert_eq!(doc.layer(id).unwrap().mask.as_ref().unwrap().surface,doc.channels[0].surface);
        assert_eq!(doc.selection.as_ref().unwrap(),&doc.channels[0].surface); assert_eq!(doc.quick_mask.as_ref().unwrap().surface,doc.channels[0].surface);
        let after = doc.clone(); engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&engine,&native); assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));
        engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&engine,&native); assert_eq!(engine.active().unwrap().doc,after);
    }
}

#[test]
fn geometry_admission_canvas_relative_anchor_three_depths_moves_all_surfaces_and_extends_background() {
    for depth in [8,16,32] {
        let (mut engine,id) = fixture(depth); let before = engine.active().unwrap().doc.clone(); let mut native = twin(&engine);
        let params = json!({"relative":true,"width":4,"height":3,"anchor":"bottomRight","extensionColor":"#00ff00"});
        let result = execute(&mut engine,CANVAS,params.clone()).unwrap(); assert_eq!(result,native.execute(CANVAS,params).unwrap()); assert_eq!(result,json!({"width":8,"height":6,"offset":[4,3]})); same(&engine,&native);
        let doc = &engine.active().unwrap().doc; let pixels = doc.layer(id).unwrap().surface().unwrap(); let original = before.layer(id).unwrap().surface().unwrap();
        for y in 0..6 { for x in 0..8 {
            let expected = if x>=4 && y>=3 {original.pixel(x-4,y-3)} else {vec![0.,1.,0.,1.]}; assert_eq!(pixels.pixel(x,y),expected,"{depth} canvas({x},{y})");
            let coverage = if (5..7).contains(&x) && y==4 {1.} else {0.};
            for surface in [&doc.layer(id).unwrap().mask.as_ref().unwrap().surface,&doc.channels[0].surface,&doc.quick_mask.as_ref().unwrap().surface,doc.selection.as_ref().unwrap()] { assert_eq!(surface.sample_channel(x,y,0),coverage); }
        } }
        let after = doc.clone(); engine.execute("edit.undo",json!({})).unwrap(); native.execute("edit.undo",json!({})).unwrap(); same(&engine,&native); assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before));
        engine.execute("edit.redo",json!({})).unwrap(); native.execute("edit.redo",json!({})).unwrap(); same(&engine,&native); assert_eq!(engine.active().unwrap().doc,after);
    }
}

#[test]
fn geometry_admission_fractional_zero_negative_and_default_edits_keep_native_history_and_targets() {
    for (command,params,expected) in [
        (IMAGE,json!({"width":6.6,"resample":"nearest"}),(7,5)),
        (IMAGE,json!({"height":5.6,"resample":"nearest"}),(7,6)),
        (IMAGE,json!({"width":0,"height":-2.4}),(1,1)),
        (IMAGE,json!({"width":"unused","height":null}),(4,3)),
        (IMAGE,Value::Null,(4,3)),
        (CANVAS,json!({"relative":true,"width":2.6,"height":-1.6}),(7,1)),
        (CANVAS,json!({"relative":true,"width":-100}),(1,3)),
        (CANVAS,json!({"relative":true,"width":"unused"}),(4,3)),
        (CANVAS,Value::Null,(4,3)),
    ] {
        let (mut engine,_) = fixture(16); let mut native = twin(&engine); let past = engine.active().unwrap().history.past_len();
        assert_eq!(execute(&mut engine,command,params.clone()).unwrap(),native.execute(command,params).unwrap()); same(&engine,&native);
        assert_eq!(engine.active().unwrap().doc.size,Size::new(expected.0,expected.1)); assert_eq!(engine.active().unwrap().history.past_len(),past+1);
    }
}

#[test]
fn geometry_admission_no_resample_huge_request_is_native_resolution_only_even_when_reply_reports_requested_size() {
    for request in [json!({"width":20000,"height":20000}),json!({"width":1e308,"height":1e308})] {
        let (mut engine,_) = fixture(32); let before = engine.active().unwrap().doc.clone(); let mut native = twin(&engine); let mut params = request;
        params["resample"] = json!("none"); params["resolution"] = json!(300.5);
        assert!(validate(&engine,IMAGE,&params).is_ok()); let result = execute(&mut engine,IMAGE,params.clone()).unwrap(); assert_eq!(result,native.execute(IMAGE,params).unwrap()); same(&engine,&native);
        let mut expected = (*before).clone(); expected.resolution_dpi = 300.5; assert_eq!(*engine.active().unwrap().doc,expected); assert_eq!(engine.active().unwrap().doc.size,Size::new(4,3));
        assert!(result["width"].as_u64().unwrap()>=20000); assert!(result["height"].as_u64().unwrap()>=20000);
    }
}

#[test]
fn geometry_admission_real_gateways_huge_and_aspect_relative_requests_refuse_without_mutation_or_preset_flush() {
    use photocraft_engine::preset_store::{open,MemBackend};
    let (mut engine,_) = fixture(16); let backend = MemBackend::default(); engine.attach_preset_store(open(Box::new(backend.clone())));
    let mut preset = engine.tools.presets[0].clone(); preset.name = "Pending geometry refusal".into(); preset.group = "Geometry owner".into(); preset.builtin = false; engine.tools.presets.push(preset); engine.brush_presets_changed();
    let files = backend.files.lock().unwrap().clone(); let before = twin(&engine);
    for (command,params,expected) in [
        (IMAGE,json!({"width":20000,"height":20000}),(20000,20000)),
        (IMAGE,json!({"width":20000}),(20000,15000)),
        (CANVAS,json!({"relative":true,"width":20000,"height":20000}),(20004,20003)),
        (CANVAS,json!({"width":1e308,"height":1e308}),(300000,300000)),
    ] {
        assert_eq!(resolved_size(&engine,command,&params),Some(expected));
        assert_eq!(super::super::validate_geometry_input(&engine,command,&params).unwrap_err(),LIMIT_ERROR); unchanged(&engine,&before); assert_eq!(*backend.files.lock().unwrap(),files);
        assert_eq!(super::super::validate_lens_input(&engine,command,&params).unwrap_err(),LIMIT_ERROR); unchanged(&engine,&before); assert_eq!(*backend.files.lock().unwrap(),files);
    }
    // Sparse metadata-only source: the product check itself must not materialize its pixels.
    let state = engine.active_mut().unwrap(); Arc::make_mut(&mut state.doc).size = Size::new(20000,20000);
    let before = twin(&engine); assert_eq!(validate(&engine,CANVAS,&json!({})).unwrap_err(),LIMIT_ERROR); unchanged(&engine,&before);
}

#[test]
fn geometry_admission_native_argument_no_document_and_active_job_errors_keep_precedence() {
    for command in [IMAGE,CANVAS] {
        let mut empty = Session::new(); assert!(validate(&empty,command,&json!({"width":20000,"height":20000})).is_ok());
        let error = empty.execute(command,json!({"width":20000,"height":20000})).unwrap_err().to_string(); assert_eq!(execute(&mut empty,command,json!({"width":20000,"height":20000})).unwrap_err(),error); assert!(empty.journal.is_empty());
        for params in [json!([]),json!(42),json!("invalid")] {
            let (mut engine,_) = fixture(8); let before = twin(&engine); let mut native = twin(&engine); assert!(validate_with_limit(&engine,command,&params,0).is_ok());
            assert_eq!(execute(&mut engine,command,params.clone()).unwrap_err(),native.execute(command,params).unwrap_err().to_string()); unchanged(&engine,&before);
        }
    }
    let (mut engine,_) = fixture(8); let release = Arc::new(AtomicBool::new(false)); let worker = release.clone();
    struct Release(Arc<AtomicBool>); impl Drop for Release {fn drop(&mut self){self.0.store(true,Ordering::Relaxed);}}
    let _release = Release(release.clone());
    let started = engine.start_job("geometry-test",json!({}),"Retained geometry job",true,move |context| {while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();
    let photocraft_engine::jobs::Started::Job(job) = started else {panic!("expected native job")}; let before = twin(&engine);
    for command in [IMAGE,CANVAS] {
        let params = json!({"width":20000,"height":20000}); assert!(validate_with_limit(&engine,command,&params,0).is_ok());
        let native = engine.execute(command,params.clone()).unwrap_err().to_string(); let actual = execute(&mut engine,command,params).unwrap_err(); assert_eq!(actual,native); assert!(actual.contains("Retained geometry job")); unchanged(&engine,&before);
    }
    release.store(true,Ordering::Relaxed); engine.wait_job(job).unwrap();
}

#[test]
fn geometry_admission_rotation_resolves_native_f32_angles_and_exact_canvas_boundary() {
    let (engine,_) = fixture(16); let before = twin(&engine);
    for (params,expected) in [
        (json!({"angle":90}),(3,4)), (json!({"angle":-90,"direction":"ccw"}),(3,4)),
        (json!({"angle":45}),(5,5)), (json!({"angle":180}),(4,3)),
        (json!({"angle":450,"direction":null}),(3,4)),
    ] { assert_eq!(resolved_size(&engine,ROTATION,&params),Some(expected)); }
    let angle=44.123456789;
    let native=photocraft_engine::mode_cmds::rotated_size(Size::new(4,3),f64::from(angle as f32));
    assert_eq!(resolved_size(&engine,ROTATION,&json!({"angle":angle})),Some((native.width,native.height)));
    assert!(validate_with_limit(&engine,ROTATION,&json!({"angle":45}),25).is_ok());
    assert_eq!(validate_with_limit(&engine,ROTATION,&json!({"angle":45}),24).unwrap_err(),LIMIT_ERROR);
    unchanged(&engine,&before);
}

#[test]
fn geometry_admission_rotation_noop_and_invalid_parameters_remain_native_owned() {
    for params in [Value::Null,json!({}),json!({"angle":null}),json!({"angle":"45"}),json!({"angle":0}),json!({"angle":-360}),json!({"angle":3600}),json!({"angle":360.00000001})] {
        let (mut engine,_) = fixture(8); let before = twin(&engine); let mut native=twin(&engine);
        assert_eq!(resolved_size(&engine,ROTATION,&params),None);
        assert!(validate_with_limit(&engine,ROTATION,&params,0).is_ok());
        assert_eq!(execute(&mut engine,ROTATION,params.clone()).unwrap(),native.execute(ROTATION,params).unwrap());
        same(&engine,&native); assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));
    }
    for params in [json!([]),json!(42),json!({"angle":3601}),json!({"angle":1e308}),json!({"angle":45,"direction":"invalid"})] {
        let (mut engine,_) = fixture(8); let before=twin(&engine); let mut native=twin(&engine);
        assert!(validate_with_limit(&engine,ROTATION,&params,0).is_ok());
        assert_eq!(execute(&mut engine,ROTATION,params.clone()).unwrap_err(),native.execute(ROTATION,params).unwrap_err().to_string());
        unchanged(&engine,&before);
    }
    let mut empty=Session::new(); let params=json!({"angle":45});
    assert!(validate_with_limit(&empty,ROTATION,&params,0).is_ok());
    let expected=empty.execute(ROTATION,params.clone()).unwrap_err().to_string();
    assert_eq!(execute(&mut empty,ROTATION,params).unwrap_err(),expected); assert!(empty.journal.is_empty());
}

#[test]
fn geometry_admission_rotation_real_gateways_refuse_grown_canvas_without_rendering_or_mutation() {
    let (mut engine,_) = fixture(16);
    Arc::make_mut(&mut engine.active_mut().unwrap().doc).size=Size::new(16384,16384);
    let before=twin(&engine); let params=json!({"angle":45});
    assert_eq!(resolved_size(&engine,ROTATION,&params),Some((23171,23171)));
    for direction in ["cw","ccw"] {
        let mut params=params.clone(); params["direction"]=json!(direction);
        assert_eq!(super::super::validate_geometry_input(&engine,ROTATION,&params).unwrap_err(),LIMIT_ERROR);
        assert_eq!(super::super::validate_lens_input(&engine,ROTATION,&params).unwrap_err(),LIMIT_ERROR);
        assert_eq!(execute(&mut engine,ROTATION,params).unwrap_err(),LIMIT_ERROR); unchanged(&engine,&before);
    }
    // A metadata-only oversized canvas can still perform native non-editing angle no-ops.
    Arc::make_mut(&mut engine.active_mut().unwrap().doc).size=Size::new(20000,20000);
    let before=twin(&engine); assert!(validate_with_limit(&engine,ROTATION,&json!({"angle":360}),0).is_ok());
    assert_eq!(execute(&mut engine,ROTATION,json!({"angle":360})).unwrap(),json!({"width":20000,"height":20000}));
    assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));
}

#[test]
fn geometry_admission_rotation_keeps_sparse_offcanvas_bounds_out_of_canvas_admission() {
    let (mut engine,id)=fixture(32);
    engine.edit("Sparse offcanvas rotation admission",|doc,_|{
        let pixels=doc.layer_mut(id).unwrap().surface_mut().unwrap();
        pixels.write_pixel(-20000,-20000,&[1.,0.,0.,1.]);pixels.write_pixel(20000,20000,&[0.,0.,1.,1.]);Ok(())
    }).unwrap();
    let before=twin(&engine);
    assert!(validate_with_limit(&engine,ROTATION,&json!({"angle":45}),25).is_ok());
    unchanged(&engine,&before);
}

#[test]
fn geometry_admission_rotation_small_native_pixels_history_and_coverage_match_at_three_depths() {
    for depth in [8,16,32] { for interpolation in ["nearest","bilinear","bicubic"] {
        let (mut engine,_)=fixture(depth); let mut native=twin(&engine); let original=engine.active().unwrap().doc.clone();
        let params=json!({"angle":31.23456789,"direction":"ccw","interpolation":interpolation});
        assert_eq!(execute(&mut engine,ROTATION,params.clone()).unwrap(),native.execute(ROTATION,params).unwrap());same(&engine,&native);
        assert_eq!(engine.active().unwrap().doc.size,Size::new(5,5));
        engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&engine,&native);
        assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&original));
        engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&engine,&native);
    }}
}
