use super::*;
#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Removal {
    version: u8,
    id: String,
    nonce: String,
    current: Version,
    previous: Option<Version>,
}
pub(super) fn journal(root: &Path, id: &str) -> PathBuf {
    root.join(format!(".{}.removal.json", plugin_key(id)))
}
fn slots(root: &Path, intent: &Removal) -> [PathBuf; 4] {
    let key = plugin_key(&intent.id);
    let nonce = &intent.nonce;
    [
        root.join(&key),
        root.join(format!(".{key}.remove-{nonce}")),
        previous(root, &intent.id),
        root.join(format!(".{key}.remove-previous-{nonce}")),
    ]
}
pub(crate) fn remove_package(root: &Path, id: &str, expected: Option<Value>) -> Result<(), String> {
    remove_with(
        root,
        id,
        expected,
        |_| Ok(()),
        |p| fs::remove_dir_all(p).map_err(|e| e.to_string()),
    )
}
fn remove_with(
    root: &Path,
    id: &str,
    expected: Option<Value>,
    mut checkpoint: impl FnMut(&str) -> Result<(), String>,
    mut cleanup: impl FnMut(&Path) -> Result<(), String>,
) -> Result<(), String> {
    assert_idle(root, id)?;
    let current = verified(&root.join(plugin_key(id)), id)?.0;
    if let Some(expected) = expected {
        verify_reviewed_state(Some(&current.state), Some(Some(expected)))?;
    }
    let prior = previous(root, id);
    let previous = if exists(&prior)? {
        Some(verified(&prior, id)?.0)
    } else {
        None
    };
    let intent = Removal {
        version: 1,
        id: id.into(),
        nonce: random_handle_id()?,
        current,
        previous,
    };
    let [active, retired, previous, retired_previous] = slots(root, &intent);
    let bytes = serde_json::to_vec_pretty(&intent).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > 4 * MAX_STATE {
        return Err("Removal intent exceeds limit".into());
    }
    let staging = root.join(format!(".{}.intent-{}", plugin_key(id), intent.nonce));
    intake::write_new(&staging, &bytes)?;
    fs::rename(&staging, journal(root, id)).map_err(|e| e.to_string())?;
    sync_dir(root)?;
    checkpoint("prepared")?;
    move_dir(root, &active, &retired)?;
    checkpoint("current-retired")?;
    if intent.previous.is_some() {
        move_dir(root, &previous, &retired_previous)?;
    }
    checkpoint("previous-retired")?;
    fs::remove_file(journal(root, id)).map_err(|e| e.to_string())?;
    if let Err(e) = sync_dir(root) {
        eprintln!(
            "Removal committed; directory sync could not be confirmed; retired code retained: {e}"
        );
        return Ok(());
    }
    // Recursive deletion can be partial. It must never precede commit or trigger restoration.
    if checkpoint("committed").is_err() {
        return Ok(());
    }
    for path in [&retired, &retired_previous] {
        match exists(path) {
            Ok(false) => (),
            Ok(true) => {
                if let Err(e) = cleanup(path) {
                    eprintln!("Removal committed; retired code cleanup failed: {e}");
                }
            }
            Err(e) => eprintln!("Removal committed; retired code inspection failed: {e}"),
        }
    }
    Ok(())
}
pub(super) fn recover(root: &Path, name: &str) -> Result<(), String> {
    recover_with(root, name, |_| Ok(()))
}
fn recover_with(
    root: &Path,
    name: &str,
    mut checkpoint: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let intent: Removal = serde_json::from_slice(&read_bounded(root, name, 4 * MAX_STATE)?)
        .map_err(|e| format!("Unsupported removal intent: {e}"))?;
    if intent.version != 1
        || !valid_id(&intent.id)
        || !valid_handle_id(&intent.nonce)
        || journal(root, &intent.id).file_name().unwrap() != name
    {
        return Err("Invalid removal intent; nothing was replaced".into());
    }
    for version in [Some(&intent.current), intent.previous.as_ref()]
        .into_iter()
        .flatten()
    {
        validate_state(&version.state)?;
        if version.state.manifest.id != intent.id || !valid_handle_id(&version.state_hash) {
            return Err("Invalid removal version".into());
        }
    }
    let paths = slots(root, &intent);
    let safe = safe_state(&intent.current.state);
    let safe_hash = digest(&encode(&safe)?);
    let mut current_at = None;
    let mut previous_at = None;
    for (i, path) in paths.iter().enumerate() {
        if !exists(path)? {
            continue;
        }
        let actual = verified(path, &intent.id)?.0;
        let expected = if i < 2 {
            &intent.current
        } else {
            intent
                .previous
                .as_ref()
                .ok_or("Unexpected retained removal version")?
        };
        let original = actual.state_hash == expected.state_hash
            && serde_json::to_value(&actual.state).unwrap()
                == serde_json::to_value(&expected.state).unwrap();
        if !original && !(i == 0 && actual.state_hash == safe_hash) {
            return Err("Removal bytes or metadata changed; manual review required".into());
        }
        let location = if i < 2 {
            &mut current_at
        } else {
            &mut previous_at
        };
        if location.replace(i).is_some() {
            return Err("Duplicated removal version; nothing was replaced".into());
        }
    }
    let current_at = current_at.ok_or("Missing removal version; manual review required")?;
    if previous_at.is_some() != intent.previous.is_some() {
        return Err("Missing retained removal version; manual review required".into());
    }
    if current_at != 0 {
        move_dir(root, &paths[current_at], &paths[0])?;
    }
    checkpoint("active-restored")?;
    if let Some(i) = previous_at {
        if i != 2 {
            move_dir(root, &paths[i], &paths[2])?;
        }
    }
    checkpoint("previous-restored")?;
    write_held_state(root, &paths[0], &intent.nonce, &safe)?;
    checkpoint("held-disabled")?;
    sync_dir(root)?;
    fs::remove_file(journal(root, &intent.id)).map_err(|e| e.to_string())?;
    sync_dir(root)
}
#[tauri::command]
pub async fn plugin_remove_reviewed(
    app: AppHandle,
    plugin_id: String,
    expected_current: Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _read = intake::READ_LOCK
            .try_lock()
            .ok_or("Another package read is in progress")?;
        let _lock = PACKAGE_LOCK.lock();
        remove_package(&packages_root(&app)?, &plugin_id, Some(expected_current))
    })
    .await
    .map_err(|e| e.to_string())?
}
