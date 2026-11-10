use super::*;
use photocraft_engine::Session;
use std::sync::Arc;

fn temp() -> Staging {
    let path = std::env::temp_dir().join(format!("xdesign-room-image-test-{}", ulid::Ulid::new()));
    std::fs::create_dir(&path).unwrap(); Staging(path, false)
}
fn engine(depth: u32) -> Session {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":24,"height":24,"background":"#905080","depth":depth})).unwrap();
    engine.execute("layer.new.layer", json!({"name":"Editable paint"})).unwrap();
    engine.execute("paint.stroke", json!({"points":[[8,8]],"size":7,"seed":3})).unwrap(); engine
}
fn photo(root: &Path, engine: &Session) -> Value {
    let id = ulid::Ulid::new().to_string(); let version = ulid::Ulid::new().to_string(); let dir = root.join(&id);
    std::fs::create_dir_all(&dir).unwrap(); let doc = &engine.active().unwrap().doc;
    let pixels = photocraft_compose::thumbnail(doc, 2048);
    let image = photocraft_codecs::Image::from_u8(pixels.width, pixels.height, photocraft_codecs::ChannelLayout::Rgba, pixels.pixels).unwrap();
    let preview = dir.join(format!("{version}.png"));
    std::fs::write(&preview, photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &Default::default()).unwrap()).unwrap();
    let bundle = dir.join(format!("{version}.pcraft"));
    std::fs::write(&bundle, photocraft_format::save_to_bytes(doc, &Default::default()).unwrap()).unwrap();
    json!({"id":id,"version":version,"name":doc.name,"width":doc.size.width,"height":doc.size.height,
        "previewWidth":pixels.width,"previewHeight":pixels.height,"bundlePath":bundle,"previewPath":preview,"originalPath":"/original/authored.psd"})
}
fn fresh() -> String { ulid::Ulid::new().to_string() }
fn parts(bytes: &[u8]) -> (Photo, BTreeMap<String, Vec<u8>>) {
    let checked = checked_archive(bytes).unwrap(); (checked.photo, checked.files)
}
fn repack(bytes: &[u8], mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    let zip = ZipReader::new(bytes).unwrap();
    let mut manifest: Value = serde_json::from_slice(&zip.read_by_name("image.json", MAX_METADATA).unwrap()).unwrap();
    mutate(&mut manifest); let mut output = ZipWriter::new();
    output.add("image.json", &serde_json::to_vec(&manifest).unwrap()).unwrap();
    for entry in &zip.entries { if entry.name != "image.json" { output.add(&entry.name, &zip.read_by_name(&entry.name, MAX_TOTAL).unwrap()).unwrap(); } }
    output.finish().unwrap()
}
fn no_staging(root: &Path) { assert!(std::fs::read_dir(root).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with(".room-image-"))); }

#[test]
fn native_float_layers_and_directory_snapshots_roundtrip_under_a_fresh_identity() {
    let temp = temp(); let source = temp.0.join("source"); let target = temp.0.join("target"); std::fs::create_dir(&target).unwrap();
    let engine = engine(32); let input = photo(&source, &engine); let path = Path::new(input["bundlePath"].as_str().unwrap());
    let original = std::fs::read(path).unwrap(); std::fs::remove_file(path).unwrap();
    crate::xdesign_photo::bundle::write(path.parent().unwrap(), input["version"].as_str().unwrap(), &original).unwrap();
    let source_snapshot = crate::xdesign_photo::bundle::portable_bytes(path, MAX_TOTAL).unwrap();
    let prepared = build(&source, &input).unwrap(); let id = fresh(); let result = import(&prepared.bytes, &target, &id, &prepared.info).unwrap();
    assert_eq!(result.photo["id"], id); assert_eq!(result.photo["originalPath"], Value::Null);
    assert_eq!(result.photo["version"], input["version"]); assert_eq!(result.info.archive_digest, digest(&prepared.bytes));
    let restored = photocraft_format::load_path(Path::new(result.photo["bundlePath"].as_str().unwrap())).unwrap();
    let before = &engine.active().unwrap().doc; assert_eq!(restored.id, before.id); assert_eq!(restored.mode, before.mode); assert_eq!(restored.depth, before.depth);
    assert_eq!(photocraft_compose::render(&restored, restored.bounds()).px, photocraft_compose::render(before, before.bounds()).px);
    assert!(restored.walk().iter().any(|(_, _, layer)| layer.name == "Editable paint"));
    assert_eq!(crate::xdesign_photo::bundle::portable_bytes(path, MAX_TOTAL).unwrap(), source_snapshot);
    assert_eq!(input["originalPath"], "/original/authored.psd"); no_staging(&source); no_staging(&target);
}

