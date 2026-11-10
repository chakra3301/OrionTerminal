use super::*;
use photocraft_engine::Session;
use std::collections::BTreeMap;

const ORIGIN: &str = "https://rooms.example.test";
const DOCUMENT: &str = "image_document_0001";
const MEMBER: &str = "image_member_00001";
struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
struct Fixture {
    temp: Temp,
    project: String,
    photo: Value,
    engine: Session,
}
impl Fixture {
    fn new(depth: u32) -> Self {
        let temp =
            Temp(std::env::temp_dir().join(format!("xdesign-image-files-{}", ulid::Ulid::new())));
        let project = ulid::Ulid::new().to_string();
        let id = ulid::Ulid::new().to_string();
        let version = ulid::Ulid::new().to_string();
        let dir = temp.0.join(&project).join(&id);
        std::fs::create_dir_all(&dir).unwrap();
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":24,"depth":depth,"background":"#905080"}),
            )
            .unwrap();
        engine
            .execute("layer.new.layer", json!({"name":"Editable room paint"}))
            .unwrap();
        engine
            .execute("paint.stroke", json!({"points":[[8,8]],"size":7,"seed":3}))
            .unwrap();
        let doc = &engine.active().unwrap().doc;
        let preview = photocraft_compose::thumbnail(doc, 2048);
        let image = photocraft_codecs::Image::from_u8(
            preview.width,
            preview.height,
            photocraft_codecs::ChannelLayout::Rgba,
            preview.pixels,
        )
        .unwrap();
        let preview_path = dir.join(format!("{version}.png"));
        let bundle_path = dir.join(format!("{version}.pcraft"));
        std::fs::write(
            &preview_path,
            photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &Default::default())
                .unwrap(),
        )
        .unwrap();
        std::fs::write(
            &bundle_path,
            photocraft_format::save_to_bytes(doc, &Default::default()).unwrap(),
        )
        .unwrap();
        let photo = json!({"id":id,"version":version,"name":doc.name,"width":24,"height":24,"previewWidth":24,"previewHeight":24,"bundlePath":bundle_path,"previewPath":preview_path,"originalPath":"/original/authored.psd"});
        Self {
            temp,
            project,
            photo,
            engine,
        }
    }
    fn store(&self, transfer: &str) -> Store {
        Store::new(
            &self.temp.0,
            ORIGIN,
            DOCUMENT,
            MEMBER,
            &self.project,
            transfer,
        )
        .unwrap()
    }
    fn upload(&self) -> (Store, Value) {
        let store = self.store("image_upload_00001");
        let result = store
            .run(
                Action::Prepare {
                    photo: self.photo.clone(),
                },
                &mut || Ok(()),
            )
            .unwrap();
        (store, result)
    }
    fn download(&self) -> Store {
        let (upload, result) = self.upload();
        let info: ArchiveInfo = serde_json::from_value(result["info"].clone()).unwrap();
        let download = self.store("image_download_001");
        download
            .run(
                Action::Stage {
                    manifest: manifest(&info),
                },
                &mut || Ok(()),
            )
            .unwrap();
        for index in 0..info.chunk_digests.len() as u32 {
            let packet = upload.run(Action::Read { index }, &mut || Ok(())).unwrap();
            download
                .run(
                    Action::Put {
                        index,
                        chunk: packet["chunk"].clone(),
                    },
                    &mut || Ok(()),
                )
                .unwrap();
        }
        download
    }
}
fn manifest(info: &ArchiveInfo) -> Value {
    let mut value = json!({"version":1,"kind":"orion.xdesign.image","imageId":"image_document_0001","previousRevisionId":null,
        "name":info.name,"width":info.width,"height":info.height,"previewWidth":info.preview_width,"previewHeight":info.preview_height,
        "archiveBytes":info.archive_bytes,"archiveDigest":info.archive_digest,"previewDigest":info.preview_digest,"chunkDigests":info.chunk_digests});
    revision(&mut value);
    value
}
fn revision(value: &mut Value) {
    let ordered: BTreeMap<_, _> = value
        .as_object()
        .unwrap()
        .iter()
        .filter(|(key, _)| key.as_str() != "revisionId")
        .collect();
    let hash = digest(&serde_json::to_vec(&ordered).unwrap());
    value["revisionId"] = json!(hash);
}
fn chunk(data: &[u8], index: u32) -> Value {
    json!({"version":1,"index":index,"sha256":digest(data),"data":STANDARD.encode(data)})
}
fn opaque(data: &[u8]) -> ArchiveInfo {
    ArchiveInfo {
        name: "Opaque protocol fixture".into(),
        width: 24,
        height: 24,
        preview_width: 24,
        preview_height: 24,
        archive_bytes: data.len(),
        archive_digest: digest(data),
        preview_digest: "0".repeat(64),
        chunk_digests: data.chunks(archive::CHUNK_BYTES).map(digest).collect(),
    }
}
fn run(store: &Store, action: Action) -> Value {
    store.run(action, &mut || Ok(())).unwrap()
}
fn record_path(store: &Store) -> PathBuf {
    store.path(false).unwrap().join("record.json")
}

