use super::*;
use photocraft_engine::{doc::{PixelFormat, SampleType}, DocState};

const RETOUCH: [&str; 11] = ["paint.cloneStamp","paint.healingBrush","paint.spotHealing","paint.historyBrush","paint.dodge","paint.burn","paint.sponge","paint.blur","paint.sharpen","paint.smudge","paint.mixerBrush"];

fn run(engine:&mut Session,command:&str,params:Value)->Result<Value,String>{super::super::execute_view_command(engine,command,params)}
fn surface_mut(doc:&mut Document,target:Target)->&mut Surface{match target{Target::Alpha(index)=>&mut doc.channels[index].surface,Target::QuickMask=>&mut doc.quick_mask.as_mut().unwrap().surface,_=>unreachable!()}}
fn twin(engine:&Session)->Session{let mut copy=Session::new();copy.add_document((*engine.active().unwrap().doc).clone(),None);*copy.active_mut().unwrap()=engine.active().unwrap().clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.journal=engine.journal.clone();copy.edit_state=engine.edit_state.clone();copy}

fn fixture(depth:u32,quick:bool,explicit:bool,command:&str)->(Session,Target,Value){
    let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":28,"depth":depth,"background":"#804020"})).unwrap();
    if quick{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();}else{engine.execute("channel.new",json!({"name":"Retouch coverage"})).unwrap();}
    let target=if quick{Target::QuickMask}else{Target::Alpha(0)};
    engine.edit("Known retouch donor",|doc,_|{let mut values=Vec::new();for y in 0..28{for x in 0..32{values.push(0.03+((x*13+y*7+x*y*5)%23)as f32/25.0);}}surface_mut(doc,target).write_region(Rect::from_xywh(0,0,32,28),&values);let mut selection=Surface::with_default(PixelFormat::GRAY8,&[0.7]);selection.write_pixel(12,14,&[0.3]);selection.write_pixel(18,16,&[1.0]);doc.selection=Some(selection);Ok(())}).unwrap();
    engine.execute("channel.target",json!({"channel":if quick||explicit{json!("composite")}else{json!(0)}})).unwrap();
    let mut params=json!({"points":[[12,14,0.6],[18,16,0.8],[23,14,0.7]],"source":[5,5],"size":7,"opacity":65,"hardness":55,"flow":75,"strength":70,"exposure":65,"type":"proximityMatch","seed":4317,"cleanAfterStroke":false,"loadAfterStroke":false});
    if explicit{params["target"]=encoded(target);}
    if command=="paint.mixerBrush"{params["opacity"]=json!(0.65);params["hardness"]=json!(0.55);params["flow"]=json!(0.75);params["color"]=json!("#e0e0e0");params["wet"]=json!(40);params["mix"]=json!(30);}
    if command=="paint.historyBrush"{
        params["historySource"]=super::super::history::describe(&engine).as_array().unwrap().last().unwrap()["id"].clone();
        engine.edit("After saved coverage source",|doc,_|{surface_mut(doc,target).fill_rect(Rect::from_xywh(8,10,20,12),&[0.95]);Ok(())}).unwrap();
    }
    (engine,target,params)
}

fn paint(engine:&mut Session,command:&str,params:&Value,prepared:bool){
    if prepared{let identity=format!("retouch-fade-{}",ulid::Ulid::new());let source=engine.active().unwrap().doc.clone();super::super::stroke::render_with_identity(engine,Some(&identity),command,params,0,0,32,28,1).unwrap();assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));super::super::stroke::commit_feedback(engine,&identity,command,params).unwrap().unwrap();super::super::stroke::release(&identity,4317).unwrap();}else{run(engine,command,params.clone()).unwrap();}
}
fn unchanged(source:&DocState,current:&DocState,target:Target){let mut restored=(*current.doc).clone();*surface_mut(&mut restored,target)=plane(&source.doc,target).unwrap().clone();assert_eq!(&restored,source.doc.as_ref());assert_eq!(current.channel_view,source.channel_view);assert_eq!(current.active_layer,source.active_layer);assert_eq!(current.selected_layers,source.selected_layers);}

