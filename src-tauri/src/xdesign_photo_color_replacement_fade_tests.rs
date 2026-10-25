use super::*;
use photocraft_engine::{doc::{PixelFormat, SampleType}, DocState};
use std::sync::Arc;

const COMMAND:&str="paint.colorReplacement";
fn run(engine:&mut Session,command:&str,params:Value)->Result<Value,String>{super::super::execute_view_command(engine,command,params)}
fn twin(engine:&Session)->Session {
    let mut copy=Session::new();copy.add_document((*engine.active().unwrap().doc).clone(),None);
    *copy.active_mut().unwrap()=engine.active().unwrap().clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.journal=engine.journal.clone();copy.edit_state=engine.edit_state.clone();copy
}
fn pixels(document:&Document,layer:LayerId)->&Surface {document.layer(layer).unwrap().surface().unwrap()}
fn fixture(depth:u32,view:&str,inactive:bool)->(Session,LayerId,Value) {
    let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":28,"depth":depth,"background":"#804020"})).unwrap();let layer=engine.active().unwrap().active_layer.unwrap();
    engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("channel.new",json!({"name":"Unrelated alpha"})).unwrap();
    engine.edit("Known replacement pixels",|document,_| {
        for y in 0..28 {for x in 0..32 {let value=0.1+((x*13+y*7+x*y*5)%23) as f32/30.0;document.layer_mut(layer).unwrap().surface_mut().unwrap().write_pixel(x,y,&[value,0.12+value*0.4,0.7-value*0.3,1.0]);}}
        document.layer_mut(layer).unwrap().mask.as_mut().unwrap().surface.write_pixel(-2,3,&[0.4]);let bounds=document.bounds();document.channels[0].surface.fill_rect(bounds,&[0.35]);
        let mut selection=Surface::with_default(PixelFormat::GRAY8,&[0.7]);selection.write_pixel(12,14,&[0.3]);selection.write_pixel(18,16,&[1.0]);document.selection=Some(selection);Ok(())
    }).unwrap();
    if inactive {engine.execute("layer.new.layer",json!({"name":"Unrelated active layer"})).unwrap();engine.execute("layer.layerMask.revealAll",json!({})).unwrap();}
    match view {
        "alpha"=>{engine.execute("channel.target",json!({"channel":0})).unwrap();},
        "quickMask"=>{engine.execute("channel.target",json!({"channel":"composite"})).unwrap();engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},
        "mask"=>{engine.execute("channel.target",json!({"channel":"composite"})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},
        _=>unreachable!(),
    }
    let params=json!({"layer":layer.0,"points":[[12,14,0.6],[18,16,0.8],[23,14,0.7]],"size":7,"opacity":0.65,"hardness":0.55,"flow":0.75,"color":"#e01080","tolerance":100,"limits":"discontiguous","sampling":"continuous","seed":5913,"__xdesignChannelFade":{"document":"forged","revision":999,"label":"forged"}});
    (engine,layer,params)
}
fn paint(engine:&mut Session,command:&str,params:&Value,cached:bool) {
    let mut expected=twin(engine);let mut executed=params.clone();let context=prepare_paint_fade(&expected,command,&mut executed);let native=expected.execute(command,executed).unwrap();finish_paint_fade(&mut expected,context);
    let result=if cached {
        let identity=format!("replacement-fade-{}",ulid::Ulid::new());let before=engine.active().unwrap().doc.clone();super::super::stroke::render_with_identity(engine,Some(&identity),command,params,0,0,32,28,1).unwrap();assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));let result=super::super::stroke::commit_feedback(engine,&identity,command,params).unwrap().unwrap();assert_eq!(engine.jobs_with_recent().last().unwrap().state,"done");super::super::stroke::release(&identity,5913).unwrap();result
    }else{run(engine,command,params.clone()).unwrap()};
    let actual=engine.active().unwrap();let reference=expected.active().unwrap();assert_eq!(result,native);assert_eq!(actual.doc,reference.doc);assert_eq!(actual.history.entries(),reference.history.entries());assert_eq!(actual.history.redo_labels().collect::<Vec<_>>(),reference.history.redo_labels().collect::<Vec<_>>());assert_eq!(actual.revision,reference.revision);assert_eq!(actual.saved_revision,reference.saved_revision);assert_eq!(actual.coalesce,reference.coalesce);assert_eq!(actual.last_damage,reference.last_damage);assert_eq!(actual.active_layer,reference.active_layer);assert_eq!(actual.selected_layers,reference.selected_layers);assert_eq!(actual.channel_view,reference.channel_view);assert_eq!(engine.tools.brush,expected.tools.brush);assert_eq!(engine.presets.clone,expected.presets.clone);assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),serde_json::to_value(&expected.tools.mixer).unwrap());assert_eq!(engine.journal,expected.journal);assert_eq!(engine.edit_state.fade,expected.edit_state.fade);assert!(!engine.has_jobs());
}
fn endpoints(engine:&Session,before:&DocState,undo:&Arc<Document>,layer:LayerId) {
    let area=Rect::from_xywh(-3,-2,40,34);let original=pixels(&before.doc,layer).read_region(area);let painted=engine.active().unwrap().doc.clone();let after=pixels(&painted,layer).read_region(area);
    for opacity in [0.0,50.0,100.0] {
        let mut faded=twin(engine);run(&mut faded,"edit.fade",json!({"opacity":opacity,"mode":"normal"})).unwrap();let state=faded.active().unwrap();let surface=pixels(&state.doc,layer);let tolerance=match surface.format().sample {SampleType::U8=>1.01/255.0,SampleType::U16=>1.01/65535.0,SampleType::F32=>0.000001};
        for(index,((before,after),actual))in original.iter().zip(&after).zip(surface.read_region(area)).enumerate() {let expected=before+(after-before)*(opacity as f32/100.0);assert!((actual-expected).abs()<=tolerance,"raw replacement Fade/{opacity}/{index}: {actual} vs {expected}");}
        let mut restored=(*state.doc).clone();*restored.layer_mut(layer).unwrap().surface_mut().unwrap()=pixels(&before.doc,layer).clone();assert_eq!(&restored,before.doc.as_ref());assert_eq!(state.active_layer,before.active_layer);assert_eq!(state.selected_layers,before.selected_layers);assert_eq!(state.channel_view,before.channel_view);
        run(&mut faded,"edit.undo",json!({})).unwrap();assert_eq!(faded.active().unwrap().doc,painted);run(&mut faded,"edit.undo",json!({})).unwrap();assert_eq!(&faded.active().unwrap().doc,undo);run(&mut faded,"edit.redo",json!({})).unwrap();assert_eq!(faded.active().unwrap().doc,painted);
    }
}

