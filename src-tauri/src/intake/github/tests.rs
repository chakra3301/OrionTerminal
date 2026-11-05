use super::*;

pub(super) fn entry(path: &str, mode: &str, size: usize) -> TreeEntry {
    TreeEntry {
        path: path.into(),
        mode: mode.into(),
        kind: "blob".into(),
        sha: "b".repeat(40),
        size: Some(size),
    }
}
pub(super) fn source(entries: Vec<TreeEntry>) -> RepositorySnapshot {
    snapshot(
        Repository::parse("https://github.com/owner/repo.git").unwrap(),
        "a".repeat(40),
        TreeResponse {
            sha: "c".repeat(40),
            truncated: false,
            tree: entries,
        },
    )
    .unwrap()
}
#[test]
fn normalizes_only_explicit_public_github_urls() {
    let repo = Repository::parse("https://github.com/Leonxlnx/taste-skill.git").unwrap();
    assert_eq!(repo.url(), "https://github.com/Leonxlnx/taste-skill");
    assert_eq!(repo.reference, "HEAD");
    let pinned =
        Repository::parse(&format!("https://github.com/a/b/tree/{}", "a".repeat(40))).unwrap();
    assert_eq!(pinned.reference, "a".repeat(40));
    for bad in [
        "http://github.com/a/b",
        "https://github.com.evil.test/a/b",
        "https://github.com@localhost/a/b",
        "https://github.com:443/a/b",
        "https://github.com/a/b?token=secret",
        "https://github.com/a/../b",
        "https://github.com/a/%2e%2e",
        "file:///tmp/repo",
        "git@github.com:a/b",
        "https://127.0.0.1/a/b",
        "https://github.com/a/b/tree/main",
        "https://github.com/a/b#fragment",
    ] {
        assert!(Repository::parse(bad).is_err(), "{bad}");
    }
}
#[test]
fn bounds_actual_streamed_bytes_without_trusting_content_length() {
    let mut bytes = vec![1, 2];
    append_chunk(&mut bytes, &[3, 4], 4).unwrap();
    assert!(append_chunk(&mut bytes, &[5], 4).is_err());
    assert_eq!(bytes, vec![1, 2, 3, 4]);
}
#[test]
fn rejects_truncated_trees_but_allows_analysis_only_repositories() {
    let repo = Repository::parse("https://github.com/a/b").unwrap();
    assert!(snapshot(
        repo.clone(),
        "a".repeat(40),
        TreeResponse {
            sha: "b".repeat(40),
            truncated: true,
            tree: vec![]
        }
    )
    .is_err());
    let reviewed = snapshot(
        repo,
        "a".repeat(40),
        TreeResponse {
            sha: "b".repeat(40),
            truncated: false,
            tree: vec![entry("README.md", "100644", 1)],
        },
    )
    .unwrap();
    assert!(reviewed.discovery.entries.is_empty());
    assert_eq!(reviewed.discovery.review_files.unwrap()[0].path, "README.md");
}
#[test]
fn selects_one_subtree_and_explicit_attribution_not_siblings() {
    let src = source(vec![
        entry("skills/one/SKILL.md", "100644", 87_253),
        entry("skills/one/DESIGN.md", "100644", 10),
        entry("skills/two/SKILL.md", "100644", 10),
        entry("LICENSE", "100644", 10),
        entry("scripts/installer.sh", "100755", 100),
    ]);
    assert_eq!(src.discovery.entries.len(), 2);
    assert_eq!(
        src.discovery.repository.as_ref().unwrap().commit,
        "a".repeat(40)
    );
    let picked = selected(&src, "skills/one/SKILL.md", &["LICENSE".into()]).unwrap();
    assert_eq!(
        picked.iter().map(|(_, p)| p.as_str()).collect::<Vec<_>>(),
        ["SKILL.md", "DESIGN.md", "__orion_attribution/LICENSE"]
    );
    assert_eq!(selected(&src, "skills/one/SKILL.md", &[]).unwrap().len(), 2);
    assert!(selected(&src, "skills/two/../one/SKILL.md", &[]).is_err());
}
#[test]
fn refuses_links_submodules_collisions_and_oversized_resources_before_download() {
    for extra in [
        entry("skills/one/link", "120000", 2),
        TreeEntry {
            kind: "commit".into(),
            ..entry("skills/one/sub", "160000", 0)
        },
        entry("skills/one/large", "100644", 1024 * 1024 + 1),
        entry("skills/one/../escape", "100644", 1),
        entry("skills/one/skill.md", "100644", 1),
    ] {
        let src = source(vec![entry("skills/one/SKILL.md", "100644", 20), extra]);
        assert!(selected(&src, "skills/one/SKILL.md", &[]).is_err());
    }
}
#[test]
fn remote_provenance_roundtrips_without_changing_local_v1_reader() {
    let mut contents = BTreeMap::new();
    let mut origins = BTreeMap::new();
    contents.insert(
        "SKILL.md".into(),
        (
            b"---\nname: example\ndescription: Fixture\n---\nBody".to_vec(),
            0o100644,
        ),
    );
    origins.insert("SKILL.md".into(), "skills/one/SKILL.md".into());
    let origin = source(vec![entry("skills/one/SKILL.md", "100644", 20)])
        .discovery
        .repository;
    let p = assemble(
        "owner/repo",
        "skills/one/SKILL.md",
        contents,
        origins,
        origin,
    )
    .unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch(include_str!(
        "../../../migrations/0030_skill_intake_staging.sql"
    ))
    .unwrap();
    stage(&mut db, &p).unwrap();
    let restored = load(&db, &p.summary.id).unwrap();
    assert_eq!(restored.summary.repository.unwrap().commit, "a".repeat(40));
    let mut json = serde_json::to_value(p.summary).unwrap();
    json.as_object_mut().unwrap().remove("repository");
    assert!(serde_json::from_value::<Candidate>(json)
        .unwrap()
        .repository
        .is_none());
}
#[tokio::test]
async fn cancellation_before_registration_prevents_future_polling() {
    let id = ulid::Ulid::new().to_string();
    intake_github_cancel(id.clone()).unwrap();
    let mut polled = false;
    let result = run_job(id, async {
        polled = true;
        Ok(())
    })
    .await;
    assert!(result.is_err());
    assert!(!polled);
}
#[tokio::test]
async fn cancellation_drops_inflight_work_and_prevents_reuse() {
    let id = ulid::Ulid::new().to_string();
    let (ready, wait) = oneshot::channel();
    let job = id.clone();
    let work = tokio::spawn(async move {
        run_job(job, async {
            let _ = ready.send(());
            std::future::pending::<Result<(), String>>().await
        })
        .await
    });
    wait.await.unwrap();
    intake_github_cancel(id.clone()).unwrap();
    assert!(work.await.unwrap().unwrap_err().contains("cancelled"));
    assert!(run_job(id, async { Ok(()) }).await.is_err());
}
#[tokio::test]
async fn arbitrary_destinations_are_rejected_before_network_access() {
    let client = client().unwrap();
    for url in [
        "http://localhost:80/private",
        "https://example.com/",
        "https://user:pass@api.github.com/",
    ] {
        assert!(get(&client, reqwest::Url::parse(url).unwrap(), 100)
            .await
            .unwrap_err()
            .contains("denied"));
    }
}
#[tokio::test]
#[ignore = "explicit public GitHub network inspection; no scripts or install"]
async fn live_pinned_taste_resource_acquisition() {
    let source = run_job(
        ulid::Ulid::new().to_string(),
        discover_repository(
            "https://github.com/Leonxlnx/taste-skill/tree/e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58",
        ),
    )
    .await
    .unwrap();
    assert_eq!(source.discovery.entries.len(), 13);
    let p = run_job(
        ulid::Ulid::new().to_string(),
        acquire(&source, "skills/stitch-skill/SKILL.md", &["LICENSE".into()]),
    )
    .await
    .unwrap();
    assert_eq!(
        hash(&p.contents["stitch-design-taste/DESIGN.md"]),
        "0ab6740c4ebb1966dbceddb823a66d4bf027e960efbd73faca56cbf8370ae2ad"
    );
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch(include_str!(
        "../../../migrations/0030_skill_intake_staging.sql"
    ))
    .unwrap();
    stage(&mut db, &p).unwrap();
    assert_eq!(load(&db, &p.summary.id).unwrap().contents, p.contents);
}
