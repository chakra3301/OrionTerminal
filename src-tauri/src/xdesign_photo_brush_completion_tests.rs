use super::*;
use serde_json::json;

fn fixture(depth: u64, mode: &str) -> Session {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":48,"height":48,"depth":depth,"mode":mode,"background":"#804020"})).unwrap();
    engine.execute("paint.stroke", json!({"points":[[5,8],[38,8],[38,32]],"size":9,"color":"#20b0c0","seed":21})).unwrap();
    engine.execute("select.rect", json!({"x":7,"y":8,"width":32,"height":30,"feather":2})).unwrap();
    engine.tools.brush.smoothing.amount = 0.65;
    engine
}
fn twin(engine: &Session) -> Session {
    let mut expected = Session::new();
    expected.add_document((*engine.active().unwrap().doc).clone(), None);
    *expected.active_mut().unwrap() = engine.active().unwrap().clone();
    expected.tools = engine.tools.clone(); expected.presets = engine.presets.clone();
    expected.patterns = engine.patterns.clone(); expected.journal = engine.journal.clone(); expected.edit_state = engine.edit_state.clone();
    expected
}
fn params() -> Value { json!({"points":[[9,12,0.35,24,-13,30,10,0.2],[18,24,0.8,-10,28,65,35,0.5],[31,15,0.6,20,30,90,70,0.8],[37,32,0.2,0,12,25,100,0.3],[12,35,0.9,11,20,50,130,0.6]],"size":9,"opacity":0.6,"hardness":0.5,"flow":0.55,"color":"#e01080","seed":1337,"zoom":0.8}) }
fn assert_state(engine: &Session, expected: &Session, context: &str) {
    super::tests::assert_prepared_state(engine, expected, context);
    assert_eq!(engine.active().unwrap().history.undo_label(), expected.active().unwrap().history.undo_label(), "label/{context}");
    assert_eq!(engine.tools.brush, expected.tools.brush);
    assert_eq!(engine.tools.brush_gesture, expected.tools.brush_gesture);
    assert_eq!(engine.tools.foreground, expected.tools.foreground); assert_eq!(engine.tools.background, expected.tools.background);
}
fn compare(engine: &mut Session, expected: &mut Session, command: &str, params: &Value) {
    let identity = format!("prepared-brush-{}", ulid::Ulid::new());
    let all = params["points"].as_array().unwrap();
    let source = engine.active().unwrap().doc.clone();
    let key = stroke_key(&identity, command, params).unwrap();
    let mut batch = params.clone(); batch["points"] = json!(all[..2]); batch["_orionOffset"] = json!(0);
    let first = incremental(engine, &identity, command, &batch).unwrap();
    let repeated = incremental(engine, &identity, command, &batch).unwrap(); assert!(Arc::ptr_eq(&first.0, &repeated.0));
    batch["points"] = json!(all[2..4]); batch["_orionOffset"] = json!(2);
    incremental(engine, &identity, command, &batch).unwrap();
    assert_eq!(incremental_cache().lock().unwrap()[&key].live.samples_pushed(), 4);
    assert!(Arc::ptr_eq(&source, &engine.active().unwrap().doc));
    let mut native_params = params.clone();
    let coverage_fade = super::super::mask_filters::prepare_paint_fade(expected, command, &mut native_params);
    let native = expected.execute(command, native_params).unwrap();
    // Preserve native pixels/history/tool parity while adapting only its layer-only Fade context.
    super::super::mask_filters::finish_paint_fade(expected, coverage_fade);
    assert_eq!(commit_feedback(engine, &identity, command, params).unwrap().unwrap(), native, "response/{command}");
    assert!(!incremental_cache().lock().unwrap().contains_key(&key));
    assert_eq!(engine.jobs_with_recent().last().unwrap().state, "done");
    assert_state(engine, expected, command);
    release(&identity, 1337).unwrap();
}

