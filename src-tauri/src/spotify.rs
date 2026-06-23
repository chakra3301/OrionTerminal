//! Spotify "now playing" widget backend — Spotify Web API over OAuth 2.0
//! (Authorization Code with PKCE). Works with ANY active Spotify device
//! (phone / web player / desktop / speakers), not just a local app.
//!
//! Auth: the user registers a (free) Spotify app, pastes its Client ID, and
//! approves once in the browser. We catch the redirect on a loopback port,
//! exchange the code (PKCE — no client secret), and keep only the refresh
//! token + a short-lived access token in the OS keychain. A fresh access
//! token is minted on demand when the cached one nears expiry.
//!
//! Playback CONTROL (play/pause/next/seek) requires Spotify Premium — the API
//! returns 403 otherwise; read-only "now playing" works on free accounts.

use base64::Engine;
use keyring::Entry;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "personal-workstation";
const ACCOUNT: &str = "spotify-oauth:default";
const REDIRECT_PORT: u16 = 8765;
const REDIRECT_URI: &str = "http://127.0.0.1:8765/callback";
const SCOPES: &str =
    "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const API_BASE: &str = "https://api.spotify.com/v1";
const REFRESH_SKEW_SECS: i64 = 60;

// ---------------------------------------------------------------------------
// Returned shapes
// ---------------------------------------------------------------------------

#[derive(Serialize, Default)]
pub struct NowPlaying {
    /// We hold a refresh token (the user has linked Spotify).
    connected: bool,
    /// A playback session exists on some device (200, not 204).
    active: bool,
    is_playing: bool,
    track: String,
    artist: String,
    album: String,
    /// https album-art URL — usable directly as an <img src>.
    artwork_url: String,
    duration_ms: f64,
    position_s: f64,
    /// https open.spotify.com URL for "open in Spotify".
    url: String,
    /// Token is dead and a reconnect is needed (the widget prompts re-link).
    needs_reauth: bool,
}

#[derive(Serialize, Default)]
pub struct SpotifyStatus {
    connected: bool,
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct SpotifyAuth {
    client_id: String,
    refresh_token: String,
    #[serde(default)]
    access_token: String,
    /// Unix seconds when `access_token` expires; 0 = unknown/none.
    #[serde(default)]
    expires_at: i64,
}

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: i64,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// base64url-no-pad of `n` cryptographically-random bytes. Used for the PKCE
/// verifier and the CSRF `state`.
fn rand_token(n: usize) -> String {
    let mut buf = vec![0u8; n];
    getrandom::getrandom(&mut buf).expect("OS RNG");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

/// PKCE S256 challenge: base64url-no-pad( SHA-256( verifier ) ).
fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Percent-encode a query-parameter value (RFC 3986 unreserved kept as-is).
fn pct(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                o.push(b as char)
            }
            _ => o.push_str(&format!("%{:02X}", b)),
        }
    }
    o
}

fn build_authorize_url(client_id: &str, challenge: &str, state: &str) -> String {
    format!(
        "{AUTH_URL}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge_method=S256&code_challenge={}&state={}",
        pct(client_id),
        pct(REDIRECT_URI),
        pct(SCOPES),
        pct(challenge),
        pct(state),
    )
}

/// Pull `code` + `state` out of an HTTP request line like
/// `GET /callback?code=AAA&state=BBB HTTP/1.1`. None if either is absent (e.g.
/// the user denied → `?error=access_denied`).
fn parse_callback_query(request_line: &str) -> Option<(String, String)> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    let mut code = None;
    let mut state = None;
    for kv in query.split('&') {
        if let Some((k, v)) = kv.split_once('=') {
            match k {
                "code" => code = Some(v.to_string()),
                "state" => state = Some(v.to_string()),
                _ => {}
            }
        }
    }
    Some((code?, state?))
}

/// True when the cached access token is missing or within the refresh skew of
/// expiry. Unknown expiry (`<= 0`) is treated as needing refresh.
fn needs_refresh(state: &SpotifyAuth, now: i64) -> bool {
    if state.access_token.trim().is_empty() || state.expires_at <= 0 {
        return true;
    }
    now + REFRESH_SKEW_SECS >= state.expires_at
}

