use super::*;
const ID: &str = "dev.recovery.test";
pub(super) struct Scratch(pub(super) PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub(super) fn fixture() -> Scratch {
    let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "orion-package-recovery-{}",
        random_handle_id().unwrap()
    ));
    intake::private_dir(&root).unwrap();
    Scratch(root)
}
fn staged(root: &Path, n: u64) -> (PathBuf, InstalledState, String) {
    let nonce = random_handle_id().unwrap();
    let temp = root.join(format!(".{}.install-{nonce}", plugin_key(ID)));
    intake::private_dir(&temp).unwrap();
    let manifest = serde_json::json!({"id":ID,"name":"Recovery fixture","version":format!("{n}.0.0"),"apiVersion":"1","engines":{"orion":"*"},"publisher":"test","entrypoints":{"ui":"ui.html"},"contributes":{"apps":[{"id":"fixture","name":"Fixture"}]},"permissions":["storage.plugin", "workspace.read"]});
    intake::write_new(
        &temp.join(MANIFEST_FILE),
        &serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    intake::write_new(
        &temp.join("ui.html"),
        format!("<script>throw new Error('fixture {n}: never execute')</script>").as_bytes(),
    )
    .unwrap();
    let snapshot = intake::collect_manager(&temp).unwrap();
    let state = InstalledState {
        manifest: snapshot.inspection.manifest,
        fingerprint: snapshot.inspection.fingerprint,
        installed_at: n,
        enabled: true,
        quarantined: false,
        quarantine_reason: None,
        granted_permissions: vec!["storage.plugin".into(), "workspace.read".into()],
        workspace_grants: vec![WorkspaceGrant {
            id: "b".repeat(64),
            label: "Fixture workspace".into(),
            root: root.to_path_buf(),
            read: true,
            write: false,
            created_at: n,
        }],
    };
    intake::write_new(&temp.join(STATE_FILE), &encode(&state).unwrap()).unwrap();
    (temp, state, nonce)
}
pub(super) fn install(root: &Path, n: u64) -> InstalledState {
    let (temp, state, nonce) = staged(root, n);
    promote(root, &temp, &state, &nonce).unwrap();
    state
}
pub(super) fn public(state: &InstalledState) -> Value {
    serde_json::to_value(InstalledPlugin::from(state.clone())).unwrap()
}
pub(super) fn active(root: &Path) -> InstalledState {
    verified(&root.join(plugin_key(ID)), ID).unwrap().0.state
}
pub(super) fn prior(root: &Path) -> InstalledState {
    verified(&previous(root, ID), ID).unwrap().0.state
}
pub(super) fn stop(point: &str, target: &str) -> Result<(), String> {
    if point == target {
        Err("simulated process stop".into())
    } else {
        Ok(())
    }
}
pub(super) fn assert_restored(root: &Path, expected: &InstalledState, before: &InstalledState) {
    let current = active(root);
    assert_eq!(current.fingerprint, expected.fingerprint);
    assert!(!current.enabled);
    assert!(current.quarantined);
    assert!(current.workspace_grants.is_empty());
    assert_eq!(prior(root).fingerprint, before.fingerprint);
    assert_idle(root, ID).unwrap();
    let hash = verified(&root.join(plugin_key(ID)), ID)
        .unwrap()
        .0
        .state_hash;
    recover_all(root).unwrap();
    assert_eq!(
        verified(&root.join(plugin_key(ID)), ID)
            .unwrap()
            .0
            .state_hash,
        hash
    );
}
#[test]
fn retains_one_version_and_explicit_rollback_is_disabled_without_workspace_resurrection() {
    let root = fixture();
    let first = install(&root.0, 1);
    assert!(!exists(&previous(&root.0, ID)).unwrap());
    let second = install(&root.0, 2);
    assert_eq!(prior(&root.0).fingerprint, first.fingerprint);
    let third = install(&root.0, 3);
    assert_eq!(prior(&root.0).fingerprint, second.fingerprint);
    let result = rollback(&root.0, ID, public(&third), public(&second)).unwrap();
    assert_eq!(result.fingerprint, second.fingerprint);
    assert!(!result.enabled);
    assert!(result.workspace_handles.is_empty());
    assert!(result.installed_at > third.installed_at);
    assert_eq!(prior(&root.0).fingerprint, third.fingerprint);
    assert_eq!(fs::read_dir(&root.0).unwrap().count(), 2);
    let again = rollback(
        &root.0,
        ID,
        public(&active(&root.0)),
        public(&prior(&root.0)),
    )
    .unwrap();
    assert_eq!(again.fingerprint, third.fingerprint);
    assert!(!again.enabled);
    assert!(again.workspace_handles.is_empty());
}
#[test]
fn each_publication_interruption_restores_the_prior_disabled_and_preserves_history() {
    for point in [
        "prepared",
        "previous-parked",
        "current-parked",
        "published",
        "retained",
    ] {
        let root = fixture();
        let first = install(&root.0, 1);
        let second = install(&root.0, 2);
        let (temp, third, nonce) = staged(&root.0, 3);
        assert!(promote_with(&root.0, &temp, &third, &nonce, |p| stop(p, point)).is_err());
        assert!(assert_idle(&root.0, ID).is_err());
        assert!(assert_clean(&root.0).is_err());
        assert!(journal(&root.0, ID).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(journal(&root.0, ID))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o077,
                0
            );
        }
        recover_all(&root.0).unwrap();
        assert_restored(&root.0, &second, &first);
        assert_clean(&root.0).unwrap();
    }
}
#[test]
fn recovery_itself_is_restartable_at_each_mutating_boundary() {
    for point in [
        "candidate-parked",
        "active-restored",
        "previous-restored",
        "held-disabled",
    ] {
        let root = fixture();
        let first = install(&root.0, 1);
        let second = install(&root.0, 2);
        let (temp, third, nonce) = staged(&root.0, 3);
        assert!(promote_with(&root.0, &temp, &third, &nonce, |p| stop(p, "retained")).is_err());
        let name = journal(&root.0, ID)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
        assert!(recover_with(&root.0, &name, |p| stop(p, point)).is_err());
        recover_all(&root.0).unwrap();
        assert_restored(&root.0, &second, &first);
    }
}
#[test]
fn interrupted_first_install_is_never_promoted_by_recovery() {
    for point in ["prepared", "published", "retained"] {
        let root = fixture();
        let (temp, state, nonce) = staged(&root.0, 1);
        assert!(promote_with(&root.0, &temp, &state, &nonce, |p| stop(p, point)).is_err());
        recover_all(&root.0).unwrap();
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 0);
    }
}
#[test]
fn changed_review_or_corrupt_retained_payload_cannot_replace_the_current_version() {
    let root = fixture();
    let first = install(&root.0, 1);
    let second = install(&root.0, 2);
    let mut changed = public(&second);
    changed["enabled"] = Value::Bool(false);
    assert!(rollback(&root.0, ID, changed, public(&first)).is_err());
    let mut changed = public(&first);
    changed["fingerprint"] = Value::String("c".repeat(64));
    assert!(rollback(&root.0, ID, public(&second), changed).is_err());
    fs::write(previous(&root.0, ID).join("ui.html"), "tampered").unwrap();
    assert!(rollback(&root.0, ID, public(&second), public(&first)).is_err());
    assert_eq!(active(&root.0).fingerprint, second.fingerprint);
    assert!(active(&root.0).enabled);
    assert_eq!(fs::read_dir(&root.0).unwrap().count(), 2);
}
#[test]
fn unknown_or_inconsistent_intent_preserves_all_files_and_blocks_native_state_access() {
    for kind in ["version", "metadata", "nonce", "missing"] {
        let root = fixture();
        let first = install(&root.0, 1);
        let (temp, second, nonce) = staged(&root.0, 2);
        assert!(promote_with(&root.0, &temp, &second, &nonce, |p| stop(p, "prepared")).is_err());
        let path = journal(&root.0, ID);
        let bytes = fs::read(&path).unwrap();
        let mut value: Value = serde_json::from_slice(&bytes).unwrap();
        match kind {
            "version" => value["version"] = 99.into(),
            "metadata" => value["old"]["state"]["enabled"] = false.into(),
            "nonce" => value["nonce"] = "../outside".into(),
            "missing" => {
                fs::rename(
                    root.0.join(plugin_key(ID)),
                    root.0.join("outside-transaction"),
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(recover_all(&root.0).is_err());
        assert!(assert_idle(&root.0, ID).is_err());
        assert!(temp.exists());
        if kind != "missing" {
            assert_eq!(active(&root.0).fingerprint, first.fingerprint);
        }
    }
}
#[test]
fn host_state_does_not_break_maximum_payload_enumeration() {
    let root = fixture();
    let (temp, mut state, nonce) = staged(&root.0, 1);
    fs::remove_file(temp.join(STATE_FILE)).unwrap();
    for n in 0..510 {
        intake::write_new(&temp.join(format!("resource-{n}.txt")), b"fixture").unwrap();
    }
    let payload = intake::collect_manager(&temp).unwrap();
    assert_eq!(payload.inspection.file_count, 512);
    state.fingerprint = payload.inspection.fingerprint;
    intake::write_new(&temp.join(STATE_FILE), &encode(&state).unwrap()).unwrap();
    assert_eq!(verified(&temp, ID).unwrap().1.inspection.file_count, 512);
    promote(&root.0, &temp, &state, &nonce).unwrap();
    assert_eq!(active(&root.0).fingerprint, state.fingerprint);
}
#[test]
fn removal_drops_retained_history_and_fresh_intake_refuses_orphan_history() {
    let root = fixture();
    install(&root.0, 1);
    install(&root.0, 2);
    assert!(assert_fresh(&root.0, ID).is_err());
    remove_previous(&root.0, ID).unwrap();
    assert!(!previous(&root.0, ID).exists());
    assert!(root.0.join(plugin_key(ID)).exists());
}
#[cfg(unix)]
#[test]
#[ignore = "private child-process fixture invoked by sigkill_reopen_recovers"]
fn crash_worker() {
    let root =
        PathBuf::from(std::env::var("ORION_TEST_RECOVERY_ROOT").expect("private fixture root"));
    assert_eq!(
        root.parent().unwrap(),
        std::env::temp_dir().canonicalize().unwrap()
    );
    assert!(root
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("orion-package-recovery-"));
    let point = std::env::var("ORION_TEST_RECOVERY_STOP").unwrap();
    assert!(["current-parked", "published"].contains(&point.as_str()));
    let (temp, state, nonce) = staged(&root, 3);
    promote_with(&root, &temp, &state, &nonce, |p| {
        if p == point {
            fs::write(root.join(".crash-ready"), point.as_bytes()).unwrap();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
        Ok(())
    })
    .unwrap();
    panic!("worker never reached stop point");
}
#[cfg(unix)]
#[test]
fn sigkill_reopen_recovers() {
    use std::os::unix::process::ExitStatusExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    for point in ["current-parked", "published"] {
        let root = fixture();
        let first = install(&root.0, 1);
        let second = install(&root.0, 2);
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "plugin_runtime::recovery::tests::crash_worker",
                "--ignored",
                "--test-threads=1",
            ])
            .env("ORION_TEST_RECOVERY_ROOT", &root.0)
            .env("ORION_TEST_RECOVERY_STOP", point)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut killed = false;
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if !killed && root.0.join(".crash-ready").exists() {
                child.kill().unwrap();
                killed = true;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("fixture worker timed out");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        assert!(killed);
        assert_eq!(status.signal(), Some(9));
        assert!(assert_idle(&root.0, ID).is_err());
        recover_all(&root.0).unwrap();
        assert_restored(&root.0, &second, &first);
    }
}
#[cfg(unix)]
#[test]
fn recovery_does_not_follow_retained_directory_links() {
    let root = fixture();
    install(&root.0, 1);
    install(&root.0, 2);
    let target = fixture();
    fs::write(target.0.join("sentinel"), "keep").unwrap();
    remove_previous(&root.0, ID).unwrap();
    std::os::unix::fs::symlink(&target.0, previous(&root.0, ID)).unwrap();
    assert!(verified(&previous(&root.0, ID), ID).is_err());
    assert_eq!(
        fs::read_to_string(target.0.join("sentinel")).unwrap(),
        "keep"
    );
}
