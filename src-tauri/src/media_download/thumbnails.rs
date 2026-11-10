use super::{engine, policy};
use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::sync::watch;

const CAP: usize = 256 * 1024;
const TTL: Duration = Duration::from_secs(1800);
static CACHE: Lazy<Mutex<BTreeMap<PathBuf, (Instant, String)>>> =
    Lazy::new(|| Mutex::new(BTreeMap::new()));

fn dimensions_ok(w: u32, h: u32) -> bool {
    w > 0 && h > 0 && w <= 4096 && h <= 4096 && u64::from(w) * u64::from(h) <= 4_194_304
}
fn mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() > CAP {
        return None;
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16) == Some(b"IHDR") {
        let w = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
        let h = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
        return dimensions_ok(w, h).then_some("image/png");
    }
    if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return None;
    }
    let mut pos = 2;
    while pos + 4 <= bytes.len() {
        if bytes[pos] != 0xff {
            return None;
        }
        while bytes.get(pos) == Some(&0xff) {
            pos += 1;
        }
        let marker = *bytes.get(pos)?;
        pos += 1;
        if marker == 0xda || marker == 0xd9 {
            return None;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(pos..pos + 2)?.try_into().ok()?) as usize;
        if length < 2 || pos + length > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if length < 8 {
                return None;
            }
            let h = u16::from_be_bytes(bytes.get(pos + 3..pos + 5)?.try_into().ok()?) as u32;
            let w = u16::from_be_bytes(bytes.get(pos + 5..pos + 7)?.try_into().ok()?) as u32;
            return dimensions_ok(w, h).then_some("image/jpeg");
        }
        pos += length;
    }
    None
}
fn candidate(value: &Value) -> Option<String> {
    let valid = |text: &str| {
        policy::url(text)
            .ok()
            .filter(|u| u.scheme() == "https")
            .map(|_| text.to_owned())
    };
    value["thumbnail"].as_str().and_then(valid).or_else(|| {
        value["thumbnails"]
            .as_array()?
            .iter()
            .rev()
            .take(32)
            .find_map(|v| v["url"].as_str().and_then(valid))
    })
}
async fn fetch(url: &str) -> Option<String> {
    let url = policy::url(url).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    let host = url.host_str()?;
    let addresses: Vec<_> = tokio::net::lookup_host((host, url.port_or_known_default()?))
        .await
        .ok()?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|a| !policy::public_ip(a.ip())) {
        return None;
    }
    // Pin this one request to the validated addresses; never inherit browser headers or follow redirects.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .resolve_to_addrs(host, &addresses)
        .build()
        .ok()?;
    let mut response = client
        .get(url)
        .header("Accept", "image/jpeg,image/png")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > CAP as u64)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > CAP {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(format!(
        "data:{};base64,{}",
        mime(&bytes)?,
        STANDARD.encode(bytes)
    ))
}
pub(super) async fn inspect(dir: &Path, value: &Value, cancel: &mut watch::Receiver<bool>) {
    let Some(url) = candidate(value) else {
        return;
    };
    let result = tokio::select! { biased;
        _ = engine::cancelled(cancel) => None,
        result = tokio::time::timeout(Duration::from_secs(6), fetch(&url)) => result.ok().flatten(),
    };
    if let Some(data) = result {
        let mut cache = CACHE.lock();
        cache.retain(|_, (at, _)| at.elapsed() < TTL);
        if cache.len() >= 16 {
            let oldest = cache
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                cache.remove(&oldest);
            }
        }
        cache.insert(dir.to_owned(), (Instant::now(), data));
    }
}
pub(super) fn get(dir: &Path) -> Option<String> {
    let mut cache = CACHE.lock();
    cache.retain(|_, (at, _)| at.elapsed() < TTL);
    cache.get(dir).map(|(_, data)| data.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn previews_accept_only_small_bounded_raster_headers() {
        let png = |w: u32, h: u32| {
            let mut b = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
            b.extend(w.to_be_bytes());
            b.extend(h.to_be_bytes());
            b
        };
        assert_eq!(mime(&png(1280, 720)), Some("image/png"));
        assert_eq!(mime(&png(8192, 8192)), None);
        assert_eq!(mime(&png(0, 20)), None);
        assert_eq!(mime(b"<svg onload='attack()'/>"), None);
        let mut jpg = vec![
            0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 180, 1, 64, 3, 0xff, 0xd9,
        ];
        assert_eq!(mime(&jpg), Some("image/jpeg"));
        jpg[7] = 255;
        assert_eq!(mime(&jpg), None);
        assert_eq!(mime(&vec![0; CAP + 1]), None);
    }
    #[test]
    fn candidates_refuse_non_https_credentials_and_private_hosts() {
        for url in [
            "file:///private/a.jpg",
            "http://example.com/a.jpg",
            "https://localhost/a.jpg",
            "https://u:p@example.com/a.jpg",
            "https://127.0.0.1/a.jpg",
        ] {
            assert!(
                candidate(&serde_json::json!({"thumbnail":url})).is_none(),
                "{url}"
            );
        }
        assert!(candidate(&serde_json::json!({"thumbnail":"https://example.com/a.jpg"})).is_some());
    }
    #[test]
    fn cache_is_profile_path_bound_and_never_serialized_into_source_metadata() {
        let path = Path::new("/synthetic/profile-a/media-downloads/test");
        CACHE.lock().insert(
            path.to_owned(),
            (Instant::now(), "data:image/jpeg;base64,fixture".into()),
        );
        assert!(get(path).is_some());
        assert!(get(Path::new("/synthetic/profile-b/media-downloads/test")).is_none());
        CACHE.lock().remove(path);
    }
}
