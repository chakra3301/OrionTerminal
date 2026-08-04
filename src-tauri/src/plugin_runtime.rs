use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

const MANIFEST_FILE: &str = "orion-plugin.json";
const STATE_FILE: &str = ".orion-state.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PACKAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ENTRYPOINT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 512;
const MAX_BROKER_PAYLOAD: usize = 64 * 1024;
const MAX_STORAGE_BYTES: usize = 1024 * 1024;
const MAX_STORAGE_KEYS: usize = 256;
const MAX_AUDIT_BYTES: u64 = 2 * 1024 * 1024;

static PACKAGE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static STORAGE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static AUDIT_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginEngines {
    pub orion: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginEntrypoints {
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub ui: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginContributions {
    #[serde(default)]
    pub apps: Vec<Value>,
    #[serde(default)]
    pub commands: Vec<Value>,
    #[serde(default)]
    pub views: Vec<Value>,
    #[serde(default)]
    pub settings: Vec<Value>,
    #[serde(default)]
    pub status_items: Vec<Value>,
    #[serde(default)]
    pub file_handlers: Vec<Value>,
    #[serde(default)]
    pub ai_tools: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub engines: PluginEngines,
    pub publisher: String,
    #[serde(default)]
    pub entrypoints: Option<PluginEntrypoints>,
    #[serde(default)]
    pub activation_events: Vec<String>,
    #[serde(default)]
    pub dependencies: BTreeMap<String, String>,
    #[serde(default)]
    pub contributes: PluginContributions,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstalledState {
    manifest: PluginManifest,
    enabled: bool,
    granted_permissions: Vec<String>,
    fingerprint: String,
    installed_at: u64,
    #[serde(default)]
    quarantined: bool,
    #[serde(default)]
    quarantine_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub granted_permissions: Vec<String>,
    pub fingerprint: String,
    pub installed_at: u64,
    pub quarantined: bool,
    pub quarantine_reason: Option<String>,
}

impl From<InstalledState> for InstalledPlugin {
    fn from(value: InstalledState) -> Self {
        Self {
            manifest: value.manifest,
            enabled: value.enabled,
            granted_permissions: value.granted_permissions,
            fingerprint: value.fingerprint,
            installed_at: value.installed_at,
            quarantined: value.quarantined,
            quarantine_reason: value.quarantine_reason,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInspection {
    pub manifest: PluginManifest,
    pub fingerprint: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntrypointContent {
    pub kind: String,
    pub content: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginSafeModeStatus {
    pub active: bool,
    #[serde(default)]
    pub plugin_ids: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupMarker {
    plugin_ids: Vec<String>,
    started_at: u64,
}

#[derive(Debug)]
struct PackageScan {
    manifest: PluginManifest,
    fingerprint: String,
    files: Vec<(PathBuf, PathBuf, u64)>,
    total_bytes: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn plugin_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir: {error}"))?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|error| format!("create plugin directory: {error}"))?;
    Ok(dir)
}

fn packages_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = plugin_root(app)?.join("packages");
    fs::create_dir_all(&dir).map_err(|error| format!("create package directory: {error}"))?;
    Ok(dir)
}

fn storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = plugin_root(app)?.join("storage");
    fs::create_dir_all(&dir).map_err(|error| format!("create storage directory: {error}"))?;
    Ok(dir)
}

fn plugin_key(plugin_id: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(plugin_id.as_bytes());
    format!("{:x}", hash.finalize())
}

fn package_dir(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    Ok(packages_root(app)?.join(plugin_key(plugin_id)))
}

fn state_path(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    Ok(package_dir(app, plugin_id)?.join(STATE_FILE))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "target has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("create parent directory: {error}"))?;
    let mut random = [0u8; 8];
    getrandom::getrandom(&mut random)
        .map_err(|error| format!("create temporary filename: {error}"))?;
    let suffix = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let temp = parent.join(format!(".tmp-{suffix}-{}", std::process::id()));
    let mut file =
        File::create(&temp).map_err(|error| format!("create temporary file: {error}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("write temporary file: {error}"))?;
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("replace file: {error}")
    })
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("read {label}: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("parse {label}: {error}"))
}

fn validate_state(state: &InstalledState) -> Result<(), String> {
    validate_manifest(&state.manifest)?;
    let requested: BTreeSet<_> = state.manifest.permissions.iter().cloned().collect();
    let granted: BTreeSet<_> = state.granted_permissions.iter().cloned().collect();
    if requested != granted || granted.len() != state.granted_permissions.len() {
        return Err("plugin grant state does not match its reviewed manifest".into());
    }
    if state.fingerprint.len() != 64
        || !state
            .fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("plugin fingerprint is invalid".into());
    }
    Ok(())
}

fn read_state(app: &AppHandle, plugin_id: &str) -> Result<InstalledState, String> {
    let state: InstalledState = read_json(&state_path(app, plugin_id)?, "plugin state")?;
    if state.manifest.id != plugin_id {
        return Err("plugin state identity mismatch".into());
    }
    validate_state(&state)?;
    Ok(state)
}

fn write_state(app: &AppHandle, state: &InstalledState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("encode plugin state: {error}"))?;
    atomic_write(&state_path(app, &state.manifest.id)?, &bytes)
}

fn valid_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 || !value.is_ascii() {
        return false;
    }
    let unscoped = |part: &str| {
        !part.is_empty()
            && part.len() <= 128
            && part.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
            })
            && part
                .as_bytes()
                .first()
                .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            && part
                .as_bytes()
                .last()
                .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    };
    if let Some(rest) = value.strip_prefix('@') {
        let mut parts = rest.split('/');
        let first = parts.next().unwrap_or_default();
        let second = parts.next().unwrap_or_default();
        return parts.next().is_none() && unscoped(first) && unscoped(second);
    }
    unscoped(value)
}

fn valid_contribution_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.is_ascii()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
}

fn valid_semver(value: &str) -> bool {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part == &"0" || !part.starts_with('0'))
        })
}