#[test]
fn color_replacement_fades_actual_inactive_pixels_at_three_depths_despite_coverage_targets() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for depth in [8,16,32] {for view in ["alpha","quickMask","mask"] {for explicit in [false,true] {for cached in [false,true] {
        let(mut engine,layer,mut params)=fixture(depth,view,true);if explicit {params["target"]=match view {"alpha"=>json!({"channel":0}),"quickMask"=>json!("quickMask"),_=>json!("mask")};}let before=engine.active().unwrap().clone();let journal=engine.journal.len();paint(&mut engine,COMMAND,&params,cached);let state=engine.active().unwrap();assert_ne!(pixels(&state.doc,layer).read_region(state.doc.bounds()),pixels(&before.doc,layer).read_region(before.doc.bounds()));let fade=engine.edit_state.fade.as_ref().unwrap();assert_eq!(fade.layer,layer);assert!(!fade.mask);assert_eq!(Some(fade.label.as_str()),state.history.undo_label());assert_eq!(state.history.past_len(),before.history.past_len()+1);assert_eq!(engine.journal.len(),journal+1);assert!(engine.journal.last().unwrap().1.get(FADE_MARKER).is_none());assert!(!can_fade(&engine));assert!(engine.is_enabled("edit.fade"));endpoints(&engine,&before,&before.doc,layer);
    }}}}
}

