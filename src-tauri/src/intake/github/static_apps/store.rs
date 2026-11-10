use super::*;

pub(super) fn load(conn: &Connection, id: &str) -> Result<StaticCapture, String> {
    id_check(id)?;
    let row: Option<(i64, String, String, String, usize, u64, usize, Option<String>)> = conn.query_row(
        "SELECT schema_version,recipe_id,source_hash,capture_hash,total_bytes,created_at,length(CAST(capture_json AS BLOB)),CASE WHEN length(CAST(capture_json AS BLOB))<=393216 THEN capture_json ELSE NULL END FROM static_app_sources WHERE id=?1",
        [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)),
    ).optional().map_err(|_| "Static source storage unavailable; update the native app and reload")?;
    let (version, recipe, source_hash, capture_hash, total, created, length, json) =
        row.ok_or("Captured source is missing; reload before preparing")?;
    if version != 1 || recipe != RECIPE_ID || length > RECORD_LIMIT {
        return Err(
            "Unsupported captured source version or size; saved data was not changed".into(),
        );
    }
    let capture: StaticCapture =
        serde_json::from_str(&json.ok_or("Captured source exceeds bounds")?)
            .map_err(|_| "Invalid captured source data; saved data was not changed")?;
    validate_capture(&capture)?;
    let s = &capture.summary;
    if s.id != id
        || s.source_hash != source_hash
        || s.capture_hash != capture_hash
        || s.total_bytes != total
        || s.created_at != created
    {
        return Err("Captured source index and bytes disagree; saved data was not changed".into());
    }
    Ok(capture)
}
pub(super) fn list(conn: &Connection) -> Result<Vec<CaptureSummary>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM static_app_sources ORDER BY created_at DESC,id DESC LIMIT 9")
        .map_err(|_| "Static source storage unavailable; update the native app and reload")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|_| "Cannot list captured sources")?
        .collect::<Result<_, _>>()
        .map_err(|_| "Cannot read captured source IDs")?;
    if ids.len() > CAPACITY {
        return Err("Captured source collection exceeds capacity; manual review required".into());
    }
    ids.iter()
        .map(|id| load(conn, id).map(|s| s.summary))
        .collect()
}
pub(super) fn publish(
    conn: &mut Connection,
    capture: &StaticCapture,
) -> Result<CaptureSummary, String> {
    validate_capture(capture)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot start capture publication; previous sources unchanged")?;
    let existing = list(&tx)?;
    if let Some(saved) = existing.iter().find(|s| s.id == capture.summary.id) {
        if saved.capture_hash != capture.summary.capture_hash {
            return Err("Captured source identity conflict; previous sources unchanged".into());
        }
        return Ok(saved.clone());
    }
    if existing.len() >= CAPACITY {
        return Err("Eight sources are saved. Discard a reviewed source before fetching another; nothing was evicted".into());
    }
    let s = &capture.summary;
    let json = serde_json::to_string(capture).map_err(|_| "Cannot encode complete capture")?;
    tx.execute("INSERT INTO static_app_sources(id,schema_version,recipe_id,source_hash,capture_hash,total_bytes,created_at,capture_json) VALUES (?1,1,?2,?3,?4,?5,?6,?7)", params![s.id,s.recipe_id,s.source_hash,s.capture_hash,s.total_bytes,s.created_at,json]).map_err(|_| "Capture publication failed; previous sources unchanged")?;
    tx.commit().map_err(|_| {
        "Capture commit could not be confirmed. Reload saved sources before retrying"
    })?;
    Ok(s.clone())
}
pub(super) fn discard(conn: &mut Connection, id: &str, expected: &str) -> Result<(), String> {
    if !hash_check(expected) {
        return Err("Invalid capture review hash".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot start capture discard")?;
    let capture = load(&tx, id)?;
    if capture.summary.capture_hash != expected {
        return Err("Captured source changed; reload before discarding".into());
    }
    tx.execute(
        "DELETE FROM static_app_sources WHERE id=?1 AND capture_hash=?2",
        params![id, expected],
    )
    .map_err(|_| "Cannot discard source; previous data unchanged")?;
    tx.commit()
        .map_err(|_| "Discard could not be confirmed; reload saved sources")?;
    Ok(())
}
