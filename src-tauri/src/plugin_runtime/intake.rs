use super::*;
use crate::intake::safe_dir;

pub(super) static READ_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug)]
pub(super) struct Snapshot {
    pub(super) inspection: PluginInspection,
    pub(super) files: BTreeMap<String, Vec<u8>>,
}

fn collect(root: &Path) -> Result<Snapshot, String> {
    collect_with_policy(root, true, false)
}

pub(super) fn collect_manager(root: &Path) -> Result<Snapshot, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Open plugin directory: {e}"))?;
    collect_with_policy(&root, false, false)
}
pub(super) fn collect_installed(root: &Path) -> Result<Snapshot, String> {
    collect_with_policy(root, false, true)
}
fn collect_with_policy(root: &Path, strict: bool, installed: bool) -> Result<Snapshot, String> {
    fn walk(
        dir: &File,
        strict: bool,
        installed: bool,
        prefix: &str,
        depth: usize,
        visited: &mut usize,
        total: &mut u64,
        files: &mut BTreeMap<String, Vec<u8>>,
        folded: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if depth > 16 {
            return Err("Plugin intake exceeds 16 directory levels".into());
        }
        // Host state must not consume the reviewed payload's enumeration quota.
        let names = if installed && prefix.is_empty() {
            safe_dir::names_except(dir, Some(STATE_FILE))?
        } else {
            safe_dir::names(dir)?
        };
        for name in names {
            *visited += 1;
            if *visited > 1024 {
                return Err("Plugin intake exceeds 1024 entries".into());
            }
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if strict {
                safe_dir::relative(&path)?;
            } else if path.len() > 4096 || path.contains('\\') {
                return Err("Unsupported plugin path".into());
            }
            if path.eq_ignore_ascii_case(STATE_FILE) || !folded.insert(path.to_lowercase()) {
                return Err("Reserved or case-colliding plugin path".into());
            }
            let entry = if strict {
                safe_dir::child(dir, &name, false)
            } else {
                safe_dir::child_utf8(dir, &name, false)
            }
            .map_err(|e| format!("Cannot open package entry; symlinks are not allowed: {e}"))?;
            let meta = entry
                .metadata()
                .map_err(|_| "Cannot inspect package entry")?;
            if meta.is_dir() {
                walk(
                    &entry,
                    strict,
                    installed,
                    &path,
                    depth + 1,
                    visited,
                    total,
                    files,
                    folded,
                )?;
                continue;
            }
            if !meta.is_file() {
                return Err("Plugin intake accepts only regular files".into());
            }
            let limit = if path == MANIFEST_FILE {
                MAX_MANIFEST_BYTES
            } else {
                MAX_FILE_BYTES
            };
            if meta.len() > limit {
                return Err("Plugin intake file exceeds its byte limit".into());
            }
            let mut bytes = Vec::new();
            entry
                .take(limit + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot read package entry")?;
            if bytes.len() as u64 != meta.len() || bytes.len() as u64 > limit {
                return Err("Plugin file changed or exceeded its byte limit".into());
            }
            *total += bytes.len() as u64;
            if *total > MAX_PACKAGE_BYTES || files.len() >= MAX_PACKAGE_FILES {
                return Err("Plugin intake exceeds 25 MiB or 512 files".into());
            }
            files.insert(path, bytes);
        }
        Ok(())
    }
    let dir = safe_dir::root(root)?;
    let manifest_meta = safe_dir::child(&dir, MANIFEST_FILE, false)
        .map_err(|e| format!("Cannot open orion-plugin.json: {e}"))?
        .metadata()
        .map_err(|_| "Cannot inspect manifest")?;
    if !manifest_meta.is_file() || manifest_meta.len() > MAX_MANIFEST_BYTES {
        return Err("Manifest must be a regular file of at most 64 KiB".into());
    }
    let mut files = BTreeMap::new();
    let mut total = 0;
    walk(
        &dir,
        strict,
        installed,
        "",
        0,
        &mut 0,
        &mut total,
        &mut files,
        &mut BTreeSet::new(),
    )?;
    let inspection = inspect_captured(&files)?;
    Ok(Snapshot { inspection, files })
}

pub(crate) fn inspect_captured(files: &BTreeMap<String, Vec<u8>>) -> Result<PluginInspection, String> {
    if files.is_empty() || files.len() > MAX_PACKAGE_FILES {
        return Err("Plugin capture file count exceeds bounds".into());
    }
    let total = files.values().try_fold(0u64, |sum, bytes| {
        if bytes.len() as u64 > MAX_FILE_BYTES { return Err("Plugin capture file exceeds bounds"); }
        sum.checked_add(bytes.len() as u64).filter(|n| *n <= MAX_PACKAGE_BYTES).ok_or("Plugin capture bytes exceed bounds")
    })?;
    let mut folded = BTreeSet::new();
    for path in files.keys() {
        if path.len() > 4096 || path.contains('\\') || Path::new(path).is_absolute() || path.split('/').any(|p| p.is_empty() || p == "." || p == "..")
            || path.eq_ignore_ascii_case(STATE_FILE) || !folded.insert(path.to_lowercase()) {
            return Err("Reserved, traversing or case-colliding captured plugin path".into());
        }
    }
    if files.get(MANIFEST_FILE).is_none_or(|bytes| bytes.len() as u64 > MAX_MANIFEST_BYTES) {
        return Err("Captured manifest must be at most 64 KiB".into());
    }
    let manifest: PluginManifest = serde_json::from_slice(
        files
            .get(MANIFEST_FILE)
            .ok_or("Missing orion-plugin.json")?,
    )
    .map_err(|e| format!("Invalid plugin manifest: {e}"))?;
    validate_manifest(&manifest)?;
    if let Some(entrypoints) = &manifest.entrypoints {
        for (kind, path) in [
            ("ui", entrypoints.ui.as_deref()),
            ("background", entrypoints.background.as_deref()),
        ] {
            if let Some(path) = path {
                let bytes = files
                    .get(path)
                    .ok_or("plugin entrypoint does not exist (case-sensitive)")?;
                if bytes.len() as u64 > MAX_ENTRYPOINT_BYTES
                    || !(if kind == "ui" {
                        path.ends_with(".html")
                    } else {
                        path.ends_with(".js")
                    })
                {
                    return Err("Invalid plugin entrypoint type or size".into());
                }
            }
        }
    }
    let mut hash = Sha256::new();
    let mut ordered = files.iter().collect::<Vec<_>>();
    ordered.sort_by(|(a, _), (b, _)| Path::new(a).cmp(Path::new(b)));
    for (path, bytes) in ordered {
        hash.update(path.as_bytes());
        hash.update([0]);
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    Ok(PluginInspection {
        manifest,
        fingerprint: format!("{:x}", hash.finalize()),
        file_count: files.len(),
        total_bytes: total,
    })
}

pub(super) fn private_dir(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .map_err(|e| format!("Create private package staging: {e}"))
}
pub(super) fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("Create package file: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Save package file: {e}"))
}

