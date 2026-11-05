use base64::Engine;
use photocraft_engine::{color_cmds::document_profile, doc::Document, Session};
use serde_json::{json, Value};
use std::{io::Read, path::PathBuf};

pub(super) const COMMANDS: [&str; 3] = [
    "edit.assignProfile",
    "edit.convertToProfile",
    "edit.profileInfo",
];
const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_BASE64: usize = MAX_BYTES.div_ceil(3) * 4;
pub(super) const PARAMETER_BYTES: usize = MAX_BASE64 + 8192;

pub(super) fn describe(doc: &Document) -> Value {
    let profile = document_profile(doc);
    json!({"description":profile.description,"colorSpace":format!("{:?}",profile.color_space),"embedded":doc.icc_profile.is_some(),"bytes":doc.icc_profile.as_ref().map_or(0,|data|data.len())})
}

pub(super) fn read(path: &str) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES as u64 {
        return Err("ICC profile import exceeds 16MB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("ICC profile import exceeds 16MB".into());
    }
    Ok(bytes)
}

pub(super) struct Snapshot(PathBuf);
impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
impl Snapshot {
    pub(super) fn new(bytes: &[u8]) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("xdesign-profile-{}", ulid::Ulid::new()));
        std::fs::create_dir(&path).map_err(|error| error.to_string())?;
        let snapshot = Self(path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&snapshot.0, std::fs::Permissions::from_mode(0o700))
                .map_err(|error| error.to_string())?;
        }
        photocraft_format::atomic_write(&snapshot.0.join("profile.icc"), bytes)
            .map_err(|error| error.to_string())?;
        Ok(snapshot)
    }
    pub(super) fn path(&self) -> String {
        self.0.join("profile.icc").to_string_lossy().into_owned()
    }
}

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    if !COMMANDS.contains(&command) {
        return None;
    }
    Some(run(engine, command, params))
}

