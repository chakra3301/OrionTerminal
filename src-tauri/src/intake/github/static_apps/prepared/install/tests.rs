use super::super::tests::{candidate, capture, database_fixture};
use super::*;
use std::cell::Cell;
use std::path::{Path, PathBuf};
mod headless;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("orion-prepared-install-{}", ulid::Ulid::new()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn setup() -> (Connection, PreparedApproval) {
    let mut db = database_fixture();
    let s = capture();
    super::super::super::store::publish(&mut db, &s).unwrap();
    let summary =
        store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    (
        db,
        PreparedApproval {
            schema_version: 1,
            id: summary.id,
            output_hash: summary.output_hash,
            capture_hash: s.summary.capture_hash,
            fingerprint: summary.inspection.fingerprint,
            permissions: vec!["storage.plugin".into()],
            rights_reviewed: true,
        },
    )
}
fn publish_at(
    root: &Path,
    db: &mut Connection,
    approval: PreparedApproval,
) -> Result<InstalledPlugin, String> {
    install_reviewed(db, approval, |files, fingerprint, permissions, rights| {
        intake::publish_prepared_disabled(root, files, fingerprint, permissions, rights)
    })
}
fn key() -> String {
    hash(candidate().plugin_id.as_bytes())
}
#[test]
#[ignore = "Explicit actual captured source/candidate backend round-trip in private proof root; no UI or engine execution"]
fn backend_live_candidate_flow_without_screen() {
    let root = super::super::super::acceptance::proof_root();
    let receipt_path = root.join("live-backend-install-receipt.json");
    assert!(!receipt_path.exists());
    let capture: StaticCapture =
        serde_json::from_slice(&std::fs::read(root.join("live-capture.json")).unwrap()).unwrap();
    let candidate: Candidate =
        serde_json::from_slice(&std::fs::read(root.join("live-candidate.json")).unwrap()).unwrap();
    let mut db = Connection::open_with_flags(
        root.join("backend-source.db"),
        OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    db.busy_timeout(Duration::from_millis(500)).unwrap();
    db.execute_batch(include_str!(
        "../../../../../../migrations/0033_static_app_candidates.sql"
    ))
    .unwrap();
    let selected = store::save(
        &mut db,
        &capture.summary.id,
        &capture.summary.capture_hash,
        candidate.clone(),
    )
    .unwrap();
    drop(db);
    let mut reopened = Connection::open_with_flags(
        root.join("backend-source.db"),
        OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .unwrap();
    reopened.pragma_update(None, "foreign_keys", true).unwrap();
    let saved = store::load(&reopened, &candidate.candidate_id).unwrap();
    assert_eq!(
        serde_json::to_value(&saved.candidate).unwrap(),
        serde_json::to_value(&candidate).unwrap()
    );
    let approval = PreparedApproval {
        schema_version: 1,
        id: selected.id.clone(),
        output_hash: selected.output_hash.clone(),
        capture_hash: capture.summary.capture_hash.clone(),
        fingerprint: selected.inspection.fingerprint.clone(),
        permissions: vec!["storage.plugin".into()],
        rights_reviewed: true,
    };
    let packages = root.join("backend-packages");
    std::fs::DirBuilder::new().create(&packages).unwrap();
    let installed = publish_at(&packages, &mut reopened, approval).unwrap();
    assert!(!installed.enabled && installed.workspace_handles.is_empty());
    let destination = packages.join(hash(candidate.plugin_id.as_bytes()));
    for file in &candidate.files {
        assert_eq!(
            std::fs::read(destination.join(&file.path)).unwrap(),
            STANDARD.decode(&file.data_base64).unwrap()
        );
    }
    assert_eq!(store::list(&reopened).unwrap().len(), 1);
    assert!(super::super::super::store::discard(
        &mut reopened,
        &capture.summary.id,
        &capture.summary.capture_hash
    )
    .is_err());
    let receipt = serde_json::json!({"schemaVersion":1,"source":capture.summary,"prepared":selected,"installed":installed,"destination":destination,"authority":"Actual backend source/candidate/disabled-byte publication in owned proof scratch only; rights bool is a test assertion, not user UI consent. No engine execution, UI install/enable, provider or real app-profile write. Source/candidate retained."});
    super::super::super::acceptance::new_file(
        &receipt_path,
        &serde_json::to_vec_pretty(&receipt).unwrap(),
    );
    println!("Actual captured source → frontend generator → native candidate reload → exact disabled scratch publication passed");
}

#[test]
fn exact_stored_candidate_publishes_disabled_without_source_candidate_or_data_rewind() {
    let (mut db, approval) = setup();
    let root = Scratch::new();
    let before = serde_json::to_value(store::load(&db, ZERO_ID).unwrap()).unwrap();
    let installed = publish_at(&root.0, &mut db, approval.clone()).unwrap();
    assert!(!installed.enabled && !installed.quarantined && installed.workspace_handles.is_empty());
    assert_eq!(installed.granted_permissions, ["storage.plugin"]);
    assert_eq!(installed.fingerprint, approval.fingerprint);
    assert_ne!(installed.fingerprint, approval.output_hash);
    let destination = root.0.join(key());
    for f in candidate().files {
        assert_eq!(
            std::fs::read(destination.join(f.path)).unwrap(),
            STANDARD.decode(f.data_base64).unwrap()
        );
    }
    let state: serde_json::Value =
        serde_json::from_slice(&std::fs::read(destination.join(".orion-state.json")).unwrap())
            .unwrap();
    assert_eq!(state["enabled"], false);
    assert_eq!(state["workspaceGrants"], serde_json::json!([]));
    assert_eq!(
        serde_json::to_value(store::load(&db, ZERO_ID).unwrap()).unwrap(),
        before
    );
    assert_eq!(super::super::super::store::list(&db).unwrap().len(), 1);
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&destination)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(destination.join("ui.html"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
#[test]
fn approval_version_rights_identity_hashes_and_grants_fail_before_publication() {
    let (mut db, a) = setup();
    let mutations: Vec<Box<dyn Fn(&mut PreparedApproval)>> = vec![
        Box::new(|a| a.schema_version = 2),
        Box::new(|a| a.rights_reviewed = false),
        Box::new(|a| a.id = "../other".into()),
        Box::new(|a| a.output_hash = "f".repeat(64)),
        Box::new(|a| a.capture_hash = "f".repeat(64)),
        Box::new(|a| a.fingerprint = "f".repeat(64)),
        Box::new(|a| a.permissions = vec![]),
        Box::new(|a| a.permissions = vec!["storage.plugin".into(), "storage.plugin".into()]),
        Box::new(|a| a.permissions = vec!["process".into()]),
    ];
    for change in mutations {
        let mut altered = a.clone();
        change(&mut altered);
        let called = Cell::new(false);
        assert!(install_reviewed(&mut db, altered, |_, _, _, _| {
            called.set(true);
            Err("must not publish".into())
        })
        .is_err());
        assert!(!called.get());
    }
    let mut value = serde_json::to_value(a).unwrap();
    value["enabled"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PreparedApproval>(value).is_err());
}
#[test]
fn missing_or_tampered_saved_bytes_never_reach_the_installer() {
    for removed in [false, true] {
        let (mut db, a) = setup();
        if removed {
            store::discard(&mut db, ZERO_ID, &a.output_hash).unwrap();
        } else {
            db.execute_batch("DROP TRIGGER static_app_candidates_immutable")
                .unwrap();
            let mut r = store::load(&db, ZERO_ID).unwrap();
            r.candidate.files[0].data_base64 = "changed".into();
            db.execute(
                "UPDATE static_app_candidates SET candidate_json=?1",
                [serde_json::to_string(&r).unwrap()],
            )
            .unwrap();
        }
        let called = Cell::new(false);
        assert!(install_reviewed(&mut db, a, |_, _, _, _| {
            called.set(true);
            Err("must not publish".into())
        })
        .is_err());
        assert!(!called.get());
    }
}
#[test]
fn installed_identity_and_recovery_slots_are_never_replaced_or_enabled() {
    let (mut db, a) = setup();
    let root = Scratch::new();
    publish_at(&root.0, &mut db, a.clone()).unwrap();
    let state = root.0.join(key()).join(".orion-state.json");
    let before = std::fs::read(&state).unwrap();
    assert!(publish_at(&root.0, &mut db, a.clone())
        .unwrap_err()
        .contains("already installed"));
    assert_eq!(std::fs::read(&state).unwrap(), before);
    let other = Scratch::new();
    let marker = other.0.join(format!(".{}.transition.json", key()));
    std::fs::write(&marker, b"synthetic unfinished transition").unwrap();
    assert!(publish_at(&other.0, &mut db, a.clone()).is_err());
    assert_eq!(
        std::fs::read(marker).unwrap(),
        b"synthetic unfinished transition"
    );
    assert_eq!(std::fs::read_dir(&other.0).unwrap().count(), 1);
    let previous = Scratch::new();
    std::fs::create_dir(previous.0.join(format!(".{}.previous", key()))).unwrap();
    assert!(publish_at(&previous.0, &mut db, a).is_err());
}
#[cfg(unix)]
#[test]
fn existing_destination_symlink_is_refused_without_following_or_overwriting() {
    let (mut db, a) = setup();
    let root = Scratch::new();
    let outside = Scratch::new();
    std::fs::write(outside.0.join("sentinel"), b"preserve").unwrap();
    std::os::unix::fs::symlink(&outside.0, root.0.join(key())).unwrap();
    assert!(publish_at(&root.0, &mut db, a).is_err());
    assert_eq!(
        std::fs::read(outside.0.join("sentinel")).unwrap(),
        b"preserve"
    );
    assert_eq!(std::fs::read_dir(&outside.0).unwrap().count(), 1);
}
#[test]
fn discard_cannot_cross_revalidation_publication_ordering_and_does_not_remove_installed_code() {
    let (seed, a) = setup();
    let root = Scratch::new();
    let file = root.0.join("capture.db");
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&file)
            .unwrap();
    }
    let mut db = Connection::open(&file).unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    db.execute_batch(include_str!(
        "../../../../../../migrations/0032_static_app_sources.sql"
    ))
    .unwrap();
    db.execute_batch(include_str!(
        "../../../../../../migrations/0033_static_app_candidates.sql"
    ))
    .unwrap();
    let s = capture();
    super::super::super::store::publish(&mut db, &s).unwrap();
    store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    let packages = root.0.join("packages");
    std::fs::create_dir(&packages).unwrap();
    install_reviewed(
        &mut db,
        a.clone(),
        |files, fingerprint, permissions, rights| {
            let mut peer = Connection::open(&file).unwrap();
            peer.busy_timeout(std::time::Duration::ZERO).unwrap();
            assert!(store::discard(&mut peer, ZERO_ID, &a.output_hash).is_err());
            assert!(super::super::super::store::discard(
                &mut peer,
                &s.summary.id,
                &s.summary.capture_hash
            )
            .is_err());
            intake::publish_prepared_disabled(&packages, files, fingerprint, permissions, rights)
        },
    )
    .unwrap();
    store::discard(&mut db, ZERO_ID, &a.output_hash).unwrap();
    super::super::super::store::discard(&mut db, &s.summary.id, &s.summary.capture_hash).unwrap();
    assert!(packages.join(key()).join("ui.html").is_file());
    assert!(store::list(&db).unwrap().is_empty());
    assert!(super::super::super::store::list(&db).unwrap().is_empty());
    assert_eq!(store::list(&seed).unwrap().len(), 1);
}
