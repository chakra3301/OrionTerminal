use super::*;
use photocraft_engine::{doc::PixelFormat, DocState};
use serde_json::json;
use super::super::mask_filters::{self, Target};

fn run(engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
    super::super::execute_view_command(engine, command, params)
}

fn fixture(depth: u32, route: &str, implicit: bool) -> (Session, Target, Value) {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":17,"height":13,"depth":depth,"background":"#4080b0"})).unwrap();
    let id = engine.active().unwrap().active_layer.unwrap();
    engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
    engine.execute("channel.new", json!({"name":"Independent alpha"})).unwrap();
    let target = match route {
        "mask" => Target::Mask(id),
        "alpha" => Target::Alpha(0),
        _ => { engine.execute("select.editInQuickMaskMode", json!({})).unwrap(); Target::QuickMask },
    };
    engine.edit("Coverage fixture", |doc, _| {
        let format = PixelFormat { sample: doc.depth, ..PixelFormat::GRAY8 };
        let mut surface = Surface::with_default(format, &[1.0]);
        for (x,y,value) in [(3,4,0.2),(6,5,0.7),(-2,3,0.4),(19,15,0.6)] { surface.write_pixel(x,y,&[value]); }
        *destination(doc, target) = surface;
        let mut selection = Surface::new(PixelFormat::GRAY8);
        for (x,y,value) in [(3,4,0.5),(6,5,1.0),(8,7,1.0),(-2,3,1.0),(19,15,0.5)] { selection.write_pixel(x,y,&[value]); }
        doc.selection = Some(selection);
        Ok(())
    }).unwrap();
    engine.execute("channel.target", json!({"channel":"composite"})).unwrap();
    if implicit {
        match target {
            Target::Mask(_) => { engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap(); },
            Target::Alpha(index) => { engine.execute("channel.target",json!({"channel":index})).unwrap(); },
            Target::QuickMask => {},
        }
    }
    let params = if implicit { json!({}) } else { match target { Target::Mask(_) => json!({"target":"mask"}), Target::Alpha(index) => json!({"target":{"channel":index}}), Target::QuickMask => json!({"target":"quickMask"}) } };
    (engine, target, params)
}

fn destination(doc: &mut photocraft_engine::doc::Document, target: Target) -> &mut Surface {
    match target {
        Target::Mask(id) => &mut doc.layer_mut(id).unwrap().mask.as_mut().unwrap().surface,
        Target::Alpha(index) => &mut doc.channels[index].surface,
        Target::QuickMask => &mut doc.quick_mask.as_mut().unwrap().surface,
    }
}

fn unchanged_other_planes(before: &DocState, after: &DocState, target: Target) {
    let mut restored = (*after.doc).clone();
    *destination(&mut restored,target) = mask_filters::plane(&before.doc,target).unwrap().clone();
    assert_eq!(&restored, before.doc.as_ref(), "only the coverage plane may change");
    assert_eq!(after.channel_view,before.channel_view);
    assert_eq!(after.active_layer,before.active_layer);
    assert_eq!(after.selected_layers,before.selected_layers);
}

fn tolerance(surface: &Surface) -> f32 {
    match surface.format().sample { SampleType::U8 => 1.01/255.0, SampleType::U16 => 1.01/65535.0, _ => 0.000001 }
}

