// Fetch a site's HTML for no-LLM brand extraction (URL → brand).
//
// open-design's `buildFromUrl` derives a whole design system from a site URL
// with no model call: prefetch the page, read its colors/fonts/name, collapse
// to a seed, run the token engine. This is the thin fetch side-effect; the pure
// extraction + token derivation live on the frontend (brandFromSite.ts +
// tokenEngine.ts). Capped + UA-spoofed so most sites respond.

use futures_util::StreamExt;
use reqwest::{redirect::Policy, Url};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

const MAX_BYTES: usize = 2_000_000;
const MAX_REDIRECTS: usize = 5;
const MAX_URL_LEN: usize = 2_048;

/// Add a scheme when the user typed a bare host. Pure.
pub fn normalize_url(input: &str) -> String {
    let t = input.trim();
    if t.is_empty() {
        return t.to_string();
    }
    if t.contains("://") {
        t.to_string()
    } else {
        format!("https://{}", t.trim_start_matches('/'))
    }
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4() {
                return is_public_v4(v4);
            }
            is_public_v6(ip)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !matches!(
        (a, b, c),
        (0, _, _)
            | (10, _, _)
            | (100, 64..=127, _)
            | (127, _, _)
            | (169, 254, _)
            | (172, 16..=31, _)
            | (192, 0, 0)
            | (192, 0, 2)
            | (192, 88, 99)
            | (192, 168, _)
            | (198, 18..=19, _)
            | (198, 51, 100)
            | (203, 0, 113)
            | (224..=255, _, _)
    )
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let seg = ip.segments();
    !ip.is_unspecified()
        && !ip.is_loopback()
        && !ip.is_multicast()
        && seg[0] & 0xfe00 != 0xfc00
        && seg[0] & 0xffc0 != 0xfe80
        && !(seg[0] == 0x2001 && seg[1] == 0x0db8)
}

fn parse_target(input: &str) -> Result<Url, String> {
    let normalized = normalize_url(input);
    if normalized.is_empty() {
        return Err("empty url".into());
    }
    if normalized.len() > MAX_URL_LEN {
        return Err("url is too long".into());
    }
    let url = Url::parse(&normalized).map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https URLs are allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing credentials are not allowed".into());
    }
    if url.host_str().is_none() {
        return Err("url has no host".into());
    }
    Ok(url)
}

async fn public_addrs(url: &Url) -> Result<(String, Vec<SocketAddr>), String> {
    let host = url
        .host_str()
        .ok_or_else(|| "url has no host".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "url has no usable port".to_string())?;
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| format!("could not resolve host: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err("host resolved to no addresses".into());
    }
    if addrs.iter().any(|addr| !is_public_ip(addr.ip())) {
        return Err("private, loopback, link-local, and reserved hosts are not allowed".into());
    }
    Ok((host, addrs))
}

async fn fetch_public_html(input: &str) -> Result<String, String> {
    let mut url = parse_target(input)?;

    for redirect_count in 0..=MAX_REDIRECTS {
        let (host, addrs) = public_addrs(&url).await?;
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (compatible; OrionTerminal/1.0; +brand-extract)")
            .timeout(Duration::from_secs(20))
            .redirect(Policy::none())
            .resolve_to_addrs(&host, &addrs)
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if resp.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err("too many redirects".into());
            }
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .ok_or_else(|| "redirect had no Location header".to_string())?
                .to_str()
                .map_err(|_| "redirect Location was not valid text".to_string())?;
            url = url
                .join(location)
                .map_err(|e| format!("invalid redirect target: {e}"))?;
            url = parse_target(url.as_str())?;
            continue;
        }

        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        if resp
            .content_length()
            .is_some_and(|len| len > MAX_BYTES as u64)
        {
            return Err(format!("response exceeds {MAX_BYTES} bytes"));
        }

        let mut bytes = Vec::with_capacity(64 * 1024);
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            if bytes.len().saturating_add(chunk.len()) > MAX_BYTES {
                return Err(format!("response exceeds {MAX_BYTES} bytes"));
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(String::from_utf8_lossy(&bytes).to_string());
    }

    Err("too many redirects".into())
}

#[tauri::command]
pub async fn xdesign_fetch_url(url: String) -> Result<String, String> {
    fetch_public_html(&url).await
}

/// Write raw bytes to a user-chosen path (PPTX / video export). The path comes
/// from the save dialog; we just persist the bytes.
#[tauri::command]
pub fn xdesign_save_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &bytes).map_err(|e| format!("write {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{is_public_ip, normalize_url, parse_target};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

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

    #[test]
    fn rejects_non_http_and_credential_urls() {
        assert!(parse_target("file:///etc/passwd").is_err());
        assert!(parse_target("https://user:secret@example.com").is_err());
    }

    #[test]
    fn blocks_non_public_ipv4_ranges() {
        for ip in [
            [0, 0, 0, 0],
            [10, 1, 2, 3],
            [100, 64, 0, 1],
            [127, 0, 0, 1],
            [169, 254, 1, 1],
            [172, 16, 0, 1],
            [192, 168, 1, 1],
            [198, 18, 0, 1],
            [224, 0, 0, 1],
        ] {
            assert!(!is_public_ip(IpAddr::V4(Ipv4Addr::from(ip))), "{ip:?}");
        }
        assert!(is_public_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn blocks_non_public_ipv6_ranges_and_mapped_ipv4() {
        for ip in [
            Ipv6Addr::LOCALHOST,
            "fc00::1".parse().unwrap(),
            "fe80::1".parse().unwrap(),
            "2001:db8::1".parse().unwrap(),
            "::ffff:127.0.0.1".parse().unwrap(),
        ] {
            assert!(!is_public_ip(IpAddr::V6(ip)), "{ip}");
        }
        assert!(is_public_ip(IpAddr::V6(
            "2606:4700:4700::1111".parse().unwrap()
        )));
    }
}
