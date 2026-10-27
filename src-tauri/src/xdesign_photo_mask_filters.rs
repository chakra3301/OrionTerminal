//! The pinned ordinary route skips layer masks and separate handlers skip
//! channels. Native grayscale computation must commit only the targeted plane.
use photocraft_engine::{channel_cmds::ChannelTarget, doc::{Document, Layer, LayerContent, LayerId, Rect}, EngineError, Session};
use photocraft_raster::Surface;
use serde_json::{json, Value};

const SEPARATE: [&str; 6] = ["filter.cameraRaw", "filter.lensCorrection", "filter.adaptiveWideAngle", "filter.liquify", "edit.puppetWarp", "edit.perspectiveWarp"];
const FADE_MARKER: &str = "__xdesignChannelFade";
const PAINT_FADE_COMMANDS: [&str; 13] = ["paint.stroke", "paint.pencil", "paint.cloneStamp", "paint.healingBrush", "paint.spotHealing", "paint.historyBrush", "paint.dodge", "paint.burn", "paint.sponge", "paint.blur", "paint.sharpen", "paint.smudge", "paint.mixerBrush"];
const FILL_FADE_COMMANDS: [&str; 7] = ["paint.bucket", "paint.gradient", "edit.fill", "edit.fillForeground", "edit.fillBackground", "edit.fillForegroundPreserve", "edit.fillBackgroundPreserve"];
const FILL_ALIASES: [&str; 4] = ["edit.fillForeground", "edit.fillBackground", "edit.fillForegroundPreserve", "edit.fillBackgroundPreserve"];
#[derive(Clone, Copy)]
pub(super) enum Target { Mask(LayerId), Alpha(usize), QuickMask }
#[derive(Clone, Copy)]
pub(super) enum FadeTarget { Coverage(Target), Pixels(LayerId) }
pub(super) fn separate(command: &str) -> bool { SEPARATE.contains(&command) }
fn supported(command: &str) -> bool { separate(command) || photocraft_engine::filters::params_for(command, &Value::Null).is_some() }
pub(super) fn target(engine: &Session, params: &Value) -> Result<Option<Target>, String> {
    let state = engine.active().ok_or("No image document")?;
    let layer = || match params.get("layer") {
        Some(value) => value.as_u64().map(LayerId).ok_or_else(|| "Select a valid layer mask".to_owned()),
        None => state.active_layer.ok_or_else(|| "Select a layer mask".to_owned()),
    };
    Ok(match params.get("target") {
        Some(value) if value == "pixels" => None,
        Some(value) if value == "mask" => Some(Target::Mask(layer()?)),
        Some(value) if value == "quickMask" => Some(Target::QuickMask),
        Some(value) => Some(Target::Alpha(value.get("channel").and_then(Value::as_u64).and_then(|index| usize::try_from(index).ok()).ok_or("Select a valid filter target")?)),
        None => match state.channel_view.target {
            ChannelTarget::Alpha(index) => Some(Target::Alpha(index)),
            ChannelTarget::Composite if state.doc.quick_mask.is_some() => Some(Target::QuickMask),
            ChannelTarget::Composite if photocraft_engine::mask_view_cmds::current(state).is_some() => Some(Target::Mask(layer()?)),
            _ => None,
        },
    })
}
pub(super) fn targets_coverage(engine: &Session, params: &Value) -> bool { target(engine, params).ok().flatten().is_some() }
pub(super) fn repeat_invocation(engine: &Session) -> Result<Option<(String, Value)>, String> {
    let Some((command, params)) = engine.journal.iter().rev().find(|(id, _)| id.starts_with("filter.") && supported(id)) else { return Ok(None); };
    Ok(target(engine, params)?.map(|_| (command.clone(), params.clone())))
}
pub(super) fn pixel_preview_job(engine:&Session,params:&Value)->Result<bool,String> {
    if target(engine,params)?.is_some(){return Ok(false);}
    let state=engine.active().ok_or("No image document")?;
    let layer=params["layer"].as_u64().map(LayerId).or(state.active_layer).and_then(|id|state.doc.layer(id));
    Ok(state.doc.quick_mask.is_none() && layer.is_some_and(|layer|matches!(layer.content,LayerContent::Raster(_))))
}
fn encoded(target: Target) -> Value { match target { Target::Mask(_) => json!("mask"), Target::Alpha(index) => json!({"channel":index}), Target::QuickMask => json!("quickMask") } }
pub(super) fn plane(doc: &Document, target: Target) -> Result<&Surface, String> {
    match target {
        Target::Mask(id) => {
            let layer = doc.layer(id).ok_or("The mask layer no longer exists")?;
            if layer.locks.all { return Err("The layer is locked".into()); }
            Ok(&layer.mask.as_ref().ok_or("The layer has no raster mask")?.surface)
        },
        Target::Alpha(index) => Ok(&doc.channels.get(index).ok_or("The channel no longer exists")?.surface),
        Target::QuickMask => Ok(&doc.quick_mask.as_ref().ok_or("Not in Quick Mask mode")?.surface),
    }
}
fn commit(doc: &mut Document, target: Target, surface: Surface) -> Result<(), EngineError> {
    let destination = match target {
        Target::Mask(id) => &mut doc.layer_mut(id).ok_or(EngineError::NoLayer(id))?.mask.as_mut().ok_or_else(|| EngineError::Other("The layer has no raster mask".into()))?.surface,
        Target::Alpha(index) => &mut doc.channels.get_mut(index).ok_or_else(|| EngineError::Other("The channel no longer exists".into()))?.surface,
        Target::QuickMask => &mut doc.quick_mask.as_mut().ok_or_else(|| EngineError::Other("Not in Quick Mask mode".into()))?.surface,
    };
    *destination = surface; Ok(())
}
fn edit_plane(engine: &mut Session, label: &str, target: Target, surface: Surface, params: &Value) -> Result<(), String> {
    edit_history(engine, label, params, |doc, _| commit(doc, target, surface))
}
pub(super) fn edit_history<R>(engine: &mut Session, label: &str, params: &Value, edit: impl FnOnce(&mut Document, &mut Option<LayerId>) -> Result<R, EngineError>) -> Result<R, String> {
    let key = params.get("coalesce").and_then(Value::as_str).map(str::to_owned);
    let state = engine.active_mut().ok_or("No image document")?;
    let previous = if key.is_some() && state.coalesce == key && state.history.can_undo() {
        Some(std::mem::take(&mut state.history))
    } else { None };
    let result = engine.edit(label, edit);
    let state = engine.active_mut().ok_or("No image document")?;
    if let Some(mut history) = previous {
        if result.is_ok() {
            // Recover the public layer-target value without cloning retained history.
            state.history.record("Target probe", state.doc.clone(), Default::default());
            if let Some((_, layers)) = state.history.undo(state.doc.clone()) { history.set_current_layers(layers); }
        }
        state.history = history;
    }
    let result = result.map_err(|error| error.to_string())?;
    state.coalesce = key;
    Ok(result)
}
pub(super) fn clean_parameters(params: &Value) -> Result<Value, String> {
    let mut recorded = params.clone();
    recorded.as_object_mut().ok_or("Invalid edit parameters")?.remove(FADE_MARKER);
    Ok(recorded)
}
pub(super) fn stable_parameters(params: &Value, executed: &Value) -> Result<Value, String> {
    let mut recorded = clean_parameters(params)?;
    let object = recorded.as_object_mut().ok_or("Invalid edit parameters")?;
    for key in ["target", "layer", FADE_MARKER] {
        if let Some(value) = executed.get(key) { object.insert(key.into(), value.clone()); }
    }
    Ok(recorded)
}
pub(super) fn commit_host_edit<R>(engine: &mut Session, command: &str, params: &Value, label: &str, fade: Option<FadeTarget>, edit: impl FnOnce(&mut Document, &mut Option<LayerId>) -> Result<R, EngineError>) -> Result<R, String> {
    let recorded = clean_parameters(params)?;
    let result = edit_history(engine, label, params, edit)?;
    engine.journal.push((command.to_owned(), recorded));
    engine.edit_state.fade = None;
    if let Some(target) = fade { remember_fade(engine, target); }
    Ok(result)
}
fn extent(rect: Rect) -> Result<(), String> {
    if u64::from(rect.width()) * u64::from(rect.height()) > super::MAX_PIXELS { return Err("The mask or channel filter exceeds the image size limit".into()); }
    Ok(())
}
fn normalize(original: &Surface, filtered: &Surface, canvas: Rect) -> Result<Surface, String> {
    let format = original.format(); let default = original.default_pixel();
    let source = canvas.union(&original.content_bounds());
    extent(source.union(&filtered.tile_bounds()))?;
    if filtered.format() == format && filtered.default_pixel() == default { return Ok(filtered.clone()); }
    let area = source.union(&filtered.content_bounds());
    // Native geometry may introduce alpha. A mask/channel keeps one coverage
    // plane, with transparency flattened onto its original implicit default.
    let mut output = original.clone(); let base = photocraft_raster::to_rgba(&format, &default);
    for y in (area.y0..area.y1).step_by(256) { for x in (area.x0..area.x1).step_by(4096) {
        let rect = Rect::new(x, y, x.saturating_add(4096).min(area.x1), y.saturating_add(256).min(area.y1));
        let raw = filtered.read_region(rect); let mut values = Vec::with_capacity((rect.width() * rect.height()) as usize * format.channels());
        for pixel in raw.chunks_exact(filtered.channels()) {
            let rgba = photocraft_raster::to_rgba(&filtered.format(), pixel); let alpha = rgba[3].clamp(0.0, 1.0);
            let mixed = [rgba[0] * alpha + base[0] * (1.0 - alpha), rgba[1] * alpha + base[1] * (1.0 - alpha), rgba[2] * alpha + base[2] * (1.0 - alpha), 1.0];
            let offset = values.len(); values.resize(offset + format.channels(), 0.0); photocraft_raster::from_rgba_into(&format, mixed, &mut values[offset..]);
        }
        output.write_region(rect, &values);
    }}
    output.prune(); Ok(output)
}
fn coverage_fade_command(command: &str) -> bool {
    command.starts_with("filter.") && (supported(command) || command == "filter.lastFilter")
        || command.strip_prefix("image.adjustments.").is_some_and(|kind| super::preview::ADJUSTMENTS.contains(&kind))
        || PAINT_FADE_COMMANDS.contains(&command)
        || FILL_FADE_COMMANDS.contains(&command)
        || matches!(command, "paint.patch" | "paint.colorReplacement" | "paint.patternStamp" | "image.applyImage")
}
fn fade_source(engine: &Session) -> Option<(Target, String)> {
    let state = engine.active()?;
    if !state.history.can_undo() { return None; }
    for (command, params) in engine.journal.iter().rev() {
        if let Some(marker) = params.get(FADE_MARKER) {
            if !(coverage_fade_command(command) && marker["document"] == json!(state.doc.id) && marker["revision"].as_u64() == Some(state.revision) && marker["label"].as_str() == state.history.undo_label()) { return None; }
            let target = target(engine, params).ok().flatten()?;
            if matches!(target, Target::Mask(_)) { return None; }
            let previous = state.history.state(state.history.past_len().checked_sub(1)?)?;
            if plane(&previous, target).ok()?.format() != plane(&state.doc, target).ok()?.format() { return None; }
            return Some((target, marker["label"].as_str()?.to_owned()));
        }
        if !command.starts_with("view.") && !command.starts_with("channel.target") && command != "channel.setVisible" && !command.starts_with("tools.") && !command.starts_with("tool.") && command != "edit.profileInfo" { return None; }
    }
    None
}
pub(super) fn commit_adjustment(engine: &mut Session, command: &str, params: &Value, target: Target, label: &str, surface: Surface) -> Result<Value, String> {
    commit_host_edit(engine, command, params, label, Some(FadeTarget::Coverage(target)), |doc, _| commit(doc, target, surface))?;
    Ok(Value::Null)
}
fn remember_fade(engine: &mut Session, target: FadeTarget) {
    if !engine.journal.last().is_some_and(|(command, params)| coverage_fade_command(command) && params.is_object()) { return; }
    let Some(state) = engine.active() else { return; };
    let Some(label) = state.history.undo_label().map(str::to_owned) else { return; };
    let document = state.doc.id;
    let revision = state.revision;
    let record = engine.journal.last_mut().unwrap().1.as_object_mut().unwrap();
    record.insert("target".into(), match target { FadeTarget::Coverage(target) => encoded(target), FadeTarget::Pixels(_) => json!("pixels") });
    record.remove(FADE_MARKER);
    match target {
        FadeTarget::Coverage(Target::Mask(layer)) | FadeTarget::Pixels(layer) => {
            record.insert("layer".into(), json!(layer.0));
            engine.edit_state.fade = Some(photocraft_engine::edit_menu_cmds::FadeSource { doc: document, revision, layer, mask: matches!(target, FadeTarget::Coverage(Target::Mask(_))), label });
        }
        _ => {
            record.insert(FADE_MARKER.into(), json!({"document":document,"revision":revision,"label":label}));
            engine.edit_state.fade = None;
        }
    }
}
pub(super) struct PaintFadeContext {
    target: FadeTarget,
    document: photocraft_engine::doc::DocId,
    revision: u64,
    journal_len: usize,
    command: &'static str,
}
pub(super) fn prepare_paint_fade(engine: &Session, command: &str, params: &mut Value) -> Option<PaintFadeContext> {
    let command = PAINT_FADE_COMMANDS.iter().chain(FILL_FADE_COMMANDS.iter()).chain([&"paint.patch", &"paint.colorReplacement"]).copied().find(|candidate| *candidate == command)?;
    if let Some(object) = params.as_object_mut() { object.remove(FADE_MARKER); }
    let implicit_patch = command == "paint.patch" && params.get("target").is_none();
    let layer_aware = PAINT_FADE_COMMANDS.contains(&command) || FILL_ALIASES.contains(&command) || matches!(command, "edit.fill" | "paint.patch");
    let target = if implicit_patch || command == "paint.colorReplacement" {
        let layer = params["layer"].as_u64().map(LayerId).or(engine.active()?.active_layer)?;
        FadeTarget::Pixels(layer)
    } else {
        let state=engine.active()?;
        let active_mask=matches!(command,"paint.bucket"|"paint.gradient") && (params.get("target").is_some_and(|value|value=="mask") || params.get("target").is_none() && state.channel_view.target==ChannelTarget::Composite && state.doc.quick_mask.is_none() && photocraft_engine::mask_view_cmds::current(state).is_some());
        let resolved=if PAINT_FADE_COMMANDS.contains(&command) {
            // Native routed brushes fall back to active for nonnumeric layer values,
            // and explicit unknown targets mean pixels rather than the selected channel.
            match params.get("target") {
                Some(value) if value == "mask" => Some(Target::Mask(params["layer"].as_u64().map(LayerId).or(state.active_layer)?)),
                Some(value) if value == "quickMask" => Some(Target::QuickMask),
                Some(value) => value.get("channel").and_then(Value::as_u64).map(|index| Target::Alpha(index as usize)),
                None => match state.channel_view.target {
                    ChannelTarget::Alpha(index) if index < state.doc.channels.len() => Some(Target::Alpha(index)),
                    ChannelTarget::Composite if state.doc.quick_mask.is_some() => Some(Target::QuickMask),
                    ChannelTarget::Composite if photocraft_engine::mask_view_cmds::current(state).is_some() => Some(Target::Mask(params["layer"].as_u64().map(LayerId).or(state.active_layer)?)),
                    _ => None,
                },
            }
        } else if active_mask {Some(Target::Mask(state.active_layer?))} else {target(engine,params).ok()?};
        match resolved {
        Some(target) => {
            if matches!(target, Target::Mask(_)) && !layer_aware && !FILL_FADE_COMMANDS.contains(&command) { return None; }
            FadeTarget::Coverage(target)
        }
        None if layer_aware => FadeTarget::Pixels(params["layer"].as_u64().map(LayerId).or(engine.active()?.active_layer)?),
        None => return None,
    }};
    if params.is_null() { *params = json!({}); }
    params.as_object()?;
    let state = engine.active()?;
    match target { FadeTarget::Coverage(target) => { plane(&state.doc, target).ok()?; }, FadeTarget::Pixels(layer) => { state.doc.layer(layer)?.surface()?; } }
    Some(PaintFadeContext { target, document: state.doc.id, revision: state.revision, journal_len: engine.journal.len(), command })
}
pub(super) fn finish_paint_fade(engine: &mut Session, context: Option<PaintFadeContext>) {
    let Some(context) = context else { return; };
    if engine.journal.len() != context.journal_len + 1 || !engine.journal.last().is_some_and(|(command, _)| command == context.command) { return; }
    let Some(state) = engine.active() else { return; };
    if state.doc.id != context.document || state.revision < context.revision { return; }
    if state.revision > context.revision {
        let native_target = match context.target { FadeTarget::Pixels(layer) => Some((layer, false)), FadeTarget::Coverage(Target::Mask(layer)) => Some((layer, true)), _ => None };
        if native_target.is_some_and(|(layer, mask)| engine.edit_state.fade.as_ref().is_some_and(|fade| fade.doc == state.doc.id && fade.revision == state.revision && fade.layer == layer && fade.mask == mask && Some(fade.label.as_str()) == state.history.undo_label())) { return; }
    }
    // Native FadeSource names a layer even when painting changed a channel.
    engine.edit_state.fade = None;
    if engine.active().is_some_and(|state| state.revision > context.revision) { remember_fade(engine, context.target); }
}
pub(super) fn can_fade(engine: &Session) -> bool { fade_source(engine).is_some() }
fn fade(engine: &mut Session, params: &Value, target: Target, label: String) -> Result<Value, String> {
    if !params.is_object() || params.get("opacity").is_some_and(|value| value.as_f64().is_none_or(|v| !v.is_finite())) { return Err("Fade opacity must be finite".into()); }
    if params.get("mode").is_some_and(|value| !value.is_string()) { return Err("Unknown Fade blend mode".into()); }
    let opacity = params.get("opacity").and_then(Value::as_f64).unwrap_or(100.0).clamp(0.0, 100.0) as f32 / 100.0;
    let mode = photocraft_engine::commands::blend_from_str(params.get("mode").and_then(Value::as_str).unwrap_or("normal")).ok_or("Unknown Fade blend mode")?;
    let state = engine.active().ok_or("No image document")?;
    let previous = state.history.state(state.history.past_len().checked_sub(1).ok_or("No Fade history step")?).ok_or("No Fade history step")?;
    let before = plane(&previous, target)?.clone(); let mut after = plane(&state.doc, target)?.clone();
    let area = state.doc.bounds().union(&before.content_bounds()).union(&after.content_bounds()); extent(area)?;
    for y in (area.y0..area.y1).step_by(256) { for x in (area.x0..area.x1).step_by(4096) {
        let rect = Rect::new(x, y, x.saturating_add(4096).min(area.x1), y.saturating_add(256).min(area.y1));
        photocraft_engine::edit_menu_cmds::fade_surface(&before, &mut after, rect, mode, opacity);
    }}
    after.prune();
    engine.edit(&format!("Fade {label}"), |doc, _| commit(doc, target, after)).map_err(|error| error.to_string())?;
    engine.edit_state.fade = None; engine.journal.push(("edit.fade".into(), params.clone()));
    Ok(json!({"faded":label,"opacity":opacity*100.0,"mode":mode.label(),"target":encoded(target)}))
}
pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command == "edit.fade" { return fade_source(engine).map(|(target, label)| fade(engine, params, target, label)); }
    let (filter, mut settings) = if command == "filter.lastFilter" {
        engine.journal.iter().rev().find(|(id, _)| id.starts_with("filter.") && supported(id)).cloned()?
    } else {
        if !supported(command) { return None; } (command.to_owned(), params.clone())
    };
    let target = match target(engine, &settings) { Ok(Some(target)) => target, Ok(None) => return None, Err(error) => return Some(Err(error)) };
    Some((|| {
        if !params.is_object() { return Err("Invalid filter parameters".into()); }
        super::preview::validate_filter_input(&filter, &settings)?;
        let state = super::snapshot::capture(engine.active().ok_or("No image document")?,super::snapshot::HistoryPolicy::Discard);
        let original = plane(&state.doc, target)?.clone(); let mut surface = original.clone(); let canvas = state.doc.bounds(); extent(canvas.union(&surface.content_bounds()))?;
        // Ordinary channels already have a native route. Keep its dispatch so
        // coalescing, automation and preset hooks retain their original context.
        if !separate(&filter) && !matches!(target, Target::Mask(_)) && engine.is_enabled(command) && settings.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer).is_some() {
            let mut invocation = params.clone();
            invocation.as_object_mut().ok_or("Invalid filter parameters")?.remove(FADE_MARKER);
            if command != "filter.lastFilter" { invocation.as_object_mut().ok_or("Invalid filter parameters")?.insert("target".into(), encoded(target)); }
            let mut result = engine.execute(command, invocation).map_err(|error| error.to_string())?;
            let current = engine.active().ok_or("No image document")?;
            let marker = current.history.undo_label().map(|label| json!({"document":current.doc.id,"revision":current.revision,"label":label}));
            if let Some((_, recorded)) = engine.journal.last_mut() {
                if let Some(object) = recorded.as_object_mut() { object.insert("target".into(), encoded(target)); object.remove(FADE_MARKER); if let Some(marker) = marker { object.insert(FADE_MARKER.into(), marker); } }
            }
            engine.edit_state.fade = None;
            if let Some(object) = result.as_object_mut() { object.remove("layer"); object.insert("target".into(), encoded(target)); }
            return Ok(result);
        }
        // Implicit Reveal/Hide All coverage must be visible to native filters.
        for y in (canvas.y0..canvas.y1).step_by(256) { for x in (canvas.x0..canvas.x1).step_by(4096) {
            let rect = Rect::new(x, y, x.saturating_add(4096).min(canvas.x1), y.saturating_add(256).min(canvas.y1)); let values = surface.read_region(rect); surface.write_region(rect, &values);
        }}
        let mut scratch = Session::new(); scratch.add_document((*state.doc).clone(), None);
        let mut draft = super::snapshot::capture(&state,super::snapshot::HistoryPolicy::Discard); draft.channel_view = Default::default();
        let document = std::sync::Arc::make_mut(&mut draft.doc);
        let layer = match target {
            Target::Mask(id) => id,
            _ => state.active_layer.filter(|id| document.layer(*id).is_some()).unwrap_or_else(|| document.insert_above(None, Layer::raster("Channel filter", surface.format()))),
        };
        if separate(&filter) { document.mode = photocraft_engine::doc::ColorMode::Grayscale; document.depth = surface.format().sample; document.icc_profile = None; }
        document.quick_mask = None;
        let temporary = document.layer_mut(layer).ok_or("The filter layer no longer exists")?;
        temporary.content = LayerContent::Raster(surface); temporary.mask = None; temporary.locks = Default::default();
        draft.active_layer = Some(layer); draft.selected_layers = vec![layer]; draft.layer_anchor = Some(layer);
        *scratch.active_mut().ok_or("No filter preview document")? = draft;
        scratch.tools = engine.tools.clone(); scratch.presets = engine.presets.clone(); scratch.patterns = engine.patterns.clone(); super::color_views::Snapshot::capture(engine)?.install(&mut scratch)?;
        let object = settings.as_object_mut().ok_or("Invalid filter parameters")?; object.remove(FADE_MARKER); object.insert("target".into(), json!("pixels")); object.insert("layer".into(), json!(layer.0));
        super::preview::validate_lens_input(&scratch, &filter, &settings)?;
        let mut result = scratch.execute(&filter, settings.clone()).map_err(|error| error.to_string())?;
        if scratch.active().is_some_and(|state| !state.history.can_undo()) && result["changed"] == false {
            let mut recorded = params.clone(); let object = recorded.as_object_mut().ok_or("Invalid filter parameters")?;
            object.remove(FADE_MARKER); object.insert("target".into(), encoded(target));
            engine.journal.push((command.to_owned(), recorded));
            if !matches!(target, Target::Mask(_)) {
                engine.edit_state.fade = None;
                if let Some(object) = result.as_object_mut() { object.remove("layer"); object.insert("target".into(), encoded(target)); }
            }
            return Ok(result);
        }
        let filtered = scratch.active().and_then(|state| state.doc.layer(layer)).and_then(|layer| layer.surface()).ok_or("The filter returned no pixels")?;
        let output = normalize(&original, filtered, canvas)?;
        let label = scratch.active().and_then(|state| state.history.entries().last().cloned()).ok_or("The filter returned no history step")?;
        edit_plane(engine, &label, target, output, params)?;
        let current = engine.active().ok_or("No image document")?;
        let label = current.history.undo_label().unwrap_or(&label).to_owned();
        let mut recorded = params.clone(); let record = recorded.as_object_mut().ok_or("Invalid filter parameters")?;
        if matches!(target, Target::Mask(_)) {
            if command != "filter.lastFilter" { record.insert("target".into(), encoded(target)); }
            if filter.starts_with("filter.") { engine.edit_state.fade = Some(photocraft_engine::edit_menu_cmds::FadeSource { doc: current.doc.id, revision: current.revision, layer, mask: true, label }); }
        } else {
            record.insert("target".into(), encoded(target)); record.remove(FADE_MARKER);
            if filter.starts_with("filter.") { record.insert(FADE_MARKER.into(), json!({"document":current.doc.id,"revision":current.revision,"label":label})); }
            engine.edit_state.fade = None;
            if let Some(object) = result.as_object_mut() { object.remove("layer"); object.insert("target".into(), encoded(target)); }
        }
        engine.journal.push((command.to_owned(), recorded)); Ok(result)
    })())
}