#[test]
fn color_replacement_grouped_after_mask_brush_retains_first_label_and_other_planes() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for depth in [8,16,32] {for cached in [false,true] {
        let(mut engine,layer,mut params)=fixture(depth,"alpha",true);let start=engine.active().unwrap().clone();let mut first=params.clone();first["target"]=json!("mask");first["coalesce"]=json!("mask then replacement");paint(&mut engine,"paint.stroke",&first,cached);let before=engine.active().unwrap().clone();let label=before.history.undo_label().unwrap().to_owned();assert_ne!(before.doc.layer(layer).unwrap().mask,start.doc.layer(layer).unwrap().mask);params["coalesce"]=json!("mask then replacement");params["target"]=json!({"channel":0});paint(&mut engine,COMMAND,&params,cached);let state=engine.active().unwrap();assert_eq!(state.history.past_len(),start.history.past_len()+1);let fade=engine.edit_state.fade.as_ref().unwrap();assert_eq!(fade.layer,layer);assert!(!fade.mask);assert_eq!(fade.label,label);endpoints(&engine,&before,&start.doc,layer);
    }}
}

#[test]
fn color_replacement_active_layer_fallback_preserves_exact_native_journal_and_fade() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for view in ["alpha","quickMask","mask"] {for layer_param in [None,Some(Value::Null),Some(json!("invalid")),Some(json!(-1))] {for cached in [false,true] {
        let(mut engine,layer,mut params)=fixture(16,view,false);match &layer_param {Some(value)=>params["layer"]=value.clone(),None=>{params.as_object_mut().unwrap().remove("layer");}}params["target"]=json!("mask");let mut expected=twin(&engine);let mut sanitized=params.clone();sanitized.as_object_mut().unwrap().remove(FADE_MARKER);expected.execute(COMMAND,sanitized).unwrap();paint(&mut engine,COMMAND,&params,cached);assert_eq!(engine.journal,expected.journal);assert_eq!(engine.edit_state.fade,expected.edit_state.fade);assert_eq!(engine.edit_state.fade.as_ref().unwrap().layer,layer);assert!(!engine.edit_state.fade.as_ref().unwrap().mask);
    }}}
}

#[test]
fn color_replacement_errors_stale_context_and_identity_edits_preserve_native_semantics() {
    let _guard = crate::xdesign_photo::feedback_serial();
    for cached in [false,true] {
        let(mut engine,layer,params)=fixture(16,"alpha",true);paint(&mut engine,COMMAND,&params,cached);
        for (key,value) in [("points",json!([])),("mode",json!("unknown")),("layer",json!(u64::MAX))] {
            let mut invalid=params.clone();invalid[key]=value;let before=engine.active().unwrap().clone();let journal=engine.journal.clone();let fade=engine.edit_state.fade.clone();assert!(run(&mut engine,COMMAND,invalid.clone()).is_err());assert!(super::super::stroke::render_with_identity(&engine,Some("replacement-refusal"),COMMAND,&invalid,0,0,32,28,1).is_err());assert!(Arc::ptr_eq(&before.doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().revision,before.revision);assert_eq!(engine.active().unwrap().history.entries(),before.history.entries());assert_eq!(engine.journal,journal);assert_eq!(engine.edit_state.fade,fade);
        }
        let mut pending=params.clone();let context=prepare_paint_fade(&engine,COMMAND,&mut pending);run(&mut engine,"edit.undo",json!({})).unwrap();let fade=engine.edit_state.fade.clone();let journal=engine.journal.clone();finish_paint_fade(&mut engine,context);assert_eq!(engine.edit_state.fade,fade);assert_eq!(engine.journal,journal);assert!(!engine.is_enabled("edit.fade"));assert!(run(&mut engine,"edit.fade",json!({"opacity":50})).is_err());
        engine.edit("Empty painting selection",|doc,_|{doc.selection=Some(Surface::new(PixelFormat::GRAY8));Ok(())}).unwrap();let before=engine.active().unwrap().clone();paint(&mut engine,COMMAND,&params,cached);assert_eq!(pixels(&engine.active().unwrap().doc,layer).read_region(before.doc.bounds()),pixels(&before.doc,layer).read_region(before.doc.bounds()));assert_eq!(engine.active().unwrap().history.past_len(),before.history.past_len()+1);assert_eq!(engine.edit_state.fade.as_ref().unwrap().layer,layer);endpoints(&engine,&before,&before.doc,layer);
    }
}
