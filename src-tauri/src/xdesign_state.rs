use rusqlite::{params, Connection, OpenFlags};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
pub struct StateWrite {
    key: String,
    value: Option<String>,
}

fn commit(conn: &mut Connection, writes: &[StateWrite]) -> Result<(), String> {
    if writes.is_empty() || writes.len() > 4 { return Err("Invalid project transaction size".into()); }
    let mut keys = std::collections::HashSet::new();
    let mut bytes = 0usize;
    for write in writes {
        let allowed = write.key == "xdesign.projects" || ["xdesign.project.", "xdesign.fx.", "xdesign.model."]
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
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for write in writes {
        if let Some(value) = &write.value {
            tx.execute("INSERT INTO app_state (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![write.key, value])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute("DELETE FROM app_state WHERE key=?1", params![write.key]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn xdesign_state_commit(app: AppHandle, writes: Vec<StateWrite>) -> Result<(), String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("orion.db");
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        commit(&mut conn, &writes)
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
}
