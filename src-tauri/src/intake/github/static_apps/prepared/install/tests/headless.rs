use super::*;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(
    tag = "command",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    Init,
    IntakeStaticList,
    IntakeStaticRead {
        id: String,
        expected_hash: String,
    },
    IntakeStaticDiscard {
        id: String,
        expected_hash: String,
    },
    IntakePreparedList,
    IntakePreparedSave {
        source_id: String,
        expected_capture_hash: String,
        candidate_json: String,
    },
    IntakePreparedRead {
        id: String,
        expected_output_hash: String,
    },
    IntakePreparedDiscard {
        id: String,
        expected_output_hash: String,
    },
    IntakePreparedInstall {
        approval: PreparedApproval,
    },
    Snapshot,
}
fn serialized<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| "Proof response serialization failed".into())
}
fn exchange(root: &Path, request: Request) -> Result<Value, String> {
    let db_path = root.join("headless-core.db");
    let packages = root.join("headless-packages");
    if matches!(request, Request::Init) {
        super::super::super::super::acceptance::new_file(&db_path, &[]);
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&packages).map_err(|e| e.to_string())?;
        let capture: StaticCapture = serde_json::from_slice(
            &std::fs::read(root.join("live-capture.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut db = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
        db.execute_batch(concat!(
            include_str!("../../../../../../../migrations/0032_static_app_sources.sql"),
            include_str!("../../../../../../../migrations/0033_static_app_candidates.sql")
        ))
        .map_err(|e| e.to_string())?;
        super::super::super::super::store::publish(&mut db, &capture)?;
        return Ok(Value::Null);
    }
    let mut db = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    db.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_millis(500))
        .map_err(|e| e.to_string())?;
    match request {
        Request::Init => unreachable!(),
        Request::IntakeStaticList => serialized(super::super::super::super::store::list(&db)?),
        Request::IntakeStaticRead { id, expected_hash } => {
            let captured = super::super::super::super::store::load(&db, &id)?;
            if captured.summary.capture_hash != expected_hash {
                return Err("Captured source changed; reload before preparing".into());
            }
            serialized(captured)
        }
        Request::IntakeStaticDiscard { id, expected_hash } => {
            super::super::super::super::store::discard(&mut db, &id, &expected_hash)?;
            Ok(Value::Null)
        }
        Request::IntakePreparedList => serialized(store::list(&db)?),
        Request::IntakePreparedSave {
            source_id,
            expected_capture_hash,
            candidate_json,
        } => {
            if candidate_json.len() > ENCODED_LIMIT {
                return Err("Prepared bytes exceed encoded bounds".into());
            }
            let candidate: Candidate = serde_json::from_str(&candidate_json)
                .map_err(|_| "Unsupported prepared candidate fields")?;
            serialized(store::save(
                &mut db,
                &source_id,
                &expected_capture_hash,
                candidate,
            )?)
        }
        Request::IntakePreparedRead {
            id,
            expected_output_hash,
        } => {
            let record = store::load(&db, &id)?;
            if record.candidate.output_hash != expected_output_hash {
                return Err("Prepared candidate changed; reload review".into());
            }
            serialized(record)
        }
        Request::IntakePreparedDiscard {
            id,
            expected_output_hash,
        } => {
            store::discard(&mut db, &id, &expected_output_hash)?;
            Ok(Value::Null)
        }
        Request::IntakePreparedInstall { approval } => {
            serialized(publish_at(&packages, &mut db, approval)?)
        }
        Request::Snapshot => {
            let states = std::fs::read_dir(&packages)
                .map_err(|e| e.to_string())?
                .map(|entry| {
                    let path = entry
                        .map_err(|e| e.to_string())?
                        .path()
                        .join(".orion-state.json");
                    serde_json::from_slice::<Value>(
                        &std::fs::read(path).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(
                serde_json::json!({"sources":super::super::super::super::store::list(&db)?,"candidates":store::list(&db)?,"states":states}),
            )
        }
    }
}
#[test]
#[ignore = "Private request/response test transport for headless React-to-native-core acceptance; no GUI, public RPC, provider or source evaluation"]
fn exchange_one_owned_request() {
    let root = super::super::super::super::acceptance::proof_root();
    let id =
        std::env::var("ORION_INTAKE_BRIDGE_ID").expect("Explicit one-shot exchange ID required");
    id_check(&id).unwrap();
    let request_path = root.join(format!("{id}.request.json"));
    assert!(std::fs::metadata(&request_path).unwrap().len() <= 4 * 1024 * 1024);
    let response = match serde_json::from_slice::<Request>(&std::fs::read(request_path).unwrap())
        .map_err(|e| e.to_string())
        .and_then(|r| exchange(&root, r))
    {
        Ok(value) => serde_json::json!({"ok":true,"value":value}),
        Err(error) => serde_json::json!({"ok":false,"error":error}),
    };
    super::super::super::super::acceptance::new_file(
        &root.join(format!("{id}.response.json")),
        &serde_json::to_vec(&response).unwrap(),
    );
}
