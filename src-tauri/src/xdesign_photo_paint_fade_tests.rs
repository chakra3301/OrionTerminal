use super::*;
use photocraft_engine::doc::{PixelFormat, SampleType};

fn fixture(depth: u32, quick: bool, explicit: bool) -> (Session, Target, Value) {
    let mut engine=Session::new();
    engine.execute("file.new",json!({"width":24,"height":20,"depth":depth,"background":"#4080b0"})).unwrap();
    if quick { engine.execute("select.editInQuickMaskMode",json!({})).unwrap(); }
    else { engine.execute("channel.new",json!({"name":"Painted coverage"})).unwrap(); }
    let target=if quick {Target::QuickMask} else {Target::Alpha(0)};
    engine.edit("Coverage paint fixture",|doc,_| {
        let surface=match target {Target::Alpha(index)=>&mut doc.channels[index].surface,Target::QuickMask=>&mut doc.quick_mask.as_mut().unwrap().surface,_=>unreachable!()};
        let values:Vec<_>=(0..480).map(|index|0.1+(index%13) as f32/20.0).collect();
        surface.write_region(Rect::from_xywh(0,0,24,20),&values);
        let mut selection=Surface::with_default(PixelFormat::GRAY8,&[0.7]); selection.write_pixel(10,10,&[0.3]); doc.selection=Some(selection);
        Ok(())
    }).unwrap();
    engine.execute("channel.target",json!({"channel":if quick||explicit{json!("composite")}else{json!(0)}})).unwrap();
    let mut params=json!({"points":[[8,8,0.7],[14,12,0.8],[18,8,0.6]],"size":7,"hardness":0.7,"opacity":0.65,"color":"#e0e0e0","seed":9723});
    if explicit {params["target"]=if quick{json!("quickMask")}else{json!({"channel":0})};}
    (engine,target,params)
}

fn run(engine:&mut Session,command:&str,params:Value)->Result<Value,String>{super::super::execute_view_command(engine,command,params)}

#[test]
fn ordinary_and_prepared_channel_paint_fade_restore_independent_raw_coverage_at_three_depths(){
    for depth in [8,16,32]{for quick in [false,true]{for explicit in [false,true]{for prepared in [false,true]{for command in ["paint.stroke","paint.pencil"]{for opacity in [0.0,50.0,100.0]{
        let(mut engine,target,params)=fixture(depth,quick,explicit);let source=engine.active().unwrap().clone();let bounds=source.doc.bounds();let original=plane(&source.doc,target).unwrap().read_region(bounds);
        if prepared {
            let identity=format!("coverage-paint-fade-{}",ulid::Ulid::new());
            super::super::stroke::render_with_identity(&engine,Some(&identity),command,&params,0,0,24,20,1).unwrap();
            super::super::stroke::commit_feedback(&mut engine,&identity,command,&params).unwrap().unwrap();
            super::super::stroke::release(&identity,9723).unwrap();
        }else{run(&mut engine,command,params).unwrap();}
        let painted=engine.active().unwrap().doc.clone();let after=plane(&painted,target).unwrap().read_region(bounds);assert_ne!(after,original,"paint must change coverage/{depth}/{quick}/{explicit}/{prepared}/{command}");
        assert!(can_fade(&engine));assert!(engine.edit_state.fade.is_none());assert_eq!(engine.active().unwrap().history.past_len(),source.history.past_len()+1);
        run(&mut engine,"edit.fade",json!({"opacity":opacity,"mode":"normal"})).unwrap();
        let current=engine.active().unwrap();let faded=plane(&current.doc,target).unwrap();let values=faded.read_region(bounds);let tolerance=match faded.format().sample{SampleType::U8=>1.01/255.0,SampleType::U16=>1.01/65535.0,SampleType::F32=>0.000001};
        for(index,((before,after),actual))in original.iter().zip(&after).zip(&values).enumerate(){let expected=before+(after-before)*(opacity as f32/100.0);assert!((actual-expected).abs()<=tolerance,"Fade/{depth}/{quick}/{explicit}/{prepared}/{command}/{opacity}/{index}: {actual} vs {expected}");}
        let mut untouched=(*current.doc).clone();match target{Target::Alpha(index)=>untouched.channels[index].surface=source.doc.channels[index].surface.clone(),Target::QuickMask=>untouched.quick_mask.as_mut().unwrap().surface=source.doc.quick_mask.as_ref().unwrap().surface.clone(),_=>unreachable!()};assert_eq!(&untouched,source.doc.as_ref());assert_eq!(current.channel_view,source.channel_view);assert_eq!(current.active_layer,source.active_layer);assert_eq!(current.selected_layers,source.selected_layers);
        assert!(!can_fade(&engine));run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,painted);run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,source.doc);run(&mut engine,"edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,painted);
    }}}}}}
}