fn semver_tuple(value: &str) -> Option<(u64, u64, u64)> {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

fn valid_package_path(value: &str) -> bool {
    if value.is_empty() || value.len() > 512 || value.contains('\0') || value.contains('\\') {
        return false;
    }
    let path = Path::new(value);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && value != STATE_FILE
}

fn valid_permission(value: &str) -> bool {
    const STATIC: &[&str] = &[
        "storage.plugin",
        "workspace.read",
        "workspace.write",
        "workspace.watch",
        "clipboard.read",
        "clipboard.write",
        "notifications",
        "ai.chat",
        "ai.tools.register",
        "process.git",
        "terminal.send",
        "assets.read",
        "assets.write",
    ];
    if STATIC.contains(&value) {
        return true;
    }
    let Some(raw) = value.strip_prefix("network:") else {
        return false;
    };
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https")
        && url.origin().ascii_serialization() == raw
        && url.username().is_empty()
        && url.password().is_none()
}

fn string_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<&'a str, String> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("contribution.{key} must be a string"))?;
    if value.trim().is_empty() || value.len() > max {
        return Err(format!("contribution.{key} must be 1-{max} characters"));
    }
    Ok(value)
}

fn reject_unknown(
    object: &Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), String> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("{label}.{key} is not supported"));
    }
    Ok(())
}