/// Map a transport action to (HTTP method, API path). `playpause` is resolved
/// dynamically (needs current state) so it's handled by the caller, not here.
fn control_endpoint(action: &str) -> Option<(&'static str, &'static str)> {
    match action {
        "play" => Some(("PUT", "/me/player/play")),
        "pause" => Some(("PUT", "/me/player/pause")),
        "next" => Some(("POST", "/me/player/next")),
        "previous" => Some(("POST", "/me/player/previous")),
        _ => None,
    }
}

/// Allowlist for incoming control actions (includes the dynamic `playpause`).
fn is_valid_action(action: &str) -> bool {
    action == "playpause" || control_endpoint(action).is_some()
}

/// Extract the now-playing fields from a `/me/player` 200 body.
fn parse_player(v: &Value) -> NowPlaying {
    let item = v.get("item").cloned().unwrap_or(Value::Null);
    let artist = item
        .get("artists")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let artwork_url = item
        .get("album")
        .and_then(|al| al.get("images"))
        .and_then(|imgs| imgs.as_array())
        .and_then(|arr| arr.first())
        .and_then(|img| img.get("url"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    NowPlaying {
        connected: true,
        active: true,
        is_playing: v.get("is_playing").and_then(|b| b.as_bool()).unwrap_or(false),
        track: item.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        artist,
        album: item
            .get("album")
            .and_then(|al| al.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string(),
        artwork_url,
        duration_ms: item.get("duration_ms").and_then(|d| d.as_f64()).unwrap_or(0.0),
        position_s: v.get("progress_ms").and_then(|p| p.as_f64()).unwrap_or(0.0) / 1000.0,
        url: item
            .get("external_urls")
            .and_then(|e| e.get("spotify"))
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string(),
        needs_reauth: false,
    }
}

// ---------------------------------------------------------------------------
// Keychain state
// ---------------------------------------------------------------------------

// In-process cache so we never depend on a keychain read-back (unsigned/dev
// builds can have writes accepted but immediate reads denied). The cache is
// the source of truth for the running session; keychain + a config-dir file
// provide cross-restart durability (whichever survives).
static AUTH_CACHE: Lazy<Mutex<Option<SpotifyAuth>>> = Lazy::new(|| Mutex::new(None));

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Secret storage unavailable ({e})"))
}

/// Durable plaintext fallback next to orion.db (app config dir, user-only).
/// Personal local app — comparable to how the DB itself is stored.
fn auth_file() -> Option<PathBuf> {
    std::env::var_os("ORION_DB_PATH").map(|p| PathBuf::from(p).with_file_name("spotify-auth.json"))
}

fn read_durable() -> Option<SpotifyAuth> {
    // keychain first, then the file fallback.
    if let Some(s) = entry()
        .and_then(|e| e.get_password().map_err(|e| e.to_string()))
        .ok()
        .and_then(|s| serde_json::from_str::<SpotifyAuth>(&s).ok())
    {
        if !s.refresh_token.trim().is_empty() {
            return Some(s);
        }
    }
    let path = auth_file()?;
    let txt = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<SpotifyAuth>(&txt)
        .ok()
        .filter(|s| !s.refresh_token.trim().is_empty())
}

fn load_state() -> SpotifyAuth {
    if let Some(s) = AUTH_CACHE.lock().clone() {
        return s;
    }
    let s = read_durable().unwrap_or_default();
    if !s.refresh_token.trim().is_empty() {
        *AUTH_CACHE.lock() = Some(s.clone());
    }
    s
}

/// Persist to the session cache (authoritative) plus best-effort durable
/// stores. Never fails on a flaky keychain — the cache + file cover us.
fn save_state(state: &SpotifyAuth) -> Result<(), String> {
    *AUTH_CACHE.lock() = Some(state.clone());
    let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
    if let Ok(e) = entry() {
        let _ = e.set_password(&json);
    }
    if let Some(path) = auth_file() {
        let _ = std::fs::write(path, &json);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

/// Return a usable access token, refreshing via the refresh-token grant if the
/// cached one is stale. Persists any rotated refresh token. Errs if not linked
/// or the refresh failed (caller treats that as needs-reauth).
async fn access_token() -> Result<String, String> {
    let mut state = load_state();
    if state.refresh_token.trim().is_empty() {
        return Err("not connected".into());
    }
    if !needs_refresh(&state, now_secs()) {
        return Ok(state.access_token.clone());
    }
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", state.refresh_token.as_str()),
        ("client_id", state.client_id.as_str()),
    ];
    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("token refresh failed ({})", resp.status()));
    }
    let tok: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
    state.access_token = tok.access_token.clone();
    state.expires_at = now_secs() + tok.expires_in.max(0);
    if let Some(rt) = tok.refresh_token {
        if !rt.trim().is_empty() {
            state.refresh_token = rt;
        }
    }
    let _ = save_state(&state);
    Ok(tok.access_token)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn spotify_status() -> SpotifyStatus {
    SpotifyStatus {
        connected: !load_state().refresh_token.trim().is_empty(),
    }
}

#[tauri::command]
pub fn spotify_disconnect() -> Result<(), String> {
    *AUTH_CACHE.lock() = None;
    // delete_credential is the keyring v3 API; ignore "not found".
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
    if let Some(path) = auth_file() {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// Run the full PKCE link: open the browser to Spotify's consent screen, catch
/// the loopback redirect, exchange the code, and persist the tokens.
#[tauri::command]
pub async fn spotify_connect(client_id: String) -> Result<SpotifyStatus, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;
    use tokio::time::{timeout, Duration};

    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Enter your Spotify app Client ID first.".into());
    }

    let verifier = rand_token(48);
    let challenge = pkce_challenge(&verifier);
    let expected_state = rand_token(16);

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).await.map_err(|e| {
        format!("Couldn't open callback port {REDIRECT_PORT} ({e}). Close whatever is using it and retry.")
    })?;

    let url = build_authorize_url(&client_id, &challenge, &expected_state);
    // Open the consent page in the default browser (macOS).
    let _ = std::process::Command::new("open").arg(&url).spawn();

    // Wait (up to 3 min) for the browser to hit /callback. Non-callback hits
    // (favicon, etc.) get a 404 and we keep waiting.
    let caught = timeout(Duration::from_secs(180), async {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let (read_half, mut write_half) = sock.split();
            let mut line = String::new();
            BufReader::new(read_half)
                .read_line(&mut line)
                .await
                .map_err(|e| e.to_string())?;
            if !line.contains("/callback") {
                let _ = write_half
                    .write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
                    .await;
                continue;
            }
            let body = "<!doctype html><html><body style=\"font-family:-apple-system,sans-serif;background:#06090d;color:#e6f4ec;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h2>Authorization received</h2><p>Finishing up \u{2014} return to Orion Terminal.</p></div></body></html>";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = write_half.write_all(resp.as_bytes()).await;
            return Ok::<_, String>(line);
        }
    })
    .await
    .map_err(|_| "Timed out waiting for Spotify authorization.".to_string())??;

    let (code, got_state) = parse_callback_query(&caught)
        .ok_or_else(|| "Authorization was denied or returned no code.".to_string())?;
    if got_state != expected_state {
        return Err("Authorization state mismatch — please retry.".into());
    }

    // Exchange the auth code for tokens (PKCE — no client secret).
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Token exchange failed ({status}): {text}"));
    }
    let tok: TokenResp = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let refresh_token = tok
        .refresh_token
        .filter(|r| !r.trim().is_empty())
        .ok_or_else(|| "Spotify did not return a refresh token.".to_string())?;

    save_state(&SpotifyAuth {
        client_id,
        refresh_token,
        access_token: tok.access_token,
        expires_at: now_secs() + tok.expires_in.max(0),
    })?;

    // Re-read from the keychain so the returned `connected` reflects what
    // actually persisted, not just that the exchange succeeded.
    Ok(spotify_status())
}

