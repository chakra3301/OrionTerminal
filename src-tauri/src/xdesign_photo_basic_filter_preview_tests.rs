use super::*;
use base64::Engine as _;
use photocraft_engine::doc::{Affine, AlphaChannel, BlendMode, Document, Layer, LayerContent, LayerId, LayerMask, PixelFormat, Rect, SmartFilter, SmartObject, SmartSource};
use photocraft_raster::Surface;
use serde_json::json;
use std::{path::PathBuf, sync::{Arc, Weak}};

const COMMAND:&str="layer.smartFilter.setParams";
const WIDTH:u32=20;
const HEIGHT:u32=16;

struct Directory(PathBuf);
impl Drop for Directory {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
struct Fixture {directory:Directory,engine:Session,id:LayerId,path:PathBuf,bytes:Vec<u8>}

fn codes()->Vec<u8> {
    let mut pixels=Vec::new();for y in 0..HEIGHT {for x in 0..WIDTH {
        let rgb=if x<10 {[51,102,153]}else{[153,51,102]};
        pixels.extend(rgb.map(|code|code+if y>=8{13}else{0}));pixels.push(255);
    }}pixels
}
fn encoded()->Vec<u8> {
    let image=photocraft_codecs::Image::from_u8(WIDTH,HEIGHT,photocraft_codecs::ChannelLayout::Rgba,codes()).unwrap();
    photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap()
}
fn settings(command:&str)->Value {match command {
    "filter.blur.gaussianBlur"=>json!({"radius":1.3}),
    "filter.blur.boxBlur"=>json!({"radius":1}),
    "filter.blur.motionBlur"=>json!({"angle":23,"distance":4}),
    "filter.blur.radialBlur"=>json!({"amount":30,"method":"zoom","centerX":0.35,"centerY":0.6}),
    "filter.blur.surfaceBlur"=>json!({"radius":2,"threshold":70}),
    "filter.sharpen.unsharpMask"=>json!({"amount":80,"radius":1,"threshold":0}),
    "filter.sharpen.smartSharpen"=>json!({"amount":90,"radius":1.2,"reduceNoise":17}),
    _=>unreachable!(),
}}
fn custom(offset:i32)->SmartFilter {
    let mut kernel=vec![0;25];kernel[12]=1;
    SmartFilter{command:"filter.other.custom".into(),params:json!({"kernel":kernel,"scale":1,"offset":offset,"vendor":{"adjacent":offset}}),visible:true,opacity:1.,blend:BlendMode::Normal}
}
fn smart(doc:&Document,id:LayerId)->&SmartObject {let LayerContent::Smart(object)=&doc.layer(id).unwrap().content else{panic!("Expected Smart Object")};object}
fn fixture(depth:u32,command:&str,linked:bool,adjacent:bool)->Fixture {
    let directory=std::env::temp_dir().join(format!("existing-basic-preview-{}",ulid::Ulid::new()));std::fs::create_dir(&directory).unwrap();
    let path=directory.join("source.png");let bytes=encoded();std::fs::write(&path,&bytes).unwrap();
    let mut engine=Session::new();engine.execute("file.new",json!({"width":WIDTH,"height":HEIGHT,"depth":depth,"background":"transparent"})).unwrap();
    let format=engine.active().unwrap().doc.pixel_format();let mut stale=Surface::new(format);stale.fill_rect(Rect::new(0,0,WIDTH as i32,HEIGHT as i32),&[0.9,0.1,0.8,1.]);
    let source=if linked{SmartSource::Linked{path:path.to_string_lossy().into()}}else{SmartSource::Embedded{file_name:"source.png".into(),bytes:Arc::new(bytes.clone())}};
    let mut object=SmartObject::new(source,Affine::IDENTITY,Some(stale));
    if adjacent {object.smart_filters.push(custom(100));}
    object.smart_filters.push(SmartFilter{command:command.into(),params:json!({"vendor":{"keep":[null,true,7]}}),visible:true,opacity:1.,blend:BlendMode::Normal});
    if adjacent {object.smart_filters.push(custom(-40));}
    object.psd_raw=Some(Arc::new(b"unchanged placed metadata".to_vec()));
    let mut mask=LayerMask::reveal_all();mask.enabled=false;mask.linked=false;mask.density=0.4;mask.feather=1.5;mask.surface.write_pixel(2,3,&[0.25]);object.filter_mask=Some(mask);
    let mut layer=Layer::new("Existing basic filter",LayerContent::Smart(object));let id=layer.id;
    for key in [*b"SoLd",*b"SoLE",*b"PlLd",*b"zzzz"]{layer.psd_blocks.push((key,Arc::new(key.to_vec())));}
    engine.edit("Basic preview fixture",|doc,active|{doc.layers=vec![layer];*active=Some(id);let mut selection=Surface::new(PixelFormat::GRAY8);selection.fill_rect(Rect::new(2,2,17,13),&[0.5]);doc.selection=Some(selection.clone());doc.channels.push(AlphaChannel::new("Retained alpha",selection));doc.metadata.psd_global_blocks.push((*b"8BIM",*b"zzzz",Arc::new(b"unchanged globals".to_vec())));Ok(())}).unwrap();
    let index=engine.active_index().unwrap();engine.execute("document.activate",json!({"document":index})).unwrap();
    engine.tools.foreground=[0.1,0.2,0.3,0.4];let state=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:id,mask:false,label:"Older Fade".into()});
    Fixture{directory:Directory(directory),engine,id,path,bytes}
}
fn twin(engine:&Session)->Session {
    let state=engine.active().unwrap();let mut result=Session::new();result.add_document(Document::new("Twin",state.doc.size,state.doc.mode,state.doc.depth),None);
    *result.active_mut().unwrap()=state.clone();result.journal=engine.journal.clone();result.tools=engine.tools.clone();result.edit_state=engine.edit_state.clone();result.presets=engine.presets.clone();result.patterns=engine.patterns.clone();result.clipboard=engine.clipboard.clone();result.style_clipboard=engine.style_clipboard.clone();
    super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut result).unwrap();result
}
fn same(actual:&Session,expected:&Session) {
    let a=actual.active().unwrap();let b=expected.active().unwrap();assert_eq!(a.doc,b.doc);assert_eq!(a.history.entries(),b.history.entries());assert_eq!(a.history.past_len(),b.history.past_len());
    for index in 0..a.history.past_len(){assert_eq!(a.history.state(index),b.history.state(index));}
    assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),b.history.redo_labels().collect::<Vec<_>>());assert_eq!((a.history.max_states,a.history.max_bytes),(b.history.max_states,b.history.max_bytes));
    assert_eq!((a.active_layer,&a.selected_layers,a.layer_anchor,a.revision,a.saved_revision,&a.coalesce,&a.last_damage,&a.channel_view),(b.active_layer,&b.selected_layers,b.layer_anchor,b.revision,b.saved_revision,&b.coalesce,&b.last_damage,&b.channel_view));
    assert_eq!(actual.journal,expected.journal);assert_eq!(actual.edit_state.fade,expected.edit_state.fade);assert_eq!(actual.tools.brush,expected.tools.brush);assert_eq!(actual.tools.foreground,expected.tools.foreground);assert_eq!(actual.tools.background,expected.tools.background);assert_eq!(actual.style_clipboard,expected.style_clipboard);
    assert_eq!(super::super::tools::presets(actual),super::super::tools::presets(expected));assert_eq!(super::super::color_views::key(actual).unwrap(),super::super::color_views::key(expected).unwrap());
}
fn unchanged(engine:&Session,before:&Session){same(engine,before);assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));}
fn png(png:&str)->Vec<u8> {photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap().as_u8().unwrap().to_vec()}
fn display_matches(actual:&str,expected:&str){let actual=png(actual);let expected=png(expected);assert_eq!(actual.len(),expected.len());assert!(actual.iter().zip(expected).all(|(a,b)|a.abs_diff(b)<=1));}
fn reference(depth:u32,command:&str,settings:&Value,adjacent:bool,twice:bool,reordered:bool)->Document {
    let mut engine=Session::new();engine.execute("file.new",json!({"width":WIDTH,"height":HEIGHT,"depth":depth,"background":"transparent"})).unwrap();
    let format=engine.active().unwrap().doc.pixel_format();let mut surface=Surface::new(format);let pixels=codes().into_iter().map(|value|f32::from(value)/255.).collect::<Vec<_>>();surface.write_region(Rect::new(0,0,WIDTH as i32,HEIGHT as i32),&pixels);
    let layer=Layer::new("Independent raster source",LayerContent::Raster(surface));let id=layer.id;
    engine.edit("Source raster",|doc,active|{doc.layers=vec![layer];*active=Some(id);Ok(())}).unwrap();
    if adjacent&&!reordered{let filter=custom(100);engine.execute(&filter.command,filter.params).unwrap();}
    engine.execute(command,settings.clone()).unwrap();if twice{engine.execute(command,settings.clone()).unwrap();}
    if adjacent {if reordered{let filter=custom(100);engine.execute(&filter.command,filter.params).unwrap();}let filter=custom(-40);engine.execute(&filter.command,filter.params).unwrap();}
    (*engine.active().unwrap().doc).clone()
}