// The caller holds PACKAGE_LOCK; review never replaces an installed identity.
fn publish(
    packages: &Path,
    snapshot: Snapshot,
    expected: &str,
    approved: Vec<String>,
) -> Result<InstalledState, String> {
    if snapshot.inspection.fingerprint != expected {
        return Err("Package changed after review; inspect again".into());
    }
    let requested: BTreeSet<_> = snapshot
        .inspection
        .manifest
        .permissions
        .iter()
        .cloned()
        .collect();
    let grants: BTreeSet<_> = approved.iter().cloned().collect();
    if requested != grants || grants.len() != approved.len() {
        return Err("Permissions do not exactly match the reviewed manifest".into());
    }
    recovery::assert_fresh(packages, &snapshot.inspection.manifest.id)?;
    let destination = packages.join(plugin_key(&snapshot.inspection.manifest.id));
    match fs::symlink_metadata(&destination) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => {
            return Err(
                "This identity is already installed. Manage updates in Plugin Manager".into(),
            )
        }
        Err(e) => return Err(format!("Cannot check installed identity: {e}")),
    }
    let temp = packages.join(format!(".intake-{}", random_handle_id()?));
    private_dir(&temp)?;
    let result = (|| {
        for (path, bytes) in &snapshot.files {
            let target = temp.join(path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Create package directory: {e}"))?;
            }
            write_new(&target, bytes)?;
        }
        let state = InstalledState {
            manifest: snapshot.inspection.manifest,
            enabled: false,
            granted_permissions: approved,
            fingerprint: snapshot.inspection.fingerprint,
            installed_at: now_ms(),
            quarantined: false,
            quarantine_reason: None,
            workspace_grants: Vec::new(),
        };
        write_new(
            &temp.join(STATE_FILE),
            &serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?,
        )?;
        fs::rename(&temp, &destination).map_err(|e| format!("Publish disabled plugin: {e}"))?;
        Ok(state)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    result
}

pub(crate) fn publish_prepared_disabled(
    packages: &Path,
    files: BTreeMap<String, Vec<u8>>,
    expected: &str,
    approved: Vec<String>,
    rights_reviewed: bool,
) -> Result<InstalledPlugin, String> {
    if !rights_reviewed {
        return Err("Review package rights and permission requests before installation".into());
    }
    let _guard = PACKAGE_LOCK.lock();
    let inspection = inspect_captured(&files)?;
    publish(packages, Snapshot { inspection, files }, expected, approved).map(InstalledPlugin::from)
}

pub(crate) fn prepared_packages_root(app: &AppHandle) -> Result<PathBuf, String> {
    packages_root(app)
}

#[tauri::command]
pub async fn plugin_inspect_intake_directory(
    source_path: String,
) -> Result<PluginInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _read = READ_LOCK
            .try_lock()
            .ok_or("Another package read is in progress; try again when it finishes")?;
        Ok(collect(Path::new(&source_path))?.inspection)
    })
    .await
    .map_err(|e| format!("Package inspection worker failed: {e}"))?
}