fn validate_app_contribution(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "app contribution must be an object".to_string())?;
    reject_unknown(
        object,
        &["id", "name", "description", "accent", "window"],
        "app contribution",
    )?;
    let id = string_field(object, "id", 128)?;
    if !valid_contribution_id(id) {
        return Err("app contribution.id is invalid".into());
    }
    string_field(object, "name", 120)?;
    if let Some(description) = object.get("description") {
        if description.as_str().is_none_or(|value| value.len() > 240) {
            return Err(
                "app contribution.description must be a string of at most 240 characters".into(),
            );
        }
    }
    if let Some(accent) = object.get("accent") {
        let allowed = ["cyan", "green", "magenta", "yellow", "violet"];
        if accent
            .as_str()
            .is_none_or(|value| !allowed.contains(&value))
        {
            return Err("app contribution.accent is not supported".into());
        }
    }
    if let Some(window) = object.get("window") {
        let window = window
            .as_object()
            .ok_or_else(|| "app contribution.window must be an object".to_string())?;
        reject_unknown(
            window,
            &["title", "subtitle", "width", "height"],
            "app contribution.window",
        )?;
        if let Some(title) = window.get("title") {
            if title
                .as_str()
                .is_none_or(|value| value.is_empty() || value.len() > 80)
            {
                return Err("app contribution.window.title is invalid".into());
            }
        }
        if let Some(subtitle) = window.get("subtitle") {
            if subtitle.as_str().is_none_or(|value| value.len() > 80) {
                return Err("app contribution.window.subtitle is invalid".into());
            }
        }
        for key in ["width", "height"] {
            if let Some(size) = window.get(key) {
                if size
                    .as_u64()
                    .is_none_or(|value| !(320..=2400).contains(&value))
                {
                    return Err(format!(
                        "app contribution.window.{key} must be between 320 and 2400"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_command_contribution(value: &Value, app_ids: &BTreeSet<String>) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "command contribution must be an object".to_string())?;
    reject_unknown(
        object,
        &["id", "title", "app", "keywords"],
        "command contribution",
    )?;
    let id = string_field(object, "id", 128)?;
    if !valid_contribution_id(id) {
        return Err("command contribution.id is invalid".into());
    }
    string_field(object, "title", 120)?;
    let app = string_field(object, "app", 128)?;
    if !app_ids.contains(app) {
        return Err(format!(
            "command contribution.app references unknown app {app}"
        ));
    }
    if let Some(keywords) = object.get("keywords") {
        let array = keywords
            .as_array()
            .ok_or_else(|| "command contribution.keywords must be an array".to_string())?;
        if array.len() > 20
            || array.iter().any(|value| {
                value
                    .as_str()
                    .is_none_or(|value| value.is_empty() || value.len() > 40)
            })
        {
            return Err("command contribution.keywords is invalid".into());
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if !valid_id(&manifest.id) {
        return Err("manifest.id is invalid".into());
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 120 {
        return Err("manifest.name is invalid".into());
    }
    if !valid_semver(&manifest.version) {
        return Err("manifest.version must be semantic version x.y.z".into());
    }
    if manifest.api_version != "1" {
        return Err("manifest.apiVersion must be 1".into());
    }
    if manifest.publisher.trim().is_empty() || manifest.publisher.len() > 120 {
        return Err("manifest.publisher is invalid".into());
    }
    if manifest.engines.orion.trim().is_empty() || manifest.engines.orion.len() > 120 {
        return Err("manifest.engines.orion is invalid".into());
    }
    if let Some(entrypoints) = &manifest.entrypoints {
        for path in [entrypoints.background.as_deref(), entrypoints.ui.as_deref()]
            .into_iter()
            .flatten()
        {
            if !valid_package_path(path) {
                return Err(format!("unsafe package entrypoint: {path}"));
            }
        }
        if entrypoints.background.is_none() && entrypoints.ui.is_none() {
            return Err("manifest.entrypoints must declare background or ui".into());
        }
    }
    for event in &manifest.activation_events {
        let valid = event == "onStartup"
            || event
                .strip_prefix("onApp:")
                .or_else(|| event.strip_prefix("onCommand:"))
                .is_some_and(valid_contribution_id);
        if !valid {
            return Err(format!("unsupported activation event: {event}"));
        }
    }
    for (id, range) in &manifest.dependencies {
        if !valid_id(id) || range.trim().is_empty() || range.len() > 120 {
            return Err(format!("invalid dependency: {id}"));
        }
    }
    let mut permissions = BTreeSet::new();
    for permission in &manifest.permissions {
        if !valid_permission(permission) {
            return Err(format!("unknown or invalid permission: {permission}"));
        }
        if !matches!(permission.as_str(), "storage.plugin" | "notifications") {
            return Err(format!(
                "permission is not available in this host build: {permission}"
            ));
        }
        if !permissions.insert(permission) {
            return Err(format!("duplicated permission: {permission}"));
        }
    }
    if manifest.contributes.apps.len() > 8 || manifest.contributes.commands.len() > 64 {
        return Err("manifest contribution limit exceeded".into());
    }
    let mut app_ids = BTreeSet::new();
    for app in &manifest.contributes.apps {
        validate_app_contribution(app)?;
        let id = app["id"].as_str().unwrap().to_string();
        if !app_ids.insert(id.clone()) {
            return Err(format!("duplicated app contribution: {id}"));
        }
    }
    let mut command_ids = BTreeSet::new();
    for command in &manifest.contributes.commands {
        validate_command_contribution(command, &app_ids)?;
        let id = command["id"].as_str().unwrap().to_string();
        if !command_ids.insert(id.clone()) {
            return Err(format!("duplicated command contribution: {id}"));
        }
    }
    for (label, values) in [
        ("views", &manifest.contributes.views),
        ("settings", &manifest.contributes.settings),
        ("statusItems", &manifest.contributes.status_items),
        ("fileHandlers", &manifest.contributes.file_handlers),
        ("aiTools", &manifest.contributes.ai_tools),
    ] {
        if !values.is_empty() {
            return Err(format!(
                "manifest.contributes.{label} is not available in this host build"
            ));
        }
    }
    if !manifest.contributes.apps.is_empty()
        && manifest
            .entrypoints
            .as_ref()
            .and_then(|entrypoints| entrypoints.ui.as_ref())
            .is_none()
    {
        return Err("app contributions require entrypoints.ui".into());
    }
    Ok(())
}

fn scan_package(root: &Path) -> Result<PackageScan, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("open plugin package: {error}"))?;
    if !root.is_dir() {
        return Err("plugin package must be a directory".into());
    }
    let manifest_path = root.join(MANIFEST_FILE);
    let metadata = fs::symlink_metadata(&manifest_path)
        .map_err(|error| format!("plugin package is missing {MANIFEST_FILE}: {error}"))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("plugin manifest must be a regular file".into());
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("plugin manifest exceeds 64 KiB".into());
    }
    let manifest: PluginManifest = read_json(&manifest_path, "plugin manifest")?;
    validate_manifest(&manifest)?;

    let mut files = Vec::new();
    let mut total_bytes = 0u64;
    for entry in WalkDir::new(&root).follow_links(false) {
        let entry = entry.map_err(|error| format!("walk plugin package: {error}"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("inspect plugin package entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "plugin packages cannot contain symlinks: {}",
                entry.path().display()
            ));
        }
        if metadata.is_dir() {
            continue;
        }
        if !metadata.is_file() {
            return Err(format!(
                "plugin packages can contain only regular files: {}",
                entry.path().display()
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|_| "plugin package path escaped its root".to_string())?
            .to_path_buf();
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("plugin package contains an unsafe path".into());
        }
        if relative == Path::new(STATE_FILE) {
            return Err(format!("{STATE_FILE} is reserved by the host"));
        }
        if metadata.len() > MAX_FILE_BYTES {
            return Err(format!("plugin file exceeds 5 MiB: {}", relative.display()));
        }
        total_bytes = total_bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "plugin package size overflow".to_string())?;
        if total_bytes > MAX_PACKAGE_BYTES {
            return Err("plugin package exceeds 25 MiB".into());
        }
        files.push((relative, entry.path().to_path_buf(), metadata.len()));
        if files.len() > MAX_PACKAGE_FILES {
            return Err("plugin package exceeds 512 files".into());
        }
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));

    let paths: BTreeMap<PathBuf, u64> = files
        .iter()
        .map(|(relative, _, size)| (relative.clone(), *size))
        .collect();
    if let Some(entrypoints) = &manifest.entrypoints {
        for (kind, path) in [
            ("background", entrypoints.background.as_deref()),
            ("ui", entrypoints.ui.as_deref()),
        ]
        .into_iter()
        .filter_map(|(kind, path)| path.map(|path| (kind, path)))
        {
            let Some(size) = paths.get(Path::new(path)) else {
                return Err(format!("plugin entrypoint does not exist: {path}"));
            };
            if *size > MAX_ENTRYPOINT_BYTES {
                return Err(format!("plugin {kind} entrypoint exceeds 2 MiB"));
            }
            let valid_extension = (kind == "ui" && path.ends_with(".html"))
                || (kind == "background" && path.ends_with(".js"));
            if !valid_extension {
                return Err(format!(
                    "plugin {kind} entrypoint has an unsupported file type"
                ));
            }
        }
    }

    let mut fingerprint = Sha256::new();
    for (relative, absolute, size) in &files {
        fingerprint.update(relative.to_string_lossy().as_bytes());
        fingerprint.update([0]);
        fingerprint.update(size.to_le_bytes());
        let mut file =
            File::open(absolute).map_err(|error| format!("read plugin file: {error}"))?;
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("read plugin file: {error}"))?;
            if read == 0 {
                break;
            }
            fingerprint.update(&buffer[..read]);
        }
    }

    Ok(PackageScan {
        manifest,
        fingerprint: format!("{:x}", fingerprint.finalize()),
        files,
        total_bytes,
    })
}

#[tauri::command]
pub fn plugin_inspect_directory(source_path: String) -> Result<PluginInspection, String> {
    let scan = scan_package(Path::new(&source_path))?;
    Ok(PluginInspection {
        manifest: scan.manifest,
        fingerprint: scan.fingerprint,
        file_count: scan.files.len(),
        total_bytes: scan.total_bytes,
    })
}

#[tauri::command]
pub fn plugin_install_directory(
    app: AppHandle,
    source_path: String,
    expected_fingerprint: String,
    approved_permissions: Vec<String>,
) -> Result<InstalledPlugin, String> {
    let _guard = PACKAGE_LOCK.lock();
    let scan = scan_package(Path::new(&source_path))?;
    if scan.fingerprint != expected_fingerprint {
        return Err("plugin package changed after permission review".into());
    }
    let requested: BTreeSet<_> = scan.manifest.permissions.iter().cloned().collect();
    let approved: BTreeSet<_> = approved_permissions.iter().cloned().collect();
    if requested != approved || approved_permissions.len() != approved.len() {
        return Err("approved permissions do not exactly match the reviewed manifest".into());
    }

    let destination = package_dir(&app, &scan.manifest.id)?;
    let existing = if destination.exists() {
        Some(read_state(&app, &scan.manifest.id)?)
    } else {
        None
    };
    if let Some(existing) = &existing {
        if existing.manifest.publisher != scan.manifest.publisher {
            return Err("plugin publisher identity changed".into());
        }
        if semver_tuple(&scan.manifest.version) < semver_tuple(&existing.manifest.version) {
            return Err("plugin downgrade rejected".into());
        }
    }

    let packages = packages_root(&app)?;
    let key = plugin_key(&scan.manifest.id);
    let temp = packages.join(format!(".{key}.install-{}", now_ms()));
    let backup = packages.join(format!(".{key}.backup-{}", now_ms()));
    fs::create_dir_all(&temp).map_err(|error| format!("create install directory: {error}"))?;
    let install_result = (|| -> Result<InstalledState, String> {
        for (relative, source, _) in &scan.files {
            let target = temp.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("create package path: {error}"))?;
            }
            fs::copy(source, &target).map_err(|error| format!("copy plugin file: {error}"))?;
        }
        let state = InstalledState {
            manifest: scan.manifest.clone(),
            enabled: existing.as_ref().is_none_or(|state| state.enabled),
            granted_permissions: approved_permissions.clone(),
            fingerprint: scan.fingerprint.clone(),
            installed_at: now_ms(),
            quarantined: false,
            quarantine_reason: None,
        };
        let bytes = serde_json::to_vec_pretty(&state)
            .map_err(|error| format!("encode plugin state: {error}"))?;
        atomic_write(&temp.join(STATE_FILE), &bytes)?;
        if destination.exists() {
            fs::rename(&destination, &backup)
                .map_err(|error| format!("stage previous plugin version: {error}"))?;
        }
        if let Err(error) = fs::rename(&temp, &destination) {
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(format!("activate installed plugin: {error}"));
        }
        if backup.exists() {
            fs::remove_dir_all(&backup)
                .map_err(|error| format!("remove previous plugin version: {error}"))?;
        }
        Ok(state)
    })();
    if install_result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    install_result.map(InstalledPlugin::from)
}

