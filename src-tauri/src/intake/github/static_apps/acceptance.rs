use super::*;
use std::path::{Path, PathBuf};

pub(in crate::intake) fn proof_root() -> PathBuf {
    let root = PathBuf::from(
        std::env::var("ORION_INTAKE_PROOF_ROOT")
            .expect("Explicit private proof directory required"),
    );
    assert!(root.is_absolute());
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("incubator-v1-"));
    assert!(crate::intake::safe_dir::root(&root).is_ok());
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let meta = std::fs::symlink_metadata(&root).unwrap();
        let uid = String::from_utf8(
            std::process::Command::new("/usr/bin/id")
                .arg("-u")
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .parse::<u32>()
        .unwrap();
        assert_eq!(meta.uid(), uid);
        assert_eq!(meta.permissions().mode() & 0o777, 0o700);
    }
    root
}
pub(in crate::intake) fn new_file(path: &Path, bytes: &[u8]) {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
}

#[tokio::test]
#[ignore = "Explicit public pinned network capture into a fresh private proof directory; no UI or source execution"]
async fn live_recipe_source_capture_without_screen() {
    let root = proof_root();
    assert!(!root.join("live-capture.json").exists());
    let transport = HttpTransport(client().unwrap());
    let capture = run_capture_job(
        ulid::Ulid::new().to_string(),
        acquire_recipe(RECIPE_ID, &transport),
        |capture| {
            let path = root.join("backend-source.db");
            new_file(&path, &[]);
            let mut conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "foreign_keys", true).unwrap();
            conn.busy_timeout(Duration::from_millis(500)).unwrap();
            conn.execute_batch(include_str!(
                "../../../../migrations/0032_static_app_sources.sql"
            ))
            .unwrap();
            store::publish(&mut conn, &capture)?;
            Ok(capture)
        },
    )
    .await
    .unwrap();
    let conn = Connection::open_with_flags(
        root.join("backend-source.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let reloaded = store::load(&conn, &capture.summary.id).unwrap();
    assert_eq!(
        serde_json::to_value(&capture).unwrap(),
        serde_json::to_value(&reloaded).unwrap()
    );
    assert_eq!(store::list(&conn).unwrap().len(), 1);
    new_file(
        &root.join("live-capture.json"),
        &serde_json::to_vec_pretty(&reloaded).unwrap(),
    );
    println!(
        "Real pinned capture: {} files / {} bytes, source {} / capture {}",
        capture.summary.file_count,
        capture.summary.total_bytes,
        capture.summary.source_hash,
        capture.summary.capture_hash
    );
    for origin in &capture.summary.origins {
        println!(
            "Actual origin: {} commit {} tree {}",
            origin.url, origin.commit, origin.tree
        );
    }
}
