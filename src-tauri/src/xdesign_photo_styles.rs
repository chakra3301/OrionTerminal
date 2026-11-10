//! Indexed layer-style editing preserves fields that the upstream command
//! forms do not expose (imported contours, gradient stops and lighting).
use photocraft_engine::{
    doc::{Effect, LayerId},
    EngineError, Session,
};
use serde_json::{json, Value};

pub(super) const HOST_ADAPTER_IDS: [&str; 4] = [
    "layer.layerStyle.editEffect",
    "layer.layerStyle.removeEffect",
    "layer.layerStyle.moveEffect",
    "layer.layerStyle.duplicateEffect",
];
pub(super) fn catalog() -> Vec<Value> {
    HOST_ADAPTER_IDS.iter().map(|id| {
        let (label,params) = match *id {
            "layer.layerStyle.editEffect" => ("Edit individual effect", r#"{"layer":id?,"index":n,"path":[field…],"value":typed setting} (an empty path replaces all of the effect's settings)"#),
            "layer.layerStyle.removeEffect" => ("Remove individual effect", r#"{"layer":id?,"index":n}"#),
            "layer.layerStyle.moveEffect" => ("Reorder individual effect", r#"{"layer":id?,"index":n,"to":n}"#),
            _ => ("Duplicate individual effect", r#"{"layer":id?,"index":n}"#),
        };
        json!({"id":id,"label":label,"menu":["Layer","Layer Style"],"shortcut":null,"params":params,"engineRegistered":false,"hostDispatch":true})
    }).collect()
}

pub(super) fn settings(effect: &Effect) -> Value {
    let raw = serde_json::to_value(effect).unwrap_or(Value::Null);
    let (kind, value) = raw
        .as_object()
        .and_then(|map| map.iter().next())
        .map(|(kind, value)| (kind.as_str(), value.clone()))
        .unwrap_or(("", Value::Null));
    let mut colors = serde_json::Map::new();
    fn collect(value: &Value, path: &str, colors: &mut serde_json::Map<String, Value>) {
        if let Ok(color) = serde_json::from_value::<photocraft_engine::doc::Color>(value.clone()) {
            let [r, g, b] = color
                .to_rgb()
                .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
            colors.insert(path.into(), json!(format!("#{r:02x}{g:02x}{b:02x}")));
        } else if let Some(map) = value.as_object() {
            for (key, child) in map {
                collect(child, &format!("{path}/{key}"), colors);
            }
        } else if let Some(array) = value.as_array() {
            for (index, child) in array.iter().enumerate() {
                collect(child, &format!("{path}/{index}"), colors);
            }
        }
    }
    collect(&value, "", &mut colors);
    json!({"kind":effect.label(),"type":kind,"enabled":effect.enabled(),"settings":value,"colors":colors})
}

fn patch_path(value: &mut Value, path: &[Value], replacement: &Value) -> Result<(), String> {
    if path.is_empty() || path.len() > 12 {
        return Err("Choose an effect setting".into());
    }
    let key = path[0]
        .as_str()
        .ok_or("Effect paths must contain field names")?;
    let child = if let Some(map) = value.as_object_mut() {
        map.get_mut(key)
            .ok_or("This effect setting does not exist")?
    } else if let Some(array) = value.as_array_mut() {
        let index = key
            .parse::<usize>()
            .map_err(|_| "Invalid effect array index")?;
        array
            .get_mut(index)
            .ok_or("This effect setting does not exist")?
    } else {
        return Err("This effect setting cannot contain another field".into());
    };
    if path.len() == 1 {
        *child = replacement.clone();
        Ok(())
    } else {
        patch_path(child, &path[1..], replacement)
    }
}

fn validate_value(value: &Value, depth: usize) -> Result<(), String> {
    if depth > 12 {
        return Err("Effect settings are too deeply nested".into());
    }
    match value {
        Value::Number(number)
            if number
                .as_f64()
                .is_none_or(|v| !v.is_finite() || v.abs() > 100000.0) =>
        {
            return Err("Effect values must be finite and within editing limits".into())
        }
        Value::String(text) if text.len() > 4096 => return Err("Effect text is too long".into()),
        Value::Array(array) => {
            if array.len() > 256 {
                return Err("An effect setting can contain up to 256 entries".into());
            }
            for child in array {
                validate_value(child, depth + 1)?;
            }
        }
        Value::Object(map) => {
            if map.len() > 64 {
                return Err("An effect setting contains too many fields".into());
            }
            for child in map.values() {
                validate_value(child, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    if !HOST_ADAPTER_IDS.contains(&command) {
        return None;
    }
    Some((|| {
        let state = engine.active().ok_or("No image document")?;
        let layer = params["layer"]
            .as_u64()
            .map(LayerId)
            .or(state.active_layer)
            .ok_or("Select a layer")?;
        let index = params["index"]
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
            .ok_or("Choose an effect")?;
        let effects = &state
            .doc
            .layer(layer)
            .ok_or("The layer no longer exists")?
            .effects
            .items;
        let effect = effects.get(index).ok_or("The effect no longer exists")?;
        let replacement = if command == "layer.layerStyle.editEffect" {
            let path = params["path"]
                .as_array()
                .ok_or("Choose an effect setting")?;
            validate_value(&params["value"], 0)?;
            if !params
                .as_object()
                .is_some_and(|map| map.contains_key("value"))
            {
                return Err("An effect setting value is required".into());
            }
            let mut raw = serde_json::to_value(effect).map_err(|e| e.to_string())?;
            let body = raw
                .as_object_mut()
                .and_then(|map| map.values_mut().next())
                .ok_or("Invalid effect")?;
            if path.is_empty() {
                *body = params["value"].clone();
            } else {
                patch_path(body, path, &params["value"])?;
            }
            Some(
                serde_json::from_value::<Effect>(raw)
                    .map_err(|e| format!("Invalid effect setting: {e}"))?,
            )
        } else {
            None
        };
        let to = if command == "layer.layerStyle.moveEffect" {
            Some(
                params["to"]
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .filter(|v| *v < effects.len())
                    .ok_or("Choose a valid effect position")?,
            )
        } else {
            None
        };
        if command == "layer.layerStyle.duplicateEffect" && effects.len() >= 64 {
            return Err("A layer can contain up to 64 editable effects".into());
        }
        engine
            .edit("Edit layer effects", move |doc, _| {
                let effects = &mut doc
                    .layer_mut(layer)
                    .ok_or(EngineError::NoLayer(layer))?
                    .effects
                    .items;
                match command {
                    "layer.layerStyle.editEffect" => effects[index] = replacement.unwrap(),
                    "layer.layerStyle.removeEffect" => {
                        effects.remove(index);
                    }
                    "layer.layerStyle.moveEffect" => {
                        let effect = effects.remove(index);
                        effects.insert(to.unwrap(), effect);
                    }
                    "layer.layerStyle.duplicateEffect" => {
                        effects.insert(index + 1, effects[index].clone());
                    }
                    _ => unreachable!(),
                }
                Ok(())
            })
            .map_err(|e| e.to_string())?;
        Ok(json!({"layer":layer.0}))
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexed_styles_preserve_other_effects_imported_settings_and_undo() {
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":24,"height":24}))
            .unwrap();
        for size in [4, 8] {
            engine
                .execute(
                    "layer.layerStyle.dropShadow",
                    json!({"size":size,"add":true}),
                )
                .unwrap();
        }
        let before = engine.active().unwrap().doc.clone();
        execute(
            &mut engine,
            "layer.layerStyle.editEffect",
            &json!({"index":1,"path":["common","opacity"],"value":0.25}),
        )
        .unwrap()
        .unwrap();
        let after = &engine.active().unwrap().doc.layers[0].effects.items;
        assert_eq!(after[0], before.layers[0].effects.items[0]);
        assert_eq!(settings(&after[1])["settings"]["common"]["opacity"], 0.25);
        assert_eq!(settings(&after[1])["settings"]["size"].as_f64(), Some(8.0));
        assert!(execute(
            &mut engine,
            "layer.layerStyle.editEffect",
            &json!({"index":1,"path":["common","missing"],"value":1})
        )
        .unwrap()
        .is_err());
        assert!(execute(
            &mut engine,
            "layer.layerStyle.editEffect",
            &json!({"index":1,"path":["common","opacity"],"value":"invalid"})
        )
        .unwrap()
        .is_err());
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(
            engine.active().unwrap().doc.layers[0].effects,
            before.layers[0].effects
        );
        let first = settings(&before.layers[0].effects.items[0])["settings"].clone();
        execute(
            &mut engine,
            "layer.layerStyle.editEffect",
            &json!({"index":1,"path":[],"value":first}),
        )
        .unwrap()
        .unwrap();
        let after = &engine.active().unwrap().doc.layers[0].effects.items;
        assert_eq!(after[1], after[0]);
        assert!(execute(
            &mut engine,
            "layer.layerStyle.editEffect",
            &json!({"index":1,"path":[],"value":{"size":1}})
        )
        .unwrap()
        .is_err());
        engine.execute("edit.undo", json!({})).unwrap();
        execute(
            &mut engine,
            "layer.layerStyle.duplicateEffect",
            &json!({"index":0}),
        )
        .unwrap()
        .unwrap();
        execute(
            &mut engine,
            "layer.layerStyle.moveEffect",
            &json!({"index":2,"to":0}),
        )
        .unwrap()
        .unwrap();
        execute(
            &mut engine,
            "layer.layerStyle.removeEffect",
            &json!({"index":1}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            settings(&engine.active().unwrap().doc.layers[0].effects.items[0])["settings"]["size"]
                .as_f64(),
            Some(8.0)
        );
    }
}
