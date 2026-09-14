use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("orion-backup-test-{}", ulid::Ulid::new()));
        private_dir(&path).unwrap();
        Self(path)
    }
    fn source(&self) -> PathBuf {
        self.0.join("orion.db")
    }
    fn seed(&self, count: usize) -> Connection {
        let conn = Connection::open(self.source()).unwrap();
        conn.execute_batch("CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY,success BOOLEAN NOT NULL,checksum BLOB NOT NULL)").unwrap();
        for migration in crate::database_migrations().into_iter().take(count) {
            conn.execute_batch(migration.sql).unwrap();
            conn.execute(
                "INSERT INTO _sqlx_migrations VALUES(?1,1,?2)",
                rusqlite::params![
                    migration.version,
                    Sha384::digest(migration.sql.as_bytes()).to_vec()
                ],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO notes(id,title,blocks_json,created_at,updated_at) VALUES('fixture','Recovery proof','[]',1,1)", []).unwrap();
        conn.execute(
            "INSERT INTO app_state VALUES('xdesign.projects','{\"registry\":[]}')",
            [],
        )
        .unwrap();
        conn
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn deadline() -> Instant {
    Instant::now() + BUDGET
}
fn published(dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| managed_name(p.file_name().unwrap().to_str().unwrap()))
        .collect();
    paths.sort();
    paths
}
fn assert_no_pending(dir: &Path) {
    assert!(!fs::read_dir(dir).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".pending-")));
}

#[test]
fn strict_names_accept_legacy_and_unique_but_not_unrelated_files() {
    for valid in [
        "orion-20260601-120000.db".to_string(),
        format!("orion-20240229-235959-{}.db", ulid::Ulid::new()),
    ] {
        assert!(managed_name(&valid));
    }
    for invalid in [
        "orion-personal.db",
        "orion-20260229-120000.db",
        "orion-20261301-120000.db",
        "orion-20260101-246000.db",
        "orion-20260101-120000-copy.db",
        "orion-abcdefgh-abcdef.db",
        "orion-20260601-120000.db-wal",
        "orion-😈😈😈😈.db",
    ] {
        assert!(!managed_name(invalid), "{invalid}");
    }
    assert_eq!(stamp_utc(0), "19700101-000000");
    assert_eq!(stamp_utc(1_770_000_000), "20260202-024000");
    assert_eq!(stamp_utc(1_709_164_800), "20240229-000000");
}

