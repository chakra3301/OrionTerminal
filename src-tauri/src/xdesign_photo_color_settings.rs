use super::{profiles, PhotoSession};
use base64::Engine;
use photocraft_engine::{
    color_cmds::{ColorSettings, ColorState, Policy},
    Session,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

const MAX_RECORD: usize = 32 * 1024;
const MAX_ICC: usize = 16 * 1024 * 1024;
const MAX_ENCODED: usize = MAX_ICC.div_ceil(3) * 4;
pub(super) const MAX_PARAMS: usize = 3 * MAX_ENCODED + MAX_RECORD;
const SLOTS: [&str; 3] = ["workingRgb", "workingCmyk", "workingGray"];
const BUILTINS: [&str; 10] = [
    "srgb",
    "display-p3",
    "adobe-rgb-compat",
    "prophoto-compat",
    "linear-srgb",
    "rec2020",
    "gray-gamma-2.2",
    "sgray",
    "lab-d50",
    "coated-cmyk",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Custom {
    hash: String,
    source: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    schema_version: u32,
    settings: ColorSettings,
    custom: BTreeMap<String, Custom>,
}
impl Default for Record {
    fn default() -> Self {
        let mut settings = ColorSettings::default();
        settings.monitor_profile = "srgb".into();
        Self {
            schema_version: 1,
            settings,
            custom: BTreeMap::new(),
        }
    }
}
pub(super) struct Context {
    pub(super) native: ColorSettings,
    pub(super) revision: String,
    record: Record,
    _leases: Vec<profiles::Snapshot>,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn spec<'a>(c: &'a ColorSettings, slot: &str) -> &'a str {
    match slot {
        "workingRgb" => &c.working_rgb,
        "workingCmyk" => &c.working_cmyk,
        _ => &c.working_gray,
    }
}
fn set_spec(c: &mut ColorSettings, slot: &str, value: String) {
    match slot {
        "workingRgb" => c.working_rgb = value,
        "workingCmyk" => c.working_cmyk = value,
        _ => c.working_gray = value,
    }
}
fn registry() -> &'static Mutex<Vec<Weak<Context>>> {
    static REGISTRY: OnceLock<Mutex<Vec<Weak<Context>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}