#[tauri::command]
pub async fn spotify_now_playing() -> NowPlaying {
    let state = load_state();
    if state.refresh_token.trim().is_empty() {
        return NowPlaying::default();
    }
    let token = match access_token().await {
        Ok(t) => t,
        Err(_) => {
            return NowPlaying {
                connected: true,
                needs_reauth: true,
                ..Default::default()
            }
        }
    };
    let resp = reqwest::Client::new()
        .get(format!("{API_BASE}/me/player?additional_types=track"))
        .bearer_auth(&token)
        .send()
        .await;
    match resp {
        Ok(r) if r.status().as_u16() == 200 => match r.json::<Value>().await {
            Ok(v) => parse_player(&v),
            Err(_) => NowPlaying {
                connected: true,
                ..Default::default()
            },
        },
        // 204 = no active device / nothing playing.
        Ok(r) if r.status().as_u16() == 204 => NowPlaying {
            connected: true,
            ..Default::default()
        },
        Ok(r) if r.status().as_u16() == 401 => NowPlaying {
            connected: true,
            needs_reauth: true,
            ..Default::default()
        },
        // Transient (rate-limit/5xx/network): stay connected, show idle.
        _ => NowPlaying {
            connected: true,
            ..Default::default()
        },
    }
}

/// Map a non-2xx playback response to friendly copy.
fn control_error(status: u16) -> String {
    match status {
        403 => "Spotify Premium is required to control playback.".into(),
        404 => "No active Spotify device — start playing on a device first.".into(),
        401 => "Spotify session expired — reconnect from the widget.".into(),
        s => format!("Spotify control failed ({s})."),
    }
}