#[test]
fn nested_linked_smart_objects_embed_without_modifying_or_requiring_original_sources() {
    let temp = temp(); let source = temp.0.join("source"); let target = temp.0.join("target"); std::fs::create_dir(&target).unwrap();
    let child_file = temp.0.join("child.pcraft"); let parent_file = temp.0.join("parent.pcraft");
    let mut child = engine(16); child.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
    child.execute("layer.smartObjects.convertToLinked", json!({"path":child_file})).unwrap();
    let mut parent = engine(16); parent.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
    let id = parent.active().unwrap().active_layer.unwrap();
    let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut parent.active_mut().unwrap().doc).layer_mut(id).unwrap().content else { panic!() };
    smart.source = SmartSource::Embedded { file_name: "child.pcraft".into(), bytes: Arc::new(photocraft_format::save_to_bytes(&child.active().unwrap().doc, &Default::default()).unwrap()) };
    parent.execute("layer.smartObjects.convertToLinked", json!({"path":parent_file})).unwrap();
    let input = photo(&source, &parent); let original = std::fs::read(input["bundlePath"].as_str().unwrap()).unwrap();
    let prepared = build(&source, &input).unwrap(); std::fs::remove_file(child_file).unwrap(); std::fs::remove_file(parent_file).unwrap();
    let result = import(&prepared.bytes, &target, &fresh(), &prepared.info).unwrap();
    let restored = photocraft_format::load_path(Path::new(result.photo["bundlePath"].as_str().unwrap())).unwrap();
    for (_, _, layer) in restored.walk() { if let LayerContent::Smart(smart) = &layer.content { assert!(matches!(smart.source, SmartSource::Embedded { .. })); } }
    assert_eq!(std::fs::read(input["bundlePath"].as_str().unwrap()).unwrap(), original); no_staging(&target);
}

#[test]
fn remote_current_nested_and_historical_links_are_refused_before_local_publication() {
    let temp = temp(); let source = temp.0.join("source"); let target = temp.0.join("target"); std::fs::create_dir(&target).unwrap();
    let input = photo(&source, &engine(8)); let prepared = build(&source, &input).unwrap();
    for nested in [false, true] {
        let mut malicious = engine(8); malicious.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        let id = malicious.active().unwrap().active_layer.unwrap();
        let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut malicious.active_mut().unwrap().doc).layer_mut(id).unwrap().content else { panic!() };
        smart.source = SmartSource::Linked { path: "/not-an-authorized-local-source.pcraft".into() };
        let mut bytes = photocraft_format::save_to_bytes(&malicious.active().unwrap().doc, &Default::default()).unwrap();
        if nested {
            let mut outer = engine(8); outer.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
            let id = outer.active().unwrap().active_layer.unwrap();
            let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut outer.active_mut().unwrap().doc).layer_mut(id).unwrap().content else { panic!() };
            smart.source = SmartSource::Embedded { file_name: "nested.pcraft".into(), bytes: Arc::new(bytes) };
            bytes = photocraft_format::save_to_bytes(&outer.active().unwrap().doc, &Default::default()).unwrap();
        }
        let (photo, mut files) = parts(&prepared.bytes); files.insert(format!("{}.pcraft", photo.version), bytes);
        let bad = archive(photo, files).unwrap(); let id = fresh();
        assert!(import(&bad, &target, &id, &prepared.info).err().unwrap().contains("embed every smart-object source")); assert!(!target.join(id).exists());
    }
    let (photo, mut files) = parts(&prepared.bytes); let old = fresh();
    let mut malicious = engine(8); malicious.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
    let id = malicious.active().unwrap().active_layer.unwrap();
    let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut malicious.active_mut().unwrap().doc).layer_mut(id).unwrap().content else { panic!() };
    smart.source = SmartSource::Linked { path: "/historical-local-source.pcraft".into() };
    files.insert(format!("{old}.pcraft"), photocraft_format::save_to_bytes(&malicious.active().unwrap().doc, &Default::default()).unwrap());
    assert!(checked_archive(&archive(photo, files).unwrap()).err().unwrap().contains("embed every smart-object source")); no_staging(&target);
}

