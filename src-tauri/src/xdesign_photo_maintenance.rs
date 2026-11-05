//! Compaction runs under the startup gate and process lease, before images open.
use super::*;
use photocraft_format::atomic::{AtomicFs, RealFs};
use serde::Deserialize;

const REQUEST: &str = ".compact-request.json";
const RESULT: &str = ".compact-result.json";
fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u32,
    id: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Outcome {
    schema_version: u32,
    status: String,
    versions: u64,
    converted: u64,
    relinked: u64,
    recovered: u64,
    before_bytes: u64,
    after_bytes: u64,
    error: Option<String>,
}
fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    use std::io::Read;
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 64 * 1024 {
        return Err("Invalid image maintenance record".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 {
        return Err("Image maintenance record exceeds 64KB".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
fn pending(root: &Path) -> Result<bool, String> {
    let path = root.join(REQUEST);
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    let request: Request = read(&path)?;
    super::super::id(&request.id)?;
    if request.schema_version != 1 {
        return Err("Unsupported image maintenance request".into());
    }
    Ok(true)
}
pub(super) fn schedule(root: &Path, enabled: bool) -> Result<bool, String> {
    let _lock = lock()
        .lock()
        .map_err(|_| "Image maintenance needs a restart")?;
    let _ = pending(root)?;
    if enabled {
        photocraft_format::atomic_write(
            &root.join(REQUEST),
            &serde_json::to_vec(&Request {
                schema_version: 1,
                id: ulid::Ulid::new().to_string(),
            })
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    } else if root.join(REQUEST).exists() {
        std::fs::remove_file(root.join(REQUEST)).map_err(|e| e.to_string())?;
        RealFs.sync_dir(root).map_err(|e| e.to_string())?;
    }
    Ok(enabled)
}
pub(super) fn attach(root: &Path, report: &mut StorageReport) -> Result<(), String> {
    report.compaction_pending = pending(root)?;
    if std::fs::symlink_metadata(root.join(RESULT)).is_ok() {
        let outcome: Outcome = read(&root.join(RESULT))?;
        if outcome.schema_version != 1
            || !["completed", "failed"].contains(&outcome.status.as_str())
            || outcome.error.as_ref().is_some_and(|e| e.len() > 16_384)
        {
            return Err("Invalid image compaction result".into());
        }
        report.compaction = Some(outcome);
    }
    Ok(())
}
fn photos(root: &Path, imports:&crate::xdesign_project_imports::MaintenanceProtection) -> Result<Vec<PathBuf>, String> {
    let mut photos = Vec::new();
    if !root.exists() {
        return Ok(photos);
    }
    for project in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let project = project.map_err(|e| e.to_string())?;
        if !project.file_type().map_err(|e| e.to_string())?.is_dir()
            || super::super::id(&project.file_name().to_string_lossy()).is_err()
        {
            continue;
        }
        if imports.protects(&project.path(),&project.file_name().to_string_lossy())? {continue;}
        for photo in std::fs::read_dir(project.path()).map_err(|e| e.to_string())? {
            let photo = photo.map_err(|e| e.to_string())?;
            if photo.file_type().map_err(|e| e.to_string())?.is_dir()
                && super::super::id(&photo.file_name().to_string_lossy()).is_ok()
            {
                photos.push(photo.path());
                if photos.len() > 1_000_000 {
                    return Err("Image maintenance exceeds the storage scan limit".into());
                }
            }
        }
    }
    photos.sort();
    Ok(photos)
}
pub(super) fn recover_store(root: &Path, imports:&crate::xdesign_project_imports::MaintenanceProtection) -> Result<u64, String> {
    let mut recovered = 0;
    for photo in photos(root,imports)? {
        recovered += super::super::bundle::compaction::recover(&photo)?;
    }
    Ok(recovered)
}
#[cfg(test)]
pub(super) fn perform(root: &Path, refs: &HashSet<(String, String, String)>) -> Result<(), String> {
    perform_with_imports(root,refs,&Default::default())
}
pub(super) fn perform_with_imports(root: &Path, refs: &HashSet<(String, String, String)>,imports:&crate::xdesign_project_imports::MaintenanceProtection) -> Result<(), String> {
    let _lock = lock()
        .lock()
        .map_err(|_| "Image maintenance needs a restart")?;
    if !pending(root)? {
        return Ok(());
    }
    let mut outcome = Outcome {
        schema_version: 1,
        status: "failed".into(),
        ..Default::default()
    };
    let result = (|| {
        outcome.recovered = recover_store(root,imports)?;
        outcome.before_bytes = scan_with_imports(root, refs,imports, false, SystemTime::now())?.physical_bytes;
        let transfers:HashSet<_>=crate::xdesign_room::image_files::retained_photos(root)?.into_iter().map(|(project,photo,_)|(project,photo)).collect();
        for (project, photo, version) in refs {
            super::super::id(project)?;
            super::super::id(photo)?;
            super::super::id(version)?;
            let file = root
                .join(project)
                .join(photo)
                .join(format!("{version}.pcraft"));
            if !std::fs::symlink_metadata(file).is_ok_and(|meta| {
                (meta.is_file() || meta.is_dir()) && !meta.file_type().is_symlink()
            }) {
                return Err(
                    "A saved image version is missing or invalid; compaction was cancelled".into(),
                );
            }
        }
        let mut plans = Vec::new();
        let mut objects = 0usize;
        for photo in photos(root,imports)? {
            let project_id=photo.parent().and_then(Path::file_name).and_then(|name|name.to_str()).ok_or("Invalid image maintenance project")?;
            let photo_id=photo.file_name().and_then(|name|name.to_str()).ok_or("Invalid image maintenance identity")?;
            // A lost import receipt verifies original bytes before accepting the cached image.
            if transfers.contains(&(project_id.to_owned(),photo_id.to_owned())) {continue;}
            let mut versions = Vec::new();
            for file in std::fs::read_dir(&photo).map_err(|e| e.to_string())? {
                let file = file.map_err(|e| e.to_string())?;
                let name = file.file_name().to_string_lossy().into_owned();
                if let Some(version) = name
                    .strip_suffix(".pcraft")
                    .filter(|version| super::super::id(version).is_ok())
                {
                    versions.push(version.to_owned());
                }
            }
            versions.sort();
            for version in versions {
                let plan = super::super::bundle::compaction::plan(&photo, &version)?;
                objects = objects
                    .checked_add(plan.objects())
                    .filter(|count| *count <= 1_000_000)
                    .ok_or("Image compaction exceeds the storage object scan limit")?;
                plans.push((photo.clone(), plan));
            }
        }
        outcome.versions = plans.len() as u64;
        for (photo, plan) in plans {
            let work = super::super::bundle::compaction::apply(&photo, &plan)?;
            outcome.converted += work.converted;
            outcome.relinked += work.relinked;
        }
        outcome.after_bytes = scan_with_imports(root, refs,imports, false, SystemTime::now())?.physical_bytes;
        outcome.status = "completed".into();
        Ok::<_, String>(())
    })();
    if let Err(error) = &result {
        outcome.error = Some(error.chars().take(4096).collect());
    }
    photocraft_format::atomic_write(
        &root.join(RESULT),
        &serde_json::to_vec(&outcome).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if result.is_ok() {
        std::fs::remove_file(root.join(REQUEST)).map_err(|e| e.to_string())?;
        RealFs.sync_dir(root).map_err(|e| e.to_string())?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;
    struct Temp(PathBuf);
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn temp() -> Temp {
        let root = std::env::temp_dir().join(format!("xdesign-maintenance-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        Temp(root)
    }
    #[test]
    fn history_compaction_schedule_preflight_retains_every_reference_and_reports_shared_storage() {
        let root = temp();
        let project = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        let dir = root.0.join(&project).join(&photo);
        std::fs::create_dir_all(&dir).unwrap();
        let mut s = Session::new();
        s.execute(
            "file.new",
            json!({"width":520,"height":260,"depth":16,"background":"#509080"}),
        )
        .unwrap();
        let bytes = photocraft_format::save_to_bytes(&s.active().unwrap().doc, &Default::default())
            .unwrap();
        let versions = [ulid::Ulid::new().to_string(), ulid::Ulid::new().to_string()];
        for version in &versions {
            std::fs::write(dir.join(format!("{version}.pcraft")), &bytes).unwrap();
        }
        let refs = HashSet::from([(project, photo, versions[0].clone())]);
        schedule(&root.0, true).unwrap();
        perform(&root.0, &refs).unwrap();
        let mut report = scan(&root.0, &refs, false, SystemTime::now()).unwrap();
        attach(&root.0, &mut report).unwrap();
        let outcome = report.compaction.unwrap();
        assert_eq!(outcome.status, "completed");
        assert_eq!(outcome.converted, 2);
        assert_eq!(outcome.versions, 2);
        assert!(outcome.after_bytes < outcome.before_bytes);
        eprintln!(
            "history-compaction-work versions={} converted={} before_bytes={} after_bytes={}",
            outcome.versions, outcome.converted, outcome.before_bytes, outcome.after_bytes
        );
        assert!(!report.compaction_pending);
        assert_eq!(report.versions, 2);
        for version in &versions {
            assert!(dir.join(format!("{version}.pcraft")).is_dir());
        }
        schedule(&root.0, true).unwrap();
        schedule(&root.0, false).unwrap();
        assert!(!pending(&root.0).unwrap());
    }
    #[test]
    fn history_compaction_invalid_reference_or_bundle_refuses_before_any_conversion() {
        let root = temp();
        let project = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        let dir = root.0.join(&project).join(&photo);
        std::fs::create_dir_all(&dir).unwrap();
        let mut s = Session::new();
        s.execute("file.new", json!({"width":16,"height":16}))
            .unwrap();
        let bytes = photocraft_format::save_to_bytes(&s.active().unwrap().doc, &Default::default())
            .unwrap();
        let good = ulid::Ulid::new().to_string();
        let bad = ulid::Ulid::new().to_string();
        std::fs::write(dir.join(format!("{good}.pcraft")), &bytes).unwrap();
        std::fs::write(dir.join(format!("{bad}.pcraft")), b"invalid").unwrap();
        schedule(&root.0, true).unwrap();
        assert!(perform(&root.0, &HashSet::new()).is_err());
        assert_eq!(
            std::fs::read(dir.join(format!("{good}.pcraft"))).unwrap(),
            bytes
        );
        assert!(pending(&root.0).unwrap());
        let outcome: Outcome = read(&root.0.join(RESULT)).unwrap();
        assert_eq!(outcome.converted, 0);
        assert_eq!(outcome.status, "failed");
        assert!(outcome.error.is_some());
        std::fs::remove_file(dir.join(format!("{bad}.pcraft"))).unwrap();
        let missing = HashSet::from([(project, photo, bad)]);
        assert!(perform(&root.0, &missing)
            .unwrap_err()
            .contains("missing or invalid"));
        assert_eq!(
            std::fs::read(dir.join(format!("{good}.pcraft"))).unwrap(),
            bytes
        );
    }
    #[test]
    fn history_compaction_saved_native_past_redo_targets_and_source_ids_survive_conversion() {
        let root = temp();
        let project = ulid::Ulid::new().to_string();
        let photo = ulid::Ulid::new().to_string();
        let dir = root.0.join(&project).join(&photo);
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":48,"height":32,"depth":32,"background":"#405080"}),
            )
            .unwrap();
        let mut session = super::super::super::PhotoSession {
            engine,color_settings:None,
            version: String::new(),
            original_path: None,
            writer: Default::default(),
        };
        super::super::super::publish(&dir, &photo, &mut session).unwrap();
        for index in 0..3 {
            session
                .engine
                .execute(
                    "paint.stroke",
                    json!({"points":[[8+index*8,12]],"size":7,"seed":index+2}),
                )
                .unwrap();
            super::super::super::publish(&dir, &photo, &mut session).unwrap();
        }
        session.engine.execute("edit.undo", json!({})).unwrap();
        super::super::super::publish(&dir, &photo, &mut session).unwrap();
        let history = super::super::super::history::describe(&session.engine);
        let version = session.version.clone();
        let view = std::fs::read(dir.join(format!("{version}.view.json"))).unwrap();
        let mut count = 0;
        for file in std::fs::read_dir(&dir).unwrap() {
            let file = file.unwrap();
            if file.file_type().unwrap().is_dir()
                && file.file_name().to_string_lossy().ends_with(".pcraft")
            {
                let bytes = super::super::super::bundle::portable_bytes(
                    &file.path(),
                    2 * 1024 * 1024 * 1024,
                )
                .unwrap();
                std::fs::remove_dir_all(file.path()).unwrap();
                std::fs::write(file.path(), bytes).unwrap();
                count += 1;
            }
        }
        let refs = HashSet::from([(project, photo, version.clone())]);
        schedule(&root.0, true).unwrap();
        perform(&root.0, &refs).unwrap();
        assert_eq!(
            std::fs::read(dir.join(format!("{version}.view.json"))).unwrap(),
            view
        );
        let outcome: Outcome = read(&root.0.join(RESULT)).unwrap();
        assert_eq!(outcome.converted, count);
        let mut actual = super::super::super::restore(&dir, &version, None).unwrap();
        assert_eq!(
            super::super::super::history::describe(&actual.engine),
            history
        );
        while session.engine.active().unwrap().history.can_undo() {
            session.engine.execute("edit.undo", json!({})).unwrap();
            actual.engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(
                super::super::super::history::describe(&actual.engine),
                super::super::super::history::describe(&session.engine)
            );
        }
        while session.engine.active().unwrap().history.can_redo() {
            session.engine.execute("edit.redo", json!({})).unwrap();
            actual.engine.execute("edit.redo", json!({})).unwrap();
            assert_eq!(
                super::super::super::history::describe(&actual.engine),
                super::super::super::history::describe(&session.engine)
            );
            assert_eq!(
                photocraft_compose::render(
                    &actual.engine.active().unwrap().doc,
                    actual.engine.active().unwrap().doc.bounds()
                )
                .px,
                photocraft_compose::render(
                    &session.engine.active().unwrap().doc,
                    session.engine.active().unwrap().doc.bounds()
                )
                .px
            );
        }
    }
}
