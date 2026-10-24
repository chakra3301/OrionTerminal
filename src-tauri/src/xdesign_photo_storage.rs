//! Retain every saved-project/checkpoint/draft reference. Collection runs once,
//! before this process has accessed images, so session-only undo cannot be lost.
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{collections::HashSet, path::{Path,PathBuf}, sync::{Mutex,OnceLock}, time::{Duration,SystemTime}};
use tauri::{AppHandle,Manager};

#[path="xdesign_photo_maintenance.rs"]
mod maintenance;

fn gate()->&'static Mutex<bool> {static GATE:OnceLock<Mutex<bool>>=OnceLock::new();GATE.get_or_init(||Mutex::new(false))}
pub(super) fn touch()->Result<(),String>{*gate().lock().map_err(|_|"Image storage needs to be restarted")?=true;Ok(())}
fn lease(root:&Path)->Result<(),String>{
    static LEASE:OnceLock<Mutex<Option<(PathBuf,std::fs::File)>>>=OnceLock::new();
    let mut lease=LEASE.get_or_init(Default::default).lock().map_err(|_|"Image storage needs to be restarted")?;
    if let Some((path,_))=lease.as_ref(){return if path==root{Ok(())}else{Err("Image storage location changed; restart Orion".into())};}
    std::fs::create_dir_all(root).map_err(|e|e.to_string())?;let path=root.join(".active-process.lock");
    if std::fs::symlink_metadata(&path).is_ok_and(|metadata|!metadata.is_file()||metadata.file_type().is_symlink()){return Err("The image storage lock is invalid".into());}
    let file=std::fs::File::options().read(true).write(true).create(true).truncate(false).open(path).map_err(|e|e.to_string())?;
    file.try_lock().map_err(|_|"Image storage is open in another Orion process; close that process before editing images")?;*lease=Some((root.into(),file));Ok(())
}
pub(super) fn access(root:&Path)->Result<(),String>{touch()?;lease(root)}
pub(super) fn recover_photo(dir:&Path)->Result<(),String>{
    static RECOVERED:OnceLock<Mutex<HashSet<PathBuf>>>=OnceLock::new();let mut recovered=RECOVERED.get_or_init(Default::default).lock().map_err(|_|"Image storage needs a restart")?;
    if !recovered.contains(dir){super::bundle::compaction::recover(dir)?;if recovered.len()>=4096{recovered.clear();}recovered.insert(dir.into());}Ok(())
}

#[derive(Default,Serialize)]
#[serde(rename_all="camelCase")]
pub struct StorageReport {files:u64,bytes:u64,physical_bytes:u64,versions:u64,protected_versions:u64,reclaimed_bytes:u64,reclaimed_files:u64,notes:Vec<String>,compaction_pending:bool,compaction:Option<maintenance::Outcome>}

fn physical_key(path:&Path,metadata:&std::fs::Metadata)->String {
    #[cfg(unix)] {use std::os::unix::fs::MetadataExt;let _=path;format!("{}/{}",metadata.dev(),metadata.ino())}
    #[cfg(not(unix))] {let _=metadata;path.to_string_lossy().into_owned()}
}
fn unlink_bytes(metadata:&std::fs::Metadata)->u64 {
    #[cfg(unix)] {use std::os::unix::fs::MetadataExt;if metadata.nlink()>1{return 0;}}
    metadata.len()
}