#[cfg(test)]
#[path = "xdesign_photo_mask_filters_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "xdesign_photo_channel_filters_tests.rs"]
mod channel_tests;
#[cfg(test)]
#[path = "xdesign_photo_paint_fade_tests.rs"]
mod paint_fade_tests;
#[cfg(test)]
#[path = "xdesign_photo_retouch_fade_tests.rs"]
mod retouch_fade_tests;
#[cfg(test)]
#[path = "xdesign_photo_coverage_edit_tests.rs"]
mod coverage_edit_tests;
#[cfg(test)]
#[path = "xdesign_photo_layer_fade_tests.rs"]
mod layer_fade_tests;

#[cfg(test)]
#[path = "xdesign_photo_color_replacement_fade_tests.rs"]
mod color_replacement_fade_tests;
#[cfg(test)]
mod normalization_tests {
    use super::*;
    #[test]
    fn normalization_preserves_implicit_coverage_outside_non_aligned_canvas() {
        let canvas = Rect::from_xywh(0, 0, 32, 24);
        let original = Surface::with_default(photocraft_engine::doc::PixelFormat::GRAY8, &[1.0]);
        let mut filtered = Surface::new(original.format()); filtered.fill_rect(canvas, &[0.5]);
        let output = normalize(&original, &filtered, canvas).unwrap();
        assert_eq!(output.default_pixel(), original.default_pixel()); assert_eq!(output.pixel(16, 12), filtered.pixel(16, 12));
        for (x, y) in [(32, 8), (8, 24), (90, 90), (-1, 12), (12, -1)] { assert_eq!(output.pixel(x, y), original.pixel(x, y), "implicit coverage at {x},{y}"); }
        assert_eq!(output.content_bounds(), canvas);
    }
    #[test]
    fn combined_source_and_output_extent_is_refused_before_normalization_readback() {
        let mut original = Surface::new(photocraft_engine::doc::PixelFormat::GRAY8); original.write_pixel(-14000, -9000, &[0.5]);
        let mut filtered = Surface::new(photocraft_engine::doc::PixelFormat { alpha:true, ..original.format() }); filtered.write_pixel(14000, 9000, &[0.5, 0.5]);
        let canvas = Rect::from_xywh(0, 0, 32, 24);
        assert!(extent(canvas.union(&original.content_bounds())).is_ok()); assert!(extent(canvas.union(&filtered.tile_bounds())).is_ok());
        assert!(normalize(&original, &filtered, canvas).unwrap_err().contains("size limit"));
        assert_eq!(original.pixel(-14000, -9000), vec![128.0 / 255.0]);
    }
}
