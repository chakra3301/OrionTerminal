use super::{color_settings, profiles, PhotoSession};
use photocraft_engine::{
    color_cmds::Policy,
    doc::{ColorMode, Document},
    Session,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

struct Pending {
    project: String,
    photo: String,
    doc: Arc<Document>,
    context: Arc<color_settings::Context>,
    report: Value,
    warnings: Vec<String>,
    source: Option<String>,
    created: Instant,
}
fn pending() -> &'static Mutex<HashMap<String, Arc<Pending>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Arc<Pending>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}
#[derive(Clone)]
pub(super) struct Receipt {
    pub(super) version: String,
    pub(super) source: Option<String>,
    pub(super) warnings: Vec<String>,
    project: String,
    photo: String,
    created: Instant,
}
fn receipts() -> &'static Mutex<HashMap<String, Receipt>> {
    static RECEIPTS: OnceLock<Mutex<HashMap<String, Receipt>>> = OnceLock::new();
    RECEIPTS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub(super) fn receipt(project: &str, photo: &str, token: &str) -> Result<Option<Receipt>, String> {
    super::id(project)?;
    super::id(photo)?;
    super::id(token)?;
    let mut entries = receipts()
        .lock()
        .map_err(|_| "Image import needs to be restarted")?;
    entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(15 * 60));
    if let Some(entry) = entries.get(token) {
        if entry.project != project || entry.photo != photo {
            return Err("This import belongs to another image".into());
        }
    }
    Ok(entries.get(token).cloned())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub(super) token: String,
    pub(super) project_id: String,
    pub(super) photo_id: String,
    report: Value,
    settings: Value,
    choices: Vec<&'static str>,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum OpenResult {
    Ready(super::PhotoReply),
    Decision {
        #[serde(rename = "colorDecision")]
        color_decision: Decision,
    },
}
fn choices(report: &Value) -> Vec<&'static str> {
    if report["missing"] == true {
        vec!["preserve", "assignWorking", "assignProfile"]
    } else {
        vec!["preserve", "convert", "discard"]
    }
}
fn sweep(entries: &mut HashMap<String, Arc<Pending>>) {
    entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(15 * 60));
}
pub(super) fn stage(
    project: &str,
    photo: &str,
    session: &PhotoSession,
    report: Value,
    warnings: Vec<String>,
) -> Result<OpenResult, String> {
    let mut entries = pending()
        .lock()
        .map_err(|_| "Image import needs to be restarted")?;
    sweep(&mut entries);
    if entries.len() >= 2 {
        return Err("Finish or cancel the current image import before opening another".into());
    }
    if entries
        .values()
        .any(|entry| entry.project == project && entry.photo == photo)
    {
        return Err("This image already has a pending color decision".into());
    }
    let context = session
        .color_settings
        .clone()
        .ok_or("No import color settings")?;
    let token = ulid::Ulid::new().to_string();
    let decision = Decision {
        token: token.clone(),
        project_id: project.into(),
        photo_id: photo.into(),
        choices: choices(&report),
        report: report.clone(),
        settings: context.describe(),
    };
    entries.insert(
        token,
        Arc::new(Pending {
            project: project.into(),
            photo: photo.into(),
            doc: session
                .engine
                .active()
                .ok_or("No imported image")?
                .doc
                .clone(),
            context,
            report,
            warnings,
            source: session.original_path.clone(),
            created: Instant::now(),
        }),
    );
    Ok(OpenResult::Decision {
        color_decision: decision,
    })
}
fn automatic(engine: &Session, report: &Value) -> &'static str {
    if report["missing"] == true {
        let state = engine.active().unwrap();
        let mode = state.doc.mode;
        if engine.color.settings.policy(mode) != Policy::Off
            && engine.color.working(mode).content_hash()
                != photocraft_engine::color_cmds::ColorState::default()
                    .working(mode)
                    .content_hash()
        {
            "assignWorking"
        } else {
            "preserve"
        }
    } else if report["mismatch"] == true && report.get("ask").is_some() {
        match engine
            .color
            .settings
            .policy(engine.active().unwrap().doc.mode)
        {
            Policy::Convert => "convert",
            Policy::Off => "discard",
            Policy::Preserve => "preserve",
        }
    } else {
        "preserve"
    }
}
pub(super) fn apply(engine: &mut Session, report: &Value, params: &Value) -> Result<Value, String> {
    if !params.is_object() || params.to_string().len() > profiles::PARAMETER_BYTES {
        return Err("Invalid import color decision".into());
    }
    let action = params["action"]
        .as_str()
        .ok_or("Choose an import color action")?;
    if params
        .get("convertToWorking")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err("Invalid working-space conversion choice".into());
    }
    if action != "automatic" && !choices(report).contains(&action) {
        return Err("This color action is unavailable for the imported image".into());
    }
    let action = if action == "automatic" {
        automatic(engine, report)
    } else {
        action
    };
    let result = if action == "assignProfile" {
        let spec = params["profile"]
            .as_str()
            .ok_or("Choose an ICC profile for this image")?;
        if matches!(spec, "none" | "remove" | "untagged") {
            return Err("Choose an ICC profile for this image".into());
        }
        let mut result = profiles::run(engine, "edit.assignProfile", params)?;
        if params["convertToWorking"] == true {
            result = super::color_conversion::execute(
                engine,
                "color.profileMismatch",
                &json!({"action":"convert"}),
            )
            .ok_or("Working-space conversion is unavailable")??;
        }
        result
    } else {
        let params = json!({"action":action});
        super::color_conversion::execute(engine, "color.profileMismatch", &params).unwrap_or_else(
            || {
                engine
                    .execute("color.profileMismatch", params)
                    .map_err(|e| e.to_string())
            },
        )?
    };
    let state = engine.active_mut().ok_or("No imported image")?;
    state.history = Default::default();
    state.revision = 0;
    state.saved_revision = 0;
    state.last_damage = None;
    Ok(result)
}
pub(super) fn prepare(
    project: &str,
    photo: &str,
    token: &str,
    params: &Value,
) -> Result<Option<(PhotoSession, Vec<String>)>, String> {
    super::id(project)?;
    super::id(photo)?;
    super::id(token)?;
    if !params.is_object() || params.to_string().len() > profiles::PARAMETER_BYTES {
        return Err("Invalid import color decision".into());
    }
    let mut entries = pending()
        .lock()
        .map_err(|_| "Image import needs to be restarted")?;
    sweep(&mut entries);
    if params["action"] == "cancel" {
        if entries
            .get(token)
            .is_some_and(|entry| entry.project != project || entry.photo != photo)
        {
            return Err("This import belongs to another image".into());
        }
        entries.remove(token);
        return Ok(None);
    }
    let entry = entries
        .get(token)
        .filter(|entry| entry.project == project && entry.photo == photo)
        .cloned()
        .ok_or("This import decision expired; open the image again")?;
    drop(entries);
    let mut engine = Session::new();
    entry.context.install(&mut engine);
    engine.add_document((*entry.doc).clone(), None);
    apply(&mut engine, &entry.report, params)?;
    let session = PhotoSession {
        engine,
        color_settings: Some(entry.context.clone()),
        version: String::new(),
        original_path: entry.source.clone(),
        writer: Default::default(),
    };
    Ok(Some((session, entry.warnings.clone())))
}
pub(super) fn finish(token: &str, version: &str) -> Result<(), String> {
    let mut pending = pending()
        .lock()
        .map_err(|_| "Image import needs to be restarted")?;
    let mut entries = receipts()
        .lock()
        .map_err(|_| "Image import needs to be restarted")?;
    if let Some(entry) = pending.remove(token) {
        if entries.len() >= 4 {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.created)
                .map(|(token, _)| token.clone())
            {
                entries.remove(&oldest);
            }
        }
        entries.insert(
            token.into(),
            Receipt {
                version: version.into(),
                source: entry.source.clone(),
                warnings: entry.warnings.clone(),
                project: entry.project.clone(),
                photo: entry.photo.clone(),
                created: Instant::now(),
            },
        );
    }
    Ok(())
}
pub(super) fn tag_new(engine: &mut Session) -> Result<(), String> {
    let state = engine.active().ok_or("No new image")?;
    let mode = state.doc.mode;
    if !matches!(
        mode,
        ColorMode::Rgb | ColorMode::Cmyk | ColorMode::Grayscale
    ) {
        return Ok(());
    }
    if engine.color.working(mode).content_hash()
        != photocraft_engine::color_cmds::ColorState::default()
            .working(mode)
            .content_hash()
    {
        engine
            .execute("color.profileMismatch", json!({"action":"assignWorking"}))
            .map_err(|e| e.to_string())?;
        let state = engine.active_mut().unwrap();
        state.history = Default::default();
        state.revision = 0;
        state.saved_revision = 0;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("xdesign-color-import-{}", ulid::Ulid::new()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(mode: &str, depth: u32, profile: Option<&str>) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":8,"height":6,"mode":mode,"depth":depth,"background":"#50a0c080"}),
            )
            .unwrap();
        if let Some(profile) = profile {
            engine
                .execute("edit.assignProfile", json!({"profile":profile}))
                .unwrap();
        }
        engine
    }
    #[test]
    fn import_analysis_does_not_apply_conversion_and_respects_same_colors_and_linear_hdr() {
        for depth in [8, 16, 32] {
            let mut engine = fixture("rgb", depth, Some("display-p3"));
            engine.color.settings.policy_rgb = Policy::Convert;
            let source = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.past_len();
            let report = color_settings::analyze(&engine).unwrap();
            assert_eq!(report["mismatch"], true);
            assert_eq!(report["ask"], true);
            assert_eq!(report["policy"], "convert");
            assert_eq!(report["depth"], depth);
            assert!(Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.past_len(), history);
            let same = fixture("rgb", depth, Some("srgb"));
            let report = color_settings::analyze(&same).unwrap();
            assert_eq!(report["mismatch"], false);
            assert_ne!(report["ask"], true);
            let mut missing = fixture("rgb", depth, None);
            missing.color.settings.ask_on_missing = true;
            assert_eq!(color_settings::analyze(&missing).unwrap()["missing"], true);
            assert!(missing.active().unwrap().doc.icc_profile.is_none());
        }
        let hdr = fixture("rgb", 32, Some("linear-srgb"));
        assert_eq!(color_settings::analyze(&hdr).unwrap()["mismatch"], true);
        assert_ne!(color_settings::analyze(&hdr).unwrap()["ask"], true);
        let lab = fixture("lab", 16, None);
        assert_ne!(color_settings::analyze(&lab).unwrap()["ask"], true);
    }
    #[test]
    fn import_automatic_policies_match_published_native_pixels_profiles_across_modes_and_depths() {
        for (mode, embedded, working) in [
            ("rgb", "display-p3", "srgb"),
            ("gray", "gray-gamma-2.2", "sgray"),
            ("cmyk", "coated-cmyk", "coated-cmyk"),
        ] {
            for depth in [8, 16, 32] {
                for policy in [Policy::Preserve, Policy::Convert, Policy::Off] {
                    let mut engine = fixture(mode, depth, Some(embedded));
                    engine.color.settings.dither = false;
                    match mode {
                        "rgb" => {
                            engine.color.settings.working_rgb = working.into();
                            engine.color.settings.policy_rgb = policy;
                        }
                        "gray" => {
                            engine.color.settings.working_gray = working.into();
                            engine.color.settings.policy_gray = policy;
                        }
                        _ => {
                            engine.color.settings.working_cmyk = working.into();
                            engine.color.settings.policy_cmyk = policy;
                        }
                    }
                    let report = color_settings::analyze(&engine).unwrap();
                    let source = engine.active().unwrap().doc.clone();
                    let mut expected = (*source).clone();
                    engine.color.open_policy(&mut expected);
                    apply(&mut engine, &report, &json!({"action":"automatic"})).unwrap();
                    assert_eq!(
                        &*engine.active().unwrap().doc,
                        &expected,
                        "{mode}/{depth}/{policy:?}"
                    );
                    assert_eq!(engine.active().unwrap().history.past_len(), 0);
                    assert_eq!(engine.active().unwrap().revision, 0);
                }
            }
        }
        let mut hdr = fixture("rgb", 32, Some("linear-srgb"));
        hdr.color.settings.policy_rgb = Policy::Convert;
        let source = hdr.active().unwrap().doc.clone();
        let report = color_settings::analyze(&hdr).unwrap();
        apply(&mut hdr, &report, &json!({"action":"automatic"})).unwrap();
        assert_eq!(&*hdr.active().unwrap().doc, &*source);
    }
    #[test]
    fn import_custom_working_and_explicit_assign_convert_preserve_reviewed_bytes_and_export_reopen()
    {
        use base64::Engine;
        let root = Temp::new();
        let rgb = photocraft_engine::color_cmds::ColorState::default()
            .resolve("display-p3", None, None)
            .unwrap()
            .to_bytes()
            .to_vec();
        let context=color_settings::update(&root.0,&json!({"workingRgb":"Deleted.icc","workingRgbData":base64::engine::general_purpose::STANDARD.encode(&rgb),"askOnMissing":true,"dither":false})).unwrap();
        for depth in [8, 16, 32] {
            let mut engine = fixture("rgb", depth, None);
            context.install(&mut engine);
            let original = engine.active().unwrap().doc.clone();
            let pixels = photocraft_compose::render(&original, original.bounds()).px;
            let report = color_settings::analyze(&engine).unwrap();
            apply(&mut engine, &report, &json!({"action":"assignWorking"})).unwrap();
            let doc = engine.active().unwrap().doc.clone();
            assert_eq!(doc.icc_profile.as_ref().unwrap().as_slice(), rgb);
            assert_eq!(photocraft_compose::render(&doc, doc.bounds()).px, pixels);
            for extension in ["png", "psd", "psb"] {
                let name = format!("assigned-{depth}.{extension}");
                let data = photocraft_io::export(&doc, &name, &Default::default())
                    .unwrap()
                    .bytes;
                let reopened = photocraft_io::import(&name, &data).unwrap().document;
                assert_eq!(reopened.icc_profile.as_ref().unwrap().as_slice(), rgb);
            }
            let mut assigned = fixture("rgb", depth, None);
            context.install(&mut assigned);
            let mut expected = Session::new();
            context.install(&mut expected);
            expected.add_document((*assigned.active().unwrap().doc).clone(), None);
            expected
                .execute("edit.assignProfile", json!({"profile":"srgb"}))
                .unwrap();
            expected
                .execute("color.profileMismatch", json!({"action":"convert"}))
                .unwrap();
            apply(
                &mut assigned,
                &report,
                &json!({"action":"assignProfile","profile":"srgb","convertToWorking":true}),
            )
            .unwrap();
            assert_eq!(
                &*assigned.active().unwrap().doc,
                &*expected.active().unwrap().doc
            );
            let mut session = PhotoSession {
                engine: assigned,
                color_settings: Some(context.clone()),
                version: String::new(),
                original_path: None,
                writer: Default::default(),
            };
            let id = ulid::Ulid::new().to_string();
            let dir = root.0.join(&id);
            super::super::publish(&dir, &id, &mut session).unwrap();
            let reopened = super::super::restore(&dir, &session.version, None).unwrap();
            assert_eq!(
                &*reopened.engine.active().unwrap().doc,
                &*session.engine.active().unwrap().doc
            );
            assert_eq!(reopened.engine.active().unwrap().history.past_len(), 0);
        }
    }
    #[test]
    fn import_pending_retains_raw_source_and_settings_for_retry_cancellation_and_acknowledgment() {
        let root = Temp::new();
        let context =
            color_settings::update(&root.0, &json!({"workingRgb":"srgb","policyRgb":"convert"}))
                .unwrap();
        let engine = fixture("rgb", 16, Some("display-p3"));
        let original = engine.active().unwrap().doc.clone();
        let report = color_settings::analyze(&engine).unwrap();
        let session = PhotoSession {
            engine,
            color_settings: Some(context.clone()),
            version: String::new(),
            original_path: Some("Deleted.psd".into()),
            writer: Default::default(),
        };
        let project = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        let OpenResult::Decision {
            color_decision: decision,
        } = stage(
            &project,
            &photo,
            &session,
            report.clone(),
            vec!["Retained warning".into()],
        )
        .unwrap()
        else {
            panic!("missing decision")
        };
        drop(session);
        color_settings::update(&root.0, &json!({"workingRgb":"rec2020"})).unwrap();
        assert!(prepare(
            &project,
            &photo,
            &decision.token,
            &json!({"action":"assignProfile","profile":"none"})
        )
        .is_err());
        assert!(prepare(
            &project,
            &photo,
            &decision.token,
            &json!({"action":"convert","convertToWorking":"true"})
        )
        .is_err());
        assert!(prepare(
            &project,
            &ulid::Ulid::new().to_string(),
            &decision.token,
            &json!({"action":"cancel"})
        )
        .is_err());
        let (mut converted, warnings) = prepare(
            &project,
            &photo,
            &decision.token,
            &json!({"action":"convert"}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(warnings, vec!["Retained warning"]);
        assert_eq!(converted.original_path.as_deref(), Some("Deleted.psd"));
        assert_eq!(converted.engine.color.settings.working_rgb, "srgb");
        let mut expected = Session::new();
        context.install(&mut expected);
        expected.add_document((*original).clone(), None);
        expected
            .execute("color.profileMismatch", json!({"action":"convert"}))
            .unwrap();
        assert_eq!(
            &*converted.engine.active().unwrap().doc,
            &*expected.active().unwrap().doc
        );
        assert_eq!(
            &*pending().lock().unwrap().get(&decision.token).unwrap().doc,
            &*original
        );
        let failed = root.0.join("blocked");
        std::fs::write(&failed, b"file").unwrap();
        assert!(super::super::publish(&failed, &photo, &mut converted).is_err());
        assert!(prepare(
            &project,
            &photo,
            &decision.token,
            &json!({"action":"preserve"})
        )
        .unwrap()
        .is_some());
        let dir = root.0.join("published");
        super::super::publish(&dir, &photo, &mut converted).unwrap();
        finish(&decision.token, &converted.version).unwrap();
        let ack = receipt(&project, &photo, &decision.token).unwrap().unwrap();
        assert_eq!(ack.version, converted.version);
        assert_eq!(ack.source.as_deref(), Some("Deleted.psd"));
        assert!(!pending().lock().unwrap().contains_key(&decision.token));
        assert!(receipt(&project, &ulid::Ulid::new().to_string(), &decision.token).is_err());
        assert!(prepare(
            &project,
            &photo,
            &decision.token,
            &json!({"action":"cancel"})
        )
        .unwrap()
        .is_none());
        let source = PhotoSession {
            engine: fixture("rgb", 8, None),
            color_settings: Some(context),
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        let report = color_settings::analyze(&source.engine).unwrap();
        let mut tokens = Vec::new();
        for _ in 0..2 {
            let next = ulid::Ulid::new().to_string();
            let OpenResult::Decision { color_decision } =
                stage(&project, &next, &source, report.clone(), Vec::new()).unwrap()
            else {
                panic!()
            };
            tokens.push((next, color_decision.token));
        }
        assert!(stage(
            &project,
            &ulid::Ulid::new().to_string(),
            &source,
            report,
            Vec::new()
        )
        .is_err());
        let (next, token) = tokens.pop().unwrap();
        Arc::get_mut(pending().lock().unwrap().get_mut(&token).unwrap())
            .unwrap()
            .created = Instant::now() - Duration::from_secs(901);
        assert!(prepare(&project, &next, &token, &json!({"action":"preserve"})).is_err());
        assert!(
            prepare(&project, &next, &token, &json!({"action":"cancel"}))
                .unwrap()
                .is_none()
        );
        for (next, token) in tokens {
            assert!(
                prepare(&project, &next, &token, &json!({"action":"cancel"}))
                    .unwrap()
                    .is_none()
            );
            assert!(
                prepare(&project, &next, &token, &json!({"action":"cancel"}))
                    .unwrap()
                    .is_none()
            );
        }
    }
}