#[test]
fn basic_filter_edit_all_seven_three_depths_preview_source_stack_apply_and_undo_match_native() {
    for depth in [8,16,32]{for command in BASIC_FILTER_EDITS{for linked in [false,true]{
        let mut f=fixture(depth,command,linked,true);let before=twin(&f.engine);let original=f.engine.active().unwrap().doc.clone();let before_smart=smart(&original,f.id).clone();
        let settings=settings(command);let request=json!({"layer":f.id.0,"index":1,"params":settings});
        let expected=reference(depth,command,&settings,true,false,false);let expected_png=render_view_preview(&expected,&Default::default()).unwrap().png;
        let preview=render(f.engine.active().unwrap(),COMMAND,request.clone()).unwrap();display_matches(&preview.png,&expected_png);unchanged(&f.engine,&before);
        assert!(preview.result.as_ref().unwrap().get("lensEdit").is_none());assert!(preview.result.as_ref().unwrap().get("blurEdit").is_none());
        let mut native=twin(&f.engine);let expected_result=native.execute(COMMAND,request.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut f.engine,COMMAND,request.clone()).unwrap(),expected_result);same(&f.engine,&native);
        let state=f.engine.active().unwrap();let after=smart(&state.doc,f.id);assert_eq!(after.smart_filters.len(),3);assert_eq!(after.smart_filters[0],before_smart.smart_filters[0]);assert_eq!(after.smart_filters[2],before_smart.smart_filters[2]);
        assert_eq!(after.smart_filters[1].params["vendor"],before_smart.smart_filters[1].params["vendor"]);assert_eq!(after.source,before_smart.source);assert_eq!(after.psd_raw,before_smart.psd_raw);assert_eq!(after.filter_mask,before_smart.filter_mask);
        assert_eq!(after.cache.as_ref().unwrap().read_region(state.doc.bounds()),expected.layers[0].surface().unwrap().read_region(expected.bounds()));
        assert_eq!(preview.png,render_color_view_preview(&state.doc,&state.channel_view,Some(&display::View::new(&f.engine.color,&state.doc).unwrap())).unwrap().png);
        assert_eq!(f.engine.journal.last(),Some(&(COMMAND.into(),request)));let after=state.doc.clone();
        f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();same(&f.engine,&native);assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&original));
        f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();same(&f.engine,&native);assert_eq!(f.engine.active().unwrap().doc,after);
    }}}
}