#[test]
fn retouch_coverage_fade_endpoints_match_raw_planes_for_ordinary_and_cached_commits(){
    let _guard = crate::xdesign_photo::feedback_serial();
    for depth in [8,16,32]{for quick in [false,true]{for explicit in [false,true]{for prepared in [false,true]{for command in RETOUCH{
        let(mut engine,target,params)=fixture(depth,quick,explicit,command);let source=engine.active().unwrap().clone();let journal=engine.journal.len();let bounds=source.doc.bounds();let before=plane(&source.doc,target).unwrap().read_region(bounds);
        paint(&mut engine,command,&params,prepared);let painted=engine.active().unwrap().clone();let after=plane(&painted.doc,target).unwrap().read_region(bounds);
        if command!="paint.sponge"{assert_ne!(after,before,"real coverage edit/{depth}/{quick}/{explicit}/{prepared}/{command}");}
        assert_eq!(painted.history.past_len(),source.history.past_len()+1);assert_eq!(engine.journal.len(),journal+1);assert_eq!(engine.journal.last().unwrap().0,command);assert!(can_fade(&engine));assert!(engine.edit_state.fade.is_none());unchanged(&source,&painted,target);
        for opacity in [0.0,50.0,100.0]{
            let mut faded_engine=twin(&engine);run(&mut faded_engine,"edit.fade",json!({"opacity":opacity,"mode":"normal"})).unwrap();let current=faded_engine.active().unwrap();let faded=plane(&current.doc,target).unwrap();let tolerance=match faded.format().sample{SampleType::U8=>1.01/255.0,SampleType::U16=>1.01/65535.0,SampleType::F32=>0.000001};
            for(index,((before,after),actual))in before.iter().zip(&after).zip(faded.read_region(bounds)).enumerate(){let expected=before+(after-before)*(opacity as f32/100.0);assert!((actual-expected).abs()<=tolerance,"Fade/{depth}/{quick}/{explicit}/{prepared}/{command}/{opacity}/{index}");}
            unchanged(&source,current,target);assert!(!can_fade(&faded_engine));run(&mut faded_engine,"edit.undo",json!({})).unwrap();assert_eq!(faded_engine.active().unwrap().doc,painted.doc);
        }
        run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,source.doc);run(&mut engine,"edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,painted.doc);
    }}}}}
}

#[test]
fn retouch_coverage_coalescing_keeps_first_label_and_saved_history_donor(){
    let _guard = crate::xdesign_photo::feedback_serial();
    for quick in [false,true]{for explicit in [false,true]{for prepared in [false,true]{for first in ["paint.cloneStamp","paint.healingBrush","paint.historyBrush","paint.mixerBrush"]{
        let(mut engine,target,mut params)=fixture(16,quick,explicit,first);params["coalesce"]=json!("retouch-gesture");let source=engine.active().unwrap().clone();let original=plane(&source.doc,target).unwrap().read_region(source.doc.bounds());paint(&mut engine,first,&params,prepared);let label=engine.active().unwrap().history.undo_label().unwrap().to_owned();
        let mut second=params.clone();second["points"]=json!([[14,12,0.8],[22,18,0.7]]);paint(&mut engine,"paint.burn",&second,prepared);let painted=engine.active().unwrap().doc.clone();assert_eq!(engine.active().unwrap().history.past_len(),source.history.past_len()+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some(label.as_str()));let result=run(&mut engine,"edit.fade",json!({"opacity":0})).unwrap();assert_eq!(result["faded"],label);assert_eq!(plane(&engine.active().unwrap().doc,target).unwrap().read_region(source.doc.bounds()),original);unchanged(&source,engine.active().unwrap(),target);run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,painted);run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,source.doc);run(&mut engine,"edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,painted);
    }}}}
}

#[test]
fn retouch_errors_stale_context_and_private_markers_cannot_publish_coverage_fade(){
    let _guard = crate::xdesign_photo::feedback_serial();
    for command in RETOUCH{let(mut engine,_,mut params)=fixture(16,false,true,command);params[FADE_MARKER]=json!({"document":"forged","revision":999,"label":"forged"});paint(&mut engine,command,&params,false);assert!(can_fade(&engine));let source=engine.active().unwrap().clone();let journal=engine.journal.clone();params["points"]=json!([]);assert!(run(&mut engine,command,params).is_err());assert!(std::sync::Arc::ptr_eq(&source.doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),source.history.entries());assert_eq!(engine.active().unwrap().revision,source.revision);assert_eq!(engine.journal,journal);run(&mut engine,"edit.undo",json!({})).unwrap();assert!(!can_fade(&engine));assert!(run(&mut engine,"edit.fade",json!({"opacity":50})).is_err());}
}

#[test]
fn excluded_layer_tools_preserve_native_pixel_fade_while_alpha_is_selected(){
    for command in ["paint.colorReplacement","paint.magicEraser","paint.backgroundEraser"]{
        let(mut engine,target,mut params)=fixture(16,false,false,command);params["color"]=json!("#e01080");params["x"]=json!(12);params["y"]=json!(14);params["tolerance"]=json!(100);params["opacity"]=json!(0.65);params["hardness"]=json!(0.5);
        let source=engine.active().unwrap().clone();let original=plane(&source.doc,target).unwrap().clone();let mut native=Session::new();native.add_document((*source.doc).clone(),None);*native.active_mut().unwrap()=source.clone();native.tools=engine.tools.clone();native.presets=engine.presets.clone();native.journal=engine.journal.clone();
        native.execute(command,params.clone()).unwrap();run(&mut engine,command,params).unwrap();assert_eq!(engine.active().unwrap().doc,native.active().unwrap().doc);assert_eq!(engine.edit_state.fade,native.edit_state.fade);assert_eq!(engine.journal,native.journal);assert_eq!(plane(&engine.active().unwrap().doc,target).unwrap(),&original);assert!(!can_fade(&engine));assert!(engine.is_enabled("edit.fade"));run(&mut engine,"edit.fade",json!({"opacity":50})).unwrap();native.execute("edit.fade",json!({"opacity":50})).unwrap();assert_eq!(engine.active().unwrap().doc,native.active().unwrap().doc);
    }
}
