use super::*;
use super::tests::{fixture, host, normalize, same, smart, twin, unchanged};
use photocraft_engine::doc::{Affine, BlendMode, Layer, LayerContent, Rect, SmartFilter};
use serde_json::json;

const STRAIGHTEN: &str = "image.analysis.straightenLayer";

fn command(engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
    super::super::super::execute_view_command(engine, command, params)
}

fn ruler(engine: &mut Session) {
    engine.execute("image.analysis.rulerTool", json!({"start":[3,4],"end":[11,7]})).unwrap();
}

#[test]
fn linked_rotation_host_raw_straighten_matches_native_nested_history_journals_and_views() {
    for depth in [8,16,32] {
        for format in ["png","pcraft","psd","psb"] {
            for crop in [true,false] {
                let mut f = fixture(depth,format);
                if !crop && format=="pcraft" {
                    f.engine.edit("Selected group straighten",|doc,active| {
                        doc.selection=None;*active=Some(f.group);Ok(())
                    }).unwrap();
                    normalize(&mut f.engine);
                }
                ruler(&mut f.engine);
                let before = f.engine.active().unwrap().doc.clone();
                let past = f.engine.active().unwrap().history.past_len();
                let journal = f.engine.journal.len();
                let mut native = twin(&f.engine);
                let params = json!({"crop":crop,"coalesce":"outer-straighten","vendor":[null,7]});
                assert_eq!(command(&mut f.engine,STRAIGHTEN,params.clone()).unwrap(),native.execute(STRAIGHTEN,params).unwrap());
                same(&f.engine,&native);
                let state = f.engine.active().unwrap();
                assert!(state.doc.measurement.ruler.is_none());
                assert_eq!(state.history.past_len(),past+1);
                assert_eq!(state.history.undo_label(),Some("Straighten"));
                assert_eq!(state.coalesce,None);
                assert_eq!(f.engine.journal.len(),journal+if crop {3}else{2});
                assert_eq!(f.engine.journal[journal].0,if crop {"image.rotation.arbitrary"}else{"edit.transform"});
                if crop { assert_eq!(f.engine.journal[journal+1].0,"image.crop"); }
                assert_eq!(f.engine.journal.last().unwrap().0,STRAIGHTEN);
                assert_eq!(state.doc.metadata,before.metadata);
                for id in [f.active,f.other,f.embedded] {
                    assert_eq!(smart(&state.doc,id).source,smart(&before,id).source);
                    assert_eq!(smart(&state.doc,id).psd_raw,smart(&before,id).psd_raw);
                }
                let after = state.doc.clone();
                f.engine.execute("edit.undo",json!({})).unwrap();native.execute("edit.undo",json!({})).unwrap();
                same(&f.engine,&native);assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
                f.engine.execute("edit.redo",json!({})).unwrap();native.execute("edit.redo",json!({})).unwrap();
                same(&f.engine,&native);assert_eq!(f.engine.active().unwrap().doc,after);
            }
        }
    }
}

#[test]
fn linked_rotation_host_straighten_refreshes_canvas_dependent_lens_before_crop() {
    for depth in [8,16,32] {
        let mut f = fixture(depth,"psb");
        f.engine.edit("Canvas-dependent lens",|doc,_| {
            let LayerContent::Smart(object) = &mut doc.layer_mut(f.active).unwrap().content else { unreachable!() };
            object.transform = Affine::translate(7.,5.);
            object.smart_filters = vec![SmartFilter {command:"filter.lensCorrection".into(),params:json!({"distortion":35,"vignetteAmount":-60,"vignetteMidpoint":20}),visible:true,opacity:1.,blend:BlendMode::Normal}];
            photocraft_engine::smart_cmds::refresh(doc,f.active)?;
            Ok(())
        }).unwrap();
        normalize(&mut f.engine);ruler(&mut f.engine);
        let mut native = twin(&f.engine);
        let params = json!({"crop":true});
        assert_eq!(command(&mut f.engine,STRAIGHTEN,params.clone()).unwrap(),native.execute(STRAIGHTEN,params).unwrap());
        same(&f.engine,&native);
        let correct = smart(&f.engine.active().unwrap().doc,f.active).cache.clone();
        let doc = Arc::make_mut(&mut native.active_mut().unwrap().doc);
        photocraft_engine::smart_cmds::refresh(doc,f.active).unwrap();
        assert_ne!(correct,smart(&native.active().unwrap().doc,f.active).cache,"A refresh after crop must expose the different canvas context");
    }
}