fn quantize(value:f64,depth:u32)->f64 {match depth{8=>(value.clamp(0.,1.)*255.).round()/255.,16=>(value.clamp(0.,1.)*65535.).round()/65535.,32=>f64::from(value as f32),_=>unreachable!()}}
fn manual_edge(command:&str,depth:u32)->Vec<f64> {
    let source=codes().into_iter().map(|value|quantize(f64::from(value)/255.,depth)).collect::<Vec<_>>();
    // Literal sigma=1 Gaussian taps, independently normalized in f64; the box is exactly 3×3.
    let kernel=if command=="filter.blur.boxBlur"{vec![1./3.;3]}else{vec![0.004433048175243746,0.05400558262241449,0.2420362293761143,0.3990502796524549,0.2420362293761143,0.05400558262241449,0.004433048175243746]};
    let radius=(kernel.len()/2)as i32;let mut result=source.clone();
    for y in 0..HEIGHT as i32{for x in 0..WIDTH as i32{for c in 0..3{
        let mut blurred=0.;for(dy,wy)in kernel.iter().enumerate(){for(dx,wx)in kernel.iter().enumerate(){let sx=(x+dx as i32-radius).clamp(0,WIDTH as i32-1);let sy=(y+dy as i32-radius).clamp(0,HEIGHT as i32-1);blurred+=source[((sy*WIDTH as i32+sx)*4+c)as usize]*wx*wy;}}
        let at=((y*WIDTH as i32+x)*4+c)as usize;result[at]=quantize(if command=="filter.blur.boxBlur"{blurred}else{source[at]+0.8*(source[at]-blurred)},depth);
    }}}result
}

