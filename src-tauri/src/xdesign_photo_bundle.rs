//! Immutable directory bundles. Versions own manifests and hard-link identical
//! compressed tiles/blobs from a per-document pool. Portable files stay ZIPs.
use photocraft_format::zip::ZipReader;
use photocraft_format::zip::ZipWriter;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MAX_BUNDLE: usize = 2 * 1024 * 1024 * 1024;
const MAX_ENTRY: usize = 512 * 1024 * 1024;
const MAX_MANIFEST: usize = 32 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;

#[path = "xdesign_photo_bundle_compaction.rs"]
pub(super) mod compaction;

fn object_name(name: &str) -> bool {
    name.strip_suffix(".zst").is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn allowed(name: &str) -> bool {
    name == "manifest.json"
        || name == "thumb.png"
        || name == "composite/preview.png"
        || ["tiles/", "blobs/"]
            .iter()
            .any(|prefix| name.strip_prefix(prefix).is_some_and(object_name))
}
fn directory(path: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(path)
        .is_ok_and(|meta| !meta.is_dir() || meta.file_type().is_symlink())
    {
        return Err("The image object directory is invalid".into());
    }
    std::fs::create_dir_all(path).map_err(|e| e.to_string())
}
fn file_bytes(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > max as u64 {
        return Err("An image bundle entry is invalid or oversized".into());
    }
    std::fs::read(path).map_err(|e| e.to_string())
}
struct Draft(PathBuf);
impl Drop for Draft {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn publish_directory(draft: &Path, destination: &Path) -> Result<(), String> {
    use photocraft_format::atomic::{AtomicFs, RealFs};
    let mut directories=vec![draft.join("tiles"),draft.join("blobs")];
    if draft.join("composite").is_dir(){directories.push(draft.join("composite"));}
    directories.push(draft.to_owned());
    for directory in directories {
        RealFs.sync_dir(&directory).map_err(|e| e.to_string())?;
    }
    std::fs::rename(draft, destination).map_err(|e| e.to_string())?;
    RealFs
        .sync_dir(
            destination
                .parent()
                .ok_or("Invalid image version directory")?,
        )
        .map_err(|e| e.to_string())
}

#[derive(PartialEq, Eq)]
struct ObjectStamp {
    len: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
fn stamp(path: &Path) -> Result<ObjectStamp, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_ENTRY as u64
    {
        return Err("Invalid image history object".into());
    }
    Ok(ObjectStamp {
        len: metadata.len(),
        modified: metadata.modified().map_err(|e| e.to_string())?,
        #[cfg(unix)]
        identity: {
            use std::os::unix::fs::MetadataExt;
            (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            )
        },
    })
}

#[derive(Default)]
pub(crate) struct IncrementalWriter {
    native: photocraft_format::PcraftWriter,
    previous: Option<(String, HashMap<String, ObjectStamp>)>,
}

pub(crate) fn write_document(
    dir: &Path,
    version: &str,
    doc: &photocraft_engine::doc::Document,
    writer: &mut IncrementalWriter,
) -> Result<photocraft_format::SaveStats, String> {
    super::id(version)?;
    directory(dir)?;
    let destination = dir.join(format!("{version}.pcraft"));
    if std::fs::symlink_metadata(&destination).is_ok() {
        return Err("This image version already exists".into());
    }
    let pool = dir.join(".objects");
    directory(&pool)?;
    for sub in ["tiles", "blobs"] {
        directory(&pool.join(sub))?;
    }
    let draft = Draft(dir.join(format!(".pcraft-{}", ulid::Ulid::new())));
    std::fs::create_dir(&draft.0).map_err(|e| e.to_string())?;
    for sub in ["tiles", "blobs"] {
        std::fs::create_dir(draft.0.join(sub)).map_err(|e| e.to_string())?;
    }
    // Reuse only files this writer published, with unchanged metadata. On
    // reopen or external changes the native writer derives fresh objects from
    // the in-memory document; no ZIP or retained compressed-byte cache is used.
    if let Some((previous, objects)) = &writer.previous {
        let source = dir.join(format!("{previous}.pcraft"));
        if std::fs::symlink_metadata(&source)
            .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
        {
            for (name, known) in objects {
                let from = source.join(name);
                if std::fs::symlink_metadata(from.parent().unwrap())
                    .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
                    && stamp(&from).is_ok_and(|current| current == *known)
                {
                    let _ = std::fs::hard_link(from, draft.0.join(name));
                }
            }
        }
    }
    let stats = writer
        .native
        .save_dir(doc, &draft.0, &Default::default())
        .map_err(|e| e.to_string())?;
    std::fs::remove_dir(draft.0.join("composite")).map_err(|e| e.to_string())?;
    let files = entries(&draft.0)?;
    let mut total = 0u64;
    let mut objects = HashMap::new();
    for file in files {
        let name = file
            .strip_prefix(&draft.0)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("Invalid image object path")?
            .to_owned();
        let size = std::fs::symlink_metadata(&file)
            .map_err(|e| e.to_string())?
            .len();
        if size
            > (if name == "manifest.json" {
                MAX_MANIFEST
            } else {
                MAX_ENTRY
            }) as u64
        {
            return Err("Oversized image history object".into());
        }
        total = total
            .checked_add(size)
            .filter(|total| *total <= MAX_BUNDLE as u64)
            .ok_or("Image history bundle exceeds 2 GB")?;
        if name == "manifest.json" {
            continue;
        }
        let anchor = pool.join(&name);
        if std::fs::symlink_metadata(&anchor)
            .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
        {
            return Err("Invalid shared image object".into());
        }
        #[cfg(unix)]
        let same = {
            use std::os::unix::fs::MetadataExt;
            let target = std::fs::metadata(&file).map_err(|e| e.to_string())?;
            std::fs::metadata(&anchor)
                .is_ok_and(|source| source.dev() == target.dev() && source.ino() == target.ino())
        };
        #[cfg(not(unix))]
        let same = false;
        // save_dir already synced this new object, so a missing anchor can share its inode.
        // Copying it through atomic_write cost two more F_FULLFSYNCs per tile, which made a
        // whole-image filter on a 12 MP photo spend seconds flushing the disk.
        let shared = !same
            && std::fs::symlink_metadata(&anchor).is_err()
            && std::fs::hard_link(&file, &anchor).is_ok();
        if !same && !shared {
            let data = file_bytes(&file, MAX_ENTRY)?;
            if !file_bytes(&anchor, MAX_ENTRY).is_ok_and(|existing| existing == data) {
                photocraft_format::atomic_write(&anchor, &data).map_err(|e| e.to_string())?;
            }
            let link = draft.0.join(format!(".link-{}", ulid::Ulid::new()));
            if std::fs::hard_link(&anchor, &link).is_ok() {
                std::fs::rename(&link, &file).map_err(|e| e.to_string())?;
            }
        }
        objects.insert(name, stamp(&file)?);
    }
    publish_directory(&draft.0, &destination)?;
    writer.previous = Some((version.to_owned(), objects));
    Ok(stats)
}

#[cfg(test)]
pub(crate) fn write(dir: &Path, version: &str, bytes: &[u8]) -> Result<(), String> {
    super::id(version)?;
    write_archive(dir,&dir.join(format!("{version}.pcraft")),bytes)
}

fn write_archive(dir:&Path,destination:&Path,bytes:&[u8])->Result<(),String>{
    if bytes.len() > MAX_BUNDLE {
        return Err("Image history bundle exceeds 2 GB".into());
    }
    let zip = ZipReader::new(bytes).map_err(|e| e.to_string())?;
    if zip.entries.len() > MAX_ENTRIES || zip.find("manifest.json").is_none() || zip.entries.iter().map(|entry|&entry.name).collect::<std::collections::HashSet<_>>().len()!=zip.entries.len() {
        return Err("Invalid image history bundle".into());
    }
    let pool = dir.join(".objects");
    directory(&pool)?;
    for sub in ["tiles", "blobs"] {
        directory(&pool.join(sub))?;
    }
    let draft = Draft(dir.join(format!(".pcraft-{}", ulid::Ulid::new())));
    std::fs::create_dir(&draft.0).map_err(|e| e.to_string())?;
    for sub in ["tiles", "blobs"] {
        std::fs::create_dir(draft.0.join(sub)).map_err(|e| e.to_string())?;
    }
    if zip.find("composite/preview.png").is_some(){std::fs::create_dir(draft.0.join("composite")).map_err(|e|e.to_string())?;}
    let mut total = 0usize;
    for entry in &zip.entries {
        if !allowed(&entry.name) {
            return Err("Unsupported image history bundle entry".into());
        }
        let data = zip
            .read(
                entry,
                if entry.name == "manifest.json" {
                    MAX_MANIFEST
                } else {
                    MAX_ENTRY
                },
            )
            .map_err(|e| e.to_string())?;
        total = total
            .checked_add(data.len())
            .filter(|total| *total <= MAX_BUNDLE)
            .ok_or("Image history bundle exceeds 2 GB")?;
        let target = draft.0.join(&entry.name);
        if ["manifest.json","thumb.png","composite/preview.png"].contains(&entry.name.as_str()) {
            photocraft_format::atomic_write(&target, &data).map_err(|e| e.to_string())?;
        } else {
            let source = pool.join(&entry.name);
            // Compare with the engine-produced bytes before reusing an object;
            // replace damaged anchors atomically, leaving old versions intact.
            if source.exists() || std::fs::symlink_metadata(&source).is_ok() {
                let metadata = std::fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err("The shared image object is invalid".into());
                }
            }
            if !file_bytes(&source, MAX_ENTRY).is_ok_and(|existing| existing == data) {
                photocraft_format::atomic_write(&source, &data).map_err(|e| e.to_string())?;
            }
            std::fs::hard_link(&source, &target)
                .or_else(|_| {
                    photocraft_format::atomic_write(&target, &data).map_err(std::io::Error::other)
                })
                .map_err(|e| e.to_string())?;
        }
    }
    if std::fs::symlink_metadata(destination).is_ok() {
        return Err("This image version already exists".into());
    }
    // Rename publishes a complete snapshot; failed saves leave no visible version.
    publish_directory(&draft.0, destination)
}

pub(super) fn entries(path: &Path) -> Result<Vec<PathBuf>, String> {
    list_entries(path, false)
}
pub(super) fn staging_entries(path: &Path) -> Result<Vec<PathBuf>, String> {
    list_entries(path, true)
}
fn atomic_temporary(name: &str) -> bool {
    let Some(name) = name
        .strip_prefix('.')
        .and_then(|name| name.strip_suffix(".pcsave.tmp"))
    else {
        return false;
    };
    let Some((stem, identity)) = name.rsplit_once('.') else {
        return false;
    };
    (stem == "manifest.json" || object_name(stem) || object_name(&format!("{stem}.zst")))
        && !identity.is_empty()
        && identity.len() <= 80
        && identity
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'-')
}
fn list_entries(path: &Path, staging: bool) -> Result<Vec<PathBuf>, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Invalid image history snapshot".into());
    }
    let mut result = Vec::new();
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if (name == "manifest.json" || name == "thumb.png"
            || staging
                && (atomic_temporary(&name)
                    || name
                        .strip_prefix(".link-")
                        .is_some_and(|id| super::id(id).is_ok())))
            && entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            result.push(entry.path());
        } else if ["tiles", "blobs"].contains(&name.as_str())
            && entry.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            for object in std::fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
                let object = object.map_err(|e| e.to_string())?;
                let name = object.file_name().to_string_lossy().into_owned();
                if !(object_name(&name) || staging && atomic_temporary(&name))
                    || !object.file_type().map_err(|e| e.to_string())?.is_file()
                {
                    return Err("Invalid image history object".into());
                }
                result.push(object.path());
                if result.len() > MAX_ENTRIES {
                    return Err("Image history snapshot exceeds its entry limit".into());
                }
            }
        } else if name=="composite" && entry.file_type().map_err(|e|e.to_string())?.is_dir(){
            for preview in std::fs::read_dir(entry.path()).map_err(|e|e.to_string())?{let preview=preview.map_err(|e|e.to_string())?;let name=preview.file_name().to_string_lossy().into_owned();if !(name=="preview.png"||staging&&atomic_temporary(&name))||!preview.file_type().map_err(|e|e.to_string())?.is_file(){return Err("Unexpected image history preview".into());}result.push(preview.path());}
        } else {
            return Err("Unexpected image history snapshot entry".into());
        }
    }
    if !staging
        && !result
            .iter()
            .any(|file| file.file_name().is_some_and(|name| name == "manifest.json"))
    {
        return Err("Missing image history manifest".into());
    }
    result.sort();
    Ok(result)
}

