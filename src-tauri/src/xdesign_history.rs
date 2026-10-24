//! Durable project checkpoints, committed with autosaves in SQLite. Native
//! photo versions remain immutable; restoration copies assets into a new project.
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};

const MAX_DOCUMENT: usize = 64 * 1024 * 1024;
const POOL_BYTES: i64 = 128 * 1024 * 1024;
const AUTO_INTERVAL: i64 = 5 * 60 * 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint { id: String, label: String, created_at: i64, bytes: i64, automatic: bool }

fn identity(id: &str) -> Result<(), String> { ulid::Ulid::from_string(id).map(|_| ()).map_err(|_| "Invalid project checkpoint identity".into()) }
fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(i64::MAX as u128) as i64 }
fn database_path(app: &AppHandle) -> Result<PathBuf, String> { Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("orion.db")) }
fn open(path: PathBuf) -> Result<Connection, String> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    schema(&db)?; Ok(db)
}
fn schema(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS xdesign_checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
        created_at INTEGER NOT NULL, bytes INTEGER NOT NULL, automatic INTEGER NOT NULL, document TEXT NOT NULL, sha256 TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS xdesign_checkpoints_project ON xdesign_checkpoints(project_id,automatic,created_at);")
        .map_err(|e| e.to_string())
}
fn validate(document: &str) -> Result<(), String> {
    if document.len() > MAX_DOCUMENT { return Err("Project checkpoint exceeds 64MB".into()); }
    let doc: serde_json::Value = serde_json::from_str(document).map_err(|_| "Invalid project checkpoint JSON")?;
    if !doc["pages"].is_array() || !doc["activePageId"].is_string() { return Err("Invalid design checkpoint".into()); }
    Ok(())
}
fn insert(db: &Connection, project: &str, document: &str, label: &str, automatic: bool, time: i64) -> Result<Checkpoint, String> {
    let checkpoint = Checkpoint { id: ulid::Ulid::new().to_string(), label: label.into(), created_at: time, bytes: document.len() as i64, automatic };
    db.execute("INSERT INTO xdesign_checkpoints(id,project_id,label,created_at,bytes,automatic,document,sha256) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![checkpoint.id,project,checkpoint.label,time,checkpoint.bytes,automatic,document,format!("{:x}",Sha256::digest(document.as_bytes()))]).map_err(|e| e.to_string())?;
    Ok(checkpoint)
}

fn save(db: &mut Connection, project: &str, document: &str, time: i64) -> Result<(), String> {
    identity(project)?; validate(document)?; schema(db)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO app_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![format!("xdesign.project.{project}"),document]).map_err(|e| e.to_string())?;
    let last: Option<(i64,String)> = {
        let mut stmt = tx.prepare("SELECT created_at,sha256 FROM xdesign_checkpoints WHERE project_id=?1 AND automatic=1 ORDER BY created_at DESC,id DESC LIMIT 1").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([project]).map_err(|e| e.to_string())?;
        rows.next().map_err(|e| e.to_string())?.map(|row| Ok((row.get(0)?,row.get(1)?))).transpose().map_err(|e:rusqlite::Error| e.to_string())?
    };
    if last.as_ref().is_none_or(|(previous, hash)| time.saturating_sub(*previous) >= AUTO_INTERVAL && *hash != format!("{:x}",Sha256::digest(document.as_bytes()))) {
        insert(&tx,project,document,"Autosave",true,time)?;
        let mut stmt=tx.prepare("SELECT id,bytes FROM xdesign_checkpoints WHERE project_id=?1 AND automatic=1 ORDER BY created_at DESC,id DESC").map_err(|e| e.to_string())?;
        let rows=stmt.query_map([project],|row| Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        drop(stmt);
        let mut bytes=0i64;
        for (index,(id,size)) in rows.into_iter().enumerate() { bytes=bytes.saturating_add(size);
            if index>=20 || bytes>POOL_BYTES { tx.execute("DELETE FROM xdesign_checkpoints WHERE id=?1",[id]).map_err(|e| e.to_string())?; }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

fn create(db: &mut Connection, project: &str, document: &str, label: &str, time: i64) -> Result<Checkpoint,String> {
    identity(project)?; validate(document)?; schema(db)?;
    let label=label.trim(); if label.is_empty() || label.len()>256 { return Err("Name the checkpoint using 1–256 bytes".into()); }
    let tx=db.transaction().map_err(|e| e.to_string())?;
    let (count,bytes):(i64,i64)=tx.query_row("SELECT count(*),coalesce(sum(bytes),0) FROM xdesign_checkpoints WHERE project_id=?1 AND automatic=0",[project],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e| e.to_string())?;
    if count>=50 || bytes.saturating_add(document.len() as i64)>POOL_BYTES { return Err("Saved checkpoints have reached 50 versions or 128MB. Delete an older saved checkpoint to create another.".into()); }
    let checkpoint=insert(&tx,project,document,label,false,time)?;
    tx.commit().map_err(|e| e.to_string())?; Ok(checkpoint)
}

fn list(db: &Connection, project: &str) -> Result<Vec<Checkpoint>,String> {
    identity(project)?; schema(db)?;
    let mut stmt=db.prepare("SELECT id,label,created_at,bytes,automatic FROM xdesign_checkpoints WHERE project_id=?1 ORDER BY created_at DESC,id DESC LIMIT 70").map_err(|e| e.to_string())?;
    let rows=stmt.query_map([project],|row|Ok(Checkpoint{id:row.get(0)?,label:row.get(1)?,created_at:row.get(2)?,bytes:row.get(3)?,automatic:row.get(4)?})).map_err(|e| e.to_string())?;
    rows.collect::<Result<_,_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn xdesign_state_save(app:AppHandle,project_id:String,document:String)->Result<(),String> {
    let path=database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move||save(&mut open(path)?,&project_id,&document,now())).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn xdesign_checkpoint_create(app:AppHandle,project_id:String,document:String,label:String)->Result<Checkpoint,String> {
    let path=database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move||create(&mut open(path)?,&project_id,&document,&label,now())).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn xdesign_checkpoint_list(app:AppHandle,project_id:String)->Result<Vec<Checkpoint>,String> {
    let path=database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move||list(&open(path)?,&project_id)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn xdesign_checkpoint_delete(app:AppHandle,project_id:String,checkpoint_id:String)->Result<(),String> {
    identity(&project_id)?;identity(&checkpoint_id)?;let path=database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move||{
        open(path)?.execute("DELETE FROM xdesign_checkpoints WHERE id=?1 AND project_id=?2",params![checkpoint_id,project_id]).map_err(|e|e.to_string())?;Ok(())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn xdesign_checkpoint_restore(app:AppHandle,project_id:String,new_project_id:String,checkpoint_id:String,name:String)->Result<crate::xdesign_archive::ImportedProject,String> {
    identity(&project_id)?;identity(&new_project_id)?;identity(&checkpoint_id)?;
    if project_id==new_project_id {return Err("Restore a checkpoint into a new project".into());}
    let path=database_path(&app)?;let assets=app.path().app_data_dir().map_err(|e|e.to_string())?.join("assets/xdesign");
    tauri::async_runtime::spawn_blocking(move||{
        let db=open(path)?;
        let document:String=db.query_row("SELECT document FROM xdesign_checkpoints WHERE id=?1 AND project_id=?2",params![checkpoint_id,project_id],|row|row.get(0)).map_err(|_|"This project checkpoint is no longer available")?;
        validate(&document)?;
        let archive=crate::xdesign_archive::build_archive(&assets.join(project_id),name,serde_json::from_str(&document).map_err(|e|e.to_string())?)?;
        crate::xdesign_archive::unpack_archive(&archive,&assets.join(new_project_id))
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID:&str="01ARZ3NDEKTSV4RRFFQ69G5FAV";
    fn db()->Connection {let db=Connection::open_in_memory().unwrap();db.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);").unwrap();db}
    fn document(value:i32)->String {format!("{{\"pages\":[],\"activePageId\":\"page\",\"edit\":{value}}}")}
    #[test]
    fn autosaves_and_checkpoints_commit_together_and_skip_unchanged_or_recent_versions() {
        let mut db=db();save(&mut db,ID,&document(1),0).unwrap();save(&mut db,ID,&document(2),100).unwrap();
        assert_eq!(list(&db,ID).unwrap().len(),1);
        save(&mut db,ID,&document(2),AUTO_INTERVAL).unwrap();assert_eq!(list(&db,ID).unwrap().len(),2);
        save(&mut db,ID,&document(2),AUTO_INTERVAL*2).unwrap();assert_eq!(list(&db,ID).unwrap().len(),2);
        db.execute_batch("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON xdesign_checkpoints BEGIN SELECT RAISE(ABORT, 'history disk full'); END;").unwrap();
        assert!(save(&mut db,ID,&document(3),AUTO_INTERVAL*3).unwrap_err().contains("history disk full"));
        assert_eq!(db.query_row("SELECT value FROM app_state",[],|row|row.get::<_,String>(0)).unwrap(),document(2));
    }
    #[test]
    fn prunes_only_automatic_history_and_keeps_named_checkpoints() {
        let mut db=db();create(&mut db,ID,&document(-1),"Milestone",0).unwrap();
        for index in 0..25 {save(&mut db,ID,&document(index),(i64::from(index)+1)*AUTO_INTERVAL).unwrap();}
        let checkpoints=list(&db,ID).unwrap();assert_eq!(checkpoints.len(),21);
        assert_eq!(checkpoints.iter().filter(|row|row.automatic).count(),20);
        assert!(checkpoints.iter().any(|row|row.label=="Milestone"&&!row.automatic));
    }
    #[test]
    fn validates_identity_names_documents_and_manual_limits_without_losing_existing_versions() {
        let mut db=db();
        assert!(create(&mut db,"../escape",&document(1),"Checkpoint",0).is_err());
        assert!(create(&mut db,ID,"null","Checkpoint",0).is_err());
        assert!(create(&mut db,ID,&document(1)," ",0).is_err());
        for index in 0..50 {create(&mut db,ID,&document(index),"Saved",index.into()).unwrap();}
        assert!(create(&mut db,ID,&document(51),"Excess",51).is_err());assert_eq!(list(&db,ID).unwrap().len(),50);
    }
}
