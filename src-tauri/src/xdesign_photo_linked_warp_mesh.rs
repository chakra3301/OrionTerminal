use photocraft_engine::{doc::{LayerContent, LayerId, Metadata, SmartObject}, warp_cmds::Split, EngineError, Session};
use serde_json::{json, Value};

const GRID: &str = "edit.transform.warpGrid";

#[derive(Clone, Copy)]
enum Operation { Split(Split), Grid }

fn operation(command: &str) -> Option<Operation> {
    Some(match command {
        "edit.transform.splitWarpCrosswise" => Operation::Split(Split::Crosswise),
        "edit.transform.splitWarpHorizontally" => Operation::Split(Split::Horizontal),
        "edit.transform.splitWarpVertically" => Operation::Split(Split::Vertical),
        "edit.transform.removeWarpSplit" => Operation::Split(Split::Remove),
        GRID => Operation::Grid,
        _ => return None,
    })
}

fn inline(params: &Value) -> bool { ["warp", "mesh", "style"].iter().any(|key| params.get(*key).is_some()) }
fn active_smart(engine: &Session) -> Option<LayerId> {
    let state = engine.active()?; let id = state.active_layer?;
    if matches!(state.doc.layer(id)?.content, LayerContent::Smart(_)) { Some(id) } else { None }
}
fn bad(command: &str, message: &str) -> EngineError { EngineError::BadParams { cmd:command.into(), msg:message.into() } }

fn grid_size(params: &Value) -> Result<usize, EngineError> {
    let value = params.get("size").or_else(|| params.get("grid")).ok_or_else(|| bad(GRID, "pass `size` (1, 3, 4, 5 or \"default\")"))?;
    if value.is_array() { return Err(bad(GRID, "pass `size` as a number or \"default\", \"3\", \"4\" or \"5\"")); }
    let size = match value {
        Value::String(value) => match value.as_str() {
            "default" => 1, "3" | "3x3" => 3, "4" | "4x4" => 4, "5" | "5x5" => 5,
            _ => return Err(bad(GRID, "grid size must be default, 3, 4 or 5")),
        },
        Value::Number(value) => value.as_u64().ok_or_else(|| bad(GRID, "grid size must be a whole number from 1 to 64"))?,
        _ => return Err(bad(GRID, "grid size must be a number or default, 3, 4 or 5")),
    };
    if !(1..=64).contains(&size) { return Err(bad(GRID, "grid size must be from 1 to 64")); }
    Ok(size as usize)
}

fn grid_fit(warp: Value, size: usize) -> Result<Value, String> {
    let spec = photocraft_engine::warp_cmds::specs().into_iter().find(|spec| spec.id == GRID).ok_or("The native Warp Grid command is unavailable")?;
    // Its valid inline branch is pure geometry; this reuses native fitting without a new geometry dependency or command posthooks.
    let result = (spec.run)(&mut Session::new(), &json!({"warp":warp,"size":size})).map_err(|error| error.to_string())?;
    result.get("warp").cloned().ok_or_else(|| "The native Warp Grid result has no mesh".into())
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    operation(command)?;
    if !(params.is_object() || params.is_null()) || inline(params) { return None; }
    if let Some(reason) = engine.disabled_reason(command) {
        return Some(Err(EngineError::Disabled(command.into(), reason).to_string()));
    }
    active_smart(engine)?;
    Some(run_with(engine, command, params, |metadata, smart| {
        super::super::super::smart::source_bytes_checked(metadata, &smart.source, || Ok(()))
    }))
}