fn references(db:&Connection)->Result<HashSet<(String,String,String)>,String> {
    let mut refs=HashSet::new();
    let mut read=|project:&str,document:&str|->Result<(),String>{
        super::id(project)?;if document.len()>64*1024*1024{return Err("Saved project exceeds the storage scan limit".into());}
        let mut doc:Value=serde_json::from_str(document).map_err(|_|"A saved project is invalid; image cleanup was cancelled")?;
        crate::xdesign_archive::visit_photos(&mut doc,|photo|{
            let id=photo["id"].as_str().ok_or("Invalid saved image reference")?;let version=photo["version"].as_str().ok_or("Invalid saved image version")?;
            super::id(id)?;super::id(version)?;refs.insert((project.into(),id.into(),version.into()));Ok(())
        })
    };
    let mut projects=db.prepare("SELECT key,value FROM app_state WHERE key LIKE 'xdesign.project.%'").map_err(|e|e.to_string())?;
    let rows=projects.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
    for row in rows {let (key,document)=row.map_err(|e|e.to_string())?;read(key.strip_prefix("xdesign.project.").ok_or("Invalid project key")?,&document)?;}
    let has_checkpoints:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='xdesign_checkpoints')",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    if has_checkpoints {
        let mut statement=db.prepare("SELECT project_id,document,sha256 FROM xdesign_checkpoints").map_err(|e|e.to_string())?;
        let rows=statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(|e|e.to_string())?;
        for row in rows {let (project,document,hash)=row.map_err(|e|e.to_string())?;if format!("{:x}",Sha256::digest(document.as_bytes()))!=hash {return Err("A checkpoint checksum failed; image cleanup was cancelled".into());}read(&project,&document)?;}
    }
    Ok(refs)
}

