use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use base64::Engine;
use photocraft_engine::{inspect, Session};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const MAX_INPUT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PIXELS: u64 = 268_435_456;

#[path = "xdesign_photo_preview_memory.rs"]
mod memory;
#[path = "xdesign_photo_input.rs"]
mod input;
#[path = "xdesign_photo_place.rs"]
mod place;
#[path = "xdesign_photo_image_size.rs"]
mod image_size;
#[path = "xdesign_photo_exports.rs"]
mod exports;
#[path = "xdesign_photo_pdf.rs"]
mod pdf;
#[path = "xdesign_photo_documents.rs"]
mod documents;

#[cfg(test)]
#[path = "xdesign_photo_fidelity.rs"]
mod fidelity;

#[cfg(test)]
#[path = "xdesign_photo_raw_fixture.rs"]
mod raw_fixture;

#[path = "xdesign_photo_adjust.rs"]
mod adjust;
#[path = "xdesign_photo_mask_filters.rs"]
mod mask_filters;
#[path = "xdesign_photo_channels.rs"]
mod channels;
#[path = "xdesign_photo_channel_bands.rs"]
mod channel_bands;
#[path = "xdesign_photo_channel_workspace.rs"]
mod channel_workspace;
#[path = "xdesign_photo_display.rs"]
mod display;
#[path = "xdesign_photo_storage.rs"]
mod storage;
#[path = "xdesign_photo_bundle.rs"]
pub(crate) mod bundle;
#[path = "xdesign_photo_cache.rs"]
mod cache;

#[path = "xdesign_photo_content.rs"]
mod content;
#[path = "xdesign_photo_preview.rs"]
mod preview;
#[path = "xdesign_photo_repeat.rs"]
mod repeat;
#[path = "xdesign_photo_snapshot.rs"]
mod snapshot;
#[path = "xdesign_photo_preview_requests.rs"]
mod preview_requests;
#[path = "xdesign_photo_selection_preview.rs"]
mod selection_preview;
#[path = "xdesign_photo_profiles.rs"]
mod profiles;
#[path = "xdesign_photo_color_conversion.rs"]
mod color_conversion;
#[path = "xdesign_photo_straighten.rs"]
mod straighten;
#[path = "xdesign_photo_perspective_crop.rs"]
mod perspective_crop;
#[path = "xdesign_photo_fill_modes.rs"]
mod fill_modes;
#[path = "xdesign_photo_red_eye.rs"]
mod red_eye;
#[path = "xdesign_photo_pattern_stamp.rs"]
mod pattern_stamp;
#[path = "xdesign_photo_layer_colors.rs"]
mod layer_colors;
#[path = "xdesign_photo_layer_code.rs"]
mod layer_code;
#[path = "xdesign_photo_selection_brush.rs"]
mod selection_brush;
#[path = "xdesign_photo_magnetic.rs"]
mod magnetic;
#[path = "xdesign_photo_color_views.rs"]
mod color_views;
#[path = "xdesign_photo_color_settings.rs"]
mod color_settings;
#[path = "xdesign_photo_color_import.rs"]
mod color_import;
#[path = "xdesign_photo_clipboard.rs"]
mod clipboard;
#[path = "xdesign_photo_preset_preview.rs"]
mod preset_preview;
#[path = "xdesign_photo_smart.rs"]
mod smart;
#[path = "xdesign_photo_linked_replay.rs"]
mod linked_replay;
#[path = "xdesign_photo_stroke.rs"]
mod stroke;
#[path = "xdesign_photo_history.rs"]
mod history;
#[path = "xdesign_photo_history_snapshots.rs"]
mod snapshots;
#[path = "xdesign_photo_prepared.rs"]
mod prepared;
#[path = "xdesign_photo_styles.rs"]
mod styles;
#[path = "xdesign_photo_layers.rs"]
mod layers;
#[path = "xdesign_photo_tiles.rs"]
mod tiles;
#[path = "xdesign_photo_tools.rs"]
mod tools;
#[path = "xdesign_photo_view.rs"]
mod view;

struct PhotoSession {
    engine: Session,
    color_settings: Option<std::sync::Arc<color_settings::Context>>,
    version: String,
    original_path: Option<String>,
    writer: bundle::IncrementalWriter,
}

