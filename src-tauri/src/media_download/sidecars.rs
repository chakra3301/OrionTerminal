use super::{captions, db, engine, export, id_check, lease, playback, sidecar_source::Source};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::watch;

const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const FORMATS: &str = "mov,matroska,mp3,flac,ogg,wav,aac";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub index: u32,
    pub codec: String,
    pub language: String,
    pub title: String,
    pub supported: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub start: f64,
    pub end: f64,
    pub title: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Indexed {
    pub stream_index: u32,
    pub language: String,
    pub cues: u32,
    pub stale: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub review_id: String,
    pub asset_id: String,
    pub title: String,
    pub duration: f64,
    pub tracks: Vec<Track>,
    pub chapters: Vec<Chapter>,
    pub indexed: Option<Indexed>,
}
#[derive(Clone)]
struct Review {
    profile: PathBuf,
    revision: String,
    details: Details,
    expires: Instant,
}
struct Running {
    profile: PathBuf,
    cancel: watch::Sender<bool>,
    phase: Arc<AtomicU8>,
}
#[derive(Default)]
struct Runtime {
    reviews: BTreeMap<String, Review>,
    running: BTreeMap<String, Running>,
    cancelled: BTreeMap<String, (PathBuf, Instant)>,
}
impl Runtime {
    fn cancel(&mut self, profile: PathBuf, id: String) -> Result<(), String> {
        self.cancelled
            .retain(|_, (_, expiry)| *expiry > Instant::now());
        if let Some(running) = self.running.get(&id) {
            if running.profile != profile {
                return Err("This caption operation belongs to another profile.".into());
            }
            if running.phase.load(Ordering::SeqCst) == 3 {
                return Err(
                    "Finishing the sidecar/index publication. Wait for it to finish.".into(),
                );
            }
            let _ = running.cancel.send(true);
        } else {
            while self.cancelled.len() >= 64 {
                let key = self
                    .cancelled
                    .iter()
                    .min_by_key(|(_, (_, expiry))| *expiry)
                    .unwrap()
                    .0
                    .clone();
                self.cancelled.remove(&key);
            }
            self.cancelled
                .insert(id, (profile, Instant::now() + Duration::from_secs(600)));
        }
        Ok(())
    }
}
static RUNTIME: Lazy<Mutex<Runtime>> = Lazy::new(|| Mutex::new(Runtime::default()));
struct Operation {
    id: String,
    phase: Arc<AtomicU8>,
    _owner: Arc<lease::Owner>,
}
impl Drop for Operation {
    fn drop(&mut self) {
        RUNTIME.lock().running.remove(&self.id);
    }
}
fn profile(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}
fn operation(app: &AppHandle, id: &str) -> Result<(Operation, watch::Receiver<bool>), String> {
    id_check(id)?;
    let profile = profile(app)?;
    let owner = lease::acquire(app)?;
    let mut runtime = RUNTIME.lock();
    runtime
        .cancelled
        .retain(|_, (_, expiry)| *expiry > Instant::now());
    if runtime
        .cancelled
        .get(id)
        .is_some_and(|(owner, _)| owner == &profile)
    {
        return Err("Caption/sidecar operation stopped before it started.".into());
    }
    if !runtime.running.is_empty() {
        return Err(
            "A caption/sidecar operation is already running. Finish or cancel it first.".into(),
        );
    }
    let (cancel, receiver) = watch::channel(false);
    let phase = Arc::new(AtomicU8::new(0));
    runtime.running.insert(
        id.into(),
        Running {
            profile,
            cancel,
            phase: phase.clone(),
        },
    );
    Ok((
        Operation {
            id: id.into(),
            phase,
            _owner: owner,
        },
        receiver,
    ))
}
fn stopped(cancel: &watch::Receiver<bool>) -> Result<(), String> {
    if *cancel.borrow() {
        Err("Caption/sidecar operation stopped.".into())
    } else {
        Ok(())
    }
}
fn saving(operation: &Operation, cancel: &watch::Receiver<bool>) -> Result<(), String> {
    let runtime = RUNTIME.lock();
    stopped(cancel)?;
    if !runtime.running.contains_key(&operation.id) {
        return Err("Caption/sidecar operation is no longer active.".into());
    }
    operation.phase.store(3, Ordering::SeqCst);
    Ok(())
}
fn review(app: &AppHandle, id: &str) -> Result<Review, String> {
    id_check(id)?;
    let profile = profile(app)?;
    let mut runtime = RUNTIME.lock();
    runtime.reviews.retain(|_, r| r.expires > Instant::now());
    runtime
        .reviews
        .get(id)
        .filter(|r| r.profile == profile)
        .cloned()
        .ok_or_else(|| "Saved-file inspection expired. Inspect the file again.".into())
}
fn source(app: &AppHandle, review: &Review) -> Result<Source, String> {
    let (path, _) = export::source(app, &review.details.asset_id)?;
    let source = Source::open(&path)?;
    if source.revision() != review.revision {
        return Err(
            "The saved file changed. Inspect it again before exporting or indexing.".into(),
        );
    }
    Ok(source)
}
fn current(app: &AppHandle, review: &Review, source: &Source) -> Result<(), String> {
    source.check()?;
    let current = self::source(app, review)?;
    current.check()
}
fn text(value: Option<&str>, limit: usize) -> String {
    value
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .take(limit)
        .collect()
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}
fn facts(v: &Value) -> Result<(f64, Vec<Track>, Vec<Chapter>), String> {
    let duration = number(&v["format"]["duration"])
        .filter(|n| *n > 0.0)
        .ok_or("Cannot verify the saved file duration.")?;
    let streams = v["streams"]
        .as_array()
        .filter(|s| s.len() <= 256)
        .ok_or("Saved-file stream inventory is unavailable or too large.")?;
    if !streams
        .iter()
        .any(|s| matches!(s["codec_type"].as_str(), Some("audio" | "video")))
    {
        return Err("This saved file has no audio/video stream.".into());
    }
    let mut tracks = Vec::new();
    for stream in streams.iter().filter(|s| s["codec_type"] == "subtitle") {
        let index = stream["index"]
            .as_u64()
            .filter(|i| *i <= 4095)
            .ok_or("Invalid saved subtitle stream index.")? as u32;
        if tracks.iter().any(|t: &Track| t.index == index) {
            return Err("Duplicate saved subtitle stream index.".into());
        }
        let codec = text(stream["codec_name"].as_str(), 32);
        let supported =
            ["mov_text", "subrip", "webvtt", "ass", "ssa", "text"].contains(&codec.as_str());
        tracks.push(Track {
            index,
            codec,
            language: playback::subtitle_language(stream),
            title: text(stream["tags"]["title"].as_str(), 256),
            supported,
        });
    }
    let mut chapters = Vec::new();
    if !v["chapters"].is_null() && !v["chapters"].is_array() {
        return Err("Invalid saved chapter inventory.".into());
    }
    if let Some(rows) = v["chapters"].as_array() {
        if rows.len() > 2048 {
            return Err("Saved file has too many chapters to export.".into());
        }
        for row in rows {
            let start = number(&row["start_time"]).ok_or("Invalid saved chapter start.")?;
            let end = number(&row["end_time"]).ok_or("Invalid saved chapter end.")?;
            if start < 0.0 || end <= start || start >= duration + 0.01 || end > duration + 1.0 {
                return Err("Saved chapter timing falls outside the source timeline.".into());
            }
            chapters.push(Chapter {
                start,
                end,
                title: text(row["tags"]["title"].as_str(), 256),
            });
        }
        chapters.sort_by(|a, b| a.start.total_cmp(&b.start));
    }
    Ok((duration, tracks, chapters))
}
async fn probe(
    source: &Source,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(f64, Vec<Track>, Vec<Chapter>), String> {
    let program = engine::engines()
        .ffprobe
        .ok_or("ffprobe is required for saved-file inspection.")?;
    let (mut command, input) = source.command(&program)?;
    command.args(["-v","error","-protocol_whitelist","file,pipe","-format_whitelist",FORMATS,"-show_entries","stream=index,codec_type,codec_name:stream_tags=language,title,handler_name:format=duration:chapter=start_time,end_time:chapter_tags=title","-of","json","-i",&input]);
    let bytes = engine::collect(&mut command, 1024 * 1024, cancel).await;
    stopped(cancel)?;
    let bytes = bytes?;
    source.check()?;
    facts(
        &serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| "Invalid saved-file probe response.")?,
    )
}
fn selected(review: &Review, index: Option<u32>) -> Result<&Track, String> {
    review
        .details
        .tracks
        .iter()
        .find(|t| Some(t.index) == index)
        .filter(|t| t.supported)
        .ok_or_else(|| {
            "Choose an actual supported text subtitle track from this saved file.".into()
        })
}
async fn extract(
    source: &Source,
    track: &Track,
    format: &str,
    duration: f64,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Vec<u8>, String> {
    let program = engine::engines()
        .ffmpeg
        .ok_or("FFmpeg is required for caption extraction.")?;
    let (mut command, input) = source.command(&program)?;
    command.args([
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        FORMATS,
        "-i",
        &input,
        "-map",
        &format!("0:{}", track.index),
        "-vn",
        "-an",
        "-dn",
        "-c:s",
        if format == "webvtt" { "webvtt" } else { "srt" },
        "-f",
        format,
        "pipe:1",
    ]);
    let bytes = engine::collect(&mut command, MAX_OUTPUT, cancel).await;
    stopped(cancel)?;
    let bytes = bytes?;
    source.check()?;
    captions::parse(&bytes, Some(duration))?;
    Ok(bytes)
}
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Vtt,
    Srt,
    Chapters,
    Metadata,
}
impl Kind {
    fn extension(self) -> &'static str {
        match self {
            Self::Vtt => "vtt",
            Self::Srt => "srt",
            Self::Chapters | Self::Metadata => "json",
        }
    }
}
fn bounded_json(value: &Value) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_OUTPUT {
        return Err("Sidecar JSON exceeds 4 MiB.".into());
    }
    Ok(bytes)
}
fn metadata(app: &AppHandle, review: &Review) -> Result<Value, String> {
    let c = db(app)?;
    let (title, raw): (String, Option<String>) = c
        .query_row(
            "SELECT title,metadata_json FROM assets WHERE id=?1",
            [&review.details.asset_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "This saved asset is no longer in Media.")?;
    let value = raw
        .filter(|s| s.len() <= 1024 * 1024)
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or(Value::Null);
    Ok(
        json!({"version":1,"assetId":review.details.asset_id,"title":text(Some(&title),2048),"duration":review.details.duration,"tracks":review.details.tracks,"chapters":review.details.chapters,"source":{"site":text(value["site"].as_str(),256),"creator":text(value["creator"].as_str(),512),"description":text(value["description"].as_str(),5000),"sourceId":text(value["sourceId"].as_str(),256)}}),
    )
}
#[tauri::command]
pub async fn media_download_asset_extras(
    app: AppHandle,
    id: String,
    asset_id: String,
) -> Result<Details, String> {
    let (_operation, mut cancel) = operation(&app, &id)?;
    let (path, _) = export::source(&app, &asset_id)?;
    let source = Source::open(&path)?;
    let revision = source.revision();
    let (duration, tracks, chapters) = probe(&source, &mut cancel).await?;
    stopped(&cancel)?;
    let c = db(&app)?;
    let title: String = c
        .query_row("SELECT title FROM assets WHERE id=?1", [&asset_id], |r| {
            r.get(0)
        })
        .map_err(|_| "This saved asset is no longer in Media.")?;
    let indexed=c.query_row("SELECT stream_index,language,cue_count,source_revision FROM asset_transcripts WHERE asset_id=?1",[&asset_id],|r|Ok(Indexed{stream_index:r.get(0)?,language:r.get(1)?,cues:r.get(2)?,stale:r.get::<_,String>(3)?!=revision})).optional().map_err(|e|e.to_string())?;
    let details = Details {
        review_id: ulid::Ulid::new().to_string(),
        asset_id,
        title: text(Some(&title), 2048),
        duration,
        tracks,
        chapters,
        indexed,
    };
    let review = Review {
        profile: profile(&app)?,
        revision,
        details: details.clone(),
        expires: Instant::now() + Duration::from_secs(600),
    };
    current(&app, &review, &source)?;
    let mut runtime = RUNTIME.lock();
    runtime.reviews.retain(|_, r| r.expires > Instant::now());
    while runtime.reviews.len() >= 8 {
        let key = runtime.reviews.keys().next().cloned().unwrap();
        runtime.reviews.remove(&key);
    }
    runtime.reviews.insert(details.review_id.clone(), review);
    Ok(details)
}
use rusqlite::OptionalExtension;
#[tauri::command]
pub fn media_download_sidecar_cancel(app: AppHandle, id: String) -> Result<(), String> {
    id_check(&id)?;
    let profile = profile(&app)?;
    RUNTIME.lock().cancel(profile, id)
}
#[tauri::command]
pub async fn media_download_export_sidecar(
    app: AppHandle,
    id: String,
    review_id: String,
    kind: Kind,
    stream_index: Option<u32>,
) -> Result<Option<String>, String> {
    let (operation, mut cancel) = operation(&app, &id)?;
    let review = review(&app, &review_id)?;
    let source = source(&app, &review)?;
    if matches!(kind, Kind::Vtt | Kind::Srt) {
        selected(&review, stream_index)?;
    }
    if matches!(kind, Kind::Chapters) && review.details.chapters.is_empty() {
        return Err("This saved file has no chapters to export.".into());
    }
    let suffix = match kind {
        Kind::Vtt | Kind::Srt => format!("track-{}.{}", stream_index.unwrap(), kind.extension()),
        Kind::Chapters => "chapters.json".into(),
        Kind::Metadata => "metadata.json".into(),
    };
    let name = export::filename(&review.details.title, &suffix);
    let dialog_app = app.clone();
    operation.phase.store(1, Ordering::SeqCst);
    let target = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Export local sidecar · existing files are never replaced")
            .set_file_name(name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = target else {
        return Ok(None);
    };
    stopped(&cancel)?;
    let target = target
        .into_path()
        .map_err(|_| "Choose a local file destination.")?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if ["media-downloads", "media-download-auth"]
        .iter()
        .any(|root| target.starts_with(data.join(root)))
    {
        return Err(
            "Choose a folder outside Orion’s disposable download/authentication scratch storage."
                .into(),
        );
    }
    if target.extension().and_then(|s| s.to_str()) != Some(kind.extension()) {
        return Err(format!("Keep the .{} sidecar extension.", kind.extension()));
    }
    current(&app, &review, &source)?;
    operation.phase.store(2, Ordering::SeqCst);
    let bytes = match kind {
        Kind::Vtt | Kind::Srt => {
            extract(
                &source,
                selected(&review, stream_index)?,
                if matches!(kind, Kind::Vtt) {
                    "webvtt"
                } else {
                    "srt"
                },
                review.details.duration,
                &mut cancel,
            )
            .await?
        }
        Kind::Chapters => bounded_json(
            &json!({"version":1,"assetId":review.details.asset_id,"title":review.details.title,"duration":review.details.duration,"chapters":review.details.chapters}),
        )?,
        Kind::Metadata => bounded_json(&metadata(&app, &review)?)?,
    };
    current(&app, &review, &source)?;
    saving(&operation, &cancel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        current(&app, &review, &source)?;
        export::export_bytes(&bytes, &target)?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn media_download_index_captions(
    app: AppHandle,
    id: String,
    review_id: String,
    stream_index: u32,
) -> Result<Indexed, String> {
    let (operation, mut cancel) = operation(&app, &id)?;
    let review = review(&app, &review_id)?;
    let source = source(&app, &review)?;
    let track = selected(&review, Some(stream_index))?.clone();
    let bytes = extract(
        &source,
        &track,
        "webvtt",
        review.details.duration,
        &mut cancel,
    )
    .await?;
    let cues = captions::parse(&bytes, Some(review.details.duration))?;
    let plaintext = cues
        .iter()
        .map(|c| c.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    if plaintext.len() > 2 * 1024 * 1024 {
        return Err("Indexed captions exceed 2 MiB.".into());
    }
    saving(&operation, &cancel)?;
    tauri::async_runtime::spawn_blocking(move||{
        let _operation = operation;
        current(&app,&review,&source)?;let mut c=db(&app)?;let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        current(&app,&review,&source)?;
        tx.execute("INSERT INTO asset_transcripts(asset_id,source_revision,schema_version,stream_index,codec,language,plaintext,cue_count,indexed_at) VALUES (?1,?2,1,?3,?4,?5,?6,?7,?8) ON CONFLICT(asset_id) DO UPDATE SET source_revision=excluded.source_revision,schema_version=1,stream_index=excluded.stream_index,codec=excluded.codec,language=excluded.language,plaintext=excluded.plaintext,cue_count=excluded.cue_count,indexed_at=excluded.indexed_at",rusqlite::params![review.details.asset_id,review.revision,track.index,track.codec,track.language,plaintext,cues.len() as u32,i64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Cannot record caption index time.")?.as_millis()).map_err(|_|"Cannot record caption index time.")?]).map_err(|e|e.to_string())?;
        source.check()?;tx.commit().map_err(|e|e.to_string())?;Ok(Indexed{stream_index:track.index,language:track.language,cues:cues.len() as u32,stale:false})
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn media_download_clear_captions(
    app: AppHandle,
    id: String,
    asset_id: String,
) -> Result<(), String> {
    let (operation, cancel) = operation(&app, &id)?;
    saving(&operation, &cancel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        id_check(&asset_id)?;
        let _owner = lease::acquire(&app)?;
        db(&app)?
            .execute(
                "DELETE FROM asset_transcripts WHERE asset_id=?1",
                [asset_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub asset_id: String,
    pub title: String,
    pub snippet: String,
}
pub(crate) fn refresh_caption_matches(
    c: &rusqlite::Connection,
    query: &str,
) -> Result<bool, String> {
    if !c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_transcripts')",[],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())? {return Ok(false);}
    if query.len() > 8192 {
        return Err("Archive keyword query is too long.".into());
    }
    let mut after = String::new();
    let mut changed = false;
    let mut affected = Vec::new();
    let mut all = false;
    loop {
        let rows = {
            let mut statement = c.prepare("SELECT t.asset_id,t.source_revision,a.file_path,a.kind FROM asset_transcripts t JOIN assets a ON a.id=t.asset_id JOIN search_index ON search_index.entity_id=a.id AND search_index.entity_type='asset' WHERE search_index MATCH ?1 AND t.asset_id>?2 ORDER BY t.asset_id LIMIT 64").map_err(|e|e.to_string())?;
            let rows = statement
                .query_map(rusqlite::params![query, after], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        if rows.is_empty() {
            break;
        }
        for (id, revision, path, kind) in rows {
            after = id.clone();
            let valid = matches!(kind.as_str(), "audio" | "video")
                && path
                    .as_deref()
                    .and_then(|p| Source::open(std::path::Path::new(p)).ok())
                    .is_some_and(|source| source.revision() == revision);
            if !valid {
                if c.execute(
                    "DELETE FROM asset_transcripts WHERE asset_id=?1 AND source_revision=?2",
                    rusqlite::params![id, revision],
                )
                .map_err(|e| e.to_string())?
                    > 0
                {
                    changed = true;
                    if affected.len() < 256 {
                        affected.push(id);
                    } else {
                        all = true;
                    }
                }
            }
        }
    }
    if changed {
        if let Some(app) = crate::app_handle::current() {
            let expected = app.path().app_config_dir().ok().map(|p| p.join("orion.db"));
            if c.path()
                .map(std::path::Path::new)
                .is_some_and(|p| expected.as_deref() == Some(p))
            {
                use tauri::Emitter;
                let _ = app.emit(
                    "archive-captions-changed",
                    if all { Vec::<String>::new() } else { affected },
                );
            }
        }
    }
    Ok(changed)
}
#[tauri::command]
pub async fn media_download_refresh_caption_matches(
    app: AppHandle,
    query: String,
) -> Result<bool, String> {
    if query.len() > 8192 {
        return Err("Archive keyword query is too long.".into());
    }
    tauri::async_runtime::spawn_blocking(move || refresh_caption_matches(&db(&app)?, &query))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn media_download_search_captions(
    app: AppHandle,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let query = captions::search_query(&query)?;
    tauri::async_runtime::spawn_blocking(move || {
        let c = db(&app)?;
        refresh_caption_matches(&c, &query)?;
        caption_hits(&c, &query, |asset_id, revision| {
            let Ok((path, _)) = export::source(&app, asset_id) else {
                return false;
            };
            Source::open(&path).is_ok_and(|source| source.revision() == revision)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn caption_hits(
    c: &rusqlite::Connection,
    query: &str,
    mut valid: impl FnMut(&str, &str) -> bool,
) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut statement=c.prepare("SELECT a.id,a.title,snippet(search_index,3,'','',' … ',20),t.source_revision FROM search_index JOIN assets a ON a.id=search_index.entity_id JOIN asset_transcripts t ON t.asset_id=a.id WHERE search_index MATCH ?1 AND entity_type='asset' ORDER BY bm25(search_index),a.id").map_err(|e|e.to_string())?;
    let candidates = statement
        .query_map([query], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for candidate in candidates {
        let (asset_id, title, snippet, revision) = candidate.map_err(|e| e.to_string())?;
        if !seen.insert(asset_id.clone()) || !valid(&asset_id, &revision) {
            continue;
        }
        results.push(SearchResult {
            asset_id,
            title: text(Some(&title), 2048),
            snippet: text(Some(&snippet), 1200),
        });
        if results.len() == 20 {
            break;
        }
    }
    Ok(results)
}

#[cfg(test)]
#[path = "sidecar_fixture.rs"]
mod fixture;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn database(foreign_keys: bool) -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", foreign_keys).unwrap();
        c.execute_batch(include_str!("../../migrations/0001_init.sql"))
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0004_fix_search_triggers.sql"
        ))
        .unwrap();
        c.execute_batch(include_str!("../../migrations/0039_asset_transcripts.sql"))
            .unwrap();
        c.execute("INSERT INTO assets(id,kind,title,file_path,created_at) VALUES ('asset','video','Generated clip','/synthetic/asset.mp4',0)",[]).unwrap();
        c
    }
    fn index(c: &rusqlite::Connection, text: &str) {
        c.execute("INSERT INTO asset_transcripts VALUES ('asset','revision',1,3,'mov_text','en',?1,2,0) ON CONFLICT(asset_id) DO UPDATE SET plaintext=excluded.plaintext",[text]).unwrap();
    }
    fn hits(c: &rusqlite::Connection, query: &str) -> u32 {
        c.query_row(
            "SELECT count(*) FROM search_index WHERE search_index MATCH ?1 AND entity_type='asset'",
            [captions::search_query(query).unwrap()],
            |r| r.get(0),
        )
        .unwrap()
    }
    #[test]
    fn legacy_archive_search_without_caption_schema_remains_readable() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../migrations/0001_init.sql"))
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0004_fix_search_triggers.sql"
        ))
        .unwrap();
        c.execute("INSERT INTO assets(id,kind,title,file_path,created_at) VALUES ('legacy','video','Quasar clip','/synthetic/none.mp4',0)",[]).unwrap();
        assert!(!refresh_caption_matches(&c, &captions::search_query("quasar").unwrap()).unwrap());
        assert_eq!(hits(&c, "quasar"), 1);
    }
    #[test]
    fn caption_cursor_does_not_skip_remaining_hits_during_concurrent_cleanup() {
        let root = std::env::temp_dir().join(format!("orion-caption-cursor-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let path = root.join("synthetic.db");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.pragma_update(None, "journal_mode", "WAL").unwrap();
        c.execute_batch(include_str!("../../migrations/0001_init.sql"))
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0004_fix_search_triggers.sql"
        ))
        .unwrap();
        c.execute_batch(include_str!("../../migrations/0039_asset_transcripts.sql"))
            .unwrap();
        for n in 0..100 {
            let id = format!("{n:026}");
            c.execute("INSERT INTO assets(id,kind,title,file_path,created_at) VALUES (?1,'video','Synthetic clip','/synthetic/none.mp4',0)",[&id]).unwrap();
            c.execute("INSERT INTO asset_transcripts VALUES (?1,'revision',1,3,'mov_text','en','quasar signal',2,0)",[&id]).unwrap();
        }
        let writer = rusqlite::Connection::open(&path).unwrap();
        let mut checked = 0;
        let found = caption_hits(&c, &captions::search_query("quasar").unwrap(), |_, _| {
            checked += 1;
            if checked == 1 {
                writer
                    .execute("DELETE FROM assets WHERE id<?1", [format!("{:026}", 64)])
                    .unwrap();
            }
            checked > 64
        })
        .unwrap();
        assert_eq!(found.len(), 20);
        assert_eq!(found[0].asset_id, format!("{:026}", 64));
        assert_eq!(found[19].asset_id, format!("{:026}", 83));
        assert_eq!(checked, 84);
        drop(writer);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn indexed_captions_survive_asset_updates_and_replace_without_duplicate_hits() {
        let c = database(true);
        index(&c, "quasar initial captions");
        assert_eq!(hits(&c, "quasar"), 1);
        c.execute(
            "UPDATE assets SET title='New title',metadata_json='{}' WHERE id='asset'",
            [],
        )
        .unwrap();
        assert_eq!(hits(&c, "quasar"), 1);
        index(&c, "nebula replacement captions");
        assert_eq!(hits(&c, "quasar"), 0);
        assert_eq!(hits(&c, "nebula"), 1);
        let count: u32 = c
            .query_row(
                "SELECT count(*) FROM search_index WHERE entity_id='asset' AND entity_type='asset'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        c.execute("DELETE FROM asset_transcripts WHERE asset_id='asset'", [])
            .unwrap();
        assert_eq!(hits(&c, "nebula"), 0);
        assert_eq!(hits(&c, "new title"), 1);
    }
    #[test]
    fn source_replacement_and_asset_deletion_clear_captions_with_foreign_keys_on_or_off() {
        for foreign_keys in [true, false] {
            let c = database(foreign_keys);
            index(&c, "quasar captions");
            c.execute(
                "UPDATE assets SET file_path='/synthetic/new.mp4' WHERE id='asset'",
                [],
            )
            .unwrap();
            assert_eq!(hits(&c, "quasar"), 0);
            index(&c, "nebula captions");
            c.execute("DELETE FROM assets WHERE id='asset'", [])
                .unwrap();
            let docs: u32 = c
                .query_row("SELECT count(*) FROM asset_transcripts", [], |r| r.get(0))
                .unwrap();
            assert_eq!(docs, 0);
            assert_eq!(hits(&c, "nebula"), 0);
            assert_eq!(hits(&c, "generated"), 0);
            let rows: u32 = c
                .query_row(
                    "SELECT count(*) FROM search_index WHERE entity_type='asset'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(rows, 0);
        }
    }
    #[test]
    fn failed_index_replacement_keeps_previous_text_and_no_orphan_search_rows() {
        let c = database(false);
        index(&c, "quasar caption");
        assert!(c
            .execute(
                "UPDATE asset_transcripts SET plaintext=?1 WHERE asset_id='asset'",
                ["x".repeat(2 * 1024 * 1024 + 1)]
            )
            .is_err());
        assert_eq!(hits(&c, "quasar"), 1);
        c.execute("DELETE FROM assets WHERE id='asset'", [])
            .unwrap();
        c.execute("INSERT INTO asset_transcripts VALUES ('absent','revision',1,0,'webvtt','und','orphan quasar',1,0)",[]).unwrap();
        assert_eq!(hits(&c, "quasar"), 0);
        c.execute("DELETE FROM asset_transcripts WHERE asset_id='absent'", [])
            .unwrap();
        assert_eq!(hits(&c, "quasar"), 0);
    }
    fn probe_fixture() -> Value {
        json!({"format":{"duration":"12"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264"},{"index":3,"codec_type":"subtitle","codec_name":"mov_text","tags":{"language":"por","title":"Orion caption: pt-BR"}},{"index":4,"codec_type":"subtitle","codec_name":"hdmv_pgs_subtitle","tags":{}}],"chapters":[{"start_time":"0","end_time":"6","tags":{"title":"First"}},{"start_time":"6","end_time":"12","tags":{"title":"Second"}}]})
    }
    #[test]
    fn actual_track_indices_and_chapter_rows_are_not_source_availability_summaries() {
        let (duration, tracks, chapters) = facts(&probe_fixture()).unwrap();
        assert_eq!(duration, 12.0);
        assert_eq!(tracks[0].index, 3);
        assert!(tracks[0].supported);
        assert!(!tracks[1].supported);
        assert_eq!(tracks[1].language, "und");
        assert_eq!(chapters[1].start, 6.0);
        assert_eq!(chapters[1].title, "Second");
        let mut v = probe_fixture();
        v["streams"][2]["index"] = json!(3);
        assert!(facts(&v).is_err());
        let mut v = probe_fixture();
        v["chapters"][0]["end_time"] = json!("99");
        assert!(facts(&v).is_err());
        let mut v = probe_fixture();
        v["chapters"] = json!({});
        assert!(facts(&v).is_err());
        let mut v = probe_fixture();
        v["format"]["duration"] = json!("NaN");
        assert!(facts(&v).is_err());
    }
    #[test]
    fn stale_caption_matches_are_pruned_before_shared_ranking_without_losing_asset_metadata() {
        let c = database(false);
        let root =
            std::env::temp_dir().join(format!("orion-caption-ranking-{}", ulid::Ulid::new()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("generated.mp4");
        std::fs::write(&path, b"version metadata only; no media probe required").unwrap();
        let source = Source::open(&path).unwrap();
        let revision = source.revision();
        for n in 0..85 {
            let id = format!("rank-{n:03}");
            c.execute("INSERT INTO assets(id,kind,title,file_path,created_at) VALUES (?1,'video','Generated quasar title',?2,0)",rusqlite::params![id,path.to_str().unwrap()]).unwrap();
            c.execute("INSERT INTO asset_transcripts VALUES (?1,?2,1,0,'webvtt','en','nebula captions',1,0)",rusqlite::params![id,if n==84 {revision.as_str()}else{"stale"}]).unwrap();
        }
        let query = captions::search_query("nebula").unwrap();
        assert!(refresh_caption_matches(&c, &query).unwrap());
        assert_eq!(hits(&c, "nebula"), 1);
        assert_eq!(hits(&c, "quasar"), 85);
        assert!(!refresh_caption_matches(&c, &query).unwrap());
        std::fs::write(&path, b"changed in place").unwrap();
        assert!(refresh_caption_matches(&c, &query).unwrap());
        assert_eq!(hits(&c, "nebula"), 0);
        assert_eq!(hits(&c, "quasar"), 85);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancellation_is_profile_bound_bounded_and_late_publication_refuses_stop() {
        let mut runtime = Runtime::default();
        let profile = PathBuf::from("/generated/profile");
        runtime.cancel(profile.clone(), "early".into()).unwrap();
        assert_eq!(runtime.cancelled["early"].0, profile);
        for n in 0..80 {
            runtime
                .cancel(profile.clone(), format!("test-{n}"))
                .unwrap();
        }
        assert_eq!(runtime.cancelled.len(), 64);
        let (cancel, receiver) = watch::channel(false);
        let phase = Arc::new(AtomicU8::new(0));
        runtime.running.insert(
            "running".into(),
            Running {
                profile: profile.clone(),
                cancel,
                phase: phase.clone(),
            },
        );
        assert!(runtime
            .cancel(PathBuf::from("/other"), "running".into())
            .is_err());
        assert!(!*receiver.borrow());
        phase.store(3, Ordering::SeqCst);
        assert!(runtime
            .cancel(profile.clone(), "running".into())
            .unwrap_err()
            .contains("Finishing"));
        assert!(!*receiver.borrow());
        phase.store(2, Ordering::SeqCst);
        runtime.cancel(profile, "running".into()).unwrap();
        assert!(*receiver.borrow());
    }
    #[test]
    fn serialized_sidecars_are_bounded_after_json_escaping() {
        assert!(bounded_json(&json!({"text":"\"".repeat(MAX_OUTPUT)})).is_err());
        assert!(
            bounded_json(&json!({"version":1,"chapters":[]}))
                .unwrap()
                .len()
                < 100
        );
    }
}
