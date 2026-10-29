//! Brush library parts the engine lacks: empty preset groups (Create New Group), copying a
//! preset's tip into Brush Tip Shape or Dual Brush by name, and the identities the Brush
//! Settings pickers show (tip preset or hash, texture pattern id).
//!
//! The engine derives groups from its presets, so an empty group lives in `brush-groups.json`
//! in the profile's tool directory. The tool directory reaches the state builder through the
//! thread that ran `tools::activate`/`execute` (one profile per Orion process).
use photocraft_engine::{
    paint::{GrayTile, TipShape},
    Session,
};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const FILE: &str = "brush-groups.json";
const MAX_NAME: usize = photocraft_engine::brush_preset_cmds::MAX_NAME;

thread_local! { static DIR: RefCell<Option<PathBuf>> = const { RefCell::new(None) }; }

fn store() -> &'static Mutex<HashMap<PathBuf, Vec<String>>> {
    static STORE: OnceLock<Mutex<HashMap<PathBuf, Vec<String>>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Marks `dir` as the tool directory of the command running on this thread.
pub(super) fn enter(dir: &Path) {
    DIR.with(|current| *current.borrow_mut() = Some(dir.into()));
}

/// The tool directory `enter` marked on this thread, for the other profile sidecars.
pub(super) fn profile_dir() -> Option<PathBuf> {
    DIR.with(|current| current.borrow().clone())
}