#[test]
fn linked_rotation_host_endpoint_straighten_keeps_one_edit_recipe_and_owner_background_color() {
    use photocraft_engine::preset_store::{open, MemBackend};
    for depth in [8,16,32] {
        for crop in [true,false] {
            let mut f = fixture(depth,"psd");
            f.engine.active_mut().unwrap().selected_layers=vec![f.active];
            f.engine.edit("Actual Background",|doc,_| {
                let mut layer=Layer::raster("Background",doc.pixel_format());
                layer.locks.position=true;layer.locks.transparency=true;
                layer.surface_mut().unwrap().fill_rect(Rect::new(0,0,16,12),&[0.1,0.2,0.3,1.]);
                doc.layers.insert(0,layer);Ok(())
            }).unwrap();
            normalize(&mut f.engine);
            f.engine.tools.background=[0.8,0.15,0.35,1.];
            let storage=MemBackend::default();
            f.engine.attach_preset_store(open(Box::new(storage.clone())));
            let mut preset=f.engine.tools.presets[0].clone();
            preset.name="Pending Straighten owner brush".into();preset.builtin=false;
            f.engine.tools.presets.push(preset);f.engine.brush_presets_changed();
            let files=storage.files.lock().unwrap().clone();
            let before=f.engine.active().unwrap().doc.clone();
            let journal=f.engine.journal.len();
            let past=f.engine.active().unwrap().history.past_len();
            let mut native=twin(&f.engine);
            let line=json!({"start":[3.0,4.0],"end":[11.0,7.0]});
            native.execute("image.analysis.rulerTool",line.clone()).unwrap();
            let options=json!({"crop":crop});
            let result=native.execute(STRAIGHTEN,options.clone()).unwrap();
            let document=native.active().unwrap().doc.clone();
            let mut expected=twin(&f.engine);
            expected.edit("Straighten",|doc,_|{*doc=(*document).clone();Ok(())}).unwrap();
            expected.sync_preset_store();
            expected.journal.extend([("image.analysis.rulerTool".into(),line.clone()),(STRAIGHTEN.into(),options.clone())]);
            assert_eq!(command(&mut f.engine,STRAIGHTEN,json!({"start":[3,4],"end":[11,7],"crop":crop})).unwrap(),result);
            same(&f.engine,&expected);
            assert_ne!(*storage.files.lock().unwrap(),files);
            assert!(open(Box::new(storage)).presets.iter().any(|preset|preset.name=="Pending Straighten owner brush"));
            assert_eq!(f.engine.active().unwrap().history.past_len(),past+1);
            assert_eq!(f.engine.journal.len(),journal+2);
            assert_eq!(f.engine.journal[journal].0,"image.analysis.rulerTool");
            assert_eq!(f.engine.journal[journal+1],(STRAIGHTEN.into(),options));
            if crop {
                let background=f.engine.active().unwrap().doc.layers[0].surface().unwrap();
                assert!(background.pixel(0,0)[3]>0.99);
            }
            f.engine.execute("edit.undo",json!({})).unwrap();
            assert!(Arc::ptr_eq(&f.engine.active().unwrap().doc,&before));
        }
    }
}

#[test]
fn linked_rotation_host_raw_and_endpoint_source_refusals_keep_their_distinct_native_boundaries() {
    for endpoint in [false,true] {
        let mut f=fixture(16,"png");
        f.engine.edit("Unsupported visible source stack",|doc,_| {
            let LayerContent::Smart(object)=&mut doc.layer_mut(f.embedded).unwrap().content else{unreachable!()};
            object.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({"path":"must not execute"}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())
        }).unwrap();
        if !endpoint {ruler(&mut f.engine);}
        let before=twin(&f.engine);
        let params=if endpoint {json!({"start":[3,4],"end":[11,7],"crop":true})}else{json!({"crop":true})};
        assert!(command(&mut f.engine,STRAIGHTEN,params).unwrap_err().contains("Bounded linked-source replay"));
        if endpoint {unchanged(&f.engine,&before);}
        else {
            let expected_revision=before.active().unwrap().revision+1;
            let state=f.engine.active_mut().unwrap();assert_eq!(state.revision,expected_revision);assert_eq!(state.last_damage,None);
            state.revision=before.active().unwrap().revision;state.last_damage=before.active().unwrap().last_damage;
            unchanged(&f.engine,&before);
        }
    }
}