#[cfg(test)]
fn scan(root:&Path,refs:&HashSet<(String,String,String)>,collect:bool,time:SystemTime)->Result<StorageReport,String> {
    scan_with_imports(root,refs,&Default::default(),collect,time)
}
fn scan_with_imports(root:&Path,refs:&HashSet<(String,String,String)>,imports:&crate::xdesign_project_imports::MaintenanceProtection,collect:bool,time:SystemTime)->Result<StorageReport,String> {
    let mut report=StorageReport::default();let mut versions=HashSet::new();let mut physical=HashSet::new();
    if !root.exists(){return Ok(report);}
    let mut protected=refs.clone();
    protected.extend(crate::xdesign_room::image_files::retained_photos(root)?);
    // History loads bare snapshot bundles. Expanding only saved project roots
    // avoids retaining the histories of already-trimmed ancestor versions.
    for (project,photo,version) in protected.clone() {
        super::id(&project)?;super::id(&photo)?;super::id(&version)?;
        let path=root.join(&project).join(&photo).join(format!("{version}.view.json"));
        if path.exists(){let view=super::history::persisted::read_view(&path)?;for dependency in super::saved_history_references(&view,&version)?{
            let bundle=root.join(&project).join(&photo).join(format!("{dependency}.pcraft"));
            if !std::fs::symlink_metadata(&bundle).is_ok_and(|metadata|(metadata.is_file()||metadata.is_dir())&&!metadata.file_type().is_symlink()){return Err("A saved native history snapshot is missing or invalid; image cleanup was cancelled".into());}
            protected.insert((project.clone(),photo.clone(),dependency));
            if protected.len()>1_000_000{return Err("Native history references exceed the storage scan limit; image cleanup was cancelled".into());}
        }}
    }
    for project in std::fs::read_dir(root).map_err(|e|e.to_string())? {
        let project=project.map_err(|e|e.to_string())?;let project_id=project.file_name().to_string_lossy().into_owned();
        if !project.file_type().map_err(|e|e.to_string())?.is_dir()||super::id(&project_id).is_err(){continue;}
        let imported=imports.protects(&project.path(),&project_id)?;
        for photo in std::fs::read_dir(project.path()).map_err(|e|e.to_string())? {
            let photo=photo.map_err(|e|e.to_string())?;let photo_id=photo.file_name().to_string_lossy().into_owned();
            if !photo.file_type().map_err(|e|e.to_string())?.is_dir()||super::id(&photo_id).is_err(){continue;}
            for file in std::fs::read_dir(photo.path()).map_err(|e|e.to_string())? {
                let file=file.map_err(|e|e.to_string())?;let kind=file.file_type().map_err(|e|e.to_string())?;if !kind.is_file()&&!kind.is_dir(){continue;}
                let name=file.file_name().to_string_lossy().into_owned();
                if kind.is_dir()&&name.strip_prefix(".pcraft-").is_some_and(|id|super::id(id).is_ok()) {
                    if collect&&!imported&&file.metadata().ok().and_then(|metadata|metadata.modified().ok()).and_then(|modified|time.duration_since(modified).ok()).is_some_and(|age|age>=Duration::from_secs(7*24*60*60)) {
                        let cleanup=(||{
                            let files=super::bundle::staging_entries(&file.path())?;
                            let reclaimed=files.iter().try_fold(0u64,|total,path|{let metadata=std::fs::symlink_metadata(path).map_err(|e|e.to_string())?;total.checked_add(unlink_bytes(&metadata)).ok_or_else(||"Unfinished image save exceeds its cleanup limit".to_owned())})?;
                            std::fs::remove_dir_all(file.path()).map_err(|e|e.to_string())?;
                            Ok::<_,String>((files.len() as u64,reclaimed))
                        })();
                        match cleanup {Ok((files,bytes))=>{report.reclaimed_files+=files;report.reclaimed_bytes=report.reclaimed_bytes.saturating_add(bytes);},Err(error)=>{if report.notes.len()<20{report.notes.push(format!("An unfinished image save was retained: {error}"));}}}
                    }
                    continue;
                }
                let Some(version)=[".pcraft",".png",".view.json"].iter().find_map(|suffix|name.strip_suffix(suffix)).filter(|version|super::id(version).is_ok())else{continue;};
                let identity=(project_id.clone(),photo_id.clone(),version.to_owned());let metadata=file.metadata().map_err(|e|e.to_string())?;
                if kind.is_dir()&&!name.ends_with(".pcraft"){continue;}
                let files=if kind.is_dir(){super::bundle::entries(&file.path())?}else{vec![file.path()]};
                for path in &files {let metadata=std::fs::symlink_metadata(path).map_err(|e|e.to_string())?;report.files+=1;report.bytes=report.bytes.saturating_add(metadata.len());if physical.insert(physical_key(path,&metadata)){report.physical_bytes=report.physical_bytes.saturating_add(metadata.len());}}
                versions.insert(identity.clone());
                if imported { protected.insert(identity.clone()); }
                if collect&&!protected.contains(&identity)&&metadata.modified().ok().and_then(|modified|time.duration_since(modified).ok()).is_some_and(|age|age>=Duration::from_secs(7*24*60*60)) {
                    let reclaim=files.iter().filter_map(|path|std::fs::symlink_metadata(path).ok()).map(|metadata|unlink_bytes(&metadata)).sum::<u64>();
                    let removed=if kind.is_dir(){std::fs::remove_dir_all(file.path())}else{std::fs::remove_file(file.path())};
                    match removed {Ok(())=>{report.reclaimed_files+=files.len() as u64;report.reclaimed_bytes=report.reclaimed_bytes.saturating_add(reclaim);},Err(error)=>{if report.notes.len()<20{report.notes.push(format!("Could not remove an unused image version: {error}"));}}}
                }
                if report.files>1_000_000{return Err("Image storage exceeds the scan limit".into());}
            }
            // A shared object is collectible only when every version link is
            // gone. Saved snapshots therefore protect it without a second index.
            for (sub,suffix) in [(".previews",".png"),(".objects/tiles",".zst"),(".objects/blobs",".zst")] {
                let pool=photo.path().join(sub);if !pool.exists(){continue;}
                let mut directory=photo.path();for part in sub.split('/') {directory.push(part);if std::fs::symlink_metadata(&directory).is_ok_and(|meta|!meta.is_dir()||meta.file_type().is_symlink()){return Err("A shared image directory is invalid".into());}}
                for entry in std::fs::read_dir(pool).map_err(|e|e.to_string())? {let entry=entry.map_err(|e|e.to_string())?;let name=entry.file_name().to_string_lossy().into_owned();let Some(hash)=name.strip_suffix(suffix)else{continue;};if hash.len()!=64||!hash.bytes().all(|b|b.is_ascii_hexdigit())||!entry.file_type().map_err(|e|e.to_string())?.is_file(){continue;}
                    let metadata=entry.metadata().map_err(|e|e.to_string())?;if physical.insert(physical_key(&entry.path(),&metadata)){report.physical_bytes=report.physical_bytes.saturating_add(metadata.len());}
                    #[cfg(unix)] {use std::os::unix::fs::MetadataExt;if collect&&!imported&&metadata.nlink()==1&&metadata.modified().ok().and_then(|modified|time.duration_since(modified).ok()).is_some_and(|age|age>=Duration::from_secs(7*24*60*60))&&std::fs::remove_file(entry.path()).is_ok(){report.reclaimed_files+=1;report.reclaimed_bytes=report.reclaimed_bytes.saturating_add(metadata.len());}}
                    if physical.len()>1_000_000{return Err("Image storage exceeds the scan limit".into());}
                }
            }
        }
    }
    report.versions=versions.len() as u64;report.protected_versions=versions.iter().filter(|version|protected.contains(*version)).count() as u64;Ok(report)
}

