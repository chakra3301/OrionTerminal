use super::*;
use photocraft_engine::{doc::{PixelFormat, SampleType}, DocState};
use std::sync::Arc;

#[derive(Clone, Copy)]
enum Plane { Pixels(LayerId), Mask(LayerId) }
impl Plane {
    fn layer(self) -> LayerId { match self { Self::Pixels(id) | Self::Mask(id) => id } }
    fn mask(self) -> bool { matches!(self, Self::Mask(_)) }
    fn parameter(self) -> Value { json!(if self.mask() { "mask" } else { "pixels" }) }
    fn surface(self, document: &Document) -> &Surface {
        let layer=document.layer(self.layer()).unwrap();
        match self { Self::Pixels(_) => layer.surface().unwrap(), Self::Mask(_) => &layer.mask.as_ref().unwrap().surface }
    }
    fn surface_mut(self, document: &mut Document) -> &mut Surface {
        let layer=document.layer_mut(self.layer()).unwrap();
        match self { Self::Pixels(_) => layer.surface_mut().unwrap(), Self::Mask(_) => &mut layer.mask.as_mut().unwrap().surface }
    }
}
fn run(engine:&mut Session,command:&str,params:Value)->Result<Value,String>{super::super::execute_view_command(engine,command,params)}
fn twin(engine:&Session)->Session {
    let mut copy=Session::new();copy.add_document((*engine.active().unwrap().doc).clone(),None);
    *copy.active_mut().unwrap()=engine.active().unwrap().clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.journal=engine.journal.clone();copy.edit_state=engine.edit_state.clone();copy
}
fn fixture(depth:u32,mask:bool,inactive:bool,command:&str)->(Session,Plane,Value) {
    let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":28,"depth":depth,"background":"#804020"})).unwrap();
    let id=engine.active().unwrap().active_layer.unwrap();let target=if mask {Plane::Mask(id)} else {Plane::Pixels(id)};
    engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("channel.new",json!({"name":"Unrelated alpha"})).unwrap();
    engine.edit("Known layer and mask donors",|document,_| {
        let format=PixelFormat{sample:document.depth,..PixelFormat::GRAY8};
        let mut coverage=Surface::with_default(format,&[1.0]);
        for y in 0..28 {for x in 0..32 {let value=0.04+((x*13+y*7+x*y*5)%23) as f32/25.0;document.layer_mut(id).unwrap().surface_mut().unwrap().write_pixel(x,y,&[value,0.15+value*0.5,0.9-value*0.5,1.0]);coverage.write_pixel(x,y,&[1.0-value]);}}
        coverage.write_pixel(-2,3,&[0.4]);document.layer_mut(id).unwrap().mask.as_mut().unwrap().surface=coverage;
        let mut selection=Surface::with_default(PixelFormat::GRAY8,&[0.7]);selection.write_pixel(12,14,&[0.3]);selection.write_pixel(18,16,&[1.0]);document.selection=Some(selection);Ok(())
    }).unwrap();
    if inactive {engine.execute("layer.new.layer",json!({"name":"Unrelated active layer"})).unwrap();}
    engine.execute("channel.target",json!({"channel":0})).unwrap();
    let mut params=json!({"layer":id.0,"target":target.parameter(),"points":[[12,14,0.6],[18,16,0.8],[23,14,0.7]],"source":[5,5],"size":7,"opacity":65,"hardness":55,"flow":75,"strength":70,"exposure":65,"type":"proximityMatch","seed":7923,"cleanAfterStroke":false,"loadAfterStroke":false,"__xdesignChannelFade":{"document":"forged","revision":999,"label":"forged"}});
    if matches!(command,"paint.stroke"|"paint.pencil"|"paint.mixerBrush") {params["opacity"]=json!(0.65);params["hardness"]=json!(0.55);params["flow"]=json!(0.75);params["color"]=json!("#e01080");}
    if command=="paint.mixerBrush" {params["wet"]=json!(40);params["mix"]=json!(30);}
    if command=="paint.historyBrush" {
        params["historySource"]=super::super::history::describe(&engine).as_array().unwrap().last().unwrap()["id"].clone();
        engine.edit("Damage after saved layer source",|document,_| {let surface=target.surface_mut(document);let pixel=if mask {vec![0.95]} else {vec![0.95,0.95,0.95,1.0]};surface.fill_rect(Rect::from_xywh(8,10,20,12),&pixel);Ok(())}).unwrap();
    }
    (engine,target,params)
}