#[tauri::command]
pub async fn spotify_control(action: String) -> Result<(), String> {
    if !is_valid_action(&action) {
        return Err(format!("bad action: {action}"));
    }
    let token = access_token().await?;
    let client = reqwest::Client::new();

    // Resolve play/pause toggle from current state.
    let (method, path): (&str, &str) = if action == "playpause" {
        let mut playing = false;
        if let Ok(r) = client
            .get(format!("{API_BASE}/me/player"))
            .bearer_auth(&token)
            .send()
            .await
        {
            if r.status().as_u16() == 200 {
                if let Ok(v) = r.json::<Value>().await {
                    playing = v.get("is_playing").and_then(|b| b.as_bool()).unwrap_or(false);
                }
            }
        }
        if playing {
            ("PUT", "/me/player/pause")
        } else {
            ("PUT", "/me/player/play")
        }
    } else {
        control_endpoint(&action).ok_or_else(|| format!("bad action: {action}"))?
    };

    let url = format!("{API_BASE}{path}");
    let req = match method {
        "POST" => client.post(url),
        _ => client.put(url).header("Content-Length", "0"),
    };
    let resp = req.bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    let s = resp.status().as_u16();
    if (200..300).contains(&s) {
        Ok(())
    } else {
        Err(control_error(s))
    }
}

#[tauri::command]
pub async fn spotify_seek(position_s: f64) -> Result<(), String> {
    if !position_s.is_finite() || position_s < 0.0 {
        return Err("bad position".into());
    }
    let token = access_token().await?;
    let ms = (position_s * 1000.0) as i64;
    let resp = reqwest::Client::new()
        .put(format!("{API_BASE}/me/player/seek?position_ms={ms}"))
        .header("Content-Length", "0")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let s = resp.status().as_u16();
    if (200..300).contains(&s) {
        Ok(())
    } else {
        Err(control_error(s))
    }
}

// ---- OS-level global media hotkeys -------------------------------------
//
// These fire even when Orion isn't the focused app (the point of a media
// hotkey). We don't call the API here — instead we emit `spotify:hotkey` with
// an action and let the frontend's single store path handle it (so the widget
// re-polls and there's one code path). The matching registry commands are
// `globalOnly`, so the in-app HotkeyHost does NOT also bind these combos —
// no double-fire when Orion is focused.

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// (combo, action) table — kept in one place so the plugin handler and the
/// registration loop agree. Actions match the control allowlist.
fn shortcut_table() -> [(Shortcut, &'static str); 3] {
    let cmd_shift = Modifiers::SUPER | Modifiers::SHIFT;
    [
        (Shortcut::new(Some(cmd_shift), Code::Space), "playpause"),
        (Shortcut::new(Some(cmd_shift), Code::Period), "next"),
        (Shortcut::new(Some(cmd_shift), Code::Comma), "previous"),
    ]
}

/// The plugin with its press handler. Built before `.setup`, so the actual
/// shortcut registration happens later in `register_global_shortcuts`.
pub fn global_shortcut_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            for (sc, action) in shortcut_table() {
                if &sc == shortcut {
                    let _ = app.emit("spotify:hotkey", action);
                    break;
                }
            }
        })
        .build()
}