pub(super) fn write_preview(dir:&Path,version:&str,png:&[u8])->Result<(),String> {
    let shared=dir.join(".previews");
    if std::fs::symlink_metadata(&shared).is_ok_and(|metadata|!metadata.is_dir()||metadata.file_type().is_symlink()){return Err("The shared preview directory is invalid".into());}
    std::fs::create_dir_all(&shared).map_err(|e|e.to_string())?;
    let hash=format!("{:x}",Sha256::digest(png));let source=shared.join(format!("{hash}.png"));
    if let Ok(metadata)=std::fs::symlink_metadata(&source) {if !metadata.is_file(){return Err("The shared preview destination is not a file".into());}}
    let valid=std::fs::metadata(&source).is_ok_and(|metadata|metadata.len()==png.len() as u64)&&std::fs::read(&source).is_ok_and(|bytes|bytes==png);
    if !valid{photocraft_format::atomic_write(&source,png).map_err(|e|e.to_string())?;}
    let target=dir.join(format!("{version}.png"));
    std::fs::hard_link(source,&target).or_else(|_|photocraft_format::atomic_write(&target,png).map_err(std::io::Error::other)).map_err(|e|e.to_string())
}

fn paths(app:&AppHandle)->Result<(PathBuf,PathBuf),String>{Ok((app.path().app_data_dir().map_err(|e|e.to_string())?.join("assets/xdesign"),app.path().app_config_dir().map_err(|e|e.to_string())?.join("orion.db")))}
pub(super) async fn report(app:AppHandle)->Result<StorageReport,String>{let (root,database)=paths(&app)?;tauri::async_runtime::spawn_blocking(move||{
    let db=Connection::open_with_flags(database,OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e|e.to_string())?;let imports=crate::xdesign_project_imports::maintenance_protection(&db)?;let mut report=scan_with_imports(&root,&references(&db)?,&imports,false,SystemTime::now())?;maintenance::attach(&root,&mut report)?;Ok(report)
}).await.map_err(|e|e.to_string())?}

pub(super) async fn schedule(app:AppHandle,enabled:bool)->Result<bool,String>{let (root,_)=paths(&app)?;tauri::async_runtime::spawn_blocking(move||{lease(&root)?;maintenance::schedule(&root,enabled)}).await.map_err(|e|e.to_string())?}

