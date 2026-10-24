use photocraft_engine::{
    doc::{Layer, LayerId, Size},
    Session,
};
use serde_json::{json, Value};

fn point(value: &Value) -> Result<[f64; 2], String> {
    let values = value
        .as_array()
        .filter(|values| values.len() == 2)
        .ok_or("Straighten endpoints must be two image coordinates")?;
    let mut result = [0.0; 2];
    for (index, value) in values.iter().enumerate() {
        result[index] = value
            .as_f64()
            .filter(|value| {
                value.is_finite() && *value >= f64::from(i32::MIN) && *value <= f64::from(i32::MAX)
            })
            .ok_or("Straighten coordinates exceed the image editing limits")?;
    }
    Ok(result)
}

fn admit(size: Size, angle: f64, crop: bool) -> Result<(), String> {
    if !crop {
        return Ok(());
    }
    let rotated = photocraft_engine::mode_cmds::rotated_size(size, f64::from(angle as f32));
    if u64::from(rotated.width) * u64::from(rotated.height) > super::MAX_PIXELS {
        return Err("The rotated image exceeds the 256 megapixel editing limit".into());
    }
    Ok(())
}

fn selected_roots(layers: &[Layer], selected: &[LayerId], roots: &mut Vec<LayerId>) {
    for layer in layers {
        if selected.contains(&layer.id) {
            roots.push(layer.id);
        } else if let Some(children) = layer.children() {
            selected_roots(children, selected, roots);
        }
    }
}

fn step(
    engine: &mut Session,
    recipe: &mut Vec<(String, Value)>,
    execute: &mut impl FnMut(&mut Session, &str, Value) -> Result<Value, String>,
    command: &str,
    params: Value,
) -> Result<Value, String> {
    let output = execute(engine, command, params.clone())?;
    // The real document gets one history entry. Retaining staged histories and
    // nested journals across every selected root only holds intermediate data.
    engine
        .active_mut()
        .ok_or("No straighten preview image")?
        .history = Default::default();
    engine.journal.clear();
    recipe.push((command.into(), params));
    Ok(output)
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    if command != "image.analysis.straightenLayer"
        || params.get("start").is_none() && params.get("end").is_none()
    {
        return None;
    }
    Some(run(engine, params, |engine, command, params| {
        super::preview::validate_geometry_input(engine, command, &params)?;
        if let Some(result) = super::linked_replay::execute(engine, command, &params) { return result; }
        engine.execute(command, params).map_err(|error| error.to_string())
    }))
}