#[test]
fn file_backed_native_layers_float_pixels_and_original_receipts_reopen_without_duplicate_images() {
    for depth in [8, 16, 32] {
        let fixture = Fixture::new(depth);
        let original = std::fs::read(fixture.photo["bundlePath"].as_str().unwrap()).unwrap();
        let download = fixture.download();
        let accepted = run(&download, Action::Import {});
        let photo = &accepted["photo"];
        assert_eq!(accepted["state"], "imported");
        assert_ne!(photo["id"], fixture.photo["id"]);
        assert_eq!(photo["originalPath"], Value::Null);
        let restored =
            photocraft_format::load_path(Path::new(photo["bundlePath"].as_str().unwrap())).unwrap();
        let source = &fixture.engine.active().unwrap().doc;
        assert_eq!(restored.id, source.id);
        assert_eq!(restored.depth, source.depth);
        assert_eq!(restored.mode, source.mode);
        assert_eq!(
            photocraft_compose::render(&restored, restored.bounds()).px,
            photocraft_compose::render(source, source.bounds()).px
        );
        assert!(restored
            .walk()
            .iter()
            .any(|(_, _, layer)| layer.name == "Editable room paint"));
        let reopened = fixture.store("image_download_001");
        assert_eq!(run(&reopened, Action::Status {}), accepted);
        assert_eq!(run(&reopened, Action::Import {}), accepted);
        assert_eq!(
            std::fs::read(fixture.photo["bundlePath"].as_str().unwrap()).unwrap(),
            original
        );
        let native_dirs = std::fs::read_dir(fixture.temp.0.join(&fixture.project))
            .unwrap()
            .filter(|entry| {
                canonical_id(&entry.as_ref().unwrap().file_name().to_string_lossy()).is_ok()
            })
            .count();
        assert_eq!(native_dirs, 2);
    }
}

#[test]
fn interrupted_out_of_order_chunks_reopen_and_exact_retries_preserve_original_progress() {
    let fixture = Fixture::new(8);
    let store = fixture.store("image_resume_00001");
    let data = vec![37; archive::CHUNK_BYTES * 2 + 73];
    let expected = opaque(&data);
    let packet = manifest(&expected);
    run(
        &store,
        Action::Stage {
            manifest: packet.clone(),
        },
    );
    std::fs::remove_dir(store.path(false).unwrap().join("parts")).unwrap();
    assert_eq!(
        run(
            &store,
            Action::Stage {
                manifest: packet.clone()
            }
        )["received"],
        json!([])
    );
    for index in [2, 0] {
        let start = index as usize * archive::CHUNK_BYTES;
        let end = data.len().min(start + archive::CHUNK_BYTES);
        run(
            &store,
            Action::Put {
                index,
                chunk: chunk(&data[start..end], index),
            },
        );
    }
    let reopened = fixture.store("image_resume_00001");
    assert_eq!(run(&reopened, Action::Status {})["received"], json!([0, 2]));
    assert_eq!(
        run(
            &reopened,
            Action::Put {
                index: 0,
                chunk: chunk(&data[..archive::CHUNK_BYTES], 0)
            }
        )["received"],
        json!([0, 2])
    );
    let mut changed = packet;
    changed["name"] = json!("Changed review");
    revision(&mut changed);
    assert_eq!(
        reopened
            .run(Action::Stage { manifest: changed }, &mut || Ok(()))
            .unwrap_err()
            .status,
        409
    );
    run(
        &reopened,
        Action::Put {
            index: 1,
            chunk: chunk(&data[archive::CHUNK_BYTES..archive::CHUNK_BYTES * 2], 1),
        },
    );
    assert_eq!(
        run(&reopened, Action::Status {})["received"],
        json!([0, 1, 2])
    );
    assert_eq!(
        reopened
            .run(Action::Import {}, &mut || Ok(()))
            .unwrap_err()
            .status,
        422
    );
    assert_eq!(run(&reopened, Action::Status {})["state"], "receiving");
}