#[test]
fn basic_filter_edit_independent_literal_box_and_gaussian_unsharp_edges_all_pixels() {
    for depth in [8,16,32]{for command in ["filter.blur.boxBlur","filter.sharpen.unsharpMask"]{
        let mut f=fixture(depth,command,false,false);let request=json!({"layer":f.id.0,"index":0,"params":settings(command)});let expected=manual_edge(command,depth);
        if command=="filter.blur.boxBlur" {let at=((6*WIDTH+9)*4)as usize;assert!((expected[at]-quantize((2.*51.+153.)/(3.*255.),depth)).abs()<1e-12);}
        let preview=render(f.engine.active().unwrap(),COMMAND,request.clone()).unwrap();super::super::execute_view_command(&mut f.engine,COMMAND,request).unwrap();
        let state=f.engine.active().unwrap();let actual=smart(&state.doc,f.id).cache.as_ref().unwrap().read_region(state.doc.bounds());
        let tolerance=match depth{8=>1./255.,16=>2./65535.,32=>2e-6,_=>unreachable!()};
        for(index,(actual,expected))in actual.iter().zip(&expected).enumerate(){assert!((f64::from(*actual)-expected).abs()<=tolerance,"{command}/{depth}/{index}: {actual} != {expected}");if index%4==3{assert_eq!(*actual,1.);}}
        let mut document=(*state.doc).clone();let mut reference=Surface::new(document.pixel_format());reference.write_region(document.bounds(),&expected.iter().map(|value|*value as f32).collect::<Vec<_>>());document.layers=vec![Layer::new("Manual edge",LayerContent::Raster(reference))];
        display_matches(&preview.png,&render_view_preview(&document,&Default::default()).unwrap().png);
    }}
}