#[test]
fn prepared_brush_depth_modes_symmetry_smoothing_dynamics_and_labels_match_native() {
    for depth in [8,16,32] { for mode in ["rgb","gray","cmyk","lab"] { for symmetric in [false,true] {
        for (command, erase, blend) in [("paint.stroke",false,"normal"),("paint.stroke",false,"multiply"),("paint.stroke",false,"dissolve"),("paint.stroke",true,"screen"),("paint.pencil",false,"screen")] {
            let mut engine = fixture(depth, mode);
            engine.execute("tools.setBrush", json!({"coalesce":"brush-slider","brush":{"shapeDynamics":{"enabled":true,"size":{"jitter":0.2,"control":"penPressure"}},"scattering":{"enabled":true,"scatter":{"jitter":0.25},"bothAxes":true},"colorDynamics":{"enabled":true,"hueJitter":0.1,"saturationJitter":0.2}}})).unwrap();
            if symmetric { engine.active_mut().unwrap().symmetry_path = Some(photocraft_engine::symmetry_cmds::SymmetryAxis { source: "Prepared axis".into(), segments: vec![[[24.0,-30.0],[24.0,80.0]],[[24.0,80.0],[42.0,95.0]]] }); }
            let mut params = params(); params["erase"] = json!(erase); params["mode"] = json!(blend); params["autoErase"] = json!(true);
            let mut expected = twin(&engine); compare(&mut engine, &mut expected, command, &params);
        }
    }}}
}

#[test]
fn prepared_brush_implicit_explicit_masks_channels_quick_mask_and_color_restriction_match_native() {
    for depth in [8,16,32] { for mode in ["rgb","gray","cmyk","lab"] {
        for (command, erase) in [("paint.stroke",false),("paint.stroke",true),("paint.pencil",false)] {
            for target in ["mask","implicit-mask","alpha","explicit-alpha","quickMask","explicit-quickMask","color","explicit-other-layer"] {
                let mut engine = fixture(depth, mode); let mut params = params(); params["erase"] = json!(erase);
                match target {
                    "mask"|"implicit-mask" => { engine.execute("layer.layerMask.revealAll",json!({})).unwrap(); if target=="mask" { params["target"]=json!("mask"); } else { engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap(); } },
                    "alpha"|"explicit-alpha" => { engine.execute("channel.new",json!({"name":"Prepared alpha"})).unwrap(); engine.execute("channel.target",json!({"channel":0})).unwrap(); if target=="explicit-alpha" { params["target"]=json!({"channel":0}); } },
                    "quickMask"|"explicit-quickMask" => { engine.execute("select.editInQuickMaskMode",json!({})).unwrap(); if target=="explicit-quickMask" { params["target"]=json!("quickMask"); } },
                    "color" => { engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(0); },
                    _ => { let layer=engine.active().unwrap().active_layer.unwrap(); engine.execute("layer.new.layer",json!({"name":"Other active layer"})).unwrap(); engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(0); params["layer"]=json!(layer.0); }
                }
                let mut expected = twin(&engine); compare(&mut engine,&mut expected,command,&params);
                super::super::execute_view_command(&mut engine,"edit.fade",json!({"opacity":45,"mode":"Multiply"})).unwrap(); super::super::execute_view_command(&mut expected,"edit.fade",json!({"opacity":45,"mode":"Multiply"})).unwrap(); assert_state(&engine,&expected,&format!("{command}/{target}/Fade"));
            }
        }
    }}
}

#[test]
fn prepared_brush_auto_erase_transparency_locks_presets_and_mask_eraser_labels_match_native() {
    for command in ["paint.stroke","paint.pencil"] { for target in ["pixels","mask"] { for erase in [false,true] {
        let mut engine=fixture(16,"rgb"); engine.execute("select.deselect",json!({})).unwrap();
        engine.tools.foreground=[0.5,0.25,0.125,1.0]; engine.tools.background=[0.2,0.7,0.9,1.0];
        engine.execute("paint.stroke",json!({"points":[[9,12]],"size":16,"color":"#804020","hardness":1,"seed":2})).unwrap();
        if target=="mask" { engine.execute("layer.layerMask.revealAll",json!({})).unwrap(); }
        let layer=engine.active().unwrap().active_layer.unwrap(); engine.active_mut().unwrap().doc=Arc::new({let mut doc=(*engine.active().unwrap().doc).clone();doc.layer_mut(layer).unwrap().locks.transparency=true;doc});
        let mut params=params(); params.as_object_mut().unwrap().remove("color"); params["erase"]=json!(erase); params["target"]=json!(target); params["autoErase"]=json!(true); params["preset"]=json!(engine.tools.presets[0].name);
        let mut expected=twin(&engine); compare(&mut engine,&mut expected,command,&params);
        assert_eq!(engine.active().unwrap().history.undo_label(),Some(if erase { "Eraser" } else if command=="paint.pencil" { "Pencil" } else { "Brush Tool" }));
    }}}
}

