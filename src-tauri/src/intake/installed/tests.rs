use super::*;
use std::fs;
struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("orion-installed-skill-{}", ulid::Ulid::new()));
        fs::create_dir(&path).unwrap();
        let f = Self(fs::canonicalize(path).unwrap());
        f.body("Use DESIGN.md; allowed-tools is not authorization.");
        fs::write(f.0.join("DESIGN.md"), "# Preserved design\n").unwrap();
        fs::write(f.0.join("LICENSE"), "Test fixture attribution only\n").unwrap();
        fs::write(f.0.join("run.sh"), "#!/bin/sh\nexit 99\n").unwrap();
        f
    }
    fn body(&self, body: &str) {
        fs::write(
            self.0.join("SKILL.md"),
            format!("---\nname: example\ndescription: Test\nallowed-tools: Bash Read\n---\n{body}"),
        )
        .unwrap();
    }
    fn package(&self) -> Package {
        inspect(
            &discover(safe_dir::root(&self.0).unwrap(), "fixture".into()).unwrap(),
            "SKILL.md",
            &[],
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn schema(conn: &Connection) {
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    conn.execute_batch(include_str!("../../../migrations/0026_control_panel.sql"))
        .unwrap();
    conn.execute_batch(include_str!(
        "../../../migrations/0030_skill_intake_staging.sql"
    ))
    .unwrap();
    conn.execute_batch(include_str!(
        "../../../migrations/0031_installed_skill_packages.sql"
    ))
    .unwrap();
}
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    schema(&c);
    c
}
fn install(c: &mut Connection, p: &Package) -> InstalledSkill {
    stage(c, p).unwrap();
    promote(c, &p.summary.id, &p.summary.artifact_hash, None, true).unwrap()
}
fn select(s: &InstalledSkill, paths: &[&str]) -> ContextSelection {
    ContextSelection {
        skill_id: s.skill_id.clone(),
        version_id: s.active.id.clone(),
        paths: paths.iter().map(|s| s.to_string()).collect(),
    }
}
fn count(c: &Connection, table: &str) -> usize {
    c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
#[tokio::test]
#[ignore = "Explicit public pinned Taste/Stitch acquisition and instruction-only scratch lifecycle; no UI or provider"]
async fn actual_pinned_skill_lifecycle_without_screen() {
    let root = super::super::github::static_apps::acceptance::proof_root();
    let receipt_path = root.join("live-skills-receipt.json");
    assert!(!receipt_path.exists());
    let packages = super::super::github::live_pinned_taste_packages()
        .await
        .unwrap();
    let db_path = root.join("backend-skills.db");
    super::super::github::static_apps::acceptance::new_file(&db_path, &[]);
    let mut db = Connection::open(&db_path).unwrap();
    schema(&db);
    let mut installed = Vec::new();
    let mut selections = Vec::new();
    for package in &packages {
        let s = install(&mut db, package);
        let resources = s
            .active
            .files
            .iter()
            .filter(|f| f.path.ends_with("/DESIGN.md"))
            .map(|f| f.path.clone())
            .collect::<Vec<_>>();
        selections.push(ContextSelection {
            skill_id: s.skill_id.clone(),
            version_id: s.active.id.clone(),
            paths: resources,
        });
        installed.push(s);
    }
    let parts = context(&mut db, &selections).unwrap();
    assert_eq!(parts.len(), 3);
    for part in &parts {
        let package = packages
            .iter()
            .find(|p| p.summary.id == part.version_id)
            .unwrap();
        assert_eq!(package.contents[&part.path], part.text.as_bytes());
        assert_eq!(hash(part.text.as_bytes()), part.sha256);
    }
    drop(db);
    let mut db = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    assert_eq!(list_installed(&db).unwrap().len(), 2);
    assert_eq!(context(&mut db, &selections).unwrap().len(), 3);
    let first = &installed[0];
    change(&mut db, &first.skill_id, &first.active.id, "disable", None).unwrap();
    assert!(context(&mut db, &selections).is_err());
    change(&mut db, &first.skill_id, &first.active.id, "enable", None).unwrap();
    assert_eq!(context(&mut db, &selections).unwrap().len(), 3);
    let receipt = serde_json::json!({"schemaVersion":1,"packages":installed,"parts":parts,"authority":"Actual byte-preserving native scratch install/reopen/resource-context/disable-refusal/re-enable. Native test acknowledgement only; no app-profile/Forge/UI/real provider send or source script evaluation."});
    super::super::github::static_apps::acceptance::new_file(
        &receipt_path,
        &serde_json::to_vec_pretty(&receipt).unwrap(),
    );
    for s in &installed {
        change(&mut db, &s.skill_id, &s.active.id, "remove", None).unwrap();
    }
    assert!(list_installed(&db).unwrap().is_empty());
    assert!(context(&mut db, &selections).is_err());
    println!("Actual Taste + Stitch preserved {} text bytes, staged/installed/reopened/context-selected/disabled/re-enabled/removed only in scratch",parts.iter().map(|p|p.text.len()).sum::<usize>());
}

#[test]
fn explicit_atomic_idempotent_install_never_overwrites_or_grants() {
    let f = Fixture::new();
    let p = f.package();
    let mut c = db();
    c.execute("INSERT INTO skills(id,name,instructions,tools_json,builtin,created_at,updated_at) VALUES ('builtin','example','mine','[1]',1,1,1)", []).unwrap();
    stage(&mut c, &p).unwrap();
    assert!(promote(&mut c, &p.summary.id, &p.summary.artifact_hash, None, false).is_err());
    assert!(promote(&mut c, &p.summary.id, &"0".repeat(64), None, true).is_err());
    assert_eq!(count(&c, "skills"), 1);
    let s = promote(&mut c, &p.summary.id, &p.summary.artifact_hash, None, true).unwrap();
    assert!(s.skill_id.starts_with("imported:"));
    assert_eq!(s.active.artifact_hash, p.summary.artifact_hash);
    assert_eq!(
        promote(&mut c, &p.summary.id, &p.summary.artifact_hash, None, true)
            .unwrap()
            .skill_id,
        s.skill_id
    );
    assert_eq!(count(&c, "skills"), 2);
    assert_eq!(count(&c, "skill_intake_candidates"), 0);
    assert_eq!(count(&c, "skill_intake_files"), 0);
    assert!(stage(&mut c, &p).is_err());
    assert_eq!(
        c.query_row(
            "SELECT instructions || tools_json FROM skills WHERE id=?1",
            [&s.skill_id],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "[]"
    );
    assert_eq!(
        c.query_row(
            "SELECT instructions FROM skills WHERE id='builtin'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "mine"
    );
    let parts = context(&mut c, &[select(&s, &["example/DESIGN.md"])]).unwrap();
    assert_eq!(parts[1].text.as_bytes(), p.contents["example/DESIGN.md"]);
    assert_eq!(parts[1].sha256, hash(parts[1].text.as_bytes()));
}
#[test]
fn resource_publish_failure_rolls_back_everything() {
    let f = Fixture::new();
    let p = f.package();
    let mut c = db();
    stage(&mut c, &p).unwrap();
    c.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON skill_package_files BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(promote(&mut c, &p.summary.id, &p.summary.artifact_hash, None, true).is_err());
    for t in [
        "skills",
        "skill_package_versions",
        "skill_package_files",
        "skill_package_links",
        "skill_package_receipts",
    ] {
        assert_eq!(count(&c, t), 0);
    }
    assert_eq!(
        load(&c, &p.summary.id).unwrap().summary.artifact_hash,
        p.summary.artifact_hash
    );
    c.execute_batch("DROP TRIGGER fail").unwrap();
    install(&mut c, &p);
}
#[test]
fn update_rollback_disable_remove_keep_identity_and_missing_agent_attachment() {
    let f = Fixture::new();
    let mut c = db();
    let a = install(&mut c, &f.package());
    let ids = serde_json::to_string(&vec![&a.skill_id]).unwrap();
    c.execute("INSERT INTO agents(id,name,brain_model,skill_ids_json,created_at,updated_at) VALUES ('agent','Agent','model',?1,1,1)", [&ids]).unwrap();
    f.body("New instructions");
    let p = f.package();
    stage(&mut c, &p).unwrap();
    assert!(promote(
        &mut c,
        &p.summary.id,
        &p.summary.artifact_hash,
        Some((&a.skill_id, &p.summary.id)),
        true
    )
    .is_err());
    let b = promote(
        &mut c,
        &p.summary.id,
        &p.summary.artifact_hash,
        Some((&a.skill_id, &a.active.id)),
        true,
    )
    .unwrap();
    assert_eq!(b.skill_id, a.skill_id);
    assert_eq!(b.versions.len(), 2);
    assert!(context(&mut c, &[select(&a, &[])]).is_err());
    change(
        &mut c,
        &b.skill_id,
        &b.active.id,
        "rollback",
        Some(&a.active.id),
    )
    .unwrap();
    assert_eq!(owned(&c, &a.skill_id, None).unwrap().active.id, a.active.id);
    change(&mut c, &a.skill_id, &a.active.id, "disable", None).unwrap();
    assert!(context(&mut c, &[select(&a, &[])]).is_err());
    change(&mut c, &a.skill_id, &a.active.id, "enable", None).unwrap();
    assert!(context(&mut c, &[select(&a, &[])]).is_ok());
    change(&mut c, &a.skill_id, &a.active.id, "remove", None).unwrap();
    for t in [
        "skills",
        "skill_package_versions",
        "skill_package_files",
        "skill_package_links",
    ] {
        assert_eq!(count(&c, t), 0);
    }
    assert!(promote(&mut c, &p.summary.id, &p.summary.artifact_hash, None, true).is_err());
    assert_eq!(
        c.query_row("SELECT skill_ids_json FROM agents", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        ids
    );
}
#[test]
fn rejects_scripts_traversal_duplicate_missing_and_cross_owner_resources() {
    let f = Fixture::new();
    let mut c = db();
    let a = install(&mut c, &f.package());
    let b = install(&mut c, &f.package());
    for paths in [
        vec!["example/run.sh"],
        vec!["../SKILL.md"],
        vec!["example/missing.md"],
        vec!["example/SKILL.md"],
        vec!["example/DESIGN.md", "example/DESIGN.md"],
    ] {
        assert!(context(&mut c, &[select(&a, &paths)]).is_err());
    }
    let mut wrong = select(&a, &[]);
    wrong.version_id = b.active.id;
    assert!(context(&mut c, &[wrong]).is_err());
    assert!(context(&mut c, &[select(&a, &[]), select(&a, &[])]).is_err());
}
#[test]
fn large_instructions_are_complete_and_tampering_fails_closed() {
    let f = Fixture::new();
    f.body(&format!("{}END", "x".repeat(87_253)));
    let p = f.package();
    let mut c = db();
    let a = install(&mut c, &p);
    let parts = context(&mut c, &[select(&a, &["example/DESIGN.md"])]).unwrap();
    assert_eq!(parts[0].text.as_bytes(), p.contents["example/SKILL.md"]);
    assert!(parts[0].text.ends_with("END"));
    c.execute(
        "UPDATE skill_package_files SET contents=x'00' WHERE path='example/DESIGN.md'",
        [],
    )
    .unwrap();
    assert!(list_installed(&c).is_err());
    assert!(context(&mut c, &[select(&a, &[])]).is_err());
}
#[test]
fn only_current_and_previous_versions_survive_updates() {
    let f = Fixture::new();
    let mut c = db();
    let mut a = install(&mut c, &f.package());
    for n in 0..3 {
        f.body(&format!("Update {n}"));
        let p = f.package();
        stage(&mut c, &p).unwrap();
        a = promote(
            &mut c,
            &p.summary.id,
            &p.summary.artifact_hash,
            Some((&a.skill_id, &a.active.id)),
            true,
        )
        .unwrap();
    }
    assert_eq!(a.versions.len(), 2);
    assert_eq!(count(&c, "skill_package_versions"), 2);
    assert_eq!(count(&c, "skill_package_files"), 8);
}
#[test]
fn sqlite_reopen_retains_resources_provenance_enabled_state_and_rollback() {
    let f = Fixture::new();
    let path = f.0.join("installed.sqlite");
    let p = f.package();
    let mut c = Connection::open(&path).unwrap();
    schema(&c);
    let a = install(&mut c, &p);
    change(&mut c, &a.skill_id, &a.active.id, "disable", None).unwrap();
    drop(c);
    let c = Connection::open(&path).unwrap();
    let saved = list_installed(&c).unwrap().remove(0);
    assert!(!saved.enabled);
    assert_eq!(saved.active.artifact_hash, p.summary.artifact_hash);
    assert_eq!(
        load_package(&c, &saved.active.id, true).unwrap().contents["example/DESIGN.md"],
        p.contents["example/DESIGN.md"]
    );
}
#[test]
fn missing_attribution_blocks_installation() {
    let f = Fixture::new();
    fs::remove_file(f.0.join("LICENSE")).unwrap();
    let p = f.package();
    let mut c = db();
    stage(&mut c, &p).unwrap();
    assert!(
        promote(&mut c, &p.summary.id, &p.summary.artifact_hash, None, true)
            .unwrap_err()
            .contains("LICENSE")
    );
    assert_eq!(count(&c, "skills"), 0);
}
#[test]
fn failed_update_and_removal_preserve_previous_authority() {
    let f = Fixture::new();
    let mut c = db();
    let a = install(&mut c, &f.package());
    f.body("Updated");
    let p = f.package();
    stage(&mut c, &p).unwrap();
    c.execute_batch("CREATE TRIGGER fail_update BEFORE UPDATE ON skill_package_links BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(promote(
        &mut c,
        &p.summary.id,
        &p.summary.artifact_hash,
        Some((&a.skill_id, &a.active.id)),
        true
    )
    .is_err());
    assert_eq!(owned(&c, &a.skill_id, None).unwrap().active.id, a.active.id);
    assert_eq!(count(&c, "skill_package_versions"), 1);
    assert!(load(&c, &p.summary.id).is_ok());
    c.execute_batch("DROP TRIGGER fail_update; CREATE TRIGGER fail_remove BEFORE DELETE ON skills BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(change(&mut c, &a.skill_id, &a.active.id, "remove", None).is_err());
    assert!(context(&mut c, &[select(&a, &[])]).is_ok());
    assert_eq!(
        c.query_row(
            "SELECT removed FROM skill_package_receipts WHERE candidate_id=?1",
            [&a.active.id],
            |r| r.get::<_, i32>(0)
        )
        .unwrap(),
        0
    );
}
#[test]
#[ignore = "explicit readonly pinned upstream fixture path required"]
fn real_taste_and_stitch_install_context_reopen() {
    let root =
        fs::canonicalize(std::env::var("ORION_INTAKE_TEST_FIXTURE").expect("fixture required"))
            .unwrap();
    let source = discover(safe_dir::root(&root).unwrap(), "taste-skill".into()).unwrap();
    let fixture = Fixture::new();
    let path = fixture.0.join("roundtrip.sqlite");
    let mut c = Connection::open(&path).unwrap();
    schema(&c);
    for entry in [
        "skills/taste-skill/SKILL.md",
        "skills/stitch-skill/SKILL.md",
    ] {
        let p = inspect(&source, entry, &["LICENSE".into()]).unwrap();
        install(&mut c, &p);
    }
    drop(c);
    let mut c = Connection::open(&path).unwrap();
    let items = list_installed(&c).unwrap();
    assert_eq!(items.len(), 2);
    for s in items {
        let paths = if s.active.metadata.name == "stitch-design-taste" {
            vec!["stitch-design-taste/DESIGN.md"]
        } else {
            vec![]
        };
        let parts = context(&mut c, &[select(&s, &paths)]).unwrap();
        if paths.is_empty() {
            assert_eq!(parts[0].text.len(), 87_253);
            assert_eq!(
                hash(parts[0].text.as_bytes()),
                "aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89"
            );
        } else {
            assert_eq!(
                hash(parts[1].text.as_bytes()),
                "0ab6740c4ebb1966dbceddb823a66d4bf027e960efbd73faca56cbf8370ae2ad"
            );
        }
        assert!(s.active.files.iter().any(|f| f.path.ends_with("/LICENSE")));
    }
}