fn read(dir: &Path) -> Vec<String> {
    std::fs::read(dir.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value["groups"].as_array().cloned())
        .map(|groups| groups.iter().filter_map(|group| group.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

fn with_groups<T>(work: impl FnOnce(&Path, &mut Vec<String>) -> Result<T, String>) -> Result<T, String> {
    let dir = DIR.with(|current| current.borrow().clone()).ok_or("The brush library is not loaded")?;
    let mut store = store().lock().map_err(|_| "Brush library needs to be restarted")?;
    let groups = store.entry(dir.clone()).or_insert_with(|| read(&dir));
    work(&dir, groups)
}

fn save(dir: &Path, groups: &[String]) -> Result<(), String> {
    let bytes = serde_json::to_vec(&json!({ "groups": groups })).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(dir).map_err(|error| format!("Brush groups could not be saved: {error}"))?;
    photocraft_format::atomic_write(&dir.join(FILE), &bytes).map_err(|error| format!("Brush groups could not be saved: {error}"))
}

/// Every group in panel order: the engine's groups (first appearance), then the empty groups in
/// the order they were created.
pub(super) fn groups(engine: &Session) -> Vec<String> {
    let mut order = photocraft_engine::brush_preset_cmds::group_order(&engine.tools.presets);
    let empty = with_groups(|_, groups| Ok(groups.clone())).unwrap_or_default();
    for group in empty {
        if !order.contains(&group) {
            order.push(group);
        }
    }
    order
}

fn name(command: &str, params: &Value, key: &str) -> Result<String, String> {
    let value = params.get(key).ok_or_else(|| format!("{command}: {key} is required"))?;
    let text = value.as_str().ok_or_else(|| format!("{command}: {key} must be a string"))?.trim();
    if text.is_empty() {
        return Err(format!("{command}: {key} must not be empty"));
    }
    if text.chars().count() > MAX_NAME {
        return Err(format!("{command}: {key} is longer than {MAX_NAME} characters"));
    }
    Ok(text.to_owned())
}

fn engine_run(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
    engine.execute(command, params.clone()).map_err(|error| error.to_string())
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    match command {
        "brush.presets.newGroup" => Some(new_group(engine, params)),
        "brush.presets.renameGroup" if listed(params) => Some(rename_group(engine, params)),
        "brush.presets.deleteGroup" if listed(params) => Some(delete_group(engine, params)),
        "tools.setBrush" if has_tip_preset(params) => Some(set_tip(engine, params)),
        _ => None,
    }
}

fn new_group(engine: &Session, params: &Value) -> Result<Value, String> {
    let command = "brush.presets.newGroup";
    let group = name(command, params, "group")?;
    if groups(engine).contains(&group) {
        return Err(format!("{command}: group \"{group}\" already exists"));
    }
    with_groups(|dir, groups| {
        let mut next = groups.clone();
        next.push(group.clone());
        save(dir, &next)?;
        *groups = next;
        Ok(json!({ "group": group }))
    })
}

/// Renaming or deleting a group the engine alone knows stays native.
fn listed(params: &Value) -> bool {
    let group = params["group"].as_str().map(str::trim).unwrap_or_default();
    with_groups(|_, groups| Ok(groups.iter().any(|existing| existing == group))).unwrap_or(false)
}

fn group_param(params: &Value) -> String {
    params["group"].as_str().map(str::trim).unwrap_or_default().to_owned()
}

fn in_engine(engine: &Session, group: &str) -> bool {
    engine.tools.presets.iter().any(|preset| preset.group == group)
}

fn rename_group(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let command = "brush.presets.renameGroup";
    let group = group_param(params);
    let new = name(command, params, "newName")?;
    if new != group && groups(engine).contains(&new) {
        return Err(format!("{command}: a group named \"{new}\" already exists"));
    }
    let result = if in_engine(engine, &group) { engine_run(engine, command, params)? } else { json!({ "group": new }) };
    with_groups(|dir, groups| {
        let next: Vec<String> = groups.iter().map(|existing| if *existing == group { new.clone() } else { existing.clone() }).collect();
        save(dir, &next)?;
        *groups = next;
        Ok(result)
    })
}

fn delete_group(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let command = "brush.presets.deleteGroup";
    let group = group_param(params);
    let result = if in_engine(engine, &group) {
        engine_run(engine, command, params)?
    } else {
        json!({ "deleted": 0, "count": engine.tools.presets.len() })
    };
    with_groups(|dir, groups| {
        let next: Vec<String> = groups.iter().filter(|existing| **existing != group).cloned().collect();
        save(dir, &next)?;
        *groups = next;
        Ok(result)
    })
}

fn has_tip_preset(params: &Value) -> bool {
    params.get("tipPreset").is_some() || params["dualBrush"].get("tipPreset").is_some()
}

fn preset_tip(engine: &Session, value: &Value, key: &str) -> Result<TipShape, String> {
    let command = "tools.setBrush";
    let wanted = value.as_str().ok_or_else(|| format!("{command}: {key} must be a brush preset name"))?;
    engine
        .tools
        .presets
        .iter()
        .find(|preset| preset.name.eq_ignore_ascii_case(wanted.trim()))
        .map(|preset| preset.brush.tip.clone())
        .ok_or_else(|| format!("{command}: {key} \"{wanted}\" is not a brush preset"))
}

/// `tipPreset` / `dualBrush.tipPreset` become the preset's tip in the patch itself, so the
/// journal replays the same tip without the library.
fn set_tip(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let command = "tools.setBrush";
    let mut patch = params.clone();
    if let Some(value) = params.get("tipPreset") {
        if params.get("tip").is_some() {
            return Err(format!("{command}: tipPreset and tip cannot both be set"));
        }
        let tip = preset_tip(engine, value, "tipPreset")?;
        patch.as_object_mut().ok_or("tools.setBrush: parameters must be an object")?.remove("tipPreset");
        patch["tip"] = serde_json::to_value(tip).map_err(|error| error.to_string())?;
    }
    if let Some(value) = params["dualBrush"].get("tipPreset") {
        if params["dualBrush"].get("tip").is_some() {
            return Err(format!("{command}: dualBrush.tipPreset and dualBrush.tip cannot both be set"));
        }
        let tip = preset_tip(engine, value, "dualBrush.tipPreset")?;
        let dual = patch["dualBrush"].as_object_mut().ok_or("tools.setBrush: dualBrush must be an object")?;
        dual.remove("tipPreset");
        dual.insert("tip".into(), serde_json::to_value(tip).map_err(|error| error.to_string())?);
    }
    // A tip pick is one click, never part of a slider gesture.
    patch.as_object_mut().ok_or("tools.setBrush: parameters must be an object")?.remove("coalesce");
    engine_run(engine, command, &patch)
}

fn fnv(tile: &GrayTile) -> u64 {
    let step = |hash: u64, bytes: &[u8]| bytes.iter().fold(hash, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3));
    let mut hash = step(0xcbf2_9ce4_8422_2325, &tile.width.to_le_bytes());
    hash = step(hash, &tile.height.to_le_bytes());
    for value in &tile.data {
        hash = step(hash, &value.to_le_bytes());
    }
    hash
}

/// `{id, preset}`: "round" or "sampled:<16 hex>" (FNV-1a of the bitmap), and the first library
/// preset whose sampled tip is that bitmap.
pub(super) fn tip_identity(engine: &Session, tip: &TipShape) -> Value {
    match tip {
        TipShape::Round => json!({ "id": "round", "preset": null }),
        TipShape::Sampled(tile) => json!({
            "id": format!("sampled:{:016x}", fnv(tile)),
            "preset": engine.tools.presets.iter().find(|preset| matches!(&preset.brush.tip, TipShape::Sampled(other) if other == tile)).map(|preset| preset.name.clone()),
        }),
    }
}

/// The library pattern whose grey tile (`brush.texturePattern`'s luminance over white) is the
/// brush texture, if any.
pub(super) fn texture_pattern_id(engine: &Session) -> Option<String> {
    let photocraft_engine::paint::Pattern::Tile(tile) = &engine.tools.brush.texture.pattern else { return None };
    engine
        .patterns
        .items
        .iter()
        .filter(|pattern| pattern.width == tile.width && pattern.height == tile.height)
        .find(|pattern| {
            let mut pixels = vec![[0.0f32; 4]; (pattern.width * pattern.height) as usize];
            pattern.surface.read_rgba_into(pattern.rect(), &mut pixels);
            let luminance: Vec<f32> = pixels.iter().map(|q| (0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2]) * q[3] + (1.0 - q[3])).collect();
            GrayTile::from_f32(pattern.width, pattern.height, &luminance) == *tile
        })
        .map(|pattern| pattern.id.clone())
}

/// The state's brush additions: group list, tip identities and the texture pattern id.
pub(super) fn describe(engine: &Session, state: &mut Value) {
    state["groups"] = json!(groups(engine));
    state["tip"] = tip_identity(engine, &engine.tools.brush.tip);
    state["dualTip"] = tip_identity(engine, &engine.tools.brush.dual_brush.tip);
    state["settings"]["texture"]["patternId"] = json!(texture_pattern_id(engine));
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, SampleType, Size};

    fn profile() -> PathBuf {
        std::env::temp_dir().join(format!("orion-brush-groups-{}", ulid::Ulid::new()))
    }
    fn session() -> Session {
        let mut engine = Session::new();
        engine.add_document(Document::new("Brush", Size::new(4, 4), ColorMode::Rgb, SampleType::U8), None);
        engine
    }
    fn run(dir: &Path, engine: &mut Session, command: &str, params: Value) -> Result<Value, String> {
        super::super::tools::execute(dir, engine, command, |engine| super::super::execute_view_command(engine, command, params)).map(|(value, _)| value)
    }
    fn sampled(seed: u16) -> TipShape {
        TipShape::Sampled(GrayTile { width: 3, height: 2, data: (0..6).map(|index| index * 1000 + seed).collect() })
    }
    fn add_preset(dir: &Path, engine: &mut Session, name: &str, tip: TipShape) {
        let mut brush = engine.tools.brush.clone();
        brush.tip = tip;
        run(dir, engine, "brush.presets.save", json!({ "name": name, "brush": serde_json::to_value(&brush).unwrap() })).unwrap();
    }
    fn saved_brush(dir: &Path) -> photocraft_engine::BrushSettings {
        serde_json::from_slice(&std::fs::read(dir.join("brush.json")).unwrap()).unwrap()
    }
    fn forget(dir: &Path) {
        store().lock().unwrap().remove(dir);
    }

    #[test]
    fn new_group_persists_lists_and_refuses_empty_or_duplicate_names() {
        let dir = profile();
        let mut engine = session();
        super::super::tools::activate(&dir, &mut engine).unwrap();
        assert_eq!(run(&dir, &mut engine, "brush.presets.newGroup", json!({ "group": "  Inks  " })).unwrap(), json!({ "group": "Inks" }));
        let listed = super::super::tools::inspect(&engine);
        assert_eq!(listed["groups"].as_array().unwrap().last().unwrap(), "Inks");
        for (params, error) in [
            (json!({ "group": "Inks" }), "brush.presets.newGroup: group \"Inks\" already exists"),
            (json!({ "group": "  " }), "brush.presets.newGroup: group must not be empty"),
            (json!({ "group": 7 }), "brush.presets.newGroup: group must be a string"),
            (json!({}), "brush.presets.newGroup: group is required"),
        ] {
            assert_eq!(run(&dir, &mut engine, "brush.presets.newGroup", params).unwrap_err(), error);
        }
        let engine_group = photocraft_engine::brush_preset_cmds::group_order(&engine.tools.presets)[0].clone();
        assert!(run(&dir, &mut engine, "brush.presets.newGroup", json!({ "group": engine_group })).unwrap_err().ends_with("already exists"));
        // A new process re-reads the file.
        forget(&dir);
        let mut reopened = session();
        super::super::tools::activate(&dir, &mut reopened).unwrap();
        assert!(groups(&reopened).contains(&"Inks".to_string()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn empty_groups_take_presets_rename_delete_and_stay_when_emptied() {
        let dir = profile();
        let mut engine = session();
        super::super::tools::activate(&dir, &mut engine).unwrap();
        run(&dir, &mut engine, "brush.presets.newGroup", json!({ "group": "Inks" })).unwrap();
        add_preset(&dir, &mut engine, "Nib", TipShape::Round);
        run(&dir, &mut engine, "brush.presets.move", json!({ "name": "Nib", "group": "Inks" })).unwrap();
        assert_eq!(groups(&engine).iter().filter(|group| *group == "Inks").count(), 1);
        run(&dir, &mut engine, "brush.presets.renameGroup", json!({ "group": "Inks", "newName": "Pens" })).unwrap();
        assert!(!groups(&engine).contains(&"Inks".to_string()));
        assert_eq!(engine.tools.presets.iter().find(|preset| preset.name == "Nib").unwrap().group, "Pens");
        run(&dir, &mut engine, "brush.presets.move", json!({ "name": "Nib", "group": "" })).unwrap();
        assert!(groups(&engine).contains(&"Pens".to_string()), "an emptied group stays, as in Photoshop");
        run(&dir, &mut engine, "brush.presets.newGroup", json!({ "group": "Spare" })).unwrap();
        assert!(run(&dir, &mut engine, "brush.presets.renameGroup", json!({ "group": "Spare", "newName": "Pens" })).unwrap_err().ends_with("already exists"));
        run(&dir, &mut engine, "brush.presets.renameGroup", json!({ "group": "Spare", "newName": "Charcoal" })).unwrap();
        run(&dir, &mut engine, "brush.presets.deleteGroup", json!({ "group": "Pens" })).unwrap();
        assert!(engine.tools.presets.iter().any(|preset| preset.name == "Nib"), "deleting an empty group deletes no preset");
        forget(&dir);
        let mut reopened = session();
        super::super::tools::activate(&dir, &mut reopened).unwrap();
        let listed = groups(&reopened);
        assert!(listed.contains(&"Charcoal".to_string()) && !listed.contains(&"Pens".to_string()) && !listed.contains(&"Spare".to_string()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tip_preset_copies_the_preset_tip_into_tip_or_dual_brush_and_reports_its_identity() {
        let dir = profile();
        let mut engine = session();
        super::super::tools::activate(&dir, &mut engine).unwrap();
        add_preset(&dir, &mut engine, "Chalk", sampled(3));
        add_preset(&dir, &mut engine, "Sponge", sampled(9));
        let size = engine.tools.brush.size;
        run(&dir, &mut engine, "tools.setBrush", json!({ "tipPreset": "chalk", "dualBrush": { "tipPreset": "Sponge", "enabled": true } })).unwrap();
        assert_eq!(engine.tools.brush.tip, sampled(3));
        assert_eq!(engine.tools.brush.dual_brush.tip, sampled(9));
        assert!(engine.tools.brush.dual_brush.enabled);
        assert_eq!(engine.tools.brush.size, size, "only the tip is copied");
        let state = super::super::tools::inspect(&engine);
        assert_eq!(state["tip"]["preset"], "Chalk");
        assert_eq!(state["dualTip"]["preset"], "Sponge");
        let id = state["tip"]["id"].as_str().unwrap().to_owned();
        assert!(id.starts_with("sampled:") && id.len() == 24);
        assert_eq!(tip_identity(&engine, &sampled(3))["id"], id, "the hash is stable");
        assert_ne!(state["dualTip"]["id"], state["tip"]["id"]);
        let (journal_command, journal_params) = engine.journal.last().unwrap().clone();
        assert_eq!(journal_command, "tools.setBrush");
        assert!(journal_params.get("tipPreset").is_none() && journal_params.get("tip").is_some(), "the journal replays the tip itself");
        let before = engine.tools.brush.clone();
        for (params, error) in [
            (json!({ "tipPreset": "Nope" }), "tools.setBrush: tipPreset \"Nope\" is not a brush preset"),
            (json!({ "tipPreset": 3 }), "tools.setBrush: tipPreset must be a brush preset name"),
            (json!({ "dualBrush": { "tipPreset": "Nope" } }), "tools.setBrush: dualBrush.tipPreset \"Nope\" is not a brush preset"),
            (json!({ "tipPreset": "Chalk", "tip": "round" }), "tools.setBrush: tipPreset and tip cannot both be set"),
        ] {
            assert_eq!(run(&dir, &mut engine, "tools.setBrush", params).unwrap_err(), error);
        }
        assert_eq!(engine.tools.brush, before);
        run(&dir, &mut engine, "tools.setBrush", json!({ "tip": "round" })).unwrap();
        assert_eq!(super::super::tools::inspect(&engine)["tip"], json!({ "id": "round", "preset": null }));
        // brush.json keeps the picked dual tip across a restart.
        assert_eq!(saved_brush(&dir).dual_brush.tip, sampled(9));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn texture_pattern_is_saved_to_brush_json_and_reported_by_id() {
        let dir = profile();
        let mut engine = session();
        super::super::tools::activate(&dir, &mut engine).unwrap();
        let pattern = engine.patterns.items[1].clone();
        assert_eq!(super::super::tools::inspect(&engine)["settings"]["texture"]["patternId"], Value::Null);
        run(&dir, &mut engine, "brush.texturePattern", json!({ "pattern": pattern.id })).unwrap();
        assert_eq!(super::super::tools::inspect(&engine)["settings"]["texture"]["patternId"], json!(pattern.id));
        let mut reopened = session();
        reopened.tools.brush = saved_brush(&dir);
        assert_eq!(reopened.tools.brush.texture.pattern, engine.tools.brush.texture.pattern);
        assert_eq!(super::super::tools::inspect(&reopened)["settings"]["texture"]["patternId"], json!(pattern.id));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
