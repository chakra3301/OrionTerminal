use photocraft_engine::{doc::{Document, LayerContent, LayerId, SmartObject, SmartSource}, Session};
use photocraft_raster::Surface;
use serde_json::Value;
use std::sync::Arc;

#[path = "xdesign_photo_linked_refresh.rs"]
mod refresh;
#[path = "xdesign_photo_linked_embed.rs"]
mod embed;
#[path = "xdesign_photo_linked_copy.rs"]
mod copy;
#[path = "xdesign_photo_linked_transform.rs"]
mod transform;
#[path = "xdesign_photo_linked_stack.rs"]
mod stack;
#[path = "xdesign_photo_linked_warp.rs"]
mod warp;
#[path = "xdesign_photo_linked_rotation.rs"]
mod rotation;
#[path = "xdesign_photo_linked_presets.rs"]
mod presets;
#[path = "xdesign_photo_linked_straighten.rs"]
mod straighten;
#[path = "xdesign_photo_linked_again.rs"]
mod again;
#[path = "xdesign_photo_canvas_crop.rs"]
mod canvas_crop;
pub(super) use transform::refresh_ids;
#[cfg(test)]
pub(super) use transform::refresh_ids_with;

const EDITABLE: [&str; 15] = ["filter.cameraRaw", "filter.lensCorrection", "filter.adaptiveWideAngle", "filter.blurGallery.fieldBlur", "filter.blurGallery.irisBlur", "filter.blurGallery.spinBlur", "filter.blurGallery.pathBlur", "filter.blurGallery.tiltShift", "filter.blur.gaussianBlur", "filter.blur.boxBlur", "filter.blur.motionBlur", "filter.blur.radialBlur", "filter.blur.surfaceBlur", "filter.sharpen.unsharpMask", "filter.sharpen.smartSharpen"];
const PURE: [&str; 17] = ["filter.cameraRaw", "filter.lensCorrection", "filter.adaptiveWideAngle", "filter.blurGallery.fieldBlur", "filter.blurGallery.irisBlur", "filter.blurGallery.spinBlur", "filter.blurGallery.pathBlur", "filter.blurGallery.tiltShift", "filter.blur.gaussianBlur", "filter.blur.boxBlur", "filter.blur.motionBlur", "filter.blur.radialBlur", "filter.blur.surfaceBlur", "filter.other.custom", "filter.other.offset", "filter.sharpen.unsharpMask", "filter.sharpen.smartSharpen"];
const GALLERY: [&str; 5] = ["filter.blurGallery.fieldBlur", "filter.blurGallery.irisBlur", "filter.blurGallery.spinBlur", "filter.blurGallery.pathBlur", "filter.blurGallery.tiltShift"];
const BASIC: [&str; 5] = ["filter.blur.gaussianBlur", "filter.blur.boxBlur", "filter.blur.motionBlur", "filter.blur.radialBlur", "filter.blur.surfaceBlur"];
const SHARPEN: [&str; 2] = ["filter.sharpen.unsharpMask", "filter.sharpen.smartSharpen"];
const LIFECYCLE: [&str; 8] = ["layer.smartFilter.setVisible", "layer.smartFilter.blendingOptions", "layer.smartFilter.move", "layer.smartFilter.delete", "layer.smartFilter.clearSmartFilters", "layer.smartFilter.disableSmartFilters", "layer.smartFilter.disableFilterMask", "layer.smartFilter.deleteFilterMask"];
type Bytes = (String, Arc<Vec<u8>>);

pub(super) fn output_path(command: &str, params: &Value) -> Option<String> {
    if !matches!(command, "layer.smartObjects.exportContents" | "layer.smartObjects.convertToLinked") { return None; }
    params.get("path").and_then(Value::as_str).filter(|path| !path.is_empty()).map(str::to_owned)
}

pub(super) fn persist_output<T>(path: Option<&str>, persist: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    persist().map_err(|error| match path {
        Some(path) => format!("The file was saved to {path}, but image document persistence failed: {error}"),
        None => error,
    })
}

fn ordinary(command: &str) -> bool { GALLERY.contains(&command) || BASIC.contains(&command) || SHARPEN.contains(&command) }

pub(super) fn gallery_target(engine: &Session, command: &str, params: &Value) -> Result<Option<LayerId>, String> {
    if !GALLERY.contains(&command) { return Ok(None); }
    ordinary_target(engine, command, params)
}

fn ordinary_target(engine: &Session, command: &str, params: &Value) -> Result<Option<LayerId>, String> {
    if !ordinary(command) { return Ok(None); }
    if super::mask_filters::target(engine, params)?.is_some() { return Ok(None); }
    let state = engine.active().ok_or("No image document")?;
    Ok(params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer).filter(|id| state.doc.layer(*id).is_some_and(|layer| matches!(layer.content, LayerContent::Smart(_)))))
}

fn filter_index(smart: &SmartObject, params: &Value) -> Option<usize> {
    match params.get("index") { Some(value) => value.as_u64().map(|index| index as usize).filter(|index| *index < smart.smart_filters.len()), None => smart.smart_filters.len().checked_sub(1) }
}

// Invalid native arguments fall through to the native command before source resolution.
fn prospective(smart: &SmartObject, command: &str, params: &Value) -> Option<Result<(), String>> {
    let mask_command = matches!(command, "layer.smartFilter.disableFilterMask" | "layer.smartFilter.deleteFilterMask");
    if (mask_command && smart.filter_mask.is_none()) || (!mask_command && smart.smart_filters.is_empty()) { return None; }
    match command {
        "layer.smartFilter.setVisible" => { let index = filter_index(smart, params)?; let visible = params.get("visible").and_then(Value::as_bool).unwrap_or(!smart.smart_filters[index].visible); return Some(admit_visible(smart, smart.filters_enabled, |position, filter| if position == index { visible } else { filter.visible })); }
        "layer.smartFilter.blendingOptions" => {
            if let Some(value) = params.get("blend").and_then(Value::as_str) { photocraft_engine::commands::blend_from_str(value).filter(|blend| *blend != photocraft_engine::doc::BlendMode::PassThrough)?; }
            filter_index(smart, params)?;
        }
        "layer.smartFilter.move" => { filter_index(smart, params)?; params.get("to")?.as_u64().map(|index| index as usize).filter(|index| *index < smart.smart_filters.len())?; }
        "layer.smartFilter.delete" => { let index = filter_index(smart, params)?; return Some(admit_visible(smart, smart.filters_enabled, |position, filter| position != index && filter.visible)); }
        "layer.smartFilter.clearSmartFilters" => return Some(Ok(())),
        "layer.smartFilter.disableSmartFilters" => return Some(admit_visible(smart, params.get("enabled").and_then(Value::as_bool).unwrap_or(!smart.filters_enabled), |_, filter| filter.visible)),
        "layer.smartFilter.disableFilterMask" | "layer.smartFilter.deleteFilterMask" => {},
        _ => return None,
    }
    Some(admit(smart))
}

fn ordinary_admission(smart: &SmartObject, preview: bool) -> Result<(), String> {
    admit(smart)?;
    if preview { admit_visible(smart, true, |_, filter| filter.visible)?; }
    Ok(())
}

fn decision(source: Option<Bytes>) -> SmartSource {
    match source { Some((file_name, bytes)) => SmartSource::Embedded { file_name, bytes }, None => SmartSource::Linked { path: String::new() } }
}

fn admit(smart: &SmartObject) -> Result<(), String> {
    admit_visible(smart, smart.filters_enabled, |_, filter| filter.visible)
}

fn admit_visible(smart: &SmartObject, enabled: bool, mut visible: impl FnMut(usize, &photocraft_engine::doc::SmartFilter) -> bool) -> Result<(), String> {
    if !enabled { return Ok(()); }
    if let Some((_, filter)) = smart.smart_filters.iter().enumerate().find(|(index, filter)| visible(*index, filter) && !PURE.contains(&filter.command.as_str())) {
        return Err(format!("Bounded linked-source replay does not support the visible filter {}", filter.command));
    }
    Ok(())
}

pub(super) fn check_stack(smart: &SmartObject) -> Result<(), String> {
    if matches!(smart.source, SmartSource::Linked { .. }) { admit(smart) } else { Ok(()) }
}

pub(super) fn placed_source(doc: &Document, smart: &SmartObject) -> Result<Option<Surface>, String> {
    if matches!(smart.source, SmartSource::Embedded { .. }) { return photocraft_engine::smart_cmds::render_below_filter(doc, smart, 0).map_err(|error| error.to_string()); }
    check_stack(smart)?;
    let Some(source) = super::smart::source_bytes(&doc.metadata, &smart.source)? else { return Ok(None); };
    let mut placed = smart.clone(); placed.source = decision(Some(source)); placed.smart_filters.clear(); placed.filter_mask = None;
    photocraft_engine::smart_cmds::render(doc, &placed).map_err(|error| error.to_string())
}

// The caller must own an isolated preview session. Its source pin must never be installed.
pub(super) fn prepare_preview(engine: &mut Session, command: &str, params: &Value) -> Result<(), String> {
    if ordinary(command) {
        let Some(id) = ordinary_target(engine, command, params)? else { return Ok(()); };
        let state = engine.active().ok_or("No preview document")?;
        let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("No preview layer")?.content else { return Ok(()); };
        let SmartSource::Linked { path } = &smart.source else { return Ok(()); };
        if path.is_empty() { return Ok(()); }
        if let Some(reason) = engine.disabled_reason(command) { return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()); }
        let admission = ordinary_admission(smart, GALLERY.contains(&command));
        let source = super::smart::source_bytes_checked(&state.doc.metadata, &smart.source, || admission)?;
        let state = engine.active_mut().ok_or("No preview document")?;
        let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut state.doc).layer_mut(id).ok_or("No preview layer")?.content else { return Err("No preview Smart Object".into()); };
        smart.source = decision(source);
        return Ok(());
    }
    pin_preview(engine, command, params, super::smart::source_bytes)
}

fn pin_preview(engine: &mut Session, command: &str, params: &Value, resolve: impl FnOnce(&photocraft_engine::doc::Metadata, &SmartSource) -> Result<Option<Bytes>, String>) -> Result<(), String> {
    if command != "layer.smartFilter.setParams" { return Ok(()); }
    let Some(state) = engine.active() else { return Ok(()); };
    let Some(id) = params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer) else { return Ok(()); };
    let Some(layer) = state.doc.layer(id) else { return Ok(()); };
    let LayerContent::Smart(smart) = &layer.content else { return Ok(()); };
    if !matches!(smart.source, SmartSource::Linked { .. }) { return Ok(()); }
    let index = match params.get("index") { Some(value) => match value.as_u64() { Some(index) => index as usize, None => return Ok(()) }, None => match smart.smart_filters.len().checked_sub(1) { Some(index) => index, None => return Ok(()) } };
    let Some(filter) = smart.smart_filters.get(index) else { return Ok(()); };
    if !EDITABLE.contains(&filter.command.as_str()) { return Err(format!("Bounded linked-source editing does not support {}", filter.command)); }
    check_stack(smart)?;
    if GALLERY.contains(&filter.command.as_str()) || ["filter.lensCorrection", "filter.adaptiveWideAngle"].contains(&filter.command.as_str()) {
        admit_visible(smart, true, |position, filter| position < index && filter.visible)?;
    }
    let source = resolve(&state.doc.metadata, &smart.source)?.ok_or("the smart object's contents are unavailable (missing linked file?), so it can't be re-rendered")?;
    let state = engine.active_mut().ok_or("No preview document")?;
    let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut state.doc).layer_mut(id).ok_or("No preview layer")?.content else { return Err("No preview Smart Object".into()); };
    smart.source = SmartSource::Embedded { file_name: source.0, bytes: source.1 };
    Ok(())
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if let Some(result) = canvas_crop::execute(engine, command, params) { return Some(result); }
    if let Some(result) = straighten::execute(engine, command, params) { return Some(result); }
    if let Some(result) = rotation::execute(engine, command, params) { return Some(result); }
    if let Some(result) = again::execute(engine, command, params) { return Some(result); }
    if let Some(result) = presets::execute(engine, command, params) { return Some(result); }
    if let Some(result) = warp::execute(engine, command, params) { return Some(result); }
    if let Some(result) = stack::execute(engine, command, params) { return Some(result); }
    if command == "edit.transform" { return transform::execute(engine, command, params); }
    if command == "layer.smartObjects.newSmartObjectViaCopy" { return copy::execute(engine, command, params); }
    if matches!(command, "layer.smartObjects.convertToEmbedded" | "layer.smartObjects.relinkToFile" | "layer.smartObjects.replaceContents" | "layer.smartObjects.exportContents" | "layer.smartObjects.convertToLinked") { return embed::execute(engine, command, params); }
    if matches!(command, "layer.smartObjects.updateModifiedContent" | "layer.smartObjects.updateAllModifiedContent") { return refresh::execute(engine, command, params); }
    if !(params.is_object() || params.is_null()) { return None; }
    let invocation = if command == "filter.lastFilter" { let invocation = engine.journal.iter().rev().find(|(id, _)| id.starts_with("filter.") && photocraft_engine::filters::params_for(id, &Value::Null).is_some())?; if !ordinary(&invocation.0) { return None; } Some(invocation.clone()) } else { None };
    let (actual_command, actual_params) = invocation.as_ref().map_or((command, params), |(id, params)| (id.as_str(), params));
    let ordinary_filter = ordinary(actual_command);
    let lifecycle = LIFECYCLE.contains(&command);
    if command != "layer.smartFilter.setParams" && !ordinary_filter && !lifecycle { return None; }
    let state = engine.active()?;
    let id = if ordinary_filter { match ordinary_target(engine, actual_command, actual_params) { Ok(id) => id?, Err(error) => return Some(Err(error)) } } else { params.get("layer").and_then(Value::as_u64).map(LayerId).or(state.active_layer)? };
    let LayerContent::Smart(smart) = &state.doc.layer(id)?.content else { return None; };
    let SmartSource::Linked { path } = &smart.source else { return None; };
    if ordinary_filter && path.is_empty() { return None; }
    let lifecycle_admission = if lifecycle { Some(prospective(smart, command, params)?) } else { None };
    let selected = if !ordinary_filter && !lifecycle { let filter = smart.smart_filters.get(filter_index(smart, params)?)?; if params.get("params").is_none() || filter.command == photocraft_engine::smart_cmds::UNSUPPORTED_FILTER { return None; } Some(filter.command.clone()) } else { None };
    let admission = if ordinary_filter { Ok(()) } else { lifecycle_admission.unwrap_or_else(|| admit(smart)) };
    let source_admission = ordinary_filter.then(|| ordinary_admission(smart, false));
    Some((|| {
        if ordinary_filter { if let Some(reason) = engine.disabled_reason(command) { return Err(photocraft_engine::EngineError::Disabled(command.into(), reason).to_string()); } }
        if let Some(job) = engine.active_job() { return Err(photocraft_engine::EngineError::Disabled(command.into(), format!("“{}” is still running on this document; wait for it to finish or cancel it (Esc)", job.label)).to_string()); }
        if let Some(selected) = selected { if !EDITABLE.contains(&selected.as_str()) { return Err(format!("Bounded linked-source editing does not support {selected}")); } }
        admission?;
        if let Some(admission) = source_admission { run_with_invocation(engine, command, params, id, invocation, |meta, source| super::smart::source_bytes_checked(meta, source, || admission)) }
        else { run(engine, command, params, id, super::smart::source_bytes) }
    })())
}