pub(super) async fn startup(app:AppHandle)->Result<StorageReport,String>{let (root,database)=paths(&app)?;tauri::async_runtime::spawn_blocking(move||{
    let mut gate=gate().lock().map_err(|_|"Image storage needs to be restarted")?;
    if *gate {return Err("Image storage cleanup is available only before image sessions open".into());}*gate=true;
    lease(&root)?;
    let db=Connection::open_with_flags(database,OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e|e.to_string())?;
    db.busy_timeout(Duration::from_secs(5)).map_err(|e|e.to_string())?;
    // Hold a read transaction while resolving saved references and scanning.
    db.execute_batch("BEGIN").map_err(|e|e.to_string())?;let imports=crate::xdesign_project_imports::maintenance_protection(&db)?;let refs=references(&db)?;
    let recovered=maintenance::recover_store(&root,&imports)?;
    maintenance::perform_with_imports(&root,&refs,&imports)?;
    let mut report=scan_with_imports(&root,&refs,&imports,true,SystemTime::now())?;maintenance::attach(&root,&mut report)?;if recovered>0{report.notes.push(format!("Recovered {recovered} interrupted image storage changes"));}
    db.execute_batch("COMMIT").map_err(|e|e.to_string())?;Ok(report)
}).await.map_err(|e|e.to_string())?}

#[cfg(test)]
#[path="xdesign_project_import_storage_tests.rs"]
mod import_tests;

