#[path = "xdesign_photo_clipboard_planes.rs"]
mod planes;
use super::PhotoSession;
use photocraft_engine::{
    color_cmds::{document_profile, Policy},
    doc::{Document, Layer},
    edit_cmds::Clip,
    Session,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) const COMMANDS: [&str; 8] = [
    "edit.copy",
    "edit.copyMerged",
    "edit.cut",
    "edit.paste",
    "edit.pasteSpecial.pasteInPlace",
    "edit.pasteSpecial.pasteInto",
    "edit.pasteSpecial.pasteOutside",
    "file.newFromClipboard",
];
pub(super) fn is_command(command: &str) -> bool {
    COMMANDS.contains(&command)
}
pub(super) fn is_copy(command: &str) -> bool {
    matches!(command, "edit.copy" | "edit.copyMerged" | "edit.cut")
}
#[derive(Clone)]
pub(super) struct Pixels {
    pub(super) clip: Clip,
    pub(super) profile_data: Arc<Vec<u8>>,
    profile_name: String,
    name: String,
    numeric: bool,
}
fn store() -> &'static Mutex<Option<Arc<Pixels>>> {
    static STORE: OnceLock<Mutex<Option<Arc<Pixels>>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}
#[derive(Clone)]
pub(super) struct Receipt {
    pub(super) output_version: String,
    pub(super) original_path: Option<String>,
    pub(super) warnings: Vec<String>,
    project: String,
    photo: String,
    input_version: Option<String>,
    command: String,
    params: Value,
    created: Instant,
}
fn receipts() -> &'static Mutex<HashMap<String, Receipt>> {
    static RECEIPTS: OnceLock<Mutex<HashMap<String, Receipt>>> = OnceLock::new();
    RECEIPTS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub(super) fn receipt(
    request: &str,
    project: &str,
    photo: &str,
    version: &Option<String>,
    command: &str,
    params: &Value,
) -> Result<Option<Receipt>, String> {
    let mut entries = receipts()
        .lock()
        .map_err(|_| "Image clipboard needs to be restarted")?;
    entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(900));
    if let Some(entry) = entries.get(request) {
        if entry.project != project
            || entry.photo != photo
            || entry.input_version != *version
            || entry.command != command
            || entry.params != *params
        {
            return Err("This clipboard request belongs to another operation".into());
        }
    }
    Ok(entries.get(request).cloned())
}
pub(super) fn remember(
    request: &str,
    project: &str,
    photo: &str,
    version: Option<String>,
    command: &str,
    params: Value,
    session: &PhotoSession,
    warnings: Vec<String>,
) -> Result<(), String> {
    let mut entries = receipts()
        .lock()
        .map_err(|_| "Image clipboard needs to be restarted")?;
    if entries.len() >= 4 {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, entry)| entry.created)
            .map(|(request, _)| request.clone())
        {
            entries.remove(&oldest);
        }
    }
    entries.insert(
        request.into(),
        Receipt {
            output_version: session.version.clone(),
            original_path: session.original_path.clone(),
            warnings,
            project: project.into(),
            photo: photo.into(),
            input_version: version,
            command: command.into(),
            params,
            created: Instant::now(),
        },
    );
    Ok(())
}
pub(super) fn current() -> Result<Arc<Pixels>, String> {
    store()
        .lock()
        .map_err(|_| "The image clipboard needs to be restarted")?
        .clone()
        .ok_or("The image clipboard is empty".into())
}
pub(super) fn set(pixels: Arc<Pixels>) -> Result<(), String> {
    *store()
        .lock()
        .map_err(|_| "The image clipboard needs to be restarted")? = Some(pixels);
    Ok(())
}
fn label(value: &str) -> String {
    value
        .char_indices()
        .take_while(|(index, ch)| index + ch.len_utf8() <= 4096)
        .map(|(_, ch)| ch)
        .collect()
}
pub(super) fn describe(pixels: &Pixels) -> Value {
    json!({"name":pixels.name,"numeric":pixels.numeric,"profile":pixels.profile_name,"mode":format!("{:?}",pixels.clip.surface.format().mode),"depth":format!("{:?}",pixels.clip.surface.format().sample),"width":pixels.clip.bounds.width(),"height":pixels.clip.bounds.height()})
}
pub(super) fn summary() -> Result<Value, String> {
    Ok(store()
        .lock()
        .map_err(|_| "The image clipboard needs to be restarted")?
        .as_ref()
        .map_or(Value::Null, |pixels| describe(pixels)))
}
pub(super) fn copy(
    engine: &mut Session,
    command: &str,
    params: Value,
) -> Result<(Value, Arc<Pixels>), String> {
    if !is_copy(command) {
        return Err("Choose a copy command".into());
    }
    let target = planes::target(engine, &params)?;
    let doc = engine.active().ok_or("No source image")?.doc.clone();
    if let Some(target) = target {
        let clip = planes::copy(engine, target, command, &params)?;
        let profile = engine
            .color
            .working(photocraft_engine::doc::ColorMode::Grayscale);
        let bounds = clip.bounds;
        engine.clipboard = Some(clip.clone());
        return Ok((
            json!({"bounds":[bounds.x0,bounds.y0,bounds.width(),bounds.height()]}),
            Arc::new(Pixels {
                clip,
                profile_data: profile.to_bytes(),
                profile_name: label(&profile.description),
                name: label(&doc.name),
                numeric: true,
            }),
        ));
    }
    let result = engine
        .execute(command, params)
        .map_err(|error| error.to_string())?;
    let clip = engine.clipboard.clone().ok_or("No copied image pixels")?;
    if clip.bounds.is_empty()
        || u64::from(clip.bounds.width()) * u64::from(clip.bounds.height()) > super::MAX_PIXELS
    {
        return Err("Clipboard pixels exceed the image editing limit".into());
    }
    let profile = if clip.surface.format().mode == doc.pixel_format().mode {
        document_profile(&doc)
    } else {
        engine.color.working(clip.surface.format().mode)
    };
    Ok((
        result,
        Arc::new(Pixels {
            clip,
            profile_data: profile.to_bytes(),
            profile_name: label(&profile.description),
            name: label(&doc.name),
            numeric: false,
        }),
    ))
}
pub(super) fn mismatch(engine: &Session, pixels: &Pixels) -> Result<Option<Value>, String> {
    let doc = &engine.active().ok_or("No paste target")?.doc;
    let target = document_profile(doc);
    let profile = photocraft_engine::color_cmds::profile_from_bytes(&pixels.profile_data)
        .map_err(|error| error.to_string())?;
    if profile.same_colors(&target) {
        return Ok(None);
    }
    Ok(Some(
        json!({"sourceName":pixels.name,"sourceProfile":pixels.profile_name,"targetProfile":label(&target.description),"sourceMode":format!("{:?}",pixels.clip.surface.format().mode),"targetMode":format!("{:?}",doc.pixel_format().mode),"canKeepNumbers":pixels.clip.surface.format().mode==doc.pixel_format().mode,"policy":engine.color.settings.policy(doc.mode).id(),"intent":engine.color.settings.intent,"bpc":engine.color.settings.bpc}),
    ))
}
pub(super) fn question(
    engine: &mut Session,
    pixels: &Pixels,
    command: &str,
    params: &Value,
) -> Result<Option<Value>, String> {
    if let Some(target) = planes::target(engine, params)? {
        planes::question(engine, target, command)?;
        return Ok(None);
    }
    let previous = engine.clipboard.replace(pixels.clip.clone());
    let disabled = engine.disabled_reason(command);
    engine.clipboard = previous;
    if let Some(reason) = disabled {
        return Err(reason);
    }
    if engine.color.settings.ask_on_paste {
        mismatch(engine, pixels)
    } else {
        Ok(None)
    }
}
pub(super) fn commit_existing(
    session: &mut PhotoSession,
    dir: &std::path::Path,
    request: &str,
    project: &str,
    photo: &str,
    command: &str,
    params: &Value,
    token: Option<&str>,
    choice: Option<&str>,
    warnings: Vec<String>,
) -> Result<super::PhotoReply, String> {
    let before = session.engine.active().cloned().ok_or("No image target")?;
    let previous_clip = session.engine.clipboard.clone();
    let version = session.version.clone();
    let journal = session.engine.journal.clone();
    let result = (|| {
        let (value, copied) = if is_copy(command) {
            let (value, pixels) = copy(&mut session.engine, command, params.clone())?;
            (value, Some(pixels))
        } else if let Some(token) = token {
            (
                execute_decision(
                    request,
                    project,
                    photo,
                    token,
                    session,
                    command,
                    params,
                    choice.ok_or("Choose a paste color action")?,
                )?,
                None,
            )
        } else {
            let settings = session.engine.color.settings.clone();
            (
                paste(
                    &mut session.engine,
                    current()?.as_ref(),
                    command,
                    params.clone(),
                    None,
                    &settings,
                )?,
                None,
            )
        };
        if !Arc::ptr_eq(
            &before.doc,
            &session.engine.active().ok_or("No image target")?.doc,
        ) {
            super::publish(dir, photo, session)?;
        }
        let mut response = super::reply(dir, photo, session, warnings.clone())?;
        response.result = Some(value);
        response.state["clipboard"] = summary()?;
        remember(
            request,
            project,
            photo,
            Some(version.clone()),
            command,
            params.clone(),
            session,
            warnings,
        )?;
        if let Some(copied) = copied {
            response.state["clipboard"] = describe(&copied);
            set(copied)?;
        }
        if let Some(token) = token {
            finish(token)?;
        }
        Ok(response)
    })();
    if result.is_err() {
        if let Some(active) = session.engine.active_mut() {
            *active = before;
        }
        session.engine.clipboard = previous_clip;
        session.version = version;
        session.engine.journal = journal;
        session.writer = Default::default();
    }
    result
}
pub(super) fn paste(
    engine: &mut Session,
    pixels: &Pixels,
    command: &str,
    params: Value,
    choice: Option<&str>,
    settings: &photocraft_engine::color_cmds::ColorSettings,
) -> Result<Value, String> {
    if is_copy(command) || !is_command(command) {
        return Err("Choose a paste command".into());
    }
    if command != "file.newFromClipboard" {
        if let Some(target) = planes::target(engine, &params)? {
            return planes::paste(engine, target, &pixels.clip, command, &params);
        }
    }
    let previous = engine.clipboard.clone();
    let mut clip = pixels.clip.clone();
    if command != "file.newFromClipboard" {
        let doc = &engine.active().ok_or("No paste target")?.doc;
        let destination = document_profile(doc);
        let same_mode = clip.surface.format().mode == doc.pixel_format().mode;
        let convert = match choice {
            Some("convert") => true,
            Some("numbers") if same_mode => false,
            Some(_) => return Err("This paste color choice is unavailable".into()),
            None => settings.policy(doc.mode) != Policy::Off || !same_mode,
        };
        let profile = photocraft_engine::color_cmds::profile_from_bytes(&pixels.profile_data)
            .map_err(|error| error.to_string())?;
        if convert && !profile.same_colors(&destination) {
            let format = clip.surface.format();
            let mut proxy = Document::new(
                "Clipboard",
                photocraft_engine::doc::Size::new(clip.bounds.width(), clip.bounds.height()),
                format.mode,
                format.sample,
            );
            proxy.icc_profile = Some(pixels.profile_data.clone());
            let mut layer = Layer::raster("Clipboard", format);
            *layer.surface_mut().ok_or("No clipboard pixels")? = clip.surface.clone();
            proxy.layers.push(layer);
            super::color_conversion::convert(
                &mut proxy,
                doc.depth,
                settings.dither,
                clip.bounds,
                |working| {
                    photocraft_engine::color_cmds::convert_document(
                        working,
                        &destination,
                        settings.intent(),
                        settings.bpc,
                    )
                },
            )
            .map_err(|error| error.to_string())?;
            clip.surface = proxy.layers[0]
                .surface()
                .ok_or("No converted clipboard pixels")?
                .clone();
        }
    }
    engine.clipboard = Some(clip);
    let result = engine
        .execute(command, params)
        .map_err(|error| error.to_string());
    engine.clipboard = previous;
    if command == "file.newFromClipboard" && result.is_ok() {
        let profile = pixels.profile_data.clone();
        engine
            .edit("Clipboard Profile", move |doc, _| {
                doc.icc_profile = Some(profile);
                Ok(())
            })
            .map_err(|error| error.to_string())?;
        let state = engine.active_mut().ok_or("No clipboard image")?;
        state.history = Default::default();
        state.revision = 0;
        state.saved_revision = 0;
    }
    result
}
pub(super) fn validate(command: &str, params: &Value) -> Result<(), String> {
    if !is_command(command) || !params.is_object() || params.to_string().len() > 8192 {
        return Err("Invalid image clipboard operation".into());
    }
    if let Some(target) = params.get("target") {
        let valid = target
            .as_str()
            .is_some_and(|value| ["pixels", "mask", "quickMask"].contains(&value))
            || target.as_object().is_some_and(|object| {
                object.len() == 1
                    && ["channel", "color"].iter().any(|key| {
                        object
                            .get(*key)
                            .is_some_and(|value| value.as_u64().is_some_and(|index| index <= 64))
                    })
            });
        if !valid || command == "file.newFromClipboard" {
            return Err("Invalid image clipboard target".into());
        }
    }
    if let Some(center) = params.get("center") {
        if center.as_array().is_none_or(|values| {
            values.len() != 2
                || values.iter().any(|value| {
                    value
                        .as_f64()
                        .is_none_or(|value| !value.is_finite() || value.abs() > 16_777_216.0)
                })
        }) {
            return Err("Choose a finite paste center within the image coordinate limit".into());
        }
    }
    if params.get("coalesce").is_some_and(|value| {
        value
            .as_str()
            .is_none_or(|value| value.len() > 512 || value.chars().any(char::is_control))
    }) {
        return Err("Invalid paste history group".into());
    }
    Ok(())
}
struct Pending {
    request: String,
    document: Arc<Document>,
    active_layer: Option<photocraft_engine::doc::LayerId>,
    project: String,
    photo: String,
    version: String,
    view: String,
    command: String,
    params: Value,
    pixels: Arc<Pixels>,
    settings: photocraft_engine::color_cmds::ColorSettings,
    created: Instant,
}
fn pending() -> &'static Mutex<HashMap<String, Arc<Pending>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Arc<Pending>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    token: String,
    request_id: String,
    project_id: String,
    photo_id: String,
    version: String,
    view_key: String,
    command: String,
    report: Value,
    choices: Vec<&'static str>,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum Reply {
    Ready(super::PhotoReply),
    Decision {
        #[serde(rename = "pasteDecision")]
        paste_decision: Decision,
    },
    Canceled {
        #[serde(rename = "pasteCanceled")]
        paste_canceled: bool,
    },
}
pub(super) fn stage(
    request: &str,
    project: &str,
    photo: &str,
    session: &PhotoSession,
    command: &str,
    params: &Value,
    pixels: Arc<Pixels>,
    report: Value,
) -> Result<Reply, String> {
    let mut entries = pending()
        .lock()
        .map_err(|_| "Image paste needs to be restarted")?;
    entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(900));
    if entries.len() >= 2 {
        return Err("Finish or cancel the current paste before starting another".into());
    }
    if entries
        .values()
        .any(|entry| entry.project == project && entry.photo == photo)
    {
        return Err("This image already has a paste decision".into());
    }
    let token = ulid::Ulid::new().to_string();
    let view = super::color_views::key(&session.engine)?;
    let choices = if report["canKeepNumbers"] == true {
        vec!["convert", "numbers"]
    } else {
        vec!["convert"]
    };
    let decision = Decision {
        token: token.clone(),
        request_id: request.into(),
        project_id: project.into(),
        photo_id: photo.into(),
        version: session.version.clone(),
        view_key: view.clone(),
        command: command.into(),
        report,
        choices,
    };
    entries.insert(
        token,
        Arc::new(Pending {
            request: request.into(),
            document: session
                .engine
                .active()
                .ok_or("No paste target")?
                .doc
                .clone(),
            active_layer: session
                .engine
                .active()
                .ok_or("No paste target")?
                .active_layer,
            project: project.into(),
            photo: photo.into(),
            version: session.version.clone(),
            view,
            command: command.into(),
            params: params.clone(),
            pixels,
            settings: session.engine.color.settings.clone(),
            created: Instant::now(),
        }),
    );
    Ok(Reply::Decision {
        paste_decision: decision,
    })
}
pub(super) fn cancel(request: &str, project: &str, photo: &str, token: &str) -> Result<(), String> {
    let mut entries = pending()
        .lock()
        .map_err(|_| "Image paste needs to be restarted")?;
    if entries.get(token).is_some_and(|entry| {
        entry.request != request || entry.project != project || entry.photo != photo
    }) {
        return Err("This paste belongs to another image".into());
    }
    entries.remove(token);
    Ok(())
}
pub(super) fn finish(token: &str) -> Result<(), String> {
    pending()
        .lock()
        .map_err(|_| "Image paste needs to be restarted")?
        .remove(token);
    Ok(())
}
pub(super) fn execute_decision(
    request: &str,
    project: &str,
    photo: &str,
    token: &str,
    session: &mut PhotoSession,
    command: &str,
    params: &Value,
    choice: &str,
) -> Result<Value, String> {
    let mut entries = pending()
        .lock()
        .map_err(|_| "Image paste needs to be restarted")?;
    entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(900));
    let entry = entries
        .get(token)
        .filter(|entry| entry.project == project && entry.photo == photo)
        .cloned()
        .ok_or("This paste decision expired; paste the image again")?;
    drop(entries);
    let active = session.engine.active().ok_or("No paste target")?;
    if !Arc::ptr_eq(&entry.document, &active.doc)
        || entry.active_layer != active.active_layer
        || entry.request != request
        || entry.version != session.version
        || entry.view != super::color_views::key(&session.engine)?
        || entry.command != command
        || entry.params != *params
    {
        return Err("The paste target changed; review the current image before pasting".into());
    }
    paste(
        &mut session.engine,
        &entry.pixels,
        command,
        params.clone(),
        Some(choice),
        &entry.settings,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn serial() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("xdesign-clipboard-{}", ulid::Ulid::new()));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    pub(super) fn fixture(mode: &str, depth: u32, profile: &str) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":20,"height":16,"mode":mode,"depth":depth,"background":"#50a0c080"}),
            )
            .unwrap();
        engine
            .execute("edit.assignProfile", json!({"profile":profile}))
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[4,4],[14,10]],"size":5,"color":"#d04080","opacity":0.6,"seed":3}),
            )
            .unwrap();
        engine
    }
    fn surface(engine: &Session) -> &photocraft_raster::Surface {
        let state = engine.active().unwrap();
        state
            .doc
            .layer(state.active_layer.unwrap())
            .unwrap()
            .surface()
            .unwrap()
    }
    pub(super) fn session(engine: Session) -> PhotoSession {
        PhotoSession {
            engine,
            color_settings: None,
            version: ulid::Ulid::new().to_string(),
            original_path: None,
            writer: Default::default(),
        }
    }
    #[test]
    fn clipboard_copy_cut_and_merged_keep_native_format_selection_alpha_and_source_profile() {
        let _guard = serial();
        for (mode, profile) in [
            ("rgb", "display-p3"),
            ("gray", "gray-gamma-2.2"),
            ("cmyk", "coated-cmyk"),
            ("lab", "lab-d50"),
        ] {
            for depth in [8, 16, 32] {
                for command in ["edit.copy", "edit.copyMerged", "edit.cut"] {
                    let mut actual = fixture(mode, depth, profile);
                    actual
                        .execute(
                            "select.rect",
                            json!({"x":3,"y":2,"width":10,"height":8,"feather":1}),
                        )
                        .unwrap();
                    let before = actual.active().unwrap().clone();
                    let mut expected = Session::new();
                    expected.add_document((*before.doc).clone(), None);
                    *expected.active_mut().unwrap() = before.clone();
                    let result = expected.execute(command, json!({})).unwrap();
                    let (value, copied) = copy(&mut actual, command, json!({})).unwrap();
                    assert_eq!(value, result);
                    let native = expected.clipboard.as_ref().unwrap();
                    assert_eq!(copied.clip.bounds, native.bounds);
                    assert_eq!(copied.clip.surface.format(), native.surface.format());
                    assert_eq!(
                        copied.clip.surface.read_region(native.bounds),
                        native.surface.read_region(native.bounds)
                    );
                    assert_eq!(
                        copied.profile_data.clone(),
                        before.doc.icc_profile.clone().unwrap()
                    );
                    assert_eq!(
                        photocraft_compose::render(
                            &actual.active().unwrap().doc,
                            before.doc.bounds()
                        )
                        .px,
                        photocraft_compose::render(
                            &expected.active().unwrap().doc,
                            before.doc.bounds()
                        )
                        .px
                    );
                    if command != "edit.cut" {
                        assert!(Arc::ptr_eq(&before.doc, &actual.active().unwrap().doc));
                    } else {
                        actual.execute("edit.undo", json!({})).unwrap();
                        assert_eq!(&*actual.active().unwrap().doc, &*before.doc);
                    }
                    set(copied.clone()).unwrap();
                    drop(actual);
                    assert!(Arc::ptr_eq(&current().unwrap(), &copied));
                }
            }
        }
    }
    #[test]
    fn clipboard_profile_conversion_uses_destination_precision_and_matches_native_paste_geometry_masks_and_undo(
    ) {
        let _guard = serial();
        for source_depth in [8, 16, 32] {
            let mut source = fixture("rgb", source_depth, "display-p3");
            source
                .execute(
                    "select.rect",
                    json!({"x":3,"y":2,"width":10,"height":8,"feather":1}),
                )
                .unwrap();
            let (_, copied) = copy(&mut source, "edit.copy", json!({})).unwrap();
            let retained = copied.clip.surface.read_region(copied.clip.bounds);
            for depth in [8, 16, 32] {
                for (command, choice) in [
                    ("edit.paste", "convert"),
                    ("edit.pasteSpecial.pasteInPlace", "numbers"),
                    ("edit.pasteSpecial.pasteInto", "convert"),
                    ("edit.pasteSpecial.pasteOutside", "convert"),
                ] {
                    let mut actual = fixture("rgb", depth, "srgb");
                    actual.color.settings.dither = false;
                    actual
                        .execute(
                            "select.rect",
                            json!({"x":8,"y":6,"width":7,"height":6,"feather":1}),
                        )
                        .unwrap();
                    let before = actual.active().unwrap().clone();
                    let mut expected = Session::new();
                    expected.add_document((*before.doc).clone(), None);
                    *expected.active_mut().unwrap() = before.clone();
                    let mut clip = copied.clip.clone();
                    if choice == "convert" {
                        let fmt = clip.surface.format();
                        let mut proxy = (*source.active().unwrap().doc).clone();
                        proxy.depth = if source_depth == depth {
                            before.doc.depth
                        } else {
                            photocraft_engine::doc::SampleType::F32
                        };
                        proxy.layers.clear();
                        proxy.selection = None;
                        let mut layer = Layer::raster("Copied", fmt);
                        *layer.surface_mut().unwrap() =
                            clip.surface.convert(photocraft_engine::doc::PixelFormat {
                                sample: proxy.depth,
                                ..fmt
                            });
                        proxy.layers.push(layer);
                        photocraft_engine::color_cmds::convert_document(
                            &mut proxy,
                            &document_profile(&before.doc),
                            expected.color.settings.intent(),
                            expected.color.settings.bpc,
                        )
                        .unwrap();
                        clip.surface = proxy.layers[0].surface().unwrap().convert(
                            photocraft_engine::doc::PixelFormat {
                                sample: before.doc.depth,
                                ..proxy.layers[0].surface().unwrap().format()
                            },
                        );
                    }
                    expected.clipboard = Some(clip);
                    let params = json!({"center":[9.5,7.25]});
                    let oracle = expected.execute(command, params.clone()).unwrap();
                    let settings = actual.color.settings.clone();
                    let result = paste(
                        &mut actual,
                        &copied,
                        command,
                        params,
                        Some(choice),
                        &settings,
                    )
                    .unwrap();
                    assert_eq!(result["offset"], oracle["offset"]);
                    assert_eq!(surface(&actual).format(), surface(&expected).format());
                    let area = surface(&actual)
                        .content_bounds()
                        .union(&surface(&expected).content_bounds());
                    assert_eq!(
                        surface(&actual).read_region(area),
                        surface(&expected).read_region(area),
                        "{source_depth}/{depth}/{command}/{choice}"
                    );
                    assert_eq!(
                        photocraft_compose::render(
                            &actual.active().unwrap().doc,
                            before.doc.bounds()
                        )
                        .px,
                        photocraft_compose::render(
                            &expected.active().unwrap().doc,
                            before.doc.bounds()
                        )
                        .px
                    );
                    assert_eq!(
                        actual.active().unwrap().doc.icc_profile,
                        before.doc.icc_profile
                    );
                    actual.execute("edit.undo", json!({})).unwrap();
                    assert_eq!(&*actual.active().unwrap().doc, &*before.doc);
                    assert_eq!(
                        copied.clip.surface.read_region(copied.clip.bounds),
                        retained
                    );
                    assert!(actual.clipboard.is_none());
                }
            }
        }
    }
    #[test]
    fn clipboard_cross_mode_and_automatic_policies_preserve_source_and_reject_meaningless_numeric_choices(
    ) {
        let _guard = serial();
        let mut source = fixture("rgb", 16, "display-p3");
        let (_, copied) = copy(&mut source, "edit.copyMerged", json!({})).unwrap();
        for (mode, profile) in [
            ("gray", "sgray"),
            ("cmyk", "coated-cmyk"),
            ("lab", "lab-d50"),
        ] {
            let mut target = fixture(mode, 16, profile);
            assert_eq!(
                mismatch(&target, &copied).unwrap().unwrap()["canKeepNumbers"],
                false
            );
            let before = target.active().unwrap().doc.clone();
            let settings = target.color.settings.clone();
            assert!(paste(
                &mut target,
                &copied,
                "edit.paste",
                json!({}),
                Some("numbers"),
                &settings
            )
            .is_err());
            assert!(Arc::ptr_eq(&before, &target.active().unwrap().doc));
            target.color.settings.ask_on_paste = false;
            assert!(question(&mut target, &copied, "edit.paste", &json!({}))
                .unwrap()
                .is_none());
            target.color.settings.ask_on_paste = true;
            assert!(question(&mut target, &copied, "edit.paste", &json!({}))
                .unwrap()
                .is_some());
            let settings = target.color.settings.clone();
            paste(
                &mut target,
                &copied,
                "edit.paste",
                json!({}),
                None,
                &settings,
            )
            .unwrap();
            assert_eq!(surface(&target).format().mode, before.pixel_format().mode);
            assert_eq!(target.active().unwrap().doc.icc_profile, before.icc_profile);
        }
        for policy in [Policy::Preserve, Policy::Convert, Policy::Off] {
            let mut actual = fixture("rgb", 16, "srgb");
            let mut expected = Session::new();
            let before = actual.active().unwrap().clone();
            expected.add_document((*before.doc).clone(), None);
            *expected.active_mut().unwrap() = before;
            actual.color.settings.policy_rgb = policy;
            let settings = actual.color.settings.clone();
            paste(
                &mut actual,
                &copied,
                "edit.paste",
                json!({}),
                None,
                &settings,
            )
            .unwrap();
            let expected_settings = expected.color.settings.clone();
            paste(
                &mut expected,
                &copied,
                "edit.paste",
                json!({}),
                Some(if policy == Policy::Off {
                    "numbers"
                } else {
                    "convert"
                }),
                &expected_settings,
            )
            .unwrap();
            let area = surface(&actual).content_bounds();
            assert_eq!(
                surface(&actual).read_region(area),
                surface(&expected).read_region(area)
            );
        }
    }
    #[test]
    fn clipboard_new_image_preserves_copied_format_position_profile_and_empty_import_history() {
        let _guard = serial();
        let root = Temp::new();
        for (mode, profile) in [
            ("rgb", "display-p3"),
            ("gray", "gray-gamma-2.2"),
            ("cmyk", "coated-cmyk"),
            ("lab", "lab-d50"),
        ] {
            for depth in [8, 16, 32] {
                let mut source = fixture(mode, depth, profile);
                source
                    .execute("select.rect", json!({"x":3,"y":2,"width":10,"height":8}))
                    .unwrap();
                let (_, copied) = copy(&mut source, "edit.copy", json!({})).unwrap();
                let mut engine = Session::new();
                let settings = engine.color.settings.clone();
                paste(
                    &mut engine,
                    &copied,
                    "file.newFromClipboard",
                    json!({}),
                    None,
                    &settings,
                )
                .unwrap();
                let doc = engine.active().unwrap().doc.clone();
                assert_eq!(doc.size.width, copied.clip.bounds.width());
                assert_eq!(doc.size.height, copied.clip.bounds.height());
                assert_eq!(
                    doc.pixel_format().sample,
                    copied.clip.surface.format().sample
                );
                assert_eq!(
                    doc.icc_profile.as_ref().unwrap(),
                    &copied.profile_data.clone()
                );
                assert_eq!(
                    surface(&engine).read_region(doc.bounds()),
                    copied.clip.surface.read_region(copied.clip.bounds)
                );
                assert_eq!(engine.active().unwrap().history.past_len(), 0);
                let mut session = session(engine);
                let id = ulid::Ulid::new().to_string();
                let dir = root.0.join(&id);
                super::super::publish(&dir, &id, &mut session).unwrap();
                let reopened = super::super::restore(&dir, &session.version, None).unwrap();
                assert_eq!(&*reopened.engine.active().unwrap().doc, &*doc);
                assert_eq!(reopened.engine.active().unwrap().history.past_len(), 0);
                for extension in ["psd", "psb"] {
                    let data = photocraft_io::export(&doc, extension, &Default::default())
                        .unwrap()
                        .bytes;
                    let reopened = photocraft_io::import(extension, &data).unwrap().document;
                    assert_eq!(
                        reopened.icc_profile.as_ref().unwrap(),
                        &copied.profile_data.clone()
                    );
                }
            }
        }
    }

    #[test]
    fn clipboard_conversion_dither_uses_reviewed_settings_only_at_eight_bit_and_preserves_source_alpha(
    ) {
        let _serial = serial();
        let mut source = fixture("rgb", 16, "display-p3");
        source
            .execute(
                "select.rect",
                json!({"x":3,"y":2,"width":10,"height":8,"feather":1}),
            )
            .unwrap();
        let (_, copied) = copy(&mut source, "edit.copy", json!({})).unwrap();
        let retained = copied.clip.surface.clone();
        for depth in [8, 16, 32] {
            for profile in ["srgb", "display-p3"] {
                let mut enabled = fixture("rgb", depth, profile);
                let before = enabled.active().unwrap().doc.clone();
                let past = enabled.active().unwrap().history.past_len();
                let mut disabled = Session::new();
                disabled.add_document((*before).clone(), None);
                *disabled.active_mut().unwrap() = enabled.active().unwrap().clone();
                let mut settings = enabled.color.settings.clone();
                settings.dither = true;
                paste(
                    &mut enabled,
                    &copied,
                    "edit.paste",
                    json!({}),
                    Some("convert"),
                    &settings,
                )
                .unwrap();
                settings.dither = false;
                paste(
                    &mut disabled,
                    &copied,
                    "edit.paste",
                    json!({}),
                    Some("convert"),
                    &settings,
                )
                .unwrap();
                let area = surface(&enabled)
                    .content_bounds()
                    .union(&surface(&disabled).content_bounds());
                let a = surface(&enabled).read_region(area);
                let b = surface(&disabled).read_region(area);
                assert_eq!(
                    a == b,
                    depth != 8 || profile == "display-p3",
                    "{depth}/{profile}"
                );
                assert!(a
                    .chunks_exact(4)
                    .zip(b.chunks_exact(4))
                    .all(|(a, b)| a[3] == b[3]));
                assert_eq!(enabled.active().unwrap().history.past_len(), past + 1);
                enabled.execute("edit.undo", json!({})).unwrap();
                assert_eq!(&*enabled.active().unwrap().doc, &*before);
                assert_eq!(copied.clip.surface, retained);
            }
        }
    }
    #[test]
    fn clipboard_pending_decisions_pin_pixels_and_guard_target_retry_cancel_expiry_and_receipts() {
        let _guard = serial();
        let root = Temp::new();
        let mut source = fixture("rgb", 16, "display-p3");
        let (_, copied) = copy(&mut source, "edit.copy", json!({})).unwrap();
        let mut target = session(fixture("rgb", 16, "srgb"));
        let project = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        let request = ulid::Ulid::new().to_string();
        let params = json!({});
        let report = question(&mut target.engine, &copied, "edit.paste", &json!({}))
            .unwrap()
            .unwrap();
        let Reply::Decision { paste_decision } = stage(
            &request,
            &project,
            &photo,
            &target,
            "edit.paste",
            &params,
            copied.clone(),
            report,
        )
        .unwrap() else {
            panic!()
        };
        let original = target.engine.active().unwrap().doc.clone();
        let original_journal = target.engine.journal.clone();
        let version = target.version.clone();
        let mut replacement = fixture("rgb", 8, "srgb");
        let (_, new_clip) = copy(&mut replacement, "edit.copy", json!({})).unwrap();
        set(new_clip.clone()).unwrap();
        assert!(execute_decision(
            &ulid::Ulid::new().to_string(),
            &project,
            &photo,
            &paste_decision.token,
            &mut target,
            "edit.paste",
            &params,
            "convert"
        )
        .is_err());
        let failed = root.0.join("blocked");
        std::fs::write(&failed, b"file").unwrap();
        assert!(commit_existing(
            &mut target,
            &failed,
            &request,
            &project,
            &photo,
            "edit.paste",
            &params,
            Some(&paste_decision.token),
            Some("convert"),
            Vec::new()
        )
        .is_err());
        assert!(Arc::ptr_eq(&original, &target.engine.active().unwrap().doc));
        assert_eq!(target.version, version);
        assert_eq!(target.engine.journal, original_journal);
        assert!(pending()
            .lock()
            .unwrap()
            .contains_key(&paste_decision.token));
        assert!(Arc::ptr_eq(&current().unwrap(), &new_clip));
        let response = commit_existing(
            &mut target,
            &root.0.join("image"),
            &request,
            &project,
            &photo,
            "edit.paste",
            &params,
            Some(&paste_decision.token),
            Some("convert"),
            Vec::new(),
        )
        .unwrap();
        assert_ne!(response.document.version, version);
        let ack = receipt(
            &request,
            &project,
            &photo,
            &Some(version.clone()),
            "edit.paste",
            &params,
        )
        .unwrap()
        .unwrap();
        assert_eq!(ack.output_version, target.version);
        assert!(!pending()
            .lock()
            .unwrap()
            .contains_key(&paste_decision.token));
        assert!(receipt(
            &request,
            &project,
            &photo,
            &Some(version),
            "edit.pasteSpecial.pasteInPlace",
            &params
        )
        .is_err());
        let view = super::super::color_views::key(&target.engine).unwrap();
        let report = mismatch(&target.engine, &copied).unwrap().unwrap();
        let second = ulid::Ulid::new().to_string();
        let Reply::Decision { paste_decision } = stage(
            &second,
            &project,
            &photo,
            &target,
            "edit.paste",
            &params,
            copied,
            report,
        )
        .unwrap() else {
            panic!()
        };
        target
            .engine
            .execute("select.rect", json!({"x":1,"y":1,"width":3,"height":3}))
            .unwrap();
        assert_eq!(
            super::super::color_views::key(&target.engine).unwrap(),
            view
        );
        target.version = ulid::Ulid::new().to_string();
        assert!(execute_decision(
            &second,
            &project,
            &photo,
            &paste_decision.token,
            &mut target,
            "edit.paste",
            &params,
            "convert"
        )
        .is_err());
        assert!(cancel(&request, &project, &photo, &paste_decision.token).is_err());
        Arc::get_mut(
            pending()
                .lock()
                .unwrap()
                .get_mut(&paste_decision.token)
                .unwrap(),
        )
        .unwrap()
        .created = Instant::now() - Duration::from_secs(901);
        assert!(execute_decision(
            &second,
            &project,
            &photo,
            &paste_decision.token,
            &mut target,
            "edit.paste",
            &params,
            "convert"
        )
        .is_err());
        cancel(&second, &project, &photo, &paste_decision.token).unwrap();
        cancel(&second, &project, &photo, &paste_decision.token).unwrap();
    }
    #[test]
    fn clipboard_invalid_parameters_and_non_layer_targets_do_not_mutate_image_or_clipboard() {
        let _guard = serial();
        let mut source = fixture("rgb", 8, "display-p3");
        let (_, copied) = copy(&mut source, "edit.copy", json!({})).unwrap();
        let mut engine = fixture("rgb", 8, "srgb");
        let before = engine.active().unwrap().doc.clone();
        for params in [
            json!([]),
            json!({"center":[1]}),
            json!({"center":["x",2]}),
            json!({"center":[16_777_217,2]}),
            json!({"coalesce":true}),
            json!({"big":"x".repeat(8192)}),
        ] {
            assert!(validate("edit.paste", &params).is_err());
        }
        assert!(validate("edit.profileInfo", &json!({})).is_err());
        assert!(question(
            &mut engine,
            &copied,
            "edit.pasteSpecial.pasteInto",
            &json!({})
        )
        .is_err());
        engine
            .execute("channel.target", json!({"channel":"red"}))
            .unwrap();
        let journal = engine.journal.clone();
        assert!(copy(&mut engine, "edit.copy", json!({"target":{"channel":64}})).is_err());
        let settings = engine.color.settings.clone();
        assert!(paste(
            &mut engine,
            &copied,
            "edit.paste",
            json!({"target":"mask"}),
            Some("convert"),
            &settings
        )
        .is_err());
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        assert!(engine.clipboard.is_none());
        assert_eq!(engine.journal, journal);
        assert!(label(&"🙂".repeat(4096)).len() <= 4096);
    }
}