fn sessions() -> &'static Mutex<cache::PhotoCache> {
    static SESSIONS: OnceLock<Mutex<cache::PhotoCache>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(cache::PhotoCache::default()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoDocument {
    id: String,
    version: String,
    name: String,
    width: u32,
    height: u32,
    preview_width: u32,
    preview_height: u32,
    bundle_path: String,
    preview_path: String,
    original_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoReply {
    document: PhotoDocument,
    state: Value,
    warnings: Vec<String>,
    result: Option<Value>,
}

fn id(value: &str) -> Result<(), String> {
    ulid::Ulid::from_string(value)
        .map(|_| ())
        .map_err(|_| "Invalid photo document identity".into())
}

#[derive(Clone,Copy,Debug,PartialEq)]
struct RawDevelopSettings{exposure:f64,orient:bool}

fn raw_develop_settings(value:Option<Value>)->Result<Option<RawDevelopSettings>,String>{
    let Some(value)=value else{return Ok(None)};
    let object=value.as_object().ok_or("Invalid RAW development options")?;
    if object.keys().any(|key|!matches!(key.as_str(),"exposure"|"orient")){return Err("Invalid RAW development options".into());}
    let exposure=object.get("exposure").and_then(Value::as_f64).ok_or("RAW exposure must be a number")?;
    let orient=object.get("orient").and_then(Value::as_bool).ok_or("RAW orientation must be a boolean")?;
    if !exposure.is_finite()||!(-5.0..=5.0).contains(&exposure){return Err("RAW exposure must be between -5 and 5 EV".into());}
    Ok(Some(RawDevelopSettings{exposure,orient}))
}

fn import_raw_with_settings(name:&str,bytes:&[u8],settings:RawDevelopSettings)->Result<photocraft_io::ImportResult,String>{
    fn defaults<T:Default,R>(_:fn(&str,&[u8],&T)->R)->T{T::default()}
    let mut options=defaults(photocraft_io::raw::import_raw_with);
    options.exposure=settings.exposure;
    options.orient=settings.orient;
    // Match the limits copied by the pinned IO wrapper before RAW decoding.
    let limits=photocraft_codecs::Limits::default();
    options.limits.max_width=limits.max_width;
    options.limits.max_height=limits.max_height;
    options.limits.max_pixels=limits.max_pixels;
    options.limits.max_alloc=limits.max_alloc;
    photocraft_io::raw::import_raw_with(name,bytes,&options).map_err(|error|error.to_string())
}

fn import_image_path(path:&Path,raw_settings:Option<RawDevelopSettings>)->Result<photocraft_io::ImportResult,String>{
    let meta=std::fs::metadata(path).map_err(|e|e.to_string())?;
    if raw_settings.is_some()&&meta.is_dir(){return Err("RAW development options require a camera RAW file".into());}
    if meta.is_dir()&&path.extension().is_some_and(|extension|extension=="pcraft"){
        let mut total=0u64;for file in bundle::entries(path)?{total=total.checked_add(std::fs::symlink_metadata(file).map_err(|e|e.to_string())?.len()).filter(|total|*total<=MAX_INPUT_BYTES).ok_or("Image import exceeds 512MB")?;}
        let document=photocraft_format::load_path_with(path,&photocraft_format::LoadOptions{max_total_bytes:2*1024*1024*1024,max_blob_bytes:512*1024*1024,max_manifest_bytes:32*1024*1024,preserve_ids:true}).map_err(|e|e.to_string())?;
        Ok(photocraft_io::ImportResult{document,warnings:Vec::new()})
    }else{
        if !meta.is_file()||meta.len()>MAX_INPUT_BYTES{return Err("Image import exceeds 512MB".into());}
        let bytes=input::read_file(path)?;
        let name=path.file_name().and_then(|v|v.to_str()).unwrap_or("Image");
        if let Some(settings)=raw_settings{
            if !photocraft_io::raw::is_raw(&bytes){return Err("RAW development options require a recognized camera RAW file".into());}
            let mut imported=import_raw_with_settings(name,&bytes,settings)?;
            let fallback=imported.warnings.iter().any(|warning|warning.contains("opened the camera's embedded")&&warning.contains("not the raw sensor data"));
            if fallback&&(settings.exposure!=0.0||!settings.orient){return Err("This RAW file only provides an embedded JPEG preview; exposure and orientation choices require sensor data.".into());}
            if !fallback&&(settings.exposure!=0.0||!settings.orient){
                for warning in &mut imported.warnings{*warning=warning.replace("developed with default settings",&format!("developed with {:+} EV exposure and {} camera orientation",settings.exposure,if settings.orient{"applied"}else{"skipped"}));}
            }
            Ok(imported)
        }else{smart::import(name,&bytes)}
    }
}

fn root(app: &AppHandle, project: &str, photo: &str) -> Result<PathBuf, String> {
    id(project)?;
    id(photo)?;
    let root=app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets")
        .join("xdesign");
    storage::access(&root)?;
    let dir=root.join(project).join(photo);storage::recover_photo(&dir)?;Ok(dir)
}

fn key(project: &str, photo: &str) -> String {
    format!("{project}/{photo}")
}

fn check_size(session: &Session) -> Result<(), String> {
    let doc = &session.active().ok_or("No image document")?.doc;
    if doc.size.width == 0
        || doc.size.height == 0
        || u64::from(doc.size.width) * u64::from(doc.size.height) > MAX_PIXELS
    {
        return Err("The image document exceeds the 256 megapixel editing limit".into());
    }
    Ok(())
}

fn preview_size(width: u32, height: u32) -> (u32, u32) {
    let scale = (2048.0 / f64::from(width.max(height))).min(1.0);
    (
        (f64::from(width) * scale).round().max(1.0) as u32,
        (f64::from(height) * scale).round().max(1.0) as u32,
    )
}

fn descriptor(dir: &Path, photo: &str, session: &PhotoSession) -> Result<PhotoDocument, String> {
    let doc = &session.engine.active().ok_or("No image document")?.doc;
    let (preview_width, preview_height) = preview_size(doc.size.width, doc.size.height);
    Ok(PhotoDocument {
        id: photo.into(),
        version: session.version.clone(),
        name: doc.name.clone(),
        width: doc.size.width,
        height: doc.size.height,
        preview_width,
        preview_height,
        bundle_path: dir
            .join(format!("{}.pcraft", session.version))
            .to_string_lossy()
            .into_owned(),
        preview_path: dir
            .join(format!("{}.png", session.version))
            .to_string_lossy()
            .into_owned(),
        original_path: session.original_path.clone(),
    })
}

// Immutable versions are published before the project references them. A failed project save
// can retry the same version; a failed image save never advances the live document pointer.
fn publish(dir: &Path, photo: &str, session: &mut PhotoSession) -> Result<PhotoDocument, String> {
    check_size(&session.engine)?;
    let doc = &session.engine.active().ok_or("No image document")?.doc;
    let (preview_width,preview_height)=preview_size(doc.size.width,doc.size.height);
    let preview=display::rgba(doc,&photocraft_compose::render_reduced(doc,preview_width,preview_height))?;
    let image = photocraft_codecs::Image::from_u8(
        preview.width,
        preview.height,
        photocraft_codecs::ChannelLayout::Rgba,
        preview.pixels,
    )
    .map_err(|e| e.to_string())?;
    let png =
        photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &photocraft_codecs::EncodeOptions { png_compression: photocraft_codecs::PngCompression::Fast, ..Default::default() })
            .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let version = ulid::Ulid::new().to_string();
    bundle::write_document(dir, &version, doc, &mut session.writer)?;
    storage::write_preview(dir,&version,&png)?;
    let state=session.engine.active().ok_or("No image document")?;
    let mut view = inspect::document(state);
    history::persisted::save(dir,&version,state,&mut view)?;
    color_views::persist(&session.engine,&mut view)?;
    photocraft_format::atomic_write(
        &dir.join(format!("{version}.view.json")),
        &view_bytes(&view)?,
    )
    .map_err(|e| e.to_string())?;
    session.version = version;
    descriptor(dir, photo, session)
}

fn restore(dir: &Path, version: &str, original: Option<String>) -> Result<PhotoSession, String> {
    restore_with_settings(dir,version,original,true)
}
fn restore_with_settings(dir:&Path,version:&str,original:Option<String>,load_settings:bool)->Result<PhotoSession,String>{
    restore_with_policy(dir,version,original,load_settings,snapshot::HistoryPolicy::Keep)
}
fn restore_with_policy(dir:&Path,version:&str,original:Option<String>,load_settings:bool,policy:snapshot::HistoryPolicy)->Result<PhotoSession,String>{
    id(version)?;
    let doc = photocraft_format::load_path_with(
        &dir.join(format!("{version}.pcraft")),
        &photocraft_format::LoadOptions {
            max_total_bytes: 2 * 1024 * 1024 * 1024,
            max_blob_bytes: 512 * 1024 * 1024,
            max_manifest_bytes: 32 * 1024 * 1024,
            preserve_ids: true,
        },
    )
    .map_err(|e| e.to_string())?;
    let mut engine = Session::new();
    let color_settings=if load_settings{color_settings::image_settings_dir(dir).map(|dir|color_settings::load(&dir)).transpose()?}else{None};
    if let Some(context)=&color_settings{context.install(&mut engine);}
    engine.add_document(doc, None);
    let view_path = dir.join(format!("{version}.view.json"));
    if view_path.is_file() {
        let view = history::persisted::read_view(&view_path)?;
        layers::restore_folds(engine.active_mut().ok_or("No image document")?, &view);
        let active = view
            .get("activeLayer")
            .and_then(Value::as_u64)
            .map(photocraft_engine::doc::LayerId);
        let selected = view
            .get("selectedLayers")
            .and_then(Value::as_array)
            .map(|layers| {
                layers
                    .iter()
                    .filter_map(Value::as_u64)
                    .map(photocraft_engine::doc::LayerId)
                    .collect()
            })
            .unwrap_or_else(|| active.into_iter().collect());
        photocraft_engine::layer_multi_cmds::set_selection(&mut engine, selected, active, active)
            .map_err(|e| e.to_string())?;
        restore_channel_view(&mut engine, &view)?;
        color_views::restore(&mut engine,&view)?;
        let state=engine.active_mut().ok_or("No image document")?;
        match policy {
            snapshot::HistoryPolicy::Keep=>history::persisted::restore(dir,version,state,&view)?,
            snapshot::HistoryPolicy::Discard=>history::persisted::restore_current(version,state,&view)?,
        }
    }
    check_size(&engine)?;
    Ok(PhotoSession {
        engine,color_settings,
        version: version.into(),
        original_path: original,
        writer: Default::default(),
    })
}

fn restore_channel_view(engine: &mut Session, saved: &Value) -> Result<(), String> {
    use photocraft_engine::{
        channel_cmds::{ChannelTarget, ChannelView},
        mask_view_cmds::{LayerMaskView, MaskViewMode},
    };
    let state = engine.active_mut().ok_or("No image document")?;
    let mut view = ChannelView::default();
    let channels = &saved["channels"];
    if let Some(colors) = channels["colors"].as_array() {
        for (i, color) in colors
            .iter()
            .take(photocraft_engine::channel_cmds::color_count(&state.doc))
            .enumerate()
        {
            view.set_color_visible(i, color["visible"].as_bool().unwrap_or(true));
        }
    }
    if let Some(alpha) = channels["alpha"].as_array() {
        for channel in alpha {
            if let Some(i) = channel["index"]
                .as_u64()
                .and_then(|i| usize::try_from(i).ok())
                .filter(|i| *i < state.doc.channels.len())
            {
                view.set_alpha_visible(i, channel["visible"].as_bool().unwrap_or(false));
            }
        }
    }
    view.quick_mask_hidden = channels["quickMask"]["visible"].as_bool() == Some(false);
    let index = channels["target"]["index"]
        .as_u64()
        .and_then(|i| usize::try_from(i).ok());
    view.target = match (channels["target"]["kind"].as_str(), index) {
        (Some("alpha"), Some(i)) if i < state.doc.channels.len() => ChannelTarget::Alpha(i),
        (Some("color"), Some(i))
            if i < photocraft_engine::channel_cmds::color_count(&state.doc) =>
        {
            ChannelTarget::Color(i)
        }
        _ => ChannelTarget::Composite,
    };
    let mask = &saved["layerMaskView"];
    if let Some(layer) = mask["layer"].as_u64().map(photocraft_engine::doc::LayerId) {
        if state.active_layer == Some(layer)
            && state.doc.layer(layer).is_some_and(|l| l.mask.is_some())
        {
            let mode = match mask["mode"].as_str() {
                Some("gray") => Some(MaskViewMode::Gray),
                Some("overlay") => Some(MaskViewMode::Overlay),
                _ => None,
            };
            view.layer_mask = mode.map(|mode| LayerMaskView { layer, mode });
        }
    }
    state.channel_view = view;
    Ok(())
}

fn channel_view_key(view: &photocraft_engine::channel_cmds::ChannelView) -> Result<String, String> {
    let mut view=view.clone();
    while view.color_hidden.last()==Some(&false){view.color_hidden.pop();}
    while view.alpha_visible.last()==Some(&false){view.alpha_visible.pop();}
    serde_json::to_string(&view).map_err(|e| e.to_string())
}

fn view_bytes(view:&Value)->Result<Vec<u8>,String>{let bytes=serde_json::to_vec(view).map_err(|e|e.to_string())?;if bytes.len()>32*1024*1024{return Err("Saved image view exceeds 32MB".into());}Ok(bytes)}

fn save_view(dir: &Path, session: &PhotoSession) -> Result<(), String> {
    let state=session.engine.active().ok_or("No image document")?;
    let mut view = inspect::document(state);
    history::persisted::save(dir,&session.version,state,&mut view)?;
    color_views::persist(&session.engine,&mut view)?;
    photocraft_format::atomic_write(
        &dir.join(format!("{}.view.json", session.version)),
        &view_bytes(&view)?,
    )
    .map_err(|e| e.to_string())
}

fn persist_command(dir: &Path, photo: &str, session: &mut PhotoSession, before: &photocraft_engine::DocState, command: &str) -> Result<(), String> {
    // Decided before the reveal, so a selection that opens its layer's groups still only saves the view.
    let changed = !layers::FOLDS.contains(&command) && !std::sync::Arc::ptr_eq(&before.doc, &session.engine.active().ok_or("No image document")?.doc);
    if layers::HISTORY_STEPS.contains(&command) { layers::keep_folds(session.engine.active_mut().ok_or("No image document")?, &before.doc); }
    layers::reveal_active(&mut session.engine, before.active_layer)?;
    if changed { publish(dir, photo, session)?; } else { save_command_view(dir, session, command)?; }
    Ok(())
}

fn save_command_view(dir: &Path, session: &PhotoSession, command: &str) -> Result<(), String> {
    // These tools have their own profile store; history I/O can fail after the profile change was saved.
    if ["tools.setColors", "tools.swapColors", "tools.defaultColors", "tool.presets.select", "edit.profileInfo"].contains(&command) { return Ok(()); }
    save_view(dir, session)
}

pub(crate) fn saved_history_references(view:&Value,version:&str)->Result<Vec<String>,String>{history::persisted::references(view,version)}
pub(crate) fn validate_saved_history(dir:&Path,version:&str)->Result<(),String>{restore_with_settings(dir,version,None,false).map(|_|())}
pub(crate) fn room_transfer_access(root:&Path)->Result<(),String>{storage::access(root)}

/// The Ruler line, count markers, notes and slices the canvas draws; undo and history change them like any edit.
fn analysis_state(engine: &Session) -> Value {
    let Some(doc) = engine.active().map(|state| &state.doc) else { return Value::Null };
    let m = &doc.measurement;
    json!({
        "ruler": m.ruler.map(|r| json!({"start": r.start, "end": r.end, "protractor": r.protractor, "info": photocraft_engine::analysis_cmds::ruler_info(&r, &m.scale)})),
        "count": {"total": m.count_total(), "activeGroup": m.active_count_group, "groups": m.count_groups.iter().map(|g| json!({"name": g.name, "color": g.color.to_rgb(), "markerSize": g.marker_size, "labelSize": g.label_size, "visible": g.visible, "points": g.points})).collect::<Vec<_>>()},
        "notes": doc.notes.iter().enumerate().map(|(i, n)| photocraft_engine::notes_cmds::note_json(i, n)).collect::<Vec<_>>(),
        "slices": photocraft_engine::doc::slices::resolve(doc).iter().map(|r| photocraft_engine::slice_cmds::resolved_json(doc, r)).collect::<Vec<_>>(),
        "slicesLocked": engine.file_menu.slices_locked,
    })
}

/// photocraft_text's default family, which the engine resolves type styles against.
const STYLE_FAMILY: &str = "Inter";

/// The Layer Comps, Measurement Log and Character / Paragraph Styles panels, as the engine's `list` commands report them.
fn panels_state(engine: &Session) -> Value {
    use photocraft_engine::analysis_cmds::{available, log_columns, COLUMNS};
    use photocraft_engine::doc::{text_styles::NO_CHARACTER_STYLE, LayerContent};
    let Some(st) = engine.active() else { return Value::Null };
    let (doc, styles, log) = (&st.doc, &st.doc.text_styles, &engine.analysis.log);
    let header = |key: &str| COLUMNS.iter().find(|c| c.0 == key).map_or(key.to_string(), |c| c.1.to_string());
    let character: Vec<Value> = std::iter::once(json!({"id": 0, "name": NO_CHARACTER_STYLE, "attrs": {}, "resolved": styles.resolve_char(None, None, STYLE_FAMILY)}))
        .chain(styles.character.iter().map(|d| json!({"id": d.id, "name": d.name, "attrs": d.attrs, "resolved": styles.resolve_char(None, Some(d.id), STYLE_FAMILY)})))
        .collect();
    let paragraph: Vec<Value> = std::iter::once(&styles.basic)
        .chain(&styles.paragraph)
        .map(|d| json!({"id": d.id, "name": d.name, "paragraphAttrs": d.para_attrs, "characterAttrs": d.char_attrs, "resolved": {"paragraph": styles.resolve_para(Some(d.id)), "character": styles.resolve_char(Some(d.id), None, STYLE_FAMILY)}}))
        .collect();
    // The engine's private `current` over the selected type layers' whole text.
    let (mut chars, mut paras, mut char_override, mut para_override, mut typed) = (Vec::new(), Vec::new(), false, false, false);
    for id in st.selected_layers() {
        let Some(LayerContent::Text(t)) = doc.layer(id).map(|layer| &layer.content) else { continue };
        typed = true;
        let (mut at, mut spans) = (0, Vec::new());
        for run in t.paragraph_runs().iter().filter(|run| run.len > 0 || t.text.is_empty()) {
            paras.push(run.style.style_sheet.unwrap_or(0));
            para_override |= !styles.para_overrides(&run.style).is_empty();
            spans.push((at, run.style.style_sheet));
            at += run.len;
        }
        let mut at = 0;
        for run in t.char_runs().iter().filter(|run| run.len > 0 || t.text.is_empty()) {
            let para = spans.iter().rev().find(|span| span.0 <= at).and_then(|span| span.1);
            chars.push(run.style.style_sheet.unwrap_or(0));
            char_override |= !styles.char_overrides(&run.style, para, STYLE_FAMILY).is_empty();
            at += run.len;
        }
    }
    let one = |ids: &[u32]| ids.first().filter(|first| ids.iter().all(|id| id == *first)).copied();
    let points = &engine.analysis.data_points;
    let sources: serde_json::Map<String, Value> = ["selection", "ruler", "count"].into_iter().map(|source| (source.to_string(), available(source).iter().map(|key| json!({"key": key, "name": header(key)})).collect())).collect();
    json!({
        "layerComps": {
            "comps": doc.layer_comps.iter().map(|c| json!({"id": c.id, "name": c.name, "comment": c.comment, "visibility": c.apply_visibility, "position": c.apply_position, "appearance": c.apply_appearance, "missingLayers": c.missing_layers(doc).len()})).collect::<Vec<_>>(),
            "lastApplied": doc.last_applied_comp,
            "hasLastDocumentState": doc.last_document_state.is_some(),
        },
        "measurementLog": {
            "rows": log,
            "columns": log_columns(log).iter().map(|key| json!({"key": key, "name": header(key)})).collect::<Vec<_>>(),
            "dataPoints": {"selection": points.selection, "ruler": points.ruler, "count": points.count},
            "available": sources,
        },
        "textStyles": {
            "character": character,
            "paragraph": paragraph,
            "current": typed.then(|| json!({"character": one(&chars), "characterOverride": char_override, "paragraph": one(&paras), "paragraphOverride": para_override})),
        },
    })
}

fn reply(
    dir: &Path,
    photo: &str,
    session: &PhotoSession,
    warnings: Vec<String>,
) -> Result<PhotoReply, String> {
    let mut state = inspect::document(session.engine.active().ok_or("No image document")?);
    fn enrich(
        layers: &mut Value,
        doc: &photocraft_engine::doc::Document,
        active: Option<photocraft_engine::doc::LayerId>,
    ) {
        if let Some(layers) = layers.as_array_mut() {
            for layer in layers {
                if let Some(id) = layer["id"].as_u64() {
                    if let Some(native) = doc.layer(photocraft_engine::doc::LayerId(id)) {
                        content::describe(native, doc, layer, active == Some(native.id));
                        layer["effects"] = json!({"enabled":native.effects.enabled,"items":native.effects.items.iter().map(styles::settings).collect::<Vec<_>>()});
                        layer["locks"] = json!({"transparency":native.locks.transparency,"pixels":native.locks.pixels,"position":native.locks.position,"all":native.locks.all});
                        layer["color"] = json!(layer_colors::name(native.label));
                        if let Some(mask) = &native.mask { layer["mask"] = json!({"enabled":mask.enabled,"linked":mask.linked}); }
                        if let photocraft_engine::doc::LayerContent::Smart(smart) = &native.content
                        {
                            let (kind, name) = match &smart.source {
                                photocraft_engine::doc::SmartSource::Embedded {
                                    file_name, ..
                                } => ("embedded", file_name),
                                photocraft_engine::doc::SmartSource::Linked { path } => {
                                    ("linked", path)
                                }
                            };
                            layer["smartObject"] = json!({"source":kind,"name":name,"hasFilterMask":smart.filter_mask.is_some(),"filterMaskEnabled":smart.filter_mask.as_ref().is_some_and(|mask|mask.enabled)});
                        }
                    }
                }
                if let Some(value) = layer.get("adjustment") {
                    if let Ok(adjustment) = serde_json::from_value(value.clone()) {
                        layer["adjustmentKind"] = if matches!(adjustment, photocraft_engine::doc::Adjustment::Unsupported { .. }) {
                            json!("unsupported")
                        } else {
                            json!(photocraft_engine::commands::adjustment_kind(&adjustment))
                        };
                        layer["adjustmentParams"] =
                            photocraft_engine::adjust_params::to_params(&adjustment);
                    }
                }
                if let Some(children) = layer.get_mut("children") {
                    enrich(children, doc, active);
                }
            }
        }
    }
    enrich(
        &mut state["layers"],
        &session.engine.active().ok_or("No image document")?.doc,
        session
            .engine
            .active()
            .ok_or("No image document")?
            .active_layer,
    );
    state["viewKey"] = json!(color_views::key(&session.engine)?);
    state["features"] = json!({"selectionEdgeBrush":true,"perspectiveCrop":true,"magneticLasso":true,"placeImages":true});
    state["canFade"] = json!(mask_filters::can_fade(&session.engine) || session.engine.is_enabled("edit.fade"));
    state["canCancelPreview"] = json!(true);
    state["colorView"] = color_views::Snapshot::capture(&session.engine)?.describe(&session.engine.active().ok_or("No image document")?.doc);
    state["brush"] = tools::inspect(&session.engine);
    state["tools"] = tools::colors(&session.engine);
    if let Some(context)=&session.color_settings{state["colorSettings"]=context.describe();}
    state["colorProfile"] = profiles::describe(&session.engine.active().ok_or("No image document")?.doc);
    state["historySources"] = history::describe(&session.engine);
    state["historyRedo"] = history::redo_labels(&session.engine);
    state["historySnapshots"] = snapshots::describe(&session.engine, photo);
    state["historySnapshotName"] = json!(snapshots::next_name(photo));
    state["historyOpenThumbnail"] = snapshots::opening(&session.engine, photo);
    let doc = &session.engine.active().ok_or("No image document")?.doc;
    state["paths"] = json!({"saved":doc.paths.iter().map(|path|path.name.as_str()).collect::<Vec<_>>(),"work":doc.work_path.is_some()});
    state["presets"] = tools::presets(&session.engine);
    state["analysis"] = analysis_state(&session.engine);
    state["panels"] = panels_state(&session.engine);
    state["globalLight"] = json!(
        session
            .engine
            .active()
            .ok_or("No image document")?
            .doc
            .global_light
    );
    Ok(PhotoReply {
        document: descriptor(dir, photo, session)?,
        state,
        warnings,
        result: None,
    })
}

#[tauri::command]
pub async fn xdesign_photo_open(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: Option<String>,
    source_path: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    source_data: Option<String>,
    source_name: Option<String>,
    new_options: Option<Value>,
    raw_options: Option<Value>,
) -> Result<color_import::OpenResult, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    let tool_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("xdesign-tools");
    let raw_settings=raw_develop_settings(raw_options)?;
    if version.is_some()&&raw_settings.is_some(){return Err("RAW development options apply only when opening a source file".into());}
    tauri::async_runtime::spawn_blocking(move || {
        let mut sessions = sessions().lock().map_err(|_| "Image engine needs to be restarted")?;
        let key = key(&project_id, &photo_id);
        if let Some(version) = version {
            if !sessions.get(&key).is_some_and(|s| s.version == version) {
                sessions.insert(key.clone(), restore(&dir, &version, source_path)?);
            }
        } else {
            if sessions.contains_key(&key) { return Err("This image is already open; reopen its saved version".into()); }
            let mut engine = Session::new();
            let context=color_settings::load(&tool_dir)?;context.install(&mut engine);
            let imported_source=source_data.is_some()||source_path.is_some();
            let warnings = if let Some(data) = source_data {
                if raw_settings.is_some(){return Err("RAW development options require a file path".into());}
                if data.len() > 96 * 1024 * 1024 { return Err("Embedded image exceeds 64MB".into()); }
                let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "Invalid embedded image")?;
                if bytes.len() > 64 * 1024 * 1024 { return Err("Embedded image exceeds 64MB".into()); }
                let imported = smart::import(source_name.as_deref().unwrap_or("image.png"), &bytes)?;
                engine.add_document(imported.document, None);
                imported.warnings
            } else if let Some(path) = &source_path {
                let imported=import_image_path(Path::new(path),raw_settings)?;
                engine.add_document(imported.document, None);
                imported.warnings
            } else {
                if raw_settings.is_some(){return Err("RAW development options require a camera RAW file".into());}
                let (width, height) = (width.unwrap_or(1920), height.unwrap_or(1080));
                if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS { return Err("Invalid image dimensions".into()); }
                let options=new_options.unwrap_or_else(||json!({}));
                let mode=options.get("mode").and_then(Value::as_str).unwrap_or("rgb");let depth=options.get("depth").and_then(Value::as_u64).unwrap_or(8);let resolution=options.get("resolution").and_then(Value::as_f64).unwrap_or(72.0);let name=options.get("name").and_then(Value::as_str).unwrap_or("Untitled image");let background=options.get("background").and_then(Value::as_str).unwrap_or("transparent");
                if !["rgb","gray","cmyk","lab"].contains(&mode)||![8,16,32].contains(&depth)||!resolution.is_finite()||!(1.0..=12000.0).contains(&resolution)||name.len()>512||background.len()>16 {return Err("Invalid new image settings".into());}
                engine.execute("file.new", json!({"name":name,"width":width,"height":height,"mode":mode,"depth":depth,"resolution":resolution,"background":background})).map_err(|e| e.to_string())?;
                Vec::new()
            };
            let mut warnings=warnings;
            warnings.extend(tools::activate(&tool_dir,&mut engine)?);
            let mut session = PhotoSession { engine,color_settings:Some(context), version: String::new(), original_path: source_path, writer: Default::default() };
            if imported_source{
                let report=color_settings::analyze(&session.engine)?;
                if report["ask"]==true{return color_import::stage(&project_id,&photo_id,&session,report,warnings);}
                color_import::apply(&mut session.engine,&report,&json!({"action":"automatic"}))?;
            }else{color_import::tag_new(&mut session.engine)?;}
            publish(&dir, &photo_id, &mut session)?;
            let result = reply(&dir, &photo_id, &session, warnings)?;
            sessions.insert(key, session);
            return Ok(color_import::OpenResult::Ready(result));
        }
        let session=sessions.get_mut(&key).ok_or("No image session")?;
        color_settings::activate(&tool_dir,session)?;
        let warnings=tools::activate(&tool_dir,&mut session.engine)?;
        reply(&dir, &photo_id, session, warnings).map(color_import::OpenResult::Ready)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_photo_color_settings(app:AppHandle,action:String,params:Value)->Result<Value,String>{
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("xdesign-tools");
    tauri::async_runtime::spawn_blocking(move||{
        match action.as_str(){
            "read"=>color_settings::load(&dir).map(|context|context.describe()),
            "defaults"=>color_settings::defaults(&dir).map(|context|context.describe()),
            "profileInfo"=>color_settings::profile_info(&params),
            "update"=>{let mut cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;let context=color_settings::update(&dir,&params)?;cache.color_settings(&context);Ok(context.describe())},
            _=>Err("Unknown color settings operation".into()),
        }
    }).await.map_err(|e|e.to_string())?
}
/// Copy CSS/SVG text reaches the system pasteboard here because WKWebView refuses a write that waits on the engine.
#[tauri::command]
pub async fn xdesign_photo_copy_text(text:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||copy_text(&text)).await.map_err(|e|e.to_string())?
}
#[cfg(target_os="macos")]
fn copy_text(text:&str)->Result<(),String>{
    use std::io::Write;
    // pbcopy decodes its input by locale, and the app's launchd environment may not name a UTF-8 one.
    let mut child=std::process::Command::new("/usr/bin/pbcopy").env("LANG","en_US.UTF-8").stdin(std::process::Stdio::piped()).spawn().map_err(|e|e.to_string())?;
    let written=child.stdin.take().ok_or("The clipboard could not be opened")?.write_all(text.as_bytes());
    let status=child.wait().map_err(|e|e.to_string())?;
    written.map_err(|e|e.to_string())?;
    if status.success(){Ok(())}else{Err("The clipboard could not be written".into())}
}
#[cfg(not(target_os="macos"))]
fn copy_text(_text:&str)->Result<(),String>{Err("Copying text needs the macOS pasteboard".into())}
#[tauri::command]
pub async fn xdesign_photo_clipboard(app:AppHandle,request_id:String,project_id:String,photo_id:String,version:Option<String>,command:String,params:Value,view_key:Option<String>,token:Option<String>,action:Option<String>)->Result<clipboard::Reply,String>{
    id(&request_id)?;id(&project_id)?;id(&photo_id)?;clipboard::validate(&command,&params)?;
    if let Some(version)=&version{id(version)?;}if let Some(token)=&token{id(token)?;}
    let receipt=clipboard::receipt(&request_id,&project_id,&photo_id,&version,&command,&params)?;
    if action.as_deref()==Some("cancel")&&receipt.is_none(){
        clipboard::cancel(&request_id,&project_id,&photo_id,token.as_deref().ok_or("No paste decision")?)?;return Ok(clipboard::Reply::Canceled{paste_canceled:true});
    }
    if token.is_some()!=action.is_some(){return Err("A reviewed paste needs its color decision".into());}
    if action.as_deref().is_some_and(|action|!["convert","numbers","cancel"].contains(&action)){return Err("Choose a paste color action".into());}
    let dir=root(&app,&project_id,&photo_id)?;let tool_dir=app.path().app_data_dir().map_err(|error|error.to_string())?.join("xdesign-tools");
    tauri::async_runtime::spawn_blocking(move||{
        let mut cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;let cache_key=key(&project_id,&photo_id);
        if let Some(receipt)=clipboard::receipt(&request_id,&project_id,&photo_id,&version,&command,&params)?{
            if cache.get(&cache_key).is_some_and(|session|session.version!=receipt.output_version){return Err("The clipboard result changed; reopen the image's current version".into());}
            if !cache.contains_key(&cache_key){cache.insert(cache_key.clone(),restore(&dir,&receipt.output_version,receipt.original_path)?);}
            let mut response=reply(&dir,&photo_id,cache.get(&cache_key).ok_or("No clipboard result")?,receipt.warnings)?;response.state["clipboard"]=clipboard::summary()?;
            if action.as_deref()==Some("cancel"){response.warnings.push("Paste had already finished; restored the committed result.".into());}
            return Ok(clipboard::Reply::Ready(response));
        }
        if command=="file.newFromClipboard"{
            if version.is_some()||token.is_some()||cache.contains_key(&cache_key){return Err("Choose a new clipboard image identity".into());}
            let pixels=clipboard::current()?;let mut engine=Session::new();let context=color_settings::load(&tool_dir)?;context.install(&mut engine);let warnings=tools::activate(&tool_dir,&mut engine)?;clipboard::paste(&mut engine,&pixels,&command,params.clone(),None,&context.native)?;
            let mut session=PhotoSession{engine,color_settings:Some(context),version:String::new(),original_path:None,writer:Default::default()};publish(&dir,&photo_id,&mut session)?;let mut result=reply(&dir,&photo_id,&session,warnings.clone())?;result.state["clipboard"]=clipboard::summary()?;clipboard::remember(&request_id,&project_id,&photo_id,None,&command,params,&session,warnings)?;cache.insert(cache_key,session);return Ok(clipboard::Reply::Ready(result));
        }
        let version=version.ok_or("Open an image before using its clipboard")?;
        if !cache.contains_key(&cache_key){cache.insert(cache_key.clone(),restore(&dir,&version,None)?);}
        let session=cache.get_mut(&cache_key).ok_or("No paste target")?;if session.version!=version{return Err("The image changed; reopen its current version before using the clipboard".into());}
        color_settings::activate(&tool_dir,session)?;let warnings=tools::activate(&tool_dir,&mut session.engine)?;
        if let Some(expected)=view_key.as_ref(){if expected!=&color_views::key(&session.engine)?{return Err("The image view changed; review the paste target".into());}}
        let pixels=if !clipboard::is_copy(&command)&&token.is_none(){Some(clipboard::current()?)}else{None};
        if let Some(pixels)=&pixels{if let Some(report)=clipboard::question(&mut session.engine,pixels,&command,&params)?{return clipboard::stage(&request_id,&project_id,&photo_id,session,&command,&params,pixels.clone(),report);}}
        let response=clipboard::commit_existing(session,&dir,&request_id,&project_id,&photo_id,&command,&params,token.as_deref(),action.as_deref(),warnings)?;cache.refresh(&cache_key);Ok(clipboard::Reply::Ready(response))
    }).await.map_err(|error|error.to_string())?
}
#[tauri::command]
pub async fn xdesign_photo_import_decision(app:AppHandle,project_id:String,photo_id:String,token:String,params:Value)->Result<Option<PhotoReply>,String>{
    let dir=root(&app,&project_id,&photo_id)?;
    tauri::async_runtime::spawn_blocking(move||{
        let mut cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;
        if let Some(receipt)=color_import::receipt(&project_id,&photo_id,&token)?{
            if params["action"]=="cancel"{return Ok(None);}
            let cache_key=key(&project_id,&photo_id);
            if cache.get(&cache_key).is_some_and(|session|session.version!=receipt.version){return Err("The imported image changed; reopen its current version".into());}
            if !cache.contains_key(&cache_key){cache.insert(cache_key.clone(),restore(&dir,&receipt.version,receipt.source)?);}
            return reply(&dir,&photo_id,cache.get(&cache_key).ok_or("Missing imported image")?,receipt.warnings).map(Some);
        }
        if params["action"]=="cancel"{color_import::prepare(&project_id,&photo_id,&token,&params)?;return Ok(None);}
        if cache.contains_key(&key(&project_id,&photo_id)){return Err("This image is already open".into());}
        let Some((mut session,warnings))=color_import::prepare(&project_id,&photo_id,&token,&params)? else{return Ok(None);};
        check_size(&session.engine)?;publish(&dir,&photo_id,&mut session)?;let response=reply(&dir,&photo_id,&session,warnings)?;color_import::finish(&token,&session.version)?;cache.insert(key(&project_id,&photo_id),session);Ok(Some(response))
    }).await.map_err(|e|e.to_string())?
}

fn command_supported(command: &str) -> bool {
    if [
        "layer.smartObjects.editContents",
        "layer.smartObjects.saveContents",
        "image.duplicate",
        "channel.split",
        "channel.merge",
        "layer.quickExportAsPng",
        "layer.exportAs",
        "edit.copy",
        "edit.copyMerged",
        "edit.cut",
        "edit.paste",
        "edit.pasteSpecial.pasteInPlace",
        "edit.pasteSpecial.pasteInto",
        "edit.pasteSpecial.pasteOutside",
        "file.newFromClipboard",
    ]
    .contains(&command)
    {
        return false;
    }
    [
        "paint.",
        "select.",
        "layer.",
        "image.",
        "filter.",
        "edit.transform.",
        "type.",
        "vector.",
        "path.",
        "channel.",
        "tools.",
        "shape.",
        "gradient.",
        "brush.",
        "color.",
        "pattern.",
        "layerComp.",
        "count.",
        "measurementLog.",
        "notes.",
        "style.",
        "tool.",
        "cloneSource.",
        "slice.",
        "variables.",
    ]
    .iter()
    .any(|p| command.starts_with(p))
        || [
            "edit.undo",
            "edit.redo",
            "history.select",
            "history.fold",
            "history.snapshot.new",
            "history.snapshot.select",
            "history.snapshot.rename",
            "history.snapshot.delete",
            "edit.contentAwareScale",
            "edit.transform",
            "edit.puppetWarp",
            "edit.perspectiveWarp",
            "edit.clear",
            "edit.fill",
            "edit.stroke",
            "edit.fade",
            "edit.copy",
            "edit.copyMerged",
            "edit.paste",
            "edit.pasteSpecial.pasteInPlace",
            "edit.cut",
            "edit.assignProfile",
            "edit.convertToProfile",
            "edit.profileInfo",
            "edit.colorSettings",
            "edit.purge.clipboard",
            "edit.purge.histories",
            "edit.purge.all",
            "edit.defineBrushPreset",
            "edit.definePattern",
            "edit.defineCustomShape",
            "edit.presets.presetManager",
            "edit.findAndReplaceText",
            "edit.checkSpelling",
            "edit.autoAlignLayers",
            "edit.autoBlendLayers",
            "edit.contentAwareFill",
            "view.layerMask",
            "view.lockSlices", "view.clearSlices",
            "view.proofSetup", "view.proofColors", "view.gamutWarning", "view.thirtyTwoBitPreviewOptions",
            "view.proofSetup.workingCyanPlate", "view.proofSetup.workingMagentaPlate", "view.proofSetup.workingYellowPlate", "view.proofSetup.workingBlackPlate", "view.proofSetup.workingCmyPlate",
            "view.proofSetup.legacyMacintoshRgb", "view.proofSetup.colorBlindnessProtanopia", "view.proofSetup.colorBlindnessDeuteranopia",
        ]
        .contains(&command)
        || [
            "file.placeEmbedded", "file.placeLinked", "file.fileInfo",
            "file.scripts.deleteAllEmptyLayers", "file.scripts.flattenAllLayerEffects", "file.scripts.flattenAllMasks",
            "file.export.colorLookupTables", "file.export.pathsToIllustrator", "file.export.layersToFiles", "file.export.artboardsToPdf",
        ]
        .contains(&command)
}

// The crop box is rotated clockwise by `angle` on screen: rotate the canvas back so the box is
// axis-aligned, then crop around where its centre landed (the engine grows the canvas around its centre).
/// Photoshop's Layer Via Copy names a whole copy of the Background the next free "Layer N" where the engine says
/// "Background copy". The rename is part of the same history step.
fn layer_via_copy(engine: &mut Session, params: Value) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let background = state.active_layer.and_then(|id| state.doc.layer(id)).is_some_and(|layer| layer.name == "Background" && state.doc.layers.first().is_some_and(|bottom| bottom.id == layer.id));
    let result = engine.execute("layer.new.layerViaCopy", params).map_err(|e| e.to_string())?;
    let state = engine.active_mut().ok_or("No image document")?;
    if let Some(copy) = background.then_some(state.active_layer).flatten().filter(|id| state.doc.layer(*id).is_some_and(|layer| layer.name == "Background copy")) {
        let name = state.doc.next_layer_name("Layer");
        if let Some(layer) = std::sync::Arc::make_mut(&mut state.doc).layer_mut(copy) { layer.name = name; }
    }
    Ok(result)
}