fn run(engine: &mut Session, params: &Value,
    mut execute: impl FnMut(&mut Session, &str, Value) -> Result<Value, String>) -> Result<Value, String> {
    let start = point(&params["start"])?;
    let end = point(&params["end"])?;
    let crop = params
        .get("crop")
        .map(|value| {
            value
                .as_bool()
                .ok_or("Choose image or selected-layer straightening")
        })
        .transpose()?
        .unwrap_or(true);
    let (dx, dy) = (end[0] - start[0], end[1] - start[1]);
    if dx.hypot(dy) < 1.0 {
        return Err("Draw a reference line at least one image pixel long".into());
    }
    if let Some(reason) = engine.disabled_reason("image.analysis.rulerTool") {
        return Err(reason);
    }
    let state = engine.active().ok_or("No image document")?;
    let selected = state.selected_layers();
    let mut roots = Vec::new();
    if !crop {
        selected_roots(&state.doc.layers, &selected, &mut roots);
        if roots.is_empty() || selected.iter().any(|id| state.doc.layer(*id).is_none()) {
            return Err("Choose layers to straighten".into());
        }
        if roots.iter().any(|id| {
            state.doc.layer(*id).is_some_and(|layer| {
                layer.locks.all || layer.locks.position && layer.name != "Background"
            })
        }) {
            return Err("Choose unlocked layers to straighten".into());
        }
    }
    let angle = (-dy).atan2(dx).to_degrees();
    let angle = angle - 90.0 * (angle / 90.0).round();
    if angle.abs() < 1e-9 {
        return Ok(json!({"angle":0.0}));
    }
    admit(state.doc.size, angle, crop)?;
    // Staging the quiet ruler outside the real session keeps it out of the
    // original undo snapshot and leaves it intact on any native failure.
    let mut isolated = Session::new();
    isolated.add_document((*state.doc).clone(), None);
    let mut draft = state.clone();
    draft.history = Default::default();
    draft.channel_view = Default::default();
    *isolated.active_mut().ok_or("No straighten preview image")? = draft;
    isolated.tools = engine.tools.clone();
    let color = super::color_views::Snapshot::capture(engine)?;
    color.install(&mut isolated)?;
    let ruler = json!({"start":start,"end":end});
    let options = json!({"crop":crop});
    let mut recipe = Vec::new();
    let mut output = Value::Null;
    if crop || roots.len() == 1 && state.active_layer == roots.first().copied() {
        step(
            &mut isolated,
            &mut recipe,
            &mut execute,
            "image.analysis.rulerTool",
            ruler,
        )?;
        output = step(
            &mut isolated,
            &mut recipe,
            &mut execute,
            "image.analysis.straightenLayer",
            options,
        )?;
    } else {
        // Every layer needs the same source coverage; reusing the outline after
        // a transform would repeatedly rotate it and change subsequent pixels.
        let saved_selection = if roots.len() > 1 && state.doc.selection.is_some() {
            let saved = step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "select.saveSelection",
                json!({"name":format!("Straighten {}",ulid::Ulid::new()),"channel":"new"}),
            )?;
            Some(saved["channel"].clone())
        } else {
            None
        };
        for (index, id) in roots.iter().enumerate() {
            if let Some(channel) = &saved_selection {
                step(
                    &mut isolated,
                    &mut recipe,
                    &mut execute,
                    "select.loadSelection",
                    json!({"channel":channel,"operation":"new"}),
                )?;
                if index == 0
                    && isolated
                        .active()
                        .ok_or("No straighten preview image")?
                        .doc
                        .selection
                        != state.doc.selection
                {
                    return Err("This selection cannot be saved without changing its coverage. Straighten one layer at a time or recreate the selection inside the canvas.".into());
                }
            }
            step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "layer.select",
                json!({"layer":id.0}),
            )?;
            step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "image.analysis.rulerTool",
                ruler.clone(),
            )?;
            output = step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "image.analysis.straightenLayer",
                options.clone(),
            )?;
        }
        if let Some(channel) = saved_selection {
            step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "channel.delete",
                json!({"channel":channel}),
            )?;
        }
        for (index, id) in selected.iter().enumerate() {
            step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "layer.select",
                json!({"layer":id.0,"mode":if index==0 {"replace"}else{"add"}}),
            )?;
        }
        if let Some(id) = state.active_layer {
            step(
                &mut isolated,
                &mut recipe,
                &mut execute,
                "layer.select",
                json!({"layer":id.0,"mode":"add"}),
            )?;
        }
    }
    super::check_size(&isolated)?;
    let document = isolated
        .active()
        .ok_or("No straightened image")?
        .doc
        .clone();
    engine
        .edit("Straighten", |doc, _| {
            *doc = (*document).clone();
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    engine.sync_preset_store();
    // Omit nested native rotations/crops: replaying them would transform twice.
    engine.journal.extend(recipe);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{
        AlphaChannel, ColorMode, LayerMask, PixelFormat, Rect, SampleType, Surface,
    };

    fn fixture(mode: &str, depth: u32) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":48,"height":32,"mode":mode,"depth":depth,"background":"#408090"}),
            )
            .unwrap();
        engine
            .execute("layer.new.layer", json!({"name":"Horizon"}))
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[7,13],[38,18]],"size":7,"color":"#d04080","seed":3}),
            )
            .unwrap();
        engine
            .execute(
                "select.rect",
                json!({"x":5,"y":4,"width":36,"height":23,"feather":1}),
            )
            .unwrap();
        engine
            .edit("Mask and numeric metadata", |doc, active| {
                let mut mask = LayerMask::reveal_all();
                mask.density = 0.8;
                mask.feather = 1.5;
                mask.surface.write_region(Rect::new(4, 3, 7, 6), &[0.25; 9]);
                doc.layer_mut(active.unwrap()).unwrap().mask = Some(mask);
                doc.channels.push(AlphaChannel::new(
                    "Saved coverage",
                    Surface::with_default(
                        PixelFormat::new(ColorMode::Grayscale, SampleType::U16, false),
                        &[0.37],
                    ),
                ));
                Ok(())
            })
            .unwrap();
        engine
            .execute(
                "image.analysis.rulerTool",
                json!({"start":[3,2],"end":[20,4]}),
            )
            .unwrap();
        engine.execute("edit.assignProfile", json!({"profile":match mode {"gray"=>"sgray","cmyk"=>"coated-cmyk","lab"=>"lab-d50",_=>"display-p3"}})).unwrap();
        engine
    }

    #[test]
    fn straighten_line_selected_layers_ignore_numeric_view_target_and_preserve_other_layers_and_channels(
    ) {
        let mut actual = fixture("rgb", 16);
        let first = actual.active().unwrap().active_layer.unwrap();
        actual
            .execute("layer.new.layer", json!({"name":"Second"}))
            .unwrap();
        actual
            .execute(
                "paint.stroke",
                json!({"points":[[8,5],[38,10]],"size":4,"color":"#50c070","seed":7}),
            )
            .unwrap();
        actual
            .execute("layer.select", json!({"layer":first.0,"mode":"add"}))
            .unwrap();
        let before = actual.active().unwrap().clone();
        assert_eq!(before.selected_layers.len(), 2);
        actual.active_mut().unwrap().channel_view.target =
            photocraft_engine::channel_cmds::ChannelTarget::Alpha(0);
        let mut expected = Session::new();
        expected.add_document((*before.doc).clone(), None);
        *expected.active_mut().unwrap() = before.clone();
        for id in before.selected_layers() {
            std::sync::Arc::make_mut(&mut expected.active_mut().unwrap().doc).selection =
                before.doc.selection.clone();
            expected.select_layer(id).unwrap();
            expected
                .execute(
                    "image.analysis.rulerTool",
                    json!({"start":[6,12],"end":[40,18]}),
                )
                .unwrap();
            expected
                .execute("image.analysis.straightenLayer", json!({"crop":false}))
                .unwrap();
        }
        let journal_start = actual.journal.len();
        execute(
            &mut actual,
            "image.analysis.straightenLayer",
            &json!({"start":[6,12],"end":[40,18],"crop":false}),
        )
        .unwrap()
        .unwrap();
        let after = &actual.active().unwrap().doc;
        assert_eq!(&**after, &*expected.active().unwrap().doc);
        assert_eq!(after.layers[0], before.doc.layers[0]);
        assert_eq!(after.channels, before.doc.channels);
        for id in &before.selected_layers {
            assert!(after.layer(*id).unwrap() != before.doc.layer(*id).unwrap());
        }
        assert_eq!(actual.active().unwrap().active_layer, before.active_layer);
        assert_eq!(
            actual.active().unwrap().selected_layers,
            before.selected_layers
        );
        assert_eq!(actual.active().unwrap().layer_anchor, before.layer_anchor);
        assert_eq!(
            actual.active().unwrap().history.past_len(),
            before.history.past_len() + 1
        );
        assert_eq!(
            actual.active().unwrap().channel_view.target,
            photocraft_engine::channel_cmds::ChannelTarget::Alpha(0)
        );
        let mut replay = Session::new();
        replay.add_document((*before.doc).clone(), None);
        *replay.active_mut().unwrap() = before.clone();
        for (id, params) in &actual.journal[journal_start..] {
            replay.execute(id, params.clone()).unwrap();
        }
        assert!(&*replay.active().unwrap().doc == &**after);
        assert_eq!(replay.active().unwrap().active_layer, before.active_layer);
        assert_eq!(
            replay.active().unwrap().selected_layers(),
            before.selected_layers()
        );
        let after = after.clone();
        actual.execute("edit.undo", json!({})).unwrap();
        assert!(&*actual.active().unwrap().doc == &*before.doc);
        actual.execute("edit.redo", json!({})).unwrap();
        assert!(&*actual.active().unwrap().doc == &*after);
    }

    #[test]
    fn straighten_line_selected_group_child_is_transformed_once_and_native_background_converts() {
        let mut engine = fixture("rgb", 8);
        let child = engine.active().unwrap().active_layer.unwrap();
        engine
            .execute("layer.groupLayers", json!({"name":"Selected group"}))
            .unwrap();
        let group = engine.active().unwrap().active_layer.unwrap();
        engine
            .execute("layer.select", json!({"layer":child.0,"mode":"add"}))
            .unwrap();
        let before = engine.active().unwrap().clone();
        let mut expected = Session::new();
        expected.add_document((*before.doc).clone(), None);
        *expected.active_mut().unwrap() = before.clone();
        expected.select_layer(group).unwrap();
        expected
            .execute(
                "image.analysis.rulerTool",
                json!({"start":[5,12],"end":[41,18]}),
            )
            .unwrap();
        expected
            .execute("image.analysis.straightenLayer", json!({"crop":false}))
            .unwrap();
        execute(
            &mut engine,
            "image.analysis.straightenLayer",
            &json!({"start":[5,12],"end":[41,18],"crop":false}),
        )
        .unwrap()
        .unwrap();
        assert!(&*engine.active().unwrap().doc == &*expected.active().unwrap().doc);
        assert_eq!(
            engine.active().unwrap().selected_layers,
            before.selected_layers
        );
        assert_eq!(engine.active().unwrap().active_layer, Some(child));
        let background = engine.active().unwrap().doc.layers[0].id;
        engine.select_layer(background).unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        execute(
            &mut engine,
            "image.analysis.straightenLayer",
            &json!({"start":[5,12],"end":[41,18],"crop":false}),
        )
        .unwrap()
        .unwrap();
        let layer = engine.active().unwrap().doc.layer(background).unwrap();
        assert_eq!(layer.name, "Layer 0");
        assert!(!layer.locks.position && !layer.locks.transparency);
    }

    #[test]
    fn straighten_line_later_locked_child_and_unsavable_selection_leave_all_source_state_untouched()
    {
        let mut engine = fixture("rgb", 16);
        let first = engine.active().unwrap().active_layer.unwrap();
        engine
            .execute("layer.new.layer", json!({"name":"Locked child"}))
            .unwrap();
        let child = engine.active().unwrap().active_layer.unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[8,7],[38,11]],"size":4,"seed":2}),
            )
            .unwrap();
        engine
            .execute("layer.groupLayers", json!({"name":"Failure group"}))
            .unwrap();
        engine
            .execute("layer.select", json!({"layer":first.0,"mode":"add"}))
            .unwrap();
        engine
            .edit("Lock descendant", |doc, _| {
                doc.layer_mut(child).unwrap().locks.position = true;
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().clone();
        let journal = engine.journal.clone();
        let error = execute(
            &mut engine,
            "image.analysis.straightenLayer",
            &json!({"start":[5,12],"end":[41,18],"crop":false}),
        )
        .unwrap()
        .unwrap_err();
        assert!(error.contains("Locked child"));
        assert!(std::sync::Arc::ptr_eq(
            &engine.active().unwrap().doc,
            &before.doc
        ));
        assert_eq!(
            engine.active().unwrap().history.past_len(),
            before.history.past_len()
        );
        assert_eq!(
            engine.active().unwrap().selected_layers,
            before.selected_layers
        );
        assert_eq!(engine.journal, journal);
        engine
            .edit("Selection outside canvas", |doc, _| {
                doc.layer_mut(child).unwrap().locks.position = false;
                doc.selection
                    .as_mut()
                    .unwrap()
                    .write_region(Rect::new(-4, -3, 2, 2), &[1.0; 30]);
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().clone();
        let journal = engine.journal.clone();
        let error = execute(
            &mut engine,
            "image.analysis.straightenLayer",
            &json!({"start":[5,12],"end":[41,18],"crop":false}),
        )
        .unwrap()
        .unwrap_err();
        assert!(error.contains("coverage"));
        assert!(std::sync::Arc::ptr_eq(
            &engine.active().unwrap().doc,
            &before.doc
        ));
        assert_eq!(
            engine.active().unwrap().history.past_len(),
            before.history.past_len()
        );
        assert_eq!(engine.journal, journal);
    }

    #[test]
    fn straighten_line_matches_published_native_modes_depths_layer_selection_and_one_original_undo()
    {
        for mode in ["rgb", "gray", "cmyk", "lab"] {
            for depth in [8, 16, 32] {
                for crop in [false, true] {
                    let mut actual = fixture(mode, depth);
                    let before = actual.active().unwrap().clone();
                    let past = before.history.past_len();
                    let mut expected = Session::new();
                    expected.add_document((*before.doc).clone(), None);
                    *expected.active_mut().unwrap() = before.clone();
                    let line = json!({"start":[6.5,12.25],"end":[39.75,18.5]});
                    expected
                        .execute("image.analysis.rulerTool", line.clone())
                        .unwrap();
                    let oracle = expected
                        .execute("image.analysis.straightenLayer", json!({"crop":crop}))
                        .unwrap();
                    let mut params = line;
                    params["crop"] = json!(crop);
                    let result = execute(&mut actual, "image.analysis.straightenLayer", &params)
                        .unwrap()
                        .unwrap();
                    let after = actual.active().unwrap().doc.clone();
                    assert_eq!(result, oracle, "{mode}/{depth}/{crop}");
                    assert_eq!(&*after, &*expected.active().unwrap().doc);
                    assert!(after.measurement.ruler.is_none());
                    assert_eq!(after.icc_profile, before.doc.icc_profile);
                    assert_eq!(actual.active().unwrap().history.past_len(), past + 1);
                    if !crop {
                        assert_eq!(after.size, before.doc.size);
                        assert_eq!(after.layers[0], before.doc.layers[0]);
                    }
                    actual.execute("edit.undo", json!({})).unwrap();
                    assert_eq!(&*actual.active().unwrap().doc, &*before.doc);
                    actual.execute("edit.redo", json!({})).unwrap();
                    assert_eq!(&*actual.active().unwrap().doc, &*after);
                }
            }
        }
    }

    #[test]
    fn straighten_line_noop_invalid_endpoints_locked_layers_and_admission_leave_source_untouched() {
        let mut engine = fixture("rgb", 16);
        for (start, end) in [
            ([4.0, 7.0], [40.0, 7.0]),
            ([9.0, 3.0], [9.0, 30.0]),
            ([40.0, 7.0], [4.0, 7.0]),
        ] {
            let before = engine.active().unwrap().clone();
            let journal = engine.journal.clone();
            let result = execute(
                &mut engine,
                "image.analysis.straightenLayer",
                &json!({"start":start,"end":end,"crop":true}),
            )
            .unwrap()
            .unwrap();
            assert_eq!(result["angle"], 0.0);
            assert!(std::sync::Arc::ptr_eq(
                &before.doc,
                &engine.active().unwrap().doc
            ));
            assert_eq!(
                engine.active().unwrap().history.past_len(),
                before.history.past_len()
            );
            assert_eq!(engine.journal, journal);
        }
        for invalid in [
            json!({"start":[1,1]}),
            json!({"start":[1,1],"end":[1,1]}),
            json!({"start":[1,1],"end":[1.1,1.1]}),
            json!({"start":[1,1],"end":[9,10],"crop":"yes"}),
            json!({"start":[1e40,1],"end":[4,8]}),
            json!({"start":[1,1,4],"end":[4,8]}),
        ] {
            let before = engine.active().unwrap().clone();
            let journal = engine.journal.clone();
            assert!(
                execute(&mut engine, "image.analysis.straightenLayer", &invalid)
                    .unwrap()
                    .is_err()
            );
            assert!(std::sync::Arc::ptr_eq(
                &before.doc,
                &engine.active().unwrap().doc
            ));
            assert_eq!(
                engine.active().unwrap().history.past_len(),
                before.history.past_len()
            );
            assert_eq!(engine.journal, journal);
        }
        engine
            .edit("Locked layer", |doc, active| {
                doc.layer_mut(active.unwrap()).unwrap().locks.position = true;
                Ok(())
            })
            .unwrap();
        let before = engine.active().unwrap().clone();
        let journal = engine.journal.clone();
        assert!(execute(
            &mut engine,
            "image.analysis.straightenLayer",
            &json!({"start":[4,4],"end":[30,7],"crop":false})
        )
        .unwrap()
        .is_err());
        assert!(std::sync::Arc::ptr_eq(
            &before.doc,
            &engine.active().unwrap().doc
        ));
        assert_eq!(engine.journal, journal);
        assert!(admit(Size::new(65536, 65536), 20.0, true).is_err());
        let mut empty = Session::new();
        assert!(execute(
            &mut empty,
            "image.analysis.straightenLayer",
            &json!({"start":[1,1],"end":[8,4]})
        )
        .unwrap()
        .is_err());
        assert!(execute(
            &mut engine,
            "image.analysis.straightenLayer",
            &json!({"crop":true})
        )
        .is_none());
    }

    #[test]
    fn straighten_line_native_recipe_replays_without_host_extensions_and_nested_duplicate_rotation()
    {
        for crop in [false, true] {
            let mut engine = fixture("rgb", 16);
            let before = engine.active().unwrap().clone();
            let journal_start = engine.journal.len();
            execute(
                &mut engine,
                "image.analysis.straightenLayer",
                &json!({"start":[5,13],"end":[41,18],"crop":crop}),
            )
            .unwrap()
            .unwrap();
            let recipe = &engine.journal[journal_start..];
            assert_eq!(recipe.len(), 2);
            assert_eq!(recipe[0].0, "image.analysis.rulerTool");
            assert_eq!(recipe[1].0, "image.analysis.straightenLayer");
            let mut replay = Session::new();
            replay.add_document((*before.doc).clone(), None);
            *replay.active_mut().unwrap() = before;
            for (id, params) in recipe {
                replay.execute(id, params.clone()).unwrap();
            }
            assert_eq!(
                &*engine.active().unwrap().doc,
                &*replay.active().unwrap().doc
            );
        }
    }

    #[test]
    fn straighten_line_immutable_reopen_history_and_generated_exports_preserve_result() {
        for crop in [false, true] {
            let mut engine = fixture("rgb", 16);
            let before = engine.active().unwrap().doc.clone();
            execute(
                &mut engine,
                "image.analysis.straightenLayer",
                &json!({"start":[5,13],"end":[41,18],"crop":crop}),
            )
            .unwrap()
            .unwrap();
            let root =
                std::env::temp_dir().join(format!("xdesign-straighten-{}", ulid::Ulid::new()));
            let mut session = super::super::PhotoSession {
                engine,
                color_settings: None,
                version: String::new(),
                original_path: None,
                writer: Default::default(),
            };
            super::super::publish(&root, &ulid::Ulid::new().to_string(), &mut session).unwrap();
            let after = session.engine.active().unwrap().doc.clone();
            let mut reopened = super::super::restore(&root, &session.version, None).unwrap();
            assert_eq!(&*reopened.engine.active().unwrap().doc, &*after);
            reopened.engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(&*reopened.engine.active().unwrap().doc, &*before);
            for name in ["straightened.psd", "straightened.psb", "straightened.png"] {
                let bytes = photocraft_io::export(&after, name, &Default::default())
                    .unwrap()
                    .bytes;
                let imported = photocraft_io::import(name, &bytes).unwrap().document;
                assert_eq!(imported.size, after.size);
                assert_eq!(imported.icc_profile, after.icc_profile);
                assert_eq!(imported.depth, SampleType::U16);
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