#[test]
fn linked_rotation_host_raw_defaults_noops_and_native_failures_precede_nested_source_access() {
    for params in [Value::Null,json!({}),json!({"crop":"malformed"}),json!({"crop":false}),json!({"crop":true})] {
        let mut f=fixture(8,"png");
        ruler(&mut f.engine);
        let mut native=twin(&f.engine);
        assert_eq!(command(&mut f.engine,STRAIGHTEN,params.clone()).unwrap(),native.execute(STRAIGHTEN,params).unwrap());
        same(&f.engine,&native);
    }
    for mode in ["no-ruler","horizontal","malformed","locked-transform"] {
        let mut f=fixture(8,"png");
        if mode=="horizontal" {f.engine.execute("image.analysis.rulerTool",json!({"start":[3,4],"end":[11,4]})).unwrap();}
        if mode=="malformed" || mode=="locked-transform" {ruler(&mut f.engine);}
        if mode=="locked-transform" {Arc::make_mut(&mut f.engine.active_mut().unwrap().doc).layer_mut(f.active).unwrap().locks.all=true;}
        let mut native=twin(&f.engine);let before=twin(&f.engine);let mut calls=0;
        let params=if mode=="malformed" {json!([])}else{json!({"crop":false})};
        let actual=super::super::straighten::run_with(&mut f.engine,&params,|engine,id,params| {calls+=1;engine.execute(id,params).map_err(|error|error.to_string())});
        let expected=native.execute(STRAIGHTEN,params).map_err(|error|error.to_string());
        assert_eq!(actual,expected);same(&f.engine,&native);
        assert_eq!(calls,usize::from(mode=="locked-transform"));
        if mode!="locked-transform" && mode!="horizontal" {unchanged(&f.engine,&before);}
    }
}

#[test]
fn linked_rotation_host_rotation_presets_and_both_straighten_modes_reopen_immutable_cached_history() {
    for depth in [8,16,32] {
        for operation in [COMMAND,"edit.transform.rotate180","edit.transform.rotate90Cw","edit.transform.rotate90Ccw","edit.transform.flipHorizontal","edit.transform.flipVertical","raw-crop","raw-layer","endpoint-crop","endpoint-layer"] {
            let mut f=fixture(depth,"psb");
            f.engine.active_mut().unwrap().selected_layers=vec![f.active];
            if operation.starts_with("raw-") {ruler(&mut f.engine);}
            let before=f.engine.active().unwrap().doc.clone();
            let labels=f.engine.active().unwrap().history.entries();
            match operation {
                COMMAND=>{host(&mut f.engine,json!({"angle":17.5})).unwrap();},
                "raw-crop"|"raw-layer"=>{command(&mut f.engine,STRAIGHTEN,json!({"crop":operation=="raw-crop"})).unwrap();},
                "endpoint-crop"|"endpoint-layer"=>{command(&mut f.engine,STRAIGHTEN,json!({"start":[3,4],"end":[11,7],"crop":operation=="endpoint-crop"})).unwrap();},
                preset=>{command(&mut f.engine,preset,json!({"coalesce":"ignored-preset"})).unwrap();},
            }
            let after=f.engine.active().unwrap().doc.clone();
            let mut session=super::super::super::PhotoSession{engine:f.engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
            let photo=ulid::Ulid::new().to_string();super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap();
            let immutable_file=f.directory.0.join(format!("{}.pcraft",session.version));
            let immutable=super::super::super::bundle::portable_bytes(&immutable_file,super::super::super::MAX_INPUT_BYTES as usize).unwrap();
            std::fs::remove_file(&f.path).unwrap();
            session.engine.execute("edit.undo",json!({})).unwrap();
            super::super::super::publish(&f.directory.0,&photo,&mut session).unwrap();super::super::super::save_view(&f.directory.0,&session).unwrap();
            let mut reopened=super::super::super::restore_with_settings(&f.directory.0,&session.version,None,false).unwrap();
            assert_eq!(reopened.engine.active().unwrap().doc,before);assert_eq!(reopened.engine.active().unwrap().history.entries(),labels);assert!(reopened.engine.active().unwrap().history.can_redo());
            reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);
            assert_eq!(smart(&reopened.engine.active().unwrap().doc,f.active).source,smart(&before,f.active).source);
            reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);
            assert_eq!(super::super::super::bundle::portable_bytes(&immutable_file,super::super::super::MAX_INPUT_BYTES as usize).unwrap(),immutable);
        }
    }
}