#[test]
fn full_schema_wal_snapshot_roundtrips_committed_data_without_checkpointing_source() {
    let fixture = Fixture::new();
    let conn = fixture.seed(crate::database_migrations().len());
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE notes SET title='Committed WAL proof'; BEGIN; UPDATE notes SET title='Uncommitted';").unwrap();
    let before = fs::read(fixture.source()).unwrap();
    let wal_path = fixture.0.join("orion.db-wal");
    let wal = fs::read(&wal_path).unwrap();
    let target = fixture.0.join("snapshot.db");
    snapshot(&fixture.source(), &target, deadline()).unwrap();
    let restored = Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        restored
            .query_row("SELECT title FROM notes", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Committed WAL proof"
    );
    assert_eq!(
        restored
            .query_row(
                "SELECT value FROM app_state WHERE key='xdesign.projects'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "{\"registry\":[]}"
    );
    assert_eq!(
        restored
            .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "delete"
    );
    assert_eq!(fs::read(fixture.source()).unwrap(), before);
    assert_eq!(fs::read(wal_path).unwrap(), wal);
    assert!(!fixture.0.join("snapshot.db-wal").exists());
    assert_no_pending(&fixture.0);
    conn.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn same_second_backups_are_distinct_and_retention_keeps_five() {
    let fixture = Fixture::new();
    let conn = fixture.seed(1);
    drop(conn);
    for _ in 0..7 {
        assert!(backup_and_rotate(&fixture.0, deadline()).unwrap().is_none());
    }
    let backups = fixture.0.join("backups");
    assert_eq!(published(&backups).len(), KEEP);
    assert_no_pending(&backups);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&backups).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for p in published(&backups) {
            assert_eq!(fs::metadata(p).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
}

#[test]
fn existing_targets_and_failed_snapshots_never_replace_or_rotate_old_backups() {
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    backup_and_rotate(&fixture.0, deadline()).unwrap();
    let backups = fixture.0.join("backups");
    let old = published(&backups);
    let bytes = fs::read(&old[0]).unwrap();
    assert!(snapshot(&fixture.source(), &old[0], deadline()).is_err());
    assert_eq!(fs::read(&old[0]).unwrap(), bytes);
    for day in 1..=7 {
        snapshot(
            &fixture.source(),
            &backups.join(format!("orion-202601{day:02}-000000.db")),
            deadline(),
        )
        .unwrap();
    }
    let before = published(&backups);
    fs::write(fixture.source(), b"not a sqlite database").unwrap();
    assert!(backup_and_rotate(&fixture.0, deadline()).is_err());
    assert_eq!(published(&backups), before);
    assert_eq!(fs::read(&old[0]).unwrap(), bytes);
    assert_no_pending(&backups);
}

#[test]
fn integrity_corruption_is_refused_and_never_published() {
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    let conn = Connection::open(fixture.source()).unwrap();
    let root: usize = conn
        .query_row(
            "SELECT rootpage FROM sqlite_schema WHERE name='notes'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let size: usize = conn
        .query_row("PRAGMA page_size", [], |r| r.get(0))
        .unwrap();
    drop(conn);
    let mut bytes = fs::read(fixture.source()).unwrap();
    bytes[(root - 1) * size] = 0xff;
    fs::write(fixture.source(), bytes).unwrap();
    let target = fixture.0.join("bad.db");
    assert!(snapshot(&fixture.source(), &target, deadline()).is_err());
    assert!(!target.exists());
    assert_no_pending(&fixture.0);
}

#[test]
fn migration_history_and_basic_application_schema_are_required() {
    for mutation in [
        "UPDATE _sqlx_migrations SET checksum=x'00'",
        "UPDATE _sqlx_migrations SET success=0",
        "UPDATE _sqlx_migrations SET version=99",
        "DELETE FROM _sqlx_migrations",
        "DROP TABLE notes",
        "ALTER TABLE app_state RENAME COLUMN value TO wrong",
        "DROP TABLE _sqlx_migrations",
    ] {
        let fixture = Fixture::new();
        let conn = fixture.seed(1);
        conn.execute_batch(mutation).unwrap();
        drop(conn);
        assert!(
            snapshot(&fixture.source(), &fixture.0.join("bad.db"), deadline()).is_err(),
            "{mutation}"
        );
        assert!(!fixture.0.join("bad.db").exists());
    }
    let fixture = Fixture::new();
    let conn = fixture.seed(crate::database_migrations().len());
    conn.execute("INSERT INTO _sqlx_migrations VALUES(999,1,x'00')", [])
        .unwrap();
    drop(conn);
    assert!(
        snapshot(&fixture.source(), &fixture.0.join("future.db"), deadline())
            .unwrap_err()
            .contains("newer")
    );
}

#[test]
fn retention_preserves_invalid_unrelated_directories_and_active_sidecars() {
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    let backups = fixture.0.join("backups");
    private_dir(&backups).unwrap();
    let unrelated = backups.join("orion-important.db");
    fs::write(&unrelated, b"preserve").unwrap();
    let bad = backups.join("orion-19700101-000000.db");
    fs::write(&bad, b"invalid").unwrap();
    let directory = backups.join("orion-19700102-000000.db");
    private_dir(&directory).unwrap();
    let active = backups.join("orion-19700103-000000.db");
    snapshot(&fixture.source(), &active, deadline()).unwrap();
    fs::write(backups.join("orion-19700103-000000.db-wal"), b"preserve").unwrap();
    for day in 1..=7 {
        snapshot(
            &fixture.source(),
            &backups.join(format!("orion-202606{day:02}-000000.db")),
            deadline(),
        )
        .unwrap();
    }
    let current = backups.join("orion-20260607-000000.db");
    prune(&backups, &current, deadline()).unwrap();
    assert_eq!(fs::read(unrelated).unwrap(), b"preserve");
    assert_eq!(fs::read(bad).unwrap(), b"invalid");
    assert!(directory.is_dir());
    assert!(active.exists());
    assert!(!backups.join("orion-20260601-000000.db").exists());
    assert!(!backups.join("orion-20260602-000000.db").exists());
    assert!(current.exists());
}

#[test]
fn retention_preserves_current_snapshot_even_after_clock_rollback() {
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    let backups = fixture.0.join("backups");
    private_dir(&backups).unwrap();
    for day in 1..=6 {
        snapshot(
            &fixture.source(),
            &backups.join(format!("orion-202606{day:02}-000000.db")),
            deadline(),
        )
        .unwrap();
    }
    let current = backups.join("orion-19700101-000000.db");
    snapshot(&fixture.source(), &current, deadline()).unwrap();
    prune(&backups, &current, deadline()).unwrap();
    assert!(current.exists());
    assert_eq!(published(&backups).len(), KEEP);
    assert!(!backups.join("orion-20260601-000000.db").exists());
    assert!(backups.join("orion-20260606-000000.db").exists());
}

#[test]
fn candidate_limit_fails_before_any_retention_deletion() {
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    let backups = fixture.0.join("backups");
    private_dir(&backups).unwrap();
    for day in 1..=6 {
        snapshot(
            &fixture.source(),
            &backups.join(format!("orion-202606{day:02}-000000.db")),
            deadline(),
        )
        .unwrap();
    }
    for _ in 0..MAX_CANDIDATES {
        fs::write(
            backups.join(format!("orion-20260601-000000-{}.db", ulid::Ulid::new())),
            b"invalid",
        )
        .unwrap();
    }
    let before = published(&backups);
    assert!(prune(
        &backups,
        &backups.join("orion-20260606-000000.db"),
        deadline()
    )
    .unwrap_err()
    .contains("manual review"));
    assert_eq!(published(&backups), before);
}

#[test]
fn deadline_and_locked_source_leave_no_partial_publication() {
    let fixture = Fixture::new();
    let conn = fixture.seed(1);
    conn.execute_batch("BEGIN EXCLUSIVE; UPDATE notes SET title='locked'")
        .unwrap();
    let start = Instant::now();
    assert!(snapshot(
        &fixture.source(),
        &fixture.0.join("locked.db"),
        start + Duration::from_millis(150)
    )
    .is_err());
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(!fixture.0.join("locked.db").exists());
    assert_no_pending(&fixture.0);
    conn.execute_batch("ROLLBACK").unwrap();
    assert!(snapshot(
        &fixture.source(),
        &fixture.0.join("expired.db"),
        Instant::now()
    )
    .is_err());
}

#[test]
fn coordination_lock_refuses_second_owner_and_releases_on_drop() {
    let fixture = Fixture::new();
    let first = rotation_lock(&fixture.0).unwrap();
    assert!(rotation_lock(&fixture.0).is_err());
    drop(first);
    assert!(rotation_lock(&fixture.0).is_ok());
}

#[test]
fn restore_to_new_directory_roundtrips_and_refuses_existing_destination() {
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    let source = fs::read(fixture.source()).unwrap();
    let destination = fixture.0.join("recovered");
    restore_copy(&fixture.source(), &destination).unwrap();
    let db = Connection::open(destination.join("orion.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT title FROM notes", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Recovery proof"
    );
    drop(db);
    let recovered = fs::read(destination.join("orion.db")).unwrap();
    assert!(restore_copy(&fixture.source(), &destination).is_err());
    assert_eq!(fs::read(destination.join("orion.db")).unwrap(), recovered);
    assert_eq!(fs::read(fixture.source()).unwrap(), source);
    fs::write(fixture.source(), b"corrupt").unwrap();
    let failed = fixture.0.join("refused");
    assert!(restore_copy(&fixture.source(), &failed).is_err());
    assert!(!failed.exists());
}

#[test]
fn first_launch_does_not_create_an_empty_database() {
    let fixture = Fixture::new();
    assert!(backup_and_rotate(&fixture.0, deadline()).unwrap().is_none());
    assert!(!fixture.source().exists());
    assert!(!fixture.0.join("backups").exists());
}

#[cfg(unix)]
#[test]
fn symlink_sources_destinations_and_retention_entries_are_refused_or_preserved() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    drop(fixture.seed(1));
    let link = fixture.0.join("link.db");
    symlink(fixture.source(), &link).unwrap();
    assert!(restore_copy(&link, &fixture.0.join("refused")).is_err());
    let target = fixture.0.join("target.db");
    symlink(fixture.source(), &target).unwrap();
    assert!(snapshot(&fixture.source(), &target, deadline()).is_err());
    let outside = fixture.0.join("outside");
    private_dir(&outside).unwrap();
    symlink(&outside, fixture.0.join("backups")).unwrap();
    assert!(backup_and_rotate(&fixture.0, deadline()).is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    fs::remove_file(fixture.0.join("backups")).unwrap();
    private_dir(&fixture.0.join("backups")).unwrap();
    let kept = fixture.0.join("backups/orion-19700101-000000.db");
    symlink(fixture.source(), &kept).unwrap();
    backup_and_rotate(&fixture.0, deadline()).unwrap();
    assert!(kept.is_symlink());
}