#[test]
fn prepared_brush_raw_live_routing_gap_and_identityless_feedback_are_verified() {
    for target in ["mask","alpha","quickMask","color"] {
        let mut engine=fixture(16,"rgb"); let params=params();
        match target {
            "mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},
            "alpha"=>{engine.execute("channel.new",json!({"name":"Preview alpha"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();},
            "quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},
            _=>engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(0),
        }
        let raw=photocraft_engine::brush_cmds::LiveStroke::begin_with(&engine,"paint.stroke",&params).unwrap();
        let source=engine.active().unwrap().doc.clone(); let mut expected=twin(&engine); expected.execute("paint.stroke",params.clone()).unwrap();
        assert_ne!(super::tests::native_pixels(&raw.doc),super::tests::native_pixels(&expected.active().unwrap().doc),"unrouted baseline/{target}");
        let actual=render(&engine,"paint.stroke",&params,0,0,48,48,1).unwrap();
        let state=expected.active().unwrap(); let native=tiles::render(&state.doc,Some(&state.channel_view),0,0,48,48,1,false,false).unwrap();
        assert_eq!(actual.len(),1); assert_eq!(actual[0].png,native.png,"identityless/{target}"); assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));
    }
}

#[test]
fn prepared_brush_coalescing_bounded_history_targets_undo_redo_and_slices_match_native() {
    for (command,erase) in [("paint.stroke",false),("paint.stroke",true),("paint.pencil",false)] {
        let mut engine=fixture(8,"rgb"); engine.execute("select.deselect",json!({})).unwrap(); engine.execute("layer.new.layer",json!({"name":"Slice target"})).unwrap(); engine.execute("paint.stroke",json!({"points":[[4,4]],"size":2,"seed":1})).unwrap(); engine.execute("layer.newLayerBasedSlice",json!({"name":"Brush slice"})).unwrap(); engine.active_mut().unwrap().history.max_states=1;
        let mut expected=twin(&engine);
        for step in 0..3 {
            let mut params=params(); params["erase"]=json!(erase); params["coalesce"]=json!(if step<2 {"first"} else {"second"});
            if step==1 { let selected:Vec<_>=engine.active().unwrap().doc.walk().into_iter().map(|(_,_,layer)|layer.id).collect(); engine.active_mut().unwrap().selected_layers=selected.clone(); expected.active_mut().unwrap().selected_layers=selected; }
            compare(&mut engine,&mut expected,command,&params);
            assert_eq!(serde_json::to_value(&engine.active().unwrap().doc.slices).unwrap(),serde_json::to_value(&expected.active().unwrap().doc.slices).unwrap());
        }
        for command in ["edit.undo","edit.redo"] { engine.execute(command,json!({})).unwrap(); expected.execute(command,json!({})).unwrap(); assert_state(&engine,&expected,command); }
    }
}

#[test]
fn prepared_brush_context_expiry_cancellation_and_rewritten_samples_fall_back_without_mutation() {
    for command in ["paint.stroke","paint.pencil"] { for change in ["cancel","expired","brush","foreground","background","presets","preset-store","pixels","layer","channel","symmetry-source","symmetry-segment","rewritten","offset","options","limit"] {
        let mut engine=fixture(8,"rgb"); engine.active_mut().unwrap().symmetry_path=Some(photocraft_engine::symmetry_cmds::SymmetryAxis{source:"axis".into(),segments:vec![[[24.0,-30.0],[24.0,80.0]]]});
        let mut params=params(); let identity=format!("brush-fallback-{}",ulid::Ulid::new()); incremental(&engine,&identity,command,&params).unwrap(); let key=stroke_key(&identity,command,&params).unwrap();
        match change {
            "cancel"=>release(&identity,1337).unwrap(), "expired"=>incremental_cache().lock().unwrap().get_mut(&key).unwrap().touched=Instant::now()-Duration::from_secs(31),
            "brush"=>engine.tools.brush.size=13.0, "foreground"=>engine.tools.foreground[0]=0.9, "background"=>engine.tools.background[0]=0.2, "presets"=>engine.tools.presets_rev+=1, "preset-store"=>engine.presets.rev+=1,
            "pixels"=>{engine.execute("paint.stroke",json!({"points":[[20,20]],"size":4,"seed":9})).unwrap();}, "layer"=>{engine.execute("layer.new.layer",json!({})).unwrap();}, "channel"=>engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(0),
            "symmetry-source"=>engine.active_mut().unwrap().symmetry_path.as_mut().unwrap().source="other".into(), "symmetry-segment"=>engine.active_mut().unwrap().symmetry_path.as_mut().unwrap().segments[0][0][0]=18.0,
            "rewritten"=>params["points"][0][0]=json!(12), "offset"=>params["_orionOffset"]=json!(5), "options"=>params["opacity"]=json!(0.3), _=>params["points"]=json!(vec![json!([10,10]);65_537]),
        }
        let before=engine.active().unwrap().doc.clone(); let journal=engine.journal.clone(); let history=engine.active().unwrap().history.entries();
        assert!(commit_feedback(&mut engine,&identity,command,&params).is_none(),"{command}/{change}"); assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc)); assert_eq!(journal,engine.journal); assert_eq!(history,engine.active().unwrap().history.entries());
        if !matches!(change,"offset"|"limit") { let mut expected=twin(&engine); let result=super::super::execute_view_command(&mut engine,command,params.clone()).unwrap(); assert_eq!(result,expected.execute(command,params.clone()).unwrap()); assert_state(&engine,&expected,&format!("{command}/{change}/fallback")); }
        release(&identity,1337).unwrap();
    }}
}

