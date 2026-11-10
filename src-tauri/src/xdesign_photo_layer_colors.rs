//! Layer colour labels. The pinned engine keeps a label on every layer, and reads and writes it in PSDs as `lclr`,
//! but has no command to set one.
use photocraft_engine::{
    doc::{LabelColor, LayerId, Rect},
    EngineError, Session,
};
use serde_json::Value;

pub(super) const COMMAND: &str = "layer.setColor";

const COLORS: [(&str, LabelColor); 8] = [
    ("none", LabelColor::None),
    ("red", LabelColor::Red),
    ("orange", LabelColor::Orange),
    ("yellow", LabelColor::Yellow),
    ("green", LabelColor::Green),
    ("blue", LabelColor::Blue),
    ("violet", LabelColor::Violet),
    ("gray", LabelColor::Gray),
];

pub(super) fn name(label: LabelColor) -> &'static str {
    COLORS.iter().find(|(_, color)| *color == label).map_or("none", |(name, _)| name)
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    (command == COMMAND).then(|| set(engine, params))
}

/// `{"color": "none|red|…|gray", "layers": [id]?, "layer": id?}`: every listed layer, else the selected layers, as
/// Photoshop colours the whole selection.
fn set(engine: &mut Session, params: &Value) -> Result<Value, String> {
    if engine.active_job().is_some() {
        return Err("Wait for the current image operation to finish".into());
    }
    let color = params["color"].as_str().and_then(|wanted| COLORS.iter().find(|(name, _)| *name == wanted)).map(|(_, color)| *color)
        .ok_or_else(|| format!("Layer color must be one of {}", COLORS.map(|(name, _)| name).join(", ")))?;
    let state = engine.active().ok_or("No image document")?;
    let ids: Vec<LayerId> = match (&params["layers"], params["layer"].as_u64()) {
        (Value::Array(list), _) => list.iter().map(|id| id.as_u64().map(LayerId).ok_or("Layer ids must be numbers")).collect::<Result<_, _>>()?,
        (_, Some(id)) => vec![LayerId(id)],
        _ if !state.selected_layers.is_empty() => state.selected_layers.clone(),
        _ => state.active_layer.into_iter().collect(),
    };
    if ids.is_empty() {
        return Err("Select a layer to color".into());
    }
    for id in &ids {
        state.doc.layer(*id).ok_or_else(|| EngineError::NoLayer(*id).to_string())?;
    }
    if ids.iter().all(|id| state.doc.layer(*id).is_some_and(|layer| layer.label == color)) {
        return Ok(Value::Null);
    }
    engine.edit("Layer Properties", |doc, _| {
        for id in &ids {
            doc.layer_mut(*id).ok_or(EngineError::NoLayer(*id))?.label = color;
        }
        Ok(())
    }).map_err(|error| error.to_string())?;
    // A label changes no pixels, so nothing needs compositing again.
    if let Some(state) = engine.active_mut() {
        state.last_damage = Some(Rect::EMPTY);
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session() -> (Session, LayerId, LayerId) {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 8, "height": 8})).unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        let first = engine.active().unwrap().active_layer.unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        let second = engine.active().unwrap().active_layer.unwrap();
        (engine, first, second)
    }

    fn label(engine: &Session, id: LayerId) -> LabelColor {
        engine.active().unwrap().doc.layer(id).unwrap().label
    }

    #[test]
    fn colors_listed_or_selected_layers_in_one_undoable_step() {
        let (mut engine, first, second) = session();
        execute(&mut engine, COMMAND, &json!({"color": "red", "layers": [first.0, second.0]})).unwrap().unwrap();
        assert_eq!((label(&engine, first), label(&engine, second)), (LabelColor::Red, LabelColor::Red));
        assert_eq!(engine.active().unwrap().last_damage, Some(Rect::EMPTY));
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!((label(&engine, first), label(&engine, second)), (LabelColor::None, LabelColor::None));
        execute(&mut engine, COMMAND, &json!({"color": "violet"})).unwrap().unwrap();
        assert_eq!((label(&engine, first), label(&engine, second)), (LabelColor::None, LabelColor::Violet));
        assert_eq!(name(label(&engine, second)), "violet");
    }

    #[test]
    fn same_color_adds_no_step_and_bad_input_is_refused() {
        let (mut engine, first, _) = session();
        execute(&mut engine, COMMAND, &json!({"color": "green", "layer": first.0})).unwrap().unwrap();
        let revision = engine.active().unwrap().revision;
        execute(&mut engine, COMMAND, &json!({"color": "green", "layer": first.0})).unwrap().unwrap();
        assert_eq!(engine.active().unwrap().revision, revision);
        assert!(execute(&mut engine, COMMAND, &json!({"color": "pink"})).unwrap().is_err());
        assert!(execute(&mut engine, COMMAND, &json!({"color": "red", "layer": 9999})).unwrap().is_err());
        assert!(execute(&mut engine, "layer.setProps", &json!({})).is_none());
    }
}
