use super::*;
pub(super) fn load(conn: &Connection, id: &str) -> Result<PreparedRecord, String> {
    id_check(id)?;
    let row:Option<(String,i64,String,u64,usize,Option<String>)> = conn.query_row("SELECT source_id,schema_version,output_hash,created_at,length(CAST(candidate_json AS BLOB)),CASE WHEN length(CAST(candidate_json AS BLOB))<=3145728 THEN candidate_json ELSE NULL END FROM static_app_candidates WHERE id=?1",[id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(|_| "Prepared storage unavailable; update native app and reload")?;
    let (source_id, version, output, created, length, json) =
        row.ok_or("Prepared candidate missing; reload")?;
    if version != 1 || length > ENCODED_LIMIT {
        return Err("Unsupported prepared version or bounds; stored data unchanged".into());
    }
    let record: PreparedRecord = serde_json::from_str(&json.ok_or("Oversized prepared record")?)
        .map_err(|_| "Invalid saved prepared record; stored data unchanged")?;
    if record.candidate.candidate_id != id
        || record.source.id != source_id
        || record.candidate.output_hash != output
        || record.created_at != created
    {
        return Err("Prepared index/identity mismatch".into());
    }
    let capture = super::super::store::load(conn, &source_id)?;
    summary(&record, &capture)?;
    Ok(record)
}
pub(super) fn list(conn: &Connection) -> Result<Vec<PreparedSummary>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM static_app_candidates ORDER BY created_at DESC,id DESC LIMIT 9")
        .map_err(|_| "Prepared storage unavailable; update native app and reload")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|_| "Cannot list prepared candidates")?
        .collect::<Result<_, _>>()
        .map_err(|_| "Cannot read prepared IDs")?;
    if ids.len() > 8 {
        return Err("Prepared candidate capacity exceeded; manual review required".into());
    }
    ids.iter()
        .map(|id| {
            let record = load(conn, id)?;
            let capture = super::super::store::load(conn, &record.source.id)?;
            summary(&record, &capture)
        })
        .collect()
}
pub(super) fn save(
    conn: &mut Connection,
    source_id: &str,
    expected: &str,
    candidate: Candidate,
) -> Result<PreparedSummary, String> {
    if !hash_check(expected) {
        return Err("Invalid source review hash".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot start candidate save")?;
    let capture = super::super::store::load(&tx, source_id)?;
    if capture.summary.capture_hash != expected {
        return Err("Source changed since preparation; reload".into());
    }
    super::super::store::list(&tx)?;
    let existing = list(&tx)?;
    let record = PreparedRecord {
        schema_version: 1,
        source: capture.summary.clone(),
        created_at: now(),
        candidate,
    };
    let reviewed = summary(&record, &capture)?;
    if let Some(saved) = existing.iter().find(|s| s.id == reviewed.id) {
        if saved.output_hash != reviewed.output_hash
            || saved.source.capture_hash != reviewed.source.capture_hash
        {
            return Err("Prepared identity conflict; previous candidates unchanged".into());
        }
        return Ok(saved.clone());
    }
    if existing.len() >= 8 {
        return Err(
            "Eight prepared candidates are saved. Discard one first; nothing was evicted".into(),
        );
    }
    let encoded = serde_json::to_string(&record).map_err(|_| "Cannot encode prepared bytes")?;
    tx.execute("INSERT INTO static_app_candidates(id,source_id,schema_version,output_hash,created_at,candidate_json) VALUES(?1,?2,1,?3,?4,?5)",params![reviewed.id,source_id,reviewed.output_hash,record.created_at,encoded]).map_err(|_| "Prepared save failed; previous data unchanged")?;
    tx.commit()
        .map_err(|_| "Prepared commit unconfirmed. Reload before retrying")?;
    Ok(reviewed)
}
pub(super) fn discard(conn: &mut Connection, id: &str, expected: &str) -> Result<(), String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot start prepared discard")?;
    let record = load(&tx, id)?;
    if record.candidate.output_hash != expected {
        return Err("Prepared candidate changed since review".into());
    }
    tx.execute(
        "DELETE FROM static_app_candidates WHERE id=?1 AND output_hash=?2",
        params![id, expected],
    )
    .map_err(|_| "Cannot discard prepared candidate")?;
    tx.commit()
        .map_err(|_| "Discard unconfirmed; reload candidates")?;
    Ok(())
}