#[tauri::command]
pub fn plugin_list_installed(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let _guard = PACKAGE_LOCK.lock();
    let root = packages_root(&app)?;
    let mut plugins = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| format!("list plugin packages: {error}"))? {
        let entry = entry.map_err(|error| format!("list plugin package: {error}"))?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        let state: InstalledState =
            read_json(&entry.path().join(STATE_FILE), "installed plugin state")?;
        validate_state(&state)?;
        if plugin_key(&state.manifest.id) != name.to_string_lossy() {
            return Err(format!(
                "installed plugin identity mismatch: {}",
                state.manifest.id
            ));
        }
        plugins.push(InstalledPlugin::from(state));
    }
    plugins.sort_by(|left, right| left.manifest.name.cmp(&right.manifest.name));
    Ok(plugins)
}

#[tauri::command]
pub fn plugin_set_enabled(app: AppHandle, plugin_id: String, enabled: bool) -> Result<(), String> {
    let _guard = PACKAGE_LOCK.lock();
    let mut state = read_state(&app, &plugin_id)?;
    state.enabled = enabled;
    if enabled {
        state.quarantined = false;
        state.quarantine_reason = None;
    }
    write_state(&app, &state)
}

#[tauri::command]
pub fn plugin_quarantine(app: AppHandle, plugin_id: String, reason: String) -> Result<(), String> {
    let _guard = PACKAGE_LOCK.lock();
    let mut state = read_state(&app, &plugin_id)?;
    state.enabled = false;
    state.quarantined = true;
    state.quarantine_reason = Some(reason.chars().take(300).collect());
    write_state(&app, &state)
}