#[tauri::command]
pub async fn plugin_install_intake_directory(
    app: AppHandle,
    source_path: String,
    expected_fingerprint: String,
    approved_permissions: Vec<String>,
    rights_reviewed: bool,
) -> Result<InstalledPlugin, String> {
    if !rights_reviewed {
        return Err("Review package rights and permission requests before installation".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _read = READ_LOCK
            .try_lock()
            .ok_or("Another package read is in progress; try again when it finishes")?;
        let _guard = PACKAGE_LOCK.lock();
        let snapshot = collect(Path::new(&source_path))?;
        publish(
            &packages_root(&app)?,
            snapshot,
            &expected_fingerprint,
            approved_permissions,
        )
        .map(InstalledPlugin::from)
    })
    .await
    .map_err(|e| format!("Package installation worker failed: {e}"))?
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn fixture() -> (Scratch, PathBuf, PathBuf) {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "orion-plugin-intake-{}",
            random_handle_id().unwrap()
        ));
        private_dir(&root).unwrap();
        let temp = Scratch(root.clone());
        let source = root.join("source");
        let packages = root.join("packages");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&packages).unwrap();
        fs::write(source.join(MANIFEST_FILE), r#"{"id":"dev.test.app","name":"Example","version":"1.0.0","apiVersion":"1","engines":{"orion":"*"},"publisher":"test","entrypoints":{"ui":"ui.html"},"contributes":{"apps":[{"id":"example","name":"Example"}]},"permissions":["storage.plugin"]}"#).unwrap();
        fs::write(
            source.join("ui.html"),
            "<script>throw new Error('never execute during intake')</script>",
        )
        .unwrap();
        fs::create_dir(source.join("a")).unwrap();
        fs::write(source.join("a/x.txt"), "nested").unwrap();
        fs::write(source.join("a.txt"), "sibling").unwrap();
        (temp, source, packages)
    }
    #[test]
    fn exact_snapshot_is_disabled_and_reopens_with_existing_layout() {
        let (_temp, source, packages) = fixture();
        let snapshot = collect(&source).unwrap();
        let hash = snapshot.inspection.fingerprint.clone();
        assert_eq!(hash, scan_package(&source).unwrap().fingerprint);
        let state = publish(&packages, snapshot, &hash, vec!["storage.plugin".into()]).unwrap();
        assert!(!state.enabled);
        assert!(state.workspace_grants.is_empty());
        let reopened: InstalledState = read_json(
            &packages
                .join(plugin_key(&state.manifest.id))
                .join(STATE_FILE),
            "fixture",
        )
        .unwrap();
        validate_state(&reopened).unwrap();
        assert!(!reopened.enabled);
        assert_eq!(reopened.fingerprint, hash);
    }
    #[test]
    fn repository_sdk_sample_publishes_disabled_in_temporary_storage_only() {
        let (_temp, _source, packages) = fixture();
        let sample = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("examples/plugins/hello-orion.orion-plugin")
            .canonicalize()
            .unwrap();
        let snapshot = collect(&sample).unwrap();
        let hash = snapshot.inspection.fingerprint.clone();
        let grants = snapshot.inspection.manifest.permissions.clone();
        assert_eq!(hash, scan_package(&sample).unwrap().fingerprint);
        let state = publish(&packages, snapshot, &hash, grants).unwrap();
        assert!(!state.enabled);
        let reopened: InstalledState = read_json(
            &packages
                .join(plugin_key(&state.manifest.id))
                .join(STATE_FILE),
            "sample fixture",
        )
        .unwrap();
        validate_state(&reopened).unwrap();
        assert!(!reopened.enabled);
    }
    #[test]
    fn manager_captures_unicode_and_publishes_only_captured_bytes() {
        let (_temp, source, packages) = fixture();
        fs::write(source.join("café+.txt"), "unicode resource").unwrap();
        assert!(collect(&source).is_err());
        let snapshot = collect_manager(&source).unwrap();
        let legacy = scan_package(&source).unwrap();
        assert_eq!(snapshot.inspection.fingerprint, legacy.fingerprint);
        assert_eq!(snapshot.inspection.total_bytes, legacy.total_bytes);
        let original = snapshot.files["ui.html"].clone();
        fs::write(source.join("ui.html"), "later changed source").unwrap();
        write_snapshot_files(&packages, &snapshot.files).unwrap();
        assert_eq!(fs::read(packages.join("ui.html")).unwrap(), original);
        assert_eq!(
            fs::read_to_string(packages.join("café+.txt")).unwrap(),
            "unicode resource"
        );
        assert!(write_snapshot_files(&packages, &snapshot.files).is_err());
    }
    #[test]
    fn reviewed_state_rejects_changed_versions_enablement_permissions_and_workspace_handles() {
        let (_temp, source, packages) = fixture();
        let snapshot = collect(&source).unwrap();
        let hash = snapshot.inspection.fingerprint.clone();
        let state = publish(&packages, snapshot, &hash, vec!["storage.plugin".into()]).unwrap();
        let expected = serde_json::to_value(InstalledPlugin::from(state.clone())).unwrap();
        verify_reviewed_state(Some(&state), Some(Some(expected.clone()))).unwrap();
        verify_reviewed_state(None, Some(None)).unwrap();
        assert!(verify_reviewed_state(Some(&state), Some(None)).is_err());
        assert!(verify_reviewed_state(None, Some(Some(expected.clone()))).is_err());
        for (key, value) in [
            ("enabled", json!(true)),
            ("fingerprint", json!("b".repeat(64))),
            ("installedAt", json!(0)),
            ("grantedPermissions", json!([])),
            ("workspaceHandles", json!([{"id":"different"}])),
        ] {
            let mut changed = expected.clone();
            changed[key] = value;
            assert!(verify_reviewed_state(Some(&state), Some(Some(changed))).is_err());
        }
    }
    #[test]
    fn changed_source_and_grants_fail_without_publishing() {
        let (_temp, source, packages) = fixture();
        let hash = collect(&source).unwrap().inspection.fingerprint;
        fs::write(source.join("ui.html"), "changed").unwrap();
        assert!(publish(
            &packages,
            collect(&source).unwrap(),
            &hash,
            vec!["storage.plugin".into()]
        )
        .is_err());
        let hash = collect(&source).unwrap().inspection.fingerprint;
        assert!(publish(&packages, collect(&source).unwrap(), &hash, vec![]).is_err());
        assert!(publish(
            &packages,
            collect(&source).unwrap(),
            &hash,
            vec!["storage.plugin".into(), "storage.plugin".into()]
        )
        .is_err());
        assert_eq!(fs::read_dir(packages).unwrap().count(), 0);
    }
    #[test]
    fn source_edits_after_capture_cannot_replace_captured_bytes_or_existing_identity() {
        let (_temp, source, packages) = fixture();
        let snapshot = collect(&source).unwrap();
        let hash = snapshot.inspection.fingerprint.clone();
        let original = fs::read(source.join("ui.html")).unwrap();
        fs::write(source.join("ui.html"), "later edit").unwrap();
        let state = publish(&packages, snapshot, &hash, vec!["storage.plugin".into()]).unwrap();
        let dest = packages.join(plugin_key(&state.manifest.id));
        assert_eq!(fs::read(dest.join("ui.html")).unwrap(), original);
        let before = fs::read(dest.join(STATE_FILE)).unwrap();
        let snapshot = collect(&source).unwrap();
        let hash = snapshot.inspection.fingerprint.clone();
        assert!(publish(&packages, snapshot, &hash, vec!["storage.plugin".into()]).is_err());
        assert_eq!(fs::read(dest.join(STATE_FILE)).unwrap(), before);
    }
    #[test]
    fn rejects_reserved_paths_oversized_files_and_missing_entrypoints() {
        let (_temp, source, _packages) = fixture();
        fs::write(source.join(".ORION-state.json"), "{}").unwrap();
        assert!(collect(&source).is_err());
        fs::remove_file(source.join(".ORION-state.json")).unwrap();
        let file = File::create(source.join("large.bin")).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(collect(&source).is_err());
        fs::remove_file(source.join("large.bin")).unwrap();
        fs::remove_file(source.join("ui.html")).unwrap();
        assert!(collect(&source).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_file_and_directory_symlinks() {
        use std::os::unix::fs::symlink;
        let (_temp, source, packages) = fixture();
        symlink(&packages, source.join("linked")).unwrap();
        assert!(collect(&source).is_err());
        fs::remove_file(source.join("linked")).unwrap();
        symlink(source.join("ui.html"), source.join("linked.html")).unwrap();
        assert!(collect(&source).is_err());
    }
}
