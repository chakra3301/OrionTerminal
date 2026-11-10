use super::{db, engine, id_check, lease, policy, private_dir, queue, Active, ACTIVE};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub index: u16,
    pub title: String,
    pub url: Option<String>,
    pub duration: Option<f64>,
    pub unavailable: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    pub source_url: String,
    pub title: String,
    pub entries: Vec<Item>,
    pub truncated: bool,
}
struct Saved {
    profile: PathBuf,
    review: Review,
    created: Instant,
}
static REVIEWS: Lazy<Mutex<BTreeMap<String, Saved>>> = Lazy::new(|| Mutex::new(BTreeMap::new()));
fn text(value: &Value, key: &str, limit: usize) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}
fn item_url(v: &Value) -> Option<String> {
    if matches!(
        v.get("_type").and_then(Value::as_str),
        Some("playlist" | "multi_video")
    ) {
        return None;
    }
    for key in ["webpage_url", "url"] {
        if let Some(url) = v.get(key).and_then(Value::as_str) {
            if policy::url(url).is_ok() {
                return Some(url.to_owned());
            }
        }
    }
    let id = v.get("id").and_then(Value::as_str)?;
    let extractor = v
        .get("ie_key")
        .or_else(|| v.get("extractor_key"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if extractor.eq_ignore_ascii_case("Youtube")
        && id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Some(format!("https://www.youtube.com/watch?v={id}"));
    }
    if extractor.eq_ignore_ascii_case("Vimeo")
        && !id.is_empty()
        && id.len() <= 16
        && id.bytes().all(|b| b.is_ascii_digit())
    {
        return Some(format!("https://vimeo.com/{id}"));
    }
    None
}
fn parse(id: &str, source: &str, v: &Value) -> Result<Review, String> {
    let entries = v
        .get("entries")
        .and_then(Value::as_array)
        .ok_or("This source did not return a playlist. Inspect it as a single link instead.")?;
    if entries.is_empty() {
        return Err("The playlist contains no visible entries.".into());
    }
    let total = v
        .get("playlist_count")
        .and_then(Value::as_u64)
        .unwrap_or(entries.len() as u64);
    let items = entries
        .iter()
        .take(100)
        .enumerate()
        .map(|(i, v)| {
            let mut url = item_url(v);
            let restricted = v
                .get("availability")
                .and_then(Value::as_str)
                .is_some_and(|a| !matches!(a, "public" | "unlisted"));
            if restricted {
                url = None;
            }
            let unavailable = if url.is_none() {
                Some("Unavailable, restricted, nested, or missing a safe public link".into())
            } else {
                None
            };
            Item {
                index: i as u16 + 1,
                title: {
                    let t = text(v, "title", 320);
                    if t.is_empty() {
                        format!("Entry {}", i + 1)
                    } else {
                        t
                    }
                },
                url,
                duration: v
                    .get("duration")
                    .and_then(Value::as_f64)
                    .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 86400.0),
                unavailable,
            }
        })
        .collect();
    Ok(Review {
        id: id.into(),
        source_url: source.into(),
        title: {
            let title = text(v, "title", 320);
            if title.is_empty() {
                "Playlist".into()
            } else {
                title
            }
        },
        entries: items,
        truncated: entries.len() > 100 || total > 100,
    })
}
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[tauri::command]
pub async fn media_download_playlist(
    app: AppHandle,
    id: String,
    url: String,
) -> Result<Review, String> {
    id_check(&id)?;
    policy::url(&url)?;
    let owner = lease::acquire(&app)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("media-download-plans");
    private_dir(&base)?;
    let dir = base.join(&id);
    // A scan never adopts an old directory or consumes an existing download's cancellation identity.
    let recv = {
        let mut a = ACTIVE.lock();
        if a.len() >= 3 || a.contains_key(&id) {
            return Err(
                "Download workers are busy. Wait or hold the queue before scanning.".into(),
            );
        }
        if db(&app)?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM media_downloads WHERE id=?1)",
                [&id],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?
        {
            return Err("This scan identity is already in use.".into());
        }
        if dir.try_exists().map_err(|e| e.to_string())? {
            return Err("This scan identity already has temporary files. Start a new scan.".into());
        }
        private_dir(&dir)?;
        let (send, recv) = watch::channel(false);
        a.insert(
            id.clone(),
            Active {
                cancel: send,
                progress: engine::Progress {
                    phase: Some("playlist".into()),
                    ..engine::Progress::default()
                },
                paused: false,
                resumable: false,
                work_mib: super::policy::Limits::default().work_mib,
                _owner: owner,
            },
        );
        recv
    };
    scan(app, id, url, dir, recv).await
}
async fn scan(
    app: AppHandle,
    id: String,
    url: String,
    dir: PathBuf,
    mut cancel: watch::Receiver<bool>,
) -> Result<Review, String> {
    let scratch = Scratch(dir);
    let outcome = engine::playlist(&url, &scratch.0, &mut cancel)
        .await
        .and_then(|v| parse(&id, &url, &v));
    let cancelled = *cancel.borrow();
    ACTIVE.lock().remove(&id);
    let review = outcome?;
    if cancelled {
        return Err("Playlist scan canceled. No links were queued.".into());
    }
    let profile = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let mut reviews = REVIEWS.lock();
    reviews.retain(|_, s| s.created.elapsed() < Duration::from_secs(600));
    if reviews.len() >= 8 {
        let oldest = reviews
            .iter()
            .min_by_key(|(_, s)| s.created)
            .map(|(id, _)| id.clone());
        if let Some(oldest) = oldest {
            reviews.remove(&oldest);
        }
    }
    reviews.insert(
        id,
        Saved {
            profile,
            review: review.clone(),
            created: Instant::now(),
        },
    );
    Ok(review)
}
fn selected(review: &Review, indices: &[u16]) -> Result<Vec<String>, String> {
    if indices.is_empty()
        || indices.len() > 50
        || indices.iter().collect::<BTreeSet<_>>().len() != indices.len()
    {
        return Err("Select 1–50 distinct playlist entries.".into());
    }
    let mut urls = Vec::new();
    for index in indices {
        let item = review
            .entries
            .iter()
            .find(|e| e.index == *index)
            .ok_or("Playlist selection changed. Inspect again.")?;
        urls.push(
            item.url
                .clone()
                .ok_or("An unavailable playlist item cannot be queued.")?,
        );
    }
    Ok(urls)
}
#[tauri::command]
pub async fn media_download_playlist_queue(
    app: AppHandle,
    id: String,
    indices: Vec<u16>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _owner = lease::acquire(&app)?;
        id_check(&id)?;
        let profile = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let mut reviews = REVIEWS.lock();
        let saved = reviews
            .get(&id)
            .ok_or("This playlist review expired. Inspect it again.")?;
        if saved.profile != profile || saved.created.elapsed() >= Duration::from_secs(600) {
            return Err("This playlist review expired. Inspect it again.".into());
        }
        let urls = selected(&saved.review, &indices)?;
        let ids = queue::stage(&mut db(&app)?, &urls)?;
        reviews.remove(&id);
        Ok(ids)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn immutable_review_handles_safe_links_ids_and_unavailable_entries() {
        let v = json!({"title":"Examples","entries":[{"title":"First","url":"https://example.com/a"},{"id":"abcdefghijk","ie_key":"Youtube","url":"abcdefghijk"},{"url":"file:///etc/hosts"},{"url":"https://example.com/private","availability":"private"},{"_type":"playlist","url":"https://example.com/nested"}]});
        let review = parse("test", "https://example.com/playlist", &v).unwrap();
        assert_eq!(review.entries.len(), 5);
        assert_eq!(
            selected(&review, &[2, 1]).unwrap(),
            vec![
                "https://www.youtube.com/watch?v=abcdefghijk",
                "https://example.com/a"
            ]
        );
        for selection in [vec![3], vec![4], vec![5], vec![6], vec![1, 1], vec![]] {
            assert!(selected(&review, &selection).is_err());
        }
    }
    #[test]
    fn limits_and_private_link_validation_cannot_be_bypassed() {
        let review=parse("test","https://example.com/p",&json!({"playlist_count":120,"entries":(0..101).map(|_|json!({"url":"http://127.0.0.1/secret"})).collect::<Vec<_>>()})).unwrap();
        assert_eq!(review.entries.len(), 100);
        assert!(review.truncated);
        assert!(review.entries.iter().all(|e| e.url.is_none()));
        assert!(parse("test", "https://example.com/p", &json!({"title":"single"})).is_err());
    }
}
