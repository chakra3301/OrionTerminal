use super::super::tests::{active, assert_restored, fixture, install, prior, public, stop};
use super::*;
const ID: &str = "dev.recovery.test";
fn cleanup(path: &Path) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}

#[cfg(unix)]
#[test]
#[ignore = "private child fixture invoked by removal_sigkill_reopen"]
fn removal_crash_worker() {
    let root = PathBuf::from(std::env::var("ORION_TEST_REMOVAL_ROOT").unwrap());
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
    let point = std::env::var("ORION_TEST_REMOVAL_STOP").unwrap();
    assert!(["current-retired", "committed"].contains(&point.as_str()));
    remove_with(
        &root,
        ID,
        None,
        |p| {
            if p == point {
                fs::write(root.join(".removal-ready"), point.as_bytes()).unwrap();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
            Ok(())
        },
        cleanup,
    )
    .unwrap();
    panic!("worker did not reach its stop point");
}
#[cfg(unix)]
#[test]
fn removal_sigkill_reopen() {
    use std::{
        os::unix::process::ExitStatusExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    for point in ["current-retired", "committed"] {
        let root = fixture();
        let first = install(&root.0, 1);
        let second = install(&root.0, 2);
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "plugin_runtime::recovery::removal::tests::removal_crash_worker",
                "--ignored",
                "--test-threads=1",
            ])
            .env("ORION_TEST_REMOVAL_ROOT", &root.0)
            .env("ORION_TEST_REMOVAL_STOP", point)
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
            if !killed && root.0.join(".removal-ready").exists() {
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
        recover_all(&root.0).unwrap();
        if point == "current-retired" {
            assert_restored(&root.0, &second, &first);
        } else {
            assert!(!root.0.join(plugin_key(ID)).exists());
            assert!(!previous(&root.0, ID).exists());
            assert_fresh(&root.0, ID).unwrap();
        }
    }
}

#[test]
fn interrupted_removal_restores_intact_code_disabled_and_keeps_history() {
    for point in ["prepared", "current-retired", "previous-retired"] {
        let root = fixture();
        let first = install(&root.0, 1);
        let second = install(&root.0, 2);
        assert!(remove_with(
            &root.0,
            ID,
            Some(public(&second)),
            |p| stop(p, point),
            cleanup
        )
        .is_err());
        assert!(assert_idle(&root.0, ID).is_err());
        assert!(assert_clean(&root.0).is_err());
        recover_all(&root.0).unwrap();
        assert_restored(&root.0, &second, &first);
    }
}
#[test]
fn interrupted_removal_recovery_is_repeatable() {
    for point in ["active-restored", "previous-restored", "held-disabled"] {
        let root = fixture();
        let first = install(&root.0, 1);
        let second = install(&root.0, 2);
        assert!(remove_with(
            &root.0,
            ID,
            Some(public(&second)),
            |p| stop(p, "previous-retired"),
            cleanup
        )
        .is_err());
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
fn partial_cleanup_after_commit_never_restores_partial_code_or_reports_failed_removal() {
    let root = fixture();
    install(&root.0, 1);
    let second = install(&root.0, 2);
    fs::write(root.0.join("unrelated-data.json"), "keep").unwrap();
    let mut deleted = 0;
    remove_with(
        &root.0,
        ID,
        Some(public(&second)),
        |_| Ok(()),
        |path| {
            assert!(!journal(&root.0, ID).exists());
            fs::remove_file(path.join("ui.html")).unwrap();
            deleted += 1;
            Err("injected deletion failure after one file".into())
        },
    )
    .unwrap();
    assert_eq!(deleted, 2);
    recover_all(&root.0).unwrap();
    assert!(!root.0.join(plugin_key(ID)).exists());
    assert!(!previous(&root.0, ID).exists());
    assert_eq!(
        fs::read_to_string(root.0.join("unrelated-data.json")).unwrap(),
        "keep"
    );
    assert_fresh(&root.0, ID).unwrap();
}
#[test]
fn single_version_removal_and_no_history_recovery() {
    let root = fixture();
    let first = install(&root.0, 1);
    assert!(remove_with(
        &root.0,
        ID,
        Some(public(&first)),
        |p| stop(p, "current-retired"),
        cleanup
    )
    .is_err());
    recover_all(&root.0).unwrap();
    let held = active(&root.0);
    assert!(!held.enabled);
    assert!(held.workspace_grants.is_empty());
    remove_package(&root.0, ID, Some(public(&held))).unwrap();
    assert_eq!(fs::read_dir(&root.0).unwrap().count(), 0);
}
#[test]
fn stale_review_and_modified_payload_do_not_start_removal() {
    let root = fixture();
    let first = install(&root.0, 1);
    let second = install(&root.0, 2);
    assert!(remove_package(&root.0, ID, Some(public(&first))).is_err());
    assert_eq!(active(&root.0).fingerprint, second.fingerprint);
    fs::write(previous(&root.0, ID).join("ui.html"), "changed").unwrap();
    assert!(remove_package(&root.0, ID, Some(public(&second))).is_err());
    assert!(!journal(&root.0, ID).exists());
    assert!(root.0.join(plugin_key(ID)).exists());
}
#[test]
fn unknown_duplicate_and_conflicting_removal_intents_fail_without_restoration() {
    for kind in ["version", "duplicate", "conflict"] {
        let root = fixture();
        install(&root.0, 1);
        let second = install(&root.0, 2);
        assert!(remove_with(
            &root.0,
            ID,
            Some(public(&second)),
            |p| stop(p, "current-retired"),
            cleanup
        )
        .is_err());
        let path = journal(&root.0, ID);
        let mut intent: Removal = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        match kind {
            "version" => {
                intent.version = 99;
                fs::write(&path, serde_json::to_vec(&intent).unwrap()).unwrap();
            }
            "duplicate" => {
                let [dest, retired, _, _] = slots(&root.0, &intent);
                let (_, snapshot) = verified(&retired, ID).unwrap();
                intake::private_dir(&dest).unwrap();
                write_snapshot_files(&dest, &snapshot.files).unwrap();
                intake::write_new(
                    &dest.join(STATE_FILE),
                    &encode(&intent.current.state).unwrap(),
                )
                .unwrap();
            }
            "conflict" => fs::write(super::super::journal(&root.0, ID), "{}").unwrap(),
            _ => unreachable!(),
        }
        assert!(recover_all(&root.0).is_err());
        assert!(path.exists());
        assert_eq!(prior(&root.0).manifest.version, "1.0.0");
        if kind != "duplicate" {
            assert!(!root.0.join(plugin_key(ID)).exists());
        }
    }
}