/// Register the three media combos. Each failure (combo already taken by the
/// OS or another app) is logged and skipped — the others still bind.
pub fn register_global_shortcuts<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    for (sc, action) in shortcut_table() {
        if let Err(e) = gs.register(sc) {
            eprintln!("[spotify] global shortcut for {action} not registered: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_vector() {
        // RFC 7636 Appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(pkce_challenge(verifier), expected);
    }

    #[test]
    fn authorize_url_has_pkce_and_encoded_redirect() {
        let url = build_authorize_url("cid123", "chal", "st8");
        assert!(url.contains("client_id=cid123"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("code_challenge=chal"));
        assert!(url.contains("state=st8"));
        // redirect + scope are percent-encoded.
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback"));
        assert!(url.contains("scope=user-read-playback-state%20"));
    }

    #[test]
    fn callback_query_extracts_code_and_state() {
        let line = "GET /callback?code=AbC-1&state=xyz HTTP/1.1";
        assert_eq!(
            parse_callback_query(line),
            Some(("AbC-1".to_string(), "xyz".to_string()))
        );
        // denied → no code
        assert_eq!(
            parse_callback_query("GET /callback?error=access_denied&state=xyz HTTP/1.1"),
            None
        );
        assert_eq!(parse_callback_query("GET /favicon.ico HTTP/1.1"), None);
    }

    #[test]
    fn needs_refresh_logic() {
        let mut s = SpotifyAuth {
            refresh_token: "r".into(),
            access_token: "a".into(),
            expires_at: 1000,
            ..Default::default()
        };
        assert!(needs_refresh(&s, 1000)); // at expiry
        assert!(needs_refresh(&s, 950)); // within skew (60)
        assert!(!needs_refresh(&s, 800)); // fresh
        s.access_token = "".into();
        assert!(needs_refresh(&s, 0)); // no token
    }

    #[test]
    fn control_allowlist_and_endpoints() {
        assert_eq!(control_endpoint("next"), Some(("POST", "/me/player/next")));
        assert_eq!(control_endpoint("play"), Some(("PUT", "/me/player/play")));
        assert!(control_endpoint("playpause").is_none()); // dynamic
        assert!(is_valid_action("playpause"));
        assert!(is_valid_action("previous"));
        assert!(!is_valid_action("quit; rm -rf"));
        assert!(!is_valid_action(""));
    }

    #[test]
    fn parses_player_body() {
        let v: Value = serde_json::from_str(
            r#"{"is_playing":true,"progress_ms":42000,"item":{"name":"Kiara","duration_ms":250000,"artists":[{"name":"Bonobo"},{"name":"Guest"}],"album":{"name":"Black Sands","images":[{"url":"https://i.scdn.co/x"}]},"external_urls":{"spotify":"https://open.spotify.com/track/1"}}}"#,
        )
        .unwrap();
        let np = parse_player(&v);
        assert!(np.connected && np.active && np.is_playing);
        assert_eq!(np.track, "Kiara");
        assert_eq!(np.artist, "Bonobo, Guest");
        assert_eq!(np.album, "Black Sands");
        assert_eq!(np.artwork_url, "https://i.scdn.co/x");
        assert_eq!(np.duration_ms, 250000.0);
        assert_eq!(np.position_s, 42.0);
        assert_eq!(np.url, "https://open.spotify.com/track/1");
    }

    #[test]
    fn shortcut_table_actions_are_valid() {
        for (_, action) in shortcut_table() {
            assert!(is_valid_action(action), "unmapped action: {action}");
        }
    }
}