fn run(engine: &mut Session, command: &str, params: &Value, id: LayerId, resolve: impl FnOnce(&photocraft_engine::doc::Metadata, &SmartSource) -> Result<Option<Bytes>, String>) -> Result<Value, String> {
    run_with_invocation(engine, command, params, id, None, resolve)
}

fn run_with_invocation(engine: &mut Session, command: &str, params: &Value, id: LayerId, invocation: Option<(String, Value)>, resolve: impl FnOnce(&photocraft_engine::doc::Metadata, &SmartSource) -> Result<Option<Bytes>, String>) -> Result<Value, String> {
    let ordinary_filter = ordinary(command) || invocation.is_some();
    let state = engine.active().ok_or("No image document")?;
    let LayerContent::Smart(smart) = &state.doc.layer(id).ok_or("The Smart Object no longer exists")?.content else { return Err("Select a Smart Object".into()); };
    let original = smart.source.clone();
    let source = resolve(&state.doc.metadata, &original)?;
    if source.is_none() && !ordinary_filter { return Err("the smart object's contents are unavailable (missing linked file?), so it can't be re-rendered".into()); }
    let mut draft = super::snapshot::capture(state, super::snapshot::HistoryPolicy::Discard);
    let LayerContent::Smart(target) = &mut Arc::make_mut(&mut draft.doc).layer_mut(id).ok_or("The Smart Object no longer exists")?.content else { return Err("Select a Smart Object".into()); };
    target.source = decision(source);
    let mut scratch = Session::new(); scratch.add_document(Document::new("Linked replay", draft.doc.size, draft.doc.mode, draft.doc.depth), None); *scratch.active_mut().ok_or("No replay document")? = draft;
    scratch.tools = engine.tools.clone();
    super::color_views::Snapshot::capture(engine)?.install(&mut scratch)?;
    let seeded = invocation.is_some();
    if let Some(invocation) = invocation { scratch.journal.push(invocation); }
    let recorded = if params.is_null() { Value::Null } else { super::mask_filters::clean_parameters(params)? };
    let result = scratch.execute(command, recorded).map_err(|error| error.to_string())?;
    if scratch.journal.len() != 1 + usize::from(seeded) || scratch.journal.last().is_none_or(|entry| entry.0 != command) { return Err("Linked replay produced an unexpected command journal".into()); }
    let entry = scratch.journal.pop().ok_or("Missing linked replay journal")?;
    let computed = scratch.active().ok_or("No replay document")?;
    let label = computed.history.undo_label().ok_or("Linked replay produced no edit")?.to_owned();
    let mut document = (*computed.doc).clone();
    let LayerContent::Smart(target) = &mut document.layer_mut(id).ok_or("The Smart Object no longer exists")?.content else { return Err("Linked replay changed the layer type".into()); };
    target.source = original;
    let view = computed.channel_view.clone(); let selected = computed.selected_layers.clone(); let anchor = computed.layer_anchor; let active = computed.active_layer;
    let fade = ordinary_filter.then(|| scratch.edit_state.fade.clone());
    super::mask_filters::edit_history(engine, &label, &entry.1, |doc, layer| { *doc = document; *layer = active; Ok(()) })?;
    let state = engine.active_mut().ok_or("No image document")?;
    state.channel_view = view; state.selected_layers = selected; state.layer_anchor = anchor;
    if let Some(mut fade) = fade { if let Some(source) = &mut fade { source.doc = state.doc.id; source.revision = state.revision; source.label = state.history.undo_label().unwrap_or(command).into(); } engine.edit_state.fade = fade; }
    engine.sync_preset_store();
    engine.journal.push(entry);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{BlendMode, Layer, LayerMask, SmartFilter, Slice, SliceOrigin};
    use serde_json::json;
    use std::{path::PathBuf, io::{Read, ErrorKind}};

    struct Temp(PathBuf);
    impl Drop for Temp { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
    fn temp() -> Temp { let path=std::env::temp_dir().join(format!("linked-replay-{}",ulid::Ulid::new()));std::fs::create_dir_all(&path).unwrap();Temp(path) }
    fn source(depth:u32,color:[f32;4])->Document {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":16,"height":12,"depth":depth})).unwrap();engine.edit("Known source",|doc,active|{let bounds=doc.bounds();doc.layer_mut(active.unwrap()).unwrap().surface_mut().unwrap().fill_rect(bounds,&color);Ok(())}).unwrap();(*engine.active().unwrap().doc).clone()
    }
    fn bytes(doc:&Document)->Vec<u8>{photocraft_engine::smart_cmds::encode_source(doc).unwrap()}
    fn neutral(command:&str)->Value { match command {
        "filter.cameraRaw"=>json!({"exposure":0}), "filter.lensCorrection"=>json!({"angle":0,"scale":100,"profile":"none","autoScale":false}), "filter.adaptiveWideAngle"=>json!({"model":"perspective","focalLength":50,"cropFactor":1,"scale":100,"constraints":[],"interpolation":"bicubic"}),
        "filter.blurGallery.spinBlur"=>json!({"blurAngle":0}), "filter.blurGallery.pathBlur"=>json!({"speed":0}), command if BASIC.contains(&command)=>basic_settings(command), command if SHARPEN.contains(&command)=>sharpen_settings(command), _=>json!({"blur":0}),
    } }
    fn smart(doc:&Document,id:LayerId)->&SmartObject { let LayerContent::Smart(smart)=&doc.layer(id).unwrap().content else{panic!("missing smart")};smart }
    fn fixture(depth:u32,command:&str)->(Temp,Session,LayerId,PathBuf) {
        let dir=temp();let path=dir.0.join("source.pcraft");let original=source(depth,[0.125,0.25,0.375,0.5]);std::fs::write(&path,bytes(&original)).unwrap();let mut engine=Session::new();engine.add_document(original,None);engine.execute("layer.smartObjects.convertToSmartObject",json!({})).unwrap();let id=engine.active().unwrap().active_layer.unwrap();
        engine.edit("Linked fixture",|doc,_|{let bounds=doc.bounds();let layer=doc.layer_mut(id).unwrap();let LayerContent::Smart(smart)=&mut layer.content else{unreachable!()};smart.source=SmartSource::Linked{path:path.to_string_lossy().into_owned()};smart.smart_filters=vec![SmartFilter{command:command.into(),params:neutral(command),visible:true,opacity:1.,blend:BlendMode::Normal}];smart.psd_raw=Some(Arc::new(b"retained placed descriptor".to_vec()));let mut mask=LayerMask::hide_all();mask.enabled=false;mask.density=0.42;mask.feather=1.25;mask.surface.fill_rect(bounds,&[0.25]);smart.filter_mask=Some(mask);photocraft_engine::smart_cmds::refresh(doc,id)?;let rect=photocraft_engine::slice_cmds::layer_bounds(doc.layer(id).unwrap());doc.slices.list.push(Slice{id:7,origin:SliceOrigin::Layer,layer:Some(id),rect,..Default::default()});Ok(())}).unwrap();
        (dir,engine,id,path)
    }
    fn twin(engine:&Session)->Session {
        let state=engine.active().unwrap();let mut copy=Session::new();copy.add_document(Document::new("Copy",state.doc.size,state.doc.mode,state.doc.depth),None);*copy.active_mut().unwrap()=state.clone();copy.journal=engine.journal.clone();copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy.patterns=engine.patterns.clone();copy.clipboard=engine.clipboard.clone();copy.style_clipboard=engine.style_clipboard.clone();copy.edit_state=engine.edit_state.clone();super::super::color_views::Snapshot::capture(engine).unwrap().install(&mut copy).unwrap();copy
    }
    fn assert_state(actual:&Session,expected:&Session) {
        let a=actual.active().unwrap();let e=expected.active().unwrap();assert_eq!(a.doc,e.doc);assert_eq!(a.history.entries(),e.history.entries());assert_eq!(a.history.past_len(),e.history.past_len());for index in 0..a.history.past_len(){assert_eq!(a.history.state(index),e.history.state(index));}assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),e.history.redo_labels().collect::<Vec<_>>());assert_eq!(a.revision,e.revision);assert_eq!(a.saved_revision,e.saved_revision);assert_eq!(a.coalesce,e.coalesce);assert_eq!(a.active_layer,e.active_layer);assert_eq!(a.selected_layers,e.selected_layers);assert_eq!(a.layer_anchor,e.layer_anchor);assert_eq!(a.path,e.path);assert_eq!(format!("{:?}",a.channel_view),format!("{:?}",e.channel_view));assert_eq!(a.last_damage,e.last_damage);assert_eq!(a.isolated_layers,e.isolated_layers);assert_eq!(format!("{:?}",a.symmetry_path),format!("{:?}",e.symmetry_path));assert_eq!(a.fx_collapsed,e.fx_collapsed);assert_eq!(actual.journal,expected.journal);assert_eq!(actual.tools.brush,expected.tools.brush);assert_eq!(actual.tools.foreground,expected.tools.foreground);assert_eq!(super::super::tools::presets(actual),super::super::tools::presets(expected));assert_eq!(actual.edit_state.fade,expected.edit_state.fade);assert_eq!(format!("{:?}",actual.clipboard),format!("{:?}",expected.clipboard));assert_eq!(actual.style_clipboard,expected.style_clipboard);
    }
    fn unchanged(engine:&Session,before:&Session) {assert_state(engine,before);assert!(Arc::ptr_eq(&engine.active().unwrap().doc,&before.active().unwrap().doc));}
    fn basic_settings(command:&str)->Value{match command{"filter.blur.motionBlur"=>json!({"angle":0,"distance":3}),"filter.blur.radialBlur"=>json!({"amount":1,"method":"spin","centerX":0.5,"centerY":0.5}),"filter.blur.surfaceBlur"=>json!({"radius":1,"threshold":15}),_=>json!({"radius":1})}}
    fn patterned_source(depth:u32)->Document{let mut doc=source(depth,[0.,0.,0.,1.]);let bounds=doc.bounds();let surface=doc.layers[0].surface_mut().unwrap();for y in bounds.y0..bounds.y1{for x in bounds.x0..bounds.x1{surface.write_pixel(x,y,&[(x%5)as f32/4.,(y%4)as f32/3.,((x+2*y)%7)as f32/6.,((x+y)%4+1)as f32/4.]);}}doc}
    fn box_mean(surface:&Surface,x:i32,y:i32)->[f32;4]{let mut sum=[0.;4];for sy in y-1..=y+1{for sx in x-1..=x+1{let pixel=surface.pixel(sx,sy);sum[3]+=pixel[3];for channel in 0..3{sum[channel]+=pixel[channel]*pixel[3];}}}let alpha=sum[3];[sum[0]/alpha,sum[1]/alpha,sum[2]/alpha,alpha/9.]}

    fn sharpen_settings(command: &str) -> Value {
        if command == SHARPEN[0] { json!({"amount":80,"radius":0.7,"threshold":7}) }
        else { json!({"amount":80,"radius":0.7,"reduceNoise":35}) }
    }

    fn sharpen_source(depth: u32) -> Document {
        let mut doc = source(depth, [0.,0.,0.,1.]);
        let bounds = doc.bounds(); let surface = doc.layers[0].surface_mut().unwrap();
        for y in bounds.y0..bounds.y1 { for x in bounds.x0..bounds.x1 {
            let rgba = if (x,y) == (7,5) { [0.;4] } else {
                [0.30 + ((x+2*y)%5) as f32*0.06, 0.35 + ((2*x+y)%4) as f32*0.05,
                 0.40 + ((x+y)%3) as f32*0.04, 0.25 + ((x+y)%4) as f32*0.25]
            };
            surface.write_pixel(x,y,&rgba);
        }}
        doc
    }

    // A full 2-D f64 weighted sum is independent of the native separable f32 implementation.
    fn sharpen_oracle(input: &Surface, x: i32, y: i32, command: &str, params: &Value) -> [f64;4] {
        let original = input.pixel(x,y);
        let mut result = [original[0] as f64,original[1] as f64,original[2] as f64,original[3] as f64];
        if original[3] == 0. { return result; }
        let sigma = params["radius"].as_f64().unwrap(); let radius = (sigma*3.).ceil() as i32;
        let bounds = photocraft_engine::doc::Rect::new(0,0,16,12);
        let mut weights = 0.; let mut alpha = 0.; let mut premultiplied = [0.;3];
        for dy in -radius..=radius { for dx in -radius..=radius {
            let weight = (-((dx*dx+dy*dy) as f64)/(2.*sigma*sigma)).exp();
            let sample = input.pixel((x+dx).clamp(bounds.x0,bounds.x1-1),(y+dy).clamp(bounds.y0,bounds.y1-1));
            weights += weight; alpha += weight*sample[3] as f64;
            for channel in 0..3 { premultiplied[channel] += weight*sample[channel] as f64*sample[3] as f64; }
        }}
        assert!(weights > 0. && alpha > 0.);
        for channel in 0..3 {
            let difference = original[channel] as f64-premultiplied[channel]/alpha;
            let keep = if command == SHARPEN[0] {
                if difference.abs()+1e-6 >= params["threshold"].as_f64().unwrap()/255. { 1. } else { 0. }
            } else { 1.-params["reduceNoise"].as_f64().unwrap()/100.*(-difference.abs()*40.).exp() };
            result[channel] += params["amount"].as_f64().unwrap()/100.*difference*keep;
        }
        result
    }

    fn assert_sharpen_pixels(engine: &Session, id: LayerId, input: &Surface, command: &str, params: &Value, depth: u32, coverage: impl Fn(i32,i32)->f64) {
        let tolerance = match depth { 8=>2./255.+1e-6,16=>3./65535.+1e-6,_=>3e-6 };
        let mut changed = false;
        for y in 0..12 { for x in 0..16 {
            let before = input.pixel(x,y); let sharp = sharpen_oracle(input,x,y,command,params); let actual = pixel(engine,id,x,y);
            for channel in 0..4 {
                let expected = before[channel] as f64+(sharp[channel]-before[channel] as f64)*coverage(x,y);
                assert!((actual[channel] as f64-expected).abs()<=tolerance,"{command}/{depth} ({x},{y}) channel{channel}: {} vs {expected}",actual[channel]);
                if channel < 3 && (expected-before[channel] as f64).abs()>0.01 { changed = true; }
            }
            assert_eq!(actual[3],before[3],"sharpen preserves original alpha at ({x},{y})");
        }}
        assert!(changed,"nonuniform oracle must exercise an actual residual");
    }

    fn empty_sharpen_fixture(depth: u32) -> (Temp,Session,LayerId,PathBuf) {
        let (dir,mut engine,id,path) = fixture(depth,"filter.cameraRaw");
        engine.edit("Empty sharpen stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.clear();smart.filter_mask=None;Ok(())}).unwrap();
        (dir,engine,id,path)
    }

    #[test]
    fn linked_replay_sharpen_two_commands_three_depths_match_native_and_independent_full_pixels() {
        for depth in [8,16,32] { for command in SHARPEN {
            let (_dir,mut engine,id,path)=empty_sharpen_fixture(depth); let input=sharpen_source(depth);
            std::fs::write(path,bytes(&input)).unwrap(); let before=engine.active().unwrap().doc.clone();
            let mut params=sharpen_settings(command);params["layer"]=json!(id.0);
            let mut expected=twin(&engine);let result=expected.execute(command,params.clone()).unwrap();
            assert_eq!(super::super::execute_view_command(&mut engine,command,params.clone()).unwrap(),result);assert_state(&engine,&expected);
            assert_sharpen_pixels(&engine,id,input.layers[0].surface().unwrap(),command,&params,depth,|_,_|1.);
            assert_eq!(smart(&engine.active().unwrap().doc,id).source,smart(&before,id).source);
            assert_eq!(smart(&engine.active().unwrap().doc,id).smart_filters.len(),1);
            assert!(gallery_target(&engine,command,&params).unwrap().is_none());
            assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,if command==SHARPEN[0]{"Unsharp Mask"}else{"Smart Sharpen"});
            let patch=if command==SHARPEN[0]{json!({"threshold":255})}else{json!({"reduceNoise":100})};
            let selected=json!({"layer":id.0,"index":0,"params":patch});expected.execute("layer.smartFilter.setParams",selected.clone()).unwrap();super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",selected).unwrap();assert_state(&engine,&expected);
            if command==SHARPEN[0] {
                let tolerance=match depth{8=>2./255.,16=>3./65535.,_=>3e-6};
                for y in 0..12 {for x in 0..16 {let original=input.layers[0].surface().unwrap().pixel(x,y);for (actual,original) in pixel(&engine,id,x,y).iter().zip(original){assert!((*actual-original).abs()<=tolerance,"maximum threshold must leave source unchanged");}}}
            } else {
                let mut reduced=params.clone();reduced["reduceNoise"]=json!(100);
                assert_sharpen_pixels(&engine,id,input.layers[0].surface().unwrap(),command,&reduced,depth,|_,_|1.);
                assert_ne!(sharpen_oracle(input.layers[0].surface().unwrap(),4,4,command,&params),sharpen_oracle(input.layers[0].surface().unwrap(),4,4,command,&reduced));
            }
        }}
    }

    #[test]
    fn linked_replay_sharpen_selected_shallow_merge_unknowns_and_full_pixel_oracle() {
        for depth in [8,16,32] { for command in SHARPEN {
            let (_dir,mut engine,id,path)=fixture(depth,command); let input=sharpen_source(depth);
            engine.edit("Sharpen unknown legacy parameters",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filter_mask=None;smart.smart_filters[0].params["vendor"]=json!({"old":[1,2]});smart.smart_filters[0].params["future"]=json!({"nested":[true,{"retain":3}]});Ok(())}).unwrap();
            std::fs::write(path,bytes(&input)).unwrap();let original=smart(&engine.active().unwrap().doc,id).source.clone();
            let mut patch=sharpen_settings(command);patch["vendor"]=json!({"replacement":depth});let params=json!({"layer":id.0,"index":0,"params":patch});let mut expected=twin(&engine);
            let result=expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",params).unwrap(),result);assert_state(&engine,&expected);
            assert_sharpen_pixels(&engine,id,input.layers[0].surface().unwrap(),command,&sharpen_settings(command),depth,|_,_|1.);
            let smart=smart(&engine.active().unwrap().doc,id);assert_eq!(smart.source,original);assert_eq!(smart.smart_filters[0].params["vendor"],json!({"replacement":depth}));assert_eq!(smart.smart_filters[0].params["future"],json!({"nested":[true,{"retain":3}]}));assert!(smart.smart_filters[0].params["vendor"].get("old").is_none());
        }}
    }

    #[test]
    fn linked_replay_sharpen_soft_selection_has_independent_pixels_and_native_filter_mask() {
        for depth in [8,16,32] { for command in SHARPEN {
            let (_dir,mut engine,id,path)=empty_sharpen_fixture(depth); let input=sharpen_source(depth);std::fs::write(path,bytes(&input)).unwrap();
            let selection=photocraft_engine::doc::Rect::new(-3,-2,10,9);
            engine.edit("Off-canvas soft sharpen selection",|doc,_|{let mut mask=Surface::new(photocraft_engine::doc::PixelFormat::GRAY8);mask.fill_rect(selection,&[0.5]);doc.selection=Some(mask);Ok(())}).unwrap();
            let mut params=sharpen_settings(command);params["layer"]=json!(id.0);let mut expected=twin(&engine);expected.execute(command,params.clone()).unwrap();super::super::execute_view_command(&mut engine,command,params.clone()).unwrap();assert_state(&engine,&expected);
            assert_sharpen_pixels(&engine,id,input.layers[0].surface().unwrap(),command,&params,depth,|x,y|if selection.contains(x,y){128./255.}else{0.});
            let mask=smart(&engine.active().unwrap().doc,id).filter_mask.as_ref().unwrap();assert!(mask.enabled);assert_eq!(mask.surface.content_bounds(),selection);assert_eq!(engine.active().unwrap().doc.selection.as_ref().unwrap().content_bounds(),selection);
        }}
    }

    #[test]
    fn linked_replay_sharpen_missing_source_uses_cache_even_with_disabled_or_unsafe_prior_stack() {
        for depth in [8,16,32] { for command in SHARPEN { for disabled in [false,true] {
            let (_dir,mut engine,id,path)=empty_sharpen_fixture(depth);let input=sharpen_source(depth);let cached=input.layers[0].surface().unwrap().clone();
            engine.edit("Native missing sharpen cache",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.cache=Some(cached.clone());smart.filters_enabled=!disabled;smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();
            std::fs::remove_file(&path).unwrap();let original=smart(&engine.active().unwrap().doc,id).source.clone();let params=sharpen_settings(command);let mut expected=twin(&engine);
            expected.execute(command,params.clone()).unwrap();super::super::execute_view_command(&mut engine,command,params.clone()).unwrap();assert_state(&engine,&expected);assert_sharpen_pixels(&engine,id,&cached,command,&params,depth,|_,_|1.);
            assert_eq!(smart(&engine.active().unwrap().doc,id).source,original);assert!(smart(&engine.active().unwrap().doc,id).filter_mask.is_none());
            let before=twin(&engine);let selected=json!({"layer":id.0,"index":1,"params":params});let mut native=twin(&engine);
            if disabled { assert_eq!(execute(&mut engine,"layer.smartFilter.setParams",&selected).unwrap().unwrap_err(),native.execute("layer.smartFilter.setParams",selected).unwrap_err().to_string()); }
            else { assert!(execute(&mut engine,"layer.smartFilter.setParams",&selected).unwrap().unwrap_err().contains("does not support")); }
            unchanged(&engine,&before);
        }}}
    }

    #[test]
    fn linked_replay_sharpen_numeric_preview_pins_one_decision_and_keeps_disabled_lower_stack_unexecuted() {
        for command in SHARPEN { for available in [false,true] {
            let (_dir,engine,id,path)=empty_sharpen_fixture(16);let input=sharpen_source(16);
            if available { std::fs::write(&path,bytes(&input)).unwrap(); } else { std::fs::remove_file(&path).unwrap(); }
            let original=twin(&engine);let mut reference=twin(&engine);let params=sharpen_settings(command);reference.execute(command,params.clone()).unwrap();
            let mut preview=twin(&engine);prepare_preview(&mut preview,command,&params).unwrap();
            if available { std::fs::remove_file(&path).unwrap(); } else { std::fs::write(&path,bytes(&input)).unwrap(); }
            assert!(execute(&mut preview,command,&params).is_none());super::super::execute_view_command(&mut preview,command,params.clone()).unwrap();
            assert_eq!(preview.active().unwrap().doc.layer(id).unwrap().surface(),reference.active().unwrap().doc.layer(id).unwrap().surface());
            if available { assert_sharpen_pixels(&preview,id,input.layers[0].surface().unwrap(),command,&params,16,|_,_|1.); }
            assert_eq!(smart(&preview.active().unwrap().doc,id).smart_filters,smart(&reference.active().unwrap().doc,id).smart_filters);unchanged(&engine,&original);
        }}
        for command in SHARPEN { for selected in [false,true] {
            let (_dir,mut engine,id,path)=fixture(16,command);
            engine.edit("Disabled external lower sharpen stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=false;smart.smart_filters.insert(0,SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();
            let invoked=if selected{"layer.smartFilter.setParams"}else{command};let params=if selected{json!({"layer":id.0,"index":1,"params":sharpen_settings(command)})}else{sharpen_settings(command)};
            let original=twin(&engine);let mut reference=twin(&engine);reference.execute(invoked,params.clone()).unwrap();
            let mut preview=twin(&engine);prepare_preview(&mut preview,invoked,&params).unwrap();std::fs::remove_file(&path).unwrap();
            super::super::execute_view_command(&mut preview,invoked,params.clone()).unwrap();assert_eq!(preview.active().unwrap().doc.layer(id).unwrap().surface(),reference.active().unwrap().doc.layer(id).unwrap().surface());unchanged(&engine,&original);
            let mut missing=twin(&engine);
            if selected {assert!(prepare_preview(&mut missing,invoked,&params).unwrap_err().contains("unavailable"));unchanged(&missing,&original);}
            else {prepare_preview(&mut missing,invoked,&params).unwrap();assert!(matches!(&smart(&missing.active().unwrap().doc,id).source,SmartSource::Linked{path}if path.is_empty()));}
            unchanged(&engine,&original);
        }}
    }

    #[test]
    fn linked_replay_sharpen_actual_coverage_and_raster_targets_bypass_source_and_explicit_pixels_still_bound_it() {
        for command in SHARPEN { for route in ["alpha","quick","mask","raster"] {
            let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut params=sharpen_settings(command);
            match route {
                "alpha"=>{engine.execute("channel.new",json!({"name":"Sharpen coverage"})).unwrap();},
                "quick"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},
                "mask"=>{engine.edit("Sharpen layer mask",|doc,_|{doc.layer_mut(id).unwrap().mask=Some(LayerMask::hide_all());Ok(())}).unwrap();engine.execute("view.layerMask",json!({"layer":id.0,"mode":"gray"})).unwrap();},
                _=>{engine.edit("Sharpen raster",|doc,active|{let layer=Layer::raster("Unrelated sharpen raster",doc.pixel_format());*active=Some(doc.insert_above(Some(id),layer));Ok(())}).unwrap();},
            }
            std::fs::OpenOptions::new().write(true).open(path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();let before=twin(&engine);
            assert!(ordinary_target(&engine,command,&params).unwrap().is_none());assert!(gallery_target(&engine,command,&params).unwrap().is_none());assert!(execute(&mut engine,command,&params).is_none());prepare_preview(&mut engine,command,&params).unwrap();unchanged(&engine,&before);
            super::super::execute_view_command(&mut engine,command,params.clone()).unwrap();assert_eq!(smart(&engine.active().unwrap().doc,id),smart(&before.active().unwrap().doc,id));assert_eq!(engine.active().unwrap().history.past_len(),before.active().unwrap().history.past_len()+1);
            if route=="alpha" { params["target"]=json!("pixels");let before=twin(&engine);assert_eq!(ordinary_target(&engine,command,&params).unwrap(),Some(id));assert!(execute(&mut engine,command,&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before); }
        }}
    }

    #[test]
    fn linked_replay_sharpen_native_defaults_refusals_caps_and_private_markers_preserve_state() {
        for command in SHARPEN {
            let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut native=twin(&engine);
            assert_eq!(execute(&mut engine,command,&Value::Null).unwrap().unwrap(),native.execute(command,Value::Null).unwrap());assert_state(&engine,&native);assert!(engine.journal.last().unwrap().1.is_null());
            let mut params=sharpen_settings(command);params["__xdesignChannelFade"]=json!({"forged":true});let clean=super::super::mask_filters::clean_parameters(&params).unwrap();native.execute(command,clean).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();assert_state(&engine,&native);assert!(engine.journal.last().unwrap().1.get("__xdesignChannelFade").is_none());
            for fallback in [json!({"amount":"native default","radius":-1,"threshold":999,"reduceNoise":999}),json!({"amount":999,"radius":0.1,"threshold":-5,"reduceNoise":-5})] {let result=native.execute(command,fallback.clone()).unwrap();assert_eq!(execute(&mut engine,command,&fallback).unwrap().unwrap(),result);assert_state(&engine,&native);}
            let before=twin(&engine);let invalid=json!({"layer":u64::MAX});assert!(execute(&mut engine,command,&invalid).is_none());let mut native=twin(&engine);assert_eq!(super::super::execute_view_command(&mut engine,command,invalid.clone()).unwrap_err(),native.execute(command,invalid).unwrap_err().to_string());unchanged(&engine,&before);
            assert!(execute(&mut engine,command,&json!("bad object")).is_none());unchanged(&engine,&before);
            std::fs::write(&path,b"corrupt sharpen source").unwrap();let mut native=twin(&engine);assert_eq!(execute(&mut engine,command,&params).unwrap().unwrap_err(),native.execute(command,params.clone()).unwrap_err().to_string());unchanged(&engine,&before);
            std::fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();assert!(execute(&mut engine,command,&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);
            engine.edit("Sharpen disabled missing cache",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.cache=None;Ok(())}).unwrap();let before=twin(&engine);let mut native=twin(&engine);let error=execute(&mut engine,command,&params).unwrap().unwrap_err();assert_eq!(error,native.execute(command,params).unwrap_err().to_string());assert!(!error.contains("512MB"));unchanged(&engine,&before);
        }
        for command in SHARPEN {
            let (_dir,mut engine,id,path)=fixture(16,command);engine.edit("Unsafe visible sharpen stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();std::fs::write(path,b"must not decode").unwrap();let before=twin(&engine);
            assert!(execute(&mut engine,command,&sharpen_settings(command)).unwrap().unwrap_err().contains("does not support"));
            let selected=json!({"layer":id.0,"index":0,"params":sharpen_settings(command)});assert!(pin_preview(&mut engine,"layer.smartFilter.setParams",&selected,|_,_|panic!("unsafe visible stack must refuse before read")).unwrap_err().contains("does not support"));unchanged(&engine,&before);
        }
    }

    #[test]
    fn linked_replay_sharpen_repeat_keeps_recorded_target_outer_group_native_fade_and_history() {
        for command in SHARPEN {
            let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut inner=sharpen_settings(command);inner["layer"]=json!(id.0);inner["target"]=json!("pixels");inner["coalesce"]=json!("sharpen-recorded");engine.execute(command,inner.clone()).unwrap();
            engine.edit("Other sharpen active layer",|doc,active|{let layer=Layer::raster("Unrelated sharpen active",doc.pixel_format());*active=Some(doc.insert_above(Some(id),layer));Ok(())}).unwrap();let before=engine.active().unwrap().doc.clone();
            engine.execute("layer.smartFilter.setVisible",json!({"layer":id.0,"index":0,"visible":true,"coalesce":"sharpen-outer"})).unwrap();let count=engine.active().unwrap().history.past_len();std::fs::write(&path,bytes(&source_document(16))).unwrap();let mut native=twin(&engine);let outer=json!({"layer":u64::MAX,"coalesce":"sharpen-outer","amount":999});
            for _ in 0..2 { let result=native.execute("filter.lastFilter",outer.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,"filter.lastFilter",outer.clone()).unwrap(),result);assert_state(&engine,&native); }
            assert_eq!(engine.active().unwrap().history.past_len(),count);assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,"Smart Filter Visibility");assert_eq!(engine.journal.last().unwrap(),&("filter.lastFilter".into(),outer));assert_eq!(engine.journal.iter().rev().find(|(id,_)|id==command).unwrap().1,inner);known_pixel(&pixel(&engine,id,8,6),[0.75,0.5,0.25,0.75],16);
            let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);
            std::fs::remove_file(&path).unwrap();let mut native=twin(&engine);let result=native.execute("filter.lastFilter",json!({})).unwrap();assert_eq!(execute(&mut engine,"filter.lastFilter",&json!({})).unwrap().unwrap(),result);assert_state(&engine,&native);
        }
    }

    #[test]
    fn linked_replay_sharpen_mixed_group_publishes_immutable_linked_history_and_reopens_redo() {
        let (dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");std::fs::write(path,bytes(&source_document(16))).unwrap();engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);engine.tools.foreground=[0.2,0.3,0.4,0.5];
        let before=engine.active().unwrap().doc.clone();let count=engine.active().unwrap().history.past_len();let mut native=twin(&engine);
        for command in SHARPEN { let mut params=sharpen_settings(command);params["layer"]=json!(id.0);params["coalesce"]=json!("sharpen-group");native.execute(command,params.clone()).unwrap();super::super::execute_view_command(&mut engine,command,params).unwrap();assert_state(&engine,&native); }
        for patch in [json!({"amount":65}),json!({"future":{"stable":[1,2]}})] {let params=json!({"layer":id.0,"index":1,"params":patch,"coalesce":"sharpen-group"});native.execute("layer.smartFilter.setParams",params.clone()).unwrap();super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",params).unwrap();assert_state(&engine,&native);}
        assert_eq!(engine.active().unwrap().history.past_len(),count+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some("Unsharp Mask"));let after=engine.active().unwrap().doc.clone();assert_eq!(smart(&after,id).source,smart(&before,id).source);
        let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();super::super::publish(&dir.0,&photo,&mut session).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(session.engine.active().unwrap().doc,before);
        super::super::publish(&dir.0,&photo,&mut session).unwrap();super::super::save_view(&dir.0,&session).unwrap();let mut reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);assert!(reopened.engine.active().unwrap().history.can_redo());assert_eq!(reopened.engine.active().unwrap().channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));
        reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);
    }

    #[test]
    fn linked_replay_sharpen_owner_preset_flush_matches_native_success_and_preserves_refusal() {
        use photocraft_engine::preset_store::{open,MemBackend};
        for command in SHARPEN {
            let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut native=twin(&engine);let actual_store=MemBackend::default();let native_store=MemBackend::default();engine.attach_preset_store(open(Box::new(actual_store.clone())));native.attach_preset_store(open(Box::new(native_store.clone())));
            for owner in [&mut engine,&mut native] {let mut preset=owner.tools.presets[0].clone();preset.name="Pending sharpen brush".into();preset.group="Sharpen owner".into();preset.builtin=false;owner.tools.presets.push(preset);owner.brush_presets_changed();}
            let stored=actual_store.files.lock().unwrap().clone();let before=twin(&engine);std::fs::write(&path,b"corrupt sharpen pending owner").unwrap();let mut params=sharpen_settings(command);params["layer"]=json!(id.0);
            assert!(execute(&mut engine,command,&params).unwrap().is_err());assert!(native.execute(command,params.clone()).is_err());assert_state(&engine,&native);unchanged(&engine,&before);assert_eq!(*actual_store.files.lock().unwrap(),stored);assert_eq!(*native_store.files.lock().unwrap(),stored);
            std::fs::write(path,bytes(&source_document(16))).unwrap();native.execute(command,params.clone()).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();assert_state(&engine,&native);let files=actual_store.files.lock().unwrap().clone();assert_ne!(files,stored);assert_eq!(files,*native_store.files.lock().unwrap());assert!(open(Box::new(actual_store)).presets.iter().any(|preset|preset.name=="Pending sharpen brush"));
        }
    }

    #[test]
    fn linked_replay_basic_five_three_depths_match_native_and_fresh_or_cached_pixels(){
        for depth in [8,16,32]{for command in BASIC{for available in [false,true]{let(_dir,mut engine,id,path)=fixture(depth,"filter.cameraRaw");let mut params=basic_settings(command);params["layer"]=json!(id.0);if command==BASIC[0]{engine.execute("channel.new",json!({"name":"Unrelated selected alpha"})).unwrap();params["target"]=json!("pixels");}if available{std::fs::write(&path,bytes(&source_document(depth))).unwrap();}else{std::fs::remove_file(&path).unwrap();}let before=engine.active().unwrap().doc.clone();let mut expected=twin(&engine);let value=expected.execute(command,params.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,command,params.clone()).unwrap(),value);assert_state(&engine,&expected);assert!(gallery_target(&engine,command,&params).unwrap().is_none());assert_eq!(ordinary_target(&engine,command,&params).unwrap(),Some(id));assert_eq!(smart(&engine.active().unwrap().doc,id).source,smart(&before,id).source);assert_eq!(smart(&engine.active().unwrap().doc,id).smart_filters.len(),2);known_pixel(&pixel(&engine,id,8,6),if available{[0.75,0.5,0.25,0.75]}else{[0.125,0.25,0.375,0.5]},depth);}}}
    }

    #[test]
    fn linked_replay_basic_box_has_independent_nonuniform_premultiplied_offcanvas_oracle(){
        for depth in [8,16,32]{let(_dir,mut engine,id,path)=fixture(depth,"filter.cameraRaw");engine.edit("Off-canvas placed source",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.transform.m[4]=-3.;smart.transform.m[5]=-2.;photocraft_engine::smart_cmds::refresh(doc,id)?;let rect=photocraft_engine::slice_cmds::layer_bounds(doc.layer(id).unwrap());doc.slices.list.iter_mut().find(|slice|slice.id==7).unwrap().rect=rect;Ok(())}).unwrap();let source=patterned_source(depth);let original=source.layers[0].surface().unwrap();std::fs::write(path,bytes(&source)).unwrap();let before=engine.active().unwrap().doc.clone();let params=json!({"layer":id.0,"radius":1});let mut expected=twin(&engine);expected.execute(BASIC[1],params.clone()).unwrap();super::super::execute_view_command(&mut engine,BASIC[1],params).unwrap();assert_state(&engine,&expected);for(x,y)in [(-2,0),(3,4),(10,8)]{known_pixel(&pixel(&engine,id,x,y),box_mean(original,x+3,y+2),depth);}known_pixel(&pixel(&engine,id,18,14),[0.;4],depth);assert_ne!(pixel(&engine,id,3,4),before.layer(id).unwrap().surface().unwrap().pixel(3,4));assert!(engine.active().unwrap().doc.layer(id).unwrap().surface().unwrap().content_bounds().x0<0);}
    }

    #[test]
    fn linked_replay_basic_missing_unsafe_disabled_cache_and_available_selection_mask_keep_native_rules(){
        for disabled in [false,true]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let pattern=patterned_source(16);let cache=pattern.layers[0].surface().unwrap().clone();engine.edit("Missing-source cached pattern",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=!disabled;smart.cache=Some(cache.clone());smart.filter_mask=None;smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:0.,blend:BlendMode::Normal});let mut selection=Surface::new(photocraft_engine::doc::PixelFormat::GRAY8);selection.fill_rect(photocraft_engine::doc::Rect::new(-3,-2,20,15),&[1.]);doc.selection=Some(selection);Ok(())}).unwrap();std::fs::remove_file(path).unwrap();let before=engine.active().unwrap().doc.clone();let params=json!({"layer":id.0,"radius":1});let mut expected=twin(&engine);expected.execute(BASIC[1],params.clone()).unwrap();super::super::execute_view_command(&mut engine,BASIC[1],params).unwrap();assert_state(&engine,&expected);known_pixel(&pixel(&engine,id,5,4),box_mean(&cache,5,4),16);assert_ne!(pixel(&engine,id,5,4),cache.pixel(5,4));assert!(smart(&engine.active().unwrap().doc,id).filter_mask.is_none());assert_eq!(smart(&engine.active().unwrap().doc,id).source,smart(&before,id).source);}
        let(_dir,mut engine,id,path)=lower_fixture(16,false);engine.edit("Soft filter selection",|doc,_|{let mut selection=Surface::new(photocraft_engine::doc::PixelFormat::GRAY8);selection.fill_rect(photocraft_engine::doc::Rect::new(3,2,13,10),&[0.5]);doc.selection=Some(selection);Ok(())}).unwrap();std::fs::write(path,bytes(&source_document(16))).unwrap();let mut expected=twin(&engine);let params=json!({"layer":id.0,"radius":1});expected.execute(BASIC[1],params.clone()).unwrap();super::super::execute_view_command(&mut engine,BASIC[1],params).unwrap();assert_state(&engine,&expected);let k=128./255.;known_pixel(&pixel(&engine,id,8,6),[0.75+(half_light(0.75)-0.75)*k,0.5+(half_light(0.5)-0.5)*k,0.25+(half_light(0.25)-0.25)*k,0.75],16);known_pixel(&pixel(&engine,id,0,0),[0.75,0.5,0.25,0.75],16);assert!(smart(&engine.active().unwrap().doc,id).filter_mask.is_some());
    }

    #[test]
    fn linked_replay_basic_single_decision_and_non_geometry_preview_pin_stay_stable(){
        for available in [false,true]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");if !available{std::fs::remove_file(&path).unwrap();}let params=json!({"layer":id.0,"radius":1});let mut expected=twin(&engine);expected.execute(BASIC[1],params.clone()).unwrap();let reads=std::cell::Cell::new(0);run(&mut engine,BASIC[1],&params,id,|metadata,source|{reads.set(reads.get()+1);let result=super::super::smart::source_bytes_checked(metadata,source,||Ok(()))?;if available{std::fs::remove_file(&path).unwrap();}else{std::fs::write(&path,bytes(&source_document(16))).unwrap();}Ok(result)}).unwrap();assert_eq!(reads.get(),1);assert_state(&engine,&expected);assert!(matches!(&smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{path}if !path.is_empty()));}
        for available in [false,true]{let(_dir,engine,id,path)=fixture(16,"filter.cameraRaw");if !available{std::fs::remove_file(&path).unwrap();}let before=twin(&engine);let mut preview=twin(&engine);let params=json!({"layer":id.0,"radius":1});prepare_preview(&mut preview,BASIC[1],&params).unwrap();if available{std::fs::remove_file(&path).unwrap();}else{std::fs::write(&path,bytes(&source_document(16))).unwrap();}assert!(execute(&mut preview,BASIC[1],&params).is_none());super::super::execute_view_command(&mut preview,BASIC[1],params).unwrap();known_pixel(&pixel(&preview,id,8,6),[0.125,0.25,0.375,0.5],16);unchanged(&engine,&before);}
        let(_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");engine.edit("Disabled unsafe stack for numeric preview",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=false;smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();let before=twin(&engine);let mut preview=twin(&engine);let params=json!({"layer":id.0,"radius":1});prepare_preview(&mut preview,BASIC[1],&params).unwrap();assert!(matches!(smart(&preview.active().unwrap().doc,id).source,SmartSource::Embedded{..}));super::super::execute_view_command(&mut preview,BASIC[1],params).unwrap();known_pixel(&pixel(&preview,id,8,6),[0.125,0.25,0.375,0.5],16);unchanged(&engine,&before);
    }

    #[test]
    fn linked_replay_basic_actual_targets_bypass_smart_reads_for_all_coverage_and_raster_planes(){
        for command in BASIC{for route in ["alpha","quick","mask","raster"]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut params=basic_settings(command);match route{"alpha"=>{engine.execute("channel.new",json!({"name":"Basic coverage"})).unwrap();},"quick"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},"mask"=>{engine.edit("Basic layer mask",|doc,_|{doc.layer_mut(id).unwrap().mask=Some(LayerMask::hide_all());Ok(())}).unwrap();engine.execute("view.layerMask",json!({"layer":id.0,"mode":"gray"})).unwrap();},_=>{engine.edit("Basic raster target",|doc,active|{let layer=Layer::raster("Unrelated raster",doc.pixel_format());*active=Some(doc.insert_above(Some(id),layer));Ok(())}).unwrap();}}
            std::fs::OpenOptions::new().write(true).open(path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();let before=twin(&engine);assert!(ordinary_target(&engine,command,&params).unwrap().is_none());assert!(gallery_target(&engine,command,&params).unwrap().is_none());assert!(execute(&mut engine,command,&params).is_none());prepare_preview(&mut engine,command,&params).unwrap();unchanged(&engine,&before);super::super::execute_view_command(&mut engine,command,params.clone()).unwrap();assert_eq!(smart(&engine.active().unwrap().doc,id),smart(&before.active().unwrap().doc,id));assert_eq!(engine.active().unwrap().history.past_len(),before.active().unwrap().history.past_len()+1);if route=="alpha"{params["target"]=json!("pixels");let before=twin(&engine);assert_eq!(ordinary_target(&engine,command,&params).unwrap(),Some(id));assert!(execute(&mut engine,command,&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);}
        }}
    }

    #[test]
    fn linked_replay_basic_native_defaults_errors_admission_and_private_journal_are_atomic(){
        for command in BASIC{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut expected=twin(&engine);let value=expected.execute(command,Value::Null).unwrap();assert_eq!(execute(&mut engine,command,&Value::Null).unwrap().unwrap(),value);assert_state(&engine,&expected);assert!(engine.journal.last().unwrap().1.is_null());let mut params=basic_settings(command);params["layer"]=json!(id.0);params["__xdesignChannelFade"]=json!({"forged":true});let sanitized=super::super::mask_filters::clean_parameters(&params).unwrap();expected.execute(command,sanitized).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();assert_state(&engine,&expected);assert!(engine.journal.last().unwrap().1.get("__xdesignChannelFade").is_none());let before=twin(&engine);assert!(execute(&mut engine,command,&json!("not parameters")).is_none());std::fs::write(&path,b"corrupt basic input").unwrap();let mut expected=twin(&engine);assert_eq!(execute(&mut engine,command,&params).unwrap().unwrap_err(),expected.execute(command,params.clone()).unwrap_err().to_string());unchanged(&engine,&before);std::fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();assert!(execute(&mut engine,command,&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);let invalid=json!({"layer":u64::MAX});assert!(execute(&mut engine,command,&invalid).is_none());let mut expected=twin(&engine);assert_eq!(super::super::execute_view_command(&mut engine,command,invalid.clone()).unwrap_err(),expected.execute(command,invalid).unwrap_err().to_string());unchanged(&engine,&before);engine.edit("Disabled missing cache",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.cache=None;Ok(())}).unwrap();let before=twin(&engine);let mut expected=twin(&engine);let error=execute(&mut engine,command,&params).unwrap().unwrap_err();assert_eq!(error,expected.execute(command,params).unwrap_err().to_string());assert!(!error.contains("512MB"));unchanged(&engine,&before);}
        let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.edit("Enabled unsafe basic stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();std::fs::write(path,b"must reject before decoding").unwrap();let before=twin(&engine);assert!(execute(&mut engine,BASIC[1],&json!({"layer":id.0,"radius":1})).unwrap().unwrap_err().contains("does not support"));unchanged(&engine,&before);
    }

    #[test]
    fn linked_replay_basic_repeat_uses_recorded_target_and_outer_group_journal_fade_at_five_ids(){
        for command in BASIC{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut inner=basic_settings(command);inner["layer"]=json!(id.0);inner["target"]=json!("pixels");inner["coalesce"]=json!("basic-recorded");engine.execute(command,inner.clone()).unwrap();engine.edit("Unrelated active basic repeat",|doc,active|{let layer=Layer::raster("Other active",doc.pixel_format());*active=Some(doc.insert_above(Some(id),layer));Ok(())}).unwrap();let before=engine.active().unwrap().doc.clone();engine.execute("layer.smartFilter.setVisible",json!({"layer":id.0,"index":0,"visible":true,"coalesce":"basic-outer"})).unwrap();let count=engine.active().unwrap().history.past_len();let mut expected=twin(&engine);std::fs::write(path,bytes(&source_document(16))).unwrap();let outer=json!({"layer":u64::MAX,"coalesce":"basic-outer","radius":999});for _ in 0..2{let value=expected.execute("filter.lastFilter",outer.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,"filter.lastFilter",outer.clone()).unwrap(),value);assert_state(&engine,&expected);}assert_eq!(engine.active().unwrap().history.past_len(),count);assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,"Smart Filter Visibility");assert_eq!(engine.journal.last().unwrap(),&("filter.lastFilter".into(),outer));assert_eq!(engine.journal.iter().rev().find(|(id,_)|id==command).unwrap().1,inner);known_pixel(&pixel(&engine,id,8,6),[0.75,0.5,0.25,0.75],16);let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);}
    }

    #[test]
    fn linked_replay_basic_mixed_group_reopens_linked_history_color_view_and_redo(){
        let(dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);let before=engine.active().unwrap().doc.clone();let count=engine.active().unwrap().history.past_len();std::fs::write(path,bytes(&source_document(16))).unwrap();let mut expected=twin(&engine);for command in BASIC{let mut params=basic_settings(command);params["layer"]=json!(id.0);params["coalesce"]=json!("all-basic");expected.execute(command,params.clone()).unwrap();super::super::execute_view_command(&mut engine,command,params).unwrap();assert_state(&engine,&expected);}assert_eq!(engine.active().unwrap().history.past_len(),count+1);assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,"Gaussian Blur");let after=engine.active().unwrap().doc.clone();let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();super::super::publish(&dir.0,&photo,&mut session).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(session.engine.active().unwrap().doc,before);super::super::publish(&dir.0,&photo,&mut session).unwrap();super::super::save_view(&dir.0,&session).unwrap();let mut reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();let state=reopened.engine.active().unwrap();assert_eq!(state.doc,before);assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));assert!(state.history.can_redo());assert_eq!(smart(&state.doc,id).source,smart(&before,id).source);reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);
    }

    #[test]
    fn linked_replay_owner_pending_preset_store_matches_native_after_success_and_never_on_refusal(){
        use photocraft_engine::preset_store::{open,MemBackend};
        for command in ["layer.smartFilter.setParams","layer.smartFilter.setVisible",GALLERY[0],BASIC[1]]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut expected=twin(&engine);let actual_backend=MemBackend::default();let native_backend=MemBackend::default();engine.attach_preset_store(open(Box::new(actual_backend.clone())));expected.attach_preset_store(open(Box::new(native_backend.clone())));for owner in [&mut engine,&mut expected]{let mut preset=owner.tools.presets[0].clone();preset.name="Pending replay brush".into();preset.group="Pending replay group".into();preset.builtin=false;owner.tools.presets.push(preset);owner.brush_presets_changed();}let files=actual_backend.files.lock().unwrap().clone();assert_eq!(files,*native_backend.files.lock().unwrap());let before=twin(&engine);let params=json!({"layer":id.0,"params":{"exposure":-1},"visible":true,"blur":1,"radius":1});std::fs::write(&path,b"corrupt pending replay source").unwrap();assert!(execute(&mut engine,command,&params).unwrap().is_err());assert!(expected.execute(command,params.clone()).is_err());assert_state(&engine,&expected);unchanged(&engine,&before);assert_eq!(*actual_backend.files.lock().unwrap(),files);assert_eq!(*native_backend.files.lock().unwrap(),files);std::fs::write(path,bytes(&source_document(16))).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();expected.execute(command,params).unwrap();assert_state(&engine,&expected);let actual=actual_backend.files.lock().unwrap().clone();assert_ne!(actual,files);assert_eq!(actual,*native_backend.files.lock().unwrap());let reopened=open(Box::new(actual_backend));assert!(reopened.presets.iter().any(|preset|preset.name=="Pending replay brush"));assert!(reopened.warnings.is_empty());}
    }

    #[test]
    fn linked_replay_basic_selected_setparams_three_depths_keep_native_shallow_merge_and_unknowns(){
        for depth in [8,16,32]{for command in BASIC{let(_dir,mut engine,id,path)=fixture(depth,command);engine.edit("Stored basic unknown settings",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};let mut stored=basic_settings(command);stored["vendor"]=json!({"old":[1,2,3]});stored["future"]=json!({"keep":[true,{"nested":"untouched"}]});smart.smart_filters[0].params=stored;Ok(())}).unwrap();std::fs::write(path,bytes(&source_document(depth))).unwrap();let mut incoming=basic_settings(command);incoming["vendor"]=json!({"replacement":depth});let params=json!({"layer":id.0,"index":0,"params":incoming});let mut expected=twin(&engine);let value=expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",params).unwrap(),value);assert_state(&engine,&expected);let filter=&smart(&engine.active().unwrap().doc,id).smart_filters[0];assert_eq!(filter.params["vendor"],json!({"replacement":depth}));assert_eq!(filter.params["future"],json!({"keep":[true,{"nested":"untouched"}]}));assert!(filter.params["vendor"].get("old").is_none());known_pixel(&pixel(&engine,id,8,6),[0.75,0.5,0.25,0.75],depth);assert!(matches!(&smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{path}if !path.is_empty()));}}
    }

    #[test]
    fn linked_replay_basic_selected_numeric_preview_missing_refusal_and_grouped_reopen_match_native(){
        for command in BASIC{let(dir,mut engine,id,path)=fixture(16,command);engine.edit("Disabled unsafe lower numeric stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=false;smart.smart_filters.insert(0,SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();let before=twin(&engine);let mut preview=twin(&engine);let params=json!({"layer":id.0,"index":1,"params":basic_settings(command)});prepare_preview(&mut preview,"layer.smartFilter.setParams",&params).unwrap();assert!(matches!(smart(&preview.active().unwrap().doc,id).source,SmartSource::Embedded{..}));super::super::execute_view_command(&mut preview,"layer.smartFilter.setParams",params.clone()).unwrap();known_pixel(&pixel(&preview,id,8,6),[0.125,0.25,0.375,0.5],16);unchanged(&engine,&before);std::fs::remove_file(&path).unwrap();let mut expected=twin(&engine);assert_eq!(execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap_err(),expected.execute("layer.smartFilter.setParams",params.clone()).unwrap_err().to_string());assert!(prepare_preview(&mut engine,"layer.smartFilter.setParams",&params).unwrap_err().contains("unavailable"));unchanged(&engine,&before);std::fs::write(&path,bytes(&source_document(16))).unwrap();super::super::execute_view_command(&mut engine,"layer.smartFilter.delete",json!({"layer":id.0,"index":0})).unwrap();super::super::execute_view_command(&mut engine,"layer.smartFilter.disableSmartFilters",json!({"layer":id.0,"enabled":true})).unwrap();let before=engine.active().unwrap().doc.clone();let count=engine.active().unwrap().history.past_len();let mut expected=twin(&engine);for patch in [basic_settings(command),json!({"futureEdit":{"keep":[1,2]}})]{let params=json!({"layer":id.0,"index":0,"params":patch,"coalesce":"basic-selected-edit"});expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",params).unwrap();assert_state(&engine,&expected);}assert_eq!(engine.active().unwrap().history.past_len(),count+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some("Edit Smart Filter"));let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};super::super::publish(&dir.0,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);}
    }
    fn half_light(value:f32)->f32 {let linear=if value<=0.04045{value/12.92}else{((value+0.055)/1.055).powf(2.4)};let half=linear*0.5;if half<=0.0031308{half*12.92}else{1.055*half.powf(1./2.4)-0.055}}
    fn pixel(engine:&Session,id:LayerId,x:i32,y:i32)->Vec<f32>{engine.active().unwrap().doc.layer(id).unwrap().surface().unwrap().pixel(x,y)}
    fn known_pixel(actual:&[f32],expected:[f32;4],depth:u32){let tolerance=if depth==8{0.009}else{0.00015};for(actual,expected)in actual.iter().zip(expected){assert!((actual-expected).abs()<=tolerance,"{depth}: {actual} vs {expected}");}}
    fn gallery_settings(command:&str)->Value{match command{"filter.blurGallery.spinBlur"=>json!({"blurAngle":12,"centerX":0.5,"centerY":0.5}),"filter.blurGallery.pathBlur"=>json!({"speed":1,"startX":0.25,"startY":0.5,"endX":0.75,"endY":0.5}),_=>json!({"blur":1,"centerX":0.5,"centerY":0.5})}}
    fn lower_fixture(depth:u32,mask:bool)->(Temp,Session,LayerId,PathBuf){let(dir,mut engine,id,path)=fixture(depth,"filter.cameraRaw");engine.edit("Lower stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters[0].params=json!({"exposure":-1});if mask{let filter_mask=smart.filter_mask.as_mut().unwrap();filter_mask.enabled=true;filter_mask.density=1.;filter_mask.feather=0.;}else{smart.filter_mask=None;}photocraft_engine::smart_cmds::refresh(doc,id)?;Ok(())}).unwrap();(dir,engine,id,path)}

    #[test]
    fn linked_replay_lifecycle_eight_commands_three_depths_match_native_and_known_pixels(){
        for depth in [8,16,32]{for command in LIFECYCLE{let(_dir,mut engine,id,path)=lower_fixture(depth,false);engine.edit("Lifecycle setup",|doc,active|{let format=doc.pixel_format();let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.insert(0,SmartFilter{command:"filter.cameraRaw".into(),params:json!({"exposure":0}),visible:true,opacity:1.,blend:BlendMode::Normal});if command.contains("FilterMask"){smart.filter_mask=Some(LayerMask::hide_all());}let other=doc.insert_above(Some(id),Layer::raster("Unrelated",format));*active=Some(other);Ok(())}).unwrap();engine.tools.foreground=[0.2,0.3,0.4,0.5];let source=engine.active().unwrap();engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:source.doc.id,revision:source.revision,layer:id,mask:false,label:"Retained older Fade".into()});std::fs::write(&path,bytes(&source_document(depth))).unwrap();let mut params=json!({"layer":id.0,"index":1});match command{"layer.smartFilter.setVisible"=>params["visible"]=json!(false),"layer.smartFilter.blendingOptions"=>params["opacity"]=json!(0),"layer.smartFilter.move"=>params["to"]=json!(0),"layer.smartFilter.disableSmartFilters"|"layer.smartFilter.disableFilterMask"=>params["enabled"]=json!(false),_=>{}}
            let mut expected=twin(&engine);let result=expected.execute(command,params.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,command,params).unwrap(),result);assert_state(&engine,&expected);let half=matches!(command,"layer.smartFilter.move"|"layer.smartFilter.disableFilterMask"|"layer.smartFilter.deleteFilterMask");known_pixel(&pixel(&engine,id,8,6),if half{[half_light(0.75),half_light(0.5),half_light(0.25),0.75]}else{[0.75,0.5,0.25,0.75]},depth);assert!(matches!(smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{..}));
        }}
    }
    fn source_document(depth:u32)->Document{source(depth,[0.75,0.5,0.25,0.75])}

    #[test]
    fn linked_replay_lifecycle_prospective_admission_allows_removal_and_refuses_new_running_inputs(){
        for command in ["layer.smartFilter.setVisible","layer.smartFilter.delete","layer.smartFilter.clearSmartFilters","layer.smartFilter.disableSmartFilters"]{let(_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");engine.edit("Unsafe old entry",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({"path":"/must/not/open"}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();let params=json!({"layer":id.0,"index":1,"visible":false,"enabled":false});let mut expected=twin(&engine);expected.execute(command,params.clone()).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();assert_state(&engine,&expected);}
        for command in ["layer.smartFilter.setVisible","layer.smartFilter.disableSmartFilters","layer.smartFilter.blendingOptions"]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.edit("Unsafe candidate",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=command!="layer.smartFilter.disableSmartFilters";smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:command!="layer.smartFilter.setVisible",opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();std::fs::remove_file(path).unwrap();let before=twin(&engine);let error=execute(&mut engine,command,&json!({"layer":id.0,"index":1,"visible":true,"enabled":true,"opacity":0})).unwrap().unwrap_err();assert!(error.contains("does not support"));unchanged(&engine,&before);}
    }

    #[test]
    fn linked_replay_lifecycle_native_errors_noops_and_mixed_coalescing_preserve_full_state(){
        let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");std::fs::remove_file(path).unwrap();for(command,params)in [("layer.smartFilter.setVisible",json!({"index":null})),("layer.smartFilter.move",json!({"to":999})),("layer.smartFilter.blendingOptions",json!({"blend":"passThrough"})),("layer.smartFilter.blendingOptions",json!({"blend":"not-a-blend"}))]{let before=twin(&engine);let mut expected=twin(&engine);assert!(execute(&mut engine,command,&params).is_none());assert_eq!(super::super::execute_view_command(&mut engine,command,params.clone()).unwrap_err(),expected.execute(command,params).unwrap_err().to_string());unchanged(&engine,&before);unchanged(&expected,&before);}
        engine.edit("No mask or filters",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filter_mask=None;smart.smart_filters.clear();Ok(())}).unwrap();for command in LIFECYCLE{let before=twin(&engine);let mut expected=twin(&engine);let params=json!({"layer":id.0});assert!(execute(&mut engine,command,&params).is_none());assert_eq!(super::super::execute_view_command(&mut engine,command,params.clone()).unwrap_err(),expected.execute(command,params).unwrap_err().to_string());unchanged(&engine,&before);}
        let(_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let before=engine.active().unwrap().doc.clone();let count=engine.active().unwrap().history.past_len();let mut expected=twin(&engine);for(command,params)in [("layer.smartFilter.setVisible",json!({"layer":null,"visible":true,"coalesce":"mixed-lifecycle"})),("layer.smartFilter.blendingOptions",json!({"layer":"active","opacity":100,"coalesce":"mixed-lifecycle"})),("layer.smartFilter.move",json!({"layer":-1,"to":0,"coalesce":"mixed-lifecycle"}))]{expected.execute(command,params.clone()).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();assert_state(&engine,&expected);}assert_eq!(engine.active().unwrap().history.past_len(),count+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some("Smart Filter Visibility"));let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);assert!(matches!(smart(&after,id).source,SmartSource::Linked{..}));
    }

    #[test]
    fn linked_replay_gallery_five_commands_three_depths_replay_fresh_source_or_selected_cache(){
        for depth in [8,16,32]{for command in GALLERY{for available in [false,true]{let(_dir,mut engine,id,path)=lower_fixture(depth,false);engine.edit("Gallery selection",|doc,_|{let mut selection=Surface::new(photocraft_engine::doc::PixelFormat::GRAY8);selection.fill_rect(photocraft_engine::doc::Rect::new(3,2,13,10),&[0.5]);doc.selection=Some(selection);Ok(())}).unwrap();let before=engine.active().unwrap().doc.clone();if available{std::fs::write(&path,bytes(&source_document(depth))).unwrap();}else{std::fs::remove_file(path).unwrap();}let mut params=gallery_settings(command);params["layer"]=json!(id.0);let mut expected=twin(&engine);let result=expected.execute(command,params.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,command,params).unwrap(),result);assert_state(&engine,&expected);let current=engine.active().unwrap();assert_eq!(smart(&current.doc,id).source,smart(&before,id).source);assert_eq!(smart(&current.doc,id).smart_filters.len(),2);let raw=if available{let k=128./255.;[0.75+(half_light(0.75)-0.75)*k,0.5+(half_light(0.5)-0.5)*k,0.25+(half_light(0.25)-0.25)*k,0.75]}else{[half_light(0.125),half_light(0.25),half_light(0.375),0.5]};known_pixel(&pixel(&engine,id,8,6),raw,depth);if available{known_pixel(&pixel(&engine,id,0,0),[0.75,0.5,0.25,0.75],depth);assert!(smart(&current.doc,id).filter_mask.is_some());}else{assert!(smart(&current.doc,id).filter_mask.is_none());}assert!(engine.edit_state.fade.is_some());
        }}}
    }

    #[test]
    fn linked_replay_gallery_missing_unsafe_disabled_cache_and_once_decisions_match_native(){
        for disabled in [false,true]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.edit("Unexecuted old filters",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=!disabled;smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();std::fs::remove_file(&path).unwrap();let mut expected=twin(&engine);let params=json!({"layer":id.0,"blur":1});expected.execute(GALLERY[0],params.clone()).unwrap();execute(&mut engine,GALLERY[0],&params).unwrap().unwrap();assert_state(&engine,&expected);known_pixel(&pixel(&engine,id,8,6),[0.125,0.25,0.375,0.5],16);let before=twin(&engine);std::fs::write(&path,bytes(&source_document(16))).unwrap();if !disabled{assert!(execute(&mut engine,GALLERY[0],&params).unwrap().unwrap_err().contains("does not support"));unchanged(&engine,&before);}}
        for available in [false,true]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");if !available{std::fs::remove_file(&path).unwrap();}let params=json!({"layer":id.0,"blur":1});let mut expected=twin(&engine);expected.execute(GALLERY[0],params.clone()).unwrap();let reads=std::cell::Cell::new(0);run(&mut engine,GALLERY[0],&params,id,|metadata,source|{reads.set(reads.get()+1);let result=super::super::smart::source_bytes(metadata,source)?;if available{std::fs::remove_file(&path).unwrap();}else{std::fs::write(&path,bytes(&source_document(16))).unwrap();}Ok(result)}).unwrap();assert_eq!(reads.get(),1);assert_state(&engine,&expected);assert!(matches!(&smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{path:original}if !original.is_empty()));}
    }

    #[test]
    fn linked_replay_gallery_private_preview_pins_available_or_missing_once_without_publishing(){
        for available in [false,true]{let(_dir,authority,id,path)=fixture(16,"filter.cameraRaw");let mut preview=twin(&authority);if !available{std::fs::remove_file(&path).unwrap();}let before=twin(&authority);let params=json!({"layer":id.0,"blur":1});prepare_preview(&mut preview,GALLERY[0],&params).unwrap();if available{assert!(matches!(smart(&preview.active().unwrap().doc,id).source,SmartSource::Embedded{..}));std::fs::remove_file(&path).unwrap();}else{assert!(matches!(&smart(&preview.active().unwrap().doc,id).source,SmartSource::Linked{path}if path.is_empty()));std::fs::write(&path,bytes(&source_document(16))).unwrap();}assert!(execute(&mut preview,GALLERY[0],&params).is_none());super::super::execute_view_command(&mut preview,GALLERY[0],params).unwrap();known_pixel(&pixel(&preview,id,8,6),[0.125,0.25,0.375,0.5],16);unchanged(&authority,&before);assert!(matches!(&smart(&authority.active().unwrap().doc,id).source,SmartSource::Linked{path}if !path.is_empty()));}
    }

    #[test]
    fn linked_replay_gallery_coverage_and_raster_routes_never_resolve_smart_source(){
        for route in ["alpha","quick","mask","raster"]{let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let mut params=json!({"blur":1});match route{"alpha"=>{engine.execute("channel.new",json!({"name":"Coverage"})).unwrap();},"quick"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},"mask"=>{engine.edit("Layer mask",|doc,_|{doc.layer_mut(id).unwrap().mask=Some(LayerMask::hide_all());Ok(())}).unwrap();engine.execute("view.layerMask",json!({"layer":id.0,"mode":"gray"})).unwrap();},_=>{engine.edit("Raster active",|doc,active|{let raster=Layer::raster("Raster",doc.pixel_format());let layer=doc.insert_above(Some(id),raster);*active=Some(layer);Ok(())}).unwrap();}}
            std::fs::OpenOptions::new().write(true).open(path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();let before=twin(&engine);assert!(gallery_target(&engine,GALLERY[0],&params).unwrap().is_none());assert!(execute(&mut engine,GALLERY[0],&params).is_none());prepare_preview(&mut engine,GALLERY[0],&params).unwrap();unchanged(&engine,&before);super::super::execute_view_command(&mut engine,GALLERY[0],params.clone()).unwrap();assert_eq!(smart(&engine.active().unwrap().doc,id),smart(&before.active().unwrap().doc,id));assert_eq!(engine.active().unwrap().history.past_len(),before.active().unwrap().history.past_len()+1);
            if route=="alpha"{params["target"]=json!("pixels");assert_eq!(gallery_target(&engine,GALLERY[0],&params).unwrap(),Some(id));let before=twin(&engine);assert!(execute(&mut engine,GALLERY[0],&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);}
        }
    }

    #[test]
    fn linked_replay_gallery_errors_and_preview_available_stack_refuse_without_mutation(){
        let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let params=json!({"layer":id.0,"blur":1});let before=twin(&engine);std::fs::write(&path,b"not a native image").unwrap();let mut expected=twin(&engine);assert_eq!(execute(&mut engine,GALLERY[0],&params).unwrap().unwrap_err(),expected.execute(GALLERY[0],params.clone()).unwrap_err().to_string());unchanged(&engine,&before);std::fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();assert!(execute(&mut engine,GALLERY[0],&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);engine.edit("Missing cache",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.cache=None;Ok(())}).unwrap();let before=twin(&engine);let mut expected=twin(&engine);let error=execute(&mut engine,GALLERY[0],&params).unwrap().unwrap_err();assert_eq!(error,expected.execute(GALLERY[0],params.clone()).unwrap_err().to_string());assert!(!error.contains("512MB"));unchanged(&engine,&before);
        let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.edit("Disabled unsafe lower",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=false;smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:0.,blend:BlendMode::Normal});Ok(())}).unwrap();std::fs::write(&path,b"would fail decoding").unwrap();let before=twin(&engine);assert!(prepare_preview(&mut engine,GALLERY[0],&json!({"layer":id.0,"blur":1})).unwrap_err().contains("does not support"));unchanged(&engine,&before);std::fs::remove_file(&path).unwrap();prepare_preview(&mut engine,GALLERY[0],&json!({"layer":id.0,"blur":1})).unwrap();assert!(matches!(&smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{path}if path.is_empty()));
    }

    #[test]
    fn linked_replay_gallery_mixed_group_keeps_native_fade_first_label_and_project_history(){
        let(dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let before=engine.active().unwrap().doc.clone();let count=engine.active().unwrap().history.past_len();let mut expected=twin(&engine);for(command,params)in [("layer.smartFilter.setVisible",json!({"layer":id.0,"visible":true,"coalesce":"gallery-group"})),(GALLERY[0],json!({"layer":id.0,"blur":1,"coalesce":"gallery-group"})),(GALLERY[2],json!({"layer":id.0,"blurAngle":5,"coalesce":"gallery-group"}))]{expected.execute(command,params.clone()).unwrap();super::super::execute_view_command(&mut engine,command,params).unwrap();assert_state(&engine,&expected);}assert_eq!(engine.active().unwrap().history.past_len(),count+1);assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,"Smart Filter Visibility");let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};super::super::publish(&dir.0,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);
    }

    #[test]
    fn linked_replay_gallery_repeat_keeps_recorded_target_outer_coalesce_and_native_journal(){
        let(dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let inner=json!({"layer":id.0,"target":"pixels","blur":1,"coalesce":"recorded-only"});engine.execute(GALLERY[0],inner.clone()).unwrap();engine.edit("Unrelated repeat active",|doc,active|{let layer=Layer::raster("Unrelated active",doc.pixel_format());*active=Some(doc.insert_above(Some(id),layer));Ok(())}).unwrap();let before=engine.active().unwrap().doc.clone();engine.execute("layer.smartFilter.setVisible",json!({"layer":id.0,"index":0,"visible":true,"coalesce":"repeat-group"})).unwrap();let count=engine.active().unwrap().history.past_len();let mut expected=twin(&engine);std::fs::write(path,bytes(&source_document(16))).unwrap();let outer=json!({"coalesce":"repeat-group","layer":u64::MAX,"blur":99});for _ in 0..2{let result=expected.execute("filter.lastFilter",outer.clone()).unwrap();assert_eq!(super::super::execute_view_command(&mut engine,"filter.lastFilter",outer.clone()).unwrap(),result);assert_state(&engine,&expected);}assert_eq!(engine.active().unwrap().history.past_len(),count);assert_eq!(engine.edit_state.fade.as_ref().unwrap().label,"Smart Filter Visibility");assert_eq!(engine.journal.last().unwrap(),&("filter.lastFilter".into(),outer));assert_eq!(engine.journal.iter().rev().find(|(command,_)|command==GALLERY[0]).unwrap().1,inner);known_pixel(&pixel(&engine,id,8,6),[0.75,0.5,0.25,0.75],16);let after=engine.active().unwrap().doc.clone();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};super::super::publish(&dir.0,&ulid::Ulid::new().to_string(),&mut session).unwrap();let reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert!(matches!(&smart(&after,id).source,SmartSource::Linked{path}if !path.is_empty()));
    }

    #[test]
    fn linked_replay_gallery_repeat_missing_cache_fallback_and_non_ordinary_passthrough(){
        let(_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");assert!(execute(&mut engine,"filter.lastFilter",&json!({})).is_none());engine.execute(GALLERY[1],json!({"layer":id.0,"blur":1})).unwrap();engine.edit("Unsafe old stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.push(SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();std::fs::remove_file(path).unwrap();let mut expected=twin(&engine);let result=expected.execute("filter.lastFilter",json!({})).unwrap();assert_eq!(execute(&mut engine,"filter.lastFilter",&json!({})).unwrap().unwrap(),result);assert_state(&engine,&expected);assert!(matches!(&smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{path}if !path.is_empty()));engine.execute("filter.noise.median",json!({"radius":1})).unwrap();let before=twin(&engine);assert!(execute(&mut engine,"filter.lastFilter",&json!({})).is_none());unchanged(&engine,&before);
    }

    #[test]
    fn linked_replay_native_null_defaults_and_private_marker_sanitizing_keep_native_journal(){
        for command in LIFECYCLE.into_iter().filter(|command|*command!="layer.smartFilter.move").chain([GALLERY[0]]){let(_dir,mut engine,_,_)=fixture(16,"filter.cameraRaw");let mut expected=twin(&engine);let value=expected.execute(command,Value::Null).unwrap();assert_eq!(execute(&mut engine,command,&Value::Null).unwrap().unwrap(),value);assert_state(&engine,&expected);assert!(engine.journal.last().unwrap().1.is_null());assert!(execute(&mut engine,command,&json!("invalid native argument object")).is_none());}
        for command in ["layer.smartFilter.setVisible",GALLERY[0]]{let(_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let mut expected=twin(&engine);let params=json!({"layer":id.0,"blur":1,"__xdesignChannelFade":{"forged":true}});let sanitized=super::super::mask_filters::clean_parameters(&params).unwrap();expected.execute(command,sanitized).unwrap();execute(&mut engine,command,&params).unwrap().unwrap();assert_state(&engine,&expected);assert!(engine.journal.last().unwrap().1.get("__xdesignChannelFade").is_none());}
    }

    #[test]
    fn linked_replay_eight_filters_three_depths_keep_native_result_and_fresh_known_source() {
        for depth in [8,16,32]{for (index,command) in EDITABLE.iter().take(8).enumerate(){
            let (_dir,mut engine,id,path)=fixture(depth,command);engine.execute("edit.copyMerged",json!({})).unwrap();engine.tools.foreground=[0.2,0.3,0.4,0.5];engine.edit_state.fade=Some(photocraft_engine::edit_menu_cmds::FadeSource{doc:engine.active().unwrap().doc.id,revision:engine.active().unwrap().revision,layer:id,mask:false,label:"Older edit".into()});
            if index%2==1{engine.edit("Unrelated active layer",|doc,active|{let layer=Layer::raster("Untouched",doc.pixel_format());let other=doc.insert_above(Some(id),layer);*active=Some(other);Ok(())}).unwrap();}
            engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);
            let replacement=source(depth,[0.75,0.5,0.25,0.75]);std::fs::write(&path,bytes(&replacement)).unwrap();let mut expected=twin(&engine);let params=json!({"layer":id.0,"index":0,"params":{"vendor":{"stable":[1,2]}}});let prepared=super::super::preview::prepare_lens_edit(&expected,"layer.smartFilter.setParams",params.clone()).unwrap();let reference=expected.execute("layer.smartFilter.setParams",prepared).unwrap();let actual=super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",params).unwrap();assert_eq!(actual,reference);assert_state(&engine,&expected);
            let active=engine.active().unwrap();assert!(matches!(&smart(&active.doc,id).source,SmartSource::Linked{path:actual} if actual.as_str()==path.to_string_lossy().as_ref()));let px=active.doc.layer(id).unwrap().surface().unwrap().pixel(8,6);for (actual,expected) in px.iter().zip([0.75,0.5,0.25,0.75]){assert!((actual-expected).abs()<0.006,"{command}/{depth}: {px:?}");}assert_eq!(engine.journal.last().unwrap().0,"layer.smartFilter.setParams");
        }}
    }

    #[test]
    fn linked_replay_coalesced_undo_redo_and_native_bundle_never_embed_the_pin() {
        let (_dir,mut engine,id,_path)=fixture(16,"filter.cameraRaw");let before=engine.active().unwrap().doc.clone();let count=engine.active().unwrap().history.past_len();let journal=engine.journal.len();let mut expected=twin(&engine);
        for exposure in [-1.,-2.]{let params=json!({"layer":id.0,"params":{"exposure":exposure,"unknown":{"keep":1}},"coalesce":"raw-gesture"});expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap();assert_state(&engine,&expected);}
        assert_eq!(engine.active().unwrap().history.past_len(),count+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some("Edit Smart Filter"));assert_eq!(engine.journal[journal..],expected.journal[journal..]);let after=engine.active().unwrap().doc.clone();let state=engine.active().unwrap();let prior=state.history.state(state.history.past_len()-1).unwrap();assert!(Arc::ptr_eq(&prior,&before));assert!(matches!(smart(&prior,id).source,SmartSource::Linked{..}));
        engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);let saved=photocraft_format::save_to_bytes(&after,&Default::default()).unwrap();let reopened=photocraft_format::load_from_bytes(&saved).unwrap();assert_eq!(smart(&reopened,reopened.layers[0].id).source,smart(&after,id).source);assert_eq!(smart(&reopened,reopened.layers[0].id).smart_filters,smart(&after,id).smart_filters);assert_eq!(photocraft_compose::flatten(&reopened).px,photocraft_compose::flatten(&after).px);
    }

    #[test]
    fn linked_replay_host_project_reopens_linked_history_and_color_view_with_redo() {
        let (dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let before=engine.active().unwrap().doc.clone();let labels=engine.active().unwrap().history.entries();
        engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(1);
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",json!({"layer":id.0,"params":{"exposure":-1},"coalesce":"saved-raw"})).unwrap();let after=engine.active().unwrap().doc.clone();
        let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let photo=ulid::Ulid::new().to_string();super::super::publish(&dir.0,&photo,&mut session).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();super::super::publish(&dir.0,&photo,&mut session).unwrap();super::super::save_view(&dir.0,&session).unwrap();
        let mut reopened=super::super::restore_with_settings(&dir.0,&session.version,None,false).unwrap();let state=reopened.engine.active().unwrap();assert_eq!(state.doc,before);assert_eq!(state.history.entries(),labels);assert_eq!(state.channel_view.target,photocraft_engine::channel_cmds::ChannelTarget::Color(1));assert!(state.history.can_redo());assert_eq!(smart(&state.doc,id).source,smart(&before,id).source);reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);assert_eq!(smart(&reopened.engine.active().unwrap().doc,id).source,smart(&before,id).source);
    }

    #[test]
    fn linked_replay_limits_missing_corrupt_and_unsupported_stacks_refuse_atomically() {
        let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let params=json!({"layer":id.0,"index":0,"params":{"exposure":-1}});let before=twin(&engine);std::fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();assert!(execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap_err().contains("512MB"));unchanged(&engine,&before);std::fs::write(&path,b"not an image").unwrap();assert!(execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().is_err());unchanged(&engine,&before);std::fs::remove_file(&path).unwrap();assert!(placed_source(&engine.active().unwrap().doc,smart(&engine.active().unwrap().doc,id)).unwrap().is_none());assert!(execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap_err().contains("unavailable"));unchanged(&engine,&before);
        for command in ["filter.distort.displace","plugin.run","filter.unrecognized"]{engine.edit("Unsupported running stack",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.smart_filters.truncate(1);smart.smart_filters.push(SmartFilter{command:command.into(),params:json!({"mapPath":path}),visible:true,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();let before=twin(&engine);assert!(execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap_err().contains("does not support"));assert!(placed_source(&engine.active().unwrap().doc,smart(&engine.active().unwrap().doc,id)).unwrap_err().contains("does not support"));unchanged(&engine,&before);}
    }

    #[test]
    fn linked_replay_unexecuted_filters_and_embedded_authority_keep_native_semantics() {
        for globally_disabled in [false,true]{let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.edit("Unexecuted external filter",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.filters_enabled=!globally_disabled;smart.smart_filters.push(SmartFilter{command:"filter.distort.displace".into(),params:json!({"mapPath":"/must/not/read"}),visible:globally_disabled,opacity:1.,blend:BlendMode::Normal});Ok(())}).unwrap();let mut expected=twin(&engine);let params=json!({"layer":id.0,"index":0,"params":{"exposure":-1}});expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap();assert_state(&engine,&expected);assert!(path.exists());}
        let (_dir,mut engine,id,path)=fixture(8,"filter.cameraRaw");let data=Arc::new(std::fs::read(&path).unwrap());engine.edit("Embedded authority",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};smart.source=SmartSource::Embedded{file_name:"source.pcraft".into(),bytes:data.clone()};Ok(())}).unwrap();std::fs::remove_file(path).unwrap();let before=twin(&engine);assert!(execute(&mut engine,"layer.smartFilter.setParams",&json!({"layer":id.0,"params":{"exposure":-1}})).is_none());unchanged(&engine,&before);assert!(placed_source(&engine.active().unwrap().doc,smart(&engine.active().unwrap().doc,id)).unwrap().is_some());let SmartSource::Embedded{bytes:retained,..}=&smart(&engine.active().unwrap().doc,id).source else{unreachable!()};assert!(Arc::ptr_eq(&data,retained));
    }

    #[test]
    fn linked_replay_metadata_linked_source_wins_and_pin_survives_disk_replacement() {
        let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let replacement=source(16,[0.75,0.5,0.25,0.75]);let data=bytes(&replacement);let path_key=path.to_string_lossy().into_owned();engine.edit("Embedded PSD linked record",|doc,_|{let block=photocraft_io::linked::encode_linked_file(&photocraft_io::linked::LinkedFile{uuid:path_key.clone(),file_name:"linked-source.pcraft".into(),bytes:data.clone()});doc.metadata.psd_global_blocks.push((*b"8BIM",*b"lnk2",Arc::new(block)));Ok(())}).unwrap();std::fs::remove_file(&path).unwrap();let mut expected=twin(&engine);let params=json!({"layer":id.0,"params":{"exposure":0}});expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap();assert_state(&engine,&expected);assert!(matches!(smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{..}));
        let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");let before=smart(&engine.active().unwrap().doc,id).source.clone();let params=json!({"layer":id.0,"params":{"exposure":0}});run(&mut engine,"layer.smartFilter.setParams",&params,id,|meta,source|{let pinned=super::super::smart::source_bytes(meta,source)?;std::fs::remove_file(&path).unwrap();Ok(pinned)}).unwrap();assert_eq!(smart(&engine.active().unwrap().doc,id).source,before);assert!(!path.exists());
    }

    #[test]
    fn linked_replay_native_layer_defaults_errors_and_noop_history_match() {
        for supplied in [Value::Null,json!("active"),json!(-1)]{let (_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let mut expected=twin(&engine);let params=json!({"layer":supplied,"params":{}});expected.execute("layer.smartFilter.setParams",params.clone()).unwrap();execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap();assert_state(&engine,&expected);assert_eq!(smart(&engine.active().unwrap().doc,id).smart_filters[0].params,neutral("filter.cameraRaw"));}
        let (_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let mut expected=twin(&engine);let params=json!({"layer":id.0,"params":{"exposure":-1},"__xdesignChannelFade":{"forged":true}});let sanitized=super::super::mask_filters::clean_parameters(&params).unwrap();expected.execute("layer.smartFilter.setParams",sanitized).unwrap();execute(&mut engine,"layer.smartFilter.setParams",&params).unwrap().unwrap();assert_state(&engine,&expected);assert!(engine.journal.last().unwrap().1.get("__xdesignChannelFade").is_none());
        let (_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");for params in [json!({"layer":u64::MAX,"params":{}}),json!({"layer":id.0,"index":null,"params":{}}),json!({"layer":id.0}),json!({"layer":id.0,"index":999,"params":{}})]{let before=twin(&engine);assert!(execute(&mut engine,"layer.smartFilter.setParams",&params).is_none());let mut expected=twin(&engine);let prepared=super::super::preview::prepare_lens_edit(&expected,"layer.smartFilter.setParams",params.clone()).and_then(|params|{super::super::preview::validate_filter_input("layer.smartFilter.setParams",&params)?;super::super::preview::validate_lens_input(&expected,"layer.smartFilter.setParams",&params)?;Ok(params)});let error=prepared.and_then(|params|expected.execute("layer.smartFilter.setParams",params).map_err(|error|error.to_string())).unwrap_err();assert_eq!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",params).unwrap_err(),error);unchanged(&engine,&before);unchanged(&expected,&before);}
    }

    #[test]
    fn linked_replay_small_limit_and_growing_reader_stop_before_commit() {
        struct Growing{consumed:usize,interrupted:bool,max_request:usize}
        impl Read for Growing{fn read(&mut self,out:&mut[u8])->std::io::Result<usize>{self.max_request=self.max_request.max(out.len());if !self.interrupted{self.interrupted=true;return Err(ErrorKind::Interrupted.into());}let count=out.len().min(37);out[..count].fill(7);self.consumed+=count;Ok(count)}}
        let (_dir,mut engine,id,_)=fixture(16,"filter.cameraRaw");let before=twin(&engine);let mut stream=Growing{consumed:0,interrupted:false,max_request:0};let result=run(&mut engine,"layer.smartFilter.setParams",&json!({"params":{"exposure":-1}}),id,|_,_|{let bytes=super::super::smart::replay_read_with_limit(&mut stream,129)?;Ok(Some(("growing.pcraft".into(),Arc::new(bytes))))});assert!(result.unwrap_err().contains("512MB"));assert_eq!(stream.consumed,130);assert!(stream.max_request<=130);unchanged(&engine,&before);let result=run(&mut engine,"layer.smartFilter.setParams",&json!({"params":{}}),id,|meta,source|super::super::smart::source_bytes_with_limit(meta,source,1));assert!(result.unwrap_err().contains("512MB"));unchanged(&engine,&before);
    }

    #[test]
    fn linked_replay_private_preview_reads_once_for_input_and_output_without_publishing_pin() {
        for command in ["filter.cameraRaw","filter.blurGallery.fieldBlur"]{
            let (_dir,engine,id,path)=fixture(16,command);let authority=twin(&engine);let mut preview=twin(&engine);preview.active_mut().unwrap().history=Default::default();let journal=preview.journal.clone();let params=json!({"layer":id.0,"index":0,"params":{"vendor":"preview"}});let reads=std::cell::Cell::new(0);
            pin_preview(&mut preview,"layer.smartFilter.setParams",&params,|meta,source|{reads.set(reads.get()+1);let source=super::super::smart::source_bytes(meta,source)?;std::fs::remove_file(&path).unwrap();Ok(source)}).unwrap();assert_eq!(reads.get(),1);assert!(!preview.active().unwrap().history.can_undo());assert_eq!(preview.journal,journal);
            let state=preview.active().unwrap();let placed=placed_source(&state.doc,smart(&state.doc,id)).unwrap().unwrap();let expected=placed.pixel(8,6);super::super::execute_view_command(&mut preview,"layer.smartFilter.setParams",params).unwrap();assert_eq!(reads.get(),1);let actual=preview.active().unwrap().doc.layer(id).unwrap().surface().unwrap().pixel(8,6);assert_eq!(actual,expected);for (actual,expected)in actual.iter().zip([0.125,0.25,0.375,0.5]){assert!((actual-expected).abs()<0.001);}assert!(matches!(smart(&preview.active().unwrap().doc,id).source,SmartSource::Embedded{..}));unchanged(&engine,&authority);assert!(matches!(smart(&engine.active().unwrap().doc,id).source,SmartSource::Linked{..}));
        }
    }

    #[test]
    fn linked_replay_preview_checks_actual_upper_and_forced_lower_before_reading() {
        for lower in [false,true]{let (_dir,mut engine,id,_)=fixture(16,"filter.blurGallery.fieldBlur");engine.edit("External filter",|doc,_|{let LayerContent::Smart(smart)=&mut doc.layer_mut(id).unwrap().content else{unreachable!()};let external=SmartFilter{command:"plugin.run".into(),params:json!({}),visible:true,opacity:1.,blend:BlendMode::Normal};if lower{smart.smart_filters.insert(0,external);smart.filters_enabled=false;}else{smart.smart_filters.push(external);}Ok(())}).unwrap();let before=twin(&engine);let params=json!({"layer":id.0,"index":if lower{1}else{0},"params":{}});let result=pin_preview(&mut engine,"layer.smartFilter.setParams",&params,|_,_|panic!("unsupported stack must refuse before source I/O"));assert!(result.unwrap_err().contains("does not support"));unchanged(&engine,&before);}
    }

    #[test]
    #[cfg(not(target_arch="wasm32"))]
    fn linked_replay_active_job_refuses_before_source_or_history_changes() {
        use std::sync::atomic::{AtomicBool,Ordering};
        let (_dir,mut engine,id,path)=fixture(16,"filter.cameraRaw");engine.execute(GALLERY[0],json!({"layer":id.0,"blur":1})).unwrap();std::fs::remove_file(path).unwrap();let release=Arc::new(AtomicBool::new(false));let worker=release.clone();let started=engine.start_job("linked-test",json!({}),"Retained active job",true,move|context|{while !worker.load(Ordering::Relaxed){context.check()?;std::thread::yield_now();}Ok(())},|_,_|Ok(Value::Null)).unwrap();let photocraft_engine::jobs::Started::Job(job)=started else{panic!("expected native worker")};let before=twin(&engine);let errors:Vec<_>=LIFECYCLE.iter().chain(GALLERY.iter()).chain(BASIC.iter()).chain(SHARPEN.iter()).chain([&"layer.smartFilter.setParams",&"filter.lastFilter"]).map(|command|execute(&mut engine,command,&json!({"layer":id.0,"index":0,"to":0,"params":{}}))).collect();release.store(true,Ordering::Relaxed);for error in errors{let error=error.unwrap().unwrap_err();assert!(error.contains("Retained active job")&&error.contains("still running"));}unchanged(&engine,&before);engine.wait_job(job).unwrap();
    }
}