#[test]
fn interrupted_preparation_recovers_immutable_bytes_and_refuses_changed_source_or_damage() {
    let fixture = Fixture::new(16);
    let (store, accepted) = fixture.upload();
    let path = record_path(&store);
    let archive_path = store.path(false).unwrap().join("archive.bin");
    let original = std::fs::read(&archive_path).unwrap();
    let mut record = load(&path).unwrap();
    record.phase = Phase::Preparing;
    save(&path, &record).unwrap();
    std::fs::write(
        fixture.photo["bundlePath"].as_str().unwrap(),
        b"source now unavailable",
    )
    .unwrap();
    assert_eq!(
        run(
            &store,
            Action::Prepare {
                photo: fixture.photo.clone()
            }
        ),
        accepted
    );
    let mut changed = fixture.photo.clone();
    changed["name"] = json!("Changed image");
    assert_eq!(
        store
            .run(Action::Prepare { photo: changed }, &mut || Ok(()))
            .unwrap_err()
            .status,
        409
    );
    let mut damaged = original;
    damaged[0] ^= 1;
    std::fs::write(&archive_path, &damaged).unwrap();
    assert_eq!(
        store
            .run(Action::Read { index: 0 }, &mut || Ok(()))
            .unwrap_err()
            .status,
        422
    );
    assert_eq!(std::fs::read(&archive_path).unwrap(), damaged);
}

#[test]
fn lost_import_receipt_recovers_the_original_native_identity_and_refuses_damaged_destination() {
    let fixture = Fixture::new(32);
    let store = fixture.download();
    let accepted = run(&store, Action::Import {});
    let path = record_path(&store);
    let mut record = load(&path).unwrap();
    record.phase = Phase::Importing;
    record.photo = None;
    save(&path, &record).unwrap();
    let refs = retained_photos(&fixture.temp.0).unwrap();
    assert!(refs.contains(&(
        fixture.project.clone(),
        accepted["photo"]["id"].as_str().unwrap().into(),
        accepted["photo"]["version"].as_str().unwrap().into()
    )));
    assert_eq!(
        run(&fixture.store("image_download_001"), Action::Import {}),
        accepted
    );
    record.phase = Phase::Importing;
    record.photo = None;
    save(&path, &record).unwrap();
    let preview = Path::new(accepted["photo"]["previewPath"].as_str().unwrap());
    let mut changed = std::fs::read(preview).unwrap();
    changed[0] ^= 1;
    std::fs::write(preview, &changed).unwrap();
    assert_eq!(
        store
            .run(Action::Import {}, &mut || Ok(()))
            .unwrap_err()
            .status,
        422
    );
    assert_eq!(std::fs::read(preview).unwrap(), changed);
    assert_eq!(load(&path).unwrap().local_id, record.local_id);
}

