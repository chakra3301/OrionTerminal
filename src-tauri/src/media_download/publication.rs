use super::{policy, Job};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) fn regular(path: &Path) -> Result<File, String> {
    regular_limited(path, policy::ABSOLUTE_FILE)
}
pub(super) fn regular_limited(path: &Path, limit: u64) -> Result<File, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file()
        || meta.is_symlink()
        || meta.len() == 0
        || meta.len() > limit.min(policy::ABSOLUTE_FILE)
    {
        return Err(
            "Expected a non-empty regular media file within the selected file limit.".into(),
        );
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A regular path can become a FIFO between metadata and open.
        #[cfg(target_os = "macos")]
        options.custom_flags(0x100 | 0x4);
        #[cfg(target_os = "linux")]
        options.custom_flags(0x20000 | 0x800);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || opened.len() != meta.len() {
        return Err("Media file changed during import.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.ino() != meta.ino() || opened.dev() != meta.dev() {
            return Err("Media file changed during import.".into());
        }
    }
    Ok(file)
}
fn mime(ext: &str, audio: bool) -> Option<&'static str> {
    match (ext, audio) {
        ("mp4" | "m4v", false) => Some("video/mp4"),
        ("webm", false) => Some("video/webm"),
        ("mkv", false) => Some("video/x-matroska"),
        ("mov", false) => Some("video/quicktime"),
        ("mp3", true) => Some("audio/mpeg"),
        ("m4a", true) => Some("audio/mp4"),
        ("opus", true) => Some("audio/ogg"),
        ("ogg", true) => Some("audio/ogg"),
        ("flac", true) => Some("audio/flac"),
        ("wav", true) => Some("audio/wav"),
        ("aac", true) => Some("audio/aac"),
        ("webm", true) => Some("audio/webm"),
        _ => None,
    }
}
pub(super) fn output(dir: &Path, audio: bool) -> Result<(PathBuf, String, &'static str), String> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(ext) = name.strip_prefix("media.") {
            if let Some(mime) = mime(ext, audio) {
                candidates.push((entry.path(), ext.to_string(), mime));
            }
        }
    }
    if candidates.len() != 1 {
        return Err("Expected one completed media file. The format may be unavailable or exceed the size limit.".into());
    }
    Ok(candidates.remove(0))
}
pub(super) fn validate_output(dir: &Path, audio: bool) -> Result<(), String> {
    let (path, _, _) = output(dir, audio)?;
    regular_limited(&path, policy::MAX_FILE).map(|_| ())
}
fn digest(mut input: File, limit: u64) -> Result<(Vec<u8>, u64), String> {
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = input.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > limit {
            return Err("Media file exceeded the selected file limit.".into());
        }
        hash.update(&buf[..n]);
    }
    Ok((hash.finalize().to_vec(), bytes))
}
pub(super) fn publish_file(source: &Path, target: &Path) -> Result<u64, String> {
    publish_file_limited(source, target, &policy::Limits::default())
}
pub(super) fn publish_file_limited(
    source: &Path,
    target: &Path,
    limits: &policy::Limits,
) -> Result<u64, String> {
    publish_file_checked(source, target, limits, || Ok(()))
}
pub(super) fn publish_file_checked(
    source: &Path,
    target: &Path,
    limits: &policy::Limits,
    mut check: impl FnMut() -> Result<(), String>,
) -> Result<u64, String> {
    limits.validate()?;
    check()?;
    if fs::symlink_metadata(target).is_ok() {
        let a = digest(
            regular_limited(source, limits.file_bytes())?,
            limits.file_bytes(),
        )?;
        let b = digest(
            regular_limited(target, limits.file_bytes())?,
            limits.file_bytes(),
        )?;
        return if a == b {
            Ok(a.1)
        } else {
            Err("An existing asset conflicts with this download; nothing was overwritten.".into())
        };
    }
    let mut input = regular_limited(source, limits.file_bytes())?;
    let parent = target.parent().ok_or("Missing media destination folder.")?;
    super::engine::disk_space(
        parent,
        limits.free_bytes(),
        input.metadata().map_err(|e| e.to_string())?.len(),
    )?;
    let temporary = target.with_extension(format!("{}.download-tmp", ulid::Ulid::new()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut out = options.open(&temporary).map_err(|e| e.to_string())?;
        let mut bytes = 0;
        let mut buf = [0u8; 64 * 1024];
        loop {
            check()?;
            let n = input.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            bytes += n as u64;
            if bytes > limits.file_bytes() {
                return Err("Media file exceeded the selected file limit.".into());
            }
            if bytes % (8 * 1024 * 1024) < n as u64 {
                super::engine::disk_space(parent, limits.free_bytes(), n as u64)?;
            }
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
        if bytes == 0 {
            return Err("The media file is empty.".into());
        }
        out.sync_all().map_err(|e| e.to_string())?;
        check()?;
        super::engine::disk_space(parent, limits.free_bytes(), 0)?;
        drop(out);
        fs::hard_link(&temporary, target)
            .map_err(|e| format!("Could not publish media without overwriting: {e}"))?;
        File::open(target.parent().unwrap())
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    })();
    let _ = fs::remove_file(temporary);
    result
}
pub(super) fn publish(
    c: &mut Connection,
    item: &Job,
    dir: &Path,
    assets: &Path,
) -> Result<(), String> {
    let metadata = item
        .metadata
        .as_ref()
        .ok_or("Downloaded media has no inspection metadata.")?;
    let audio = item.preset.audio();
    let kind = if audio { "audio" } else { "video" };
    let (source, ext, mime) = output(dir, audio)?;
    let target = assets.join(format!("{}.{}", item.id, ext));
    let size = publish_file_limited(&source, &target, &item.options.limits)?;
    let poster = super::poster::publish(dir, assets, &item.id, &item.options.limits)?;
    let safe_name: String = metadata
        .title
        .chars()
        .take(180)
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let original = format!("{}.{}", safe_name, ext);
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1)",
            [&item.id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Err("An asset with this identity already exists. Nothing was overwritten.".into());
    }
    let mut saved_meta = serde_json::to_value(metadata).map_err(|e| e.to_string())?;
    if let Some(path) = poster {
        saved_meta["posterPath"] = path.to_string_lossy().into_owned().into();
    }
    if let Some(source_id) = &item.source_asset_id {
        saved_meta["derivedFrom"] = source_id.clone().into();
    }
    tx.execute("INSERT INTO assets(id,kind,title,file_path,url,metadata_json,mime_type,size_bytes,original_name,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![item.id,kind,metadata.title,target.to_string_lossy(),if item.url.is_empty() {None} else {Some(&item.url)},serde_json::to_string(&saved_meta).map_err(|e| e.to_string())?,mime,size,original,item.created_at]).map_err(|e| e.to_string())?;
    let mut tags = vec!["downloaded".to_string(), kind.to_string()];
    if let Some(site) = policy::normalize_tag(&metadata.site.replace('.', "-")) {
        tags.push(site);
    }
    tags.extend(metadata.tags.clone());
    tags.sort();
    tags.dedup();
    for name in tags {
        tx.execute(
            "INSERT OR IGNORE INTO tags(id,name) VALUES(?1,?2)",
            params![ulid::Ulid::new().to_string(), name],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO asset_tags(asset_id,tag_id) SELECT ?1,id FROM tags WHERE name=?2",
            params![item.id, name],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(source_id) = &item.source_asset_id {
        tx.execute("INSERT OR IGNORE INTO asset_tags(asset_id,tag_id) SELECT ?1,tag_id FROM asset_tags WHERE asset_id=?2",params![item.id,source_id]).map_err(|e|e.to_string())?;
    }
    tx.execute(
        "UPDATE media_downloads SET state='completed',asset_id=?1,error=NULL WHERE id=?1",
        [&item.id],
    )
    .map_err(|e| e.to_string())?;
    super::preferences::record(&tx, item)?;
    tx.commit()
        .map_err(|e| format!("Import commit could not be confirmed; refresh before retrying: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_private_copy_removes_only_its_temporary_bytes() {
        let p = folder();
        let source = p.join("original");
        let target = p.join("copy");
        fs::write(&source, vec![7u8; 256 * 1024]).unwrap();
        let mut polls = 0;
        let error = publish_file_checked(&source, &target, &policy::Limits::default(), || {
            polls += 1;
            if polls >= 3 {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert_eq!(error, "cancelled");
        assert!(!target.exists());
        assert_eq!(fs::read(&source).unwrap(), vec![7u8; 256 * 1024]);
        assert_eq!(fs::read_dir(&p).unwrap().count(), 1);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn selected_caps_cover_regular_files_and_actual_publication() {
        let p = folder();
        let source = p.join("large-source");
        File::create(&source)
            .unwrap()
            .set_len(17 * 1024 * 1024)
            .unwrap();
        let small = policy::Limits {
            file_mib: 16,
            work_mib: 32,
            ..Default::default()
        };
        let large = policy::Limits {
            file_mib: 32,
            work_mib: 64,
            ..Default::default()
        };
        let target = p.join("copy");
        assert!(publish_file_limited(&source, &target, &small)
            .unwrap_err()
            .contains("selected file limit"));
        assert!(!target.exists());
        assert_eq!(
            publish_file_limited(&source, &target, &large).unwrap(),
            17 * 1024 * 1024
        );
        assert_eq!(
            digest(regular(&source).unwrap(), large.file_bytes()).unwrap(),
            digest(regular(&target).unwrap(), large.file_bytes()).unwrap()
        );
        let huge = p.join("sparse-above-legacy-limit");
        File::create(&huge)
            .unwrap()
            .set_len(policy::MAX_FILE + 1)
            .unwrap();
        assert!(regular_limited(&huge, policy::MAX_FILE).is_err());
        assert!(regular_limited(&huge, 4 * policy::MAX_FILE).is_ok());
        File::create(&huge)
            .unwrap()
            .set_len(policy::ABSOLUTE_FILE + 1)
            .unwrap();
        assert!(regular(&huge).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    fn folder() -> PathBuf {
        let p = std::env::temp_dir().join(format!("orion-publish-{}", ulid::Ulid::new()));
        fs::create_dir(&p).unwrap();
        p
    }
    #[test]
    fn publication_retries_identical_bytes_without_overwriting() {
        let p = folder();
        let a = p.join("source");
        let b = p.join("target");
        fs::write(&a, b"media").unwrap();
        assert_eq!(publish_file(&a, &b).unwrap(), 5);
        assert_eq!(publish_file(&a, &b).unwrap(), 5);
        fs::write(&a, b"other").unwrap();
        assert!(publish_file(&a, &b).is_err());
        assert_eq!(fs::read(&b).unwrap(), b"media");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn incomplete_and_ambiguous_outputs_are_not_imported() {
        let p = folder();
        fs::write(p.join("media.mp4.part"), b"partial").unwrap();
        assert!(output(&p, false).is_err());
        fs::write(p.join("media.mp4"), b"one").unwrap();
        assert!(output(&p, false).is_ok());
        fs::write(p.join("media.mkv"), b"two").unwrap();
        assert!(output(&p, false).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn playable_copy_receipt_preserves_original_and_inherits_tags() {
        let p = folder();
        let work = p.join("work");
        let assets = p.join("assets");
        fs::create_dir(&work).unwrap();
        fs::create_dir(&assets).unwrap();
        fs::write(
            work.join("media.mp4"),
            b"synthetic publication bytes, not a codec test",
        )
        .unwrap();
        let source = ulid::Ulid::new().to_string();
        let id = ulid::Ulid::new().to_string();
        let original = assets.join(format!("{source}.mkv"));
        fs::write(&original, b"owner fixture original").unwrap();
        let mut c = Connection::open_in_memory().unwrap();
        for sql in [
            include_str!("../../migrations/0001_init.sql"),
            include_str!("../../migrations/0007_asset_metadata.sql"),
            include_str!("../../migrations/0034_media_downloads.sql"),
            include_str!("../../migrations/0035_media_download_options.sql"),
            include_str!("../../migrations/0036_media_download_preferences.sql"),
        ] {
            c.execute_batch(sql).unwrap();
        }
        c.execute("INSERT INTO assets(id,kind,title,file_path,created_at) VALUES(?1,'video','Original',?2,1)",params![source,original.to_string_lossy()]).unwrap();
        c.execute_batch("INSERT INTO tags(id,name) VALUES('fixture-tag','owner-topic')")
            .unwrap();
        c.execute(
            "INSERT INTO asset_tags(asset_id,tag_id) VALUES(?1,'fixture-tag')",
            [&source],
        )
        .unwrap();
        c.execute("INSERT INTO media_downloads(id,url,state,preset,created_at,source_asset_id) VALUES(?1,'','ready','video-mp4',2,?2)",params![id,source]).unwrap();
        let mut item = super::super::job(&c, &id).unwrap();
        item.metadata = Some(
            policy::metadata(
                &serde_json::json!({"title":"Playable copy"}),
                "https://example.com/video",
            )
            .unwrap(),
        );
        publish(&mut c, &item, &work, &assets).unwrap();
        let saved: String = c
            .query_row("SELECT metadata_json FROM assets WHERE id=?1", [&id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&saved).unwrap()["derivedFrom"],
            source
        );
        let tags:i64 = c.query_row("SELECT count(*) FROM asset_tags WHERE asset_id IN (?1,?2) AND tag_id='fixture-tag'",params![id,source],|r|r.get(0)).unwrap();
        assert_eq!(tags, 2);
        assert_eq!(fs::read(&original).unwrap(), b"owner fixture original");
        assert_eq!(super::super::job(&c, &id).unwrap().state, "completed");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn db_failure_retains_completed_file_and_retry_commits_tags_and_receipt_once() {
        let p = folder();
        let work = p.join("work");
        let assets = p.join("assets");
        fs::create_dir(&work).unwrap();
        fs::create_dir(&assets).unwrap();
        fs::write(work.join("media.mp3"), b"synthetic fixture bytes").unwrap();
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../migrations/0001_init.sql"))
            .unwrap();
        c.execute_batch(include_str!("../../migrations/0007_asset_metadata.sql"))
            .unwrap();
        c.execute_batch(include_str!("../../migrations/0034_media_downloads.sql"))
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0035_media_download_options.sql"
        ))
        .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0036_media_download_preferences.sql"
        ))
        .unwrap();
        let id = ulid::Ulid::new().to_string();
        c.execute("INSERT INTO media_downloads(id,url,state,created_at) VALUES(?1,'https://example.com/video','ready',1)",[&id]).unwrap();
        let mut item = super::super::job(&c, &id).unwrap();
        item.preset = policy::Preset::AudioMp3;
        item.metadata = Some(
            policy::metadata(
                &serde_json::json!({"title":"Owner's piano", "tags":["Music Theory"]}),
                &item.url,
            )
            .unwrap(),
        );
        c.execute_batch("CREATE TRIGGER fail_media_insert BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        assert!(publish(&mut c, &item, &work, &assets).is_err());
        assert!(work.join("media.mp3").exists());
        assert!(assets.join(format!("{id}.mp3")).exists());
        assert_eq!(super::super::job(&c, &id).unwrap().state, "ready");
        c.execute_batch("DROP TRIGGER fail_media_insert; CREATE TRIGGER fail_archive BEFORE INSERT ON media_download_archive BEGIN SELECT RAISE(ABORT,'archive fixture failure'); END;").unwrap();
        assert!(publish(&mut c, &item, &work, &assets).is_err());
        assert_eq!(super::super::job(&c, &id).unwrap().state, "ready");
        let rolled_back: i64 = c
            .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rolled_back, 0);
        let archived: i64 = c
            .query_row("SELECT count(*) FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(archived, 0);
        assert!(work.join("media.mp3").exists());
        c.execute_batch("DROP TRIGGER fail_archive;").unwrap();
        publish(&mut c, &item, &work, &assets).unwrap();
        let archived: i64 = c
            .query_row("SELECT count(*) FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(archived, 1);
        assert_eq!(super::super::job(&c, &id).unwrap().state, "completed");
        let count: i64 = c
            .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let tags: i64 = c
            .query_row(
                "SELECT count(*) FROM asset_tags WHERE asset_id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tags, 4);
        assert!(publish(&mut c, &item, &work, &assets).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn source_and_destination_symlinks_fail_closed() {
        let p = folder();
        let source = p.join("source");
        fs::write(&source, b"media").unwrap();
        std::os::unix::fs::symlink(&source, p.join("link")).unwrap();
        assert!(regular(&p.join("link")).is_err());
        assert!(publish_file(&source, &p.join("link")).is_err());
        fs::remove_dir_all(p).unwrap();
    }
}
