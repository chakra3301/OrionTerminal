use photocraft_engine::Session;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs::File, io::Read, path::Path};

const MAX_BYTES: u64 = 4096;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedColors {
    schema_version: u32,
    foreground: [f32; 4],
    background: [f32; 4],
}
fn valid(colors: &SavedColors) -> bool {
    colors.schema_version == 1
        && colors
            .foreground
            .iter()
            .chain(&colors.background)
            .all(|v| v.is_finite())
}
pub(super) fn load(dir: &Path, engine: &mut Session) -> (bool, Option<String>) {
    let path = dir.join("colors.json");
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (true, None),
        Err(error) => return (false, Some(format!("Paint colors could not be restored: {error}. Saved data is retained; changes apply to this session."))),
    };
    let result = (|| {
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("saved colors exceed 4KB".to_string());
        }
        let colors: SavedColors =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        if !valid(&colors) {
            return Err("unsupported or invalid saved colors".into());
        }
        engine.tools.foreground = colors.foreground;
        engine.tools.background = colors.background;
        Ok(())
    })();
    match result {
        Ok(()) => (true, None),
        Err(error) => (false, Some(format!("Paint colors could not be restored: {error}. Saved data is retained; changes apply to this session."))),
    }
}
pub(super) fn save(dir: &Path, engine: &Session, writable: bool) -> Result<(), String> {
    if !writable {
        return Err("Saved paint colors are retained because they could not be restored; changes apply to this session.".into());
    }
    let colors = SavedColors {
        schema_version: 1,
        foreground: engine.tools.foreground,
        background: engine.tools.background,
    };
    if !valid(&colors) {
        return Err("Non-finite paint colors cannot be saved; previous data is retained.".into());
    }
    let bytes = serde_json::to_vec(&colors).map_err(|error| error.to_string())?;
    photocraft_format::atomic_write(&dir.join("colors.json"), &bytes).map_err(|error| {
        format!("Paint colors could not be saved: {error}. Changes apply to this session.")
    })
}
pub(super) fn inspect(engine: &Session) -> Value {
    json!({"foreground": engine.tools.foreground, "background": engine.tools.background})
}
pub(super) fn preset_background(value: &Value) -> Result<[f32; 4], String> {
    let values = value
        .as_array()
        .filter(|values| (3..=4).contains(&values.len()))
        .ok_or("Invalid preset background color")?;
    let mut result = [0.0, 0.0, 0.0, 1.0];
    for (index, value) in values.iter().enumerate() {
        let value = value.as_f64().ok_or("Invalid preset background color")? as f32;
        if !value.is_finite() {
            return Err("Invalid preset background color".into());
        }
        result[index] = value;
    }
    Ok(result)
}
