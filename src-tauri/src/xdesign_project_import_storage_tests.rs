use super::*;
use crate::xdesign_project_imports::{self as imports, Receipt};
use serde_json::json;

struct Fixture {
    root: PathBuf,
    db: Connection,
    receipt: Receipt,
    document: Value,
    photo: String,
    version: String,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("xdesign-import-maintenance-{}", ulid::Ulid::new()));
        std::fs::create_dir(&root).unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
            .unwrap();
        let source = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        let mut engine = photocraft_engine::Session::new();
        engine
            .execute("file.new", json!({"width":24,"height":24,"depth":32}))
            .unwrap();
        let mut session = super::super::PhotoSession {
            engine,
            color_settings: None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        let saved =
            super::super::publish(&root.join(&source).join(&photo), &photo, &mut session).unwrap();
        let document = json!({"pages":[{"id":"page","name":"Page 1","shapes":[],"past":[],"future":[]}],"activePageId":"page","photoDocuments":{&photo:serde_json::to_value(&saved).unwrap()}});
        let archive = crate::xdesign_archive::build_archive(
            &root.join(source),
            "Interrupted image project".into(),
            document,
        )
        .unwrap();
        let receipt = Receipt {
            project_id: ulid::Ulid::new().to_string(),
            operation_id: ulid::Ulid::new().to_string(),
        };
        let lease = imports::begin(&mut db, &root, &receipt).unwrap();
        let imported = crate::xdesign_archive::unpack_archive_managed(
            &archive,
            &root.join(&receipt.project_id),
            Some((&lease, &mut db)),
        )
        .unwrap();
        imports::finish(&mut db, &lease).unwrap();
        drop(lease);
        let fixture = Self {
            root,
            db,
            receipt,
            document: imported.document,
            photo,
            version: saved.version,
        };
        let old = SystemTime::now() - Duration::from_secs(8 * 24 * 60 * 60);
        for entry in std::fs::read_dir(fixture.photo_dir()).unwrap() {
            let entry = entry.unwrap();
            std::fs::File::open(entry.path())
                .unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(old))
                .unwrap();
        }
        fixture
    }
    fn photo_dir(&self) -> PathBuf {
        self.root.join(&self.receipt.project_id).join(&self.photo)
    }
    fn bundle(&self) -> PathBuf {
        self.photo_dir().join(format!("{}.pcraft", self.version))
    }
    fn other_bundle(&self) -> PathBuf {
        let directory = self
            .root
            .join(ulid::Ulid::new().to_string())
            .join(ulid::Ulid::new().to_string());
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join(format!("{}.pcraft", ulid::Ulid::new()));
        std::fs::copy(self.bundle(), &file).unwrap();
        std::fs::File::open(&file)
            .unwrap()
            .set_times(
                std::fs::FileTimes::new()
                    .set_modified(SystemTime::now() - Duration::from_secs(8 * 24 * 60 * 60)),
            )
            .unwrap();
        file
    }
    fn status(&mut self) -> Value {
        imports::control(&mut self.db, &self.root, &self.receipt, false).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn old_unregistered_image_copy_survives_collection_while_other_unused_versions_are_removed() {
    let mut f = Fixture::new();
    let before = std::fs::read(f.bundle()).unwrap();
    let other = f.other_bundle();
    let protection = imports::maintenance_protection(&f.db).unwrap();
    let report = scan_with_imports(
        &f.root,
        &HashSet::new(),
        &protection,
        true,
        SystemTime::now(),
    )
    .unwrap();
    assert!(report.reclaimed_files > 0);
    assert!(!other.exists());
    assert!(report.protected_versions >= 1);
    assert_eq!(std::fs::read(f.bundle()).unwrap(), before);
    assert_eq!(f.status()["imported"]["document"], f.document);
}

#[test]
fn pending_copy_bytes_survive_scheduled_compaction_and_normal_maintenance_resumes_after_registration(
) {
    let mut f = Fixture::new();
    let before = std::fs::read(f.bundle()).unwrap();
    let other = f.other_bundle();
    let protection = imports::maintenance_protection(&f.db).unwrap();
    maintenance::schedule(&f.root, true).unwrap();
    maintenance::recover_store(&f.root, &protection).unwrap();
    maintenance::perform_with_imports(&f.root, &HashSet::new(), &protection).unwrap();
    assert!(other.is_dir());
    assert!(f.bundle().is_file());
    assert_eq!(std::fs::read(f.bundle()).unwrap(), before);
    assert_eq!(f.status()["phase"], "staged");
    let id = &f.receipt.project_id;
    let writes = vec![
        crate::xdesign_state::StateWrite {
            key: format!("xdesign.project.{id}"),
            value: Some(f.document.to_string()),
        },
        crate::xdesign_state::StateWrite {
            key: "xdesign.projects".into(),
            value: Some(
                json!({"registry":[{"id":id,"name":"Recovered","createdAt":1,"updatedAt":1}]})
                    .to_string(),
            ),
        },
    ];
    let lease = imports::Lease::open(&f.root, &f.receipt, false).unwrap();
    crate::xdesign_state::commit_with_import(&mut f.db, &writes, Some(&lease)).unwrap();
    drop(lease);
    let protection = imports::maintenance_protection(&f.db).unwrap();
    maintenance::schedule(&f.root, true).unwrap();
    let refs = references(&f.db).unwrap();
    maintenance::perform_with_imports(&f.root, &refs, &protection).unwrap();
    assert!(f.bundle().is_dir());
    assert!(photocraft_format::load_path(&f.bundle()).is_ok());
    assert_eq!(f.status()["phase"], "committed");
}

#[test]
fn unknown_owned_copy_after_database_restore_or_new_promotion_is_retained_and_corrupt_receipts_cancel_maintenance(
) {
    let mut f = Fixture::new();
    let key = format!("xdesign.projectImport.{}", f.receipt.project_id);
    let saved: String =
        f.db.query_row("SELECT value FROM app_state WHERE key=?1", [&key], |row| {
            row.get(0)
        })
        .unwrap();
    f.db.execute("DELETE FROM app_state WHERE key=?1", [&key])
        .unwrap();
    let snapshot = imports::maintenance_protection(&f.db).unwrap();
    f.db.execute(
        "INSERT INTO app_state VALUES(?1,?2)",
        rusqlite::params![key, saved],
    )
    .unwrap();
    let before = std::fs::read(f.bundle()).unwrap();
    maintenance::schedule(&f.root, true).unwrap();
    maintenance::perform_with_imports(&f.root, &HashSet::new(), &snapshot).unwrap();
    scan_with_imports(&f.root, &HashSet::new(), &snapshot, true, SystemTime::now()).unwrap();
    assert_eq!(std::fs::read(f.bundle()).unwrap(), before);
    assert_eq!(f.status()["phase"], "staged");
    f.db.execute("UPDATE app_state SET value='{}' WHERE key=?1", [&key])
        .unwrap();
    assert!(imports::maintenance_protection(&f.db)
        .err()
        .unwrap()
        .contains("invalid"));
    assert_eq!(std::fs::read(f.bundle()).unwrap(), before);
}
