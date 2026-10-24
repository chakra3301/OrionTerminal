use super::{
    db,
    engine::{self, Progress},
    id_check, job, job_dir, jobs, lease, policy, preferences, state, Active, ACTIVE,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use tokio::sync::watch;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub position: i64,
    pub resume_transfer: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub concurrency: u8,
    pub error: Option<String>,
    pub note: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub ids: Vec<String>,
    pub status: Status,
}
struct Runtime {
    running: bool,
    concurrency: u8,
    epoch: u64,
    permitted: BTreeSet<String>,
    owner: Option<Arc<lease::Owner>>,
    error: Option<String>,
    note: Option<String>,
}
static RUNTIME: Lazy<Mutex<Runtime>> = Lazy::new(|| {
    Mutex::new(Runtime {
        running: false,
        concurrency: 1,
        epoch: 0,
        permitted: BTreeSet::new(),
        owner: None,
        error: None,
        note: None,
    })
});
fn status(r: &Runtime) -> Status {
    Status {
        running: r.running,
        concurrency: r.concurrency,
        error: r.error.clone(),
        note: r.note.clone(),
    }
}
pub(super) fn withdraw(id: &str) {
    RUNTIME.lock().permitted.remove(id);
}
pub(super) fn entries(c: &Connection) -> Result<BTreeMap<String, Entry>, String> {
    // Older isolated publication fixtures deliberately exercise only their original schema.
    let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_download_queue')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !exists {
        return Ok(BTreeMap::new());
    }
    let mut q = c
        .prepare("SELECT job_id,position,resume_transfer FROM media_download_queue")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Entry {
                    position: r.get(1)?,
                    resume_transfer: r.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}
