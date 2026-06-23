// Fetch a site's HTML for no-LLM brand extraction (URL → brand).
//
// open-design's `buildFromUrl` derives a whole design system from a site URL
// with no model call: prefetch the page, read its colors/fonts/name, collapse
// to a seed, run the token engine. This is the thin fetch side-effect; the pure
// extraction + token derivation live on the frontend (brandFromSite.ts +
// tokenEngine.ts). Capped + UA-spoofed so most sites respond.

use std::time::Duration;

const MAX_BYTES: usize = 2_000_000;

/// Add a scheme when the user typed a bare host. Pure.
pub fn normalize_url(input: &str) -> String {
    let t = input.trim();
    if t.is_empty() {
        return t.to_string();
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        t.to_string()
    } else {
        format!("https://{}", t.trim_start_matches('/'))
    }
}

#[tauri::command]
pub async fn xdesign_fetch_url(url: String) -> Result<String, String> {
    let url = normalize_url(&url);
    if url.is_empty() {
        return Err("empty url".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; OrionTerminal/1.0; +brand-extract)")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let capped = &bytes[..bytes.len().min(MAX_BYTES)];
    Ok(String::from_utf8_lossy(capped).to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn adds_https_to_bare_host() {
        assert_eq!(normalize_url("stripe.com"), "https://stripe.com");
        assert_eq!(normalize_url("  vercel.com/ "), "https://vercel.com/");
    }

    #[test]
    fn keeps_existing_scheme() {
        assert_eq!(normalize_url("http://x.dev"), "http://x.dev");
        assert_eq!(normalize_url("https://x.dev"), "https://x.dev");
    }

    #[test]
    fn empty_stays_empty() {
        assert_eq!(normalize_url("   "), "");
    }
}