fn paint(engine:&mut Session,command:&str,params:&Value,cached:bool) {
    let mut expected=twin(engine);let mut native_params=super::super::history::normalize(&expected,command,params.clone()).unwrap();let context=prepare_paint_fade(&expected,command,&mut native_params);
    let native=expected.execute(command,native_params).unwrap();finish_paint_fade(&mut expected,context);
    let result=if cached {let identity=format!("layer-fade-{}",ulid::Ulid::new());let source=engine.active().unwrap().doc.clone();super::super::stroke::render_with_identity(engine,Some(&identity),command,params,0,0,32,28,1).unwrap();assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));let result=super::super::stroke::commit_feedback(engine,&identity,command,params).unwrap().unwrap();assert_eq!(engine.jobs_with_recent().last().unwrap().state,"done");super::super::stroke::release(&identity,7923).unwrap();result} else {run(engine,command,params.clone()).unwrap()};
    assert_eq!(result,native);let actual=engine.active().unwrap();let reference=expected.active().unwrap();
    assert_eq!(actual.doc,reference.doc);assert_eq!(actual.history.entries(),reference.history.entries());assert_eq!(actual.revision,reference.revision);assert_eq!(actual.saved_revision,reference.saved_revision);assert_eq!(actual.coalesce,reference.coalesce);assert_eq!(actual.last_damage,reference.last_damage);assert_eq!(actual.active_layer,reference.active_layer);assert_eq!(actual.selected_layers,reference.selected_layers);assert_eq!(actual.channel_view,reference.channel_view);assert_eq!(engine.tools.brush,expected.tools.brush);assert_eq!(engine.presets.clone,expected.presets.clone);assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),serde_json::to_value(&expected.tools.mixer).unwrap());assert_eq!(engine.journal,expected.journal);assert_eq!(engine.edit_state.fade,expected.edit_state.fade);assert!(!engine.has_jobs());
}

fn endpoints(engine:&Session,before:&DocState,undo:&Arc<Document>,target:Plane) {
    let area=Rect::from_xywh(-3,-2,40,34);let original=target.surface(&before.doc).read_region(area);let painted=engine.active().unwrap().doc.clone();let after=target.surface(&painted).read_region(area);
    for opacity in [0.0,50.0,100.0] {
        let mut faded=twin(engine);run(&mut faded,"edit.fade",json!({"opacity":opacity,"mode":"normal"})).unwrap();
        let state=faded.active().unwrap();let surface=target.surface(&state.doc);let tolerance=match surface.format().sample {SampleType::U8=>1.01/255.0,SampleType::U16=>1.01/65535.0,SampleType::F32=>0.000001};
        for(index,((before,after),actual))in original.iter().zip(&after).zip(surface.read_region(area)).enumerate() {let expected=before+(after-before)*(opacity as f32/100.0);assert!((actual-expected).abs()<=tolerance,"raw Fade/{opacity}/{index}: {actual} vs {expected}");}
        let mut restored=(*state.doc).clone();*target.surface_mut(&mut restored)=target.surface(&before.doc).clone();assert_eq!(&restored,before.doc.as_ref());assert_eq!(state.active_layer,before.active_layer);assert_eq!(state.selected_layers,before.selected_layers);assert_eq!(state.channel_view,before.channel_view);
        run(&mut faded,"edit.undo",json!({})).unwrap();assert_eq!(faded.active().unwrap().doc,painted);run(&mut faded,"edit.undo",json!({})).unwrap();assert_eq!(&faded.active().unwrap().doc,undo);run(&mut faded,"edit.redo",json!({})).unwrap();assert_eq!(faded.active().unwrap().doc,painted);
    }
}

