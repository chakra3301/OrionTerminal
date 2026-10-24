//! Storage maintenance retains version identities and raw bundle entries.
//! A durable intent keeps the original ZIP recoverable across file-to-directory replacement.
use super::*;
use photocraft_format::atomic::{AtomicFs, RealFs};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const MAX_INTENT: usize = 32 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    bytes: u64,
    sha256: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Intent {
    schema_version: u32,
    version: String,
    archive_sha256: String,
    entries: BTreeMap<String, Entry>,
}
pub(crate) struct Plan {
    pub version: String,
    intent: Intent,
    legacy: bool,
}
impl Plan {
    pub(crate) fn objects(&self) -> usize {
        self.intent.entries.len()
    }
}
#[derive(Default)]
pub(crate) struct Work {
    pub converted: u64,
    pub relinked: u64,
}
struct Prepared {
    path: PathBuf,
    remove: bool,
}
impl Drop for Prepared {
    fn drop(&mut self) {
        if self.remove {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn record(bytes: &[u8]) -> Entry {
    Entry {
        bytes: bytes.len() as u64,
        sha256: digest(bytes),
    }
}
fn target(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!("{version}.pcraft"))
}
fn marker(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!(".compact-{version}.json"))
}
fn prepared(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!(".compact-{version}.pcraft"))
}
fn backup(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!(".compact-{version}.backup"))
}
fn sync(dir: &Path) -> Result<(), String> {
    RealFs.sync_dir(dir).map_err(|e| e.to_string())
}
fn options() -> photocraft_format::LoadOptions {
    photocraft_format::LoadOptions {
        max_total_bytes: MAX_BUNDLE as u64,
        max_blob_bytes: MAX_ENTRY,
        max_manifest_bytes: MAX_MANIFEST,
        preserve_ids: true,
    }
}
fn validate_document(doc: &photocraft_engine::doc::Document) -> Result<(), String> {
    if doc.size.width == 0
        || doc.size.height == 0
        || u64::from(doc.size.width) * u64::from(doc.size.height) > super::super::MAX_PIXELS
    {
        return Err("Image storage compaction exceeds the 256 megapixel document limit".into());
    }
    Ok(())
}
fn directory_entries(path: &Path) -> Result<BTreeMap<String, Entry>, String> {
    let mut out = BTreeMap::new();
    let mut total = 0usize;
    for file in entries(path)? {
        let name = file
            .strip_prefix(path)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("Invalid image object name")?
            .to_owned();
        let bytes = file_bytes(
            &file,
            if name == "manifest.json" {
                MAX_MANIFEST
            } else {
                MAX_ENTRY
            },
        )?;
        total = total
            .checked_add(bytes.len())
            .filter(|total| *total <= MAX_BUNDLE)
            .ok_or("Image bundle exceeds 2GB during compaction")?;
        out.insert(name, record(&bytes));
    }
    Ok(out)
}
fn archive_entries(bytes: &[u8]) -> Result<BTreeMap<String, Entry>, String> {
    let zip = ZipReader::new(bytes).map_err(|e| e.to_string())?;
    if zip.entries.len() > MAX_ENTRIES || zip.find("manifest.json").is_none() {
        return Err("Invalid image storage archive".into());
    }
    let mut out = BTreeMap::new();
    let mut total = 0usize;
    for entry in &zip.entries {
        if !allowed(&entry.name) || out.contains_key(&entry.name) {
            return Err("Unsupported or repeated image storage archive entry".into());
        }
        let bytes = zip
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
            .checked_add(bytes.len())
            .filter(|total| *total <= MAX_BUNDLE)
            .ok_or("Image archive exceeds 2GB during compaction")?;
        out.insert(entry.name.clone(), record(&bytes));
    }
    Ok(out)
}
pub(crate) fn plan(dir: &Path, version: &str) -> Result<Plan, String> {
    super::super::id(version)?;
    let path = target(dir, version);
    let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("An image compaction source is a symbolic link".into());
    }
    let (legacy, archive_sha256, entries) = if meta.is_file() {
        let bytes = file_bytes(&path, MAX_BUNDLE)?;
        let entries = archive_entries(&bytes)?;
        let doc = photocraft_format::load_from_bytes_with(&bytes, &options())
            .map_err(|e| e.to_string())?;
        validate_document(&doc)?;
        (true, digest(&bytes), entries)
    } else if meta.is_dir() {
        let entries = directory_entries(&path)?;
        let doc =
            photocraft_format::load_path_with(&path, &options()).map_err(|e| e.to_string())?;
        validate_document(&doc)?;
        (false, String::new(), entries)
    } else {
        return Err("Invalid image compaction source".into());
    };
    let intent = Intent {
        schema_version: 1,
        version: version.into(),
        archive_sha256,
        entries,
    };
    if serde_json::to_vec(&intent)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_INTENT
    {
        return Err("Image compaction metadata exceeds 32MB".into());
    }
    Ok(Plan {
        version: version.into(),
        intent,
        legacy,
    })
}
fn read_intent(path: &Path, version: &str) -> Result<Intent, String> {
    let bytes = file_bytes(path, MAX_INTENT)?;
    let intent: Intent = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    super::super::id(&intent.version)?;
    if intent.schema_version != 1
        || intent.version != version
        || !hash(&intent.archive_sha256)
        || intent.entries.len() > MAX_ENTRIES
        || !intent.entries.contains_key("manifest.json")
        || intent.entries.iter().any(|(name, entry)| {
            !allowed(name)
                || !hash(&entry.sha256)
                || entry.bytes
                    > if name == "manifest.json" {
                        MAX_MANIFEST as u64
                    } else {
                        MAX_ENTRY as u64
                    }
        })
        || intent
            .entries
            .values()
            .try_fold(0u64, |sum, e| sum.checked_add(e.bytes))
            .is_none_or(|total| total > MAX_BUNDLE as u64)
    {
        return Err("Invalid image compaction recovery record".into());
    }
    Ok(intent)
}
fn original(path: &Path, intent: &Intent) -> Result<bool, String> {
    Ok(digest(&file_bytes(path, MAX_BUNDLE)?) == intent.archive_sha256)
}
fn complete(path: &Path, intent: &Intent) -> bool {
    directory_entries(path).is_ok_and(|entries| entries == intent.entries)
}
fn remove_prepared(path: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(path).is_ok() {
        entries(path)?;
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn recover(dir: &Path) -> Result<u64, String> {
    if !dir.exists() {
        return Ok(0);
    }
    directory(dir)?;
    let mut versions = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(version) = name
            .strip_prefix(".compact-")
            .and_then(|name| name.strip_suffix(".json"))
        {
            super::super::id(version)?;
            versions.push(version.to_owned());
            if versions.len() > MAX_ENTRIES {
                return Err("Too many interrupted image compactions".into());
            }
        }
    }
    versions.sort();
    let mut recovered = 0;
    for version in versions {
        let intent = read_intent(&marker(dir, &version), &version)?;
        let file = target(dir, &version);
        let old = backup(dir, &version);
        let draft = prepared(dir, &version);
        if std::fs::symlink_metadata(&old).is_ok() {
            if !original(&old, &intent)? {
                return Err("Image compaction backup changed; recovery retained all files".into());
            }
            if complete(&file, &intent) {
                sync(&file)?;
                sync(dir)?;
                std::fs::remove_file(&old).map_err(|e| e.to_string())?;
            } else {
                if std::fs::symlink_metadata(&file).is_ok() {
                    return Err("Interrupted image compaction has an unexpected destination; recovery retained all files".into());
                }
                std::fs::rename(&old, &file).map_err(|e| e.to_string())?;
                sync(dir)?;
            }
        } else if !complete(&file, &intent) && !original(&file, &intent)? {
            return Err("Image compaction source changed; recovery retained all files".into());
        }
        remove_prepared(&draft)?;
        std::fs::remove_file(marker(dir, &version)).map_err(|e| e.to_string())?;
        sync(dir)?;
        recovered += 1;
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(version) = name
            .strip_prefix(".compact-")
            .and_then(|name| name.strip_suffix(".pcraft"))
            .filter(|version| super::super::id(version).is_ok())
        {
            if entry.file_type().map_err(|e| e.to_string())?.is_dir()
                && !marker(dir, version).exists()
                && !backup(dir, version).exists()
            {
                let verified = file_bytes(&target(dir, version), MAX_BUNDLE)
                    .and_then(|bytes| archive_entries(&bytes))
                    .is_ok_and(|original| {
                        directory_entries(&entry.path()).is_ok_and(|draft| draft == original)
                    });
                if verified {
                    remove_prepared(&entry.path())?;
                    sync(dir)?;
                    recovered += 1;
                }
            }
            continue;
        }
        if entry.file_type().map_err(|e| e.to_string())?.is_dir()
            && name
                .strip_suffix(".pcraft")
                .is_some_and(|version| super::super::id(version).is_ok())
        {
            for link in std::fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
                let link = link.map_err(|e| e.to_string())?;
                let name = link.file_name().to_string_lossy().into_owned();
                if name
                    .strip_prefix(".link-")
                    .is_some_and(|id| super::super::id(id).is_ok())
                    && link.file_type().map_err(|e| e.to_string())?.is_file()
                {
                    std::fs::remove_file(link.path()).map_err(|e| e.to_string())?;
                    sync(&entry.path())?;
                    recovered += 1;
                }
            }
        }
    }
    Ok(recovered)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Prepared,
    Intent,
    Backup,
    Published,
    Committed,
}
fn convert(
    dir: &Path,
    plan: &Plan,
    mut hook: impl FnMut(Phase) -> Result<(), String>,
) -> Result<(), String> {
    let file = target(dir, &plan.version);
    let old = backup(dir, &plan.version);
    let draft = prepared(dir, &plan.version);
    let intent_path = marker(dir, &plan.version);
    for path in [&old, &draft, &intent_path] {
        if std::fs::symlink_metadata(path).is_ok() {
            return Err("An earlier image compaction needs recovery".into());
        }
    }
    let bytes = file_bytes(&file, MAX_BUNDLE)?;
    if digest(&bytes) != plan.intent.archive_sha256 {
        return Err("The image changed before compaction".into());
    }
    write_archive(dir, &draft, &bytes)?;
    let mut cleanup = Prepared {
        path: draft.clone(),
        remove: true,
    };
    if !complete(&draft, &plan.intent) {
        return Err("Prepared image compaction failed its entry checks".into());
    }
    hook(Phase::Prepared)?;
    photocraft_format::atomic_write(
        &intent_path,
        &serde_json::to_vec(&plan.intent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    sync(dir)?;
    cleanup.remove = false;
    hook(Phase::Intent)?;
    if !original(&file, &plan.intent)? {
        return Err("The image changed during compaction".into());
    }
    std::fs::rename(&file, &old).map_err(|e| e.to_string())?;
    sync(dir)?;
    hook(Phase::Backup)?;
    std::fs::rename(&draft, &file).map_err(|e| e.to_string())?;
    sync(dir)?;
    hook(Phase::Published)?;
    if !complete(&file, &plan.intent) {
        return Err("Converted image history failed its entry checks".into());
    }
    std::fs::remove_file(&old).map_err(|e| e.to_string())?;
    sync(dir)?;
    hook(Phase::Committed)?;
    std::fs::remove_file(&intent_path).map_err(|e| e.to_string())?;
    sync(dir)
}
fn share_directory(dir: &Path, plan: &Plan) -> Result<u64, String> {
    let file = target(dir, &plan.version);
    if directory_entries(&file)? != plan.intent.entries {
        return Err("The image changed before compaction".into());
    }
    let mut relinked = 0;
    let pool = dir.join(".objects");
    directory(&pool)?;
    for sub in ["tiles", "blobs"] {
        directory(&pool.join(sub))?;
    }
    for (name, expected) in &plan.intent.entries {
        if !name.starts_with("tiles/") && !name.starts_with("blobs/") {
            continue;
        }
        let source = file.join(name);
        let anchor = pool.join(name);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if let (Ok(a), Ok(b)) = (std::fs::metadata(&source), std::fs::metadata(&anchor)) {
                if a.dev() == b.dev() && a.ino() == b.ino() {
                    continue;
                }
            }
        }
        let bytes = file_bytes(&source, MAX_ENTRY)?;
        if record(&bytes) != *expected {
            return Err("Image object changed during compaction".into());
        }
        if std::fs::symlink_metadata(&anchor)
            .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
        {
            return Err("Invalid shared image object during compaction".into());
        }
        if !file_bytes(&anchor, MAX_ENTRY).is_ok_and(|other| other == bytes) {
            photocraft_format::atomic_write(&anchor, &bytes).map_err(|e| e.to_string())?;
        }
        let link = file.join(format!(".link-{}", ulid::Ulid::new()));
        std::fs::hard_link(&anchor, &link).map_err(|e| e.to_string())?;
        if let Err(error) = std::fs::rename(&link, &source) {
            let _ = std::fs::remove_file(link);
            return Err(error.to_string());
        }
        sync(source.parent().ok_or("Invalid image object directory")?)?;
        sync(&file)?;
        relinked += 1;
    }
    if directory_entries(&file)? != plan.intent.entries {
        return Err("Compacted image entries failed verification".into());
    }
    Ok(relinked)
}
pub(crate) fn apply(dir: &Path, plan: &Plan) -> Result<Work, String> {
    let mut out = Work::default();
    if plan.legacy {
        convert(dir, plan, |_| Ok(()))?;
        out.converted = 1;
    } else {
        out.relinked = share_directory(dir, plan)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;
    fn temp() -> Draft {
        let path = std::env::temp_dir().join(format!("xdesign-compaction-{}", ulid::Ulid::new()));
        directory(&path).unwrap();
        Draft(path)
    }
    fn fixture() -> (Session, Vec<u8>) {
        let mut s = Session::new();
        s.execute(
            "file.new",
            json!({"width":520,"height":260,"depth":16,"background":"#409080"}),
        )
        .unwrap();
        s.execute(
            "paint.stroke",
            json!({"points":[[8,8],[20,20]],"size":8,"seed":3}),
        )
        .unwrap();
        let pixel = photocraft_raster::Rgba8Image::new(2, 2);
        let bytes = photocraft_format::save_to_bytes(
            &s.active().unwrap().doc,
            &photocraft_format::SaveOptions {
                thumbnail: Some(pixel.clone()),
                composite: Some(pixel),
            },
        )
        .unwrap();
        (s, bytes)
    }
    #[test]
    fn history_compaction_legacy_entries_previews_ids_and_hardlinks_are_preserved() {
        let dir = temp();
        let (s, bytes) = fixture();
        let a = ulid::Ulid::new().to_string();
        let b = ulid::Ulid::new().to_string();
        for version in [&a, &b] {
            std::fs::write(target(&dir.0, version), &bytes).unwrap();
            let plan = plan(&dir.0, version).unwrap();
            assert_eq!(apply(&dir.0, &plan).unwrap().converted, 1);
            assert_eq!(
                directory_entries(&target(&dir.0, version)).unwrap(),
                archive_entries(&bytes).unwrap()
            );
            let doc =
                photocraft_format::load_path_with(&target(&dir.0, version), &options()).unwrap();
            assert_eq!(doc.id, s.active().unwrap().doc.id);
            assert_eq!(
                photocraft_compose::render(&doc, doc.bounds()).px,
                photocraft_compose::render(
                    &s.active().unwrap().doc,
                    s.active().unwrap().doc.bounds()
                )
                .px
            );
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            for name in directory_entries(&target(&dir.0, &a))
                .unwrap()
                .keys()
                .filter(|name| name.starts_with("tiles/") || name.starts_with("blobs/"))
            {
                assert_eq!(
                    std::fs::metadata(target(&dir.0, &a).join(name))
                        .unwrap()
                        .ino(),
                    std::fs::metadata(target(&dir.0, &b).join(name))
                        .unwrap()
                        .ino()
                );
            }
        }
        assert_eq!(
            apply(&dir.0, &plan(&dir.0, &a).unwrap()).unwrap().converted,
            0
        );
        assert!(recover(&dir.0).unwrap() == 0);
    }
    #[test]
    fn history_compaction_every_interrupted_phase_recovers_a_complete_original_or_converted_version(
    ) {
        for phase in [
            Phase::Prepared,
            Phase::Intent,
            Phase::Backup,
            Phase::Published,
            Phase::Committed,
        ] {
            let dir = temp();
            let (_, bytes) = fixture();
            let version = ulid::Ulid::new().to_string();
            std::fs::write(target(&dir.0, &version), &bytes).unwrap();
            let plan = plan(&dir.0, &version).unwrap();
            assert!(convert(&dir.0, &plan, |at| if at == phase {
                Err("simulated interruption".into())
            } else {
                Ok(())
            })
            .is_err());
            recover(&dir.0).unwrap();
            let file = target(&dir.0, &version);
            let actual = if file.is_dir() {
                directory_entries(&file).unwrap()
            } else {
                archive_entries(&file_bytes(&file, MAX_BUNDLE).unwrap()).unwrap()
            };
            assert_eq!(actual, plan.intent.entries, "{phase:?}");
            assert!(!marker(&dir.0, &version).exists());
            assert!(!backup(&dir.0, &version).exists());
            assert!(!prepared(&dir.0, &version).exists());
            assert!(photocraft_format::load_path_with(&file, &options()).is_ok());
        }
    }
    #[test]
    fn history_compaction_relinks_copied_directory_objects_without_changing_manifest_or_pixels() {
        let dir = temp();
        let (_, bytes) = fixture();
        let version = ulid::Ulid::new().to_string();
        write(&dir.0, &version, &bytes).unwrap();
        let file = target(&dir.0, &version);
        let expected = directory_entries(&file).unwrap();
        for name in expected
            .keys()
            .filter(|name| name.starts_with("tiles/") || name.starts_with("blobs/"))
        {
            let path = file.join(name);
            let bytes = std::fs::read(&path).unwrap();
            photocraft_format::atomic_write(&path, &bytes).unwrap();
        }
        let work = apply(&dir.0, &plan(&dir.0, &version).unwrap()).unwrap();
        assert!(work.relinked > 0);
        assert_eq!(directory_entries(&file).unwrap(), expected);
        let name = expected
            .keys()
            .find(|name| name.starts_with("tiles/"))
            .unwrap();
        let link = file.join(format!(".link-{}", ulid::Ulid::new()));
        std::fs::hard_link(file.join(name), &link).unwrap();
        assert_eq!(recover(&dir.0).unwrap(), 1);
        assert!(!link.exists());
        assert_eq!(directory_entries(&file).unwrap(), expected);
    }

    #[test]
    fn history_compaction_pre_intent_orphan_stage_recovers_without_discarding_unverified_artifacts()
    {
        let dir = temp();
        let (_, bytes) = fixture();
        let version = ulid::Ulid::new().to_string();
        let file = target(&dir.0, &version);
        let draft = prepared(&dir.0, &version);
        std::fs::write(&file, &bytes).unwrap();
        write_archive(&dir.0, &draft, &bytes).unwrap();
        assert!(!marker(&dir.0, &version).exists());
        assert_eq!(recover(&dir.0).unwrap(), 1);
        assert!(!draft.exists());
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
        write_archive(&dir.0, &draft, &bytes).unwrap();
        std::fs::write(draft.join("manifest.json"), b"changed stage").unwrap();
        assert_eq!(recover(&dir.0).unwrap(), 0);
        assert!(draft.exists());
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
        assert!(apply(&dir.0, &plan(&dir.0, &version).unwrap()).is_err());
    }
    #[test]
    fn history_compaction_refuses_changed_sources_corrupt_recovery_and_unsupported_entries() {
        let dir = temp();
        let (_, bytes) = fixture();
        let version = ulid::Ulid::new().to_string();
        let file = target(&dir.0, &version);
        std::fs::write(&file, &bytes).unwrap();
        let plan = plan(&dir.0, &version).unwrap();
        std::fs::write(&file, b"changed").unwrap();
        assert!(apply(&dir.0, &plan).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"changed");
        std::fs::write(&file, &bytes).unwrap();
        assert!(convert(&dir.0, &plan, |at| if at == Phase::Backup {
            Err("stop".into())
        } else {
            Ok(())
        })
        .is_err());
        std::fs::write(backup(&dir.0, &version), b"changed backup").unwrap();
        assert!(recover(&dir.0).is_err());
        assert!(marker(&dir.0, &version).exists());
        assert!(prepared(&dir.0, &version).exists());
        let mut zip = ZipWriter::new();
        zip.add("manifest.json", b"{}").unwrap();
        zip.add("foreign/resource", b"keep").unwrap();
        assert!(archive_entries(&zip.finish().unwrap()).is_err());
    }
}