#[test]
fn cancellation_retains_journals_and_reuses_the_reserved_local_identity_before_publication() {
    let fixture = Fixture::new(8);
    let upload = fixture.store("image_cancel_00001");
    let mut checks = 0;
    let error = upload
        .run(
            Action::Prepare {
                photo: fixture.photo.clone(),
            },
            &mut || {
                checks += 1;
                if checks >= 2 {
                    Err(super::super::cancelled())
                } else {
                    Ok(())
                }
            },
        )
        .unwrap_err();
    assert_eq!(error.status, 499);
    assert_eq!(load(&record_path(&upload)).unwrap().phase, Phase::Preparing);
    run(
        &upload,
        Action::Prepare {
            photo: fixture.photo.clone(),
        },
    );
    let download = fixture.download();
    let path = record_path(&download);
    let error = download
        .run(Action::Import {}, &mut || {
            if load(&path).unwrap().phase == Phase::Importing {
                Err(super::super::cancelled())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
    assert_eq!(error.status, 499);
    let planned = load(&path).unwrap();
    let id = planned.local_id.unwrap();
    assert!(!fixture.temp.0.join(&fixture.project).join(&id).exists());
    assert_eq!(run(&download, Action::Import {})["photo"]["id"], id);
}

#[test]
fn corrupt_record_chunk_or_rehashed_invalid_inventory_is_refused_without_repair() {
    let fixture = Fixture::new(8);
    let (upload, _) = fixture.upload();
    let path = record_path(&upload);
    let original = bytes(&path, MAX_RECORD).unwrap();
    let mut corrupted = original.clone();
    corrupted[0] = b'x';
    std::fs::write(&path, &corrupted).unwrap();
    assert_eq!(
        upload
            .run(Action::Status {}, &mut || Ok(()))
            .unwrap_err()
            .status,
        422
    );
    assert_eq!(std::fs::read(&path).unwrap(), corrupted);
    std::fs::write(&path, &original).unwrap();
    let mut record = load(&path).unwrap();
    record.info.as_mut().unwrap().chunk_digests.clear();
    save(&path, &record).unwrap();
    assert_eq!(
        upload
            .run(Action::Read { index: 0 }, &mut || Ok(()))
            .unwrap_err()
            .status,
        422
    );
    std::fs::write(&path, &original).unwrap();
    let download = fixture.download();
    let part = download.path(false).unwrap().join("parts/0.bin");
    let mut data = std::fs::read(&part).unwrap();
    data[0] ^= 1;
    std::fs::write(&part, &data).unwrap();
    let packet = run(&upload, Action::Read { index: 0 });
    for action in [
        Action::Status {},
        Action::Put {
            index: 0,
            chunk: packet["chunk"].clone(),
        },
        Action::Import {},
    ] {
        assert_eq!(
            download.run(action, &mut || Ok(())).unwrap_err().status,
            422
        );
    }
    assert_eq!(std::fs::read(part).unwrap(), data);
    assert!(retained_photos(&fixture.temp.0).is_ok());
}

#[test]
fn origin_room_member_project_and_transfer_scope_cannot_adopt_a_foreign_receipt() {
    let fixture = Fixture::new(8);
    let (store, accepted) = fixture.upload();
    let original = bytes(&record_path(&store), MAX_RECORD).unwrap();
    let other_project = ulid::Ulid::new().to_string();
    std::fs::create_dir(fixture.temp.0.join(&other_project)).unwrap();
    for (origin, document, member, project, transfer) in [
        (
            "https://other.example.test",
            DOCUMENT,
            MEMBER,
            fixture.project.as_str(),
            "image_upload_00001",
        ),
        (
            ORIGIN,
            "other_document_001",
            MEMBER,
            fixture.project.as_str(),
            "image_upload_00001",
        ),
        (
            ORIGIN,
            DOCUMENT,
            "other_member_0001",
            fixture.project.as_str(),
            "image_upload_00001",
        ),
        (
            ORIGIN,
            DOCUMENT,
            MEMBER,
            other_project.as_str(),
            "image_upload_00001",
        ),
        (
            ORIGIN,
            DOCUMENT,
            MEMBER,
            fixture.project.as_str(),
            "other_transfer_001",
        ),
    ] {
        let other =
            Store::new(&fixture.temp.0, origin, document, member, project, transfer).unwrap();
        let path = other.path(true).unwrap().join("record.json");
        atomic(&path, &original).unwrap();
        assert_eq!(
            other
                .run(
                    Action::Prepare {
                        photo: fixture.photo.clone()
                    },
                    &mut || Ok(())
                )
                .unwrap_err()
                .status,
            422
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    assert_eq!(run(&store, Action::Status {}), accepted);
    assert!(Store::new(
        &fixture.temp.0,
        ORIGIN,
        DOCUMENT,
        MEMBER,
        &fixture.project,
        "../outside"
    )
    .is_err());
    let value = json!({"version":1,"projectId":fixture.project,"memberId":MEMBER,"transferId":"image_request_001","action":{"kind":"status"}});
    assert!(serde_json::from_value::<Operation>(value.clone()).is_ok());
    for field in ["credential", "serverUrl", "documentId"] {
        let mut changed = value.clone();
        changed[field] = json!("outside");
        assert!(serde_json::from_value::<Operation>(changed).is_err());
    }
    let mut changed = value;
    changed["action"]["path"] = json!("/outside");
    assert!(serde_json::from_value::<Operation>(changed).is_err());
}

#[test]
fn independent_file_leases_preserve_the_first_preparation_during_a_competing_request() {
    let fixture = Fixture::new(8);
    let store = fixture.store("image_lease_00001");
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let first_store = fixture.store("image_lease_00001");
    let photo = fixture.photo.clone();
    std::thread::scope(|scope| {
        let first = scope.spawn(move || {
            let mut checks = 0;
            first_store.run(Action::Prepare { photo }, &mut || {
                checks += 1;
                if checks == 2 {
                    ready_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }
                Ok(())
            })
        });
        ready_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let retained = bytes(&record_path(&store), MAX_RECORD).unwrap();
        assert_eq!(
            store
                .run(
                    Action::Prepare {
                        photo: fixture.photo.clone()
                    },
                    &mut || Ok(())
                )
                .unwrap_err()
                .status,
            503
        );
        assert_eq!(bytes(&record_path(&store), MAX_RECORD).unwrap(), retained);
        release_tx.send(()).unwrap();
        assert!(first.join().unwrap().is_ok());
    });
    assert_eq!(run(&store, Action::Status {})["state"], "ready");
}

#[test]
fn aggregate_sparse_cache_limit_refuses_additions_and_preserves_existing_bytes() {
    let fixture = Fixture::new(8);
    let cache = fixture.temp.0.join(&fixture.project).join(CACHE);
    std::fs::create_dir(&cache).unwrap();
    let existing = cache.join("retained.bin");
    let file = std::fs::File::create(&existing).unwrap();
    file.set_len(MAX_CACHE).unwrap();
    let store = fixture.store("image_capacity_001");
    assert_eq!(
        store
            .run(
                Action::Prepare {
                    photo: fixture.photo.clone()
                },
                &mut || Ok(())
            )
            .unwrap_err()
            .status,
        413
    );
    assert_eq!(std::fs::metadata(&existing).unwrap().len(), MAX_CACHE);
    assert!(!store.path(false).unwrap().join("record.json").exists());
    assert!(
        photocraft_format::load_path(Path::new(fixture.photo["bundlePath"].as_str().unwrap()))
            .is_ok()
    );
}

#[test]
fn deleted_or_replaced_project_roots_are_not_recreated_by_late_requests() {
    let fixture = Fixture::new(8);
    let store = fixture.store("image_deleted_0001");
    let project = fixture.temp.0.join(&fixture.project);
    std::fs::rename(&project, fixture.temp.0.join("retained-original-project")).unwrap();
    std::fs::create_dir(&project).unwrap();
    assert_eq!(
        store
            .run(
                Action::Prepare {
                    photo: fixture.photo.clone()
                },
                &mut || Ok(())
            )
            .unwrap_err()
            .status,
        422
    );
    assert!(!project.join(CACHE).exists());
    std::fs::remove_dir(&project).unwrap();
    assert!(store.run(Action::Status {}, &mut || Ok(())).is_err());
    assert!(!project.exists());
}

#[cfg(unix)]
#[test]
fn dangling_cache_and_payload_links_refuse_access_and_cleanup_without_following_sources() {
    let fixture = Fixture::new(8);
    let cache = fixture.temp.0.join(&fixture.project).join(CACHE);
    let outside = fixture.temp.0.join("outside.bin");
    std::os::unix::fs::symlink(&outside, &cache).unwrap();
    assert!(retained_photos(&fixture.temp.0).is_err());
    assert!(fixture
        .store("image_linked_00001")
        .run(
            Action::Prepare {
                photo: fixture.photo.clone()
            },
            &mut || Ok(())
        )
        .is_err());
    assert!(!outside.exists());
    std::fs::remove_file(&cache).unwrap();
    let (store, _) = fixture.upload();
    let path = store.path(false).unwrap().join("archive.bin");
    let original = std::fs::read(&path).unwrap();
    std::fs::write(&outside, &original).unwrap();
    std::fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(&outside, &path).unwrap();
    assert_eq!(
        store
            .run(Action::Read { index: 0 }, &mut || Ok(()))
            .unwrap_err()
            .status,
        422
    );
    assert_eq!(std::fs::read(&outside).unwrap(), original);
}

#[test]
fn missing_transfer_discard_is_scoped_idempotent_and_does_not_recreate_a_cache() {
    let fixture = Fixture::new(8);
    let store = fixture.store("never_issued_transfer_001");
    let first = run(&store, Action::Discard {});
    assert_eq!(first["discarded"], true);
    assert_eq!(first["projectId"], fixture.project);
    assert_eq!(first["documentId"], DOCUMENT);
    assert_eq!(first["memberId"], MEMBER);
    assert_eq!(first, run(&store, Action::Discard {}));
    assert!(!fixture.temp.0.join(&fixture.project).join(CACHE).exists());
    assert!(Path::new(fixture.photo["bundlePath"].as_str().unwrap()).exists());
    std::fs::remove_dir_all(fixture.temp.0.join(&fixture.project)).unwrap();
    assert!(store.run(Action::Discard {}, &mut || Ok(())).is_err());
}
#[test]
fn explicit_transfer_discard_removes_only_its_cache_and_retains_imported_native_artwork() {
    let fixture = Fixture::new(8);
    let download = fixture.download();
    let accepted = run(&download, Action::Import {});
    let path = download.path(false).unwrap();
    let bundle = Path::new(accepted["photo"]["bundlePath"].as_str().unwrap());
    let original = std::fs::read(bundle).unwrap();
    assert_eq!(run(&download, Action::Discard {})["discarded"], true);
    assert_eq!(run(&download, Action::Discard {})["discarded"], true);
    assert!(!path.exists());
    assert_eq!(std::fs::read(bundle).unwrap(), original);
    assert_eq!(
        run(&fixture.store("image_upload_00001"), Action::Status {})["state"],
        "ready"
    );
}