pub(super) fn retain(settings: &ColorSettings) -> Option<Arc<Context>> {
    registry()
        .lock()
        .ok()?
        .iter()
        .filter_map(Weak::upgrade)
        .find(|context| context.native == *settings)
}
fn register(context: Arc<Context>) -> Result<Arc<Context>, String> {
    let mut entries = registry()
        .lock()
        .map_err(|_| "Color settings need to be restarted")?;
    entries.retain(|entry| entry.strong_count() > 0);
    if entries.len() >= 64 {
        return Err("Wait for the current color settings operations to finish".into());
    }
    entries.push(Arc::downgrade(&context));
    Ok(context)
}
fn store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}
fn read_record(dir: &Path) -> Result<(Record, String), String> {
    let path = dir.join("color-settings.json");
    let file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Record::default(), "default".into()))
        }
        Err(e) => return Err(format!("Cannot read saved color settings: {e}")),
    };
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD as u64 {
        return Err("Saved color settings exceed 32KiB; the file was preserved".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RECORD {
        return Err("Saved color settings exceed 32KiB; the file was preserved".into());
    }
    let raw: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Saved color settings are unreadable; the file was preserved")?;
    validate_keys(&raw["settings"], false)?;
    let record: Record = serde_json::from_value(raw)
        .map_err(|_| "Saved color settings are unreadable; the file was preserved")?;
    if record.schema_version != 1 {
        return Err(
            "Saved color settings use an unsupported version; the file was preserved".into(),
        );
    }
    Ok((record, digest(&bytes)))
}
fn profile_path(dir: &Path, hash: &str) -> Result<PathBuf, String> {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid saved working ICC identity".into());
    }
    Ok(dir.join("color-profiles").join(format!("{hash}.icc")))
}
fn build(
    dir: &Path,
    record: Record,
    revision: String,
    overrides: &HashMap<String, Vec<u8>>,
) -> Result<Arc<Context>, String> {
    if record.custom.len() > 3
        || record
            .custom
            .keys()
            .any(|slot| !SLOTS.contains(&slot.as_str()))
    {
        return Err("Invalid saved working profiles".into());
    }
    let mut native = record.settings.clone();
    let mut leases = Vec::new();
    for slot in SLOTS {
        let choice = spec(&record.settings, slot);
        if let Some(custom) = record.custom.get(slot) {
            if choice != format!("custom:{}", custom.hash)
                || custom.source.len() > 4096
                || custom.source.chars().any(char::is_control)
            {
                return Err("Invalid saved working profile".into());
            }
            let path = profile_path(dir, &custom.hash)?;
            let bytes = match overrides.get(&custom.hash) {
                Some(bytes) => bytes.clone(),
                None => profiles::read(&path.to_string_lossy())?,
            };
            if bytes.len() > MAX_ICC || digest(&bytes) != custom.hash {
                return Err(
                    "The saved working ICC profile changed; its files were preserved".into(),
                );
            }
            let lease = profiles::Snapshot::new(&bytes)?;
            set_spec(&mut native, slot, lease.path());
            leases.push(lease);
        } else if !BUILTINS.contains(&choice) {
            return Err("Choose a supported working ICC profile".into());
        }
    }
    if native.monitor_profile != "srgb" {
        return Err(
            "The image canvas uses sRGB presentation managed by the system display profile".into(),
        );
    }
    if native.blend_text_gamma != ColorSettings::default().blend_text_gamma {
        return Err("Changing text blending gamma is not available yet".into());
    }
    photocraft_engine::color_cmds::validate_settings(&native)?;
    register(Arc::new(Context {
        native,
        revision,
        record,
        _leases: leases,
    }))
}
pub(super) fn load(dir: &Path) -> Result<Arc<Context>, String> {
    let _guard = store_lock()
        .lock()
        .map_err(|_| "Color settings need to be restarted")?;
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Weak<Context>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let (record, revision) = read_record(dir)?;
    if let Some(context) = cache
        .lock()
        .map_err(|_| "Color settings need to be restarted")?
        .get(dir)
        .and_then(Weak::upgrade)
        .filter(|context| context.revision == revision)
    {
        return Ok(context);
    }
    let context = build(dir, record, revision, &HashMap::new())?;
    let mut cache = cache
        .lock()
        .map_err(|_| "Color settings need to be restarted")?;
    cache.retain(|_, entry| entry.strong_count() > 0);
    cache.insert(dir.to_path_buf(), Arc::downgrade(&context));
    Ok(context)
}
pub(super) fn defaults(dir: &Path) -> Result<Arc<Context>, String> {
    build(dir, Record::default(), "default".into(), &HashMap::new())
}
fn validate_keys(value: &Value, update: bool) -> Result<(), String> {
    let object = value.as_object().ok_or("Invalid color settings")?;
    let valid = [
        "workingRgb",
        "workingCmyk",
        "workingGray",
        "policyRgb",
        "policyCmyk",
        "policyGray",
        "askOnMismatch",
        "askOnPaste",
        "askOnMissing",
        "intent",
        "bpc",
        "dither",
        "blendTextGamma",
        "monitorProfile",
    ];
    for (name, v) in object {
        if update
            && [
                "expectedRevision",
                "reset",
                "workingRgbData",
                "workingCmykData",
                "workingGrayData",
            ]
            .contains(&name.as_str())
        {
            continue;
        }
        if !valid.contains(&name.as_str()) {
            return Err(format!("Unsupported color setting `{name}`"));
        }
        if [
            "askOnMismatch",
            "askOnPaste",
            "askOnMissing",
            "bpc",
            "dither",
        ]
        .contains(&name.as_str())
            && !v.is_boolean()
        {
            return Err(format!("Invalid color setting `{name}`"));
        }
        if [
            "intent",
            "monitorProfile",
            "policyRgb",
            "policyCmyk",
            "policyGray",
            "workingRgb",
            "workingCmyk",
            "workingGray",
        ]
        .contains(&name.as_str())
            && v.as_str()
                .is_none_or(|v| v.len() > 4096 || v.chars().any(char::is_control))
        {
            return Err(format!("Invalid color setting `{name}`"));
        }
    }
    Ok(())
}
pub(super) fn update(dir: &Path, params: &Value) -> Result<Arc<Context>, String> {
    let _guard = store_lock()
        .lock()
        .map_err(|_| "Color settings need to be restarted")?;
    if !params.is_object() || params.to_string().len() > MAX_PARAMS {
        return Err("Invalid color settings parameters".into());
    }
    validate_keys(params, true)?;
    let (current, revision) = read_record(dir)?;
    if params
        .get("expectedRevision")
        .is_some_and(|v| v.as_str() != Some(revision.as_str()))
    {
        return Err("Color settings changed; reopen the settings before applying".into());
    }
    if params.get("reset").is_some_and(|v| !v.is_boolean()) {
        return Err("Invalid color settings reset".into());
    }
    let mut next = if params["reset"] == true {
        Record::default()
    } else {
        current.clone()
    };
    let mut overrides = HashMap::new();
    let mut settings = serde_json::to_value(&next.settings).map_err(|e| e.to_string())?;
    for (name, value) in params.as_object().unwrap() {
        if ![
            "expectedRevision",
            "reset",
            "workingRgbData",
            "workingCmykData",
            "workingGrayData",
        ]
        .contains(&name.as_str())
            && !SLOTS.contains(&name.as_str())
        {
            settings[name] = value.clone();
        }
    }
    next.settings =
        serde_json::from_value(settings).map_err(|_| "Invalid color settings values")?;
    for slot in SLOTS {
        let data = params.get(format!("{slot}Data"));
        let choice = params.get(slot).and_then(Value::as_str);
        if data.is_some() && choice.is_none() {
            return Err("Custom working ICC data needs its profile source".into());
        }
        if let Some(choice) = choice {
            if choice == "current" {
                if data.is_some() {
                    return Err("Current working profile does not accept replacement bytes".into());
                }
                continue;
            }
            if BUILTINS.contains(&choice) {
                if data.is_some() {
                    return Err("Built-in working profiles do not accept custom bytes".into());
                }
                next.custom.remove(slot);
                set_spec(&mut next.settings, slot, choice.into());
            } else {
                let bytes = if let Some(data) = data {
                    let encoded = data.as_str().ok_or("Invalid working ICC data")?;
                    if encoded.len() > MAX_ENCODED {
                        return Err("Working ICC import exceeds 16MiB".into());
                    }
                    base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|_| "Invalid working ICC data")?
                } else {
                    profiles::read(choice)?
                };
                if bytes.len() > MAX_ICC {
                    return Err("Working ICC import exceeds 16MiB".into());
                }
                let hash = digest(&bytes);
                next.custom.insert(
                    slot.into(),
                    Custom {
                        hash: hash.clone(),
                        source: choice.into(),
                    },
                );
                set_spec(&mut next.settings, slot, format!("custom:{hash}"));
                overrides.insert(hash, bytes);
            }
        }
    }
    let encoded = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
    if encoded.len() > MAX_RECORD {
        return Err("Saved color settings exceed 32KiB".into());
    }
    let context = build(dir, next.clone(), digest(&encoded), &overrides)?;
    std::fs::create_dir_all(dir.join("color-profiles")).map_err(|e| e.to_string())?;
    let mut created = Vec::new();
    let persisted = (|| {
        for (hash, bytes) in &overrides {
            let path = profile_path(dir, hash)?;
            if path.exists() {
                let existing = profiles::read(&path.to_string_lossy())?;
                if existing != *bytes {
                    return Err(
                        "A retained working ICC file changed; its files were preserved".into(),
                    );
                }
            } else {
                photocraft_format::atomic_write(&path, bytes).map_err(|e| e.to_string())?;
                created.push(path);
            }
        }
        photocraft_format::atomic_write(&dir.join("color-settings.json"), &encoded)
            .map_err(|e| e.to_string())
    })();
    if let Err(error) = persisted {
        for path in created {
            let _ = std::fs::remove_file(path);
        }
        return Err(error);
    }
    let referenced: Vec<_> = next
        .custom
        .values()
        .map(|custom| custom.hash.as_str())
        .collect();
    for custom in current
        .custom
        .values()
        .filter(|custom| !referenced.contains(&custom.hash.as_str()))
    {
        if let Ok(path) = profile_path(dir, &custom.hash) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(context)
}
impl Context {
    pub(super) fn install(&self, engine: &mut Session) {
        engine.color.settings = self.native.clone();
    }
    pub(super) fn describe(&self) -> Value {
        let mut settings = serde_json::to_value(&self.record.settings).unwrap_or(Value::Null);
        let mut working = json!({});
        let mut color = ColorState::default();
        color.settings = self.native.clone();
        for (slot, mode) in [
            ("workingRgb", photocraft_engine::doc::ColorMode::Rgb),
            ("workingCmyk", photocraft_engine::doc::ColorMode::Cmyk),
            ("workingGray", photocraft_engine::doc::ColorMode::Grayscale),
        ] {
            let profile = color.working(mode);
            working[slot] = json!({"description":profile.description,"colorSpace":format!("{:?}",profile.color_space),"custom":self.record.custom.contains_key(slot),"source":self.record.custom.get(slot).map(|custom|custom.source.as_str())});
            if self.record.custom.contains_key(slot) {
                settings[slot] = json!("current");
            }
        }
        json!({"revision":self.revision,"settings":settings,"working":working})
    }
}
pub(super) fn image_settings_dir(dir: &Path) -> Option<PathBuf> {
    let project = dir.parent()?;
    let design = project.parent()?;
    let assets = design.parent()?;
    if design.file_name()? != "xdesign" || assets.file_name()? != "assets" {
        return None;
    }
    Some(assets.parent()?.join("xdesign-tools"))
}
pub(super) fn signature(settings: &ColorSettings) -> Option<String> {
    let mut normalized = settings.clone();
    normalized.monitor_profile = "srgb".into();
    if normalized == Record::default().settings {
        return None;
    }
    Some(retain(settings).map_or_else(
        || digest(&serde_json::to_vec(&normalized).unwrap_or_default()),
        |context| digest(&serde_json::to_vec(&context.record.settings).unwrap_or_default()),
    ))
}
pub(super) fn activate(dir: &Path, session: &mut PhotoSession) -> Result<(), String> {
    let context = load(dir)?;
    context.install(&mut session.engine);
    session.color_settings = Some(context);
    Ok(())
}
pub(super) fn profile_info(params: &Value) -> Result<Value, String> {
    let mut engine = Session::new();
    engine
        .execute("file.new", json!({"width":1,"height":1}))
        .map_err(|e| e.to_string())?;
    profiles::run(&mut engine, "edit.profileInfo", params)
}
pub(super) fn analyze(engine: &Session) -> Result<Value, String> {
    let doc = engine.active().ok_or("No imported image")?;
    let mut probe = (*doc.doc).clone();
    let mut color = ColorState::default();
    color.settings = engine.color.settings.clone();
    color.settings.policy_rgb = Policy::Preserve;
    color.settings.policy_cmyk = Policy::Preserve;
    color.settings.policy_gray = Policy::Preserve;
    let mut report = color.open_policy(&mut probe);
    report["policy"] = json!(engine.color.settings.policy(doc.doc.mode).id());
    report["mode"] = json!(format!("{:?}", doc.doc.mode));
    report["depth"] = json!(match doc.doc.depth {
        photocraft_engine::doc::SampleType::U8 => 8,
        photocraft_engine::doc::SampleType::U16 => 16,
        photocraft_engine::doc::SampleType::F32 => 32,
    });
    report["name"] = json!(doc.doc.name);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) struct Temp(pub(super) PathBuf);
    impl Temp {
        pub(super) fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("xdesign-color-settings-{}", ulid::Ulid::new()));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    pub(super) fn bytes(spec: &str) -> Vec<u8> {
        ColorState::default()
            .resolve(spec, None, None)
            .unwrap()
            .to_bytes()
            .to_vec()
    }
    #[test]
    fn working_view_identity_uses_effective_settings_and_icc_content_not_json_or_source_paths() {
        let root = Temp::new();
        let first = update(&root.0, &json!({"workingRgb":"display-p3"})).unwrap();
        let before = signature(&first.native);
        let record: Value =
            serde_json::from_slice(&std::fs::read(root.0.join("color-settings.json")).unwrap())
                .unwrap();
        std::fs::write(
            root.0.join("color-settings.json"),
            serde_json::to_vec_pretty(&record).unwrap(),
        )
        .unwrap();
        let reformatted = load(&root.0).unwrap();
        assert_ne!(first.revision, reformatted.revision);
        drop(first);
        assert_eq!(signature(&reformatted.native), before);
        let rgb = bytes("rec2020");
        let retained=update(&root.0,&json!({"workingRgb":"First.icc","workingRgbData":base64::engine::general_purpose::STANDARD.encode(&rgb)})).unwrap();
        let before = signature(&retained.native);
        let renamed=update(&root.0,&json!({"workingRgb":"Renamed.icc","workingRgbData":base64::engine::general_purpose::STANDARD.encode(&rgb)})).unwrap();
        assert_ne!(retained.revision, renamed.revision);
        assert_eq!(signature(&renamed.native), before);
        assert_ne!(renamed.native.working_rgb, retained.native.working_rgb);
        let changed = update(&root.0, &json!({"workingRgb":"srgb"})).unwrap();
        assert_eq!(signature(&changed.native), None);
    }
    #[test]
    fn working_settings_round_trip_modes_policies_intents_and_optimistic_revision() {
        let root = Temp::new();
        let initial = load(&root.0).unwrap();
        assert_eq!(initial.describe()["revision"], "default");
        assert!(!root.0.join("color-settings.json").exists());
        for intent in ["relative", "absolute", "perceptual", "saturation"] {
            let before = load(&root.0).unwrap();
            let next=update(&root.0,&json!({"expectedRevision":before.revision,"workingRgb":"display-p3","workingCmyk":"coated-cmyk","workingGray":"gray-gamma-2.2","policyRgb":"convert","policyCmyk":"off","policyGray":"preserve","askOnMismatch":false,"askOnMissing":true,"askOnPaste":false,"intent":intent,"bpc":false,"dither":false})).unwrap();
            let loaded = load(&root.0).unwrap();
            assert_eq!(loaded.describe(), next.describe());
            assert_eq!(loaded.native.intent, intent);
            assert!(!loaded.native.bpc);
            assert!(!loaded.native.dither);
            assert!(!loaded.native.ask_on_paste);
            assert_eq!(loaded.native.policy_rgb, Policy::Convert);
            assert_eq!(loaded.native.policy_cmyk, Policy::Off);
            assert_eq!(loaded.native.policy_gray, Policy::Preserve);
            assert!(update(
                &root.0,
                &json!({"expectedRevision":"default","workingRgb":"srgb"})
            )
            .err()
            .unwrap()
            .contains("changed"));
        }
        let on_disk = std::fs::read(root.0.join("color-settings.json")).unwrap();
        let default = defaults(&root.0).unwrap();
        assert_eq!(default.native, Record::default().settings);
        assert_eq!(
            std::fs::read(root.0.join("color-settings.json")).unwrap(),
            on_disk
        );
        let reset = update(&root.0, &json!({"reset":true})).unwrap();
        assert_eq!(reset.native, Record::default().settings);
    }
    #[test]
    fn working_custom_profiles_retain_exact_bytes_after_source_deletion_switch_and_cache_eviction()
    {
        let root = Temp::new();
        let (rgb, cmyk, gray) = (
            bytes("display-p3"),
            bytes("coated-cmyk"),
            bytes("gray-gamma-2.2"),
        );
        let path = root.0.join("Source.icc");
        std::fs::write(&path, &rgb).unwrap();
        let info = profile_info(&json!({"profile":path,"includeData":true})).unwrap();
        assert_eq!(
            info["profileData"],
            base64::engine::general_purpose::STANDARD.encode(&rgb)
        );
        std::fs::remove_file(&path).unwrap();
        let context=update(&root.0,&json!({"workingRgb":path,"workingRgbData":info["profileData"],"workingCmyk":"Gone-CMYK.icc","workingCmykData":base64::engine::general_purpose::STANDARD.encode(&cmyk),"workingGray":"Gone-Gray.icc","workingGrayData":base64::engine::general_purpose::STANDARD.encode(&gray)})).unwrap();
        let mut engine = Session::new();
        context.install(&mut engine);
        for (slot, mode, expected) in [
            ("workingRgb", photocraft_engine::doc::ColorMode::Rgb, &rgb),
            (
                "workingCmyk",
                photocraft_engine::doc::ColorMode::Cmyk,
                &cmyk,
            ),
            (
                "workingGray",
                photocraft_engine::doc::ColorMode::Grayscale,
                &gray,
            ),
        ] {
            assert_eq!(engine.color.working(mode).to_bytes().to_vec(), *expected);
            assert_eq!(
                std::fs::read(profile_path(&root.0, &digest(expected)).unwrap()).unwrap(),
                *expected
            );
            assert_eq!(context.describe()["working"][slot]["custom"], true);
            assert_eq!(context.describe()["settings"][slot], "current");
        }
        let restored = load(&root.0).unwrap();
        assert_eq!(restored.describe(), context.describe());
        let lease = retain(&engine.color.settings).unwrap();
        drop(context);
        drop(restored);
        update(&root.0, &json!({"reset":true})).unwrap();
        assert!(!profile_path(&root.0, &digest(&rgb)).unwrap().exists());
        assert_eq!(
            engine
                .color
                .working(photocraft_engine::doc::ColorMode::Rgb)
                .to_bytes()
                .to_vec(),
            rgb
        );
        assert!(Path::new(&lease.native.working_rgb).exists());
        let private = lease.native.working_rgb.clone();
        drop(lease);
        assert!(!Path::new(&private).exists());
    }
    #[test]
    fn working_settings_failures_preserve_preferences_and_reject_unimplemented_or_malformed_fields()
    {
        let root = Temp::new();
        update(&root.0, &json!({"workingRgb":"display-p3"})).unwrap();
        let original = std::fs::read(root.0.join("color-settings.json")).unwrap();
        for params in [
            json!([]),
            json!({"unknown":true}),
            json!({"workingRgb":"coated-cmyk"}),
            json!({"policyGray":"bad"}),
            json!({"askOnMissing":"true"}),
            json!({"intent":"bad"}),
            json!({"monitorProfile":"display-p3"}),
            json!({"blendTextGamma":2.2}),
            json!({"workingRgb":"current","workingRgbData":"AA=="}),
            json!({"workingRgbData":"AA=="}),
            json!({"workingRgb":"bad.icc","workingRgbData":"***"}),
            json!({"workingRgb":"bad.icc","workingRgbData":"AA=="}),
            json!({"workingRgb":"srgb","workingRgbData":"AA=="}),
            json!({"reset":"true"}),
        ] {
            assert!(update(&root.0, &params).is_err(), "{params}");
            assert_eq!(
                std::fs::read(root.0.join("color-settings.json")).unwrap(),
                original
            );
        }
        let rgb = bytes("rec2020");
        let conflict = profile_path(&root.0, &digest(&rgb)).unwrap();
        std::fs::write(&conflict, b"changed").unwrap();
        assert!(update(&root.0,&json!({"workingRgb":"admitted.icc","workingRgbData":base64::engine::general_purpose::STANDARD.encode(rgb)})).err().unwrap().contains("changed"));
        assert_eq!(
            std::fs::read(root.0.join("color-settings.json")).unwrap(),
            original
        );
        assert_eq!(std::fs::read(conflict).unwrap(), b"changed");
        for raw in [
            b"{bad".to_vec(),
            serde_json::to_vec(
                &json!({"schemaVersion":2,"settings":Record::default().settings,"custom":{}}),
            )
            .unwrap(),
            serde_json::to_vec(&json!({"schemaVersion":1,"settings":{"unknown":true},"custom":{}}))
                .unwrap(),
            vec![0; MAX_RECORD + 1],
        ] {
            std::fs::write(root.0.join("color-settings.json"), &raw).unwrap();
            assert!(load(&root.0).is_err());
            assert!(update(&root.0, &json!({"reset":true})).is_err());
            assert_eq!(
                std::fs::read(root.0.join("color-settings.json")).unwrap(),
                raw
            );
        }
    }
    #[test]
    fn working_settings_immutable_views_strokes_smart_contents_and_reopen_retain_current_context() {
        let root = Temp::new();
        let rgb = bytes("display-p3");
        let context=update(&root.0.join("xdesign-tools"),&json!({"workingRgb":"deleted.icc","workingRgbData":base64::engine::general_purpose::STANDARD.encode(&rgb),"workingGray":"gray-gamma-2.2"})).unwrap();
        let mut engine = Session::new();
        context.install(&mut engine);
        engine
            .execute(
                "file.new",
                json!({"width":8,"height":6,"depth":16,"background":"#50a0c080"}),
            )
            .unwrap();
        super::super::color_import::tag_new(&mut engine).unwrap();
        let mut session = PhotoSession {
            engine,
            color_settings: Some(context.clone()),
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        let doc = session.engine.active().unwrap().doc.clone();
        assert_eq!(doc.icc_profile.as_ref().unwrap().as_slice(), rgb);
        let saved = super::super::color_views::Snapshot::capture(&session.engine).unwrap();
        let key = saved
            .key(&session.engine.active().unwrap().channel_view)
            .unwrap();
        let mut draft = Session::new();
        draft.add_document((*doc).clone(), None);
        saved.install(&mut draft).unwrap();
        assert_eq!(draft.color.working(doc.mode).to_bytes().to_vec(), rgb);
        let id = ulid::Ulid::new().to_string();
        let dir = root
            .0
            .join("assets/xdesign")
            .join(ulid::Ulid::new().to_string())
            .join(&id);
        super::super::publish(&dir, &id, &mut session).unwrap();
        let reopened = super::super::restore(&dir, &session.version, None).unwrap();
        assert_eq!(
            super::super::color_views::key(&reopened.engine).unwrap(),
            key
        );
        assert_eq!(&*reopened.engine.active().unwrap().doc, &*doc);
        assert_eq!(
            reopened.engine.color.working(doc.mode).to_bytes().to_vec(),
            rgb
        );
        session
            .engine
            .execute("layer.smartObjects.convertToSmartObject", json!({}))
            .unwrap();
        let layer = session.engine.active().unwrap().active_layer.unwrap().0;
        let child = super::super::smart::open(&session, layer).unwrap();
        assert_eq!(
            child.engine.color.working(doc.mode).to_bytes().to_vec(),
            rgb
        );
        assert!(child.color_settings.is_some());
        update(&root.0.join("xdesign-tools"), &json!({"reset":true})).unwrap();
        drop(context);
        drop(reopened);
        drop(session);
        assert_eq!(draft.color.working(doc.mode).to_bytes().to_vec(), rgb);
        drop(draft);
        drop(child);
        assert_eq!(
            saved
                .native(&doc)
                .unwrap()
                .working(doc.mode)
                .to_bytes()
                .to_vec(),
            rgb
        );
    }
}