pub(super) fn run_with(engine: &mut Session, command: &str, params: &Value,
    resolve: impl FnOnce(&Metadata, &SmartObject) -> Result<Option<super::super::Bytes>, String>) -> Result<Value, String> {
    let Some(operation) = operation(command) else { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); };
    if !(params.is_object() || params.is_null()) || inline(params) {
        return engine.execute(command, params.clone()).map_err(|error| error.to_string());
    }
    if let Some(reason) = engine.disabled_reason(command) { return Err(EngineError::Disabled(command.into(), reason).to_string()); }
    let Some(id) = active_smart(engine) else { return engine.execute(command, params.clone()).map_err(|error| error.to_string()); };
    let (result, scratch, label) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let size = match operation { Operation::Grid => Some(grid_size(params).map_err(|error| error.to_string())?), _ => None };
        let state = engine.active().ok_or("No image document")?;
        let layer = state.doc.layer(id).ok_or("No stored-warp layer")?;
        let LayerContent::Smart(smart) = &layer.content else { return Err("The stored-warp layer changed type".into()); };
        let placement = photocraft_engine::smart_cmds::placement(smart);
        let warp = match &smart.warp {
            Some(warp) => warp.clone(),
            None => {
                let bounds = layer.surface().map_or(photocraft_engine::doc::Rect::EMPTY, |surface| surface.content_bounds());
                let rect = [f64::from(bounds.x0), f64::from(bounds.y0), f64::from(bounds.x1), f64::from(bounds.y1)];
                let corners = match operation {
                    Operation::Grid => {
                        let corners = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
                        match placement.inverse() {
                            Some(inverse) => corners.map(|point| { let (x, y) = inverse.apply(point[0], point[1]); [x, y] }).to_vec(),
                            None => corners.to_vec(),
                        }
                    },
                    Operation::Split(_) => {
                        let inverse = placement.inverse().unwrap_or(photocraft_algo::transform::Homography::IDENTITY);
                        [[rect[0], rect[1]], [rect[2], rect[3]]].map(|point| { let (x, y) = inverse.apply(point[0], point[1]); [x, y] }).to_vec()
                    },
                };
                let bounds = match operation {
                    Operation::Split(_) => [corners[0][0].min(corners[1][0]), corners[0][1].min(corners[1][1]), corners[0][0].max(corners[1][0]), corners[0][1].max(corners[1][1])],
                    Operation::Grid => corners.iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |bounds, point| [bounds[0].min(point[0]), bounds[1].min(point[1]), bounds[2].max(point[0]), bounds[3].max(point[1])]),
                };
                photocraft_engine::warp_cmds::warp_from_params(command, &json!({"style":"none","bend":0}), bounds).map_err(|error| error.to_string())?
            },
        };
        let (output, label) = match operation {
            Operation::Grid => {
                let value = grid_fit(serde_json::to_value(&warp).map_err(|error| error.to_string())?, size.ok_or("No Warp Grid size")?)?;
                (serde_json::from_value(value).map_err(|error| format!("Invalid native Warp Grid result: {error}"))?, "Warp Grid")
            },
            Operation::Split(how) => {
                let at = params.get("at").and_then(Value::as_array).and_then(|point| Some([point.first()?.as_f64()?, point.get(1)?.as_f64()?]));
                let at = at.and_then(|point| placement.inverse().map(|inverse| { let (x, y) = inverse.apply(point[0], point[1]); [x, y] }));
                let output = photocraft_engine::warp_cmds::split_warp(&warp, at, how).ok_or_else(|| bad(command, "nothing to split or remove there").to_string())?;
                (output, if matches!(how, Split::Remove) { "Remove Warp Split" } else { "Split Warp" })
            },
        };
        let mut scratch = super::scratch(engine, "Checked stored Smart warp")?;
        let mut resolve = Some(resolve);
        let mut once = |_: LayerId, metadata: &Metadata, smart: &SmartObject| {
            let resolve = resolve.take().ok_or("The stored-warp source was resolved more than once")?;
            resolve(metadata, smart)
        };
        scratch.edit(label, |doc, _| {
            let LayerContent::Smart(smart) = &mut doc.layer_mut(id).ok_or(EngineError::NoLayer(id))?.content else {
                return Err(EngineError::Other("The stored-warp layer changed type".into()));
            };
            smart.warp = Some(output.clone());
            super::refresh_with(doc, id, true, &mut once).map_err(EngineError::Other)
        }).map_err(|error| error.to_string())?;
        Ok::<_, String>((json!({"layer":id.0,"warp":output}), scratch, label))
    })).map_err(|_| super::internal_error(command))??;
    super::commit(engine, scratch, command, label, params, &[id])?;
    Ok(result)
}