#[test]
fn unknown_versions_fields_paths_extra_snapshots_and_wrong_dimensions_are_refused() {
    let temp = temp(); let input = photo(&temp.0, &engine(8)); let prepared = build(&temp.0, &input).unwrap();
    let changes: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        Box::new(|m| m["version"] = json!(2)), Box::new(|m| m["credential"] = json!("secret")),
        Box::new(|m| m["photo"]["bundlePath"] = json!("/local/file")), Box::new(|m| m["photo"]["width"] = json!(25)),
        Box::new(|m| m["photo"]["previewWidth"] = json!(23)), Box::new(|m| m["files"][0]["name"] = json!("../owned.pcraft")),
        Box::new(|m| m["files"][0]["sha256"] = json!("F".repeat(64))), Box::new(|m| m["files"][0]["bytes"] = json!(MAX_TOTAL + 1))];
    for change in changes { assert!(checked_archive(&repack(&prepared.bytes, change)).is_err()); }
    let (photo, mut files) = parts(&prepared.bytes); let current = files[&format!("{}.pcraft", photo.version)].clone();
    files.insert(format!("{}.pcraft", fresh()), current); assert!(checked_archive(&archive(photo, files).unwrap()).is_err());
    let zip = ZipReader::new(&prepared.bytes).unwrap(); let mut duplicate = ZipWriter::new();
    for entry in &zip.entries { duplicate.add(&entry.name, &zip.read_by_name(&entry.name, MAX_TOTAL).unwrap()).unwrap(); }
    duplicate.add("image.json", b"{}").unwrap(); assert!(checked_archive(&duplicate.finish().unwrap()).is_err());
}

#[test]
fn preview_corruption_missing_history_and_changed_review_keep_destinations_and_originals() {
    let temp = temp(); let input = photo(&temp.0, &engine(16)); let prepared = build(&temp.0, &input).unwrap();
    for mismatch in ["archive", "preview", "bytes", "chunk", "name"] {
        let mut expected = prepared.info.clone(); match mismatch {
            "archive" => expected.archive_digest = "0".repeat(64), "preview" => expected.preview_digest = "0".repeat(64),
            "bytes" => expected.archive_bytes += 1, "chunk" => expected.chunk_digests[0] = "0".repeat(64), _ => expected.name = "Changed review".into(),
        }
        let id = fresh(); assert!(import(&prepared.bytes, &temp.0, &id, &expected).is_err()); assert!(!temp.0.join(id).exists());
    }
    let (photo, mut files) = parts(&prepared.bytes); files.insert(format!("{}.png", photo.version), b"not a png".to_vec());
    assert!(checked_archive(&archive(photo, files).unwrap()).is_err());
    let (photo, mut files) = parts(&prepared.bytes); files.remove(&format!("{}.pcraft", photo.version));
    assert!(checked_archive(&archive(photo, files).unwrap()).is_err());
    let original = std::fs::read(input["bundlePath"].as_str().unwrap()).unwrap();
    assert!(import(&prepared.bytes, &temp.0, input["id"].as_str().unwrap(), &prepared.info).is_err());
    assert_eq!(std::fs::read(input["bundlePath"].as_str().unwrap()).unwrap(), original); no_staging(&temp.0);
}