#[test]
fn coverage_adjustment_and_fade_have_independent_raw_plane_oracles_at_three_depths() {
    for depth in [8,16,32] { for route in ["mask","alpha","quickMask"] { for implicit in [false,true] { for opacity in [0.0,50.0,100.0] {
        let (mut engine,target,params) = fixture(depth,route,implicit);
        let source = engine.active().unwrap().clone(); let past = source.history.past_len(); let journal = engine.journal.len();
        let original = mask_filters::plane(&source.doc,target).unwrap().clone();
        run(&mut engine,"image.adjustments.invert",params).unwrap();
        let adjusted = engine.active().unwrap().clone(); let edited = mask_filters::plane(&adjusted.doc,target).unwrap().clone();
        assert_eq!(adjusted.history.past_len(),past+1); assert_eq!(engine.journal.len(),journal+1);
        assert_eq!(engine.journal.last().unwrap().0,"image.adjustments.invert");
        assert!(mask_filters::can_fade(&engine) || engine.is_enabled("edit.fade"));
        unchanged_other_planes(&source,&adjusted,target);
        for (x,y) in [(3,4),(6,5),(8,7),(-2,3),(19,15),(1,1),(100,100)] {
            let before = original.sample_channel(x,y,0); let selection = source.doc.selection.as_ref().unwrap().sample_channel(x,y,0);
            let expected = before + (1.0-before-before)*selection;
            assert!((edited.sample_channel(x,y,0)-expected).abs() <= tolerance(&edited), "invert/{depth}/{route}/{implicit}/{x},{y}");
        }
        run(&mut engine,"edit.fade",json!({"opacity":opacity,"mode":"normal"})).unwrap();
        let faded = engine.active().unwrap(); let actual = mask_filters::plane(&faded.doc,target).unwrap();
        for (x,y) in [(3,4),(6,5),(8,7),(-2,3),(19,15),(1,1),(100,100)] {
            let before = original.sample_channel(x,y,0); let after = edited.sample_channel(x,y,0);
            let expected = before+(after-before)*(opacity as f32/100.0);
            assert!((actual.sample_channel(x,y,0)-expected).abs() <= tolerance(actual), "Fade/{depth}/{route}/{implicit}/{opacity}/{x},{y}");
        }
        unchanged_other_planes(&source,faded,target); assert_eq!(faded.history.past_len(),past+2);
        run(&mut engine,"edit.undo",json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc,adjusted.doc);
        run(&mut engine,"edit.undo",json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc,source.doc);
        run(&mut engine,"edit.redo",json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc,adjusted.doc);
    }}}}
}

#[test]
fn mixed_coverage_adjustments_and_filters_keep_gesture_start_and_first_label() {
    for depth in [8,16,32] { for route in ["mask","alpha","quickMask"] { for adjustment_first in [false,true] {
        let (mut engine,target,mut params) = fixture(depth,route,false); params["coalesce"] = json!("");
        let source = engine.active().unwrap().clone();
        let commands = if adjustment_first { ["image.adjustments.invert","filter.cameraRaw"] } else { ["filter.cameraRaw","image.adjustments.invert"] };
        let mut first_label = String::new();
        for (index,command) in commands.into_iter().enumerate() {
            let mut settings = params.clone(); if command=="filter.cameraRaw" { settings["exposure"]=json!(-1.0); }
            run(&mut engine,command,settings).unwrap();
            let state = engine.active().unwrap(); if index==0 { first_label=state.history.undo_label().unwrap().into(); }
            assert_eq!(state.history.past_len(),source.history.past_len()+1); assert_eq!(state.history.undo_label(),Some(first_label.as_str())); assert_eq!(state.coalesce,Some(String::new()));
        }
        let edited = engine.active().unwrap().doc.clone();
        let result = run(&mut engine,"edit.fade",json!({"opacity":0,"mode":"normal"})).unwrap(); assert_eq!(result["faded"],first_label);
        let current = engine.active().unwrap();
        assert_eq!(mask_filters::plane(&current.doc,target).unwrap().read_region(photocraft_engine::doc::Rect::from_xywh(-3,-2,25,20)),mask_filters::plane(&source.doc,target).unwrap().read_region(photocraft_engine::doc::Rect::from_xywh(-3,-2,25,20)));
        unchanged_other_planes(&source,current,target);
        run(&mut engine,"edit.undo",json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc,edited);
        run(&mut engine,"edit.undo",json!({})).unwrap(); assert_eq!(engine.active().unwrap().doc,source.doc);
    }}}
}