#[test]
fn prepared_brush_long_stream_full_preview_commit_replay_and_unrelated_mixer_state() {
    for (command,erase) in [("paint.stroke",false),("paint.stroke",true),("paint.pencil",false)] {
        let mut engine=fixture(16,"rgb"); let all:Vec<_>=(0..4097).map(|index|json!([8.0+f64::from(index%96)*0.3,12+index/96%8*3,0.2+f64::from(index%7)*0.1])).collect();
        let identity=format!("brush-long-{}",ulid::Ulid::new()); let mut params=params(); params["erase"]=json!(erase); params["points"]=json!(all[..2048]); params["_orionOffset"]=json!(0); let source=engine.active().unwrap().doc.clone();
        render_with_identity(&engine,Some(&identity),command,&params,0,0,0,0,1).unwrap(); params["points"]=json!(all[2048..]); params["_orionOffset"]=json!(2048); render_with_identity(&engine,Some(&identity),command,&params,100,100,48,48,1).unwrap();
        params.as_object_mut().unwrap().remove("_orionOffset"); params["points"]=json!(all); let key=stroke_key(&identity,command,&params).unwrap(); let preview=incremental_cache().lock().unwrap()[&key].live.document(); assert_eq!(incremental_cache().lock().unwrap()[&key].live.samples_pushed(),4097);
        engine.tools.mixer.reservoir=Some([0.2,0.8,0.5,1.0]); engine.tools.mixer.amount=0.3; let mut replay=twin(&engine); let mut expected=twin(&engine);
        let native_start=Instant::now(); let result=expected.execute(command,params.clone()).unwrap(); let native_elapsed=native_start.elapsed(); assert_eq!(super::tests::native_pixels(&preview),super::tests::native_pixels(&expected.active().unwrap().doc)); assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        let prepared_start=Instant::now(); assert_eq!(commit_feedback(&mut engine,&identity,command,&params).unwrap().unwrap(),result); let elapsed=prepared_start.elapsed(); assert_state(&engine,&expected,command);
        let (id,p)=engine.journal.last().unwrap(); assert_eq!(replay.execute("file.scripts.browse",json!({"steps":[[id,p]]})).unwrap()["ok"],true); assert_eq!(super::tests::native_pixels(&replay.active().unwrap().doc),super::tests::native_pixels(&engine.active().unwrap().doc));
        eprintln!("prepared-brush-work tool={command} erase={erase} samples=4097 preview_samples=4097 commit_appended_samples=0 native_ms={:.3} prepared_ms={:.3}",native_elapsed.as_secs_f64()*1000.0,elapsed.as_secs_f64()*1000.0);
        engine.execute("edit.undo",json!({})).unwrap(); expected.execute("edit.undo",json!({})).unwrap(); assert_state(&engine,&expected,"long/undo"); release(&identity,1337).unwrap();
    }
}