fn crop_rotated(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let number = |key: &str| params[key].as_f64().filter(|value| value.is_finite()).ok_or_else(|| format!("Rotated crop needs a numeric {key}"));
    let (x, y, width, height, angle) = (number("x")?, number("y")?, number("width")?, number("height")?, number("angle")?);
    if width < 1.0 || height < 1.0 || width * height > MAX_PIXELS as f64 { return Err("Choose a nonempty area within the image editing limits.".into()); }
    let before = engine.active().ok_or("No image document")?.doc.size;
    engine.execute("image.rotation.arbitrary", json!({"angle": -angle, "direction": "cw"})).map_err(|e| e.to_string())?;
    let after = engine.active().ok_or("No image document")?.doc.size;
    let (sn, cs) = (-angle).to_radians().sin_cos();
    let (dx, dy) = (x + width / 2.0 - f64::from(before.width) / 2.0, y + height / 2.0 - f64::from(before.height) / 2.0);
    let (cx, cy) = (cs * dx - sn * dy + f64::from(after.width) / 2.0, sn * dx + cs * dy + f64::from(after.height) / 2.0);
    engine.execute("image.crop", json!({"x": (cx - width / 2.0).round() as i64, "y": (cy - height / 2.0).round() as i64, "width": width.round() as i64, "height": height.round() as i64, "deleteCroppedPixels": params["deleteCroppedPixels"].as_bool().unwrap_or(false)})).map_err(|e| e.to_string())
}