#[cfg(test)]
mod tests {
    use super::*;use serde_json::json;
    #[test]
    fn saved_shared_image_receipts_and_checkpoints_protect_accepted_versions_beside_working_drafts() {
        let db = Connection::open_in_memory().unwrap(); db.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE xdesign_checkpoints(project_id TEXT,document TEXT,sha256 TEXT);").unwrap();
        let project = ulid::Ulid::new().to_string(); let photo = ulid::Ulid::new().to_string(); let base = ulid::Ulid::new().to_string(); let working = ulid::Ulid::new().to_string();
        let doc = json!({"photoDocuments":{&photo:{"id":photo,"version":working}},"pencilDocument":{"roomImages":{"version":1,"bindings":[{"serverUrl":"https://rooms.example.test/","documentId":"image_room_identity_001","reference":{},"photo":{"id":photo,"version":base}}]}}}).to_string();
        db.execute("INSERT INTO app_state VALUES (?1,?2)", rusqlite::params![format!("xdesign.project.{project}"),doc]).unwrap();
        let expected = HashSet::from([(project.clone(), photo.clone(), base), (project.clone(), photo, working)]); assert_eq!(references(&db).unwrap(), expected);
        db.execute("INSERT INTO xdesign_checkpoints VALUES (?1,?2,?3)", rusqlite::params![project, doc, format!("{:x}",Sha256::digest(doc.as_bytes()))]).unwrap();
        db.execute("DELETE FROM app_state", []).unwrap(); assert_eq!(references(&db).unwrap(), expected);
        db.execute("UPDATE xdesign_checkpoints SET document='{}'", []).unwrap(); assert!(references(&db).unwrap_err().contains("checksum"));
    }
    #[test]
    fn room_transfers_protect_pending_native_history_from_collection_and_compaction_until_discarded() {
        use crate::xdesign_room::image_files::{Store,Action};
        let root=std::env::temp_dir().join(format!("xdesign-transfer-cleanup-{}",ulid::Ulid::new()));let project=ulid::Ulid::new().to_string();let photo=ulid::Ulid::new().to_string();let dir=root.join(&project).join(&photo);
        let mut engine=photocraft_engine::Session::new();engine.execute("file.new",json!({"width":24,"height":24,"depth":32})).unwrap();engine.active_mut().unwrap().history.max_states=1;
        let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let first=super::super::publish(&dir,&photo,&mut session).unwrap();
        session.engine.execute("paint.stroke",json!({"points":[[6,6]],"size":4,"seed":3})).unwrap();super::super::publish(&dir,&photo,&mut session).unwrap();session.engine.execute("paint.stroke",json!({"points":[[16,16]],"size":4,"seed":4})).unwrap();let latest=super::super::publish(&dir,&photo,&mut session).unwrap();
        let first_path=dir.join(format!("{}.pcraft",first.version));let original=super::super::bundle::portable_bytes(&first_path,512*1024*1024).unwrap();
        let store=Store::new(&root,"https://rooms.example.test","image_document_0001","image_member_00001",&project,"image_pending_001").unwrap();
        store.run(Action::Prepare{photo:serde_json::to_value(&first).unwrap()},&mut ||Ok(())).unwrap();
        let other=root.join(&project).join(ulid::Ulid::new().to_string());std::fs::create_dir(&other).unwrap();std::fs::write(other.join(format!("{}.pcraft",ulid::Ulid::new())),&original).unwrap();
        let old=SystemTime::now()-Duration::from_secs(8*24*60*60);for entry in std::fs::read_dir(&dir).unwrap(){let entry=entry.unwrap();if !entry.file_name().to_string_lossy().starts_with('.') {std::fs::File::open(entry.path()).unwrap().set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();}}
        let refs=HashSet::from([(project.clone(),photo.clone(),latest.version.clone())]);maintenance::schedule(&root,true).unwrap();maintenance::perform(&root,&refs).unwrap();
        let report=scan(&root,&refs,true,SystemTime::now()).unwrap();assert_eq!(report.protected_versions,3);assert!(first_path.exists());assert_eq!(super::super::bundle::portable_bytes(&first_path,512*1024*1024).unwrap(),original);assert!(super::super::restore(&dir,&latest.version,None).is_ok());
        let mut report=report;maintenance::attach(&root,&mut report).unwrap();assert_eq!(serde_json::to_value(report.compaction.unwrap()).unwrap()["converted"],1);
        let record=walkdir::WalkDir::new(root.join(&project).join(".room-images")).into_iter().find_map(|entry|{let entry=entry.ok()?;(entry.file_name()=="record.json").then(||entry.path().to_path_buf())}).unwrap();let saved=std::fs::read(&record).unwrap();std::fs::write(&record,b"damaged").unwrap();
        assert!(scan(&root,&refs,true,SystemTime::now()).is_err());assert!(first_path.exists());std::fs::write(&record,saved).unwrap();
        store.run(Action::Discard{},&mut ||Ok(())).unwrap();scan(&root,&refs,true,SystemTime::now()).unwrap();assert!(!first_path.exists());assert!(super::super::restore(&dir,&latest.version,None).is_ok());std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn native_history_cleanup_protects_direct_states_without_retaining_trimmed_ancestors(){
        let root=std::env::temp_dir().join(format!("xdesign-history-cleanup-{}",ulid::Ulid::new()));let project=ulid::Ulid::new().to_string();let photo=ulid::Ulid::new().to_string();let dir=root.join(&project).join(&photo);
        let mut engine=photocraft_engine::Session::new();engine.execute("file.new",json!({"width":24,"height":24})).unwrap();engine.active_mut().unwrap().history.max_states=1;
        let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};let first=super::super::publish(&dir,&photo,&mut session).unwrap();
        session.engine.execute("paint.stroke",json!({"points":[[6,6]],"size":4,"seed":3})).unwrap();let second=super::super::publish(&dir,&photo,&mut session).unwrap();session.engine.execute("paint.stroke",json!({"points":[[16,16]],"size":4,"seed":4})).unwrap();let latest=super::super::publish(&dir,&photo,&mut session).unwrap();
        let old=SystemTime::now()-Duration::from_secs(8*24*60*60);for entry in std::fs::read_dir(&dir).unwrap(){let entry=entry.unwrap();if !entry.file_name().to_string_lossy().starts_with('.') {std::fs::File::open(entry.path()).unwrap().set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();}}
        let refs=HashSet::from([(project.clone(),photo.clone(),latest.version.clone())]);let report=scan(&root,&refs,true,SystemTime::now()).unwrap();assert_eq!(report.protected_versions,2);assert!(!dir.join(format!("{}.pcraft",first.version)).exists());assert!(dir.join(format!("{}.pcraft",second.version)).exists());assert!(super::super::restore(&dir,&latest.version,None).is_ok());
        let view_path=dir.join(format!("{}.view.json",latest.version));let mut view:Value=serde_json::from_slice(&std::fs::read(&view_path).unwrap()).unwrap();view["orionNativeHistory"]["states"][0]["version"]=json!(ulid::Ulid::new().to_string());std::fs::write(&view_path,serde_json::to_vec(&view).unwrap()).unwrap();assert!(scan(&root,&refs,true,SystemTime::now()).err().unwrap().contains("missing or invalid"));assert!(dir.join(format!("{}.pcraft",second.version)).exists());std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn old_interrupted_saves_are_collected_without_following_links_or_removing_recent_drafts() {
        let root=std::env::temp_dir().join(format!("xdesign-interrupted-{}",ulid::Ulid::new()));let project=ulid::Ulid::new().to_string();let photo=ulid::Ulid::new().to_string();let dir=root.join(&project).join(&photo);std::fs::create_dir_all(&dir).unwrap();
        let mut engine=photocraft_engine::Session::new();engine.execute("file.new",json!({"width":16,"height":16,"background":"white"})).unwrap();
        let kept=ulid::Ulid::new().to_string();super::super::bundle::write_document(&dir,&kept,&engine.active().unwrap().doc,&mut Default::default()).unwrap();
        let version=dir.join(format!("{kept}.pcraft"));let tile=super::super::bundle::entries(&version).unwrap().into_iter().find(|file|file.parent().unwrap().file_name().unwrap()=="tiles").unwrap();
        let draft=||{let path=dir.join(format!(".pcraft-{}",ulid::Ulid::new()));std::fs::create_dir(&path).unwrap();for sub in ["tiles","blobs","composite"]{std::fs::create_dir(path.join(sub)).unwrap();}path};
        let expired=draft();std::fs::hard_link(&tile,expired.join("tiles").join(tile.file_name().unwrap())).unwrap();std::fs::write(expired.join(".manifest.json.123-1.pcsave.tmp"),b"{}").unwrap();
        let recent=draft();let unknown=draft();std::fs::write(unknown.join("foreign.txt"),b"keep").unwrap();
        let old=SystemTime::now()-Duration::from_secs(8*24*60*60);for path in [&expired,&unknown]{std::fs::File::open(path).unwrap().set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();}
        #[cfg(unix)] let linked={let path=draft();let outside=root.join("outside.dat");std::fs::write(&outside,b"outside").unwrap();std::os::unix::fs::symlink(&outside,path.join("blobs").join(tile.file_name().unwrap())).unwrap();std::fs::File::open(&path).unwrap().set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();path};
        let refs=HashSet::from([(project,photo,kept)]);let report=scan(&root,&refs,true,SystemTime::now()).unwrap();assert!(report.reclaimed_files>=2);assert!(!expired.exists());assert!(recent.exists());assert!(unknown.exists());assert!(!report.notes.is_empty());
        #[cfg(unix)]{assert!(linked.exists());assert_eq!(std::fs::read(root.join("outside.dat")).unwrap(),b"outside");}
        assert!(photocraft_format::load_path(&version).is_ok());std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn tile_snapshot_collection_keeps_referenced_pixels_and_counts_unique_storage() {
        let root=std::env::temp_dir().join(format!("xdesign-storage-{}",ulid::Ulid::new()));let project=ulid::Ulid::new().to_string();let photo=ulid::Ulid::new().to_string();let dir=root.join(&project).join(&photo);std::fs::create_dir_all(&dir).unwrap();
        let mut engine=photocraft_engine::Session::new();engine.execute("file.new",json!({"width":64,"height":64,"background":"white"})).unwrap();let bytes=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap();
        let kept=ulid::Ulid::new().to_string();let orphan=ulid::Ulid::new().to_string();for version in [&kept,&orphan]{super::super::bundle::write(&dir,version,&bytes).unwrap();}
        let report=scan(&root,&HashSet::new(),false,SystemTime::now()).unwrap();assert_eq!(report.versions,2);
        #[cfg(unix)] assert!(report.physical_bytes<report.bytes);
        let old=SystemTime::now()-Duration::from_secs(8*24*60*60);std::fs::File::open(dir.join(format!("{orphan}.pcraft"))).unwrap().set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();
        let refs=HashSet::from([(project,photo,kept.clone())]);let collected=scan(&root,&refs,true,SystemTime::now()).unwrap();assert!(collected.reclaimed_files>0);assert!(!dir.join(format!("{orphan}.pcraft")).exists());
        assert!(photocraft_format::load_path(&dir.join(format!("{kept}.pcraft"))).is_ok());let remaining=scan(&root,&refs,false,SystemTime::now()).unwrap();assert_eq!(remaining.versions,1);assert_eq!(remaining.protected_versions,1);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saved_projects_and_checkpoints_protect_all_draft_versions_and_corruption_cancels_collection() {
        let db=Connection::open_in_memory().unwrap();db.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE xdesign_checkpoints(project_id TEXT,document TEXT,sha256 TEXT);").unwrap();
        let project=ulid::Ulid::new().to_string();let photo=ulid::Ulid::new().to_string();let current=ulid::Ulid::new().to_string();let old=ulid::Ulid::new().to_string();let parent=ulid::Ulid::new().to_string();
        let doc=json!({"photoDocuments":{&photo:{"id":photo,"version":current}},"photoDrafts":[{"trail":[{"parent":{"id":photo,"version":parent},"past":[{"id":photo,"version":old}],"future":[]}]}]}).to_string();
        db.execute("INSERT INTO app_state VALUES (?1,?2)",rusqlite::params![format!("xdesign.project.{project}"),doc]).unwrap();assert_eq!(references(&db).unwrap().len(),3);
        db.execute("INSERT INTO xdesign_checkpoints VALUES (?1,?2,'bad')",rusqlite::params![project,doc]).unwrap();assert!(references(&db).unwrap_err().contains("checksum"));
    }
    #[test]
    fn collection_only_removes_old_unreferenced_versions_and_deduplicates_previews() {
        let root=std::env::temp_dir().join(format!("xdesign-storage-{}",ulid::Ulid::new()));let project=ulid::Ulid::new().to_string();let photo=ulid::Ulid::new().to_string();let dir=root.join(&project).join(&photo);std::fs::create_dir_all(&dir).unwrap();
        let kept=ulid::Ulid::new().to_string();let orphan=ulid::Ulid::new().to_string();let recent=ulid::Ulid::new().to_string();let old=SystemTime::now()-Duration::from_secs(8*24*60*60);
        for version in [&kept,&orphan,&recent]{let path=dir.join(format!("{version}.pcraft"));std::fs::write(&path,b"image").unwrap();if version!=&recent{std::fs::File::options().write(true).open(path).unwrap().set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();}}
        std::fs::write(dir.join("foreign.pcraft"),b"keep").unwrap();let refs=HashSet::from([(project,photo,kept.clone())]);let result=scan(&root,&refs,true,SystemTime::now()).unwrap();assert_eq!(result.reclaimed_files,1);assert!(dir.join(format!("{kept}.pcraft")).exists());assert!(dir.join(format!("{recent}.pcraft")).exists());assert!(dir.join("foreign.pcraft").exists());
        write_preview(&dir,&kept,b"png").unwrap();write_preview(&dir,&recent,b"png").unwrap();
        #[cfg(unix)] {use std::os::unix::fs::MetadataExt;assert_eq!(std::fs::metadata(dir.join(format!("{kept}.png"))).unwrap().ino(),std::fs::metadata(dir.join(format!("{recent}.png"))).unwrap().ino());}
        let shared=dir.join(".previews").join(format!("{:x}.png",Sha256::digest(b"png")));std::fs::write(shared,b"bad").unwrap();let recovered=ulid::Ulid::new().to_string();write_preview(&dir,&recovered,b"png").unwrap();assert_eq!(std::fs::read(dir.join(format!("{recovered}.png"))).unwrap(),b"png");
        std::fs::remove_dir_all(root).unwrap();
    }
}
