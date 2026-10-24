use super::*;
use crate::xdesign_state::{commit_with_import, StateWrite};

struct Fixture {
    root: PathBuf,
    conn: Connection,
    receipt: Receipt,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("xdesign-import-test-{}", ulid::Ulid::new()));
        std::fs::create_dir(&root).unwrap();
        let conn = Connection::open(root.join("state.sqlite")).unwrap();
        conn.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
            .unwrap();
        Self {
            root,
            conn,
            receipt: Receipt {
                project_id: ulid::Ulid::new().to_string(),
                operation_id: ulid::Ulid::new().to_string(),
            },
        }
    }
    fn archive(&self) -> (Vec<u8>, String) {
        let data = b"original resource bytes";
        let name = format!("resources/{}.png", hash(data));
        let document =
            json!({"pages":[{"shapes":[{"kind":"image","filePath":name}]}],"activePageId":"page"});
        let manifest = json!({"format":"orion.xdesign","version":1,"name":"Imported","document":document,"files":[{"name":name,"bytes":data.len(),"sha256":hash(data)}]});
        let mut zip = photocraft_format::zip::ZipWriter::new();
        zip.add("project.json", &serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        zip.add(&name, data).unwrap();
        (zip.finish().unwrap(), name)
    }
    fn stage(&mut self, finish_receipt: bool) -> ImportedProject {
        let (archive, _) = self.archive();
        let lease = begin(&mut self.conn, &self.root, &self.receipt).unwrap();
        let imported = crate::xdesign_archive::unpack_archive_managed(
            &archive,
            &lease.target(),
            Some((&lease, &mut self.conn)),
        )
        .unwrap();
        if finish_receipt {
            finish(&mut self.conn, &lease).unwrap();
        }
        imported
    }
    fn target(&self) -> PathBuf {
        self.root.join(&self.receipt.project_id)
    }
    fn resource(&self) -> PathBuf {
        let (_, name) = self.archive();
        self.target().join(asset_relative(&name).unwrap())
    }
    fn writes(&self, document: &Value) -> Vec<StateWrite> {
        vec![StateWrite{key:format!("xdesign.project.{}",self.receipt.project_id),value:Some(document.to_string())},StateWrite{key:"xdesign.projects".into(),value:Some(json!({"registry":[{"id":self.receipt.project_id,"name":"Imported","createdAt":1,"updatedAt":1}]}).to_string())}]
    }
    fn commit(&mut self, writes: &[StateWrite]) -> Result<(), String> {
        let lease = Lease::open(&self.root, &self.receipt, false)?;
        commit_with_import(&mut self.conn, writes, Some(&lease))
    }
    fn control(&mut self, discard: bool) -> Result<Value, String> {
        control(&mut self.conn, &self.root, &self.receipt, discard)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn lost_stage_reply_recovers_the_original_identity_and_discards_only_generated_assets() {
    let mut f = Fixture::new();
    let original = f.root.join("original.png");
    std::fs::write(&original, b"preserve source").unwrap();
    let imported = f.stage(false);
    let reply = f.control(false).unwrap();
    assert_eq!(reply["phase"], "staged");
    assert_eq!(reply["imported"]["document"], imported.document);
    assert!(f.resource().exists());
    assert!(begin(&mut f.conn, &f.root, &f.receipt)
        .unwrap_err_string()
        .contains("Recover"));
    assert_eq!(f.control(true).unwrap()["phase"], "discarded");
    assert!(!f.target().exists());
    assert_eq!(std::fs::read(original).unwrap(), b"preserve source");
    assert_eq!(f.control(true).unwrap()["phase"], "discarded");
    assert_eq!(f.control(false).unwrap()["phase"], "discarded");
}

trait LeaseError {
    fn unwrap_err_string(self) -> String;
}

#[test]
fn sealed_stage_recovers_before_destination_promotion() {
    let mut f = Fixture::new();
    let imported = f.stage(false);
    let lease = Lease::open(&f.root, &f.receipt, false).unwrap();
    std::fs::rename(lease.target(), lease.stage()).unwrap();
    drop(lease);
    let recovered = f.control(false).unwrap();
    assert_eq!(recovered["phase"], "staged");
    assert_eq!(recovered["imported"]["document"], imported.document);
    assert!(f.resource().exists());
    f.control(true).unwrap();
    assert!(!f.target().exists());
}
impl LeaseError for Result<Lease, String> {
    fn unwrap_err_string(self) -> String {
        match self {
            Err(e) => e,
            Ok(_) => panic!("expected refusal"),
        }
    }
}

#[test]
fn registered_copy_is_protected_and_lost_commit_replay_preserves_later_edits() {
    let mut f = Fixture::new();
    let imported = f.stage(true);
    let writes = f.writes(&imported.document);
    f.commit(&writes).unwrap();
    let edited = json!({"pages":[],"laterEdit":true});
    f.conn
        .execute(
            "UPDATE app_state SET value=?1 WHERE key=?2",
            params![
                edited.to_string(),
                format!("xdesign.project.{}", f.receipt.project_id)
            ],
        )
        .unwrap();
    let other = ulid::Ulid::new().to_string();
    let registry = json!({"registry":[{"id":other,"name":"Later project"},{"id":f.receipt.project_id,"name":"Renamed"}]});
    f.conn
        .execute(
            "UPDATE app_state SET value=?1 WHERE key='xdesign.projects'",
            [registry.to_string()],
        )
        .unwrap();
    f.commit(&writes).unwrap();
    let recovered = f.control(true).unwrap();
    assert_eq!(recovered["phase"], "committed");
    assert_eq!(recovered["imported"]["document"], edited);
    assert_eq!(recovered["registry"], registry["registry"]);
    assert_eq!(recovered["imported"]["name"], "Renamed");
    assert!(f.resource().exists());
}

#[test]
fn failed_registry_commit_rolls_back_receipt_and_cleanup_preserves_source() {
    let mut f = Fixture::new();
    let imported = f.stage(true);
    let writes = f.writes(&imported.document);
    f.conn.execute_batch("CREATE TRIGGER fail_registry BEFORE INSERT ON app_state WHEN NEW.key='xdesign.projects' BEGIN SELECT RAISE(ABORT,'injected disk full'); END;").unwrap();
    assert!(f
        .commit(&writes)
        .unwrap_err()
        .contains("injected disk full"));
    assert_eq!(
        record(&f.conn, &f.receipt).unwrap().unwrap().phase,
        "staged"
    );
    assert!(!registered(&f.conn, &f.receipt.project_id).unwrap());
    f.control(true).unwrap();
    assert!(!f.target().exists());
}

#[test]
fn pending_assets_cannot_register_without_receipt_or_with_changed_asset_references() {
    let mut f = Fixture::new();
    let imported = f.stage(true);
    let writes = f.writes(&imported.document);
    assert!(commit_with_import(&mut f.conn, &writes, None)
        .unwrap_err()
        .contains("original receipt"));
    let mut changed = imported.document;
    changed["pages"][0]["shapes"][0]["filePath"] = json!("/outside/original.png");
    let writes = f.writes(&changed);
    assert!(f
        .commit(&writes)
        .unwrap_err()
        .contains("asset references changed"));
    assert!(f.resource().exists());
    assert_eq!(
        record(&f.conn, &f.receipt).unwrap().unwrap().phase,
        "staged"
    );
}

#[test]
fn import_rejects_stale_registry_without_losing_another_windows_project() {
    let mut f = Fixture::new();
    let imported = f.stage(true);
    let writes = f.writes(&imported.document);
    let current_registry =
        json!({"registry":[{"id":ulid::Ulid::new().to_string(),"name":"Another window"}]});
    f.conn
        .execute(
            "INSERT INTO app_state VALUES('xdesign.projects',?1)",
            [current_registry.to_string()],
        )
        .unwrap();
    assert!(f
        .commit(&writes)
        .unwrap_err()
        .contains("project list changed"));
    assert_eq!(
        registry(&f.conn).unwrap(),
        current_registry["registry"].as_array().unwrap().clone()
    );
    assert_eq!(
        record(&f.conn, &f.receipt).unwrap().unwrap().phase,
        "staged"
    );
}

#[test]
fn changed_assets_and_forged_owner_metadata_are_preserved() {
    let mut f = Fixture::new();
    f.stage(true);
    let resource = f.resource();
    std::fs::write(&resource, b"replaced resource bytes").unwrap();
    assert!(f.control(true).unwrap_err().contains("Changed"));
    assert!(f.target().exists());
    let owner_path = f.target().join(OWNER);
    let mut owner: Owner = serde_json::from_slice(&std::fs::read(&owner_path).unwrap()).unwrap();
    owner.files[0].sha256 = hash(b"replaced resource bytes");
    owner.files[0].bytes = b"replaced resource bytes".len();
    write(&owner_path, &owner).unwrap();
    assert!(f
        .control(true)
        .unwrap_err()
        .contains("owner metadata changed"));
    assert_eq!(std::fs::read(resource).unwrap(), b"replaced resource bytes");
}

#[test]
fn unknown_files_and_empty_directories_are_preserved_without_quarantining() {
    for directory in [false, true] {
        let mut f = Fixture::new();
        f.stage(true);
        let unknown = f.target().join("unrecognized");
        if directory {
            std::fs::create_dir(&unknown).unwrap();
        } else {
            std::fs::write(&unknown, b"user data").unwrap();
        }
        assert!(f.control(true).unwrap_err().contains("Unknown"));
        assert!(unknown.exists());
        assert!(f.resource().exists());
        assert_eq!(
            record(&f.conn, &f.receipt).unwrap().unwrap().phase,
            "staged"
        );
    }
}

#[cfg(unix)]
#[test]
fn linked_assets_and_replaced_directory_identity_are_preserved() {
    use std::os::unix::fs::symlink;
    let mut f = Fixture::new();
    f.stage(true);
    let resource = f.resource();
    let original = f.root.join("original");
    std::fs::write(&original, b"original resource bytes").unwrap();
    std::fs::remove_file(&resource).unwrap();
    symlink(&original, &resource).unwrap();
    assert!(f.control(true).unwrap_err().contains("Linked"));
    assert_eq!(std::fs::read(original).unwrap(), b"original resource bytes");
    std::fs::remove_file(resource).unwrap();
    let saved = f.root.join("saved");
    std::fs::rename(f.target(), &saved).unwrap();
    std::fs::create_dir(f.target()).unwrap();
    std::fs::copy(saved.join(OWNER), f.target().join(OWNER)).unwrap();
    assert!(f
        .control(true)
        .unwrap_err()
        .contains("directory identity changed"));
    assert!(saved.exists());
    assert!(f.target().exists());
}

#[test]
fn changed_ready_document_cannot_recover_or_register() {
    let mut f = Fixture::new();
    let imported = f.stage(false);
    let ready = f.target().join(READY);
    let mut data: Value = serde_json::from_slice(&std::fs::read(&ready).unwrap()).unwrap();
    data["imported"]["name"] = json!("Changed");
    write(&ready, &data).unwrap();
    assert!(f.control(false).unwrap_err().contains("result changed"));
    let writes = f.writes(&imported.document);
    assert!(f.commit(&writes).unwrap_err().contains("result changed"));
    assert!(f.target().exists());
}

#[test]
fn interrupted_partial_quarantine_cleanup_resumes_with_owner_metadata_last() {
    let mut f = Fixture::new();
    f.stage(true);
    let lease = Lease::open(&f.root, &f.receipt, false).unwrap();
    let quarantine = lease.discarded();
    std::fs::rename(lease.target(), &quarantine).unwrap();
    let mut r = record(&f.conn, &f.receipt).unwrap().unwrap();
    r.phase = "discarded".into();
    save(&f.conn, &r).unwrap();
    let (_, name) = f.archive();
    std::fs::remove_file(quarantine.join(asset_relative(&name).unwrap())).unwrap();
    drop(lease);
    assert_eq!(
        pending(&f.conn).unwrap()["imports"][0]["phase"],
        "discarded"
    );
    assert_eq!(f.control(false).unwrap()["phase"], "discarded");
    f.control(true).unwrap();
    assert!(!quarantine.exists());
    assert_eq!(pending(&f.conn).unwrap()["imports"], json!([]));
    f.control(true).unwrap();
}

#[test]
fn empty_owned_directory_after_metadata_cleanup_is_repeatable_but_unknown_data_survives() {
    let mut f = Fixture::new();
    let lease = begin(&mut f.conn, &f.root, &f.receipt).unwrap();
    std::fs::create_dir(lease.stage()).unwrap();
    owner(&mut f.conn, &lease, &lease.stage(), &[]).unwrap();
    let mut r = record(&f.conn, &f.receipt).unwrap().unwrap();
    r.phase = "discarded".into();
    save(&f.conn, &r).unwrap();
    std::fs::remove_file(lease.stage().join(OWNER)).unwrap();
    let stage = lease.stage();
    drop(lease);
    f.control(true).unwrap();
    assert!(!stage.exists());
    let mut f = Fixture::new();
    let lease = begin(&mut f.conn, &f.root, &f.receipt).unwrap();
    std::fs::create_dir(lease.stage()).unwrap();
    owner(&mut f.conn, &lease, &lease.stage(), &[]).unwrap();
    std::fs::remove_file(lease.stage().join(OWNER)).unwrap();
    std::fs::write(lease.stage().join("unknown"), b"user data").unwrap();
    let stage = lease.stage();
    drop(lease);
    assert!(f.control(true).unwrap_err().contains("Unrecognized"));
    assert!(stage.join("unknown").exists());
}

#[test]
fn concurrent_cleanup_and_forged_operation_ids_cannot_bypass_the_lease() {
    let mut f = Fixture::new();
    f.stage(true);
    let lease = Lease::open(&f.root, &f.receipt, false).unwrap();
    let mut other = Connection::open(f.root.join("state.sqlite")).unwrap();
    assert!(control(&mut other, &f.root, &f.receipt, true)
        .unwrap_err()
        .contains("original project import"));
    drop(lease);
    let forged = Receipt {
        project_id: f.receipt.project_id.clone(),
        operation_id: ulid::Ulid::new().to_string(),
    };
    assert!(control(&mut other, &f.root, &forged, true).is_err());
    assert!(f.resource().exists());
    f.control(true).unwrap();
}

#[test]
fn empty_preparing_receipt_can_discard_but_missing_ownership_cannot_delete_files() {
    let mut f = Fixture::new();
    let lease = begin(&mut f.conn, &f.root, &f.receipt).unwrap();
    drop(lease);
    assert_eq!(f.control(false).unwrap()["phase"], "preparing");
    f.control(true).unwrap();
    let mut f = Fixture::new();
    let lease = begin(&mut f.conn, &f.root, &f.receipt).unwrap();
    std::fs::create_dir(lease.stage()).unwrap();
    let path = lease.stage();
    drop(lease);
    assert!(f.control(true).is_err());
    assert!(path.exists());
}

#[test]
fn pending_receipts_are_bounded_and_capacity_returns_after_cleanup() {
    let mut f = Fixture::new();
    for _ in 0..64 {
        let receipt = Receipt {
            project_id: ulid::Ulid::new().to_string(),
            operation_id: ulid::Ulid::new().to_string(),
        };
        drop(begin(&mut f.conn, &f.root, &receipt).unwrap());
    }
    assert_eq!(
        pending(&f.conn).unwrap()["imports"]
            .as_array()
            .unwrap()
            .len(),
        64
    );
    assert!(begin(&mut f.conn, &f.root, &f.receipt)
        .unwrap_err_string()
        .contains("Recover interrupted"));
    let first = pending(&f.conn).unwrap()["imports"][0].clone();
    let receipt = Receipt {
        project_id: first["projectId"].as_str().unwrap().into(),
        operation_id: first["operationId"].as_str().unwrap().into(),
    };
    control(&mut f.conn, &f.root, &receipt, true).unwrap();
    drop(begin(&mut f.conn, &f.root, &f.receipt).unwrap());
    assert_eq!(
        pending(&f.conn).unwrap()["imports"]
            .as_array()
            .unwrap()
            .len(),
        64
    );
}

#[test]
fn discovery_is_metadata_only_and_ready_labels_are_bounded_without_changing_saved_names() {
    let mut f = Fixture::new();
    let lease = begin(&mut f.conn, &f.root, &f.receipt).unwrap();
    assert_eq!(pending(&f.conn).unwrap()["imports"][0]["name"], Value::Null);
    assert_eq!(pending(&f.conn).unwrap()["imports"][0]["canOpen"], false);
    let document = json!({"pages":[],"activePageId":"page"});
    let name = "😀".repeat(300);
    let archive = crate::xdesign_archive::build_archive(&f.root, name.clone(), document).unwrap();
    let imported = crate::xdesign_archive::unpack_archive_managed(
        &archive,
        &lease.target(),
        Some((&lease, &mut f.conn)),
    )
    .unwrap();
    finish(&mut f.conn, &lease).unwrap();
    drop(lease);
    let listed = pending(&f.conn).unwrap();
    assert_eq!(
        listed["imports"][0]["name"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        256
    );
    assert_eq!(listed["imports"][0]["canOpen"], true);
    assert_eq!(imported.name, name);
    std::fs::write(f.target().join("unknown user data"), b"keep").unwrap();
    assert_eq!(pending(&f.conn).unwrap(), listed);
    assert!(f.control(false).unwrap_err().contains("Unknown"));
    assert!(f.target().join("unknown user data").exists());
}

#[test]
fn receipts_saved_before_display_metadata_remain_recoverable() {
    let mut f = Fixture::new();
    let imported = f.stage(true);
    let mut legacy: Value = serde_json::from_str(
        &f.conn
            .query_row(
                "SELECT value FROM app_state WHERE key=?1",
                [key(&f.receipt)],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
    )
    .unwrap();
    legacy.as_object_mut().unwrap().remove("label");
    f.conn
        .execute(
            "UPDATE app_state SET value=?1 WHERE key=?2",
            params![legacy.to_string(), key(&f.receipt)],
        )
        .unwrap();
    assert_eq!(pending(&f.conn).unwrap()["imports"][0]["name"], Value::Null);
    assert_eq!(pending(&f.conn).unwrap()["imports"][0]["canOpen"], true);
    assert_eq!(
        f.control(false).unwrap()["imported"]["document"],
        imported.document
    );
    f.control(true).unwrap();
}
