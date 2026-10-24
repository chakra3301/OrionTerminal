pub mod auth;
mod captions;
mod engine;
pub mod export;
mod lease;
mod playback;
pub mod playlists;
mod policy;
mod poster;
pub mod preferences;
mod publication;
pub mod queue;
mod sidecar_source;
pub mod sidecars;
mod sponsor;
mod sponsor_gateway;
mod thumbnails;

use engine::Progress;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use policy::{Metadata, Options, Preset};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

struct Active {
    cancel: watch::Sender<bool>,
    progress: Progress,
    paused: bool,
    resumable: bool,
    work_mib: u32,
    _owner: std::sync::Arc<lease::Owner>,
}
static ACTIVE: Lazy<Mutex<BTreeMap<String, Active>>> = Lazy::new(|| Mutex::new(BTreeMap::new()));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    id: String,
    url: String,
    state: String,
    preset: Preset,
    metadata: Option<Metadata>,
    error: Option<String>,
    asset_id: Option<String>,
    created_at: i64,
    progress: Progress,
    options: Options,
    source_asset_id: Option<String>,
    queue: Option<queue::Entry>,
    thumbnail_preview: Option<String>,
}
fn db(app: &AppHandle) -> Result<Connection, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("orion.db");
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|_| "Downloads database unavailable. Restart with an updated Orion build.")?;
    c.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    c.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    Ok(c)
}
fn id_check(id: &str) -> Result<(), String> {
    if id.len() != 26
        || ulid::Ulid::from_string(id)
            .map(|v| v.to_string() != id)
            .unwrap_or(true)
    {
        Err("Invalid download identity.".into())
    } else {
        Ok(())
    }
}
fn private_dir(path: &Path) -> Result<(), String> {
    if !path.exists() {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(path).map_err(|e| e.to_string())?;
    }
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !m.is_dir() || m.is_symlink() {
        return Err("Download directory must not be a symbolic link.".into());
    }
    Ok(())
}
fn job_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    id_check(id)?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root = base.join("media-downloads");
    private_dir(&root)?;
    let dir = root.join(id);
    private_dir(&dir)?;
    Ok(dir)
}
fn check_retained_budget(dir: &Path, limits: &policy::Limits) -> Result<(), String> {
    limits.validate()?;
    let mut retained = 0u64;
    for (index, entry) in fs::read_dir(dir.parent().ok_or("Missing download root.")?)
        .map_err(|e| e.to_string())?
        .enumerate()
    {
        if index >= 128 {
            return Err("Too many retained download directories; remove old entries first.".into());
        }
        let Some(entry) = engine::present(entry)? else {
            continue;
        };
        if entry.path() == dir {
            continue;
        }
        id_check(&entry.file_name().to_string_lossy())?;
        let Some(meta) = engine::present(fs::symlink_metadata(entry.path()))? else {
            continue;
        };
        if !meta.is_dir() || meta.is_symlink() {
            return Err("Unexpected retained download directory.".into());
        }
        retained = retained.saturating_add(engine::work_size(&entry.path())?);
        if retained > limits.work_bytes() {
            return Err("Retained downloads exceed this job’s combined work limit. Save or remove old entries before downloading more.".into());
        }
    }
    Ok(())
}
fn check_work_budget(dir: &Path, limits: &policy::Limits) -> Result<(), String> {
    check_work_budget_extra(dir, limits, 0)
}
fn check_work_budget_extra(
    dir: &Path,
    limits: &policy::Limits,
    additional: u64,
) -> Result<(), String> {
    limits.validate()?;
    let Some(root) = dir
        .parent()
        .filter(|p| p.file_name().is_some_and(|n| n == "media-downloads"))
    else {
        if engine::work_size(dir)?.saturating_add(additional) > limits.work_bytes() {
            return Err("Download working files exceeded the selected work limit.".into());
        }
        return Ok(());
    };
    let mut total = additional;
    if total > limits.work_bytes() {
        return Err("Pending copy exceeds the selected work limit.".into());
    }
    for (index, entry) in fs::read_dir(root).map_err(|e| e.to_string())?.enumerate() {
        if index >= 128 {
            return Err("Too many retained download directories.".into());
        }
        let Some(entry) = engine::present(entry)? else {
            continue;
        };
        id_check(&entry.file_name().to_string_lossy())?;
        let Some(m) = engine::present(fs::symlink_metadata(entry.path()))? else {
            continue;
        };
        if !m.is_dir() || m.is_symlink() {
            return Err("Unexpected retained download directory.".into());
        }
        total = total.saturating_add(engine::work_size(&entry.path())?);
        if total > limits.work_bytes() {
            return Err("Combined unfinished downloads exceeded the selected work limit. Save or remove retained items before retrying.".into());
        }
    }
    Ok(())
}
fn clean_work(dir: &Path) -> Result<(), String> {
    let mut paths = Vec::new();
    for e in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        let meta = fs::symlink_metadata(e.path()).map_err(|e| e.to_string())?;
        if paths.len() >= 256
            || (!name.starts_with("media.") && name != "caption-languages.txt")
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
            || !meta.is_file()
            || meta.is_symlink()
        {
            return Err("Unexpected work file. Nothing was removed; inspect the download directory manually.".into());
        }
        paths.push(e.path());
    }
    for p in paths {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn jobs(c: &Connection) -> Result<Vec<Job>, String> {
    let mut query = c.prepare("SELECT id,url,state,preset,metadata_json,error,asset_id,created_at,options_json,source_asset_id FROM media_downloads ORDER BY created_at DESC LIMIT 100").map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut queued = queue::entries(c)?;
    let mut out = Vec::new();
    for r in rows {
        let (id, url, state, preset, meta, error, asset_id, created_at, options, source_asset_id) =
            r.map_err(|e| e.to_string())?;
        id_check(&id)?;
        if let Some(source) = &source_asset_id {
            id_check(source)?;
        } else {
            policy::url(&url)?;
        }
        let options: Options =
            serde_json::from_str(&options).map_err(|_| "Invalid saved download options.")?;
        options.limits.validate()?;
        out.push(Job {
            thumbnail_preview: None,
            queue: queued.remove(&id),
            id,
            url,
            state,
            preset: serde_json::from_value(serde_json::Value::String(preset))
                .map_err(|_| "Invalid saved download preset.")?,
            metadata: meta
                .map(|s| serde_json::from_str(&s))
                .transpose()
                .map_err(|_| "Invalid saved download metadata.")?,
            error,
            asset_id,
            created_at,
            progress: Progress::default(),
            options,
            source_asset_id,
        });
    }
    Ok(out)
}
fn job(c: &Connection, id: &str) -> Result<Job, String> {
    id_check(id)?;
    jobs(c)?
        .into_iter()
        .find(|j| j.id == id)
        .ok_or("Download no longer exists.".into())
}
fn state(c: &Connection, id: &str, state: &str, error: Option<&str>) -> Result<(), String> {
    c.execute(
        "UPDATE media_downloads SET state=?2,error=?3 WHERE id=?1",
        params![id, state, error],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn spawn(
    app: AppHandle,
    item: Job,
    dir: PathBuf,
    inspect: bool,
    mut cancel: watch::Receiver<bool>,
    authorization: Option<auth::Access>,
) {
    tauri::async_runtime::spawn(async move {
        let outcome = if inspect {
            engine::inspect(&item.url, &dir, &mut cancel, authorization.as_ref())
                .await
                .map(Some)
        } else {
            let report = |p| {
                if let Some(a) = ACTIVE.lock().get_mut(&item.id) {
                    if !a.paused {
                        a.progress = p;
                    }
                }
            };
            let transfer = if item.source_asset_id.is_some() {
                Ok(())
            } else {
                engine::download(
                    &item.url,
                    &item.preset,
                    &item.options,
                    &dir,
                    &mut cancel,
                    report,
                    authorization.as_ref(),
                    item.queue.as_ref().is_some_and(|q| q.resume_transfer),
                )
                .await
            };
            match transfer {
                Err(e) => Err(e),
                Ok(()) => {
                    if let Some(a) = ACTIVE.lock().get_mut(&item.id) {
                        a.resumable = false;
                        a.progress = Progress {
                            processing: true,
                            phase: Some("verifying".into()),
                            ..Progress::default()
                        };
                    }
                    match playback::normalize(
                        &dir,
                        item.preset.audio(),
                        &item.options,
                        item.metadata.as_ref().and_then(|m| m.duration),
                        &mut cancel,
                        report,
                    )
                    .await
                    {
                        Err(e) => Err(e),
                        Ok(facts) => {
                            if !item.preset.audio() {
                                report(Progress {
                                    processing: true,
                                    phase: Some("poster".into()),
                                    ..Progress::default()
                                });
                                let _ = poster::create(&dir, facts.duration, &mut cancel).await;
                            } else if facts.embedded.as_ref().is_some_and(|e| e.artwork) {
                                let _ = poster::create_audio(&dir, &mut cancel).await;
                            }
                            let mut meta = item
                                .metadata
                                .clone()
                                .ok_or("Downloaded media has no metadata.".to_string());
                            if let Ok(m) = &mut meta {
                                m.playback = Some(facts);
                            }
                            meta.map(Some)
                        }
                    }
                }
            }
        };
        drop(authorization);
        let mut active = ACTIVE.lock();
        let outcome = if *cancel.borrow() {
            Err("Stopped. Partial files are retained until Retry or Remove.".into())
        } else {
            outcome
        };
        let paused = active.get(&item.id).is_some_and(|a| a.paused);
        let mut keep_permission = false;
        if let Ok(mut c) = db(&app) {
            let result = match outcome {
                Ok(Some(meta)) => serde_json::to_string(&meta).map_err(|e| e.to_string()).and_then(|json| {
                    c.execute("UPDATE media_downloads SET metadata_json=?2,state=?3,error=NULL WHERE id=?1", params![item.id,json,if inspect {if item.queue.is_some() {"queued"} else {"inspected"}} else {"ready"}]).map_err(|e| e.to_string())?;
                    if item.queue.is_some() { c.execute("UPDATE media_download_queue SET resume_transfer=0 WHERE job_id=?1",[&item.id]).map_err(|e|e.to_string())?; }
                    Ok(())
                }),
                Ok(None) => state(&c,&item.id,"ready",None),
                Err(ref e) => {
                    if paused { c.execute("UPDATE media_download_queue SET resume_transfer=1 WHERE job_id=?1",[&item.id]).map_err(|e|e.to_string()).and_then(|_| state(&c,&item.id,"paused",None)) }
                    else { state(&c,&item.id,if *cancel.borrow() { "stopped" } else { "failed" },Some(e)) }
                },
            };
            // On persistence failure, list recovery exposes 'interrupted', never a false completion.
            if let Err(e) = result {
                eprintln!("download state could not be saved: {e}");
            } else if let Ok(saved) = job(&c, &item.id) {
                keep_permission = inspect && saved.state == "queued";
                if item.queue.is_some() && saved.state == "ready" {
                    if let Some(a) = active.get_mut(&item.id) {
                        a.progress = Progress {
                            processing: true,
                            phase: Some("saving".into()),
                            ..Progress::default()
                        };
                    }
                    drop(active);
                    if let Err(e) = import_ready(&app, &mut c, &saved) {
                        let _ = state(&c, &item.id, "ready", Some(&e));
                    }
                    active = ACTIVE.lock();
                }
            }
        }
        active.remove(&item.id);
        drop(active);
        if item.queue.is_some() && !keep_permission {
            queue::withdraw(&item.id);
        }
    });
}

#[tauri::command]
pub fn media_download_engines() -> engine::Engines {
    engine::engines()
}

#[tauri::command]
pub async fn media_download_list(app: AppHandle) -> Result<Vec<Job>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner = lease::acquire(&app)?;
        let active = ACTIVE.lock(); let c = db(&app)?;
        if active.is_empty() {auth::cleanup_orphans(&app)?;}
        let mut list = jobs(&c)?;
        let root = app.path().app_data_dir().map_err(|e|e.to_string())?.join("media-downloads");
        for j in &mut list {
            j.thumbnail_preview = thumbnails::get(&root.join(&j.id));
            if let Some(a) = active.get(&j.id) { j.progress = a.progress.clone(); }
            else if matches!(j.state.as_str(),"inspecting"|"downloading") {
                state(&c,&j.id,"interrupted",Some("Interrupted before completion. Retry explicitly; nothing resumes automatically."))?;
                j.state = "interrupted".into(); j.error = Some("Interrupted. Retry explicitly.".into());
            }
        }
        Ok(list)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn media_download_inspect(
    app: AppHandle,
    id: String,
    url: String,
    cookies: Option<auth::CookieChoice>,
) -> Result<(), String> {
    id_check(&id)?;
    policy::url(&url)?;
    preferences::load(&db(&app)?)?;
    if !ACTIVE.lock().is_empty() {
        return Err(
            "Finish or stop the current operation before inspecting another source.".into(),
        );
    }
    let authorization = auth::authorize(&app, &id, &url, cookies, "inspection").await?;
    let owner = lease::acquire(&app)?;
    let mut active = ACTIVE.lock();
    if !active.is_empty() {
        return Err("Finish or stop the current download operation first.".into());
    }
    let c = db(&app)?;
    if jobs(&c)?.len() >= 100 {
        return Err("Download history is full. Remove an old entry first.".into());
    }
    let defaults = preferences::load(&c)?;
    let dir = job_dir(&app, &id)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    c.execute(
        "INSERT INTO media_downloads(id,url,state,created_at,preset,options_json) VALUES(?1,?2,'inspecting',?3,?4,?5)",
        params![id, url, now,serde_json::to_value(&defaults.preset).map_err(|e|e.to_string())?.as_str(),serde_json::to_string(&defaults.options).map_err(|e|e.to_string())?],
    )
    .map_err(|_| "Could not create download inspection; refresh history before retrying.")?;
    let item = job(&c, &id)?;
    let (send, recv) = watch::channel(false);
    active.insert(
        id,
        Active {
            cancel: send,
            progress: Progress::default(),
            paused: false,
            resumable: false,
            work_mib: item.options.limits.work_mib,
            _owner: owner,
        },
    );
    spawn(app, item, dir, true, recv, authorization);
    Ok(())
}
#[tauri::command]
pub async fn media_download_start(
    app: AppHandle,
    id: String,
    preset: Preset,
    options: Option<Options>,
    cookies: Option<auth::CookieChoice>,
) -> Result<(), String> {
    let preview = job(&db(&app)?, &id)?;
    if preview.queue.is_some() {
        return Err("Use the queue's Retry / Run controls, or inspect a new source for cookie-authorized downloads.".into());
    }
    let requested = options.as_ref().unwrap_or(&preview.options);
    requested.validate_preset(&preset, preview.metadata.as_ref())?;
    if preview.source_asset_id.is_some() {
        return Err("Local playable copies never use browser cookies.".into());
    }
    if preview.metadata.is_none()
        || !matches!(
            preview.state.as_str(),
            "inspected" | "failed" | "stopped" | "interrupted"
        )
    {
        return Err("Inspect this source before requesting another download.".into());
    }
    if !ACTIVE.lock().is_empty() {
        return Err(
            "Finish or stop the current operation before starting another download.".into(),
        );
    }
    let approved_source = preview.url.clone();
    let authorization = auth::authorize(&app, &id, &approved_source, cookies, "download").await?;
    let owner = lease::acquire(&app)?;
    let mut active = ACTIVE.lock();
    if !active.is_empty() {
        return Err("Finish or stop the current download operation first.".into());
    }
    let c = db(&app)?;
    let mut item = job(&c, &id)?;
    if item.queue.is_some() {
        return Err("This item joined a queue while approval was open. Inspect a new source for cookie-authorized downloads.".into());
    }
    if item.url != approved_source {
        return Err("The source changed while approving the operation. Start again.".into());
    }
    if item.metadata.is_none()
        || !matches!(
            item.state.as_str(),
            "inspected" | "failed" | "stopped" | "interrupted"
        )
    {
        return Err(
            "Inspect this link before downloading, or import the already completed file.".into(),
        );
    }
    if item.source_asset_id.is_some() {
        return Err(
            "Create a new playable-copy request from Media rather than redownloading this entry."
                .into(),
        );
    }
    let options = options.unwrap_or_else(|| item.options.clone());
    options.validate_preset(&preset, item.metadata.as_ref())?;
    if options.skip_duplicates && preferences::duplicate(&c, &item, &preset, &options)? {
        return Err("This source/format/range is in the download archive, even if its history or Media entry was removed. Turn off Skip duplicates to download another copy.".into());
    }
    let dir = job_dir(&app, &id)?;
    check_retained_budget(&dir, &options.limits)?;
    engine::disk_space(&dir, options.limits.free_bytes(), 0)?;
    clean_work(&dir)?;
    let encoded = serde_json::to_value(&preset).map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE media_downloads SET state='downloading',preset=?2,options_json=?3,error=NULL WHERE id=?1",
        params![id, encoded.as_str(),serde_json::to_string(&options).map_err(|e|e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    item.preset = preset;
    item.options = options;
    let (send, recv) = watch::channel(false);
    active.insert(
        id,
        Active {
            cancel: send,
            progress: Progress::default(),
            paused: false,
            resumable: false,
            work_mib: item.options.limits.work_mib,
            _owner: owner,
        },
    );
    spawn(app, item, dir, false, recv, authorization);
    Ok(())
}
#[tauri::command]
pub async fn media_download_playable_copy(
    app: AppHandle,
    id: String,
    asset_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        id_check(&id)?; id_check(&asset_id)?;
        let owner = lease::acquire(&app)?;
        let mut active = ACTIVE.lock();
        if !active.is_empty() { return Err("Finish or stop the current media operation first.".into()); }
        let c = db(&app)?;
        for saved in jobs(&c)? {
            if saved.source_asset_id.as_deref() == Some(&asset_id) && saved.state == "completed" {
                let exists:bool = c.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1)",[&saved.id],|r|r.get(0)).map_err(|e|e.to_string())?;
                if exists { return Ok(saved.id); }
            }
        }
        if jobs(&c)?.len() >= 100 { return Err("Download history is full. Remove an old entry first.".into()); }
        let (path,title,url,meta):(String,String,Option<String>,Option<String>) = c.query_row("SELECT file_path,title,url,metadata_json FROM assets WHERE id=?1 AND kind='video'",[&asset_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|"The source video is no longer in Media.")?;
        let assets = app.path().app_data_dir().map_err(|e|e.to_string())?.join("assets");
        let path = playback::owned_source(&assets,&path)?;
        let options = Options { limits: preferences::load(&c)?.options.limits, ..Options::default() };
        let dir = job_dir(&app,&id)?; check_retained_budget(&dir, &options.limits)?;
        engine::disk_space(&dir, options.limits.free_bytes(), 0)?;
        let ext = path.extension().and_then(|s|s.to_str()).ok_or("Unknown video format.")?;
        if !matches!(ext,"mp4"|"mkv"|"webm"|"mov"|"m4v") { return Err("This video container is not supported for playable-copy recovery.".into()); }
        publication::regular_limited(&path, options.limits.file_bytes())?;
        let source_size = fs::metadata(&path).map_err(|e|e.to_string())?.len();
        check_work_budget_extra(&dir, &options.limits, source_size)?;
        let target = dir.join(format!("media.{ext}"));
        let mut metadata:Metadata = meta.and_then(|m|serde_json::from_str(&m).ok()).unwrap_or(Metadata { title:title.clone(),creator:String::new(),description:String::new(),duration:None,site:String::new(),tags:Vec::new(),heights:Vec::new(),formats:Vec::new(),source_id:String::new(),playback:None,subtitles:Vec::new(),automatic_subtitles:Vec::new(),chapters:None,thumbnail:false });
        metadata.title = format!("{} · playable copy",title.chars().take(260).collect::<String>());
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis() as i64;
        c.execute("INSERT INTO media_downloads(id,url,state,preset,metadata_json,created_at,source_asset_id,options_json) VALUES(?1,?2,'downloading','video-mp4',?3,?4,?5,?6)",params![id,url.unwrap_or_default(),serde_json::to_string(&metadata).map_err(|e|e.to_string())?,now,asset_id,serde_json::to_string(&options).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        let item=job(&c,&id)?; let (send,recv)=watch::channel(false);
        active.insert(id.clone(),Active{cancel:send,progress:Progress{processing:true,phase:Some("copying".into()),..Progress::default()},paused:false,resumable:false,work_mib: options.limits.work_mib,_owner:owner});
        drop(active);
        let output_id = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
        let mut checked = std::time::Instant::now();
        let copied = publication::publish_file_checked(&path,&target,&options.limits,|| {
            if *recv.borrow() { return Err("Stopped. The original video was not changed.".into()); }
            if checked.elapsed() >= std::time::Duration::from_millis(500) {
                check_work_budget(&dir,&options.limits)?;
                checked = std::time::Instant::now();
            }
            Ok(())
        }).and_then(|_| check_work_budget(&dir,&options.limits));
        let mut active = ACTIVE.lock();
        if let Err(e) = copied {
            let _ = state(&c,&id,if *recv.borrow() {"stopped"} else {"failed"},Some(&e));
            active.remove(&id);
            return;
        }
        if let Some(a) = active.get_mut(&id) { a.progress.phase=Some("converting".into()); }
        spawn(app,item,dir,false,recv,None);
        });
        Ok(output_id)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub fn media_download_stop(app: AppHandle, id: String) -> Result<(), String> {
    id_check(&id)?;
    let _owner = lease::acquire(&app)?;
    let mut active = ACTIVE.lock();
    if let Some(a) = active.get_mut(&id) {
        if a.progress.phase.as_deref() == Some("saving") {
            return Err("Media publication is committing. Wait for its receipt.".into());
        }
        a.paused = false;
        a.cancel
            .send(true)
            .map_err(|_| "The operation has already finished.")?;
    } else if let Ok(item) = job(&db(&app)?, &id) {
        if matches!(item.state.as_str(), "queued" | "paused") {
            state(&db(&app)?, &id, "stopped", None)?;
        }
    }
    drop(active);
    queue::withdraw(&id);
    Ok(())
}
#[tauri::command]
pub async fn media_download_import(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let owner = lease::acquire(&app)?;
        let mut active = ACTIVE.lock();
        if active.contains_key(&id) {
            return Err("Wait for this operation to finish before importing.".into());
        }
        let mut c = db(&app)?;
        let item = job(&c, &id)?;
        if item.state == "completed" {
            return item
                .asset_id
                .ok_or("Completed download has no asset identity.".into());
        }
        if item.state != "ready" {
            return Err("This download is not ready to import.".into());
        }
        let (send, _recv) = watch::channel(false);
        active.insert(
            id.clone(),
            Active {
                cancel: send,
                progress: Progress {
                    processing: true,
                    phase: Some("saving".into()),
                    ..Default::default()
                },
                paused: false,
                resumable: false,
                work_mib: item.options.limits.work_mib,
                _owner: owner,
            },
        );
        drop(active);
        let result = import_ready(&app, &mut c, &item);
        ACTIVE.lock().remove(&id);
        result?;
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn media_download_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner = lease::acquire(&app)?;
        let active = ACTIVE.lock();
        if active.contains_key(&id) {
            return Err("Stop the operation before removing it.".into());
        }
        let c = db(&app)?;
        let item = job(&c, &id)?;
        if item.state == "ready" {
            return Err("Save the completed file to Media before removing this entry.".into());
        }
        let dir = job_dir(&app, &id)?;
        clean_work(&dir)?;
        fs::remove_dir(&dir).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM media_downloads WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn import_ready(app: &AppHandle, c: &mut Connection, item: &Job) -> Result<(), String> {
    let dir = job_dir(app, &item.id)?;
    let assets = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets");
    private_dir(&assets)?;
    publication::publish(c, item, &dir, &assets)?;
    let _ = clean_work(&dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_and_job_roundtrip() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../migrations/0034_media_downloads.sql"))
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0035_media_download_options.sql"
        ))
        .unwrap();
        let id = ulid::Ulid::new().to_string();
        c.execute("INSERT INTO media_downloads(id,url,state,created_at) VALUES(?1,'https://example.com/video','inspecting',1)",[&id]).unwrap();
        assert_eq!(job(&c, &id).unwrap().state, "inspecting");
        state(&c, &id, "interrupted", Some("Retry")).unwrap();
        assert_eq!(job(&c, &id).unwrap().error.as_deref(), Some("Retry"));
    }
    #[test]
    fn concurrent_work_shares_one_retained_budget() {
        let root = std::env::temp_dir().join(format!("orion-work-budget-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let media = root.join("media-downloads");
        private_dir(&media).unwrap();
        let a = media.join(ulid::Ulid::new().to_string());
        let b = media.join(ulid::Ulid::new().to_string());
        private_dir(&a).unwrap();
        private_dir(&b).unwrap();
        for dir in [&a, &b] {
            let file = fs::File::create(dir.join("media.mp4.part")).unwrap();
            file.set_len(policy::MAX_WORK / 2 + 1).unwrap();
        }
        assert!(check_work_budget(&a, &policy::Limits::default())
            .unwrap_err()
            .contains("Combined"));
        fs::remove_file(b.join("media.mp4.part")).unwrap();
        assert!(check_work_budget(&a, &policy::Limits::default()).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn aggregate_scans_allow_peers_to_rename_and_clean_their_owned_files() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        let root = std::env::temp_dir()
            .join(format!("orion-work-race-{}", ulid::Ulid::new()))
            .join("media-downloads");
        let a = root.join(ulid::Ulid::new().to_string());
        let b = root.join(ulid::Ulid::new().to_string());
        fs::create_dir_all(&a).unwrap();
        fs::create_dir(&b).unwrap();
        let done = Arc::new(AtomicBool::new(false));
        let signal = done.clone();
        let peer = b.clone();
        let writer = std::thread::spawn(move || {
            while !signal.load(Ordering::Relaxed) {
                fs::create_dir_all(&peer).unwrap();
                fs::write(peer.join("media.mp4"), b"private generated fixture").unwrap();
                fs::rename(peer.join("media.mp4"), peer.join("media.normalized.mp4")).unwrap();
                fs::remove_file(peer.join("media.normalized.mp4")).unwrap();
                fs::remove_dir(&peer).unwrap();
            }
        });
        let result = (0..500).try_for_each(|_| check_work_budget(&a, &policy::Limits::default()));
        done.store(true, Ordering::Relaxed);
        writer.join().unwrap();
        result.unwrap();
        fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn configured_work_budget_counts_retained_files_and_pending_source_copies() {
        let root = std::env::temp_dir().join(format!("orion-limit-work-{}", ulid::Ulid::new()));
        let dir = root
            .join("media-downloads")
            .join(ulid::Ulid::new().to_string());
        fs::create_dir_all(&dir).unwrap();
        fs::File::create(dir.join("media.mp4.part"))
            .unwrap()
            .set_len(policy::MAX_WORK + 1)
            .unwrap();
        assert!(check_work_budget(&dir, &policy::Limits::default()).is_err());
        let large = policy::Limits {
            file_mib: 4096,
            work_mib: 8192,
            ..Default::default()
        };
        assert!(check_work_budget(&dir, &large).is_ok());
        assert!(check_work_budget_extra(&dir, &large, policy::MAX_WORK).is_err());
        assert!(check_work_budget_extra(&dir, &large, policy::MAX_WORK - 1).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn aggregate_budget_refuses_linked_job_directories() {
        let root = std::env::temp_dir().join(format!("orion-work-budget-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let media = root.join("media-downloads");
        private_dir(&media).unwrap();
        let job = media.join(ulid::Ulid::new().to_string());
        private_dir(&job).unwrap();
        let target = root.join("keep");
        private_dir(&target).unwrap();
        fs::write(target.join("media.mp4.part"), b"keep").unwrap();
        std::os::unix::fs::symlink(&target, media.join(ulid::Ulid::new().to_string())).unwrap();
        assert!(check_work_budget(&job, &policy::Limits::default()).is_err());
        assert_eq!(fs::read(target.join("media.mp4.part")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn identities_cannot_escape_the_job_directory() {
        for id in ["../x", "/tmp/x", ""] {
            assert!(id_check(id).is_err());
        }
    }
    #[test]
    fn caption_receipts_do_not_block_retry_remove_or_import_cleanup() {
        let dir = std::env::temp_dir().join(format!("orion-caption-cleanup-{}", ulid::Ulid::new()));
        private_dir(&dir).unwrap();
        for _ in 0..3 {
            for name in [
                "media.mp4.part",
                "media.mkv",
                "media.caption-languages.txt",
                "caption-languages.txt",
            ] {
                fs::write(dir.join(name), b"fixture").unwrap();
            }
            clean_work(&dir).unwrap();
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        }
        #[cfg(unix)]
        {
            fs::write(dir.join("media.part"), b"keep").unwrap();
            std::os::unix::fs::symlink("/etc/hosts", dir.join("media.caption-languages.txt"))
                .unwrap();
            assert!(clean_work(&dir).is_err());
            assert_eq!(fs::read(dir.join("media.part")).unwrap(), b"keep");
            fs::remove_file(dir.join("media.caption-languages.txt")).unwrap();
            clean_work(&dir).unwrap();
        }
        fs::remove_dir(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn cleanup_refuses_links_without_touching_other_files() {
        let dir = std::env::temp_dir().join(format!("orion-download-test-{}", ulid::Ulid::new()));
        private_dir(&dir).unwrap();
        fs::write(dir.join("media.part"), "keep").unwrap();
        std::os::unix::fs::symlink("/etc/hosts", dir.join("media.mp4")).unwrap();
        assert!(clean_work(&dir).is_err());
        assert!(dir.join("media.part").exists());
        fs::remove_file(dir.join("media.mp4")).unwrap();
        clean_work(&dir).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
