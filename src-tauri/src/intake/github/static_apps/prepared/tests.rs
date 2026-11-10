use super::*;
pub(super) fn candidate() -> Candidate {
    serde_json::from_str(include_str!(
        "../../../../../../src/features/staticApps/__fixtures__/prepared2048.json"
    ))
    .unwrap()
}
pub(super) fn capture() -> StaticCapture {
    let packet = serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../../../../src/features/staticApps/__fixtures__/source2048.json"
    ))
    .unwrap()["sourcePacket"]
        .clone();
    StaticCapture {
        summary: serde_json::from_str(include_str!(
            "../../../../../../src/features/staticApps/__fixtures__/capture2048-summary.json"
        ))
        .unwrap(),
        packet: serde_json::from_value(packet).unwrap(),
    }
}
pub(super) fn database_fixture() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", true).unwrap();
    c.execute_batch(include_str!(
        "../../../../../migrations/0032_static_app_sources.sql"
    ))
    .unwrap();
    c.execute_batch(include_str!(
        "../../../../../migrations/0033_static_app_candidates.sql"
    ))
    .unwrap();
    c
}
fn rebind(mut c: Candidate, id: &str) -> Candidate {
    let plugin = format!("dev.orion.prepared2048.{}", id.to_ascii_lowercase());
    for f in c
        .files
        .iter_mut()
        .filter(|f| ["orion-plugin.json", "PROVENANCE.json"].contains(&f.path.as_str()))
    {
        let text = String::from_utf8(STANDARD.decode(&f.data_base64).unwrap())
            .unwrap()
            .replace(&c.plugin_id, &plugin)
            .replace(&c.candidate_id, id);
        f.bytes = text.len();
        f.sha256 = hash(text.as_bytes());
        f.data_base64 = STANDARD.encode(text);
    }
    c.candidate_id = id.into();
    c.plugin_id = plugin;
    // The manifest hash is part of provenance's pre-provenance inventory.
    let manifest = c
        .files
        .iter()
        .find(|f| f.path == "orion-plugin.json")
        .unwrap()
        .clone();
    let p = c
        .files
        .iter_mut()
        .find(|f| f.path == "PROVENANCE.json")
        .unwrap();
    let old_manifest = candidate()
        .files
        .into_iter()
        .find(|f| f.path == "orion-plugin.json")
        .unwrap();
    let text = String::from_utf8(STANDARD.decode(&p.data_base64).unwrap())
        .unwrap()
        .replace(&old_manifest.sha256, &manifest.sha256)
        .replace(
            &format!("\"bytes\": {}", old_manifest.bytes),
            &format!("\"bytes\": {}", manifest.bytes),
        );
    p.bytes = text.len();
    p.sha256 = hash(text.as_bytes());
    p.data_base64 = STANDARD.encode(text);
    c.total_bytes = c.files.iter().map(|f| f.bytes).sum();
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Identity<'a> {
        version: u8,
        recipe_id: &'a str,
        source_hash: &'a str,
        recipe_hash: &'a str,
        candidate_id: &'a str,
        plugin_id: &'a str,
        files: Vec<Inventory>,
    }
    c.output_hash = hash(
        &json_bytes(&Identity {
            version: 1,
            recipe_id: RECIPE_ID,
            source_hash: &c.source_hash,
            recipe_hash: &c.recipe_hash,
            candidate_id: &c.candidate_id,
            plugin_id: &c.plugin_id,
            files: c
                .files
                .iter()
                .map(|f| Inventory {
                    path: f.path.clone(),
                    bytes: f.bytes,
                    sha256: f.sha256.clone(),
                })
                .collect(),
        })
        .unwrap(),
    );
    c
}
#[test]
fn validates_all_generated_bytes_against_owned_contract_without_execution() {
    let (inspection, files) = validate(&candidate(), &capture()).unwrap();
    assert_eq!(files.len(), 35);
    assert_eq!(inspection.file_count, 35);
    assert_eq!(inspection.manifest.permissions, vec!["storage.plugin"]);
    assert_ne!(inspection.fingerprint, candidate().output_hash);
    assert_eq!(inspection.total_bytes as usize, candidate().total_bytes);
}
#[test]
fn recipe_hash_is_independently_bound_to_compiled_owned_code() {
    let c = candidate();
    assert_eq!(
        c.recipe_hash,
        recipe_hash(&recipe(RECIPE_ID).unwrap(), &owned_code(), &adapters()).unwrap()
    );
}
#[test]
fn rejects_changed_versions_source_recipe_identity_and_inventory() {
    for i in 0..10 {
        let mut c = candidate();
        match i {
            0 => c.version = 2,
            1 => c.recipe_hash = "f".repeat(64),
            2 => c.source_hash = "f".repeat(64),
            3 => c.output_hash = "f".repeat(64),
            4 => c.plugin_id = "dev.fake.app".into(),
            5 => {
                c.files.pop();
            }
            6 => c.files.swap(0, 1),
            7 => c.files[0].path = "../ui.html".into(),
            8 => c.total_bytes += 1,
            _ => c.files[0].data_base64.push('A'),
        };
        assert!(validate(&c, &capture()).is_err(), "mutation {i}");
    }
}
#[test]
fn rehashed_replacement_code_manifest_and_provenance_cannot_qualify() {
    for path in [
        "ui.html",
        "adapter/boot.js",
        "orion-plugin.json",
        "PROVENANCE.json",
    ] {
        let mut c = candidate();
        let f = c.files.iter_mut().find(|f| f.path == path).unwrap();
        let mut b = STANDARD.decode(&f.data_base64).unwrap();
        b[0] ^= 1;
        f.sha256 = hash(&b);
        f.data_base64 = STANDARD.encode(b);
        assert!(validate(&c, &capture()).is_err(), "{path}");
    }
}
#[test]
fn exact_saved_candidate_reloads_idempotently_and_retains_source() {
    let mut db = database_fixture();
    let s = capture();
    super::super::store::publish(&mut db, &s).unwrap();
    let saved = store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    assert_eq!(saved.id, ZERO_ID);
    store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    assert_eq!(store::list(&db).unwrap().len(), 1);
    let loaded = store::load(&db, ZERO_ID).unwrap();
    assert_eq!(
        serde_json::to_value(&loaded.candidate).unwrap(),
        serde_json::to_value(candidate()).unwrap()
    );
    assert!(super::super::store::discard(&mut db, &s.summary.id, &s.summary.capture_hash).is_err());
    assert!(db
        .execute("UPDATE static_app_candidates SET created_at=0", [])
        .is_err());
}
#[test]
fn stale_source_and_candidate_discard_do_not_change_saved_data() {
    let mut db = database_fixture();
    let s = capture();
    super::super::store::publish(&mut db, &s).unwrap();
    assert!(store::save(&mut db, &s.summary.id, &"f".repeat(64), candidate()).is_err());
    let saved = store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    assert!(store::discard(&mut db, &saved.id, &"f".repeat(64)).is_err());
    assert_eq!(store::list(&db).unwrap().len(), 1);
    store::discard(&mut db, &saved.id, &saved.output_hash).unwrap();
    assert!(store::list(&db).unwrap().is_empty());
    assert_eq!(super::super::store::list(&db).unwrap().len(), 1);
    super::super::store::discard(&mut db, &s.summary.id, &s.summary.capture_hash).unwrap();
}
#[test]
fn native_accepts_only_exact_dynamic_identity_and_enforces_no_eviction_capacity() {
    let mut db = database_fixture();
    let s = capture();
    super::super::store::publish(&mut db, &s).unwrap();
    for _ in 0..8 {
        let c = rebind(candidate(), &ulid::Ulid::new().to_string());
        validate(&c, &s).unwrap();
        store::save(&mut db, &s.summary.id, &s.summary.capture_hash, c).unwrap();
    }
    assert!(store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).is_err());
    assert_eq!(store::list(&db).unwrap().len(), 8);
}
#[cfg(unix)]
#[test]
fn prepared_bytes_and_source_survive_connection_close_in_private_owned_scratch() {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let root = std::env::temp_dir().join(format!("orion-prepared-reopen-{}", ulid::Ulid::new()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .unwrap();
    let path = root.join("prepared.db");
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .unwrap();
    let s = capture();
    {
        let mut db = Connection::open(&path).unwrap();
        db.pragma_update(None, "foreign_keys", true).unwrap();
        db.execute_batch(include_str!(
            "../../../../../migrations/0032_static_app_sources.sql"
        ))
        .unwrap();
        db.execute_batch(include_str!(
            "../../../../../migrations/0033_static_app_candidates.sql"
        ))
        .unwrap();
        super::super::store::publish(&mut db, &s).unwrap();
        store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    }
    {
        let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        assert_eq!(
            serde_json::to_value(store::load(&db, ZERO_ID).unwrap().candidate).unwrap(),
            serde_json::to_value(candidate()).unwrap()
        );
        assert_eq!(store::list(&db).unwrap().len(), 1);
    }
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn oversized_saved_payload_is_not_materialized_and_blocks_writes() {
    let mut db = database_fixture();
    let s = capture();
    super::super::store::publish(&mut db, &s).unwrap();
    store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
    db.execute_batch(
        "DROP TRIGGER static_app_candidates_immutable; PRAGMA ignore_check_constraints=ON",
    )
    .unwrap();
    db.execute(
        "UPDATE static_app_candidates SET candidate_json=?1",
        [" ".repeat(ENCODED_LIMIT + 1)],
    )
    .unwrap();
    assert!(store::list(&db).is_err());
    assert!(store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).is_err());
    assert_eq!(
        db.query_row(
            "SELECT length(candidate_json) FROM static_app_candidates",
            [],
            |r| r.get::<_, usize>(0)
        )
        .unwrap(),
        ENCODED_LIMIT + 1
    );
}
#[test]
fn corrupt_or_future_saved_records_block_mutation_without_overwrite() {
    for future in [false, true] {
        let mut db = database_fixture();
        let s = capture();
        super::super::store::publish(&mut db, &s).unwrap();
        store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).unwrap();
        db.execute_batch("DROP TRIGGER static_app_candidates_immutable")
            .unwrap();
        let payload = if future {
            let mut r = store::load(&db, ZERO_ID).unwrap();
            r.schema_version = 2;
            serde_json::to_string(&r).unwrap()
        } else {
            "{}".into()
        };
        db.execute(
            "UPDATE static_app_candidates SET candidate_json=?1",
            [&payload],
        )
        .unwrap();
        assert!(store::list(&db).is_err());
        assert!(store::save(&mut db, &s.summary.id, &s.summary.capture_hash, candidate()).is_err());
        assert_eq!(
            db.query_row(
                "SELECT candidate_json FROM static_app_candidates",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            payload
        );
    }
}