#[test]
fn basic_filter_edit_full_stack_order_and_single_application_have_visible_counterexamples() {
    for command in ["filter.blur.boxBlur","filter.sharpen.smartSharpen"] {
        let f=fixture(16,command,true,true);let settings=settings(command);let request=json!({"layer":f.id.0,"index":1,"params":settings});
        let preview=render(f.engine.active().unwrap(),COMMAND,request).unwrap();let expected=reference(16,command,&settings,true,false,false);
        let twice=reference(16,command,&settings,true,true,false);let reordered=reference(16,command,&settings,true,false,true);
        let actual=png(&preview.png);let once=png(&render_view_preview(&expected,&Default::default()).unwrap().png);display_matches(&preview.png,&render_view_preview(&expected,&Default::default()).unwrap().png);
        for other in [twice,reordered] {let other=png(&render_view_preview(&other,&Default::default()).unwrap().png);assert!(once.iter().zip(other).any(|(a,b)|a.abs_diff(b)>1),"{command} must distinguish source/order/double processing");}
        assert_eq!(actual.len(),(WIDTH*HEIGHT*4)as usize);
    }
}

#[test]
fn basic_filter_edit_hidden_and_disabled_stacks_keep_actual_visibility_without_forcing_input() {
    for command in BASIC_FILTER_EDITS{for(enabled,visible)in[(false,true),(true,false),(true,true)]{
        let mut f=fixture(16,command,true,true);let id=f.id;f.engine.edit("Hidden filter context",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.filters_enabled=enabled;object.smart_filters[1].visible=visible;object.smart_filters[1].opacity=0.37;object.smart_filters[1].blend=BlendMode::Multiply;Ok(())}).unwrap();
        let before=twin(&f.engine);let mut native=twin(&f.engine);let request=json!({"layer":id.0,"index":1,"params":settings(command)});native.execute(COMMAND,request.clone()).unwrap();
        let preview=render(f.engine.active().unwrap(),COMMAND,request.clone()).unwrap();display_matches(&preview.png,&render_view_preview(&native.active().unwrap().doc,&Default::default()).unwrap().png);unchanged(&f.engine,&before);
        super::super::execute_view_command(&mut f.engine,COMMAND,request).unwrap();same(&f.engine,&native);assert_eq!(smart(&f.engine.active().unwrap().doc,id).filters_enabled,enabled);assert_eq!(smart(&f.engine.active().unwrap().doc,id).smart_filters[1].visible,visible);
    }}
}

#[test]
fn basic_filter_edit_changed_validation_preserves_untouched_legacy_and_unknown_json() {
    for command in BASIC_FILTER_EDITS {let field=match command {"filter.blur.radialBlur"=>"amount","filter.blur.motionBlur"=>"distance",_=>"radius"};let mut f=fixture(16,command,false,false);let id=f.id;
        f.engine.edit("Legacy numeric setting",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.smart_filters[0].params=if command=="filter.blur.radialBlur"{json!({"amount":900.0,"method":"legacy","vendor":{"unknown":[null,7]}})}else{json!({(field):-40.0,"vendor":{"unknown":[null,7]}})};Ok(())}).unwrap();let before=twin(&f.engine);
        let legacy=if command=="filter.blur.radialBlur"{json!({"amount":900,"vendor":{"edited":[null,9]}})}else{json!({(field):-40,"vendor":{"edited":[null,9]}})};
        let request=json!({"layer":id.0,"index":0,"params":legacy});assert!(render(f.engine.active().unwrap(),COMMAND,request.clone()).is_ok());unchanged(&f.engine,&before);super::super::execute_view_command(&mut f.engine,COMMAND,request).unwrap();
        let stored=smart(&f.engine.active().unwrap().doc,id).smart_filters[0].params.clone();assert_eq!(stored["vendor"],json!({"edited":[null,9]}));if command=="filter.blur.radialBlur"{assert_eq!(stored["amount"],900);assert_eq!(stored["method"],"legacy");}else{assert_eq!(stored[field],-40);}
        let before=twin(&f.engine);let key=field;
        for value in [Value::Null,json!("bad"),json!(-1),json!(1e300)] {let request=json!({"layer":id.0,"index":0,"params":{(key):value}});assert!(render(f.engine.active().unwrap(),COMMAND,request.clone()).is_err());assert!(super::super::execute_view_command(&mut f.engine,COMMAND,request).is_err());unchanged(&f.engine,&before);}
        if command=="filter.blur.radialBlur" {let request=json!({"layer":id.0,"index":0,"params":{"method":"not-a-method"}});assert!(render(f.engine.active().unwrap(),COMMAND,request.clone()).is_err());assert!(super::super::execute_view_command(&mut f.engine,COMMAND,request).is_err());unchanged(&f.engine,&before);}
    }
    for stored in [Value::Null,json!([]),json!(37),json!("legacy scalar")] {
        let mut f=fixture(16,"filter.blur.gaussianBlur",true,false);let id=f.id;
        f.engine.edit("Unsupported imported parameter structure",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.smart_filters[0].params=stored;Ok(())}).unwrap();
        std::fs::remove_file(&f.path).unwrap();let before=twin(&f.engine);let request=json!({"layer":id.0,"index":0,"params":{"radius":2}});
        let error=render(f.engine.active().unwrap(),COMMAND,request.clone()).err().unwrap();assert!(error.contains("Stored filter settings must be an object"));
        assert!(super::super::execute_view_command(&mut f.engine,COMMAND,request).unwrap_err().contains("Stored filter settings must be an object"));unchanged(&f.engine,&before);
    }
}