#[tauri::command]
pub fn plugin_remove(app: AppHandle, plugin_id: String) -> Result<(), String> {
    let _guard = PACKAGE_LOCK.lock();
    let destination = package_dir(&app, &plugin_id)?;
    let _ = read_state(&app, &plugin_id)?;
    let trash =
        packages_root(&app)?.join(format!(".{}.remove-{}", plugin_key(&plugin_id), now_ms()));
    fs::rename(&destination, &trash).map_err(|error| format!("stage plugin removal: {error}"))?;
    if let Err(error) = fs::remove_dir_all(&trash) {
        let _ = fs::rename(&trash, &destination);
        return Err(format!("remove plugin package: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_read_entrypoint(
    app: AppHandle,
    plugin_id: String,
    kind: String,
) -> Result<PluginEntrypointContent, String> {
    let _guard = PACKAGE_LOCK.lock();
    let state = read_state(&app, &plugin_id)?;
    if !state.enabled || state.quarantined {
        return Err("plugin is disabled or quarantined".into());
    }
    let entrypoints = state
        .manifest
        .entrypoints
        .as_ref()
        .ok_or_else(|| "plugin has no entrypoints".to_string())?;
    let relative = match kind.as_str() {
        "ui" => entrypoints.ui.as_deref(),
        "background" => entrypoints.background.as_deref(),
        _ => return Err("unknown plugin entrypoint kind".into()),
    }
    .ok_or_else(|| format!("plugin has no {kind} entrypoint"))?;
    let path = package_dir(&app, &plugin_id)?.join(relative);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("open plugin entrypoint: {error}"))?;
    let root = package_dir(&app, &plugin_id)?
        .canonicalize()
        .map_err(|error| format!("open plugin package: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err("plugin entrypoint escaped package root".into());
    }
    let metadata =
        fs::metadata(&canonical).map_err(|error| format!("inspect plugin entrypoint: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_ENTRYPOINT_BYTES {
        return Err("plugin entrypoint is not a regular file under 2 MiB".into());
    }
    let content = fs::read_to_string(&canonical)
        .map_err(|error| format!("read plugin entrypoint: {error}"))?;
    Ok(PluginEntrypointContent { kind, content })
}

fn storage_path(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    Ok(storage_root(app)?.join(format!("{}.json", plugin_key(plugin_id))))
}

fn storage_key(params: &Value) -> Result<&str, String> {
    let key = params
        .get("key")
        .and_then(Value::as_str)
        .ok_or_else(|| "storage key is required".to_string())?;
    if key.is_empty()
        || key.len() > 100
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err("storage key is invalid".into());
    }
    Ok(key)
}

fn load_storage(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let metadata =
        fs::metadata(path).map_err(|error| format!("inspect plugin storage: {error}"))?;
    if metadata.len() as usize > MAX_STORAGE_BYTES {
        return Err("plugin storage exceeds quota".into());
    }
    let value: Value = read_json(path, "plugin storage")?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "plugin storage is corrupt".into())
}

fn save_storage(path: &Path, storage: &Map<String, Value>) -> Result<(), String> {
    if storage.len() > MAX_STORAGE_KEYS {
        return Err("plugin storage key quota exceeded".into());
    }
    let bytes =
        serde_json::to_vec(storage).map_err(|error| format!("encode plugin storage: {error}"))?;
    if bytes.len() > MAX_STORAGE_BYTES {
        return Err("plugin storage quota exceeded".into());
    }
    atomic_write(path, &bytes)
}

fn append_audit(app: &AppHandle, plugin_id: &str, method: &str, ok: bool) {
    let _guard = AUDIT_LOCK.lock();
    let Ok(root) = plugin_root(app) else {
        return;
    };
    let path = root.join("audit.jsonl");
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > MAX_AUDIT_BYTES) {
        let _ = fs::rename(&path, root.join("audit.previous.jsonl"));
    }
    let line = json!({
        "at": now_ms(),
        "pluginId": plugin_id,
        "method": method,
        "ok": ok,
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn permission_for_method(method: &str) -> Result<Option<&'static str>, String> {
    match method {
        "host.getInfo" => Ok(None),
        "storage.get" | "storage.set" | "storage.delete" => Ok(Some("storage.plugin")),
        "notifications.show" => Ok(Some("notifications")),
        _ => Err("broker method is not supported".into()),
    }
}

fn broker_call(
    app: &AppHandle,
    plugin_id: &str,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let encoded =
        serde_json::to_vec(params).map_err(|error| format!("encode broker payload: {error}"))?;
    if encoded.len() > MAX_BROKER_PAYLOAD {
        return Err("broker payload exceeds 64 KiB".into());
    }
    let state = read_state(app, plugin_id)?;
    if !state.enabled || state.quarantined {
        return Err("plugin is disabled or quarantined".into());
    }
    let required = permission_for_method(method)?;
    if required.is_some_and(|permission| {
        !state
            .granted_permissions
            .iter()
            .any(|value| value == permission)
    }) {
        return Err(format!("permission denied: {}", required.unwrap()));
    }
    match method {
        "host.getInfo" => Ok(json!({
            "apiVersion": "1",
            "pluginId": plugin_id,
            "platform": std::env::consts::OS,
        })),
        "storage.get" => {
            let _guard = STORAGE_LOCK.lock();
            let key = storage_key(params)?;
            let storage = load_storage(&storage_path(app, plugin_id)?)?;
            Ok(storage.get(key).cloned().unwrap_or(Value::Null))
        }
        "storage.set" => {
            let _guard = STORAGE_LOCK.lock();
            let key = storage_key(params)?.to_string();
            let value = params
                .get("value")
                .cloned()
                .ok_or_else(|| "storage value is required".to_string())?;
            if serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() > MAX_BROKER_PAYLOAD) {
                return Err("storage value exceeds 64 KiB".into());
            }
            let path = storage_path(app, plugin_id)?;
            let mut storage = load_storage(&path)?;
            storage.insert(key, value);
            save_storage(&path, &storage)?;
            Ok(json!({ "ok": true }))
        }
        "storage.delete" => {
            let _guard = STORAGE_LOCK.lock();
            let key = storage_key(params)?;
            let path = storage_path(app, plugin_id)?;
            let mut storage = load_storage(&path)?;
            storage.remove(key);
            save_storage(&path, &storage)?;
            Ok(json!({ "ok": true }))
        }
        "notifications.show" => {
            let title = params
                .get("title")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 100)
                .ok_or_else(|| "notification title is invalid".to_string())?;
            let body = params
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if body.len() > 500 {
                return Err("notification body is too long".into());
            }
            Ok(json!({ "title": title, "body": body }))
        }
        _ => unreachable!(),
    }
}

#[tauri::command]
pub fn plugin_broker_call(
    app: AppHandle,
    plugin_id: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let result = broker_call(&app, &plugin_id, &method, &params);
    append_audit(&app, &plugin_id, &method, result.is_ok());
    result
}

fn marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugin_root(app)?.join("startup-pending.json"))
}