#[test]
fn coverage_adjustment_errors_preserve_current_history_journal_fade_and_coalescing() {
    for route in ["mask","alpha","quickMask"] {
        let (mut engine,_target,mut params) = fixture(16,route,false); params["coalesce"]=json!("retained");
        run(&mut engine,"image.adjustments.invert",params.clone()).unwrap();
        for mutation in ["gamma","target","missing-channel","missing-layer","not-object"] {
            let mut invalid=params.clone(); let command=if mutation=="gamma" { invalid["gamma"]=json!("bad"); "image.adjustments.levels" } else { "image.adjustments.invert" };
            match mutation { "target"=>invalid["target"]=json!("unknown"),"missing-channel"=>invalid["target"]=json!({"channel":999}),"missing-layer"=>{invalid["target"]=json!("mask");invalid["layer"]=json!(999999);},"not-object"=>invalid=json!([]),_=>{} }
            let before=engine.active().unwrap().clone(); let journal=engine.journal.clone(); let fade=engine.edit_state.fade.clone();
            assert!(run(&mut engine,command,invalid).is_err(),"{route}/{mutation}");
            let after=engine.active().unwrap(); assert!(std::sync::Arc::ptr_eq(&before.doc,&after.doc)); assert_eq!(after.revision,before.revision); assert_eq!(after.history.entries(),before.history.entries()); assert_eq!(after.coalesce,before.coalesce); assert_eq!(after.channel_view,before.channel_view); assert_eq!(engine.journal,journal); assert_eq!(engine.edit_state.fade,fade);
        }
    }
}

#[test]
fn explicit_mask_layer_adjustment_preserves_active_layer_and_invalid_fade_refuses() {
    let (mut engine,target,mut params)=fixture(8,"mask",false);
    let Target::Mask(layer)=target else { unreachable!() }; params["layer"]=json!(layer.0);
    engine.execute("layer.new.layer",json!({"name":"Unrelated active layer"})).unwrap(); let source=engine.active().unwrap().clone();
    run(&mut engine,"image.adjustments.invert",params).unwrap(); let adjusted=engine.active().unwrap().clone(); unchanged_other_planes(&source,&adjusted,target);
    assert_eq!(engine.edit_state.fade.as_ref().unwrap().layer,layer);
    run(&mut engine,"edit.fade",json!({"opacity":0})).unwrap(); assert_eq!(mask_filters::plane(&engine.active().unwrap().doc,target).unwrap().read_region(source.doc.bounds()),mask_filters::plane(&source.doc,target).unwrap().read_region(source.doc.bounds()));
    let (mut channel,_,params)=fixture(8,"alpha",false); run(&mut channel,"image.adjustments.invert",params).unwrap();
    for params in [json!({"opacity":"bad"}),json!({"opacity":null}),json!({"mode":5}),json!({"mode":"missing"})] { let before=channel.active().unwrap().clone(); let journal=channel.journal.clone(); assert!(run(&mut channel,"edit.fade",params).is_err()); assert!(std::sync::Arc::ptr_eq(&before.doc,&channel.active().unwrap().doc)); assert_eq!(channel.journal,journal); }
    let stamped=channel.journal.last().unwrap().1.clone(); channel.journal.push(("image.adjustments.notARealAdjustment".into(),stamped)); assert!(!mask_filters::can_fade(&channel));
}

#[test]
fn neutral_coverage_adjustments_retain_native_history_semantics_and_stale_fade_refuses() {
    let (mut engine,_,params)=fixture(8,"alpha",false); let before=engine.active().unwrap().clone(); let journal=engine.journal.len();
    run(&mut engine,"image.adjustments.brightnessContrast",params).unwrap();
    assert_eq!(engine.active().unwrap().history.past_len(),before.history.past_len()+1); assert_eq!(engine.journal.len(),journal+1);
    engine.execute("edit.undo",json!({})).unwrap(); assert!(!mask_filters::can_fade(&engine)); assert!(run(&mut engine,"edit.fade",json!({"opacity":50})).is_err());
}