#[test]
fn actual_inactive_layer_paint_fade_matches_raw_pixels_and_masks_at_three_depths() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for depth in [8,16,32] {for mask in [false,true] {for cached in [false,true] {for command in PAINT_FADE_COMMANDS {
        let(mut engine,target,params)=fixture(depth,mask,true,command);let before=engine.active().unwrap().clone();let journal=engine.journal.len();paint(&mut engine,command,&params,cached);let state=engine.active().unwrap();let fade=engine.edit_state.fade.as_ref().unwrap();
        assert_eq!(fade.layer,target.layer());assert_eq!(fade.mask,mask);assert_eq!(fade.label,state.history.undo_label().unwrap());assert_eq!(state.history.past_len(),before.history.past_len()+1);assert_eq!(engine.journal.len(),journal+1);assert!(engine.journal.last().unwrap().1.get(FADE_MARKER).is_none());assert!(engine.is_enabled("edit.fade"));
        if !(mask&&command=="paint.sponge") {assert_ne!(target.surface(&state.doc).read_region(state.doc.bounds()),target.surface(&before.doc).read_region(before.doc.bounds()),"actual layer edit/{depth}/{mask}/{cached}/{command}");}
        endpoints(&engine,&before,&before.doc,target);
    }}}}
}

#[test]
fn grouped_pixel_then_mask_tools_fade_latest_plane_from_gesture_start() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for depth in [8,16,32] {for inactive in [false,true] {for cached in [false,true] {for command in PAINT_FADE_COMMANDS {
        let(mut engine,target,mut params)=fixture(depth,true,inactive,command);let start=engine.active().unwrap().clone();let mut first=params.clone();first["target"]=json!("pixels");first["opacity"]=json!(0.65);first["hardness"]=json!(0.55);first["flow"]=json!(0.75);first["color"]=json!("#e01080");first["coalesce"]=json!("layer-transition");first.as_object_mut().unwrap().remove("historySource");
        paint(&mut engine,"paint.stroke",&first,cached);let before_mask=engine.active().unwrap().clone();let label=before_mask.history.undo_label().unwrap().to_owned();assert_ne!(before_mask.doc.layer(target.layer()).unwrap().surface(),start.doc.layer(target.layer()).unwrap().surface());
        params["coalesce"]=json!("layer-transition");paint(&mut engine,command,&params,cached);let state=engine.active().unwrap();assert_eq!(state.history.past_len(),start.history.past_len()+1);let fade=engine.edit_state.fade.as_ref().unwrap();assert_eq!(fade.layer,target.layer());assert!(fade.mask);assert_eq!(fade.label,label);endpoints(&engine,&before_mask,&start.doc,target);
    }}}}
}

#[test]
fn layer_paint_errors_stale_context_and_identity_mask_edits_keep_correct_fade() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for command in PAINT_FADE_COMMANDS {let(mut engine,target,params)=fixture(16,true,true,command);paint(&mut engine,command,&params,false);let before=engine.active().unwrap().clone();let journal=engine.journal.clone();let fade=engine.edit_state.fade.clone();let mut invalid=params;invalid["points"]=json!([]);assert!(run(&mut engine,command,invalid).is_err());assert!(Arc::ptr_eq(&before.doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().revision,before.revision);assert_eq!(engine.active().unwrap().history.entries(),before.history.entries());assert_eq!(engine.journal,journal);assert_eq!(engine.edit_state.fade,fade);assert_eq!(engine.edit_state.fade.as_ref().unwrap().layer,target.layer());run(&mut engine,"edit.undo",json!({})).unwrap();assert!(!engine.is_enabled("edit.fade"));assert!(run(&mut engine,"edit.fade",json!({"opacity":50})).is_err());}
    for cached in [false,true] {let(mut engine,target,params)=fixture(32,true,true,"paint.sponge");engine.edit("Exact zero-saturation coverage",|document,_|{let format=target.surface(document).format();*target.surface_mut(document)=Surface::new(format);Ok(())}).unwrap();let before=engine.active().unwrap().clone();paint(&mut engine,"paint.sponge",&params,cached);assert_eq!(target.surface(&engine.active().unwrap().doc).read_region(before.doc.bounds()),target.surface(&before.doc).read_region(before.doc.bounds()));assert_eq!(engine.active().unwrap().history.past_len(),before.history.past_len()+1);assert!(engine.edit_state.fade.as_ref().unwrap().mask);endpoints(&engine,&before,&before.doc,target);}
}