fn safe_mode_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugin_root(app)?.join("safe-mode.json"))
}

#[tauri::command]
pub fn plugin_boot_status(app: AppHandle) -> Result<PluginSafeModeStatus, String> {
    let marker = marker_path(&app)?;
    let safe_path = safe_mode_path(&app)?;
    if marker.exists() {
        let (plugin_ids, reason) =
            match read_json::<StartupMarker>(&marker, "plugin startup marker") {
                Ok(pending) => (
                    pending.plugin_ids,
                    "Orion did not finish the previous community plugin startup.".to_string(),
                ),
                Err(error) => (
                    Vec::new(),
                    format!("The community startup marker was unreadable: {error}"),
                ),
            };
        let status = PluginSafeModeStatus {
            active: true,
            plugin_ids,
            reason: Some(reason),
        };
        let bytes = serde_json::to_vec_pretty(&status)
            .map_err(|error| format!("encode safe mode: {error}"))?;
        atomic_write(&safe_path, &bytes)?;
        fs::remove_file(&marker).map_err(|error| format!("clear startup marker: {error}"))?;
    }
    if !safe_path.exists() {
        return Ok(PluginSafeModeStatus::default());
    }
    match read_json(&safe_path, "plugin safe mode") {
        Ok(status) => Ok(status),
        Err(error) => Ok(PluginSafeModeStatus {
            active: true,
            plugin_ids: Vec::new(),
            reason: Some(format!(
                "The community safe-mode record is unreadable: {error}"
            )),
        }),
    }
}