#[test]
fn concurrent_imports_and_uncertain_reservations_cannot_overwrite_accepted_images() {
    let temp = temp(); let input = photo(&temp.0, &engine(8)); let prepared = build(&temp.0, &input).unwrap(); let id = fresh();
    let results = std::thread::scope(|scope| {
        let first = scope.spawn(|| import(&prepared.bytes, &temp.0, &id, &prepared.info));
        let second = scope.spawn(|| import(&prepared.bytes, &temp.0, &id, &prepared.info));
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    let accepted = std::fs::read(temp.0.join(&id).join(format!("{}.pcraft", input["version"].as_str().unwrap()))).unwrap();
    assert!(import(&prepared.bytes, &temp.0, &id, &prepared.info).is_err());
    assert_eq!(std::fs::read(temp.0.join(&id).join(format!("{}.pcraft", input["version"].as_str().unwrap()))).unwrap(), accepted);
    let uncertain = fresh(); let marker = temp.0.join(format!(".room-image-{uncertain}.reserve")); std::fs::write(&marker, b"uncertain").unwrap();
    assert!(import(&prepared.bytes, &temp.0, &uncertain, &prepared.info).is_err()); assert!(!temp.0.join(&uncertain).exists()); assert_eq!(std::fs::read(&marker).unwrap(), b"uncertain");
    std::fs::remove_file(marker).unwrap(); no_staging(&temp.0);
}

#[test]
fn nested_dependency_budget_and_depth_are_enforced_and_local_links_are_never_followed_on_import() {
    let temp = temp(); let input = photo(&temp.0, &engine(8)); let current = std::fs::read(input["bundlePath"].as_str().unwrap()).unwrap();
    let mut remaining = MAX_TOTAL;
    assert!(validate_native(&current, 0, &mut 1).is_err()); assert!(validate_native(&current, 9, &mut remaining).is_err());
    let mut nested = current;
    for _ in 0..10 {
        let mut outer = engine(8); outer.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap(); let id = outer.active().unwrap().active_layer.unwrap();
        let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut outer.active_mut().unwrap().doc).layer_mut(id).unwrap().content else { panic!() };
        smart.source = SmartSource::Embedded { file_name: "nested.pcraft".into(), bytes: Arc::new(nested) };
        nested = photocraft_format::save_to_bytes(&outer.active().unwrap().doc, &Default::default()).unwrap();
    }
    assert!(validate_native(&nested, 0, &mut remaining).is_err());
    #[cfg(unix)] {
        let preview = Path::new(input["previewPath"].as_str().unwrap()); let bytes = std::fs::read(preview).unwrap(); let external = temp.0.join("external.png");
        std::fs::write(&external, &bytes).unwrap(); std::fs::remove_file(preview).unwrap(); std::os::unix::fs::symlink(&external, preview).unwrap();
        assert!(build(&temp.0, &input).is_err()); assert_eq!(std::fs::read(external).unwrap(), bytes);
    }
}

#[test]
fn cancellation_after_native_validation_and_reservation_prevents_publication_and_cleans_owned_staging() {
    let temp = temp(); let input = photo(&temp.0, &engine(8)); let prepared = build(&temp.0, &input).unwrap(); let id = fresh(); let mut calls = 0;
    let error = import_guarded(&prepared.bytes,&temp.0,&id,&prepared.info,&mut || { calls += 1; if calls == 4 { Err("Cancelled before publication".into()) } else { Ok(()) } }).err().unwrap();
    assert_eq!(error,"Cancelled before publication"); assert_eq!(calls,4); assert!(!temp.0.join(&id).exists()); no_staging(&temp.0);
    assert!(import(&prepared.bytes,&temp.0,&id,&prepared.info).is_ok());
}

#[test]
fn native_import_recovery_validates_original_files_without_republishing_or_changing_the_source() {
    let temp = temp(); let input = photo(&temp.0,&engine(16)); let prepared = build(&temp.0,&input).unwrap(); let id = fresh();
    let accepted = import(&prepared.bytes,&temp.0,&id,&prepared.info).unwrap();
    assert_eq!(recover_import(&prepared.bytes,&temp.0,&id,&prepared.info).unwrap().photo,accepted.photo);
    assert!(recover_import(&prepared.bytes,&temp.0,input["id"].as_str().unwrap(),&prepared.info).is_err());
    let path = Path::new(accepted.photo["bundlePath"].as_str().unwrap()); let mut changed = std::fs::read(path).unwrap(); changed[0] ^= 1; std::fs::write(path,&changed).unwrap();
    assert!(recover_import(&prepared.bytes,&temp.0,&id,&prepared.info).err().unwrap().contains("changed or damaged")); assert_eq!(std::fs::read(path).unwrap(),changed); no_staging(&temp.0);
}