pub(crate) fn portable_bytes(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Invalid image bundle path".into());
    }
    if metadata.is_file() {
        return file_bytes(path, max);
    }
    let mut zip = ZipWriter::new();
    let mut total = 0usize;
    for file in entries(path)? {
        let name = file
            .strip_prefix(path)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("Invalid image object path")?;
        let bytes = file_bytes(
            &file,
            max.saturating_sub(total).min(if name == "manifest.json" {
                MAX_MANIFEST
            } else {
                MAX_ENTRY
            }),
        )?;
        total = total
            .checked_add(bytes.len())
            .filter(|total| *total <= max)
            .ok_or("Image bundle exceeds its export limit")?;
        zip.add(name, &bytes).map_err(|e| e.to_string())?;
    }
    let bytes = zip.finish().map_err(|e| e.to_string())?;
    if bytes.len() > max {
        return Err("Image bundle exceeds its export limit".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;
    #[test]
    fn incremental_saves_skip_unchanged_compression_and_repair_changed_objects() {
        let draft =
            Draft(std::env::temp_dir().join(format!("xdesign-incremental-{}", ulid::Ulid::new())));
        directory(&draft.0).unwrap();
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":520,"height":32,"background":"white"}),
            )
            .unwrap();
        let mut writer = IncrementalWriter::default();
        let first = ulid::Ulid::new().to_string();
        let stats =
            write_document(&draft.0, &first, &engine.active().unwrap().doc, &mut writer).unwrap();
        assert!(stats.tiles_written > 0);
        let second = ulid::Ulid::new().to_string();
        let stats = write_document(
            &draft.0,
            &second,
            &engine.active().unwrap().doc,
            &mut writer,
        )
        .unwrap();
        assert_eq!(stats.tiles_written, 0);
        assert_eq!(stats.tiles_reused, stats.tiles_total);
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[8,8],[12,8]],"size":4,"color":"#ff0000"}),
            )
            .unwrap();
        let third = ulid::Ulid::new().to_string();
        let stats =
            write_document(&draft.0, &third, &engine.active().unwrap().doc, &mut writer).unwrap();
        assert!(stats.tiles_reused > 0);
        assert!(stats.tiles_written > 0);
        let path = draft.0.join(format!("{third}.pcraft"));
        let tile = entries(&path)
            .unwrap()
            .into_iter()
            .find(|file| file.parent().unwrap().file_name().unwrap() == "tiles")
            .unwrap();
        std::fs::write(&tile, b"damaged").unwrap();
        let repaired = ulid::Ulid::new().to_string();
        let stats = write_document(
            &draft.0,
            &repaired,
            &engine.active().unwrap().doc,
            &mut writer,
        )
        .unwrap();
        assert!(stats.tiles_written > 0);
        let restored =
            photocraft_format::load_path(&draft.0.join(format!("{repaired}.pcraft"))).unwrap();
        assert_eq!(
            photocraft_compose::render_reduced(&restored, 520, 32).px,
            photocraft_compose::render_reduced(&engine.active().unwrap().doc, 520, 32).px
        );
        assert!(write_document(
            &draft.0,
            &repaired,
            &engine.active().unwrap().doc,
            &mut writer
        )
        .unwrap_err()
        .contains("already exists"));
        assert_eq!(
            std::fs::read_dir(&draft.0)
                .unwrap()
                .flatten()
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(".pcraft-"))
                .count(),
            0
        );
    }
    #[test]
    fn snapshots_share_tiles_restore_exact_pixels_and_remain_portable() {
        let draft =
            Draft(std::env::temp_dir().join(format!("xdesign-bundle-{}", ulid::Ulid::new())));
        directory(&draft.0).unwrap();
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":520,"height":32,"background":"white"}),
            )
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        let v1 = ulid::Ulid::new().to_string();
        let bytes = photocraft_format::save_to_bytes(&before, &Default::default()).unwrap();
        write(&draft.0, &v1, &bytes).unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[8,8],[12,8]],"size":4,"color":"#ff0000"}),
            )
            .unwrap();
        let after = engine.active().unwrap().doc.clone();
        let v2 = ulid::Ulid::new().to_string();
        write(
            &draft.0,
            &v2,
            &photocraft_format::save_to_bytes(&after, &Default::default()).unwrap(),
        )
        .unwrap();
        let first = draft.0.join(format!("{v1}.pcraft"));
        let second = draft.0.join(format!("{v2}.pcraft"));
        let reload = |path: &Path| {
            let doc = photocraft_format::load_path(path).unwrap();
            photocraft_compose::render_reduced(&doc, doc.size.width, doc.size.height).px
        };
        assert_eq!(
            reload(&first),
            photocraft_compose::render_reduced(&before, before.size.width, before.size.height).px
        );
        assert_eq!(
            reload(&second),
            photocraft_compose::render_reduced(&after, after.size.width, after.size.height).px
        );
        let portable = portable_bytes(&second, MAX_BUNDLE).unwrap();
        assert!(photocraft_format::is_pcraft(&portable));
        assert_eq!(
            {
                let doc = photocraft_format::load_from_bytes(&portable).unwrap();
                photocraft_compose::render_reduced(&doc, doc.size.width, doc.size.height).px
            },
            reload(&second)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let shared = entries(&first)
                .unwrap()
                .into_iter()
                .find(|file| {
                    file.parent().unwrap().file_name().unwrap() == "tiles"
                        && second.join(file.strip_prefix(&first).unwrap()).exists()
                })
                .unwrap();
            assert_eq!(
                std::fs::metadata(&shared).unwrap().ino(),
                std::fs::metadata(second.join(shared.strip_prefix(&first).unwrap()))
                    .unwrap()
                    .ino()
            );
        }
        assert!(write(&draft.0, &v1, &bytes)
            .unwrap_err()
            .contains("already exists"));
        assert!(portable_bytes(&second, 16).is_err());
        std::fs::remove_dir_all(&first).unwrap();
        assert_eq!(
            reload(&second),
            photocraft_compose::render_reduced(&after, after.size.width, after.size.height).px
        );
    }
    #[test]
    fn rejects_bad_entries_and_repairs_pool_anchors_without_rewriting_saved_versions() {
        let draft =
            Draft(std::env::temp_dir().join(format!("xdesign-bundle-{}", ulid::Ulid::new())));
        directory(&draft.0).unwrap();
        let version = ulid::Ulid::new().to_string();
        let mut invalid = ZipWriter::new();
        invalid.add("manifest.json", b"{}").unwrap();
        invalid.add("../outside", b"bad").unwrap();
        assert!(write(&draft.0, &version, &invalid.finish().unwrap()).is_err());
        assert!(!draft.0.join(format!("{version}.pcraft")).exists());
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":12,"height":12,"background":"white"}),
            )
            .unwrap();
        let bytes =
            photocraft_format::save_to_bytes(&engine.active().unwrap().doc, &Default::default())
                .unwrap();
        write(&draft.0, &version, &bytes).unwrap();
        let zip = ZipReader::new(&bytes).unwrap();
        let tile = zip
            .entries
            .iter()
            .find(|entry| entry.name.starts_with("tiles/"))
            .unwrap();
        let anchor = draft.0.join(".objects").join(&tile.name);
        std::fs::remove_file(&anchor).unwrap();
        std::fs::write(&anchor, b"bad").unwrap();
        let next = ulid::Ulid::new().to_string();
        write(&draft.0, &next, &bytes).unwrap();
        assert_eq!(
            std::fs::read(&anchor).unwrap(),
            zip.read(tile, MAX_ENTRY).unwrap()
        );
        assert!(photocraft_format::load_path(&draft.0.join(format!("{version}.pcraft"))).is_ok());
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            std::fs::remove_file(&anchor).unwrap();
            symlink(draft.0.join("missing"), &anchor).unwrap();
            assert!(write(&draft.0, &ulid::Ulid::new().to_string(), &bytes).is_err());
        }
    }
}