#[tauri::command]
pub fn plugin_runtime_begin(app: AppHandle, plugin_ids: Vec<String>) -> Result<(), String> {
    if safe_mode_path(&app)?.exists() {
        return Err("community plugin safe mode is active".into());
    }
    let unique: BTreeSet<_> = plugin_ids.into_iter().collect();
    for plugin_id in &unique {
        let state = read_state(&app, plugin_id)?;
        if !state.enabled || state.quarantined {
            return Err(format!("plugin is not eligible for startup: {plugin_id}"));
        }
    }
    if unique.is_empty() {
        let marker = marker_path(&app)?;
        if marker.exists() {
            fs::remove_file(marker).map_err(|error| format!("clear startup marker: {error}"))?;
        }
        return Ok(());
    }
    let marker = StartupMarker {
        plugin_ids: unique.into_iter().collect(),
        started_at: now_ms(),
    };
    let bytes = serde_json::to_vec_pretty(&marker)
        .map_err(|error| format!("encode startup marker: {error}"))?;
    atomic_write(&marker_path(&app)?, &bytes)
}

pub fn runtime_shutdown(app: &AppHandle) {
    if let Ok(marker) = marker_path(app) {
        if marker.exists() {
            let _ = fs::remove_file(marker);
        }
    }
}

#[tauri::command]
pub fn plugin_runtime_ready(app: AppHandle) -> Result<(), String> {
    let marker = marker_path(&app)?;
    if marker.exists() {
        fs::remove_file(marker).map_err(|error| format!("clear startup marker: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_safe_mode_clear(app: AppHandle) -> Result<(), String> {
    let path = safe_mode_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("clear plugin safe mode: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orion-plugin-{label}-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest(extra: &str) -> String {
        format!(
            r#"{{
              "id":"dev.orion.hello",
              "name":"Hello Orion",
              "version":"1.0.0",
              "apiVersion":"1",
              "engines":{{"orion":"*"}},
              "publisher":"developer",
              "entrypoints":{{"ui":"ui.html"}},
              "activationEvents":["onStartup"],
              "dependencies":{{}},
              "contributes":{{
                "apps":[{{"id":"hello","name":"Hello","window":{{"width":640,"height":480}}}}],
                "commands":[],"views":[],"settings":[],"statusItems":[],"fileHandlers":[],"aiTools":[]
              }},
              "permissions":["storage.plugin"]{extra}
            }}"#
        )
    }

    #[test]
    fn scans_a_bounded_directory_package() {
        let dir = temp_dir("valid");
        fs::write(dir.join(MANIFEST_FILE), manifest("")).unwrap();
        fs::write(dir.join("ui.html"), "<h1>Hello</h1>").unwrap();
        let scan = scan_package(&dir).unwrap();
        assert_eq!(scan.manifest.id, "dev.orion.hello");
        assert_eq!(scan.files.len(), 2);
        assert_eq!(scan.fingerprint.len(), 64);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_unknown_manifest_authority() {
        let dir = temp_dir("unknown");
        fs::write(dir.join(MANIFEST_FILE), manifest(",\"invokeTauri\":true")).unwrap();
        fs::write(dir.join("ui.html"), "ok").unwrap();
        assert!(scan_package(&dir).unwrap_err().contains("unknown field"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_symlinks_and_missing_entrypoints() {
        let missing = temp_dir("missing");
        fs::write(missing.join(MANIFEST_FILE), manifest("")).unwrap();
        assert!(scan_package(&missing)
            .unwrap_err()
            .contains("does not exist"));
        let _ = fs::remove_dir_all(missing);

        #[cfg(unix)]
        {
            let linked = temp_dir("linked");
            fs::write(linked.join(MANIFEST_FILE), manifest("")).unwrap();
            fs::write(linked.join("real.html"), "ok").unwrap();
            std::os::unix::fs::symlink(linked.join("real.html"), linked.join("ui.html")).unwrap();
            assert!(scan_package(&linked).unwrap_err().contains("symlinks"));
            let _ = fs::remove_dir_all(linked);
        }
    }

    #[test]
    fn validates_ids_paths_and_permissions() {
        assert!(valid_id("dev.orion.hello"));
        assert!(valid_id("@orion/hello"));
        assert!(!valid_id("../hello"));
        assert!(valid_package_path("dist/ui.html"));
        assert!(!valid_package_path("../ui.html"));
        assert!(valid_permission("network:https://example.com"));
        assert!(!valid_permission("network:https://user:pass@example.com"));
        assert!(!valid_permission("process.spawn"));
    }

    #[test]
    fn broker_method_authority_is_deny_by_default() {
        assert_eq!(permission_for_method("host.getInfo").unwrap(), None);
        assert_eq!(
            permission_for_method("storage.set").unwrap(),
            Some("storage.plugin")
        );
        assert_eq!(
            permission_for_method("notifications.show").unwrap(),
            Some("notifications")
        );
        assert!(permission_for_method("tauri.invoke").is_err());
        assert!(permission_for_method("process.spawn").is_err());
        assert!(permission_for_method("filesystem.read").is_err());
    }

    #[test]
    fn plugin_storage_is_atomic_json_and_quota_bounded() {
        let dir = temp_dir("storage");
        let path = dir.join("storage.json");
        let mut storage = Map::new();
        storage.insert("counter".into(), json!(47));
        save_storage(&path, &storage).unwrap();
        assert_eq!(load_storage(&path).unwrap()["counter"], 47);

        let mut too_many = Map::new();
        for index in 0..=MAX_STORAGE_KEYS {
            too_many.insert(format!("key-{index}"), Value::Null);
        }
        assert!(save_storage(&path, &too_many)
            .unwrap_err()
            .contains("key quota"));
        let _ = fs::remove_dir_all(dir);
    }
}