fn now() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64)
}
fn next_position(c: &Connection) -> Result<i64, String> {
    let n: i64 = c
        .query_row(
            "SELECT COALESCE(MAX(position),0) FROM media_download_queue",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    n.checked_add(1)
        .ok_or("Queue order exceeded its limit.".into())
}
pub(super) fn stage(c: &mut Connection, urls: &[String]) -> Result<Vec<String>, String> {
    if urls.is_empty() || urls.len() > 50 {
        return Err("Queue between 1 and 50 links at a time.".into());
    }
    for url in urls {
        policy::url(url)?;
    }
    if urls.iter().collect::<BTreeSet<_>>().len() != urls.len() {
        return Err("Remove repeated links before queuing this batch.".into());
    }
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM media_downloads", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count + urls.len() as i64 > 100 {
        return Err("Download history has room for fewer links. Remove old entries first.".into());
    }
    let defaults = preferences::load(&tx)?;
    let preset = serde_json::to_value(&defaults.preset).map_err(|e| e.to_string())?;
    let options = serde_json::to_string(&defaults.options).map_err(|e| e.to_string())?;
    let base = next_position(&tx)?;
    let created = now()?;
    let mut ids = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        let id = ulid::Ulid::new().to_string();
        tx.execute("INSERT INTO media_downloads(id,url,state,preset,options_json,created_at) VALUES(?1,?2,'queued',?3,?4,?5)",params![id,url,preset.as_str(),options,created+index as i64]).map_err(|e|e.to_string())?;
        tx.execute(
            "INSERT INTO media_download_queue(job_id,position) VALUES(?1,?2)",
            params![
                id,
                base.checked_add(index as i64)
                    .ok_or("Queue order exceeded its limit.")?
            ],
        )
        .map_err(|e| e.to_string())?;
        ids.push(id);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ids)
}
#[tauri::command]
pub async fn media_download_batch(
    app: AppHandle,
    urls: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner = lease::acquire(&app)?;
        stage(&mut db(&app)?, &urls)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn media_download_queue_status() -> Status {
    status(&RUNTIME.lock())
}
fn clear_ready_errors(c: &Connection) -> Result<(), String> {
    c.execute("UPDATE media_downloads SET error=NULL WHERE state='ready' AND id IN (SELECT job_id FROM media_download_queue)", []).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn media_download_queue_run(app: AppHandle, concurrency: u8) -> Result<Run, String> {
    if !(1..=3).contains(&concurrency) {
        return Err("Use 1–3 concurrent downloads.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let owner = lease::acquire(&app)?;
        let mut runtime = RUNTIME.lock();
        let _active = ACTIVE.lock();
        let c = db(&app)?;
        let list = jobs(&c)?;
        let ids: Vec<_> = list
            .iter()
            .filter(|j| j.queue.is_some() && matches!(j.state.as_str(), "queued" | "ready"))
            .map(|j| j.id.clone())
            .collect();
        if list.iter().any(|j| ids.contains(&j.id) && j.state == "queued") {
            let engines = super::engine::engines();
            if engines.yt_dlp.is_none() || engines.ffmpeg.is_none() || engines.ffprobe.is_none() || engines.node.is_none() {
                return Err("Install all four download engines before running queued transfers. Queued jobs were not changed.".into());
            }
        }
        if ids.is_empty() && !runtime.running {
            return Err("Add or resume a queued item first.".into());
        }
        clear_ready_errors(&c)?;
        runtime.permitted.extend(ids.iter().cloned());
        runtime.concurrency = concurrency;
        runtime.error = None;
        runtime.note = None;
        runtime.owner = Some(owner);
        if !runtime.running {
            runtime.running = true;
            runtime.epoch += 1;
            let epoch = runtime.epoch;
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match tick(&handle, epoch) {
                        Ok(true) => {}
                        Ok(false) => break,
                        Err(error) => {
                            let mut r = RUNTIME.lock();
                            if r.epoch == epoch {
                                r.running = false;
                                r.error = Some(error);
                                r.permitted.clear();
                                r.owner = None;
                            }
                            break;
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            });
        }
        Ok(Run {
            ids,
            status: status(&runtime),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn media_download_queue_hold() -> Status {
    let mut r = RUNTIME.lock();
    r.running = false;
    r.note = None;
    r.epoch += 1;
    r.permitted.clear();
    r.owner = None;
    status(&r)
}
fn tick(app: &AppHandle, epoch: u64) -> Result<bool, String> {
    let mut r = RUNTIME.lock();
    if !r.running || r.epoch != epoch {
        return Ok(false);
    }
    r.note = None;
    let mut active = ACTIVE.lock();
    let mut list = jobs(&db(app)?)?;
    list.sort_by_key(|j| {
        (
            j.queue.as_ref().map(|q| q.position).unwrap_or(i64::MAX),
            j.id.clone(),
        )
    });
    let all = list.clone();
    let eligible: Vec<_> = list
        .into_iter()
        .filter(|j| {
            r.permitted.contains(&j.id)
                && j.queue.is_some()
                && matches!(j.state.as_str(), "queued" | "ready")
                && !active.contains_key(&j.id)
        })
        .collect();
    if eligible.is_empty() && !active.keys().any(|id| r.permitted.contains(id)) {
        r.running = false;
        r.permitted.clear();
        r.owner = None;
        return Ok(false);
    }
    let slots = (r.concurrency as usize).saturating_sub(active.len());
    let mut started = 0;
    let mut active_ids: BTreeSet<String> = active.keys().cloned().collect();
    for item in eligible {
        if started >= slots {
            break;
        }
        if !same_work_cohort(
            item.options.limits.work_mib,
            active.values().map(|a| a.work_mib),
        ) {
            r.note = Some("Waiting for the active work-limit cohort to finish before changing the shared budget.".into());
            break;
        }
        if reserved(&item, &all, &active_ids)? {
            r.note = Some("A matching source is transferring or awaiting Save to Media. Other items can continue.".into());
            continue;
        }
        let c = db(app)?;
        let dir = job_dir(app, &item.id)?;
        let preparing = (|| {
            item.options.limits.validate()?;
            if item.state == "ready" {
                return state(&c, &item.id, "ready", None);
            }
            super::check_retained_budget(&dir, &item.options.limits)?;
            engine::disk_space(&dir, item.options.limits.free_bytes(), 0)?;
            item.options
                .validate_preset(&item.preset, item.metadata.as_ref())?;
            if item.metadata.is_some()
                && item.options.skip_duplicates
                && preferences::duplicate(&c, &item, &item.preset, &item.options)?
            {
                state(
                    &c,
                    &item.id,
                    "skipped",
                    Some("Already in the source archive. Nothing was downloaded."),
                )?;
                return Err("archived".to_string());
            }
            if !item.queue.as_ref().is_some_and(|q| q.resume_transfer) {
                super::clean_work(&dir)?;
            }
            state(
                &c,
                &item.id,
                if item.metadata.is_none() {
                    "inspecting"
                } else {
                    "downloading"
                },
                None,
            )
        })();
        if let Err(error) = preparing {
            if error != "archived" {
                preparation_failure(&c, &item, &error)?;
            }
            r.permitted.remove(&item.id);
            continue;
        }
        started += 1;
        active_ids.insert(item.id.clone());
        let (send, recv) = watch::channel(false);
        active.insert(
            item.id.clone(),
            Active {
                cancel: send,
                progress: Progress::default(),
                paused: false,
                resumable: item.state != "ready" && item.metadata.is_some(),
                work_mib: item.options.limits.work_mib,
                _owner: r.owner.clone().ok_or("Missing queue ownership.")?,
            },
        );
        if item.state == "ready" {
            let app = app.clone();
            let id = item.id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut active = ACTIVE.lock();
                if let Some(a) = active.get_mut(&id) {
                    a.progress = Progress {
                        processing: true,
                        phase: Some("saving".into()),
                        ..Progress::default()
                    };
                }
                drop(active);
                let result = (|| {
                    let mut c = db(&app)?;
                    let saved = job(&c, &id)?;
                    super::import_ready(&app, &mut c, &saved)
                })();
                if let Err(e) = result {
                    if let Ok(c) = db(&app) {
                        let _ = state(&c, &id, "ready", Some(&e));
                    }
                }
                ACTIVE.lock().remove(&id);
                withdraw(&id);
            });
        } else {
            let inspect = item.metadata.is_none();
            super::spawn(app.clone(), item, dir, inspect, recv, None);
        }
    }
    Ok(true)
}
fn preparation_failure(c: &Connection, item: &super::Job, error: &str) -> Result<(), String> {
    state(
        c,
        &item.id,
        if item.state == "ready" {
            "ready"
        } else {
            "failed"
        },
        Some(error),
    )
}
fn same_work_cohort(requested: u32, active: impl Iterator<Item = u32>) -> bool {
    active.into_iter().all(|cap| cap == requested)
}
fn reserved(
    item: &super::Job,
    all: &[super::Job],
    active: &BTreeSet<String>,
) -> Result<bool, String> {
    if item.state == "ready" || item.metadata.is_none() || !item.options.skip_duplicates {
        return Ok(false);
    }
    for other in all {
        if other.id != item.id
            && other.source_asset_id.is_none()
            && other.metadata.is_some()
            && (active.contains(&other.id) || other.state == "ready")
            && preferences::same_output(item, other)?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn media_download_queue_add(
    app: AppHandle,
    id: String,
    preset: policy::Preset,
    options: policy::Options,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner=lease::acquire(&app)?; let active=ACTIVE.lock();
        if active.contains_key(&id) {return Err("Wait for this item to finish first.".into());}
        let mut c=db(&app)?; let item=job(&c,&id)?;
        if item.source_asset_id.is_some() || !matches!(item.state.as_str(),"inspected"|"failed"|"stopped"|"interrupted"|"queued") {return Err("Inspect or retry this remote source before adding it to the queue.".into());}
        options.validate_preset(&preset,item.metadata.as_ref())?;
        let tx=c.transaction().map_err(|e|e.to_string())?; let position=next_position(&tx)?;
        tx.execute("INSERT INTO media_download_queue(job_id,position) VALUES(?1,?2) ON CONFLICT(job_id) DO UPDATE SET resume_transfer=0",params![id,position]).map_err(|e|e.to_string())?;
        tx.execute("UPDATE media_downloads SET state='queued',preset=?2,options_json=?3,error=NULL WHERE id=?1",params![id,serde_json::to_value(preset).map_err(|e|e.to_string())?.as_str(),serde_json::to_string(&options).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?; Ok(())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn media_download_queue_pause(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner=lease::acquire(&app)?; let mut active=ACTIVE.lock(); let c=db(&app)?;
        let item=job(&c,&id)?;
        if item.queue.is_none() {return Err("Only queued jobs support retained-partial pause.".into());}
        if let Some(a)=active.get_mut(&id) {
            if !a.resumable || a.progress.processing {return Err("Pause is available during transfer, not inspection, conversion or saving. Use Stop instead.".into());}
            a.paused=true; a.resumable=false; a.progress=Progress { processing:true, phase:Some("pausing".into()), ..a.progress.clone() }; a.cancel.send(true).map_err(|_|"Transfer already finished.")?;
        } else if item.state=="queued" {state(&c,&id,"paused",None)?;}
        else {return Err("This job is not waiting or transferring.".into());}
        drop(active); withdraw(&id); Ok(())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn media_download_queue_resume(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner = lease::acquire(&app)?;
        let active = ACTIVE.lock();
        let c = db(&app)?;
        let item = job(&c, &id)?;
        if active.contains_key(&id) {
            return Err("Wait for the stopped process to exit before resuming.".into());
        }
        if item.queue.is_none()
            || !matches!(
                item.state.as_str(),
                "paused" | "failed" | "stopped" | "interrupted"
            )
        {
            return Err("This queued job cannot be resumed.".into());
        }
        if item.state != "paused" {
            c.execute(
                "UPDATE media_download_queue SET resume_transfer=0 WHERE job_id=?1",
                [&id],
            )
            .map_err(|e| e.to_string())?;
        }
        state(&c, &id, "queued", None)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn reorder(c: &mut Connection, ids: &[String]) -> Result<(), String> {
    if ids.len() > 100 || ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
        return Err("Invalid queue order.".into());
    }
    for id in ids {
        id_check(id)?;
    }
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let pending: BTreeSet<_> = jobs(&tx)?
        .into_iter()
        .filter(|j| j.queue.is_some() && matches!(j.state.as_str(), "queued" | "paused"))
        .map(|j| j.id)
        .collect();
    if pending != ids.iter().cloned().collect() {
        return Err("The waiting queue changed. Refresh before reordering.".into());
    }
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE media_download_queue SET position=?2 WHERE job_id=?1",
            params![id, index as i64 + 1],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn media_download_queue_reorder(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner = lease::acquire(&app)?;
        let runtime = RUNTIME.lock();
        let _active = ACTIVE.lock();
        if runtime.running {
            return Err("Hold the queue before reordering waiting items.".into());
        }
        reorder(&mut db(&app)?, &ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn different_shared_limits_wait_until_the_cohort_drains() {
        assert!(same_work_cohort(4096, [].into_iter()));
        assert!(same_work_cohort(4096, [4096, 4096].into_iter()));
        assert!(!same_work_cohort(8192, [4096].into_iter()));
        assert!(!same_work_cohort(4096, [4096, 8192].into_iter()));
        assert!(same_work_cohort(8192, [].into_iter()));
    }
    fn connection() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in [
            include_str!("../../migrations/0034_media_downloads.sql"),
            include_str!("../../migrations/0035_media_download_options.sql"),
            include_str!("../../migrations/0036_media_download_preferences.sql"),
            include_str!("../../migrations/0037_media_download_generic_archive.sql"),
            include_str!("../../migrations/0038_media_download_queue.sql"),
        ] {
            c.execute_batch(sql).unwrap();
        }
        c
    }
    #[test]
    fn batch_is_atomic_bounded_and_held_with_frozen_defaults() {
        let mut c = connection();
        let urls: Vec<String> = vec![
            "https://example.com/first".into(),
            "https://example.com/second".into(),
        ];
        assert!(stage(&mut c, &[urls[0].clone(), "file:///etc/hosts".into()]).is_err());
        assert!(jobs(&c).unwrap().is_empty());
        let ids = stage(&mut c, &urls).unwrap();
        let list = jobs(&c).unwrap();
        assert_eq!(ids.len(), 2);
        assert!(list
            .iter()
            .all(|j| j.state == "queued" && j.metadata.is_none() && j.queue.is_some()));
        assert_eq!(job(&c, &ids[0]).unwrap().queue.unwrap().position, 1);
        assert_eq!(job(&c, &ids[1]).unwrap().queue.unwrap().position, 2);
        c.execute(
            "INSERT INTO media_download_preferences(singleton,settings_json) VALUES(1,'broken')",
            [],
        )
        .unwrap();
        assert!(job(&c, &ids[0]).unwrap().options.playable);
        assert!(stage(&mut c, &["https://example.com/third".into()]).is_err());
        assert_eq!(jobs(&c).unwrap().len(), 2);
        assert!(stage(&mut c, &vec![urls[0].clone(); 51]).is_err());
        assert!(stage(&mut c, &[urls[0].clone(), urls[0].clone()]).is_err());
    }
    #[test]
    fn resource_admission_failure_keeps_completed_bytes_importable() {
        let mut c = connection();
        let id = stage(&mut c, &["https://example.com/ready".into()])
            .unwrap()
            .remove(0);
        state(&c, &id, "ready", None).unwrap();
        let item = job(&c, &id).unwrap();
        preparation_failure(&c, &item, "Insufficient free disk space").unwrap();
        let retained = job(&c, &id).unwrap();
        assert_eq!(retained.state, "ready");
        assert_eq!(
            retained.error.as_deref(),
            Some("Insufficient free disk space")
        );
        state(&c, &id, "queued", None).unwrap();
        let item = job(&c, &id).unwrap();
        preparation_failure(&c, &item, "Insufficient free disk space").unwrap();
        assert_eq!(job(&c, &id).unwrap().state, "failed");
    }
    #[test]
    fn queued_publication_retry_clears_only_the_previous_ready_attempt_error() {
        let mut c = connection();
        let ids = stage(
            &mut c,
            &[
                "https://example.com/ready".into(),
                "https://example.com/failed".into(),
            ],
        )
        .unwrap();
        state(&c, &ids[0], "ready", Some("Previous publication failed")).unwrap();
        state(&c, &ids[1], "failed", Some("Transfer failed")).unwrap();
        clear_ready_errors(&c).unwrap();
        let ready = job(&c, &ids[0]).unwrap();
        assert_eq!(ready.state, "ready");
        assert!(ready.error.is_none());
        assert!(ready.queue.is_some());
        assert_eq!(
            job(&c, &ids[1]).unwrap().error.as_deref(),
            Some("Transfer failed")
        );
    }
    #[test]
    fn staged_limits_are_frozen_when_new_link_defaults_change() {
        let mut c = connection();
        let first = stage(&mut c, &["https://example.com/old".into()])
            .unwrap()
            .remove(0);
        let mut changed = preferences::Preferences::default();
        changed.options.limits = policy::Limits {
            file_mib: 8192,
            work_mib: 16384,
            free_mib: 1024,
            minutes: 90,
        };
        c.execute(
            "INSERT INTO media_download_preferences(singleton,settings_json) VALUES(1,?1)",
            [serde_json::to_string(&changed).unwrap()],
        )
        .unwrap();
        let second = stage(&mut c, &["https://example.com/new".into()])
            .unwrap()
            .remove(0);
        assert_eq!(
            job(&c, &first).unwrap().options.limits,
            policy::Limits::default()
        );
        assert_eq!(
            job(&c, &second).unwrap().options.limits,
            changed.options.limits
        );
    }
    #[test]
    fn rollback_retains_no_half_batch_or_queue_receipts() {
        let mut c = connection();
        c.execute_batch("CREATE TRIGGER fail_queue BEFORE INSERT ON media_download_queue BEGIN SELECT RAISE(FAIL,'injected'); END;").unwrap();
        assert!(stage(&mut c, &["https://example.com/a".into()]).is_err());
        assert!(jobs(&c).unwrap().is_empty());
    }
    #[test]
    fn reordering_requires_exact_current_set_and_removal_cascades() {
        let mut c = connection();
        let ids = stage(
            &mut c,
            &[
                "https://example.com/a".into(),
                "https://example.com/b".into(),
            ],
        )
        .unwrap();
        assert!(reorder(&mut c, &ids[..1]).is_err());
        assert!(reorder(&mut c, &[ids[0].clone(), ids[0].clone()]).is_err());
        reorder(&mut c, &[ids[1].clone(), ids[0].clone()]).unwrap();
        assert_eq!(job(&c, &ids[1]).unwrap().queue.unwrap().position, 1);
        c.execute("DELETE FROM media_downloads WHERE id=?1", [&ids[0]])
            .unwrap();
        assert_eq!(entries(&c).unwrap().len(), 1);
    }
    #[test]
    fn matching_outputs_wait_for_receipts_without_blocking_distinct_variants() {
        let mut c = connection();
        let ids = stage(
            &mut c,
            &[
                "https://example.com/a".into(),
                "https://example.com/b".into(),
            ],
        )
        .unwrap();
        let mut a = job(&c, &ids[0]).unwrap();
        let mut b = job(&c, &ids[1]).unwrap();
        let meta = policy::metadata(&serde_json::json!({"title":"Fixture", "extractor_key":"Youtube", "id":"same", "duration":4}), "https://example.com/a").unwrap();
        a.metadata = Some(meta.clone());
        b.metadata = Some(meta);
        let active = BTreeSet::from([a.id.clone()]);
        assert!(reserved(&b, &[a.clone(), b.clone()], &active).unwrap());
        a.state = "ready".into();
        assert!(reserved(&b, &[a.clone(), b.clone()], &BTreeSet::new()).unwrap());
        b.options.retries = 10;
        b.options.fragments = 8;
        assert!(reserved(&b, &[a.clone(), b.clone()], &active).unwrap());
        b.preset = policy::Preset::AudioMp3;
        assert!(!reserved(&b, &[a.clone(), b.clone()], &active).unwrap());
        b.preset = a.preset.clone();
        b.options.skip_duplicates = false;
        assert!(!reserved(&b, &[a.clone(), b.clone()], &active).unwrap());
        b.options.skip_duplicates = true;
        a.state = "failed".into();
        assert!(!reserved(&b, &[a, b.clone()], &BTreeSet::new()).unwrap());
    }
    #[test]
    fn cold_rows_do_not_grant_runtime_execution() {
        let mut c = connection();
        let ids = stage(&mut c, &["https://example.com/a".into()]).unwrap();
        c.execute(
            "UPDATE media_download_queue SET resume_transfer=1 WHERE job_id=?1",
            [&ids[0]],
        )
        .unwrap();
        state(&c, &ids[0], "paused", None).unwrap();
        assert!(job(&c, &ids[0]).unwrap().queue.unwrap().resume_transfer);
        assert_eq!(job(&c, &ids[0]).unwrap().state, "paused");
        let fresh = Runtime {
            running: false,
            concurrency: 1,
            epoch: 0,
            permitted: BTreeSet::new(),
            owner: None,
            error: None,
            note: None,
        };
        assert!(!fresh.running);
        assert!(fresh.permitted.is_empty());
    }
}
