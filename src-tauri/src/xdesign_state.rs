use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest,Sha256};
use crate::xdesign_project_imports::{self as imports, Lease, Receipt};
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Serialize)]
pub struct StateWrite {
    pub(crate) key: String,
    pub(crate) value: Option<String>,
}

#[cfg(test)]
fn commit(conn: &mut Connection, writes: &[StateWrite]) -> Result<(), String> {
    commit_with_import(conn,writes,None)
}
pub(crate) fn commit_with_import(conn: &mut Connection, writes: &[StateWrite], lease:Option<&Lease>) -> Result<(), String> {
    if writes.is_empty() || writes.len() > 4 { return Err("Invalid project transaction size".into()); }
    let mut keys = std::collections::HashSet::new();
    let mut bytes = 0usize;
    for write in writes {
        let allowed = write.key == "xdesign.projects" || ["xdesign.project.", "xdesign.fx.", "xdesign.roomGrants."]
            .iter().any(|prefix| write.key.strip_prefix(prefix).is_some_and(|id| ulid::Ulid::from_string(id).is_ok()));
        if !allowed || !keys.insert(write.key.as_str()) { return Err("Invalid project state key".into()); }
        if let Some(value) = &write.value {
            bytes = bytes.saturating_add(value.len());
            if bytes > 64 * 1024 * 1024 { return Err("Project transaction exceeds 64MB".into()); }
            let json: serde_json::Value = serde_json::from_str(value).map_err(|_| "Invalid project JSON")?;
            if write.key == "xdesign.projects" && !json.get("registry").is_some_and(serde_json::Value::is_array) {
                return Err("Invalid project registry".into());
            }
        } else if write.key == "xdesign.projects" { return Err("Project registry cannot be deleted".into()); }
    }
    if !keys.contains("xdesign.projects") { return Err("Project transaction requires its registry".into()); }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let incoming:serde_json::Value=serde_json::from_str(writes.iter().find(|w|w.key=="xdesign.projects").and_then(|w|w.value.as_deref()).ok_or("Project registry is missing")?).map_err(|_|"Invalid project registry")?;
    if let Some(lease)=lease{
        let id=&lease.receipt.project_id;let key=format!("xdesign.project.{id}");let document:serde_json::Value=serde_json::from_str(writes.iter().find(|w|w.key==key).and_then(|w|w.value.as_deref()).ok_or("Project import requires its document")?).map_err(|_|"Invalid project JSON")?;
        if writes.iter().any(|w|w.key!="xdesign.projects"&&w.key!=key&&w.key!=format!("xdesign.roomGrants.{id}")){return Err("Project import contains unrelated writes".into());}
        let digest=format!("{:x}",Sha256::digest(serde_json::to_vec(writes).map_err(|e|e.to_string())?));
        if !imports::authorize(&tx,lease,&document,&digest)?{return Ok(());}
        let entries=incoming["registry"].as_array().ok_or("Invalid project registry")?;let mut seen=std::collections::HashSet::new();
        for entry in entries{let entry_id=entry["id"].as_str().ok_or("Invalid project registry")?;if ulid::Ulid::from_string(entry_id).is_err()||!seen.insert(entry_id){return Err("Invalid project registry identity".into());}}
        if !seen.contains(id.as_str()){return Err("Project import metadata is missing".into());}
        let others:Vec<_>=entries.iter().filter(|entry|entry["id"].as_str()!=Some(id)).cloned().collect();if others!=imports::registry(&tx)?{return Err("The project list changed during import; retry with its current list".into());}
    }
    for id in incoming["registry"].as_array().unwrap().iter().filter_map(|entry|entry["id"].as_str()).chain(writes.iter().filter_map(|write|write.value.as_ref().and_then(|_|write.key.strip_prefix("xdesign.project.")))){
        if imports::has_pending(&tx,id)?&&lease.is_none_or(|lease|lease.receipt.project_id!=id){return Err("Project import requires its original receipt".into());}
    }
    for write in writes {
        if let Some(value) = &write.value {
            tx.execute("INSERT INTO app_state (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![write.key, value])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute("DELETE FROM app_state WHERE key=?1", params![write.key]).map_err(|e| e.to_string())?;
            if let Some(project) = write.key.strip_prefix("xdesign.project.") {
                for prefix in ["xdesign.roomGrants.", "xdesign.roomComments.", "xdesign.roomLibraryPending.", "xdesign.roomImagePending."] {
                    tx.execute("DELETE FROM app_state WHERE key=?1", [format!("{prefix}{project}")]).map_err(|e| e.to_string())?;
                }
                let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='xdesign_checkpoints')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
                if exists { tx.execute("DELETE FROM xdesign_checkpoints WHERE project_id=?1", [project]).map_err(|e| e.to_string())?; }
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn xdesign_state_commit(app: AppHandle, writes: Vec<StateWrite>, import_receipt:Option<Receipt>) -> Result<(), String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("orion.db");
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        let lease=import_receipt.map(|receipt|{
            let root=app.path().app_data_dir().map_err(|e|e.to_string())?.join("assets/xdesign");Lease::open(&root,&receipt,false)
        }).transpose()?;
        commit_with_import(&mut conn, &writes,lease.as_ref())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    fn db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);").unwrap();
        db
    }
    fn write(key: &str, value: Option<&str>) -> StateWrite {
        StateWrite { key: key.into(), value: value.map(String::from) }
    }
    #[test]
    fn creates_and_deletes_document_and_registry_together() {
        let mut db = db();
        let key = format!("xdesign.project.{ID}");
        commit(&mut db, &[write(&key, Some("{\"pages\":[]}")), write("xdesign.projects", Some("{\"registry\":[1]}"))]).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        commit(&mut db, &[write(&key, None), write("xdesign.projects", Some("{\"registry\":[]}"))]).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }
    #[test]
    fn project_deletion_removes_only_its_checkpoints_in_the_registry_transaction() {
        let mut db=db();let key=format!("xdesign.project.{ID}");
        db.execute_batch("CREATE TABLE xdesign_checkpoints(project_id TEXT);").unwrap();
        db.execute("INSERT INTO xdesign_checkpoints(project_id) VALUES (?1),('other')",[ID]).unwrap();
        commit(&mut db,&[write(&key,None),write("xdesign.projects",Some("{\"registry\":[]}"))]).unwrap();
        assert_eq!(db.query_row("SELECT project_id FROM xdesign_checkpoints",[],|row|row.get::<_,String>(0)).unwrap(),"other");
    }
    #[test]
    fn registry_failure_rolls_back_document_creation_and_deletion() {
        let mut db = db();
        let key = format!("xdesign.project.{ID}");
        commit(&mut db, &[write(&key, Some("{\"preserve\":true}")), write("xdesign.projects", Some("{\"registry\":[1]}"))]).unwrap();
        db.execute_batch("CREATE TRIGGER fail_registry BEFORE INSERT ON app_state WHEN NEW.key='xdesign.projects' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;").unwrap();
        assert!(commit(&mut db, &[write(&key, None), write("xdesign.projects", Some("{\"registry\":[]}"))]).unwrap_err().contains("injected write failure"));
        assert_eq!(db.query_row("SELECT value FROM app_state WHERE key=?1", [&key], |r| r.get::<_, String>(0)).unwrap(), "{\"preserve\":true}");
        let new_key = format!("xdesign.fx.{}", ulid::Ulid::new());
        assert!(commit(&mut db, &[write(&new_key, Some("{}")), write("xdesign.projects", Some("{\"registry\":[]}"))]).unwrap_err().contains("injected write failure"));
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
    }
    #[test]
    fn rejects_unrelated_keys_duplicates_and_bad_json_before_writing() {
        let mut db = db();
        for writes in [vec![write("providers", Some("{}"))], vec![write("xdesign.projects", None)],
            vec![write("xdesign.projects", Some("bad"))], vec![write("xdesign.projects", Some("null"))],
            vec![write("xdesign.projects", Some("{\"registry\":[]}")), write("xdesign.projects", Some("{\"registry\":[]}"))],
            vec![write("xdesign.project.not-an-id", Some("{}")), write("xdesign.projects", Some("{}"))]] {
            assert!(commit(&mut db, &writes).is_err());
        }
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
    #[test]
    fn pending_handoff_commits_and_rolls_back_with_its_shared_copy_and_is_deleted_with_it() {
        let mut db = db(); let key = format!("xdesign.project.{ID}"); let pending = format!("xdesign.roomGrants.{ID}");
        let writes = [write(&key, Some("{\"pages\":[]}")), write(&pending, Some("{\"version\":1,\"grants\":[]}")), write("xdesign.projects", Some("{\"registry\":[]}"))];
        db.execute_batch("CREATE TRIGGER fail_registry BEFORE INSERT ON app_state WHEN NEW.key='xdesign.projects' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;").unwrap();
        assert!(commit(&mut db, &writes).is_err()); assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        db.execute_batch("DROP TRIGGER fail_registry;").unwrap(); commit(&mut db, &writes).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 3);
        commit(&mut db, &[write(&key, None), write("xdesign.projects", Some("{\"registry\":[]}"))]).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert!(commit(&mut db, &[write("xdesign.roomGrants.invalid", Some("{}")), write("xdesign.projects", Some("{\"registry\":[]}"))]).is_err());
    }
    #[test]
    fn project_deletion_clears_only_its_pending_comments_libraries_and_images_atomically() {
        let mut db = db(); let key = format!("xdesign.project.{ID}");
        commit(&mut db, &[write(&key, Some("{}")), write("xdesign.projects", Some("{\"registry\":[]}"))]).unwrap();
        for prefix in ["xdesign.roomComments.", "xdesign.roomLibraryPending.", "xdesign.roomImagePending."] {
            db.execute("INSERT INTO app_state VALUES(?1,'original pending')", [format!("{prefix}{ID}")]).unwrap();
            db.execute("INSERT INTO app_state VALUES(?1,'other pending')", [format!("{prefix}other")]).unwrap();
        }
        db.execute_batch("CREATE TRIGGER fail_registry BEFORE INSERT ON app_state WHEN NEW.key='xdesign.projects' BEGIN SELECT RAISE(ABORT,'injected registry failure'); END;").unwrap();
        assert!(commit(&mut db, &[write(&key, None), write("xdesign.projects", Some("{\"registry\":[]}"))]).is_err());
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |row| row.get::<_, i64>(0)).unwrap(), 8);
        db.execute_batch("DROP TRIGGER fail_registry;").unwrap();
        commit(&mut db, &[write(&key, None), write("xdesign.projects", Some("{\"registry\":[]}"))]).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM app_state", [], |row| row.get::<_, i64>(0)).unwrap(), 4);
        assert_eq!(db.query_row("SELECT count(*) FROM app_state WHERE value='other pending'", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
    }
}
