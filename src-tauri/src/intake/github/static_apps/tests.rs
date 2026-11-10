use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
const FIXTURE: &str =
    include_str!("../../../../../src/features/staticApps/__fixtures__/source2048.json");
const GOLDEN: &str = "dd5eff24339e8a5da8ec4a6ae15c0a21a4be1197e4986b26df83a7799948244c";
fn packet() -> SourcePacket {
    serde_json::from_value(
        serde_json::from_str::<serde_json::Value>(FIXTURE).unwrap()["sourcePacket"].clone(),
    )
    .unwrap()
}
fn conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(include_str!(
        "../../../../migrations/0032_static_app_sources.sql"
    ))
    .unwrap();
    c
}
fn origins() -> Vec<CaptureOrigin> {
    let r = recipe(RECIPE_ID).unwrap();
    let repositories: BTreeMap<_, _> = r
        .files
        .iter()
        .map(|f| (f.repository.clone(), f.commit.clone()))
        .collect();
    repositories
        .into_iter()
        .map(|(name, commit)| CaptureOrigin {
            url: format!("https://github.com/{name}"),
            requested_ref: commit.clone(),
            commit,
            tree: if name == "gabrielecirulli/2048" {
                PRIMARY_TREE.into()
            } else {
                "a".repeat(40)
            },
        })
        .collect()
}
fn capture() -> StaticCapture {
    let packet = packet();
    let (files, source_hash) = validate_packet(&packet).unwrap();
    let mut summary = CaptureSummary {
        schema_version: 1,
        id: ulid::Ulid::new().to_string(),
        recipe_id: RECIPE_ID.into(),
        source_hash,
        capture_hash: String::new(),
        total_bytes: files.iter().map(|f| f.bytes).sum(),
        file_count: files.len(),
        created_at: 1720000000000,
        origins: origins(),
    };
    summary.capture_hash = capture_hash(&summary, &packet).unwrap();
    StaticCapture { summary, packet }
}
fn fake_snapshot(name: &str, commit: &str) -> RepositorySnapshot {
    let r = recipe(RECIPE_ID).unwrap();
    let mut entries = BTreeMap::new();
    for spec in r.files.iter().filter(|f| f.repository == name) {
        let parts: Vec<_> = spec.path.split('/').collect();
        for i in 1..parts.len() {
            let path = parts[..i].join("/");
            entries.insert(
                path.clone(),
                TreeEntry {
                    path,
                    mode: "040000".into(),
                    kind: "tree".into(),
                    sha: "a".repeat(40),
                    size: None,
                },
            );
        }
        entries.insert(
            spec.path.clone(),
            TreeEntry {
                path: spec.path.clone(),
                mode: spec.source_mode.clone().unwrap_or("100644".into()),
                kind: "blob".into(),
                sha: spec.git_blob_sha.clone(),
                size: Some(spec.bytes),
            },
        );
    }
    let repository =
        Repository::parse(&format!("https://github.com/{name}/tree/{commit}")).unwrap();
    snapshot(
        repository,
        commit.into(),
        TreeResponse {
            sha: if name == "gabrielecirulli/2048" {
                PRIMARY_TREE.into()
            } else {
                "a".repeat(40)
            },
            truncated: false,
            tree: entries.into_values().collect(),
        },
    )
    .unwrap()
}
struct FakeTransport {
    discovers: AtomicUsize,
    downloads: AtomicUsize,
    fail_after: Option<usize>,
    mutate: bool,
}
impl FakeTransport {
    fn new() -> Self {
        Self {
            discovers: AtomicUsize::new(0),
            downloads: AtomicUsize::new(0),
            fail_after: None,
            mutate: false,
        }
    }
}
impl Transport for FakeTransport {
    fn discover<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<RepositorySnapshot, String>> {
        Box::pin(async move {
            self.discovers.fetch_add(1, Ordering::SeqCst);
            let repo = Repository::parse(url)?;
            Ok(fake_snapshot(
                &format!("{}/{}", repo.owner, repo.name),
                &repo.reference,
            ))
        })
    }
    fn download<'a>(
        &'a self,
        source: &'a RepositorySnapshot,
        entry: &'a TreeEntry,
    ) -> BoxFuture<'a, Result<Vec<u8>, String>> {
        Box::pin(async move {
            let i = self.downloads.fetch_add(1, Ordering::SeqCst);
            if self.fail_after == Some(i) {
                return Err("Simulated interrupted download".into());
            }
            let name = format!("{}/{}", source.repository.owner, source.repository.name);
            let f = packet()
                .files
                .into_iter()
                .find(|f| f.repository == name && f.path == entry.path)
                .unwrap();
            let mut bytes = STANDARD.decode(f.data_base64).unwrap();
            if self.mutate {
                bytes[0] ^= 1;
            }
            Ok(bytes)
        })
    }
}
#[test]
fn source_identity_matches_frontend_golden_and_is_order_independent() {
    let mut p = packet();
    assert_eq!(validate_packet(&p).unwrap().1, GOLDEN);
    p.files.reverse();
    assert_eq!(validate_packet(&p).unwrap().1, GOLDEN);
}
#[test]
fn pinned_source_bytes_modes_paths_versions_and_completeness_fail_closed() {
    let original = packet();
    for i in 0..9 {
        let mut p = original.clone();
        match i {
            0 => p.version = 2,
            1 => p.recipe_id = "unknown".into(),
            2 => {
                p.files.pop();
            }
            3 => p.files[0] = p.files[1].clone(),
            4 => p.files[0].path = "../readme.md".into(),
            5 => p.files[0].commit = "a".repeat(40),
            6 => p.files[0].source_mode = "120000".into(),
            7 => p.files[0].data_base64.push('A'),
            _ => {
                let mut b = STANDARD.decode(&p.files[0].data_base64).unwrap();
                b[0] ^= 1;
                p.files[0].data_base64 = STANDARD.encode(b);
            }
        };
        assert!(validate_packet(&p).is_err(), "mutation {i}");
    }
}
#[test]
fn original_mode_is_fixed_and_ancillary_ordinary_mode_changes_identity() {
    let mut p = packet();
    p.files[0].source_mode = "100755".into();
    assert_ne!(validate_packet(&p).unwrap().1, GOLDEN);
    let f = p
        .files
        .iter_mut()
        .find(|f| f.repository == "gabrielecirulli/2048")
        .unwrap();
    f.source_mode = if f.source_mode == "100644" {
        "100755"
    } else {
        "100644"
    }
    .into();
    assert!(validate_packet(&p).is_err());
}
#[test]
fn packet_deserialization_rejects_unknown_missing_and_duplicate_fields() {
    let mut v = serde_json::to_value(packet()).unwrap();
    v["unexpected"] = true.into();
    assert!(serde_json::from_value::<SourcePacket>(v).is_err());
    let mut v = serde_json::to_value(packet()).unwrap();
    v["files"][0]["unexpected"] = true.into();
    assert!(serde_json::from_value::<SourcePacket>(v).is_err());
    assert!(serde_json::from_str::<SourcePacket>(
        "{\"version\":1,\"version\":1,\"recipeId\":\"2048-classic-v1\",\"files\":[]}"
    )
    .is_err());
}
#[test]
fn tree_requires_exact_blob_size_regular_mode_and_nonlink_ancestors() {
    let r = recipe(RECIPE_ID).unwrap();
    let spec = r.files.iter().find(|f| f.path == "js/grid.js").unwrap();
    for i in 0..7 {
        let mut source = fake_snapshot(&spec.repository, &spec.commit);
        let e = source
            .entries
            .iter_mut()
            .find(|e| e.path == spec.path)
            .unwrap();
        match i {
            0 => e.mode = "120000".into(),
            1 => e.kind = "commit".into(),
            2 => e.sha = "f".repeat(40),
            3 => e.size = Some(spec.bytes + 1),
            4 => e.path = "js/Grid.js".into(),
            5 => {
                let parent = source.entries.iter_mut().find(|e| e.path == "js").unwrap();
                parent.mode = "120000".into();
            }
            _ => {
                source.entries.retain(|e| e.path != "js");
            }
        };
        assert!(selected_entry(&source, spec).is_err(), "tree mutation {i}");
    }
}
#[test]
fn tree_rejects_case_collision_and_wrong_origin() {
    let r = recipe(RECIPE_ID).unwrap();
    let spec = &r.files[0];
    let mut s = fake_snapshot(&spec.repository, &spec.commit);
    let e = s.entries.iter().find(|e| e.path == spec.path).unwrap();
    s.entries.push(TreeEntry {
        path: e.path.to_uppercase(),
        mode: e.mode.clone(),
        kind: e.kind.clone(),
        sha: e.sha.clone(),
        size: e.size,
    });
    assert!(selected_entry(&s, spec).is_err());
    let mut s = fake_snapshot(&spec.repository, &spec.commit);
    s.discovery.repository.as_mut().unwrap().commit = "b".repeat(40);
    assert!(selected_entry(&s, spec).is_err());
}
#[tokio::test]
async fn acquisition_uses_only_three_pinned_repositories_and_24_declared_files() {
    let t = FakeTransport::new();
    let c = acquire_recipe(RECIPE_ID, &t).await.unwrap();
    validate_capture(&c).unwrap();
    assert_eq!(c.summary.source_hash, GOLDEN);
    assert_eq!(c.summary.total_bytes, 172077);
    assert_eq!(t.discovers.load(Ordering::SeqCst), 3);
    assert_eq!(t.downloads.load(Ordering::SeqCst), 24);
}
#[tokio::test]
async fn unsupported_recipe_makes_zero_requests() {
    let t = FakeTransport::new();
    assert!(acquire_recipe("other", &t).await.is_err());
    assert_eq!(t.discovers.load(Ordering::SeqCst), 0);
    assert_eq!(t.downloads.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn interrupted_and_mutated_acquisition_never_reaches_publication() {
    for mutate in [false, true] {
        let mut t = FakeTransport::new();
        t.mutate = mutate;
        t.fail_after = Some(7);
        let called = AtomicUsize::new(0);
        let result = run_capture_job(
            ulid::Ulid::new().to_string(),
            acquire_recipe(RECIPE_ID, &t),
            |_| {
                called.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(called.load(Ordering::SeqCst), 0);
    }
}
#[tokio::test]
async fn precancelled_job_never_polls_work_or_publishes() {
    let id = ulid::Ulid::new().to_string();
    intake_github_cancel(id.clone()).unwrap();
    let called = AtomicUsize::new(0);
    assert!(run_capture_job(
        id,
        async {
            called.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        |_| Ok(())
    )
    .await
    .is_err());
    assert_eq!(called.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn cancel_after_work_ready_prevents_durable_publication() {
    let id = ulid::Ulid::new().to_string();
    let called = AtomicUsize::new(0);
    assert!(run_capture_job(
        id.clone(),
        async {
            intake_github_cancel(id).unwrap();
            Ok(capture())
        },
        |_| {
            called.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    )
    .await
    .is_err());
    assert_eq!(called.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn cancellation_drops_pending_acquisition_and_refuses_reuse() {
    let id = ulid::Ulid::new().to_string();
    let (ready, rx) = oneshot::channel();
    let task_id = id.clone();
    let task = tokio::spawn(async move {
        run_capture_job(
            task_id,
            async {
                let _ = ready.send(());
                std::future::pending::<Result<(), String>>().await
            },
            |_| -> Result<(), String> { panic!("must not publish") },
        )
        .await
    });
    rx.await.unwrap();
    intake_github_cancel(id.clone()).unwrap();
    assert!(task.await.unwrap().is_err());
    assert!(run_capture_job(id, async { Ok(()) }, |_| Ok(()))
        .await
        .is_err());
}
#[tokio::test]
async fn publication_wins_before_late_cancel_and_request_cannot_be_reused() {
    let id = ulid::Ulid::new().to_string();
    let mut c = conn();
    let source = capture();
    let saved_id = source.summary.id.clone();
    run_capture_job(id.clone(), async { Ok(source) }, |s| {
        store::publish(&mut c, &s)
    })
    .await
    .unwrap();
    intake_github_cancel(id.clone()).unwrap();
    assert!(store::load(&c, &saved_id).is_ok());
    assert!(run_capture_job(id, async { Ok(()) }, |_| Ok(()))
        .await
        .is_err());
}
#[test]
fn immutable_store_reloads_exact_packet_and_publish_is_idempotent() {
    let mut c = conn();
    let s = capture();
    let summary = store::publish(&mut c, &s).unwrap();
    assert_eq!(summary.source_hash, GOLDEN);
    assert_eq!(
        serde_json::to_value(store::load(&c, &s.summary.id).unwrap()).unwrap(),
        serde_json::to_value(&s).unwrap()
    );
    store::publish(&mut c, &s).unwrap();
    assert_eq!(store::list(&c).unwrap().len(), 1);
    assert!(c
        .execute("UPDATE static_app_sources SET created_at=0", [])
        .is_err());
}
#[test]
fn identity_conflict_and_capacity_preserve_existing_bytes_without_eviction() {
    let mut c = conn();
    let first = capture();
    store::publish(&mut c, &first).unwrap();
    let mut conflict = first.clone();
    conflict.summary.created_at += 1;
    conflict.summary.capture_hash = capture_hash(&conflict.summary, &conflict.packet).unwrap();
    assert!(store::publish(&mut c, &conflict).is_err());
    for _ in 1..CAPACITY {
        store::publish(&mut c, &capture()).unwrap();
    }
    assert!(store::publish(&mut c, &capture()).is_err());
    assert_eq!(store::list(&c).unwrap().len(), 8);
    assert_eq!(
        store::load(&c, &first.summary.id)
            .unwrap()
            .summary
            .capture_hash,
        first.summary.capture_hash
    );
}
#[test]
fn source_discard_is_separately_hash_bound_and_does_not_touch_skill_or_package_data() {
    let mut c = conn();
    c.execute_batch(
        "CREATE TABLE unrelated_data (value TEXT); INSERT INTO unrelated_data VALUES ('retained');",
    )
    .unwrap();
    let s = capture();
    store::publish(&mut c, &s).unwrap();
    assert!(store::discard(&mut c, &s.summary.id, &"f".repeat(64)).is_err());
    assert_eq!(store::list(&c).unwrap().len(), 1);
    store::discard(&mut c, &s.summary.id, &s.summary.capture_hash).unwrap();
    assert!(store::list(&c).unwrap().is_empty());
    assert_eq!(
        c.query_row("SELECT value FROM unrelated_data", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "retained"
    );
}
#[test]
fn captured_metadata_origins_and_packet_tamper_are_rejected() {
    let original = capture();
    for i in 0..7 {
        let mut c = original.clone();
        match i {
            0 => c.summary.schema_version = 2,
            1 => c.summary.source_hash = "e".repeat(64),
            2 => c.summary.capture_hash = "e".repeat(64),
            3 => c.summary.total_bytes += 1,
            4 => {
                c.summary.origins.pop();
            }
            5 => c.summary.origins[0].commit = "d".repeat(40),
            _ => c.packet.files[0].path = "../readme.md".into(),
        };
        assert!(validate_capture(&c).is_err(), "capture mutation {i}");
    }
}
#[test]
fn corrupted_saved_rows_block_list_and_publication_without_overwrite() {
    let mut c = conn();
    let s = capture();
    store::publish(&mut c, &s).unwrap();
    c.execute_batch("DROP TRIGGER static_app_sources_immutable;")
        .unwrap();
    c.execute(
        "UPDATE static_app_sources SET capture_json='{}' WHERE id=?1",
        [&s.summary.id],
    )
    .unwrap();
    assert!(store::list(&c).is_err());
    assert!(store::publish(&mut c, &capture()).is_err());
    assert!(store::discard(&mut c, &s.summary.id, &s.summary.capture_hash).is_err());
    assert_eq!(
        c.query_row("SELECT capture_json FROM static_app_sources", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "{}"
    );
}
#[cfg(unix)]
#[test]
fn exact_capture_survives_connection_close_in_owned_private_scratch_database() {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let root = std::env::temp_dir().join(format!("orion-static-source-test-{}", ulid::Ulid::new()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .unwrap();
    let path = root.join("source.db");
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .unwrap();
    let saved = capture();
    {
        let mut c = Connection::open(&path).unwrap();
        c.execute_batch(include_str!(
            "../../../../migrations/0032_static_app_sources.sql"
        ))
        .unwrap();
        store::publish(&mut c, &saved).unwrap();
    }
    {
        let c = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        let loaded = store::load(&c, &saved.summary.id).unwrap();
        assert_eq!(
            serde_json::to_value(loaded).unwrap(),
            serde_json::to_value(saved).unwrap()
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn capture_serialization_matches_shared_golden_with_labelled_synthetic_origin_trees() {
    let summary: CaptureSummary = serde_json::from_str(include_str!(
        "../../../../../src/features/staticApps/__fixtures__/capture2048-summary.json"
    ))
    .unwrap();
    let capture = StaticCapture {
        summary,
        packet: packet(),
    };
    validate_capture(&capture).unwrap();
    assert_eq!(
        capture_hash(&capture.summary, &capture.packet).unwrap(),
        "e134ed3f1e27d9ff1f1f94a2c5e438700096b68aa9f8b1e82fb8ffb26d699557"
    );
    let mut value = serde_json::to_value(&capture).unwrap();
    value["summary"]["origins"][0]["extra"] = true.into();
    assert!(serde_json::from_value::<StaticCapture>(value).is_err());
}
#[test]
fn future_and_oversized_saved_payloads_are_not_loaded_or_replaced() {
    for oversized in [false, true] {
        let mut c = conn();
        let saved = capture();
        store::publish(&mut c, &saved).unwrap();
        c.execute_batch(
            "DROP TRIGGER static_app_sources_immutable; PRAGMA ignore_check_constraints=ON;",
        )
        .unwrap();
        let payload = if oversized {
            " ".repeat(RECORD_LIMIT + 1)
        } else {
            let mut future = saved.clone();
            future.summary.schema_version = 2;
            serde_json::to_string(&future).unwrap()
        };
        c.execute("UPDATE static_app_sources SET capture_json=?1", [&payload])
            .unwrap();
        assert!(store::list(&c).is_err());
        assert!(store::publish(&mut c, &capture()).is_err());
        assert_eq!(
            c.query_row("SELECT capture_json FROM static_app_sources", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            payload
        );
    }
}
#[test]
fn migration_is_append_only_and_does_not_create_skill_tables() {
    let c = conn();
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert!(c
        .execute(
            "INSERT INTO static_app_sources VALUES('short',1,'unknown','hash','hash',0,0,'{}')",
            []
        )
        .is_err());
}