#[test]
fn native_nonnumeric_layer_fallback_keeps_grouped_mask_fade_on_actual_active_layer() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for command in ["paint.stroke","paint.cloneStamp","paint.mixerBrush"] {for layer in [Value::Null,json!("not an id"),json!(-1)] {for implicit in [false,true] {for cached in [false,true] {
        let(mut engine,target,mut params)=fixture(16,true,false,command);
        if implicit {engine.execute("channel.target",json!({"channel":"composite"})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();}
        let start=engine.active().unwrap().clone();let mut first=params.clone();first["target"]=json!("pixels");first["opacity"]=json!(0.65);first["hardness"]=json!(0.55);first["flow"]=json!(0.75);first["color"]=json!("#e01080");first["coalesce"]=json!("fallback layer group");
        paint(&mut engine,"paint.stroke",&first,cached);let before_mask=engine.active().unwrap().clone();params["layer"]=layer.clone();params["coalesce"]=json!("fallback layer group");if implicit {params.as_object_mut().unwrap().remove("target");}
        paint(&mut engine,command,&params,cached);let state=engine.active().unwrap();let fade=engine.edit_state.fade.as_ref().unwrap();assert_eq!(state.history.past_len(),start.history.past_len()+1);assert_eq!(fade.layer,target.layer());assert!(fade.mask);assert_eq!(Some(fade.label.as_str()),before_mask.history.undo_label());endpoints(&engine,&before_mask,&start.doc,target);
    }}}}
}

#[test]
fn native_unknown_explicit_targets_edit_inactive_pixels_and_preserve_correct_fallback_journal() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for command in ["paint.stroke","paint.cloneStamp","paint.mixerBrush"] {for malformed in [Value::Null,json!("unknown target"),json!({"channel":"invalid"})] {for cached in [false,true] {
        let(mut engine,target,mut params)=fixture(16,false,true,command);params["target"]=malformed.clone();let before=engine.active().unwrap().clone();paint(&mut engine,command,&params,cached);assert_eq!(engine.edit_state.fade.as_ref().unwrap().layer,target.layer());assert!(!engine.edit_state.fade.as_ref().unwrap().mask);endpoints(&engine,&before,&before.doc,target);
        let(mut active,_,mut active_params)=fixture(16,false,false,command);active_params["target"]=malformed.clone();active_params["layer"]=Value::Null;let mut native=twin(&active);let mut executed=active_params.clone();let context=prepare_paint_fade(&native,command,&mut executed);native.execute(command,executed).unwrap();let journal=native.journal.clone();let fade=native.edit_state.fade.clone();finish_paint_fade(&mut native,context);assert_eq!(native.journal,journal);assert_eq!(native.edit_state.fade,fade);paint(&mut active,command,&active_params,cached);assert_eq!(active.journal,journal);assert_eq!(active.edit_state.fade,fade);
    }}}
}

#[test]
fn native_numeric_missing_layer_still_refuses_without_fallback() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for command in ["paint.stroke","paint.cloneStamp","paint.mixerBrush"] {for mask in [false,true] {
        let(mut engine,_,mut params)=fixture(16,mask,false,command);params["layer"]=json!(u64::MAX);let before=engine.active().unwrap().clone();let journal=engine.journal.clone();let fade=engine.edit_state.fade.clone();let mut invocation=params.clone();assert!(prepare_paint_fade(&engine,command,&mut invocation).is_none());assert!(run(&mut engine,command,params.clone()).is_err());assert!(super::super::stroke::render_with_identity(&engine,Some("missing-layer-refusal"),command,&params,0,0,32,28,1).is_err());assert!(Arc::ptr_eq(&before.doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().revision,before.revision);assert_eq!(engine.active().unwrap().history.entries(),before.history.entries());assert_eq!(engine.journal,journal);assert_eq!(engine.edit_state.fade,fade);
    }}
}