#[test]
fn basic_filter_edit_exact_selected_admission_source_caps_and_preview_limits_are_atomic() {
    let mut f=fixture(16,"filter.blur.gaussianBlur",true,false);let before=twin(&f.engine);
    for request in [json!({"index":0,"params":{}}),json!({"layer":f.id.0,"params":{}}),json!({"layer":null,"index":0,"params":{}}),json!({"layer":f.id.0,"index":null,"params":{}}),json!({"layer":f.id.0,"index":99,"params":{}}),json!({"layer":u64::MAX,"index":0,"params":{}})] {assert!(render(f.engine.active().unwrap(),COMMAND,request).is_err());unchanged(&f.engine,&before);}
    for failure in ["missing","corrupt","oversize","unsafe"] {
        std::fs::write(&f.path,&f.bytes).unwrap();
        if failure=="missing" {std::fs::remove_file(&f.path).unwrap();}else if failure=="corrupt"{std::fs::write(&f.path,b"bad source").unwrap();}else if failure=="oversize"{std::fs::OpenOptions::new().write(true).open(&f.path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();}
        if failure=="unsafe" {let id=f.id;f.engine.edit("Unsafe full stack",|doc,_|{let LayerContent::Smart(object)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};object.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();}
        let before=twin(&f.engine);let request=json!({"layer":f.id.0,"index":0,"params":{"radius":1}});assert!(render(f.engine.active().unwrap(),COMMAND,request.clone()).is_err());assert!(super::super::execute_view_command(&mut f.engine,COMMAND,request).is_err());unchanged(&f.engine,&before);
    }
    let mut large=fixture(16,"filter.blur.boxBlur",true,false);Arc::make_mut(&mut large.engine.active_mut().unwrap().doc).size=photocraft_engine::doc::Size::new(5000,4000);let before=twin(&large.engine);let request=json!({"layer":large.id.0,"index":0,"params":{"radius":2}});assert!(render(large.engine.active().unwrap(),COMMAND,request).err().unwrap().contains("image size"));unchanged(&large.engine,&before);
    let raster=reference(16,"filter.blur.boxBlur",&json!({"radius":1}),false,false,false);let mut engine=Session::new();engine.add_document(raster,None);let request=json!({"layer":engine.active().unwrap().active_layer.unwrap().0,"index":0,"params":{}});assert!(render(engine.active().unwrap(),COMMAND,request).is_err());
}

#[test]
fn basic_filter_edit_private_source_pin_survives_deletion_retires_and_cancel_never_publishes() {
    let _guard = crate::xdesign_photo::feedback_serial();
    let f=fixture(16,"filter.blur.boxBlur",true,true);let before=twin(&f.engine);let request=json!({"layer":f.id.0,"index":1,"params":{"radius":1}});
    let mut private=twin(&f.engine);super::super::linked_replay::prepare_preview(&mut private,COMMAND,&request).unwrap();
    let pin:Weak<Vec<u8>>={let SmartSource::Embedded{bytes,..}=&smart(&private.active().unwrap().doc,f.id).source else{panic!("Missing private source pin")};assert_eq!(bytes.as_slice(),f.bytes);Arc::downgrade(bytes)};
    std::fs::remove_file(&f.path).unwrap();let expected=reference(16,"filter.blur.boxBlur",&json!({"radius":1}),true,false,false);let preview=render(private.active().unwrap(),COMMAND,request.clone()).unwrap();display_matches(&preview.png,&render_view_preview(&expected,&Default::default()).unwrap().png);unchanged(&f.engine,&before);
    drop(private);assert!(pin.upgrade().is_none());assert!(matches!(smart(&f.engine.active().unwrap().doc,f.id).source,SmartSource::Linked{..}));
    let owner=format!("basic-filter-cancel-{}",ulid::Ulid::new());let id=ulid::Ulid::new().to_string();let lease=super::super::preview_requests::acquire(&owner,Some(&id)).unwrap();super::super::preview_requests::cancel(&owner,&id).unwrap();
    let color=super::super::color_views::Snapshot::capture(&f.engine).unwrap();let result=render_controlled_with_color_regions(&owner,"version",f.engine.active().unwrap(),&color,COMMAND,request,None,None,lease.token());assert!(result.err().unwrap().contains("canceled"));unchanged(&f.engine,&before);assert!(lease.token().publish(||Ok(())).is_err());
}

#[test]
fn basic_filter_edit_actual_host_immutable_publish_reopen_keeps_source_and_redo() {
    use super::super::{bundle,publish,restore_with_settings,save_view,PhotoSession,MAX_INPUT_BYTES};
    for depth in [8,16,32] {let mut f=fixture(depth,"filter.sharpen.unsharpMask",false,true);
        f.engine.execute("channel.setVisible",json!({"channel":"composite","visible":true})).unwrap();f.engine.execute("channel.setVisible",json!({"channel":0,"visible":false})).unwrap();
        let before=f.engine.active().unwrap().doc.clone();let view=f.engine.active().unwrap().channel_view.clone();let request=json!({"layer":f.id.0,"index":1,"params":settings("filter.sharpen.unsharpMask")});
        let preview=render(f.engine.active().unwrap(),COMMAND,request.clone()).unwrap();super::super::execute_view_command(&mut f.engine,COMMAND,request).unwrap();let after=f.engine.active().unwrap().doc.clone();display_matches(&preview.png,&render_view_preview(&after,&Default::default()).unwrap().png);
        let root=f.directory.0.join("project");std::fs::create_dir(&root).unwrap();let mut session=PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();
        publish(&root,&photo,&mut session).unwrap();let old=root.join(format!("{}.pcraft",session.version));let bytes=bundle::portable_bytes(&old,MAX_INPUT_BYTES as usize).unwrap();
        session.engine.execute("edit.undo",json!({})).unwrap();assert!(Arc::ptr_eq(&session.engine.active().unwrap().doc,&before));publish(&root,&photo,&mut session).unwrap();save_view(&root,&session).unwrap();
        let mut reopened=restore_with_settings(&root,&session.version,None,false).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(reopened.engine.active().unwrap().channel_view,view);assert!(reopened.engine.active().unwrap().history.can_redo());reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);
        assert_eq!(bundle::portable_bytes(&old,MAX_INPUT_BYTES as usize).unwrap(),bytes);assert_eq!(smart(&after,f.id).source,smart(&before,f.id).source);
    }
}
