use super::*;
use crate::intake::safe_dir;
pub mod removal;

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests;

const MAX_STATE: u64 = 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Version {
    state: InstalledState,
    state_hash: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Intent {
    version: u8,
    id: String,
    nonce: String,
    old: Option<Version>,
    previous: Option<Version>,
    new: Version,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn encode(state: &InstalledState) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(state).map_err(|e| e.to_string())
}
fn exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
fn sync_dir(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| format!("Sync package directory: {e}"))
}
fn sync_tree(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("Staged package contains a link".into());
        }
        if kind.is_dir() {
            sync_tree(&entry.path())?;
        }
    }
    sync_dir(root)
}
fn move_dir(root: &Path, from: &Path, to: &Path) -> Result<(), String> {
    if exists(to)? {
        return Err("Recovery destination already exists; nothing was replaced".into());
    }
    fs::rename(from, to).map_err(|e| format!("Move package version: {e}"))?;
    sync_dir(root)
}
fn read_bounded(root: &Path, name: &str, limit: u64) -> Result<Vec<u8>, String> {
    let dir = safe_dir::root(root)?;
    let file = safe_dir::child_utf8(&dir, name, false)?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > limit {
        return Err("Invalid or oversized package recovery record".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 != meta.len() {
        return Err("Recovery record changed during read".into());
    }
    Ok(bytes)
}
fn verified(root: &Path, id: &str) -> Result<(Version, intake::Snapshot), String> {
    let bytes = read_bounded(root, STATE_FILE, MAX_STATE)?;
    let state: InstalledState =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid package state: {e}"))?;
    validate_state(&state)?;
    if state.manifest.id != id {
        return Err("Recovery package identity mismatch".into());
    }
    let snapshot = intake::collect_installed(root)?;
    if snapshot.inspection.fingerprint != state.fingerprint
        || serde_json::to_value(&snapshot.inspection.manifest).unwrap()
            != serde_json::to_value(&state.manifest).unwrap()
    {
        return Err("Retained package bytes or manifest changed; manual review required".into());
    }
    Ok((
        Version {
            state,
            state_hash: digest(&bytes),
        },
        snapshot,
    ))
}
fn journal(root: &Path, id: &str) -> PathBuf {
    root.join(format!(".{}.transition.json", plugin_key(id)))
}
pub(super) fn previous(root: &Path, id: &str) -> PathBuf {
    root.join(format!(".{}.previous", plugin_key(id)))
}
pub(super) fn assert_idle(root: &Path, id: &str) -> Result<(), String> {
    if exists(&journal(root, id))? || exists(&removal::journal(root, id))? {
        return Err(
            "Package change is incomplete. Reload packages to recover before making changes".into(),
        );
    }
    Ok(())
}
pub(super) fn assert_fresh(root: &Path, id: &str) -> Result<(), String> {
    assert_idle(root, id)?;
    if exists(&previous(root, id))? {
        return Err("A retained version exists without this installation; recover or remove it before reusing the identity".into());
    }
    Ok(())
}
fn safe_state(state: &InstalledState) -> InstalledState {
    let mut safe = state.clone();
    safe.enabled = false;
    safe.quarantined = true;
    safe.quarantine_reason = Some("Recovered interrupted package change. Review and enable explicitly; workspace access must be approved again.".into());
    safe.workspace_grants.clear();
    safe
}
fn slots(root: &Path, intent: &Intent) -> [PathBuf; 5] {
    let key = plugin_key(&intent.id);
    let n = &intent.nonce;
    [
        root.join(&key),
        root.join(format!(".{key}.install-{n}")),
        root.join(format!(".{key}.old-{n}")),
        previous(root, &intent.id),
        root.join(format!(".{key}.older-{n}")),
    ]
}

// Journal removal is the commit point. Any surviving intent restores the prior version disabled.
pub(super) fn promote(
    root: &Path,
    temp: &Path,
    state: &InstalledState,
    nonce: &str,
) -> Result<(), String> {
    promote_with(root, temp, state, nonce, |_| Ok(()))
}
fn promote_with(
    root: &Path,
    temp: &Path,
    state: &InstalledState,
    nonce: &str,
    mut checkpoint: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let id = &state.manifest.id;
    assert_idle(root, id)?;
    let active = root.join(plugin_key(id));
    let prior = previous(root, id);
    let old = if exists(&active)? {
        Some(verified(&active, id)?.0)
    } else {
        None
    };
    let previous = if exists(&prior)? {
        Some(verified(&prior, id)?.0)
    } else {
        None
    };
    if old.is_none() && previous.is_some() {
        return Err("Orphan retained package needs manual review".into());
    }
    let new = verified(temp, id)?.0;
    if new.state_hash != digest(&encode(state)?)
        || old.as_ref().is_some_and(|v| v.state_hash == new.state_hash)
    {
        return Err("Package transition does not have a distinct reviewed state".into());
    }
    let intent = Intent {
        version: 1,
        id: id.clone(),
        nonce: nonce.into(),
        old,
        previous,
        new,
    };
    let [current, staged, retired, prior, older] = slots(root, &intent);
    if staged != temp || !valid_handle_id(nonce) {
        return Err("Invalid staging identity".into());
    }
    sync_tree(temp)?;
    let bytes = serde_json::to_vec_pretty(&intent).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > 4 * MAX_STATE {
        return Err("Recovery intent exceeds limit".into());
    }
    let intent_staging = root.join(format!(".{}.intent-{nonce}", plugin_key(id)));
    intake::write_new(&intent_staging, &bytes)?;
    fs::rename(&intent_staging, journal(root, id)).map_err(|e| e.to_string())?;
    sync_dir(root)?;
    checkpoint("prepared")?;
    if intent.previous.is_some() {
        move_dir(root, &prior, &older)?;
    }
    checkpoint("previous-parked")?;
    if intent.old.is_some() {
        move_dir(root, &current, &retired)?;
    }
    checkpoint("current-parked")?;
    move_dir(root, &staged, &current)?;
    checkpoint("published")?;
    if intent.old.is_some() {
        move_dir(root, &retired, &prior)?;
    }
    checkpoint("retained")?;
    fs::remove_file(journal(root, id)).map_err(|e| e.to_string())?;
    if let Err(e) = sync_dir(root) {
        eprintln!("Package committed; directory sync could not be confirmed: {e}");
    }
    if matches!(exists(&older), Ok(true)) {
        if let Err(e) = fs::remove_dir_all(older) {
            eprintln!("Package committed; obsolete backup cleanup failed: {e}");
        }
    }
    Ok(())
}
fn recover_one(root: &Path, filename: &str) -> Result<(), String> {
    recover_with(root, filename, |_| Ok(()))
}
fn recover_with(
    root: &Path,
    filename: &str,
    mut checkpoint: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let intent: Intent = serde_json::from_slice(&read_bounded(root, filename, 4 * MAX_STATE)?)
        .map_err(|e| format!("Unsupported recovery intent: {e}"))?;
    if intent.version != 1
        || !valid_id(&intent.id)
        || !valid_handle_id(&intent.nonce)
        || journal(root, &intent.id).file_name().unwrap() != filename
    {
        return Err("Unknown or invalid recovery intent; nothing was replaced".into());
    }
    for v in [
        intent.old.as_ref(),
        intent.previous.as_ref(),
        Some(&intent.new),
    ]
    .into_iter()
    .flatten()
    {
        validate_state(&v.state)?;
        if v.state.manifest.id != intent.id || !valid_handle_id(&v.state_hash) {
            return Err("Invalid recovery version".into());
        }
    }
    let safe = intent.old.as_ref().map(|v| safe_state(&v.state));
    let safe_hash = safe.as_ref().map(encode).transpose()?.map(|b| digest(&b));
    let paths = slots(root, &intent);
    let mut hashes = Vec::new();
    for path in &paths {
        hashes.push(if exists(path)? {
            let actual = verified(path, &intent.id)?.0;
            for v in [
                intent.old.as_ref(),
                intent.previous.as_ref(),
                Some(&intent.new),
            ]
            .into_iter()
            .flatten()
            {
                if actual.state_hash == v.state_hash
                    && serde_json::to_value(&actual.state).unwrap()
                        != serde_json::to_value(&v.state).unwrap()
                {
                    return Err("Recovery metadata does not match its captured version".into());
                }
            }
            Some(actual.state_hash)
        } else {
            None
        });
    }
    let old_hash = intent.old.as_ref().map(|v| &v.state_hash);
    let prior_hash = intent.previous.as_ref().map(|v| &v.state_hash);
    let is_old = |h: &String| Some(h) == old_hash || Some(h) == safe_hash.as_ref();
    for (i, h) in hashes.iter().enumerate() {
        if let Some(h) = h {
            let allowed = match i {
                0 => is_old(h) || h == &intent.new.state_hash,
                1 => h == &intent.new.state_hash,
                2 => is_old(h),
                3 => is_old(h) || Some(h) == prior_hash,
                4 => Some(h) == prior_hash,
                _ => false,
            };
            if !allowed {
                return Err("Ambiguous recovery layout; nothing was replaced".into());
            }
        }
    }
    let old_locations: Vec<_> = [0, 2, 3]
        .into_iter()
        .filter(|i| hashes[*i].as_ref().is_some_and(&is_old))
        .collect();
    let prior_locations: Vec<_> = [3, 4]
        .into_iter()
        .filter(|i| hashes[*i].as_ref().is_some_and(|h| Some(h) == prior_hash))
        .collect();
    if old_locations.len() != usize::from(intent.old.is_some())
        || prior_locations.len() != usize::from(intent.previous.is_some())
        || (hashes[0].as_ref() == Some(&intent.new.state_hash) && hashes[1].is_some())
    {
        return Err("Missing or duplicated recovery version; manual review required".into());
    }
    if hashes[0].as_ref() == Some(&intent.new.state_hash) {
        move_dir(root, &paths[0], &paths[1])?;
    }
    checkpoint("candidate-parked")?;
    if let Some(i) = old_locations.first() {
        if *i != 0 {
            move_dir(root, &paths[*i], &paths[0])?;
        }
    }
    checkpoint("active-restored")?;
    if let Some(i) = prior_locations.first() {
        if *i != 3 {
            move_dir(root, &paths[*i], &paths[3])?;
        }
    }
    checkpoint("previous-restored")?;
    if let Some(safe) = safe {
        write_held_state(root, &paths[0], &intent.nonce, &safe)?;
    }
    checkpoint("held-disabled")?;
    sync_dir(root)?;
    fs::remove_file(journal(root, &intent.id)).map_err(|e| e.to_string())?;
    sync_dir(root)?;
    if matches!(exists(&paths[1]), Ok(true)) {
        if let Err(e) = fs::remove_dir_all(&paths[1]) {
            eprintln!("Recovery complete; staged candidate cleanup failed: {e}");
        }
    }
    Ok(())
}
fn write_held_state(
    root: &Path,
    destination: &Path,
    nonce: &str,
    safe: &InstalledState,
) -> Result<(), String> {
    let bytes = encode(safe)?;
    let staging = root.join(format!(".{}.state-{nonce}", plugin_key(&safe.manifest.id)));
    if exists(&staging)? {
        if read_bounded(
            root,
            staging.file_name().unwrap().to_str().unwrap(),
            MAX_STATE,
        )? != bytes
        {
            return Err("Recovery state staging conflict".into());
        }
    } else {
        intake::write_new(&staging, &bytes)?;
    }
    fs::rename(staging, destination.join(STATE_FILE)).map_err(|e| e.to_string())?;
    sync_dir(destination)
}
fn intents(root: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            && (name.ends_with(".transition.json") || name.ends_with(".removal.json"))
        {
            names.push(name);
        }
        if names.len() > 64 {
            return Err("Too many pending package transitions; manual review required".into());
        }
    }
    names.sort();
    Ok(names)
}
pub(super) fn assert_clean(root: &Path) -> Result<(), String> {
    if !intents(root)?.is_empty() {
        return Err(
            "An interrupted package change needs recovery. Reload packages before continuing."
                .into(),
        );
    }
    Ok(())
}
pub(super) fn recover_all(root: &Path) -> Result<(), String> {
    let names = intents(root)?;
    let mut identities = BTreeSet::new();
    for name in &names {
        let key = name
            .strip_suffix(".transition.json")
            .or_else(|| name.strip_suffix(".removal.json"))
            .unwrap();
        if !identities.insert(key) {
            return Err("Conflicting package transitions; manual review required".into());
        }
    }
    for name in names {
        if name.ends_with(".removal.json") {
            removal::recover(root, &name)?;
        } else {
            recover_one(root, &name)?;
        }
    }
    Ok(())
}
#[cfg(test)]
pub(super) fn remove_previous(root: &Path, id: &str) -> Result<(), String> {
    assert_idle(root, id)?;
    let path = previous(root, id);
    if exists(&path)? {
        fs::remove_dir_all(path).map_err(|e| format!("Remove retained version: {e}"))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn plugin_previous_version(
    app: AppHandle,
    plugin_id: String,
) -> Result<InstalledPlugin, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _read = intake::READ_LOCK
            .try_lock()
            .ok_or("Another package read is in progress")?;
        let _lock = PACKAGE_LOCK.lock();
        let root = packages_root(&app)?;
        assert_idle(&root, &plugin_id)?;
        let _ = read_state(&app, &plugin_id)?;
        if !exists(&previous(&root, &plugin_id))? {
            return Err("No retained previous version for this package".into());
        }
        Ok(InstalledPlugin::from(
            verified(&previous(&root, &plugin_id), &plugin_id)?.0.state,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn plugin_rollback_reviewed(
    app: AppHandle,
    plugin_id: String,
    expected_current: Value,
    expected_previous: Value,
) -> Result<InstalledPlugin, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _read = intake::READ_LOCK
            .try_lock()
            .ok_or("Another package read is in progress")?;
        let _lock = PACKAGE_LOCK.lock();
        rollback(
            &packages_root(&app)?,
            &plugin_id,
            expected_current,
            expected_previous,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
fn rollback(
    root: &Path,
    plugin_id: &str,
    expected_current: Value,
    expected_previous: Value,
) -> Result<InstalledPlugin, String> {
    assert_idle(root, plugin_id)?;
    let current = verified(&root.join(plugin_key(plugin_id)), plugin_id)?
        .0
        .state;
    verify_reviewed_state(Some(&current), Some(Some(expected_current)))?;
    let (prior, snapshot) = verified(&previous(&root, &plugin_id), &plugin_id)?;
    verify_reviewed_state(Some(&prior.state), Some(Some(expected_previous)))?;
    if current.manifest.publisher != prior.state.manifest.publisher {
        return Err("Retained publisher differs".into());
    }
    let mut state = prior.state;
    state.enabled = false;
    state.quarantined = false;
    state.quarantine_reason = None;
    state.workspace_grants.clear();
    state.installed_at = now_ms().max(
        current
            .installed_at
            .checked_add(1)
            .ok_or("Package timestamp overflow")?,
    );
    let nonce = random_handle_id()?;
    let temp = root.join(format!(".{}.install-{nonce}", plugin_key(&plugin_id)));
    intake::private_dir(&temp)?;
    let result = (|| {
        write_snapshot_files(&temp, &snapshot.files)?;
        intake::write_new(&temp.join(STATE_FILE), &encode(&state)?)?;
        promote(&root, &temp, &state, &nonce)?;
        Ok(InstalledPlugin::from(state))
    })();
    if result.is_err() && !exists(&journal(&root, &plugin_id))? {
        let _ = fs::remove_dir_all(temp);
    }
    result
}