fn execute_view_command(
    engine: &mut Session,
    command: &str,
    params: Value,
) -> Result<Value, String> {
    if command == "history.select" { return history::select(engine, &params); }
    if command == "history.fold" { return history::fold(engine, &params); }
    if command == "image.cropRotated" { return crop_rotated(engine, &params); }
    if command == "layer.new.layerViaCopy" { return layer_via_copy(engine, params); }
    if command == "edit.purge.clipboard" || command == "edit.purge.all" { return clipboard::purge(engine, command); }
    if let Some(result) = exports::execute(engine, command, &params) { return result; }
    let params = preview::prepare_lens_edit(engine, command, params)?;
    preview::validate_filter_input(command, &params)?;
    if !mask_filters::separate(command) || !mask_filters::targets_coverage(engine, &params) { preview::validate_lens_input(engine, command, &params)?; }
    if let Some(result) = color_views::execute(engine, command, &params) { return result; }
    if let Some(result) = profiles::execute(engine, command, &params) { return result; }
    if let Some(result) = color_conversion::execute(engine, command, &params) { return result; }
    if let Some(result) = straighten::execute(engine, command, &params) { return result; }
    if let Some(result) = perspective_crop::execute(engine, command, &params) { return result; }
    if let Some(result) = selection_brush::execute(engine, command, &params) { return result; }
    if let Some(result) = magnetic::execute(engine, command, &params) { return result; }
    if let Some(result) = styles::execute(engine, command, &params) {
        return result;
    }
    if let Some(result) = layers::execute(engine, command, &params) {
        return result;
    }
    if command == "shape.presets.edit" {
        if let Some(result) = tools::edit_shapes(engine, &params) {
            return result;
        }
    }
    // A layer thumbnail chooses pixels or its mask in one host transaction.
    // Plain layer.select remains compatible with engine automation.
    let layer_target = if command == "layer.select" {
        params["target"].as_str().map(str::to_owned)
    } else {
        None
    };
    if let Some(target) = layer_target.as_deref() {
        if target != "pixels" && target != "mask" {
            return Err("Layer edit target must be pixels or mask".into());
        }
        if target == "mask" {
            let state = engine.active().ok_or("No image document is open")?;
            let layer = params["layer"]
                .as_u64()
                .map(photocraft_engine::doc::LayerId);
            if !layer
                .and_then(|id| state.doc.layer(id))
                .is_some_and(|layer| layer.mask.is_some())
            {
                return Err("The selected layer has no mask".into());
            }
        }
    }
    if command.starts_with("channel.target") {
        if let Some(state) = engine.active_mut() {
            state.channel_view.layer_mask = None;
        }
    } else if command == "view.layerMask" && params["mode"].as_str() != Some("off") {
        if let Some(state) = engine.active_mut() {
            state.channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Composite;
            state.channel_view.color_hidden.clear();
            state.channel_view.alpha_visible.clear();
        }
    }
    let params = history::normalize(engine,command,preview::lut_params(command, params)?)?;
    if let Some(result) = channels::execute(engine, command, &params) {
        return result;
    }
    if let Some(result) = adjust::execute(engine, command, &params) {
        return result;
    }
    if let Some(result) = mask_filters::execute(engine, command, &params) { return result; }
    if let Some(result) = linked_replay::execute(engine, command, &params) { return result; }
    if let Some(result) = place::execute(engine, command, &params) { return result; }
    if let Some(result) = image_size::execute(engine, command, &params) { return result; }
    if let Some(result) = fill_modes::execute(engine, command, &params) { return result; }
    if let Some(result) = red_eye::execute(engine, command, &params) { return result; }
    if let Some(result) = pattern_stamp::execute(engine, command, &params) { return result; }
    if let Some(result) = layer_colors::execute(engine, command, &params) { return result; }
    if let Some(result) = layer_code::execute(engine, command, &params) { return result; }
    let mut params = params;
    let coverage_fade = mask_filters::prepare_paint_fade(engine, command, &mut params);
    let adjusted = if command == "layer.setAdjustment" { params["layer"].as_u64().map(photocraft_engine::doc::LayerId).or_else(|| engine.active().and_then(|state| state.active_layer)) } else { None };
    let result = engine.execute(command, params).map_err(|e| e.to_string())?;
    mask_filters::finish_paint_fade(engine, coverage_fade);
    if let Some(layer) = adjusted { history::name_adjustment_edit(engine, layer); }
    if layer_target.is_some() || command == "select.editInQuickMaskMode" {
        if let Some(state) = engine.active_mut() {
            let previous = state.channel_view.clone();
            state.channel_view.target = photocraft_engine::channel_cmds::ChannelTarget::Composite;
            state.channel_view.color_hidden.clear();
            state.channel_view.alpha_visible.clear();
            state.channel_view.layer_mask = None;
            if state.channel_view != previous {
                let clean = state.saved_revision == state.revision;
                state.revision += 1;
                if clean {
                    state.saved_revision = state.revision;
                }
                state.last_damage = Some(photocraft_engine::doc::Rect::EMPTY);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn xdesign_photo_command(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    command: String,
    params: Value,
) -> Result<PhotoReply, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    let tool_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("xdesign-tools");
    id(&version)?;
    if !command_supported(&command) {
        return Err("This operation must be handled by the XDesign workspace".into());
    }
    let parameter_limit=if command=="edit.colorSettings"{color_settings::MAX_PARAMS}else if profiles::COMMANDS.contains(&command.as_str())||color_views::COMMANDS.contains(&command.as_str()){profiles::PARAMETER_BYTES}else if command.starts_with("paint."){16*1024*1024}else{1024*1024};
    if !params.is_object() || params.to_string().len() > parameter_limit {
        return Err("Invalid image operation parameters".into());
    }
    if command.starts_with("paint.")&&params["points"].as_array().is_some_and(|points|points.len()>131_072){return Err("Finish the paint gesture before it exceeds 131072 samples".into());}
    // Match Color reads its source statistics from a second engine document: load that image beside
    // this one for the command and close it before publishing.
    let mut params = params;
    let match_source = match (command == "image.adjustments.matchColor").then(|| params.as_object_mut().and_then(|object| object.remove("sourcePhoto"))).flatten() {
        Some(source) => {
            let (Some(source_id), Some(source_version)) = (source["id"].as_str(), source["version"].as_str()) else { return Err("Choose a source image for Match Color".into()); };
            id(source_version)?;params["source"] = json!(1);
            Some((root(&app, &project_id, source_id)?, source_version.to_string()))
        }
        None => None,
    };
    tauri::async_runtime::spawn_blocking(move || {
        if command=="pattern.import" {
            if let Some(path)=params["path"].as_str() {
                let metadata=std::fs::metadata(path).map_err(|e|e.to_string())?;
                if !metadata.is_file()||metadata.len()>128*1024*1024 {return Err("Pattern import exceeds 128MB".into());}
            }
        }
        let mut sessions = sessions().lock().map_err(|_| "Image engine needs to be restarted")?;
        let cache_key=key(&project_id,&photo_id);
        if !sessions.contains_key(&cache_key) { sessions.insert(cache_key.clone(),restore(&dir,&version,None)?); }
        if command=="edit.colorSettings"{
            if sessions.get(&cache_key).is_none_or(|session|session.version!=version){return Err("The image changed; reopen it before changing color settings".into());}
            let context=color_settings::update(&tool_dir,&params)?;sessions.color_settings(&context);let session=sessions.get(&cache_key).ok_or("No image session")?;let mut response=reply(&dir,&photo_id,session,Vec::new())?;response.result=Some(context.describe());return Ok(response);
        }
        let session = sessions.get_mut(&cache_key).ok_or("Reopen the image document before editing")?;
        if session.version != version { return Err("The image changed; reopen its current version before editing".into()); }
        preview::validate_geometry_input(&session.engine, &command, &params)?;
        color_settings::activate(&tool_dir,session)?;
        let before = session.engine.active().cloned().ok_or("No image document")?;
        if let Some((source_dir, source_version)) = &match_source {
            let source = restore(source_dir, source_version, None)?;
            session.engine.add_document((*source.engine.active().ok_or("The Match Color source image is unavailable")?.doc).clone(), None);
            session.engine.set_active(0);
        }
        if command == "image.crop" {
            let width=params.get("width").and_then(Value::as_u64).unwrap_or(u64::from(before.doc.size.width));
            let height=params.get("height").and_then(Value::as_u64).unwrap_or(u64::from(before.doc.size.height));
            if width==0||height==0||width.checked_mul(height).is_none_or(|pixels|pixels>MAX_PIXELS) {return Err("Requested dimensions exceed the 256 megapixel editing limit".into());}
        }
        // Switching channel targets ends mask isolation. Viewing a layer mask
        // starts from the composite so automatic paint routing targets that mask.
        let color_before=if color_views::COMMANDS.contains(&command.as_str()){Some(color_views::Snapshot::capture(&session.engine)?.native(&before.doc)?)}else{None};
        let stroke_identity=format!("{project_id}/{photo_id}/{version}/{}",color_views::key(&session.engine)?);
        let output_path = linked_replay::output_path(&command, &params);
        let result = tools::execute(&tool_dir,&mut session.engine,&command,|engine|match stroke::commit_feedback(engine,&stroke_identity,&command,&params){Some(result)=>result,None=>match snapshots::execute(engine,&photo_id,&command,&params){Some(result)=>result,None=>execute_view_command(engine, &command, params)}}).and_then(|(value,warnings)| linked_replay::persist_output(output_path.as_deref(), || {
            if match_source.is_some() { while session.engine.documents().len() > 1 { session.engine.close(session.engine.documents().len() - 1); } session.engine.set_active(0); }
            if session.engine.documents().len()!=1||session.engine.active_index()!=Some(0) {return Err("This operation creates another image document and needs a workspace integration".into());}
            persist_command(&dir, &photo_id, session, &before, &command)?;
            Ok((value,warnings))
        }));
        if let Err(error) = &result {
            if let Some(color)=color_before{session.engine.color=color;}
            while session.engine.documents().len()>1 {session.engine.close(session.engine.documents().len()-1);}
            if session.engine.documents().is_empty() {session.engine.add_document((*before.doc).clone(),None);}
            session.engine.set_active(0);
            if let Some(active) = session.engine.active_mut() { *active = before; }
            return Err(error.clone());
        }
        let (value,warnings)=result?;
        let mut response = reply(&dir, &photo_id, session, warnings)?;
        response.result = Some(value);
        sessions.refresh(&cache_key);
        Ok(response)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_photo_catalog() -> Result<Value, String> {
    let mut commands: Vec<Value> = photocraft_engine::command_specs().iter().map(|command| json!({
        "id":command.id,"label":command.label,"menu":command.menu,"shortcut":command.shortcut,"params":command.params,
        "engineRegistered":true,"hostDispatch":command_supported(command.id)||clipboard::is_command(command.id)||["channel.split","channel.merge"].contains(&command.id)
    })).collect();
    commands.extend(styles::catalog());
    commands.extend(layers::catalog());
    Ok(json!({"revision":"47f9306fd06d5dee11acb84b108606f4c867222a","commands":commands}))
}

#[tauri::command]
pub async fn xdesign_photo_source_inspect(app: AppHandle, project_id: String, source: channel_workspace::PhotoReference) -> Result<Value, String> {
    channel_workspace::inspect(app, project_id, source).await
}

#[tauri::command]
pub async fn xdesign_storage_report(app:AppHandle)->Result<storage::StorageReport,String>{storage::report(app).await}
#[tauri::command]
pub async fn xdesign_storage_startup(app:AppHandle)->Result<storage::StorageReport,String>{storage::startup(app).await}
#[tauri::command]
pub async fn xdesign_storage_schedule_compaction(app:AppHandle,enabled:bool)->Result<bool,String>{storage::schedule(app,enabled).await}

#[tauri::command]
pub async fn xdesign_photo_channel_operation(app: AppHandle, project_id: String, photo_id: String, version: String, command: String, params: Value, view_key: Option<String>, preview: bool) -> Result<Value, String> {
    channel_workspace::run(app, project_id, photo_id, version, command, params, view_key, preview).await
}

#[tauri::command]
pub async fn xdesign_photo_new_documents(app: AppHandle, project_id: String, photo_id: String, version: String, command: String, params: Value) -> Result<Vec<PhotoReply>, String> {
    documents::run(app, project_id, photo_id, version, command, params).await
}

#[tauri::command]
pub async fn xdesign_photo_smart_open(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    layer: u64,
) -> Result<PhotoReply, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    let tool_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("xdesign-tools");
    id(&version)?;
    let child_id = ulid::Ulid::new().to_string();
    let child_dir = root(&app, &project_id, &child_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let parent = restore(&dir, &version, None)?;
        let mut child = smart::open(&parent, layer)?;
        color_settings::activate(&tool_dir,&mut child)?;
        publish(&child_dir, &child_id, &mut child)?;
        let link = smart::DraftLink {
            parent_id: photo_id,
            parent_version: version,
            layer,
        };
        photocraft_format::atomic_write(
            &child_dir.join("contents.json"),
            &serde_json::to_vec(&link).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let warnings = tools::activate(&tool_dir, &mut child.engine)?;
        let result = reply(&child_dir, &child_id, &child, warnings)?;
        let mut cache = sessions()
            .lock()
            .map_err(|_| "Image engine needs to be restarted")?;
        cache.insert(key(&project_id, &child_id), child);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_photo_smart_apply(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    child_id: String,
    child_version: String,
    layer: u64,
) -> Result<PhotoReply, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    let tool_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("xdesign-tools");
    let child_dir = root(&app, &project_id, &child_id)?;
    id(&version)?;
    id(&child_version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes=std::fs::read(child_dir.join("contents.json")).map_err(|_|"This image is not an editable smart-object draft")?;
        if bytes.len()>4096 { return Err("Invalid smart-object draft link".into()); }
        let link:smart::DraftLink=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
        if link.parent_id!=photo_id||link.parent_version!=version||link.layer!=layer { return Err("The parent changed after opening these contents; return to the parent and open its current contents".into()); }
        let child=restore(&child_dir,&child_version,None)?;
        let mut cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;
        let cache_key=key(&project_id,&photo_id);
        if !cache.contains_key(&cache_key) { cache.insert(cache_key.clone(),restore(&dir,&version,None)?); }
        let parent=cache.get_mut(&cache_key).ok_or("No parent image")?;
        if parent.version!=version { return Err("The parent image changed; reopen its current contents".into()); }
        let before=parent.engine.active().cloned().ok_or("No parent image")?;
        let previous=parent.version.clone();
        let result=smart::apply(parent,&child,layer).and_then(|_|publish(&dir,&photo_id,parent).map(|_|()));
        if let Err(error)=result { *parent.engine.active_mut().ok_or("No parent image")?=before;parent.version=previous;return Err(error); }
        let warnings=tools::activate(&tool_dir,&mut parent.engine)?;
        let result=reply(&dir,&photo_id,parent,warnings)?;
        cache.refresh(&cache_key);Ok(result)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn xdesign_photo_export(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    path: String,
    quality: Option<u8>,
) -> Result<Vec<String>, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    let mut options = photocraft_io::ExportOptions::default();
    if let Some(quality) = quality { options.encode.jpeg_quality = quality.clamp(1, 100); }
    let ext = Path::new(&path)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ![
        "png", "jpg", "jpeg", "webp", "tiff", "tif", "psd", "psb", "pcraft", "exr", "hdr", "avif",
        "gif", "bmp", "tga", "ico", "qoi", "pnm", "pdf",
    ]
    .contains(&ext.as_str())
    {
        return Err("Unsupported image export format".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let doc = restore(&dir, &version, None)?;
        let doc = &doc.engine.active().ok_or("No image document")?.doc;
        let (bytes, warnings) = if ext == "pdf" {
            let flattened = (doc.layers.len() > 1).then(|| "Photoshop PDF keeps the flattened image; layers are not saved.".to_string());
            (pdf::photoshop_pdf(doc)?, flattened.into_iter().collect())
        } else {
            let exported = photocraft_io::export(doc, &ext, &options).map_err(|e| e.to_string())?;
            (exported.bytes, exported.warnings)
        };
        photocraft_format::atomic_write(Path::new(&path), &bytes)
            .map_err(|e| e.to_string())?;
        Ok(warnings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    fn selection_workspace_reopen(command:&str,params:Value){
        let mut engine=selection_fixture(16,true);engine.execute("select.rect",json!({"x":32,"y":16,"width":64,"height":64})).unwrap();let before=engine.active().unwrap().doc.clone();let pixels=photocraft_compose::render(&before,before.bounds()).px;let mask=selection_mask(&engine);let undo=engine.active().unwrap().history.past_len();
        engine.execute(command,params).unwrap();assert_eq!(engine.active().unwrap().history.past_len(),undo+1);let after=engine.active().unwrap().doc.clone();let after_pixels=photocraft_compose::render(&after,after.bounds()).px;let after_selection=selection_mask(&engine);
        engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&engine),mask);assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).px,pixels);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(selection_mask(&engine),after_selection);assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,after.bounds()).px,after_pixels);
        let root=std::env::temp_dir().join(format!("xdesign-selection-workspace-{}",ulid::Ulid::new()));let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};publish(&root,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=restore(&root,&session.version,None).unwrap();assert_eq!(selection_mask(&reopened.engine),after_selection);assert_eq!(photocraft_compose::render(&reopened.engine.active().unwrap().doc,after.bounds()).px,after_pixels);assert_eq!(&*reopened.engine.active().unwrap().doc,&*after);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&reopened.engine),mask);assert_eq!(photocraft_compose::render(&reopened.engine.active().unwrap().doc,before.bounds()).px,pixels);std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selection_workspaces_native_outputs_and_history_survive_reopen(){
        selection_workspace_reopen("select.refineEdge",json!({"radius":2.5,"smartRadius":true,"smooth":12.25,"feather":1.5,"contrast":20,"shiftEdge":-12,"sampleAllLayers":true,"output":"selection"}));
        selection_workspace_reopen("select.refineEdge",json!({"radius":2.5,"feather":1.5,"output":"layerMask"}));
        selection_workspace_reopen("select.refineEdge",json!({"radius":2.5,"feather":1.5,"output":"newLayer"}));
        selection_workspace_reopen("select.refineEdge",json!({"radius":2.5,"feather":1.5,"decontaminate":true,"amount":42,"output":"newLayerWithMask"}));
        selection_workspace_reopen("select.focusArea",json!({"range":0.375,"noise":0.125,"sampleAllLayers":true,"mode":"intersect"}));
        selection_workspace_reopen("select.colorRange",json!({"points":[[64,48]],"subtractPoints":[[4,4]],"localized":true,"range":25,"fuzziness":50,"sampleAllLayers":true,"mode":"replace"}));
    }

    #[test]
    fn color_profiles_host_routes_undo_reopen_and_tagged_exports_retain_icc() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":16,"depth":16,"background":"#50a0c080"})).unwrap();
        let source=engine.active().unwrap().doc.clone();
        for command in profiles::COMMANDS {assert!(command_supported(command));}
        execute_view_command(&mut engine,"edit.assignProfile",json!({"profile":"display-p3"})).unwrap();
        execute_view_command(&mut engine,"edit.convertToProfile",json!({"profile":"srgb","intent":"absolute","bpc":false})).unwrap();
        let after=engine.active().unwrap().doc.clone();let bytes=after.icc_profile.as_ref().unwrap().as_ref().clone();
        let info=execute_view_command(&mut engine,"edit.profileInfo",json!({})).unwrap();assert_eq!(info["profile"]["embedded"],true);
        let root=std::env::temp_dir().join(format!("xdesign-color-profile-{}",ulid::Ulid::new()));let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
        publish(&root,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=restore(&root,&session.version,None).unwrap();assert_eq!(&*reopened.engine.active().unwrap().doc,&*after);
        assert_eq!(reply(&root,"fixture",&reopened,vec![]).unwrap().state["colorProfile"],profiles::describe(&after));
        reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(profiles::describe(&reopened.engine.active().unwrap().doc)["description"],"Display P3");
        reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(&*reopened.engine.active().unwrap().doc,&*source);
        reopened.engine.execute("edit.redo",json!({})).unwrap();reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(&*reopened.engine.active().unwrap().doc,&*after);
        for format in ["png","psd","psb"] {let export=photocraft_io::export(&after,format,&Default::default()).unwrap();let imported=photocraft_io::import(&format!("profile.{format}"),&export.bytes).unwrap();assert_eq!(imported.document.icc_profile.as_ref().unwrap().as_ref(),&bytes,"{format}");assert_eq!(profiles::describe(&imported.document)["embedded"],true);}
        let boundary=root.join(format!("{}.view.json",session.version));std::fs::remove_file(&boundary).unwrap();std::fs::create_dir(&boundary).unwrap();save_command_view(&root,&session,"edit.profileInfo").unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    fn selection_mask(engine:&Session)->Vec<f32>{
        let document=&engine.active().unwrap().doc;
        (0..document.size.height as i32).flat_map(|y|(0..document.size.width as i32).map(move|x|document.selection.as_ref().map_or(0.0,|mask|mask.sample_channel(x,y,0)))).collect()
    }
    fn selection_coverage(engine:&Session,x:i32,y:i32)->f32{engine.active().unwrap().doc.selection.as_ref().map_or(0.0,|mask|mask.sample_channel(x,y,0))}
    #[test]
    fn selection_gestures_ellipse_edges_combinations_lasso_and_reopen_preserve_pixels(){
        for depth in [8,16,32]{
            let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":48,"depth":depth,"background":"#509080"})).unwrap();
            let original=photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px;
            for (mode,at_both,at_ellipse,at_rect) in [("replace",true,true,false),("add",true,true,true),("subtract",false,false,true),("intersect",true,false,false)]{
                engine.execute("select.rect",json!({"x":20,"y":10,"width":20,"height":25})).unwrap();let before=selection_mask(&engine);let count=engine.active().unwrap().history.past_len();
                engine.execute("select.rect",json!({"x":12,"y":9,"width":35,"height":29,"ellipse":true,"antiAlias":false,"feather":0,"mode":mode})).unwrap();
                assert_eq!(selection_coverage(&engine,30,20)>0.5,at_both,"{depth} {mode} overlap");assert_eq!(selection_coverage(&engine,14,23)>0.5,at_ellipse,"{depth} {mode} ellipse");assert_eq!(selection_coverage(&engine,39,10)>0.5,at_rect,"{depth} {mode} rectangle");assert_eq!(engine.active().unwrap().history.past_len(),count+1);
                engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&engine),before);
            }
            engine.execute("select.rect",json!({"x":12,"y":9,"width":35,"height":29,"ellipse":true,"antiAlias":false})).unwrap();let hard=selection_mask(&engine);assert!(hard.iter().all(|value|*value==0.0||*value==1.0));
            engine.execute("select.rect",json!({"x":12,"y":9,"width":35,"height":29,"ellipse":true,"antiAlias":true})).unwrap();let aa=selection_mask(&engine);assert!(aa.iter().any(|value|*value>0.0&&*value<1.0));assert_ne!(hard,aa);
            engine.execute("select.rect",json!({"x":12,"y":9,"width":35,"height":29,"ellipse":true,"antiAlias":true,"feather":2.5})).unwrap();let feather=selection_mask(&engine);assert_ne!(aa,feather);assert!(selection_coverage(&engine,30,23)>0.9);assert!(selection_coverage(&engine,47,23)>0.0);
            engine.execute("select.lasso",json!({"points":[[9.5,8.25],[48.75,10.5],[39.5,38.25]],"antiAlias":false,"feather":0,"mode":"replace"})).unwrap();let polygon=selection_mask(&engine);assert!(selection_coverage(&engine,30,18)>0.9);
            engine.execute("select.lasso",json!({"points":[[9.5,8.25],[48.75,10.5],[39.5,38.25]],"antiAlias":true,"feather":3,"mode":"replace"})).unwrap();let refined=selection_mask(&engine);assert_ne!(polygon,refined);
            engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&engine),polygon);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(selection_mask(&engine),refined);
            assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px,original);
            let root=std::env::temp_dir().join(format!("xdesign-selection-{}",ulid::Ulid::new()));let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};publish(&root,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=restore(&root,&session.version,None).unwrap();assert_eq!(selection_mask(&reopened.engine),refined);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&reopened.engine),polygon);assert_eq!(photocraft_compose::render(&reopened.engine.active().unwrap().doc,reopened.engine.active().unwrap().doc.bounds()).px,original);std::fs::remove_dir_all(root).unwrap();
        }
    }
    fn selection_fixture(depth:u32,disc:bool)->Session{
        let mut engine=Session::new();engine.execute("file.new",json!({"width":128,"height":96,"depth":depth})).unwrap();
        engine.edit("Selection fixture",|doc,_|{let surface=doc.layers[0].surface_mut().unwrap();let channels=surface.channels();let mut data=Vec::new();for y in 0..96{for x in 0..128{let object=if disc{(x as f32+0.5-64.0).powi(2)+(y as f32+0.5-48.0).powi(2)<625.0}else{x<56};let noise=((x*17+y*29)%13)as f32*0.002;let rgb=if object{[0.8+noise,0.4+noise,0.2]}else{[0.15,0.3+noise,0.7+noise]};data.extend_from_slice(&rgb[..channels.min(3)]);if channels==4{data.push(1.0);}}}surface.write_region(photocraft_engine::doc::Rect::new(0,0,128,96),&data);Ok(())}).unwrap();engine
    }
    #[test]
    fn selection_gestures_quick_and_object_masks_sampling_undo_and_reopen(){
        for depth in [8,16,32]{
            let mut engine=selection_fixture(depth,false);let original=photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px;
            engine.execute("select.quick",json!({"points":[[20,25],[40,45]],"size":18,"mode":"replace","sampleAllLayers":false,"enhanceEdge":true})).unwrap();assert!(selection_coverage(&engine,10,20)>0.5);assert!(selection_coverage(&engine,100,20)<0.5);let left=selection_mask(&engine);
            engine.execute("select.quick",json!({"points":[[100,40]],"size":18,"mode":"add","sampleAllLayers":true,"enhanceEdge":false})).unwrap();assert!(selection_coverage(&engine,10,20)>0.5&&selection_coverage(&engine,100,20)>0.5);
            engine.execute("select.quick",json!({"points":[[20,25]],"size":18,"mode":"subtract","sampleAllLayers":true})).unwrap();assert!(selection_coverage(&engine,10,20)<0.5&&selection_coverage(&engine,100,20)>0.5);engine.execute("edit.undo",json!({})).unwrap();engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&engine),left);assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px,original);
            let mut engine=selection_fixture(depth,true);let original=photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px;
            engine.execute("select.object",json!({"rect":[32,16,64,64],"mode":"replace","sampleAllLayers":true})).unwrap();assert!(selection_coverage(&engine,64,48)>0.9);assert!(selection_coverage(&engine,32,16)<0.1);let object=selection_mask(&engine);
            engine.execute("select.object",json!({"rect":[32,16,64,64],"mode":"subtract","sampleAllLayers":false})).unwrap();assert!(selection_coverage(&engine,64,48)<0.1);engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&engine),object);
            let root=std::env::temp_dir().join(format!("xdesign-smart-selection-{}",ulid::Ulid::new()));let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};publish(&root,&ulid::Ulid::new().to_string(),&mut session).unwrap();let reopened=restore(&root,&session.version,None).unwrap();assert_eq!(selection_mask(&reopened.engine),object);assert_eq!(photocraft_compose::render(&reopened.engine.active().unwrap().doc,reopened.engine.active().unwrap().doc.bounds()).px,original);std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn selection_gestures_crop_keeps_or_deletes_outside_pixels_with_undo_and_reopen(){
        for delete in [false,true]{let mut engine=selection_fixture(16,false);let original=photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px;engine.execute("select.rect",json!({"x":20,"y":10,"width":40,"height":30})).unwrap();let selection=selection_mask(&engine);
            engine.execute("image.crop",json!({"x":20,"y":10,"width":40,"height":30,"deleteCroppedPixels":delete})).unwrap();assert_eq!(engine.active().unwrap().doc.size.width,40);assert_eq!(engine.active().unwrap().doc.size.height,30);assert!(engine.active().unwrap().doc.selection.is_none());let cropped=photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px;
            let outside=photocraft_compose::render(&engine.active().unwrap().doc,photocraft_engine::doc::Rect::new(-20,-10,-19,-9)).px;assert_eq!(outside[0],if delete{[0.0;4]}else{original[0]});
            engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&engine),selection);assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px,original);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,engine.active().unwrap().doc.bounds()).px,cropped);
            let root=std::env::temp_dir().join(format!("xdesign-crop-{}",ulid::Ulid::new()));let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};publish(&root,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=restore(&root,&session.version,None).unwrap();assert_eq!(photocraft_compose::render(&reopened.engine.active().unwrap().doc,photocraft_engine::doc::Rect::new(-20,-10,-19,-9)).px,outside);reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(selection_mask(&reopened.engine),selection);assert_eq!(photocraft_compose::render(&reopened.engine.active().unwrap().doc,reopened.engine.active().unwrap().doc.bounds()).px,original);std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn history_compaction_directory_import_and_independent_copy_preserve_original_versions(){
        use super::*;let root=std::env::temp_dir().join(format!("xdesign-independent-compaction-{}",ulid::Ulid::new()));let source=root.join("source");let child=root.join("child");let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":24,"depth":16,"background":"#509080"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,5],[16,12]],"size":5,"seed":3})).unwrap();let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};publish(&source,&ulid::Ulid::new().to_string(),&mut session).unwrap();let path=source.join(format!("{}.pcraft",session.version));let original=bundle::portable_bytes(&path,MAX_INPUT_BYTES as usize).unwrap();
        for legacy in [true,false]{if legacy{std::fs::remove_dir_all(&path).unwrap();std::fs::write(&path,&original).unwrap();}else{let plan=bundle::compaction::plan(&source,&session.version).unwrap();bundle::compaction::apply(&source,&plan).unwrap();}
            let imported=import_image_path(&path,None).unwrap();assert!(imported.warnings.is_empty());assert_eq!(photocraft_compose::render(&imported.document,imported.document.bounds()).px,photocraft_compose::render(&session.engine.active().unwrap().doc,session.engine.active().unwrap().doc.bounds()).px);let mut copy=Session::new();copy.add_document(imported.document,None);copy.execute("paint.stroke",json!({"points":[[8,8]],"size":7,"color":"#20b0c0","seed":7})).unwrap();let mut independent=PhotoSession{engine:copy,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};publish(&child,&ulid::Ulid::new().to_string(),&mut independent).unwrap();assert_eq!(photocraft_compose::render(&restore(&source,&session.version,None).unwrap().engine.active().unwrap().doc,session.engine.active().unwrap().doc.bounds()).px,photocraft_compose::render(&session.engine.active().unwrap().doc,session.engine.active().unwrap().doc.bounds()).px);assert_eq!(bundle::portable_bytes(&path,MAX_INPUT_BYTES as usize).unwrap(),original);
        }
        std::fs::write(path.join("foreign"),b"retain").unwrap();assert!(import_image_path(&path,None).is_err());assert_eq!(std::fs::read(path.join("foreign")).unwrap(),b"retain");std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn desktop_stroke_preview_retains_history_brush_sources_and_isolates_other_tools(){
        let _guard = crate::xdesign_photo::feedback_serial();
        use super::*;
        let mut source=Session::new();source.execute("file.new",serde_json::json!({"width":32,"height":32,"background":"#905080"})).unwrap();
        source.execute("paint.stroke",serde_json::json!({"points":[[4,8],[27,8]],"size":9,"color":"#20b0c0","seed":31})).unwrap();
        let state=source.active().unwrap().clone();let before=state.doc.clone();let count=state.history.past_len();let selected=history::describe(&source)[0]["id"].clone();
        let params=serde_json::json!({"historySource":selected,"points":[[8,8],[20,8]],"size":9,"seed":771});
        let preview=stroke_preview_session(state.clone(),"paint.historyBrush").unwrap();assert_eq!(preview.active().unwrap().history.past_len(),count);
        assert!(std::sync::Arc::ptr_eq(&history::resolve(&source,&params).unwrap().doc,&history::resolve(&preview,&params).unwrap().doc));
        let identity=format!("desktop-history-preview-{}",ulid::Ulid::new());let feedback=stroke::render_with_identity(&preview,Some(&identity),"paint.historyBrush",&params,0,0,32,32,1).unwrap();
        let mut expected=stroke_preview_session(state.clone(),"paint.historyBrush").unwrap();expected.execute("paint.historyBrush",history::normalize(&expected,"paint.historyBrush",params.clone()).unwrap()).unwrap();
        assert_eq!(feedback[0].png,tiles::render(&expected.active().unwrap().doc,Some(&state.channel_view),0,0,32,32,1,false,true).unwrap().png);
        assert!(std::sync::Arc::ptr_eq(&before,&source.active().unwrap().doc));assert_eq!(source.active().unwrap().history.past_len(),count);assert!(preview.journal.is_empty());stroke::release(&identity,771).unwrap();
        let other=stroke_preview_session(state,"paint.cloneStamp").unwrap();assert_eq!(other.active().unwrap().history.past_len(),0);assert!(history::resolve(&other,&params).is_err());
    }
    use super::*;

    #[test]
    fn raw_develop_options_are_closed_bounded_and_keep_default_import_path() {
        assert_eq!(raw_develop_settings(None).unwrap(),None);
        assert_eq!(raw_develop_settings(Some(json!({"exposure":0,"orient":true}))).unwrap(),Some(RawDevelopSettings{exposure:0.0,orient:true}));
        assert_eq!(raw_develop_settings(Some(json!({"exposure":-5,"orient":false}))).unwrap(),Some(RawDevelopSettings{exposure:-5.0,orient:false}));
        assert!(raw_develop_settings(Some(json!({"exposure":5.01,"orient":true}))).is_err());
        assert!(raw_develop_settings(Some(json!({"exposure":"1","orient":true}))).is_err());
        assert!(raw_develop_settings(Some(json!({"exposure":1,"orient":1}))).is_err());
        assert!(raw_develop_settings(Some(json!({"exposure":1,"orient":true,"demosaic":"bilinear"}))).is_err());
    }

    #[test]
    fn raw_options_require_recognized_raw_bytes_and_do_not_change_plain_import() {
        let root=std::env::temp_dir().join(format!("xdesign-raw-options-{}",ulid::Ulid::new()));std::fs::create_dir_all(&root).unwrap();
        let path=root.join("not-a-camera.dng");std::fs::write(&path,b"not a camera raw").unwrap();
        let settings=RawDevelopSettings{exposure:1.5,orient:false};
        assert!(import_image_path(&path,Some(settings)).unwrap_err().contains("recognized camera RAW"));
        assert!(import_image_path(&path,None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn raw_plain_png_import_without_raw_options_matches_the_pinned_io_default() {
        let root=std::env::temp_dir().join(format!("xdesign-plain-png-{}",ulid::Ulid::new()));std::fs::create_dir_all(&root).unwrap();
        let path=root.join("plain.png");
        let image=photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgba,vec![255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255]).unwrap();
        let bytes=photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).unwrap();std::fs::write(&path,&bytes).unwrap();
        let expected=photocraft_io::import("plain.png",&bytes).unwrap();let actual=import_image_path(&path,None).unwrap();
        let bounds=expected.document.bounds();
        assert_eq!(photocraft_compose::render(&expected.document,bounds).px,photocraft_compose::render(&actual.document,bounds).px);
        assert_eq!(expected.warnings,actual.warnings);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn raw_options_import(bytes:&[u8],exposure:f64,orient:bool)->Result<photocraft_io::ImportResult,photocraft_io::IoError>{
        fn defaults<T:Default,R>(_:fn(&str,&[u8],&T)->Result<R,photocraft_io::IoError>)->T{T::default()}
        let mut options=defaults(photocraft_io::raw::import_raw_with);
        options.exposure=exposure;options.orient=orient;
        let limits=photocraft_codecs::Limits::default();
        options.limits.max_width=limits.max_width;options.limits.max_height=limits.max_height;options.limits.max_pixels=limits.max_pixels;options.limits.max_alloc=limits.max_alloc;
        photocraft_io::raw::import_raw_with("sensor.dng",bytes,&options)
    }

    fn assert_import_pixels_equal(left:&photocraft_io::ImportResult,right:&photocraft_io::ImportResult){
        assert_eq!(left.document.size,right.document.size);
        assert_eq!(left.document.mode,right.document.mode);
        assert_eq!(left.document.depth,right.document.depth);
        assert_eq!(left.document.icc_profile,right.document.icc_profile);
        assert_eq!(photocraft_compose::render(&left.document,left.document.bounds()).px,photocraft_compose::render(&right.document,right.document.bounds()).px);
    }

    fn tiny_jpeg_preview()->Vec<u8>{
        let image=photocraft_codecs::Image::from_u8(2,2,photocraft_codecs::ChannelLayout::Rgb,vec![240,20,30,20,220,40,15,30,230,220,210,25]).unwrap();
        photocraft_codecs::encode(&image,photocraft_codecs::Format::Jpeg,&Default::default()).unwrap()
    }

    #[test]
    fn raw_generated_dng_defaults_exposure_orientation_match_public_io_importers(){
        use super::*;
        let bytes=super::raw_fixture::dng(false,6,&tiny_jpeg_preview());
        assert!(photocraft_io::raw::is_raw(&bytes));
        let root=std::env::temp_dir().join(format!("xdesign-generated-dng-{}",ulid::Ulid::new()));std::fs::create_dir_all(&root).unwrap();
        let path=root.join("sensor.dng");std::fs::write(&path,&bytes).unwrap();
        let pinned_default=photocraft_io::raw::import_raw("sensor.dng",&bytes).unwrap();
        let default=import_image_path(&path,None).unwrap();
        let explicit_default=import_image_path(&path,Some(RawDevelopSettings{exposure:0.0,orient:true})).unwrap();
        assert_import_pixels_equal(&pinned_default,&default);assert_import_pixels_equal(&pinned_default,&explicit_default);
        assert_eq!(default.warnings,pinned_default.warnings);assert_eq!(explicit_default.warnings,pinned_default.warnings);assert_eq!((default.document.size.width,default.document.size.height),(6,8));
        assert_eq!(default.document.depth,photocraft_engine::doc::SampleType::U16);assert!(default.document.icc_profile.is_some());
        assert!(!default.warnings.iter().any(|warning|warning.contains("embedded")&&warning.contains("preview")));

        for (exposure,orient) in [(1.25,true),(-1.25,false)]{
            let expected=raw_options_import(&bytes,exposure,orient).unwrap();
            let baseline=raw_options_import(&bytes,0.0,orient).unwrap();
            assert_ne!(photocraft_compose::render(&baseline.document,baseline.document.bounds()).px,photocraft_compose::render(&expected.document,expected.document.bounds()).px);
            let actual=import_image_path(&path,Some(RawDevelopSettings{exposure,orient})).unwrap();
            assert_import_pixels_equal(&expected,&actual);
            assert!(actual.warnings.iter().any(|warning|warning.contains(&format!("{exposure:+} EV exposure"))));
            assert!(!actual.warnings.iter().any(|warning|warning.contains("developed with default settings")));
            assert_eq!((actual.document.size.width,actual.document.size.height),if orient{(6,8)}else{(8,6)});
        }
        assert_eq!(std::fs::read(&path).unwrap(),bytes);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn raw_generated_unsupported_dng_keeps_default_preview_and_rejects_sensor_options(){
        use super::*;
        let bytes=super::raw_fixture::dng(true,6,&tiny_jpeg_preview());
        let root=std::env::temp_dir().join(format!("xdesign-generated-dng-fallback-{}",ulid::Ulid::new()));std::fs::create_dir_all(&root).unwrap();
        let path=root.join("sensor.dng");std::fs::write(&path,&bytes).unwrap();
        let expected=photocraft_io::raw::import_raw("sensor.dng",&bytes).unwrap();
        let actual=import_image_path(&path,None).unwrap();let explicit_default=import_image_path(&path,Some(RawDevelopSettings{exposure:0.0,orient:true})).unwrap();assert_import_pixels_equal(&expected,&actual);assert_import_pixels_equal(&expected,&explicit_default);
        assert!(actual.warnings.iter().any(|warning|warning.contains("embedded")&&warning.contains("not the raw sensor data")));
        assert_eq!(actual.warnings,expected.warnings);assert_eq!(explicit_default.warnings,expected.warnings);
        assert!(import_image_path(&path,Some(RawDevelopSettings{exposure:1.0,orient:true})).unwrap_err().contains("only provides an embedded JPEG preview"));
        assert!(import_image_path(&path,Some(RawDevelopSettings{exposure:0.0,orient:false})).unwrap_err().contains("only provides an embedded JPEG preview"));
        assert_eq!(std::fs::read(&path).unwrap(),bytes);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn smart_filter_mask_reply_and_render_track_explicit_enabled_state(){
        fn rendered(session:&PhotoSession)->Vec<[f32;4]>{photocraft_compose::render(&session.engine.active().unwrap().doc,session.engine.active().unwrap().doc.bounds()).px}
        fn metadata(session:&PhotoSession,photo:&str)->PhotoReply{reply(std::path::Path::new("/tmp"),photo,session,Vec::new()).unwrap()}
        let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":24,"background":"white"})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[3,12],[20,12]],"size":5,"color":"#ff0000"})).unwrap();
        engine.execute("layer.smartObjects.convertToSmartObject",json!({})).unwrap();
        engine.execute("select.rect",json!({"x":0,"y":0,"width":8,"height":24})).unwrap();
        engine.execute("filter.blur.gaussianBlur",json!({"radius":3})).unwrap();
        let layer=engine.active().unwrap().active_layer.unwrap();
        let mut session=PhotoSession{engine,color_settings:None,version:ulid::Ulid::new().to_string(),original_path:None,writer:Default::default()};
        let mask=session.engine.active().unwrap().doc.layer(layer).and_then(|layer|match &layer.content{photocraft_engine::doc::LayerContent::Smart(smart)=>smart.filter_mask.as_ref(),_=>None}).expect("the selection creates a smart-filter mask");
        assert!(mask.enabled);
        let filtered=rendered(&session);
        let photo=ulid::Ulid::new().to_string();
        let enabled=metadata(&session,&photo);
        assert_eq!(enabled.state["layers"][0]["smartObject"]["hasFilterMask"],true);
        assert_eq!(enabled.state["layers"][0]["smartObject"]["filterMaskEnabled"],true);
        session.engine.execute("layer.smartFilter.disableFilterMask",json!({"layer":layer.0,"enabled":false})).unwrap();
        let disabled_pixels=rendered(&session);assert_ne!(filtered,disabled_pixels);
        let disabled=metadata(&session,&photo);
        assert_eq!(disabled.state["layers"][0]["smartObject"]["hasFilterMask"],true);
        assert_eq!(disabled.state["layers"][0]["smartObject"]["filterMaskEnabled"],false);
        session.engine.execute("layer.smartFilter.disableFilterMask",json!({"layer":layer.0,"enabled":true})).unwrap();
        assert_eq!(rendered(&session),filtered);
        let reenabled=metadata(&session,&photo);
        assert_eq!(reenabled.state["layers"][0]["smartObject"]["filterMaskEnabled"],true);
        session.engine.execute("layer.smartFilter.deleteFilterMask",json!({"layer":layer.0})).unwrap();
        let absent=metadata(&session,&photo);
        assert_eq!(absent.state["layers"][0]["smartObject"]["hasFilterMask"],false);
        assert_eq!(absent.state["layers"][0]["smartObject"]["filterMaskEnabled"],false);
    }

    #[test]
    fn native_colors_reply_retains_full_values_without_touching_document_history() {
        let mut engine=Session::new();
        engine.execute("file.new",json!({"width":8,"height":8,"depth":32})).unwrap();
        engine.execute("tools.setColors",json!({"foreground":[0.123456,1.2,0.4,0.75],"background":[0.7,0.3,0.9,0.5]})).unwrap();
        let (expected,original,undo)=(tools::colors(&engine),engine.active().unwrap().doc.clone(),engine.active().unwrap().history.past_len());
        let session=PhotoSession{engine,color_settings:None,version:ulid::Ulid::new().to_string(),original_path:None,writer:Default::default()};
        let response=reply(std::path::Path::new("/tmp"),&ulid::Ulid::new().to_string(),&session,Vec::new()).unwrap();
        assert_eq!(response.state["tools"],expected);
        assert!(std::sync::Arc::ptr_eq(&original,&session.engine.active().unwrap().doc));
        assert_eq!(undo,session.engine.active().unwrap().history.past_len());
    }

    #[test]
    fn native_colors_and_tool_presets_do_not_fail_after_profile_save_when_image_view_is_unwritable() {
        let root=std::env::temp_dir().join(format!("orion-color-view-failure-{}",ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let view=root.join("image-view");std::fs::write(&view,b"retained image view boundary").unwrap();
        let profile=root.join("tools");let mut engine=Session::new();tools::activate(&profile,&mut engine).unwrap();
        engine.execute("file.new",json!({"width":16,"height":16,"depth":16})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[4,4],[12,12]],"size":4,"seed":9})).unwrap();
        tools::execute(&profile,&mut engine,"tool.presets.new",|engine|engine.execute("tool.presets.new",json!({"name":"View independent","tool":"brush","options":{"foreground":[1,0,0,1],"background":[0,1,1,1]}})).map_err(|error|error.to_string())).unwrap();
        let mut session=PhotoSession{engine,color_settings:None,version:ulid::Ulid::new().to_string(),original_path:None,writer:Default::default()};
        let original=session.engine.active().unwrap().doc.clone();let undo=session.engine.active().unwrap().history.past_len();
        assert!(save_view(&view,&session).is_err());
        for (command,params) in [("tools.setColors",json!({"foreground":"#123456"})),("tools.swapColors",json!({})),("tools.defaultColors",json!({})),("tool.presets.select",json!({"preset":"View independent"}))] {
            let (_,warnings)=tools::execute(&profile,&mut session.engine,command,|engine|engine.execute(command,params).map_err(|error|error.to_string())).unwrap();assert!(warnings.is_empty());
            save_command_view(&view,&session,command).unwrap();
            let response=reply(&view,&ulid::Ulid::new().to_string(),&session,Vec::new()).unwrap();assert_eq!(response.state["tools"],tools::colors(&session.engine));
            assert!(std::sync::Arc::ptr_eq(&original,&session.engine.active().unwrap().doc));assert_eq!(undo,session.engine.active().unwrap().history.past_len());
        }
        assert!(profile.join("colors.json").is_file());assert_eq!(std::fs::read(&view).unwrap(),b"retained image view boundary");std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsupported_imported_adjustments_are_preserved_and_never_labeled_as_invert() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":16,"height":16})).unwrap();
        let active = engine.active().unwrap().active_layer.unwrap();
        std::sync::Arc::make_mut(&mut engine.active_mut().unwrap().doc).layer_mut(active).unwrap().content = photocraft_engine::doc::LayerContent::Adjustment(photocraft_engine::doc::Adjustment::Unsupported { psd_key: "test".into(), raw: vec![1, 2, 3, 4] });
        let session = PhotoSession { engine,color_settings:None, version: ulid::Ulid::new().to_string(), original_path: None, writer: Default::default() };
        let metadata = reply(std::path::Path::new("/tmp"), &ulid::Ulid::new().to_string(), &session, Vec::new()).unwrap();
        assert_eq!(metadata.state["layers"][0]["adjustmentKind"], "unsupported");
        assert_eq!(metadata.state["layers"][0]["adjustment"]["Unsupported"]["raw"], json!([1, 2, 3, 4]));
    }

    #[test]
    fn document_operations_do_not_expose_engine_file_or_script_commands() {
        for command in [
            "file.open",
            "file.save",
            "file.close",
            "file.scripts.browse",
            "session.inspect",
            "edit.preferences.general",
        ] {
            assert!(!command_supported(command));
        }
        for command in [
            "paint.stroke",
            "select.rect",
            "layer.layerMask.revealAll",
            "filter.blur.gaussianBlur",
            "edit.undo",
            "edit.redo",
            "edit.fade",
            "history.select",
            "history.fold",
        ] {
            assert!(command_supported(command));
        }
    }

    #[test]
    fn command_supported_allows_edit_menu_items() {
        for command in [
            "edit.purge.clipboard",
            "edit.purge.histories",
            "edit.purge.all",
            "edit.defineBrushPreset",
            "edit.definePattern",
            "edit.defineCustomShape",
            "edit.presets.presetManager",
            "edit.findAndReplaceText",
            "edit.checkSpelling",
        ] {
            assert!(command_supported(command), "{command}");
        }
        for command in [
            "edit.purge.undo",
            "edit.purge.videoCache",
            "edit.presets.exportImportPresets",
            "edit.presets.migratePresets",
            "edit.toggleLastState",
        ] {
            assert!(!command_supported(command), "{command}");
        }
    }

    #[test]
    fn command_supported_allows_edit_auto_and_content_aware_fill() {
        for command in ["edit.autoAlignLayers", "edit.autoBlendLayers", "edit.contentAwareFill"] {
            assert!(command_supported(command), "{command}");
        }
    }

    #[test]
    fn command_supported_allows_analysis_tools() {
        for command in ["image.analysis.rulerTool", "image.analysis.straightenLayer", "count.add", "count.remove", "count.move", "count.clear", "count.newGroup", "count.deleteGroup", "count.setGroup", "notes.add", "notes.set", "notes.delete", "slice.new", "slice.set", "slice.promote", "slice.delete", "slice.divide"] {
            assert!(command_supported(command), "{command}");
        }
    }

    #[test]
    fn command_supported_allows_view_slice_commands() {
        for command in ["view.lockSlices", "view.clearSlices"] {
            assert!(command_supported(command), "{command}");
        }
        // Guides are frontend view state, so the engine's guide commands stay out.
        for command in ["view.clearGuides", "view.clearCanvasGuides", "view.clearSelectedArtboardGuides"] {
            assert!(!command_supported(command), "{command}");
        }
    }

    #[test]
    fn command_supported_allows_file_commands() {
        for command in ["file.fileInfo", "file.scripts.deleteAllEmptyLayers", "file.scripts.flattenAllLayerEffects", "file.scripts.flattenAllMasks", "file.export.colorLookupTables", "file.export.pathsToIllustrator", "file.export.layersToFiles", "file.export.artboardsToPdf"] {
            assert!(command_supported(command), "{command}");
        }
        // The engine's versions call its own image.imageSize and image.mode.*, skipping the host's; the
        // dialogs send those host-handled commands instead.
        for command in ["file.automate.fitImage", "file.automate.conditionalModeChange", "file.automate.batch", "file.scripts.browse", "file.automate.runDroplet", "file.automate.createDroplet", "file.scripts.scriptEventsManager", "file.closeAll", "file.closeOthers", "file.package"] {
            assert!(!command_supported(command), "{command}");
        }
    }

    #[test]
    fn command_supported_allows_panel_commands() {
        for command in ["layerComp.new", "layerComp.update", "layerComp.apply", "layerComp.previous", "layerComp.next", "layerComp.delete", "layerComp.duplicate", "layerComp.setOptions", "layerComp.restoreLastDocumentState", "layerComp.updateWarnings", "image.analysis.recordMeasurements", "image.analysis.selectDataPoints", "measurementLog.delete", "measurementLog.export", "cloneSource.overlay", "type.characterStyle.new", "type.characterStyle.apply", "type.characterStyle.redefine", "type.characterStyle.clearOverride", "type.paragraphStyle.set", "type.paragraphStyle.delete", "type.paragraphStyle.duplicate"] {
            assert!(command_supported(command), "{command}");
        }
    }

    #[test]
    fn panels_state_matches_the_engine_lists() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 100, "height": 80})).unwrap();
        let layer = engine.execute("type.create", json!({"x": 10, "y": 50, "text": "Hello world", "size": 12})).unwrap()["layer"].as_u64().unwrap();
        let cs = engine.execute("type.characterStyle.new", json!({"name": "Title", "attrs": {"size": 30}, "fromSelection": false})).unwrap()["id"].clone();
        engine.execute("type.characterStyle.apply", json!({"id": cs, "layer": layer})).unwrap();
        engine.execute("type.paragraphStyle.new", json!({"name": "Body", "apply": true})).unwrap();
        engine.execute("type.setStyle", json!({"layer": layer, "range": [0, 5], "italic": true})).unwrap();
        engine.execute("layerComp.new", json!({"name": "A", "position": false, "comment": "c"})).unwrap();
        engine.execute("image.analysis.rulerTool", json!({"start": [0, 0], "end": [30, 40]})).unwrap();
        engine.execute("image.analysis.recordMeasurements", json!({"source": "ruler"})).unwrap();
        let state = panels_state(&engine);
        let comps = engine.execute("layerComp.list", json!({})).unwrap();
        assert_eq!(state["layerComps"]["comps"][0], json!({"id": comps["comps"][0]["id"], "name": "A", "comment": "c", "visibility": true, "position": false, "appearance": true, "missingLayers": 0}));
        assert_eq!(state["layerComps"]["lastApplied"], comps["lastApplied"]);
        assert_eq!(state["layerComps"]["hasLastDocumentState"], comps["hasLastDocumentState"]);
        let log = engine.execute("measurementLog.list", json!({})).unwrap();
        assert_eq!(state["measurementLog"]["rows"], log["rows"]);
        assert_eq!(state["measurementLog"]["columns"].as_array().unwrap().iter().map(|c| c["key"].clone()).collect::<Vec<_>>(), log["columns"].as_array().unwrap().clone());
        assert!(state["measurementLog"]["columns"].as_array().unwrap().contains(&json!({"key": "length", "name": "Length"})));
        assert_eq!(state["measurementLog"]["available"]["ruler"].as_array().unwrap().last().unwrap(), &json!({"key": "angle", "name": "Angle"}));
        let character = engine.execute("type.characterStyle.list", json!({})).unwrap();
        let paragraph = engine.execute("type.paragraphStyle.list", json!({})).unwrap();
        assert_eq!(state["textStyles"]["current"], character["current"]);
        assert_eq!(state["textStyles"]["current"], json!({"character": cs, "characterOverride": true, "paragraph": paragraph["styles"][1]["id"], "paragraphOverride": false}));
        assert_eq!(state["textStyles"]["character"][0]["name"], character["styles"][0]["name"]);
        assert_eq!(state["textStyles"]["character"][1], character["styles"][1]);
        assert_eq!(state["textStyles"]["paragraph"], paragraph["styles"]);
        engine.execute("layer.new.layer", json!({})).unwrap();
        assert_eq!(panels_state(&engine)["textStyles"]["current"], Value::Null);
    }

    #[test]
    fn analysis_state_reports_ruler_counts_notes_and_slices() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 100, "height": 80})).unwrap();
        engine.execute("image.analysis.rulerTool", json!({"start": [10, 10], "end": [40, 50]})).unwrap();
        engine.execute("count.add", json!({"x": 5, "y": 6})).unwrap();
        engine.execute("notes.add", json!({"x": 20, "y": 30, "text": "fix", "author": "QA"})).unwrap();
        engine.execute("slice.new", json!({"rect": [10, 10, 30, 20]})).unwrap();
        let state = analysis_state(&engine);
        assert_eq!(state["ruler"]["info"]["l1"], json!(50.0));
        assert_eq!(state["count"]["groups"][0]["points"], json!([[5.0, 6.0]]));
        assert_eq!(state["notes"][0]["text"], json!("fix"));
        let slices = state["slices"].as_array().unwrap();
        assert!(slices.iter().any(|s| s["origin"] == "user" && s["rect"] == json!([10, 10, 30, 20])), "{slices:?}");
        assert_eq!(state["slicesLocked"], json!(false));
        engine.execute("edit.undo", json!({})).unwrap();
        assert!(analysis_state(&engine)["slices"].as_array().unwrap().iter().all(|s| s["origin"] == "auto"));
    }

    #[test]
    fn command_supported_allows_warp_split_and_grid() {
        for command in ["edit.transform.splitWarpCrosswise", "edit.transform.splitWarpVertically", "edit.transform.splitWarpHorizontally", "edit.transform.removeWarpSplit", "edit.transform.warpGrid"] {
            assert!(command_supported(command), "{command}");
        }
    }

    #[test]
    fn pen_and_shape_tool_payloads_create_shapes_paths_and_selections() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":32})).unwrap();
        let path=json!({"subpaths":[{"closed":true,"knots":[[2,2],{"anchor":[16,20],"in":[10,24],"out":[22,16],"smooth":true},[28,4]]}]});
        for params in [json!({"kind":"rect","rect":[2,3,10,8],"fill":"#ff0000"}),json!({"kind":"ellipse","rect":[4,4,12,6],"fill":[0.2,0.4,0.6,1.0]}),json!({"kind":"line","from":[1,1],"to":[20,9],"weight":4,"fill":"#00ff00"}),json!({"kind":"path","path":path,"fill":"#0000ff"})]{
            let layers=engine.active().unwrap().doc.layers.len();execute_view_command(&mut engine,"shape.create",params).unwrap();assert_eq!(engine.active().unwrap().doc.layers.len(),layers+1);
        }
        execute_view_command(&mut engine,"path.set",json!({"name":"work","path":path})).unwrap();
        let state=|engine:Session|{let session=PhotoSession{engine,color_settings:None,version:ulid::Ulid::new().to_string(),original_path:None,writer:Default::default()};let state=reply(std::path::Path::new("/tmp"),&ulid::Ulid::new().to_string(),&session,Vec::new()).unwrap().state;(state,session.engine)};
        let (paths,mut engine)=state(engine);assert_eq!(paths["paths"],json!({"saved":[],"work":true}));
        execute_view_command(&mut engine,"path.rename",json!({"name":"work","to":"Path 1"})).unwrap();
        execute_view_command(&mut engine,"path.toSelection",json!({"name":"Path 1"})).unwrap();
        let (paths,_)=state(engine);assert_eq!(paths["paths"],json!({"saved":["Path 1"],"work":false}));assert_eq!(paths["hasSelection"],true);
    }

    #[test]
    fn transform_selection_quad_moves_and_scales_the_selection() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":48})).unwrap();
        execute_view_command(&mut engine,"select.rect",json!({"x":10,"y":10,"width":20,"height":10})).unwrap();
        execute_view_command(&mut engine,"select.transformSelection",json!({"rect":[10,10,30,20],"quad":[[20,15],[60,15],[60,35],[20,35]]})).unwrap();
        let bounds=engine.active().unwrap().doc.selection.as_ref().unwrap().content_bounds();
        // Bilinear resampling softens one pixel around the transformed edge.
        for (actual,expected) in [(bounds.x0,20),(bounds.y0,15),(bounds.x0+bounds.width() as i32,60),(bounds.y0+bounds.height() as i32,35)]{assert!((actual-expected).abs()<=1,"{actual} vs {expected}");}
    }

    #[test]
    fn rotated_crop_straightens_the_box_contents() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":40,"height":30,"background":"#000000"})).unwrap();
        for (x,y,color) in [(20,15,"#ff0000"),(20,18,"#00ff00")]{engine.execute("paint.pencil",json!({"points":[[x,y]],"size":1,"color":color})).unwrap();}
        let pixel=|engine:&mut Session,x:i32,y:i32|serde_json::from_value::<Vec<f32>>(engine.execute("document.pixel",json!({"x":x,"y":y})).unwrap()).unwrap();
        execute_view_command(&mut engine,"image.cropRotated",json!({"x":15,"y":10,"width":11,"height":11,"angle":90})).unwrap();
        assert_eq!([engine.active().unwrap().doc.size.width,engine.active().unwrap().doc.size.height],[11,11]);
        let center=pixel(&mut engine,5,5);assert!(center[0]>0.9&&center[1]<0.1,"{center:?}");
        let moved=pixel(&mut engine,8,5);assert!(moved[1]>0.9&&moved[0]<0.1,"{moved:?}");
        assert!(execute_view_command(&mut engine,"image.cropRotated",json!({"x":0,"y":0,"width":0,"height":4,"angle":10})).is_err());
    }

    #[test]
    fn match_color_reads_the_second_document_as_its_source() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":8,"height":8,"background":"#806040"})).unwrap();
        let mut source=Session::new();source.execute("file.new",json!({"width":8,"height":8,"background":"#2060c0"})).unwrap();
        let before=engine.active().unwrap().doc.clone();
        engine.add_document((*source.active().unwrap().doc).clone(),None);engine.set_active(0);
        execute_view_command(&mut engine,"image.adjustments.matchColor",json!({"source":1})).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        let pixel:Vec<f32>=serde_json::from_value(engine.execute("document.pixel",json!({"x":2,"y":2})).unwrap()).unwrap();assert!(pixel[2]>pixel[0],"{pixel:?}");
    }

    #[test]
    fn layer_thumbnails_render_each_layer_alone_and_skip_adjustments() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":300,"height":200,"background":"#ffffff"})).unwrap();
        engine.execute("layer.new.layer",json!({})).unwrap();engine.execute("paint.stroke",json!({"points":[[20,20],[280,180]],"size":30,"color":"#ff0000","seed":2})).unwrap();
        engine.execute("layer.setProps",json!({"opacity":0.1,"visible":false})).unwrap();
        engine.execute("layer.newAdjustmentLayer.invert",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc.layers.len(),3);
        let doc=engine.active().unwrap().doc.clone();let thumbnails=layer_thumbnails(&doc,48).unwrap();
        let ids:Vec<u64>=thumbnails.iter().map(|thumbnail|thumbnail["layer"].as_u64().unwrap()).collect();
        assert_eq!(ids.len(),2,"{ids:?}");
        for thumbnail in &thumbnails{
            let bytes=base64::Engine::decode(&base64::engine::general_purpose::STANDARD,thumbnail["png"].as_str().unwrap()).unwrap();
            let image=photocraft_codecs::decode(&bytes).unwrap();assert!(image.width()<=48&&image.height()<=48,"{}x{}",image.width(),image.height());
        }
        assert!(thumbnails.iter().all(|thumbnail|thumbnail.get("mask").is_none()));
        engine.execute("layer.layerMask.hideAll",json!({})).unwrap();
        let doc=engine.active().unwrap().doc.clone();let thumbnails=layer_thumbnails(&doc,48).unwrap();
        let adjustment=engine.active().unwrap().active_layer.unwrap().0;
        let masked=thumbnails.iter().find(|thumbnail|thumbnail["layer"]==adjustment).unwrap();
        assert!(masked.get("png").is_none());
        let bytes=base64::Engine::decode(&base64::engine::general_purpose::STANDARD,masked["mask"].as_str().unwrap()).unwrap();
        let mask=photocraft_codecs::decode(&bytes).unwrap();assert!(mask.width()<=48&&mask.height()<=48);assert_eq!(mask.data()[0],0,"Hide All masks read black");
    }

    #[test]
    fn channel_thumbnails_cover_composite_colors_alpha_and_quick_mask() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":300,"height":200,"background":"#ff0000"})).unwrap();
        engine.execute("select.rect",json!({"x":0,"y":0,"width":150,"height":200})).unwrap();engine.execute("select.saveSelection",json!({})).unwrap();
        let doc=engine.active().unwrap().doc.clone();let list=channel_thumbnails(&doc,48).unwrap();
        let pixel=|png:&Value|{let bytes=base64::Engine::decode(&base64::engine::general_purpose::STANDARD,png.as_str().unwrap()).unwrap();let image=photocraft_codecs::decode(&bytes).unwrap();assert!(image.width()<=48&&image.height()<=48);let data=image.data().to_vec();(data[0],data[data.len()-4])};
        assert_eq!(list["colors"].as_array().unwrap().len(),3);
        assert_eq!(pixel(&list["colors"][0]).0,255);assert_eq!(pixel(&list["colors"][1]).0,0);
        assert_eq!(list["alpha"].as_array().unwrap().len(),1);
        let (left,right)=pixel(&list["alpha"][0]);assert_eq!((left,right),(255,0));
        assert!(list["quickMask"].is_null());
    }

    #[test]
    fn layer_thumbnails_give_groups_only_their_mask() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":300,"height":200,"background":"#ffffff"})).unwrap();
        engine.execute("layer.new.layer",json!({})).unwrap();engine.execute("paint.stroke",json!({"points":[[20,20],[280,180]],"size":30,"color":"#ff0000","seed":2})).unwrap();
        let painted=engine.active().unwrap().active_layer.unwrap().0;
        engine.execute("layer.groupLayers",json!({"name":"Group 1"})).unwrap();
        let group=engine.active().unwrap().active_layer.unwrap().0;assert_ne!(group,painted);
        let doc=engine.active().unwrap().doc.clone();let thumbnails=layer_thumbnails(&doc,48).unwrap();
        assert!(thumbnails.iter().all(|thumbnail|thumbnail["layer"]!=group),"{thumbnails:?}");
        assert!(thumbnails.iter().find(|thumbnail|thumbnail["layer"]==painted).unwrap().get("png").is_some());
        engine.execute("layer.layerMask.hideAll",json!({})).unwrap();
        let doc=engine.active().unwrap().doc.clone();let thumbnails=layer_thumbnails(&doc,48).unwrap();
        let masked=thumbnails.iter().find(|thumbnail|thumbnail["layer"]==group).unwrap();
        assert!(masked.get("png").is_none());assert!(masked.get("mask").is_some());
    }

    #[test]
    fn group_folds_and_reveals_are_saved_with_the_view_without_a_new_version() {
        use super::*;
        use photocraft_engine::doc::{LayerContent, LayerId};
        let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":24,"background":"white"})).unwrap();
        engine.execute("layer.new.layer",json!({})).unwrap();
        let inside=engine.active().unwrap().active_layer.unwrap().0;
        let group=engine.execute("layer.groupLayers",json!({"name":"Group 1"})).unwrap()["layer"].as_u64().unwrap();
        engine.execute("layer.new.layer",json!({})).unwrap();
        let dir=std::env::temp_dir().join(format!("orion-group-folds-{}",ulid::Ulid::new()));
        let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
        publish(&dir,"folds",&mut session).unwrap();
        let version=session.version.clone();
        let run=|session:&mut PhotoSession,command:&str,params:Value|{let before=session.engine.active().cloned().unwrap();execute_view_command(&mut session.engine,command,params).unwrap();persist_command(&dir,"folds",session,&before,command).unwrap();};
        let open=|session:&PhotoSession|matches!(&session.engine.active().unwrap().doc.layer(LayerId(group)).unwrap().content,LayerContent::Group(g) if g.expanded);
        run(&mut session,"layer.setGroupsExpanded",json!({"layers":[group],"expanded":false}));
        assert_eq!(session.version,version);
        assert!(!open(&restore(&dir,&version,None).unwrap()));
        run(&mut session,"layer.select",json!({"layer":inside,"target":"pixels"}));
        assert_eq!(session.version,version);assert!(open(&session));
        assert!(open(&restore(&dir,&version,None).unwrap()));
        run(&mut session,"layer.setExpanded",json!({"layer":group,"expanded":false}));
        assert_eq!(session.version,version);
        run(&mut session,"layer.setProps",json!({"layer":inside,"opacity":0.5}));
        assert_ne!(session.version,version);
        assert!(!open(&restore(&dir,&session.version,None).unwrap()),"a published version carries the fold");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn undo_redo_and_history_steps_leave_group_folds_as_they_were() {
        use photocraft_engine::doc::{LayerContent, LayerId};
        let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":24,"background":"white"})).unwrap();
        engine.execute("layer.new.layer",json!({})).unwrap();
        let inside=engine.active().unwrap().active_layer.unwrap().0;
        let group=engine.execute("layer.groupLayers",json!({"name":"Group 1"})).unwrap()["layer"].as_u64().unwrap();
        engine.execute("layer.select",json!({"layer":group})).unwrap();
        let dir=std::env::temp_dir().join(format!("orion-history-folds-{}",ulid::Ulid::new()));
        let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
        publish(&dir,"folds",&mut session).unwrap();
        let run=|session:&mut PhotoSession,command:&str,params:Value|{let before=session.engine.active().cloned().unwrap();execute_view_command(&mut session.engine,command,params).unwrap();persist_command(&dir,"folds",session,&before,command).unwrap();};
        let open=|session:&PhotoSession|matches!(&session.engine.active().unwrap().doc.layer(LayerId(group)).unwrap().content,LayerContent::Group(g) if g.expanded);
        for opacity in [0.5,0.25] { run(&mut session,"layer.setProps",json!({"layer":inside,"opacity":opacity})); }
        run(&mut session,"layer.setExpanded",json!({"layer":group,"expanded":false}));
        run(&mut session,"edit.undo",json!({}));
        assert!(!open(&session),"the step before was taken with the group open");
        run(&mut session,"layer.setExpanded",json!({"layer":group,"expanded":true}));
        run(&mut session,"edit.redo",json!({}));
        assert!(open(&session),"the redone step was left with the group closed");
        run(&mut session,"layer.setExpanded",json!({"layer":group,"expanded":false}));
        let back=session.engine.active().unwrap().history.past_len()-2;
        run(&mut session,"history.select",json!({"index":back}));
        assert!(!open(&session));
        let mut reopened=restore(&dir,&session.version,None).unwrap();
        assert!(!open(&reopened));
        run(&mut reopened,"layer.setExpanded",json!({"layer":group,"expanded":true}));
        run(&mut reopened,"edit.redo",json!({}));
        assert!(open(&reopened),"a step read back from its bundle keeps the folds too");
        assert_eq!(reopened.engine.active().unwrap().active_layer,Some(LayerId(group)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn layer_via_copy_names_a_copy_of_the_background_layer_n_in_one_step() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":8,"height":8,"background":"#ffffff"})).unwrap();
        let background=engine.active().unwrap().active_layer.unwrap().0;
        let name=|engine:&Session|{let state=engine.active().unwrap();state.doc.layer(state.active_layer.unwrap()).unwrap().name.clone()};
        let steps=engine.active().unwrap().history.past_len();
        execute_view_command(&mut engine,"layer.new.layerViaCopy",json!({})).unwrap();
        assert_eq!(name(&engine),"Layer 1");
        assert_eq!(engine.active().unwrap().history.past_len(),steps+1);assert_eq!(engine.active().unwrap().history.undo_label(),Some("Layer Via Copy"));
        execute_view_command(&mut engine,"layer.new.layerViaCopy",json!({})).unwrap();
        assert_eq!(name(&engine),"Layer 1 copy");
        engine.execute("layer.select",json!({"layer":background})).unwrap();
        execute_view_command(&mut engine,"layer.new.layerViaCopy",json!({})).unwrap();
        assert_eq!(name(&engine),"Layer 2");
        engine.execute("edit.undo",json!({})).unwrap();
        assert_eq!(engine.active().unwrap().doc.walk().len(),3);
    }

    #[test]
    fn histograms_read_the_layer_alone_or_the_image_below_an_adjustment() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":40,"height":20,"background":"#ffffff"})).unwrap();
        let background=engine.active().unwrap().active_layer.unwrap().0;
        engine.execute("layer.new.layer",json!({})).unwrap();
        engine.execute("select.rect",json!({"x":0,"y":0,"width":20,"height":20})).unwrap();engine.execute("edit.fill",json!({"color":"#ff0000"})).unwrap();engine.execute("select.deselect",json!({})).unwrap();
        let red=engine.active().unwrap().active_layer.unwrap().0;
        engine.execute("layer.newAdjustmentLayer.invert",json!({})).unwrap();
        let invert=engine.active().unwrap().active_layer.unwrap().0;
        let doc=engine.active().unwrap().doc.clone();
        let below=histograms(&doc,Some(invert),true,"rgb").unwrap();
        assert_eq!(below.len(),4);let total:u32=below[1].iter().sum();
        assert_eq!(below[1][255],total,"red and white both have a full red channel");
        assert_eq!(below[2][0]*2,total,"half the image is the red layer, half the white background");
        assert_eq!(below[0].iter().sum::<u32>(),total*3);assert_eq!(below[0][0],total,"the red half adds its green and blue zeros");
        let luminosity=histograms(&doc,Some(invert),true,"luminosity").unwrap();
        assert_eq!(luminosity.len(),1);assert_eq!(luminosity[0][76]*2,total,"red is 0.299 of white");
        let alone=histograms(&doc,Some(red),false,"rgb").unwrap();
        assert_eq!(alone[2][0],alone[2].iter().sum::<u32>(),"transparent pixels are skipped");
        let white=histograms(&doc,Some(background),false,"lab").unwrap();
        assert_eq!(white.len(),3);assert_eq!(white[0][255],white[0].iter().sum::<u32>());
        assert!(histograms(&doc,Some(u64::MAX),false,"rgb").is_err());
        let under=|x|sample_layer_view(&doc,Some(invert),true,x,5,3,3).unwrap().unwrap().map(f32::round);
        assert_eq!(under(5),[255.0,0.0,0.0],"the red layer, without the invert above it");assert_eq!(under(30),[255.0;3]);
        assert_eq!(sample_layer_view(&doc,None,false,5,5,1,1).unwrap().unwrap().map(f32::round),[0.0,255.0,255.0],"the composite includes the invert");
        assert_eq!(sample_layer_view(&doc,Some(red),false,30,5,1,1).unwrap(),None,"transparent pixels have no colour");
        assert_eq!(sample_layer_view(&doc,Some(red),false,18,5,9,1).unwrap().unwrap().map(f32::round),[255.0,0.0,0.0],"only covered pixels count");
        assert!(sample_layer_view(&doc,None,false,40,0,1,1).is_err());
        let mut trimmed=doc.clone();assert!(hide_above(&mut std::sync::Arc::make_mut(&mut trimmed).layers,photocraft_engine::doc::LayerId(red)));
        assert_eq!(sample_layer_view(&trimmed,None,false,5,5,1,1).unwrap().unwrap().map(f32::round),[255.0,0.0,0.0],"Current & Below drops the invert above the red layer");
        assert!(!hide_above(&mut std::sync::Arc::make_mut(&mut trimmed).layers,photocraft_engine::doc::LayerId(u64::MAX)));
        let pixels=tone_pixels(&doc,Some(invert),true,20).unwrap();
        assert_eq!(&pixels[..8],&[20,0,0,0,10,0,0,0]);assert_eq!(pixels.len(),8+20*10*4);
        assert_eq!(&pixels[8..12],&[255,0,0,255],"the red layer, without the invert above it");
    }

    #[test]
    fn path_editor_round_trips_paths_and_shape_layers() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":64})).unwrap();
        execute_view_command(&mut engine,"path.set",json!({"name":"work","path":{"subpaths":[{"closed":false,"knots":[[4,4],[40,10]]}]}})).unwrap();
        let mut path=execute_view_command(&mut engine,"path.info",json!({"name":"work"})).unwrap()["path"].clone();
        assert_eq!(path["subpaths"][0]["knots"][1]["anchor"],json!([40.0,10.0]));
        path["subpaths"][0]["knots"][1]=json!({"anchor":[50,20],"in":[45,20],"out":[55,20],"smooth":true});
        execute_view_command(&mut engine,"path.set",json!({"name":"work","path":path})).unwrap();
        execute_view_command(&mut engine,"path.transform",json!({"name":"work","translateX":3,"translateY":4})).unwrap();
        let moved=execute_view_command(&mut engine,"path.info",json!({"name":"work"})).unwrap();
        assert_eq!(moved["path"]["subpaths"][0]["knots"][1]["anchor"],json!([53.0,24.0]));assert_eq!(moved["path"]["subpaths"][0]["knots"][1]["in"],json!([48.0,24.0]));
        execute_view_command(&mut engine,"shape.create",json!({"kind":"rect","rect":[10,10,20,20],"fill":"#ff0000"})).unwrap();
        let layer=engine.active().unwrap().active_layer.unwrap().0;
        let mut shape=execute_view_command(&mut engine,"path.info",json!({"name":"layer"})).unwrap()["path"].clone();
        shape["subpaths"][0]["knots"][0]["anchor"]=json!([5,5]);
        execute_view_command(&mut engine,"shape.edit",json!({"layer":layer,"path":shape})).unwrap();
        execute_view_command(&mut engine,"shape.edit",json!({"layer":layer,"move":[2,3]})).unwrap();
        let edited=execute_view_command(&mut engine,"path.info",json!({"name":"layer"})).unwrap();
        assert_eq!(edited["path"]["subpaths"][0]["knots"][0]["anchor"],json!([7.0,8.0]));
    }

    #[test]
    fn avif_export_encodes_with_the_requested_quality() {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":24,"background":"#3080c0"})).unwrap();
        let doc=engine.active().unwrap().doc.clone();let mut options=photocraft_io::ExportOptions::default();
        let high=photocraft_io::export(&doc,"avif",&options).unwrap().bytes;
        options.encode.jpeg_quality=20;let low=photocraft_io::export(&doc,"avif",&options).unwrap().bytes;
        assert_eq!(&high[4..8],b"ftyp");assert_eq!(&low[4..8],b"ftyp");assert!(low.len()<=high.len());
    }

    #[test]
    fn content_aware_scale_runs_through_the_host() {
        use super::*;
        assert!(command_supported("edit.contentAwareScale"));
        let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":16,"background":"transparent"})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[2,8],[21,8]],"size":5,"color":"#20b0c0","seed":3})).unwrap();
        let before=engine.active().unwrap().doc.clone();
        execute_view_command(&mut engine,"edit.contentAwareScale",json!({"scaleX":50,"amount":100})).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));
    }

    #[test]
    fn layer_state_reports_vector_mask_enable_and_link_for_the_layer_menu() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":16,"height":16,"background":"#905080"})).unwrap();
        for (id,params) in [("layer.new.layer",json!({})),("layer.vectorMask.revealAll",json!({})),("layer.vectorMask.enabled",json!({"enabled":false})),("layer.vectorMask.linked",json!({"linked":false}))] {
            assert!(command_supported(id));execute_view_command(&mut engine,id,params).unwrap();
        }
        let session=PhotoSession{engine,color_settings:None,version:ulid::Ulid::new().to_string(),original_path:None,writer:Default::default()};
        let state=reply(std::path::Path::new("/tmp"),&ulid::Ulid::new().to_string(),&session,Vec::new()).unwrap().state;
        assert_eq!(state["layers"][0]["vectorMask"],json!({"enabled":false,"linked":false}));
        assert!(state["layers"][1].get("vectorMask").is_none());
    }

    #[test]
    fn image_undo_redo_and_history_jumps_run_through_the_host() {
        use super::*;
        let mut engine=Session::new();engine.execute("file.new",json!({"width":16,"height":16,"background":"#905080"})).unwrap();
        for y in [4,10]{engine.execute("paint.stroke",json!({"points":[[2,y],[13,y]],"size":3,"color":"#20b0c0","seed":7})).unwrap();}
        let docs=[engine.active().unwrap().history.state(0).unwrap(),engine.active().unwrap().history.state(1).unwrap(),engine.active().unwrap().doc.clone()];
        let current=|engine:&Session,index:usize|std::sync::Arc::ptr_eq(&engine.active().unwrap().doc,&docs[index]);
        execute_view_command(&mut engine,"edit.undo",json!({})).unwrap();assert!(current(&engine,1));
        execute_view_command(&mut engine,"edit.redo",json!({})).unwrap();assert!(current(&engine,2));
        assert_eq!(execute_view_command(&mut engine,"history.select",json!({"index":0})).unwrap(),true);assert!(current(&engine,0));
        let session=PhotoSession{engine,color_settings:None,version:ulid::Ulid::new().to_string(),original_path:None,writer:Default::default()};
        let state=reply(std::path::Path::new("/tmp"),&ulid::Ulid::new().to_string(),&session,Vec::new()).unwrap().state;
        assert_eq!(state["historySources"].as_array().unwrap().len(),1);assert_eq!(state["historyRedo"].as_array().unwrap().len(),2);assert_eq!(state["canRedo"],true);
        assert_eq!(state["layers"][0]["locks"],json!({"transparency":true,"pixels":false,"position":true,"all":false}));
        let mut engine=session.engine;
        execute_view_command(&mut engine,"history.select",json!({"index":2})).unwrap();assert!(current(&engine,2));
        execute_view_command(&mut engine,"history.select",json!({"index":1})).unwrap();assert!(current(&engine,1));
        assert_eq!(execute_view_command(&mut engine,"history.select",json!({"index":1})).unwrap(),false);
        for params in [json!({"index":3}),json!({"index":-1}),json!({})]{assert!(execute_view_command(&mut engine,"history.select",params).is_err());assert!(current(&engine,1));}
    }

    #[test]
    fn every_adjustment_control_uses_valid_engine_parameters() {
        let cases = [
            (
                "brightnessContrast",
                json!({"brightness":-40,"contrast":20}),
            ),
            ("levels", json!({"inBlack":20,"inWhite":230,"gamma":1.4})),
            ("curves", json!({"points":[[0,0],[128,180],[255,255]]})),
            ("exposure", json!({"exposure":0.5,"offset":0,"gamma":1})),
            ("vibrance", json!({"vibrance":30,"saturation":15})),
            (
                "hueSaturation",
                json!({"hue":45,"saturation":30,"lightness":0}),
            ),
            (
                "blackWhite",
                json!({"reds":40,"yellows":60,"greens":40,"cyans":60,"blues":20,"magentas":80}),
            ),
            ("colorBalance", json!({"midtones":[20,0,-20]})),
            ("photoFilter", json!({"density":25,"color":"#ec8a00"})),
            ("channelMixer", json!({"red":[80,30,-10,5]})),
            (
                "gradientMap",
                json!({"stops":[[0,"#000000"],[1,"#ffffff"]]}),
            ),
            ("selectiveColor", json!({"reds":[20,0,-20,0]})),
            ("colorLookup", json!({"lut":"tealOrange"})),
            ("invert", json!({})),
            ("posterize", json!({"levels":4})),
            ("threshold", json!({"level":128})),
        ];
        for (name, params) in cases {
            let mut engine = Session::new();
            engine
                .execute(
                    "file.new",
                    json!({"width":32,"height":32,"background":"transparent"}),
                )
                .unwrap();
            engine
                .execute(
                    "paint.stroke",
                    json!({"points":[[16,16,1]],"size":40,"color":"#4080b0"}),
                )
                .unwrap();
            engine
                .execute(&format!("layer.newAdjustmentLayer.{name}"), params)
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            let before = photocraft_compose::thumbnail(&engine.active().unwrap().doc, 32);
            let bytes = photocraft_format::save_to_bytes(
                &engine.active().unwrap().doc,
                &Default::default(),
            )
            .unwrap();
            let restored = photocraft_format::load_from_bytes(&bytes).unwrap();
            assert_eq!(
                before.pixels,
                photocraft_compose::thumbnail(&restored, 32).pixels,
                "{name}"
            );
        }
    }

    #[test]
    fn layered_psd_and_immutable_native_versions_reopen() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":32,"height":32,"background":"transparent"}),
            )
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[16,16,1]],"size":12,"color":"#4080b0"}),
            )
            .unwrap();
        engine
            .execute("layer.layerMask.revealAll", json!({}))
            .unwrap();
        let output =
            photocraft_io::export(&engine.active().unwrap().doc, "psd", &Default::default())
                .unwrap();
        let restored = photocraft_io::import("test.psd", &output.bytes).unwrap();
        assert!(restored.document.layers.iter().any(|l| l.mask.is_some()));
        let dir = std::env::temp_dir().join(format!("orion-photo-test-{}", ulid::Ulid::new()));
        let mut session = PhotoSession {
            engine,color_settings:None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        let first = publish(&dir, "test", &mut session).unwrap();
        session
            .engine
            .execute("layer.new.layer", json!({"name":"New layer"}))
            .unwrap();
        let second = publish(&dir, "test", &mut session).unwrap();
        assert_ne!(first.version, second.version);
        assert_eq!(
            restore(&dir, &first.version, None)
                .unwrap()
                .engine
                .active()
                .unwrap()
                .doc
                .layers
                .len(),
            1
        );
        assert_eq!(
            restore(&dir, &second.version, None)
                .unwrap()
                .engine
                .active()
                .unwrap()
                .doc
                .layers
                .len(),
            2
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn real_brush_masks_adjustments_and_native_roundtrip() {
        let mut s = Session::new();
        s.execute(
            "file.new",
            json!({"width":32, "height":32, "background":"transparent"}),
        )
        .unwrap();
        s.execute(
            "paint.stroke",
            json!({"points":[[8,8,1],[24,24,1]],"size":6,"color":"#ff0000"}),
        )
        .unwrap();
        s.execute("layer.layerMask.revealAll", json!({})).unwrap();
        s.execute(
            "layer.newAdjustmentLayer.brightnessContrast",
            json!({"brightness":-50,"contrast":20}),
        )
        .unwrap();
        let before = photocraft_compose::thumbnail(&s.active().unwrap().doc, 32);
        assert!(before.pixels.chunks_exact(4).any(|p| p[3] > 0));
        let bytes = photocraft_format::save_to_bytes(&s.active().unwrap().doc, &Default::default())
            .unwrap();
        let reopened = photocraft_format::load_from_bytes(&bytes).unwrap();
        assert_eq!(
            before.pixels,
            photocraft_compose::thumbnail(&reopened, 32).pixels
        );
        assert!(reopened.layers.iter().any(|l| l.mask.is_some()));
        assert_eq!(reopened.layers.len(), 2);
        assert!(s.undo());
        assert!(s.redo());
    }

    #[test]
    fn text_transforms_saved_selections_and_editable_adjustments_survive_image_resize() {
        let mut engine = Session::new();
        engine.execute("file.new",json!({"width":64,"height":64,"mode":"rgb","depth":16,"resolution":300,"background":"transparent"})).unwrap();
        engine
            .execute(
                "type.create",
                json!({"text":"Original","font":"Arial","size":12,"x":4,"y":24}),
            )
            .unwrap();
        engine
            .execute(
                "type.edit",
                json!({"text":"Updated","runs":[{"start":0,"end":7,"size":16}]}),
            )
            .unwrap();
        engine
            .execute("layer.translate", json!({"dx":3,"dy":2}))
            .unwrap();
        engine
            .execute("edit.transform", json!({"matrix":[1,0,0,1,2,1]}))
            .unwrap();
        engine
            .execute("select.rect", json!({"x":2,"y":2,"width":16,"height":16}))
            .unwrap();
        engine
            .execute("select.saveSelection", json!({"name":"Saved area"}))
            .unwrap();
        engine.execute("select.deselect", json!({})).unwrap();
        engine
            .execute(
                "layer.newAdjustmentLayer.levels",
                json!({"inBlack":12,"inWhite":240,"gamma":1.2}),
            )
            .unwrap();
        engine
            .execute("layer.setAdjustment", json!({"gamma":1.6}))
            .unwrap();
        engine
            .execute(
                "image.imageSize",
                json!({"width":96,"height":96,"resolution":300,"resample":"bicubic"}),
            )
            .unwrap();
        engine
            .execute(
                "image.canvasSize",
                json!({"width":120,"height":100,"anchor":"center","extensionColor":"transparent"}),
            )
            .unwrap();
        let dir = std::env::temp_dir().join(format!("orion-image-workflow-{}", ulid::Ulid::new()));
        let mut session = PhotoSession {
            engine,color_settings:None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        let descriptor = publish(&dir, "workflow", &mut session).unwrap();
        let response = reply(&dir, "workflow", &session, Vec::new()).unwrap();
        assert_eq!(response.state["depth"], 16);
        assert_eq!(response.state["resolution"], 300.0);
        let adjustment = response.state["layers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|l| l["adjustmentKind"] == "levels")
            .unwrap();
        assert!((adjustment["adjustmentParams"]["gamma"].as_f64().unwrap() - 1.6).abs() < 1e-6);
        let restored = restore(&dir, &descriptor.version, None).unwrap();
        assert_eq!(
            photocraft_compose::thumbnail(&session.engine.active().unwrap().doc, 120).pixels,
            photocraft_compose::thumbnail(&restored.engine.active().unwrap().doc, 120).pixels
        );
        assert_eq!(
            inspect::document(restored.engine.active().unwrap())["channels"]["alpha"][0]["name"],
            "Saved area"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_layers_restore_and_group_without_losing_order_or_pixels() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":32,"height":32,"background":"white"}),
            )
            .unwrap();
        let bottom = engine.active().unwrap().active_layer.unwrap().0;
        engine
            .execute("layer.new.layer", json!({"name":"Top"}))
            .unwrap();
        let top = engine.active().unwrap().active_layer.unwrap().0;
        let dir = std::env::temp_dir().join(format!("orion-layer-selection-{}", ulid::Ulid::new()));
        let mut session = PhotoSession {
            engine,color_settings:None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        publish(&dir, "layers", &mut session).unwrap();
        let version = session.version.clone();
        session
            .engine
            .execute("layer.select", json!({"layer":bottom,"mode":"add"}))
            .unwrap();
        save_view(&dir, &session).unwrap();
        let mut restored = restore(&dir, &version, None).unwrap();
        assert_eq!(restored.engine.active().unwrap().selected_layers().len(), 2);
        assert_eq!(
            restored.engine.active().unwrap().active_layer.unwrap().0,
            bottom
        );
        let pixels =
            photocraft_compose::thumbnail(&restored.engine.active().unwrap().doc, 32).pixels;
        restored
            .engine
            .execute("layer.groupLayers", json!({"name":"Selected group"}))
            .unwrap();
        let doc = &restored.engine.active().unwrap().doc;
        assert_eq!(doc.layers.len(), 1);
        let photocraft_engine::doc::LayerContent::Group(group) = &doc.layers[0].content else {
            panic!("expected selected group");
        };
        assert_eq!(
            group
                .children
                .iter()
                .map(|layer| layer.id.0)
                .collect::<Vec<_>>(),
            vec![bottom, top]
        );
        assert_eq!(photocraft_compose::thumbnail(doc, 32).pixels, pixels);
        assert_eq!(restored.version, version);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
pub async fn xdesign_photo_render(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
) -> Result<String, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = dir.join(format!("{version}.render.png"));
        if !path.is_file() {
            let session = restore(&dir, &version, None)?;
            let exported = photocraft_io::export(
                &session.engine.active().ok_or("No image document")?.doc,
                "png",
                &Default::default(),
            )
            .map_err(|e| e.to_string())?;
            photocraft_format::atomic_write(&path, &exported.bytes).map_err(|e| e.to_string())?;
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoTile {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    png: String,
    selection_path: String,
    selection_truncated: bool,
    scale: u32,
    pixel_width: u32,
    pixel_height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection_png: Option<String>,
}

#[cfg(test)]
fn render_tile(
    doc: &photocraft_engine::doc::Document,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<PhotoTile, String> {
    render_view_tile(doc, None, x, y, width, height)
}

#[cfg(test)]
fn render_view_tile(
    doc: &photocraft_engine::doc::Document,
    channels: Option<&photocraft_engine::channel_cmds::ChannelView>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<PhotoTile, String> {
    tiles::render(doc, channels, x, y, width, height, 1, false, false)
}

fn workspace_snapshot(dir:&Path,project:&str,photo:&str,version:&str)->Result<(photocraft_engine::DocState,color_views::Snapshot),String>{
    workspace_snapshot_with_history(dir,project,photo,version,snapshot::HistoryPolicy::Keep)
}
fn workspace_snapshot_with_history(dir:&Path,project:&str,photo:&str,version:&str,policy:snapshot::HistoryPolicy)->Result<(photocraft_engine::DocState,color_views::Snapshot),String>{
    let cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;
    if let Some(session)=cache.get(&key(project,photo)).filter(|session|session.version==version){return Ok((snapshot::capture(session.engine.active().ok_or("No image document")?,policy),color_views::Snapshot::capture(&session.engine)?));}
    drop(cache);let restored=restore_with_policy(dir,version,None,true,policy)?;
    Ok((snapshot::capture(restored.engine.active().ok_or("No image document")?,policy),color_views::Snapshot::capture(&restored.engine)?))
}
fn view_snapshot(dir:&Path,project:&str,photo:&str,version:&str,expected:Option<&str>)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Option<photocraft_engine::channel_cmds::ChannelView>,Option<std::sync::Arc<display::View>>),String>{
    let mut cache=Some(sessions().lock().map_err(|_|"Image engine needs to be restarted")?);
    let (doc,channels,color)=if let Some(session)=cache.as_ref().unwrap().get(&key(project,photo)).filter(|session|session.version==version){let state=session.engine.active().ok_or("No image document")?;(state.doc.clone(),state.channel_view.clone(),color_views::Snapshot::capture(&session.engine)?)}else{
        drop(cache.take());let restored=restore(dir,version,None)?;let state=restored.engine.active().ok_or("No image document")?;(state.doc.clone(),state.channel_view.clone(),color_views::Snapshot::capture(&restored.engine)?)
    };
    drop(cache);
    if let Some(expected)=expected{
        if expected!=color.key(&channels)?{return Err("The image view changed; refresh the preview".into());}
        let render=color.render(&doc)?;Ok((doc,Some(channels),Some(render)))
    }else{Ok((doc,None,None))}
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoViewPreview {
    width: u32,
    height: u32,
    png: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoCommandPreview {
    #[serde(flatten)]
    preview: PhotoViewPreview,
    #[serde(skip_serializing_if = "Option::is_none")]
    tiles: Option<Vec<preview::PreviewTile>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_tiles: Option<Vec<preview::PreviewTile>>,
}

#[tauri::command]
pub async fn xdesign_photo_preset_preview(app:AppHandle,kind:String,preset:String,group:Option<String>,revision:u64)->Result<PhotoViewPreview,String>{
    use std::sync::atomic::{AtomicUsize,Ordering};
    static ACTIVE:AtomicUsize=AtomicUsize::new(0);
    struct Lease;impl Drop for Lease{fn drop(&mut self){ACTIVE.fetch_sub(1,Ordering::SeqCst);}}
    if ACTIVE.fetch_add(1,Ordering::SeqCst)>=2{ACTIVE.fetch_sub(1,Ordering::SeqCst);return Err("Wait for the current preset previews to finish".into());}
    let lease=Lease;
    let dir=app.path().app_data_dir().map_err(|error|error.to_string())?.join("xdesign-tools");
    tauri::async_runtime::spawn_blocking(move||{
        let _lease=lease;let mut source=Session::new();tools::preview_settings(&dir,&mut source)?;
        let current=if kind=="brush"{source.tools.presets_rev}else{source.presets.rev};
        if revision!=current{return Err("The preset library changed; refresh its preview".into());}
        preset_preview::render(&source,&kind,&preset,group.as_deref())
    }).await.map_err(|error|error.to_string())?
}

fn render_view_preview(
    doc: &photocraft_engine::doc::Document,
    channels: &photocraft_engine::channel_cmds::ChannelView,
) -> Result<PhotoViewPreview, String> {
    render_color_view_preview(doc,channels,None)
}
fn render_color_view_preview(doc:&photocraft_engine::doc::Document,channels:&photocraft_engine::channel_cmds::ChannelView,color:Option<&display::View>)->Result<PhotoViewPreview,String>{
    let factor = doc.size.width.max(doc.size.height).div_ceil(2048).max(1);
    let width = doc.size.width.div_ceil(factor);
    let height = doc.size.height.div_ceil(factor);
    let composite = if view::needs_composite(doc, channels) {
        photocraft_compose::render_reduced(doc, width, height)
    } else {
        photocraft_compose::Buffer::transparent(photocraft_engine::doc::Rect::from_xywh(
            0, 0, width, height,
        ))
    };
    let buffer = view::present(doc, channels, composite, doc.bounds(), factor);
    let rgba = if channels.is_plain(doc) { match color{Some(color)=>color.rgba(&buffer),None=>display::rgba(doc,&buffer)?} } else { buffer.to_rgba8() };
    let image = photocraft_codecs::Image::from_u8(
        width,
        height,
        photocraft_codecs::ChannelLayout::Rgba,
        rgba.pixels,
    )
    .map_err(|e| e.to_string())?;
    let bytes =
        photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &photocraft_codecs::EncodeOptions { png_compression: photocraft_codecs::PngCompression::Fast, ..Default::default() })
            .map_err(|e| e.to_string())?;
    Ok(PhotoViewPreview {
        width,
        height,
        png: base64::engine::general_purpose::STANDARD.encode(bytes),
        result: None,
    })
}

/// Fit-to-window channel/mask views stay bounded to 2048 pixels per side.
#[tauri::command]
pub async fn xdesign_photo_view_preview(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    view_key: String,
) -> Result<PhotoViewPreview, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, channels,color) =
            view_snapshot(&dir, &project_id, &photo_id, &version, Some(&view_key))?;
        render_color_view_preview(&doc, &channels.ok_or("No image view")?,color.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_photo_magnetic_trace(app: AppHandle, project_id: String, photo_id: String, version: String, view_key: String, params: Value) -> Result<Value, String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static ACTIVE: AtomicUsize = AtomicUsize::new(0);
    struct Lease;
    impl Drop for Lease { fn drop(&mut self) { ACTIVE.fetch_sub(1, Ordering::SeqCst); } }
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    if ACTIVE.fetch_add(1, Ordering::SeqCst) >= 2 { ACTIVE.fetch_sub(1, Ordering::SeqCst); return Err("Wait for the current magnetic traces to finish".into()); }
    let lease = Lease;
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let (doc, channels, color) = view_snapshot(&dir, &project_id, &photo_id, &version, Some(&view_key))?;
        serde_json::to_value(magnetic::trace(&doc, channels.as_ref(), color.as_deref(), &params)?).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

/// Unapplied effects run in an isolated session; no disk or history mutation.
#[tauri::command]
pub async fn xdesign_photo_command_preview(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    command: String,
    params: Value,
    view_key: Option<String>,
    selection_view: Option<String>,
    regions: Option<Vec<preview::PreviewRegion>>,
    request_id: Option<String>,
    cancel: Option<bool>,
) -> Result<PhotoCommandPreview, String> {
    id(&project_id)?;id(&photo_id)?;id(&version)?;
    let owner=format!("{project_id}/{photo_id}/{version}");
    if cancel==Some(true) {
        preview_requests::cancel(&owner,request_id.as_deref().ok_or("No image preview request ID")?)?;
        return Ok(PhotoCommandPreview{preview:PhotoViewPreview{width:1,height:1,png:String::new(),result:Some(json!({"canceled":true}))},tiles:None,original_tiles:None});
    }
    let dir = root(&app, &project_id, &photo_id)?;
    let mut params = params;
    let match_source = match (command == "image.adjustments.matchColor").then(|| params.as_object_mut().and_then(|object| object.remove("sourcePhoto"))).flatten() {
        Some(source) => {
            let (Some(source_id), Some(source_version)) = (source["id"].as_str(), source["version"].as_str()) else { return Err("Choose a source image for Match Color".into()); };
            id(source_id)?;id(source_version)?;params["source"] = json!(1);
            Some((root(&app, &project_id, source_id)?, source_version.to_string()))
        }
        None => None,
    };
    let lease=preview_requests::acquire(&owner,request_id.as_deref())?;
    let result=tauri::async_runtime::spawn_blocking(move || {
        lease.token().check()?;
        let (state,color,invocation)=if command == "filter.lastFilter" {
            let cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;
            let (state,color,invocation)=repeat::snapshot(&cache,&project_id,&photo_id,&version,&params)?;
            (state,color,Some(invocation))
        }else{let (state,color)=workspace_snapshot_with_history(&dir,&project_id,&photo_id,&version,snapshot::HistoryPolicy::Discard)?;(state,color,None)};
        if let Some(view_key) = view_key { if color.key(&state.channel_view)? != view_key { return Err("The image view changed; preview the current view".into()); } }
        let rendered=if let Some(invocation)=invocation {
            preview::render_repeat(&key(&project_id,&photo_id),&version,&state,&color,invocation,selection_view.as_deref(),regions.as_deref(),lease.token())?
        }else{
            let source=match &match_source {Some((source_dir,source_version))=>Some((*restore(source_dir,source_version,None)?.engine.active().ok_or("The Match Color source image is unavailable")?.doc).clone()),None=>None};
            preview::render_controlled_with_source(&key(&project_id,&photo_id),&version,&state,&color,&command,params,selection_view.as_deref(),regions.as_deref(),lease.token(),source)?
        };
        lease.token().check()?;
        Ok(PhotoCommandPreview { preview: rendered.preview, tiles: rendered.tiles, original_tiles: rendered.original_tiles })
    })
    .await
    .map_err(|error| error.to_string())?;
    result
}

fn stroke_preview_engine()->&'static std::sync::Mutex<Option<(String,Session)>>{static ENGINE:std::sync::OnceLock<std::sync::Mutex<Option<(String,Session)>>>=std::sync::OnceLock::new();ENGINE.get_or_init(Default::default)}
// Tests share the capped stroke feedback caches and preview request slots,
// so parallel tests evict, exhaust or poison them for each other.
#[cfg(test)]
fn feedback_serial()->std::sync::MutexGuard<'static,()>{
    static LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
fn stroke_preview_session(mut state:photocraft_engine::DocState,command:&str)->Result<Session,String>{
    // History Brush resolves source IDs against the retained native history.
    // Ordinary feedback can release those references in its isolated copy.
    if command!="paint.historyBrush"{state.history=Default::default();}
    let mut engine=Session::new();engine.add_document((*state.doc).clone(),None);
    *engine.active_mut().ok_or("No preview image")?=state;Ok(engine)
}

/// Read-only, bounded native compositing. Tiles never create files or advance history.
#[tauri::command]
pub async fn xdesign_photo_stroke_preview(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    view_key: String,
    command: String,
    params: Value,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    scale: u32,
) -> Result<Vec<PhotoTile>, String> {
    stroke_preview_run(app, project_id, photo_id, version, view_key, command, move |engine, identity, command| {
        stroke::render_with_identity(engine, Some(identity), command, &params, x, y, width, height, scale)
    })
    .await
}

/// Brush, retouch, Patch and eraser feedback as raw display pixels for only the area a request
/// changed, so the client repaints in place instead of decoding whole PNG tiles per step.
#[tauri::command]
pub async fn xdesign_photo_stroke_pixels(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    view_key: String,
    command: String,
    params: Value,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    scale: u32,
) -> Result<tauri::ipc::Response, String> {
    stroke_preview_run(app, project_id, photo_id, version, view_key, command, move |engine, identity, command| {
        stroke::render_pixels(engine, identity, command, &params, x, y, width, height, scale)
    })
    .await
    .map(tauri::ipc::Response::new)
}

/// Brush, retouch, Patch and eraser feedback in a whole-image preview's pixel space, for strokes
/// drawn while the image is shown from that preview; `view` means the channel, mask or proof
/// preview.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn xdesign_photo_stroke_preview_pixels(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    view_key: String,
    command: String,
    params: Value,
    view: bool,
) -> Result<tauri::ipc::Response, String> {
    stroke_preview_run(app, project_id, photo_id, version, view_key, command, move |engine, identity, command| {
        stroke::render_preview_pixels(engine, identity, command, &params, view)
    })
    .await
    .map(tauri::ipc::Response::new)
}

async fn stroke_preview_run<T: Send + 'static>(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    view_key: String,
    command: String,
    render: impl FnOnce(&Session, &str, &str) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static ACTIVE: AtomicUsize = AtomicUsize::new(0);
    struct Lease;
    impl Drop for Lease {
        fn drop(&mut self) {
            ACTIVE.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    let tool_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("xdesign-tools");
    if ACTIVE.fetch_add(1, Ordering::SeqCst) >= 2 {
        ACTIVE.fetch_sub(1, Ordering::SeqCst);
        return Err("Wait for the current stroke preview to finish".into());
    }
    let lease = Lease;
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let policy=if command=="paint.historyBrush"{snapshot::HistoryPolicy::Keep}else{snapshot::HistoryPolicy::Discard};
        let (state,color)=workspace_snapshot_with_history(&dir,&project_id,&photo_id,&version,policy)?;
        if color.key(&state.channel_view)? != view_key {
            return Err("The image view changed; start another stroke".into());
        }
        // Rebuilding the colour-managed preview session costs ~14ms on every pointer step; it
        // depends only on the image version and view, so keep it for the gesture and refresh
        // just the document state.
        let identity=format!("{project_id}/{photo_id}/{version}/{view_key}");
        let slot_key=format!("{identity}/{}",command=="paint.historyBrush");
        let mut slot=stroke_preview_engine().lock().map_err(|_|"Stroke feedback needs to be restarted")?;
        match slot.as_mut().filter(|(key,_)|*key==slot_key) {
            Some((_,engine))=>{let mut state=state;if command!="paint.historyBrush"{state.history=Default::default();}*engine.active_mut().ok_or("No preview image")?=state;}
            None=>{let mut engine=stroke_preview_session(state,&command)?;color.install(&mut engine)?;*slot=Some((slot_key,engine));}
        }
        let engine=&mut slot.as_mut().ok_or("No preview image")?.1;
        tools::preview_settings(&tool_dir, engine)?;
        render(engine, &identity, &command)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_photo_stroke_end(project_id:String,photo_id:String,version:String,view_key:String,seed:u64)->Result<(),String>{
    id(&project_id)?;id(&photo_id)?;id(&version)?;
    if view_key.len()>4096{return Err("Invalid stroke view".into());}
    let identity=format!("{project_id}/{photo_id}/{version}/{view_key}");
    if let Ok(mut slot)=stroke_preview_engine().lock(){if slot.as_ref().is_some_and(|(key,_)|key.starts_with(&format!("{identity}/"))){*slot=None;}}
    stroke::release(&identity,seed)
}

/// Read-only, bounded native compositing. Tiles never create files or advance history.
#[tauri::command]
pub async fn xdesign_photo_layer_thumbnails(app: AppHandle, project_id: String, photo_id: String, version: String, size: u32) -> Result<Vec<Value>, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, _, _) = view_snapshot(&dir, &project_id, &photo_id, &version, None)?;
        layer_thumbnails(&doc, size.clamp(16, 128))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Channels panel thumbnails: composite, colour channels as gray, alpha/spot channels and Quick Mask.
#[tauri::command]
pub async fn xdesign_photo_channel_thumbnails(app: AppHandle, project_id: String, photo_id: String, version: String, size: u32) -> Result<Value, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, _, _) = view_snapshot(&dir, &project_id, &photo_id, &version, None)?;
        channel_thumbnails(&doc, size.clamp(16, 128))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Colour channels derive from the composite thumbnail like the engine's own panel does (CMYK shows ink coverage).
fn channel_thumbnails(doc: &photocraft_engine::doc::Document, size: u32) -> Result<Value, String> {
    let comp = photocraft_compose::thumbnail(doc, size);
    let (w, h) = (comp.width as usize, comp.height as usize);
    let gray = |value: &dyn Fn(usize) -> f32| -> Result<String, String> {
        let mut pixels = Vec::with_capacity(w * h * 4);
        for index in 0..w * h { let g = (value(index).clamp(0.0, 1.0) * 255.0 + 0.5) as u8; pixels.extend_from_slice(&[g, g, g, 255]); }
        tiles::png(w as u32, h as u32, pixels)
    };
    let format = doc.pixel_format();
    let (colors, cmyk) = (format.mode.color_channels(), format.mode == photocraft_engine::doc::ColorMode::Cmyk);
    let rgba = |index: usize| -> [f32; 4] { let p = &comp.pixels[index * 4..index * 4 + 4]; [p[0], p[1], p[2], 255].map(|v| f32::from(v) / 255.0) };
    let mut out = json!({"composite": tiles::png(w as u32, h as u32, comp.pixels.clone())?, "colors": [], "alpha": [], "quickMask": null});
    if colors > 1 {
        out["colors"] = json!((0..colors).map(|k| gray(&|index| { let x = photocraft_raster::from_rgba(&format, rgba(index))[k]; if cmyk { 1.0 - x } else { x } })).collect::<Result<Vec<_>, _>>()?);
    }
    let (dw, dh) = (doc.size.width.max(1) as f32, doc.size.height.max(1) as f32);
    let plane = |surface: &photocraft_raster::Surface| gray(&|index| surface.sample_channel(((index % w) as f32 + 0.5).mul_add(dw / w as f32, 0.0) as i32, ((index / w) as f32 + 0.5).mul_add(dh / h as f32, 0.0) as i32, 0));
    out["alpha"] = json!(doc.channels.iter().take(64).map(|channel| plane(&channel.surface)).collect::<Result<Vec<_>, _>>()?);
    if let Some(quick) = &doc.quick_mask { out["quickMask"] = json!(plane(&quick.surface)?); }
    Ok(out)
}

/// Levels, Curves and Threshold histograms: what an adjustment layer receives (`below`), or the
/// target layer on its own for Image ▸ Adjustments, binned per tone channel of `space`.
#[tauri::command]
pub async fn xdesign_photo_histogram(app: AppHandle, project_id: String, photo_id: String, version: String, layer: Option<u64>, below: bool, space: String) -> Result<Vec<Vec<u32>>, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, _, _) = view_snapshot(&dir, &project_id, &photo_id, &version, None)?;
        histograms(&doc, layer, below, &space)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Levels and Curves eyedroppers: the mean straight colour (0–255) of a document rectangle, read from the same
/// pixels as the histogram so the image under an adjustment layer is sampled without that adjustment.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn xdesign_photo_sample(app: AppHandle, project_id: String, photo_id: String, version: String, layer: Option<u64>, below: bool, x: u32, y: u32, width: u32, height: u32, above_hidden: Option<bool>) -> Result<Option<[f32; 3]>, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, _, _) = view_snapshot(&dir, &project_id, &photo_id, &version, None)?;
        // Current & Below: the layer stays and everything stacked over it goes.
        match layer.filter(|_| above_hidden == Some(true)) {
            Some(id) => {
                let mut doc = doc;
                if !hide_above(&mut std::sync::Arc::make_mut(&mut doc).layers, photocraft_engine::doc::LayerId(id)) { return Err("That layer no longer exists".into()); }
                sample_layer_view(&doc, None, false, x, y, width, height)
            }
            None => sample_layer_view(&doc, layer, below, x, y, width, height),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Show Clipping in Levels and Curves: the pixels the histogram reads, at most `size` on the long
/// side, as u32 LE width and height, then straight RGBA.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn xdesign_photo_tone_pixels(app: AppHandle, project_id: String, photo_id: String, version: String, layer: Option<u64>, below: bool, size: u32) -> Result<tauri::ipc::Response, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, _, _) = view_snapshot(&dir, &project_id, &photo_id, &version, None)?;
        tone_pixels(&doc, layer, below, size)
    })
    .await
    .map_err(|e| e.to_string())?.map(tauri::ipc::Response::new)
}

fn tone_pixels(doc: &photocraft_engine::doc::Document, layer: Option<u64>, below: bool, size: u32) -> Result<Vec<u8>, String> {
    let image = photocraft_compose::thumbnail(&layer_view(doc, layer, below)?, size.clamp(16, 2048));
    let mut out = Vec::with_capacity(8 + image.pixels.len());
    out.extend(image.width.to_le_bytes()); out.extend(image.height.to_le_bytes()); out.extend(image.pixels);
    Ok(out)
}

fn sample_layer_view(doc: &photocraft_engine::doc::Document, layer: Option<u64>, below: bool, x: u32, y: u32, width: u32, height: u32) -> Result<Option<[f32; 3]>, String> {
    let (right, bottom) = (x.saturating_add(width.clamp(1, 101)).min(doc.size.width), y.saturating_add(height.clamp(1, 101)).min(doc.size.height));
    if x >= right || y >= bottom { return Err("Sample inside the image".into()); }
    let shown = layer_view(doc, layer, below)?;
    let buffer = photocraft_compose::render(&shown, photocraft_engine::doc::Rect::new(x as i32, y as i32, right as i32, bottom as i32));
    let (mut sum, mut coverage) = ([0f32; 3], 0f32);
    for pixel in &buffer.px { let alpha = pixel[3].clamp(0.0, 1.0); for channel in 0..3 { sum[channel] += pixel[channel].clamp(0.0, 1.0) * alpha; } coverage += alpha; }
    Ok((coverage > 0.0).then(|| sum.map(|value| value / coverage * 255.0)))
}

/// Hides every layer stacked above `id` (later siblings at each level on the way to it); false when `id` is missing.
fn hide_above(layers: &mut [photocraft_engine::doc::Layer], id: photocraft_engine::doc::LayerId) -> bool {
    for at in 0..layers.len() {
        let here = layers[at].id == id || layers[at].children_mut().is_some_and(|children| hide_above(children, id));
        if here {
            for above in &mut layers[at + 1..] { above.visible = false; }
            return true;
        }
    }
    false
}

fn layer_view(doc: &photocraft_engine::doc::Document, layer: Option<u64>, below: bool) -> Result<photocraft_engine::doc::Document, String> {
    fn isolate(layers: &mut [photocraft_engine::doc::Layer], id: photocraft_engine::doc::LayerId) -> bool {
        let mut found = false;
        for layer in layers.iter_mut() {
            let here = layer.id == id || layer.children_mut().is_some_and(|children| isolate(children, id));
            layer.visible = here;
            found |= here;
        }
        found
    }
    let mut shown = doc.clone();
    if let Some(id) = layer.map(photocraft_engine::doc::LayerId) {
        if below {
            shown.layer_mut(id).ok_or("That layer no longer exists")?.visible = false;
        } else if !isolate(&mut shown.layers, id) {
            return Err("That layer no longer exists".into());
        }
    }
    Ok(shown)
}

fn histograms(doc: &photocraft_engine::doc::Document, layer: Option<u64>, below: bool, space: &str) -> Result<Vec<Vec<u32>>, String> {
    let shown = layer_view(doc, layer, below)?;
    let image = photocraft_compose::thumbnail(&shown, 384);
    let mut bins = vec![vec![0u32; 256]; match space { "cmyk" => 5, "lab" => 3, "luminosity" => 1, _ => 4 }];
    let bin = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as usize;
    for pixel in image.pixels.chunks_exact(4).filter(|pixel| pixel[3] > 0) {
        let rgb = [pixel[0], pixel[1], pixel[2]].map(|value| f32::from(value) / 255.0);
        match space {
            "cmyk" => {
                // Naive inks: the document's CMYK profile isn't reachable from the host crates.
                let black = 1.0 - rgb[0].max(rgb[1]).max(rgb[2]);
                let ink = if black >= 1.0 - 1e-6 { [0.0, 0.0, 0.0, 1.0] } else { let rest = 1.0 - black; [(1.0 - rgb[0] - black) / rest, (1.0 - rgb[1] - black) / rest, (1.0 - rgb[2] - black) / rest, black] };
                for (channel, value) in ink.iter().enumerate() { bins[channel + 1][bin(1.0 - value)] += 1; }
                bins[0][bin(1.0 - ink.iter().sum::<f32>() / 4.0)] += 1;
            }
            "lab" => {
                let lab = photocraft_algo::segment::slic::rgb_to_lab(rgb);
                bins[0][bin(lab[0] / 100.0)] += 1;
                bins[1][bin((lab[1] + 128.0) / 255.0)] += 1;
                bins[2][bin((lab[2] + 128.0) / 255.0)] += 1;
            }
            // Threshold's own grey, the engine's Rec. 601 weights.
            "luminosity" => bins[0][bin(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])] += 1,
            // Photoshop's RGB histogram counts every channel value, so the composite is the three channels added up.
            _ => for channel in 0..3 { bins[channel + 1][pixel[channel] as usize] += 1; bins[0][pixel[channel] as usize] += 1; },
        }
    }
    Ok(bins)
}

// Each layer renders alone, visible, opaque and unclipped, like Photoshop's Layers panel thumbnails.
fn layer_thumbnails(doc: &photocraft_engine::doc::Document, size: u32) -> Result<Vec<Value>, String> {
    use photocraft_engine::doc::LayerContent;
    let longest = doc.size.width.max(doc.size.height);
    let scale = longest.div_ceil(size).next_power_of_two().min(64);
    if longest.div_ceil(scale) > 512 { return Ok(Vec::new()); }
    let mut layers = Vec::new();
    let mut pending: Vec<&photocraft_engine::doc::Layer> = doc.layers.iter().collect();
    while let Some(layer) = pending.pop() {
        if let LayerContent::Group(group) = &layer.content { pending.extend(group.children.iter()); }
        if !matches!(layer.content, LayerContent::Adjustment(_) | LayerContent::Group(_)) || layer.mask.is_some() { layers.push(layer); }
    }
    layers.into_iter().take(256).map(|layer| {
        let mut thumbnail = json!({"layer": layer.id.0});
        // An adjustment or a group has no pixels of its own; the Layers panel shows its icon and only the mask.
        if !matches!(layer.content, LayerContent::Adjustment(_) | LayerContent::Group(_)) {
            let mut shown = layer.clone();
            shown.visible = true; shown.opacity = 1.0; shown.clipped = false;
            let mut single = doc.clone();
            single.layers = vec![shown]; single.selection = None; single.quick_mask = None;
            thumbnail["png"] = json!(tiles::render(&single, None, 0, 0, doc.size.width, doc.size.height, scale, false, false)?.png);
        }
        if let Some(mask) = &layer.mask {
            let (width, height) = (doc.size.width.div_ceil(scale), doc.size.height.div_ceil(scale));
            let (mut row, mut pixels) = (vec![0.0; width as usize], Vec::with_capacity((width * height * 4) as usize));
            for y in 0..height {
                mask.surface.sample_row_strided((y * scale) as i32, 0, scale as i32, 0, &mut row);
                for value in &row { let gray = (value.clamp(0.0, 1.0) * 255.0).round() as u8; pixels.extend_from_slice(&[gray, gray, gray, 255]); }
            }
            thumbnail["mask"] = json!(tiles::png(width, height, pixels)?);
        }
        Ok(thumbnail)
    }).collect()
}

#[tauri::command]
pub async fn xdesign_photo_tile(
    app: AppHandle,
    project_id: String,
    photo_id: String,
    version: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    view_key: Option<String>,
    scale: Option<u32>,
    selection_only: Option<bool>,
    selection_overlay: Option<bool>,
) -> Result<PhotoTile, String> {
    let dir = root(&app, &project_id, &photo_id)?;
    id(&version)?;
    let scale = scale.unwrap_or(1);
    tiles::validate_dimensions(width, height, scale)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (doc, channels,color) =
            view_snapshot(&dir, &project_id, &photo_id, &version, view_key.as_deref())?;
        // Release the session mutex before compositing; edits can proceed using immutable Arcs.
        tiles::render_with_color(
            &doc,
            channels.as_ref(),
            color.as_deref(),
            x,
            y,
            width,
            height,
            scale,
            selection_only.unwrap_or(false),
            selection_overlay.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tile_tests {
    use super::*;

    fn pixels(png: &str) -> Vec<u8> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png)
            .unwrap();
        photocraft_codecs::decode(&bytes)
            .unwrap()
            .as_u8()
            .unwrap()
            .to_vec()
    }

    #[test]
    fn channel_and_mask_views_change_presented_pixels_without_changing_composite_or_history() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":16,"height":16,"background":"#d04020"}),
            )
            .unwrap();
        let original = engine.active().unwrap().doc.clone();
        let history = inspect::document(engine.active().unwrap())["history"].clone();
        engine
            .execute("channel.target", json!({"channel":"red"}))
            .unwrap();
        let state = engine.active().unwrap();
        let tile = render_view_tile(&state.doc, Some(&state.channel_view), 0, 0, 16, 16).unwrap();
        assert_eq!(&pixels(&tile.png)[..4], &[208, 208, 208, 255]);
        let preview = render_view_preview(&state.doc, &state.channel_view).unwrap();
        assert_eq!(pixels(&preview.png), pixels(&tile.png));
        assert!(std::sync::Arc::ptr_eq(&original, &state.doc));
        assert_eq!(inspect::document(state)["history"], history);
        assert_eq!(
            &pixels(&render_tile(&state.doc, 0, 0, 16, 16).unwrap().png)[..4],
            &[208, 64, 32, 255]
        );
        engine
            .execute("channel.target", json!({"channel":"composite"}))
            .unwrap();
        engine
            .execute("layer.layerMask.hideAll", json!({}))
            .unwrap();
        engine
            .execute("view.layerMask", json!({"mode":"gray"}))
            .unwrap();
        let state = engine.active().unwrap();
        let history = inspect::document(state)["history"].clone();
        assert_eq!(
            &pixels(
                &render_view_preview(&state.doc, &state.channel_view)
                    .unwrap()
                    .png
            )[..4],
            &[0, 0, 0, 255]
        );
        engine
            .execute("view.layerMask", json!({"mode":"overlay"}))
            .unwrap();
        let state = engine.active().unwrap();
        assert_eq!(
            &pixels(
                &render_view_preview(&state.doc, &state.channel_view)
                    .unwrap()
                    .png
            )[..4],
            &[255, 0, 0, 128]
        );
        assert_eq!(inspect::document(state)["history"], history);
        assert!(command_supported("view.layerMask"));
    }

    #[test]
    fn painting_targeted_alpha_and_quick_mask_never_paints_layer_pixels() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":24,"background":"white"}),
            )
            .unwrap();
        engine
            .execute("channel.new", json!({"name":"Cutout","fill":"white"}))
            .unwrap();
        engine
            .execute("channel.target", json!({"channel":0}))
            .unwrap();
        let layer_pixels = photocraft_compose::thumbnail(&engine.active().unwrap().doc, 24).pixels;
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[10,10,1],[14,14,1]],"size":8,"color":"#000000"}),
            )
            .unwrap();
        let state = engine.active().unwrap();
        let shown = pixels(
            &render_view_preview(&state.doc, &state.channel_view)
                .unwrap()
                .png,
        );
        assert!(shown[(12 * 24 + 12) * 4] < 20);
        assert_eq!(
            photocraft_compose::thumbnail(&state.doc, 24).pixels,
            layer_pixels
        );
        engine
            .execute("channel.target", json!({"channel":"composite"}))
            .unwrap();
        engine
            .execute("select.editInQuickMaskMode", json!({"on":true}))
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[10,10,1],[14,14,1]],"size":8,"color":"#000000"}),
            )
            .unwrap();
        let state = engine.active().unwrap();
        assert_eq!(
            photocraft_compose::thumbnail(&state.doc, 24).pixels,
            layer_pixels
        );
        assert!(state.doc.quick_mask.is_some());
        engine
            .execute("select.editInQuickMaskMode", json!({"on":false}))
            .unwrap();
        assert!(engine.active().unwrap().doc.selection.is_some());
    }

    #[test]
    fn saved_view_restores_channel_target_visibility_and_mask_and_rejects_stale_requests() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":24,"background":"white"}),
            )
            .unwrap();
        engine
            .execute("channel.new", json!({"name":"Cutout","fill":"white"}))
            .unwrap();
        engine
            .execute("layer.layerMask.revealAll", json!({}))
            .unwrap();
        let dir = std::env::temp_dir().join(format!("orion-channel-view-{}", ulid::Ulid::new()));
        let mut session = PhotoSession {
            engine,color_settings:None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        publish(&dir, "view", &mut session).unwrap();
        let version = session.version.clone();
        session
            .engine
            .execute("channel.target", json!({"channel":0}))
            .unwrap();
        session
            .engine
            .execute(
                "channel.setVisible",
                json!({"channel":"red","visible":true}),
            )
            .unwrap();
        save_view(&dir, &session).unwrap();
        let key = channel_view_key(&session.engine.active().unwrap().channel_view).unwrap();
        let mut restored = restore(&dir, &version, None).unwrap();
        assert_eq!(
            channel_view_key(&restored.engine.active().unwrap().channel_view).unwrap(),
            key
        );
        assert_eq!(restored.version, version);
        assert!(view_snapshot(&dir, "project", "view", &version, Some(&key)).is_ok());
        assert!(view_snapshot(&dir, "project", "view", &version, Some("outdated")).is_err());
        execute_view_command(
            &mut restored.engine,
            "view.layerMask",
            json!({"mode":"gray"}),
        )
        .unwrap();
        assert_eq!(
            restored.engine.active().unwrap().channel_view.target,
            photocraft_engine::channel_cmds::ChannelTarget::Composite
        );
        save_view(&dir, &restored).unwrap();
        let reopened = restore(&dir, &version, None).unwrap();
        assert_eq!(
            inspect::document(reopened.engine.active().unwrap())["layerMaskView"]["mode"],
            "gray"
        );
        execute_view_command(
            &mut restored.engine,
            "channel.target",
            json!({"channel":"red"}),
        )
        .unwrap();
        assert!(restored
            .engine
            .active()
            .unwrap()
            .channel_view
            .layer_mask
            .is_none());
        let layer = restored.engine.active().unwrap().active_layer.unwrap();
        let pixels = restored.engine.active().unwrap().doc.clone();
        execute_view_command(
            &mut restored.engine,
            "layer.select",
            json!({"layer":layer.0,"target":"mask"}),
        )
        .unwrap();
        let state = restored.engine.active().unwrap();
        assert!(state.channel_view.is_plain(&state.doc));
        assert_eq!(
            state.channel_view.target,
            photocraft_engine::channel_cmds::ChannelTarget::Composite
        );
        assert!(std::sync::Arc::ptr_eq(&state.doc, &pixels));
        execute_view_command(
            &mut restored.engine,
            "view.layerMask",
            json!({"mode":"gray"}),
        )
        .unwrap();
        execute_view_command(
            &mut restored.engine,
            "layer.select",
            json!({"layer":layer.0,"target":"pixels"}),
        )
        .unwrap();
        let state = restored.engine.active().unwrap();
        assert!(state.channel_view.is_plain(&state.doc));
        assert!(std::sync::Arc::ptr_eq(&state.doc, &pixels));
        execute_view_command(
            &mut restored.engine,
            "view.layerMask",
            json!({"mode":"gray"}),
        )
        .unwrap();
        execute_view_command(
            &mut restored.engine,
            "select.editInQuickMaskMode",
            json!({"on":true}),
        )
        .unwrap();
        let state = restored.engine.active().unwrap();
        assert!(state.channel_view.layer_mask.is_none());
        assert_eq!(state.channel_view.visible_colors(3), 3);
        assert_eq!(
            state.channel_view.target,
            photocraft_engine::channel_cmds::ChannelTarget::Composite
        );
        assert!(state.doc.quick_mask.is_some());
        assert_eq!(std::fs::read_dir(&dir).unwrap().filter(|file|file.as_ref().is_ok_and(|entry|entry.file_type().is_ok_and(|kind|kind.is_file()))).count(), 2);
        assert!(dir.join(format!("{}.pcraft",restored.version)).is_dir());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn large_mask_fit_previews_are_bounded_and_detail_tiles_agree() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":4100,"height":16,"background":"white"}),
            )
            .unwrap();
        engine
            .execute("layer.layerMask.hideAll", json!({}))
            .unwrap();
        engine
            .execute("view.layerMask", json!({"mode":"gray"}))
            .unwrap();
        let state = engine.active().unwrap();
        let preview = render_view_preview(&state.doc, &state.channel_view).unwrap();
        assert_eq!((preview.width, preview.height), (1367, 6));
        assert_eq!(&pixels(&preview.png)[..4], &[0, 0, 0, 255]);
        assert_eq!(
            &pixels(
                &render_view_tile(&state.doc, Some(&state.channel_view), 4096, 0, 4, 16)
                    .unwrap()
                    .png
            )[..4],
            &[0, 0, 0, 255]
        );
    }

    #[test]
    fn native_tiles_preserve_detail_selection_edges_and_history() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":80,"height":64,"background":"white"}),
            )
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[38,12,1],[42,48,1]],"size":3,"color":"#e02070"}),
            )
            .unwrap();
        engine
            .execute("select.rect", json!({"x":30,"y":10,"width":20,"height":40}))
            .unwrap();
        let state = engine.active().unwrap();
        let revision = state.revision;
        let tile = render_tile(&state.doc, 32, 0, 32, 64).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&tile.png)
            .unwrap();
        let decoded = photocraft_codecs::decode(&bytes).unwrap();
        let full = photocraft_compose::render(
            &state.doc,
            photocraft_engine::doc::Rect::from_xywh(0, 0, 80, 64),
        )
        .to_rgba8();
        let expected: Vec<u8> = (0..64)
            .flat_map(|row| {
                full.pixels[(row * 80 + 32) * 4..(row * 80 + 64) * 4]
                    .iter()
                    .copied()
            })
            .collect();
        assert_eq!(decoded.as_u8().unwrap(), expected);
        assert!(tile.selection_path.contains("M0 10H18"));
        assert!(tile.selection_path.contains("M18 10V50"));
        assert!(!tile.selection_truncated);
        assert_eq!(state.revision, revision);
        let edge = render_tile(&state.doc, 64, 48, 32, 32).unwrap();
        assert_eq!((edge.width, edge.height), (16, 16));
        assert!(render_tile(&state.doc, 80, 0, 32, 32).is_err());
        assert!(render_tile(&state.doc, 0, 0, 513, 32).is_err());
    }
}