pub(super) fn run(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
    let mut native = params
        .as_object()
        .ok_or("Invalid profile parameters")?
        .clone();
    let spec = native
        .get("profile")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if spec
        .as_ref()
        .is_some_and(|value| value.len() > 4096 || value.chars().any(char::is_control))
    {
        return Err("Invalid ICC profile path".into());
    }
    let include = native
        .remove("includeData")
        .and_then(|value| value.as_bool())
        == Some(true);
    let data = native.remove("profileData");
    if include && command != "edit.profileInfo" {
        return Err("Profile data can be requested only by profile information".into());
    }
    let path = spec.as_deref().is_some_and(|value| {
        value.to_ascii_lowercase().ends_with(".icc")
            || value.to_ascii_lowercase().ends_with(".icm")
            || value.contains('/')
            || value.contains('\\')
    });
    if data.is_some() && !path {
        return Err("Custom ICC data needs its source profile path".into());
    }
    let bytes = if let Some(data) = data {
        let encoded = data.as_str().ok_or("Invalid ICC profile data")?;
        if encoded.len() > MAX_BASE64 {
            return Err("ICC profile import exceeds 16MB".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid ICC profile data")?;
        if bytes.len() > MAX_BYTES {
            return Err("ICC profile import exceeds 16MB".into());
        }
        Some(bytes)
    } else if path {
        Some(read(spec.as_deref().unwrap())?)
    } else {
        None
    };
    // Native parsing must see the bytes that were admitted, even if the source
    // file changes. The private snapshot also supports a previously chosen file.
    let snapshot = bytes.as_deref().map(Snapshot::new).transpose()?;
    let temporary = snapshot
        .as_ref()
        .map(|value| value.0.join("profile.icc").to_string_lossy().into_owned());
    if let Some(path) = &temporary {
        native.insert("profile".into(), json!(path));
    }
    let start = engine.journal.len();
    let native = Value::Object(native);
    let output = super::color_conversion::execute(engine, command, &native)
        .unwrap_or_else(|| {
            engine
                .execute(command, native)
                .map_err(|error| error.to_string())
        })
        .map_err(|error| match (&temporary, &spec) {
            (Some(path), Some(source)) => error.replace(path, source),
            _ => error,
        });
    if let (Some(path), Some(source)) = (&temporary, &spec) {
        for (id, params) in &mut engine.journal[start..] {
            if id == command && params["profile"].as_str() == Some(path.as_str()) {
                params["profile"] = json!(source);
            }
        }
    }
    let mut output = output?;
    if include {
        if let Some(bytes) = bytes {
            output["profileData"] = json!(base64::engine::general_purpose::STANDARD.encode(bytes));
            output["profileSource"] = json!(spec);
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(depth: u32) -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":16,"depth":depth,"background":"#50a0c080"}),
            )
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[4,4],[16,10]],"color":"#d04080","size":5,"opacity":0.6,"seed":3}),
            )
            .unwrap();
        engine
    }
    #[test]
    fn color_profiles_native_assign_convert_and_info_preserve_expected_pixels_alpha_history() {
        for depth in [8, 16, 32] {
            let mut engine = fixture(depth);
            let source = engine.active().unwrap().doc.clone();
            let pixels = photocraft_compose::render(&source, source.bounds()).px;
            let before = engine.active().unwrap().history.past_len();
            let info = execute(&mut engine, "edit.profileInfo", &json!({}))
                .unwrap()
                .unwrap();
            assert_eq!(info["profile"]["embedded"], false);
            assert_eq!(info["builtins"].as_array().unwrap().len(), 10);
            assert!(std::sync::Arc::ptr_eq(
                &source,
                &engine.active().unwrap().doc
            ));
            assert_eq!(engine.active().unwrap().history.past_len(), before);
            execute(
                &mut engine,
                "edit.assignProfile",
                &json!({"profile":"display-p3"}),
            )
            .unwrap()
            .unwrap();
            let assigned = engine.active().unwrap().doc.clone();
            assert_eq!(
                photocraft_compose::render(&assigned, assigned.bounds()).px,
                pixels
            );
            assert_eq!(describe(&assigned)["embedded"], true);
            assert_eq!(describe(&assigned)["description"], "Display P3");
            assert_eq!(engine.active().unwrap().history.past_len(), before + 1);
            engine.execute("edit.undo", json!({})).unwrap();
            assert_eq!(&*engine.active().unwrap().doc, &*source);
            engine.execute("edit.redo", json!({})).unwrap();
            assert_eq!(&*engine.active().unwrap().doc, &*assigned);
            for intent in ["relative", "perceptual", "saturation", "absolute"] {
                for bpc in [false, true] {
                    let mut actual = Session::new();
                    actual.add_document((*assigned).clone(), None);
                    let mut expected = Session::new();
                    expected.add_document((*assigned).clone(), None);
                    let params = json!({"profile":"srgb","intent":intent,"bpc":bpc,"dither":false});
                    let expected_result = expected
                        .execute("edit.convertToProfile", params.clone())
                        .unwrap();
                    let result = execute(&mut actual, "edit.convertToProfile", &params)
                        .unwrap()
                        .unwrap();
                    assert_eq!(result, expected_result);
                    let doc = &actual.active().unwrap().doc;
                    assert_eq!(&**doc, &*expected.active().unwrap().doc);
                    let converted = photocraft_compose::render(doc, doc.bounds()).px;
                    assert_ne!(converted, pixels);
                    assert!(converted.iter().zip(&pixels).all(|(a, b)| a[3] == b[3]));
                    actual.execute("edit.undo", json!({})).unwrap();
                    assert_eq!(&*actual.active().unwrap().doc, &*assigned);
                    actual.execute("edit.redo", json!({})).unwrap();
                    assert_eq!(
                        &*actual.active().unwrap().doc,
                        &*expected.active().unwrap().doc
                    );
                }
            }
            execute(
                &mut engine,
                "edit.assignProfile",
                &json!({"profile":"none"}),
            )
            .unwrap()
            .unwrap();
            assert_eq!(describe(&engine.active().unwrap().doc)["embedded"], false);
            assert_eq!(
                photocraft_compose::render(&engine.active().unwrap().doc, source.bounds()).px,
                pixels
            );
        }
    }
    #[test]
    fn color_profiles_custom_snapshot_retains_bytes_after_file_replacement_and_source_journal() {
        let root = Snapshot::new(b"placeholder").unwrap();
        let path = root.0.join("picked.icm").to_string_lossy().into_owned();
        let mut source = fixture(16);
        source
            .execute("edit.assignProfile", json!({"profile":"display-p3"}))
            .unwrap();
        let bytes = source
            .active()
            .unwrap()
            .doc
            .icc_profile
            .as_ref()
            .unwrap()
            .as_ref()
            .clone();
        std::fs::write(&path, &bytes).unwrap();
        let mut engine = fixture(16);
        let before = engine.active().unwrap().doc.clone();
        let count = engine.active().unwrap().history.past_len();
        let read = execute(
            &mut engine,
            "edit.profileInfo",
            &json!({"profile":path,"includeData":true}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(read["profileSource"], path);
        assert_eq!(read["profile"]["description"], "Display P3");
        let encoded = read["profileData"].as_str().unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
            bytes
        );
        assert!(std::sync::Arc::ptr_eq(
            &before,
            &engine.active().unwrap().doc
        ));
        assert_eq!(engine.active().unwrap().history.past_len(), count);
        std::fs::write(&path, b"source replaced after preview").unwrap();
        let params = json!({"profile":path,"profileData":encoded});
        execute(&mut engine, "edit.assignProfile", &params)
            .unwrap()
            .unwrap();
        assert_eq!(
            engine
                .active()
                .unwrap()
                .doc
                .icc_profile
                .as_ref()
                .unwrap()
                .as_ref(),
            &bytes
        );
        assert_eq!(engine.journal.last().unwrap().1["profile"], path);
        assert!(engine
            .journal
            .last()
            .unwrap()
            .1
            .get("profileData")
            .is_none());
        std::fs::remove_file(&path).unwrap();
        engine.execute("edit.undo", json!({})).unwrap();
        execute(&mut engine, "edit.convertToProfile", &params)
            .unwrap()
            .unwrap();
        let mut expected = Session::new();
        expected.add_document((*before).clone(), None);
        let oracle = root.0.join("oracle.icc");
        std::fs::write(&oracle, &bytes).unwrap();
        expected
            .execute("edit.convertToProfile", json!({"profile":oracle}))
            .unwrap();
        assert!(
            &*engine.active().unwrap().doc == &*expected.active().unwrap().doc,
            "Snapshot conversion must match native parsing of the same ICC bytes"
        );
        assert_eq!(engine.journal.last().unwrap().1["profile"], path);
    }
    #[test]
    fn color_profiles_reject_invalid_custom_files_data_and_models_without_edits() {
        let root = Snapshot::new(b"placeholder").unwrap();
        let path = root.0.join("large.icc");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_BYTES as u64 + 1).unwrap();
        let mut engine = fixture(8);
        let before = engine.active().unwrap().doc.clone();
        let count = engine.active().unwrap().history.past_len();
        let cases = [
            json!({"profile":path}),
            json!({"profile":"missing.icc"}),
            json!({"profile":root.0}),
            json!({"profile":"invalid.icc","profileData":"***"}),
            json!({"profile":"invalid.icc","profileData":"AA=="}),
            json!({"profile":"srgb","profileData":"AA=="}),
            json!({"profile":"coated-cmyk"}),
            json!({"profile":"bad\n.icc"}),
        ];
        for params in cases {
            assert!(
                execute(&mut engine, "edit.assignProfile", &params)
                    .unwrap()
                    .is_err(),
                "{params}"
            );
            assert!(std::sync::Arc::ptr_eq(
                &before,
                &engine.active().unwrap().doc
            ));
            assert_eq!(engine.active().unwrap().history.past_len(), count);
        }
        assert!(execute(
            &mut engine,
            "edit.profileInfo",
            &json!({"profile":"large.icc","profileData":"A".repeat(MAX_BASE64+1)})
        )
        .unwrap()
        .is_err());
        assert!(execute(
            &mut engine,
            "edit.assignProfile",
            &json!({"profile":"srgb","includeData":true})
        )
        .unwrap()
        .is_err());
        assert!(execute(&mut engine, "edit.profileInfo", &json!([]))
            .unwrap()
            .is_err());
        assert!(execute(&mut engine, "filter.blur.gaussianBlur", &json!({})).is_none());
        assert!(std::sync::Arc::ptr_eq(
            &before,
            &engine.active().unwrap().doc
        ));
    }
    #[test]
    fn color_profiles_private_staging_is_removed_after_the_lease() {
        let path;
        {
            let snapshot = Snapshot::new(b"admitted bytes").unwrap();
            path = snapshot.0.clone();
            assert_eq!(
                std::fs::read(path.join("profile.icc")).unwrap(),
                b"admitted bytes"
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                    0o700
                );
            }
        }
        assert!(!path.exists());
    }
}
