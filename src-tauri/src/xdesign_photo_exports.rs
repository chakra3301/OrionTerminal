use photocraft_engine::Session;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const LAYERS_TO_FILES: &str = "file.export.layersToFiles";

/// Layers to Files encodes into a host temp folder first, so a layer that fails to encode leaves
/// the destination folder without a partial set of files.
pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    (command == LAYERS_TO_FILES).then(|| layers_to_files(engine, params))
}

struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn layers_to_files(engine: &mut Session, params: &Value) -> Result<Value, String> {
    let destination = Path::new(params.get("dir").and_then(Value::as_str).filter(|dir| !dir.is_empty()).ok_or("Choose a destination folder")?);
    if !destination.is_dir() { return Err(format!("{} is not a folder", destination.display())); }
    let staging = Staging(std::env::temp_dir().join(format!("xdesign-layers-to-files-{}", ulid::Ulid::new())));
    std::fs::create_dir_all(&staging.0).map_err(|e| e.to_string())?;
    let mut staged = params.clone();
    staged["dir"] = json!(staging.0.to_string_lossy());
    let result = engine.execute(LAYERS_TO_FILES, staged).map_err(|e| e.to_string())?;
    if let Some(entry) = engine.journal.last_mut().filter(|(id, _)| id == LAYERS_TO_FILES) { entry.1 = params.clone(); }
    let mut files = Vec::new();
    for staged in result["files"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        let target = destination.join(Path::new(staged).file_name().ok_or("The exported file has no name")?);
        let bytes = std::fs::read(staged).map_err(|e| format!("{staged}: {e}"))?;
        photocraft_format::atomic_write(&target, &bytes).map_err(|e| format!("{}: {e}", target.display()))?;
        files.push(target.to_string_lossy().into_owned());
    }
    Ok(json!({"files": files}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 8, "height": 6, "depth": 8})).unwrap();
        engine.execute("layer.new.layer", json!({"name": "Ink"})).unwrap();
        engine
    }

    #[test]
    fn layers_to_files_copies_staged_files_into_the_destination() {
        let destination = Staging(std::env::temp_dir().join(format!("layers-to-files-test-{}", ulid::Ulid::new())));
        std::fs::create_dir_all(&destination.0).unwrap();
        let mut engine = session();
        let before = engine.active().unwrap().doc.clone();
        let params = json!({"dir": destination.0.to_string_lossy(), "prefix": "doc", "format": "png"});
        let result = execute(&mut engine, LAYERS_TO_FILES, &params).unwrap().unwrap();
        let files: Vec<&str> = result["files"].as_array().unwrap().iter().map(|file| file.as_str().unwrap()).collect();
        assert_eq!(files.len(), 2, "{files:?}");
        for file in &files {
            assert_eq!(Path::new(file).parent().unwrap(), destination.0);
            assert!(Path::new(file).is_file(), "{file}");
        }
        assert!(files[0].ends_with("doc_0000_Ink.png"), "{files:?}");
        assert!(std::sync::Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        assert_eq!(engine.journal.last().unwrap(), &(LAYERS_TO_FILES.to_string(), params));
        let leftovers = std::fs::read_dir(std::env::temp_dir()).unwrap().filter_map(Result::ok).filter(|entry| entry.file_name().to_string_lossy().starts_with("xdesign-layers-to-files-")).count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn layers_to_files_rejects_a_missing_destination() {
        let mut engine = session();
        let missing = std::env::temp_dir().join(format!("layers-to-files-missing-{}", ulid::Ulid::new()));
        assert!(execute(&mut engine, LAYERS_TO_FILES, &json!({"dir": missing.to_string_lossy()})).unwrap().is_err());
        assert!(!missing.exists());
        assert!(execute(&mut engine, "file.export.colorLookupTables", &json!({})).is_none());
    }
}
