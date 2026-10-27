//! Layers-panel edits Photoshop makes in one step that the engine only offers per layer:
//! dragging several selected layers, the eye on one layer's Effects row, and folding several
//! groups with one modified click on a disclosure chevron.
use photocraft_engine::{doc::{Document, LayerContent, LayerId}, DocState, EngineError, Session};
use serde_json::{json, Value};
use std::sync::Arc;

/// Commands that only open or close groups: a view change, saved with the view instead of a new image version.
pub(super) const FOLDS: [&str; 2] = ["layer.setExpanded", "layer.setGroupsExpanded"];
/// Commands that step through history; the engine's snapshots carry the folds of their time.
pub(super) const HISTORY_STEPS: [&str; 3] = ["edit.undo", "edit.redo", "history.select"];

pub(super) fn catalog() -> Vec<Value> {
    vec![
        json!({"id":"layer.moveLayersTo","label":"Reorder Layers","menu":[],"shortcut":null,"params":r#"{"layers":[id…],"target":id,"position":"above|below|into"="above"}"#,"engineRegistered":false,"hostDispatch":true}),
        json!({"id":"layer.layerStyle.setEffectsEnabled","label":"Layer Effects Visibility","menu":[],"shortcut":null,"params":r#"{"layer":id?,"enabled":bool}"#,"engineRegistered":false,"hostDispatch":true}),
        json!({"id":"layer.setGroupsExpanded","label":"Expand/Collapse Groups","menu":[],"shortcut":null,"params":r#"{"layers":[id…],"expanded":bool} (not an undo step)"#,"engineRegistered":false,"hostDispatch":true}),
    ]
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    match command {
        "layer.moveLayersTo" => Some(move_layers(engine, params)),
        "layer.layerStyle.setEffectsEnabled" => Some(set_effects_enabled(engine, params)),
        "layer.setGroupsExpanded" => Some(set_groups_expanded(engine, params)),
        "layer.new.frameFromLayers" if params.get("width").is_some() || params.get("height").is_some() => Some(sized_frame(engine, params)),
        _ => None,
    }
}

/// Photoshop's Add Frame to Layer dialog sizes the frame, centred on the layers' bounds; the engine only frames the bounds exactly.
fn sized_frame(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let side = |key: &str| params.get(key).map(|value| value.as_f64().filter(|value| (1.0..=32768.0).contains(value)).map(|value| value.round() as i32).ok_or("Frame width and height must be 1 to 32768 px")).transpose();
    let (width, height) = (side("width")?, side("height")?);
    let mut forwarded = serde_json::Map::new();
    if let Some(name) = params.get("name") { forwarded.insert("name".into(), name.clone()); }
    let mut result = engine.execute("layer.new.frameFromLayers", Value::Object(forwarded)).map_err(|e| e.to_string())?;
    let frame: Vec<i32> = result["frame"].as_array().into_iter().flatten().filter_map(|v| v.as_i64().map(|v| v as i32)).collect();
    let (&[x, y, w, h], Some(group)) = (frame.as_slice(), result["layer"].as_u64().map(LayerId)) else { return Ok(result) };
    let (width, height) = (width.unwrap_or(w), height.unwrap_or(h));
    if (width, height) == (w, h) { return Ok(result); }
    if width as u64 * height as u64 > super::MAX_PIXELS {
        engine.undo();
        if let Some(state) = engine.active_mut() { state.history.clear_redo(); }
        return Err("Choose a frame within the image editing limits.".into());
    }
    let (x0, y0) = (x + (w - width).div_euclid(2), y + (h - height).div_euclid(2));
    let rect = photocraft_engine::doc::Rect::new(x0, y0, x0 + width, y0 + height);
    let state = engine.active_mut().ok_or("No image document")?;
    let layer = Arc::make_mut(&mut state.doc).layer_mut(group).ok_or("The frame was not created")?;
    let mut mask = photocraft_engine::doc::LayerMask::hide_all();
    let row = vec![1.0f32; width as usize];
    for top in rect.y0..rect.y1 { mask.surface.write_region(photocraft_engine::doc::Rect::new(rect.x0, top, rect.x1, top + 1), &row); }
    mask.surface.prune();
    layer.mask = Some(mask);
    result["frame"] = json!([x0, y0, width, height]);
    Ok(result)
}

fn move_layers(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let ids = params["layers"]
        .as_array()
        .filter(|ids| !ids.is_empty() && ids.len() <= 1024)
        .ok_or("Choose the layers to move")?
        .iter()
        .map(|id| id.as_u64().map(LayerId).ok_or("Invalid layer"))
        .collect::<Result<Vec<_>, _>>()?;
    let target = params["target"].as_u64().map(LayerId).ok_or("Choose where to move the layers")?;
    let position = params["position"].as_str().unwrap_or("above");
    if !["above", "below", "into"].contains(&position) {
        return Err("Layers move above, below or into a layer".into());
    }
    let order = {
        let doc = &engine.active().ok_or("No image document")?.doc;
        let walk = doc.walk();
        let path_of = |id: LayerId| walk.iter().find(|(_, _, layer)| layer.id == id).map(|(path, _, layer)| (path.clone(), layer.children().is_some()));
        let (target_path, group) = path_of(target).ok_or("The target layer no longer exists")?;
        if position == "into" && !group {
            return Err("Layers can only be moved into a group".into());
        }
        let moved = ids.iter().map(|id| path_of(*id).map(|(path, _)| path).ok_or("A moved layer no longer exists")).collect::<Result<Vec<_>, _>>()?;
        if moved.iter().any(|path| target_path.starts_with(path)) {
            return Err("Layers can't be moved into themselves".into());
        }
        // A moving group carries its children, and the block keeps the stack's bottom-to-top order.
        walk.iter()
            .filter(|(path, _, _)| moved.contains(path) && !moved.iter().any(|other| other.len() < path.len() && path.starts_with(other)))
            .map(|(_, _, layer)| layer.id)
            .collect::<Vec<_>>()
    };
    engine
        .edit("Reorder Layers", |doc, _| {
            let layers = order.iter().map(|id| doc.remove(*id).ok_or(EngineError::NoLayer(*id))).collect::<Result<Vec<_>, _>>()?;
            let path = doc.path_of(target).ok_or(EngineError::NoLayer(target))?;
            let (siblings, at) = if position == "into" {
                let group = doc.layer_at_mut(&path).and_then(|layer| layer.children_mut()).ok_or_else(|| EngineError::Other("target is not a group".into()))?;
                let top = group.len();
                (group, top)
            } else {
                let (&last, parent) = path.split_last().ok_or(EngineError::NoLayer(target))?;
                let siblings = if parent.is_empty() {
                    &mut doc.layers
                } else {
                    doc.layer_at_mut(parent).and_then(|layer| layer.children_mut()).ok_or_else(|| EngineError::Other("target's parent is not a group".into()))?
                };
                (siblings, if position == "below" { last } else { last + 1 })
            };
            let at = at.min(siblings.len());
            siblings.splice(at..at, layers);
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    Ok(json!({"layers":order.iter().map(|id| id.0).collect::<Vec<_>>()}))
}

fn set_effects_enabled(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let layer = params["layer"].as_u64().map(LayerId).or(state.active_layer).ok_or("Select a layer")?;
    let enabled = params["enabled"].as_bool().ok_or("Choose whether the effects are shown")?;
    if state.doc.layer(layer).ok_or("The layer no longer exists")?.effects.items.is_empty() {
        return Err("This layer has no effects".into());
    }
    engine
        .edit(if enabled { "Show Layer Effects" } else { "Hide Layer Effects" }, |doc, _| {
            doc.layer_mut(layer).ok_or(EngineError::NoLayer(layer))?.effects.enabled = enabled;
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    Ok(json!({"layer":layer.0,"enabled":enabled}))
}

fn set_groups_expanded(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let ids = params["layers"]
        .as_array()
        .filter(|ids| !ids.is_empty() && ids.len() <= 1024)
        .ok_or("Choose the groups to open or close")?
        .iter()
        .map(|id| id.as_u64().map(LayerId).ok_or("Invalid layer"))
        .collect::<Result<Vec<_>, _>>()?;
    let expanded = params["expanded"].as_bool().ok_or("Choose whether the groups open or close")?;
    let doc = &engine.active().ok_or("No image document")?.doc;
    if !ids.iter().all(|id| matches!(doc.layer(*id).map(|layer| &layer.content), Some(LayerContent::Group(_)))) {
        return Err("Only groups open and close".into());
    }
    set_expanded(engine, &ids, expanded)?;
    Ok(json!({"layers":ids.iter().map(|id| id.0).collect::<Vec<_>>(),"expanded":expanded}))
}

fn set_expanded(engine: &mut Session, ids: &[LayerId], expanded: bool) -> Result<(), String> {
    for id in ids {
        engine.execute("layer.setExpanded", json!({"layer":id.0,"expanded":expanded})).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Photoshop opens the closed groups around a layer that becomes active by whatever means
/// (Auto-Select on the canvas, Select › layer commands, undo); closing the group around the
/// active layer leaves it closed until the next change.
pub(super) fn reveal_active(engine: &mut Session, before: Option<LayerId>) -> Result<(), String> {
    let Some(state) = engine.active() else { return Ok(()) };
    let Some(active) = state.active_layer.filter(|id| Some(*id) != before) else { return Ok(()) };
    let Some(path) = state.doc.path_of(active) else { return Ok(()) };
    let closed: Vec<_> = (1..path.len())
        .filter_map(|n| state.doc.layer_at(path.get(..n)?))
        .filter(|layer| matches!(&layer.content, LayerContent::Group(group) if !group.expanded))
        .map(|layer| layer.id)
        .collect();
    set_expanded(engine, &closed, true)
}

/// A fold leaves the version's bundle as it was, so its saved view carries the groups' state back onto the document.
pub(super) fn restore_folds(state: &mut DocState, view: &Value) {
    fn saved(layers: &Value, out: &mut Vec<(LayerId, bool)>) {
        for layer in layers.as_array().into_iter().flatten() {
            if let (Some(id), Some(expanded)) = (layer["id"].as_u64(), layer["expanded"].as_bool()) {
                out.push((LayerId(id), expanded));
            }
            saved(&layer["children"], out);
        }
    }
    let mut folds = Vec::new();
    saved(&view["layers"], &mut folds);
    set_folds(state, folds);
}

/// Photoshop's undo and History steps leave groups open or closed as they were.
pub(super) fn keep_folds(state: &mut DocState, before: &Document) {
    let folds = before
        .walk()
        .into_iter()
        .filter_map(|(_, _, layer)| match &layer.content {
            LayerContent::Group(group) => Some((layer.id, group.expanded)),
            _ => None,
        })
        .collect();
    set_folds(state, folds);
}

fn set_folds(state: &mut DocState, mut folds: Vec<(LayerId, bool)>) {
    folds.retain(|(id, expanded)| matches!(state.doc.layer(*id).map(|layer| &layer.content), Some(LayerContent::Group(group)) if group.expanded != *expanded));
    if folds.is_empty() {
        return;
    }
    let doc = Arc::make_mut(&mut state.doc);
    for (id, expanded) in folds {
        if let Some(LayerContent::Group(group)) = doc.layer_mut(id).map(|layer| &mut layer.content) {
            group.expanded = expanded;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn names(engine: &Session) -> Vec<String> {
        fn rec(layers: &[photocraft_engine::doc::Layer], out: &mut Vec<String>) {
            for layer in layers {
                out.push(layer.name.clone());
                if let Some(children) = layer.children() {
                    out.push("[".into());
                    rec(children, out);
                    out.push("]".into());
                }
            }
        }
        let mut out = Vec::new();
        rec(&engine.active().unwrap().doc.layers, &mut out);
        out
    }
    fn id(engine: &Session, name: &str) -> u64 {
        engine.active().unwrap().doc.walk().into_iter().find(|(_, _, layer)| layer.name == name).unwrap().2.id.0
    }

    #[test]
    fn moves_selected_layers_as_one_block_in_one_history_step() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":16,"height":16})).unwrap();
        for name in ["A", "B", "C"] {
            engine.execute("layer.new.layer", json!({})).unwrap();
            let layer = engine.active().unwrap().active_layer.unwrap().0;
            engine.execute("layer.setProps", json!({"layer":layer,"name":name})).unwrap();
        }
        engine.execute("layer.new.group", json!({})).unwrap();
        let group = engine.active().unwrap().active_layer.unwrap().0;
        engine.execute("layer.setProps", json!({"layer":group,"name":"G"})).unwrap();
        let before = names(&engine);
        assert_eq!(before.iter().filter(|name| ["A", "B", "C", "G"].contains(&name.as_str())).count(), 4, "{before:?}");
        let (a, b, c) = (id(&engine, "A"), id(&engine, "B"), id(&engine, "C"));
        let active = engine.active().unwrap().active_layer;
        execute(&mut engine, "layer.moveLayersTo", &json!({"layers":[c,a],"target":group,"position":"into"})).unwrap().unwrap();
        let after = names(&engine);
        let inside = after.iter().position(|name| name == "[").unwrap();
        assert_eq!(&after[inside..inside + 4], ["[", "A", "C", "]"], "{after:?}");
        assert_eq!(engine.active().unwrap().active_layer, active);
        execute(&mut engine, "layer.moveLayersTo", &json!({"layers":[a,c],"target":b,"position":"below"})).unwrap().unwrap();
        let below = names(&engine);
        let at = below.iter().position(|name| name == "B").unwrap();
        assert_eq!(&below[at - 2..=at], ["A", "C", "B"], "{below:?}");
        assert!(execute(&mut engine, "layer.moveLayersTo", &json!({"layers":[group],"target":group,"position":"into"})).unwrap().is_err());
        assert!(execute(&mut engine, "layer.moveLayersTo", &json!({"layers":[a],"target":b,"position":"into"})).unwrap().is_err());
        engine.execute("edit.undo", json!({})).unwrap();
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(names(&engine), before);
    }

    #[test]
    fn a_group_carries_its_selected_children_and_effects_toggle_per_layer() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":16,"height":16})).unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        let child = engine.active().unwrap().active_layer.unwrap().0;
        let group = engine.execute("layer.new.groupFromLayers", json!({})).unwrap()["layer"].as_u64().unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        let top = engine.active().unwrap().active_layer.unwrap().0;
        execute(&mut engine, "layer.moveLayersTo", &json!({"layers":[group,child],"target":top,"position":"above"})).unwrap().unwrap();
        let layers = &engine.active().unwrap().doc.layers;
        assert_eq!(layers.last().unwrap().id.0, group);
        assert_eq!(layers.last().unwrap().children().unwrap()[0].id.0, child);

        assert!(execute(&mut engine, "layer.layerStyle.setEffectsEnabled", &json!({"layer":top,"enabled":false})).unwrap().is_err());
        engine.execute("layer.layerStyle.dropShadow", json!({"add":true})).unwrap();
        execute(&mut engine, "layer.layerStyle.setEffectsEnabled", &json!({"layer":top,"enabled":false})).unwrap().unwrap();
        assert!(!engine.active().unwrap().doc.layer(LayerId(top)).unwrap().effects.enabled);
        engine.execute("edit.undo", json!({})).unwrap();
        assert!(engine.active().unwrap().doc.layer(LayerId(top)).unwrap().effects.enabled);
    }

    fn nested() -> (Session, u64, u64, u64, u64) {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":16,"height":16})).unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        let deep = engine.active().unwrap().active_layer.unwrap().0;
        let inner = engine.execute("layer.groupLayers", json!({"name":"Inner"})).unwrap()["layer"].as_u64().unwrap();
        let outer = engine.execute("layer.groupLayers", json!({"layer":inner,"name":"Outer"})).unwrap()["layer"].as_u64().unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        let top = engine.active().unwrap().active_layer.unwrap().0;
        (engine, deep, inner, outer, top)
    }
    fn open(engine: &Session, group: u64) -> bool {
        matches!(&engine.active().unwrap().doc.layer(LayerId(group)).unwrap().content, photocraft_engine::doc::LayerContent::Group(g) if g.expanded)
    }

    #[test]
    fn folds_several_groups_at_once_without_a_history_step_and_refuses_a_layer() {
        let (mut engine, deep, inner, outer, _) = nested();
        let steps = engine.active().unwrap().history.entries().len();
        execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[outer,inner],"expanded":false})).unwrap().unwrap();
        assert!(!open(&engine, outer) && !open(&engine, inner));
        assert_eq!(engine.active().unwrap().history.entries().len(), steps);
        assert!(execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[outer,deep],"expanded":true})).unwrap().is_err());
        assert!(!open(&engine, outer), "a refused fold changes nothing");
        assert!(execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[outer]})).unwrap().is_err());
    }

    #[test]
    fn a_layer_that_becomes_active_opens_its_closed_groups_but_closing_around_it_does_not() {
        let (mut engine, deep, inner, outer, top) = nested();
        execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[outer,inner],"expanded":false})).unwrap().unwrap();
        engine.execute("layer.select", json!({"layer":deep})).unwrap();
        reveal_active(&mut engine, Some(LayerId(top))).unwrap();
        assert!(open(&engine, outer) && open(&engine, inner));
        execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[outer],"expanded":false})).unwrap().unwrap();
        reveal_active(&mut engine, Some(LayerId(deep))).unwrap();
        assert!(!open(&engine, outer));
    }

    #[test]
    fn saved_folds_come_back_on_the_document() {
        let (mut engine, _, inner, outer, _) = nested();
        execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[inner],"expanded":false})).unwrap().unwrap();
        let view = photocraft_engine::inspect::document(engine.active().unwrap());
        execute(&mut engine, "layer.setGroupsExpanded", &json!({"layers":[inner,outer],"expanded":true})).unwrap().unwrap();
        restore_folds(engine.active_mut().unwrap(), &view);
        assert!(open(&engine, outer) && !open(&engine, inner));
    }

    #[test]
    fn a_sized_frame_is_centred_on_the_layer_bounds_in_one_step_like_photoshops_add_frame_dialog() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":200,"height":200})).unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        engine.execute("select.rect", json!({"x":40,"y":40,"width":80,"height":80})).unwrap();
        engine.execute("edit.fill", json!({"contents":"foreground"})).unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        let steps = engine.active().unwrap().history.entries().len();
        let result = execute(&mut engine, "layer.new.frameFromLayers", &json!({"name":"Frame 1","width":20,"height":80})).unwrap().unwrap();
        assert_eq!(result["frame"], json!([70, 40, 20, 80]));
        let state = engine.active().unwrap();
        assert_eq!(state.history.entries().len(), steps + 1);
        let group = state.doc.layer(LayerId(result["layer"].as_u64().unwrap())).unwrap();
        assert_eq!(group.name, "Frame 1");
        let mask = group.mask.as_ref().unwrap();
        assert_eq!((mask.value(69, 60), mask.value(70, 60), mask.value(89, 60), mask.value(90, 60)), (0.0, 1.0, 1.0, 0.0));
        assert!(execute(&mut engine, "layer.new.frameFromLayers", &json!({"width":0})).unwrap().is_err());
        let steps = engine.active().unwrap().history.entries().len();
        assert!(execute(&mut engine, "layer.new.frameFromLayers", &json!({"width":32768,"height":32768})).unwrap().is_err());
        assert_eq!(engine.active().unwrap().history.entries().len(), steps, "an oversized frame leaves nothing behind");
        assert!(execute(&mut engine, "layer.new.frameFromLayers", &json!({"name":"Plain"})).is_none(), "an unsized frame stays with the engine");
    }
}
