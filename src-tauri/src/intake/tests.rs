use super::*;
use std::fs;

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("orion-intake-test-{}", ulid::Ulid::new()));
        fs::create_dir(&path).unwrap();
        let path = fs::canonicalize(path).unwrap();
        fs::write(path.join("SKILL.md"), "---\nname: example\ndescription: Fixture only\nallowed-tools: Bash Read\n---\nUse DESIGN.md. Never a grant.\n").unwrap();
        fs::write(path.join("DESIGN.md"), "# Original design resource\n").unwrap();
        Self(path)
    }
    fn source(&self) -> Source {
        discover(safe_dir::root(&self.0).unwrap(), "different-folder".into()).unwrap()
    }
    fn package(&self) -> Package {
        inspect(&self.source(), "SKILL.md", &[]).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(include_str!(
        "../../migrations/0030_skill_intake_staging.sql"
    ))
    .unwrap();
    conn
}
#[test]
fn keeps_resource_bytes_adapter_and_requests_without_install() {
    let fixture = Fixture::new();
    let package = fixture.package();
    assert_eq!(
        package.contents["example/DESIGN.md"],
        b"# Original design resource\n"
    );
    assert!(package
        .summary
        .warnings
        .iter()
        .any(|w| w.contains("Packaging adapter")));
    assert_eq!(
        package.summary.metadata.allowed_tools.as_deref(),
        Some("Bash Read")
    );
    assert_ne!(package.summary.source_hash, package.summary.artifact_hash);
    let mut conn = db();
    stage(&mut conn, &package).unwrap();
    assert_eq!(list(&conn).unwrap().len(), 1);
    assert!(conn.prepare("SELECT * FROM skills").is_err());
}
#[test]
fn immutable_preview_and_idempotent_staging() {
    let fixture = Fixture::new();
    let package = fixture.package();
    fs::write(fixture.0.join("DESIGN.md"), "changed after review").unwrap();
    assert_ne!(
        fixture.package().summary.source_hash,
        package.summary.source_hash
    );
    let mut conn = db();
    stage(&mut conn, &package).unwrap();
    stage(&mut conn, &package).unwrap();
    assert_eq!(list(&conn).unwrap().len(), 1);
    assert_eq!(
        load(&conn, &package.summary.id).unwrap().contents,
        package.contents
    );
}
#[test]
fn failed_resource_write_rolls_back_whole_candidate() {
    let fixture = Fixture::new();
    let package = fixture.package();
    let mut conn = db();
    conn.execute_batch("CREATE TRIGGER fail_resource BEFORE INSERT ON skill_intake_files BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(stage(&mut conn, &package).is_err());
    assert!(list(&conn).unwrap().is_empty());
    conn.execute_batch("DROP TRIGGER fail_resource").unwrap();
    stage(&mut conn, &package).unwrap();
    assert_eq!(list(&conn).unwrap().len(), 1);
}
#[test]
fn stage_survives_database_reopen() {
    let fixture = Fixture::new();
    let package = fixture.package();
    let path = fixture.0.join("test.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!(
        "../../migrations/0030_skill_intake_staging.sql"
    ))
    .unwrap();
    stage(&mut conn, &package).unwrap();
    drop(conn);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        load(&conn, &package.summary.id).unwrap().contents,
        package.contents
    );
}
#[test]
fn corrupted_or_unknown_records_block_new_staging() {
    let fixture = Fixture::new();
    let package = fixture.package();
    let mut conn = db();
    stage(&mut conn, &package).unwrap();
    conn.execute("UPDATE skill_intake_candidates SET summary_json='{}'", [])
        .unwrap();
    assert!(list(&conn).is_err());
    assert!(stage(&mut conn, &fixture.package()).is_err());
    let json: String = conn
        .query_row(
            "SELECT summary_json FROM skill_intake_candidates",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(json, "{}");
}
#[test]
fn changed_blob_fails_integrity() {
    let fixture = Fixture::new();
    let package = fixture.package();
    let mut conn = db();
    stage(&mut conn, &package).unwrap();
    conn.execute(
        "UPDATE skill_intake_files SET contents=x'78' WHERE path='example/DESIGN.md'",
        [],
    )
    .unwrap();
    assert!(load(&conn, &package.summary.id).is_err());
}
#[test]
fn enforces_candidate_quota() {
    let fixture = Fixture::new();
    let mut conn = db();
    for _ in 0..4 {
        stage(&mut conn, &fixture.package()).unwrap();
    }
    assert!(stage(&mut conn, &fixture.package()).is_err());
    assert_eq!(list(&conn).unwrap().len(), 4);
}
#[test]
fn explicit_root_attribution_and_multi_skill_discovery() {
    let fixture = Fixture::new();
    fs::remove_file(fixture.0.join("SKILL.md")).unwrap();
    fs::create_dir_all(fixture.0.join("skills/taste-skill")).unwrap();
    fs::create_dir_all(fixture.0.join("skills/stitch-skill")).unwrap();
    for folder in ["taste-skill", "stitch-skill"] {
        fs::write(
            fixture.0.join(format!("skills/{folder}/SKILL.md")),
            "---\nname: example\ndescription: Fixture\n---\nText",
        )
        .unwrap();
    }
    fs::write(fixture.0.join("LICENSE"), "Test attribution only").unwrap();
    let source = fixture.source();
    assert_eq!(source.discovery.entries.len(), 2);
    let package = inspect(&source, "skills/stitch-skill/SKILL.md", &["LICENSE".into()]).unwrap();
    assert_eq!(
        package.contents["example/__orion_attribution/LICENSE"],
        b"Test attribution only"
    );
    assert!(inspect(&source, "skills/missing/SKILL.md", &[]).is_err());
    assert!(inspect(
        &source,
        "skills/stitch-skill/SKILL.md",
        &["../LICENSE".into()]
    )
    .is_err());
}
#[test]
fn rejects_traversal_collisions_depth_and_special_names() {
    for path in [
        "../secret",
        "/etc/passwd",
        "a//b",
        "a/./b",
        "C:\\secret",
        "a/é",
        "a/one.",
        "a/one ",
        "a\0b",
    ] {
        assert!(safe_dir::relative(path).is_err(), "{path}");
    }
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.0.join("a/b/c/d/e/f/g/h/i")).unwrap();
    assert!(inspect(&fixture.source(), "SKILL.md", &[]).is_err());
}
#[test]
fn rejects_secret_hints_without_echoing_values() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join("reference.txt"),
        format!("sk-{}", "x".repeat(40)),
    )
    .unwrap();
    let err = inspect(&fixture.source(), "SKILL.md", &[]).err().unwrap();
    assert!(err.contains("credentials"));
    assert!(!err.contains("sk-"));
}
#[test]
fn rejects_oversized_and_too_many_files() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("large.bin"), vec![0u8; 1024 * 1024 + 1]).unwrap();
    assert!(inspect(&fixture.source(), "SKILL.md", &[]).is_err());
    fs::remove_file(fixture.0.join("large.bin")).unwrap();
    for i in 0..128 {
        fs::write(fixture.0.join(format!("file-{i}")), "x").unwrap();
    }
    assert!(inspect(&fixture.source(), "SKILL.md", &[]).is_err());
}
#[cfg(unix)]
#[test]
fn rejects_symlinks_hardlinks_and_fifo_without_blocking() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let other = Fixture::new();
    symlink(other.0.join("DESIGN.md"), fixture.0.join("linked.md")).unwrap();
    assert!(inspect(&fixture.source(), "SKILL.md", &[]).is_err());
    fs::remove_file(fixture.0.join("linked.md")).unwrap();
    fs::hard_link(other.0.join("DESIGN.md"), fixture.0.join("linked.md")).unwrap();
    assert!(inspect(&fixture.source(), "SKILL.md", &[]).is_err());
    fs::remove_file(fixture.0.join("linked.md")).unwrap();
    symlink(&other.0, fixture.0.join("linked-dir")).unwrap();
    assert!(safe_dir::root(&fixture.0.join("linked-dir")).is_err());
    fs::remove_file(fixture.0.join("linked-dir")).unwrap();
    #[cfg(target_os = "macos")]
    type Mode = u16;
    #[cfg(not(target_os = "macos"))]
    type Mode = u32;
    extern "C" {
        fn mkfifo(path: *const std::os::raw::c_char, mode: Mode) -> i32;
    }
    let fifo =
        std::ffi::CString::new(fixture.0.join("fifo").as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { mkfifo(fifo.as_ptr(), 0o600) }, 0);
    assert!(inspect(&fixture.source(), "SKILL.md", &[]).is_err());
}
#[cfg(unix)]
#[test]
fn pinned_root_survives_root_path_substitution() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let other = Fixture::new();
    let source = fixture.source();
    let moved = fixture.0.with_extension("moved");
    fs::rename(&fixture.0, &moved).unwrap();
    symlink(&other.0, &fixture.0).unwrap();
    fs::write(other.0.join("DESIGN.md"), "outside root").unwrap();
    let result = inspect(&source, "SKILL.md", &[]);
    fs::remove_file(&fixture.0).unwrap();
    fs::rename(&moved, &fixture.0).unwrap();
    assert_eq!(
        result.unwrap().contents["example/DESIGN.md"],
        b"# Original design resource\n"
    );
}
#[cfg(unix)]
#[test]
fn intermediate_substitution_cannot_escape_discovered_root() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let other = Fixture::new();
    fs::remove_file(fixture.0.join("SKILL.md")).unwrap();
    fs::create_dir(fixture.0.join("example")).unwrap();
    fs::write(
        fixture.0.join("example/SKILL.md"),
        "---\nname: example\ndescription: Fixture\n---\nBody",
    )
    .unwrap();
    let source = fixture.source();
    fs::rename(fixture.0.join("example"), fixture.0.join("previous")).unwrap();
    symlink(&other.0, fixture.0.join("example")).unwrap();
    assert!(inspect(&source, "example/SKILL.md", &[]).is_err());
}
#[test]
fn manifest_has_a_stable_cross_language_test_vector() {
    let file = FileInfo {
        path: "example/SKILL.md".into(),
        source_path: "SKILL.md".into(),
        bytes: 3,
        sha256: hash(b"abc"),
        source_mode: 0o100644,
        kind: "text".into(),
    };
    assert_eq!(
        manifest_hash(&[file], true),
        "c621fcfc6864e716aae16d4d2149abfa83294fe38898ca3849baaad95eff0461"
    );
}
#[test]
fn rejects_forged_manifest_and_case_collisions() {
    let fixture = Fixture::new();
    let mut p = fixture.package();
    let mut file = p.summary.files[0].clone();
    let bytes = p.contents[&file.path].clone();
    file.path = file.path.to_ascii_lowercase();
    p.summary.total_bytes += bytes.len();
    p.contents.insert(file.path.clone(), bytes);
    p.summary.files.push(file);
    assert!(validate(&p).is_err());
    let mut p = fixture.package();
    p.summary.schema_version = 2;
    assert!(validate(&p).is_err());
    let mut json = serde_json::to_value(fixture.package().summary).unwrap();
    json["approved"] = true.into();
    assert!(serde_json::from_value::<Candidate>(json).is_err());
}
#[cfg(unix)]
#[test]
fn records_executable_source_modes_but_keeps_code_inactive() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let original = fixture.package();
    fs::set_permissions(
        fixture.0.join("DESIGN.md"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    let executable = fixture.package();
    assert_ne!(executable.summary.source_hash, original.summary.source_hash);
    assert_eq!(
        executable.summary.artifact_hash,
        original.summary.artifact_hash
    );
    assert!(executable
        .summary
        .files
        .iter()
        .any(|f| f.path.ends_with("DESIGN.md")
            && f.kind == "inactive-code"
            && f.source_mode == 0o100755));
}
#[test]
#[ignore = "explicit readonly upstream fixture path required"]
fn real_taste_and_stitch_roundtrip() {
    let path = std::env::var("ORION_INTAKE_TEST_FIXTURE").expect("fixture required");
    let root = fs::canonicalize(path).unwrap();
    let source = discover(safe_dir::root(&root).unwrap(), "taste-skill".into()).unwrap();
    let mut conn = db();
    for entry in [
        "skills/taste-skill/SKILL.md",
        "skills/stitch-skill/SKILL.md",
    ] {
        let p = inspect(&source, entry, &["LICENSE".into()]).unwrap();
        let (file, expected) = if entry.contains("stitch-skill") {
            (
                "stitch-design-taste/DESIGN.md",
                "0ab6740c4ebb1966dbceddb823a66d4bf027e960efbd73faca56cbf8370ae2ad",
            )
        } else {
            (
                "design-taste-frontend/SKILL.md",
                "aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89",
            )
        };
        assert_eq!(hash(&p.contents[file]), expected);
        stage(&mut conn, &p).unwrap();
        assert_eq!(load(&conn, &p.summary.id).unwrap().contents, p.contents);
    }
    assert_eq!(list(&conn).unwrap().len(), 2);
}