#[test]
fn channel_paint_fade_hooks_require_matching_new_commit_and_strip_caller_markers(){
    for mutation in ["no-journal","wrong-command","no-revision","replaced-document"]{
        let(mut engine,_,mut params)=fixture(8,false,true);params[FADE_MARKER]=json!({"document":"forged","revision":999,"label":"forged"});
        let context=prepare_paint_fade(&engine,"paint.stroke",&mut params);assert!(context.is_some());assert!(params.get(FADE_MARKER).is_none());
        match mutation{
            "wrong-command"=>{engine.execute("paint.pencil",params).unwrap();},
            "no-revision"=>engine.journal.push(("paint.stroke".into(),params)),
            "replaced-document"=>{engine.execute("file.new",json!({"width":24,"height":20})).unwrap();engine.journal.truncate(context.as_ref().unwrap().journal_len);engine.journal.push(("paint.stroke".into(),params));},
            _=>{},
        }
        finish_paint_fade(&mut engine,context);assert!(!can_fade(&engine));assert!(engine.journal.last().unwrap().1.get(FADE_MARKER).is_none());
    }
    let(mut engine,_,mut params)=fixture(8,false,true);params["target"]=json!("pixels");params[FADE_MARKER]=json!({"revision":999});let context=prepare_paint_fade(&engine,"paint.stroke",&mut params);assert!(context.is_some());assert!(params.get(FADE_MARKER).is_none());engine.execute("paint.stroke",params).unwrap();let native=engine.edit_state.fade.clone();let journal=engine.journal.clone();finish_paint_fade(&mut engine,context);assert_eq!(engine.edit_state.fade,native);assert_eq!(engine.journal,journal);assert!(engine.is_enabled("edit.fade"));
    let(mut engine,_,mut params)=fixture(8,false,true);run(&mut engine,"paint.stroke",params.clone()).unwrap();assert!(can_fade(&engine));let context=prepare_paint_fade(&engine,"paint.stroke",&mut params);let state=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:state.doc.id,revision:state.revision,layer:state.active_layer.unwrap(),mask:false,label:state.history.undo_label().unwrap().into()});engine.journal.push(("paint.stroke".into(),params));finish_paint_fade(&mut engine,context);assert!(!can_fade(&engine));assert!(engine.edit_state.fade.is_none());
}

#[test]
fn channel_paint_errors_leave_prior_coverage_fade_history_and_journal_untouched(){
    let(mut engine,_,params)=fixture(16,false,true);run(&mut engine,"paint.stroke",params.clone()).unwrap();assert!(can_fade(&engine));
    let source=engine.active().unwrap().clone();let journal=engine.journal.clone();let fade=engine.edit_state.fade.clone();let mut invalid=params;invalid["points"]=json!("invalid");invalid[FADE_MARKER]=json!({"revision":source.revision});
    assert!(run(&mut engine,"paint.stroke",invalid).is_err());assert!(std::sync::Arc::ptr_eq(&source.doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().revision,source.revision);assert_eq!(engine.active().unwrap().history.entries(),source.history.entries());assert_eq!(engine.journal,journal);assert_eq!(engine.edit_state.fade,fade);assert!(can_fade(&engine));
}

#[test]
fn grouped_channel_paint_fade_restores_gesture_start_for_implicit_and_explicit_targets(){
    for quick in [false,true]{for explicit in [false,true]{for prepared in [false,true]{
        let(mut engine,target,mut params)=fixture(16,quick,explicit);params["coalesce"]=json!("coverage-gesture");let source=engine.active().unwrap().clone();let bounds=source.doc.bounds();let original=plane(&source.doc,target).unwrap().read_region(bounds);let mut label=String::new();
        for(index,command)in ["paint.stroke","paint.pencil"].into_iter().enumerate(){
            if index==1{params["points"]=json!([[6,12,0.8],[18,12,0.7]]);params["color"]=json!("#202020");}
            if prepared{let identity=format!("grouped-coverage-fade-{}",ulid::Ulid::new());super::super::stroke::render_with_identity(&engine,Some(&identity),command,&params,0,0,24,20,1).unwrap();super::super::stroke::commit_feedback(&mut engine,&identity,command,&params).unwrap().unwrap();super::super::stroke::release(&identity,9723).unwrap();}else{run(&mut engine,command,params.clone()).unwrap();}
            let state=engine.active().unwrap();if index==0{label=state.history.undo_label().unwrap().to_owned();}assert_eq!(state.history.past_len(),source.history.past_len()+1);assert_eq!(state.history.undo_label(),Some(label.as_str()));assert!(can_fade(&engine));
        }
        let painted=engine.active().unwrap().doc.clone();let result=run(&mut engine,"edit.fade",json!({"opacity":0})).unwrap();assert_eq!(result["faded"],label);assert_eq!(plane(&engine.active().unwrap().doc,target).unwrap().read_region(bounds),original);run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,painted);run(&mut engine,"edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,source.doc);
    }}}
}
