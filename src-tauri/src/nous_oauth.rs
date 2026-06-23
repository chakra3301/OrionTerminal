//! Nous Portal OAuth (device-code flow) — subscription auth, no API key.
//!
//! Mirrors the Hermes CLI flow (`hermes_cli/auth.py`): device-code grant at
//! `portal.nousresearch.com`, rotating single-use refresh tokens, short-lived
//! inference JWTs minted on demand. The refresh token is the only persistent
//! credential — stored in the OS keychain. A fresh access token is minted per
//! send when the cached one is within `REFRESH_SKEW_SECS` of expiry.

use base64::Engine;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SERVICE: &str = "personal-workstation";
pub const PORTAL: &str = "https://portal.nousresearch.com";
pub const CLIENT_ID: &str = "hermes-cli";
pub const SCOPE: &str = "inference:invoke";
const REFRESH_SKEW_SECS: i64 = 120;

fn account(key_ref: &str) -> String {
    format!("nous-oauth:{}", key_ref)
}

fn entry(key_ref: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &account(key_ref))
        .map_err(|e| format!("Secret storage unavailable ({})", e))
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct NousState {
    pub refresh_token: String,
    #[serde(default)]
    pub access_token: String,
    /// Unix seconds when `access_token` expires; 0 = unknown/none.
    #[serde(default)]
    pub expires_at: i64,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/// Decode a JWT's `exp` (unix seconds) from its payload segment, without
/// verifying the signature. Returns None for anything unparseable.
pub fn jwt_exp(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim())
        .ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.get("exp").and_then(|x| x.as_i64())
}

/// True when the cached access token is missing or within the refresh skew of
/// expiry and must be re-minted before use. An unknown expiry (`<= 0`, e.g. an
/// opaque non-JWT token) is treated as usable — we can't prove it's stale, and
/// a 401 will prompt reconnect.
pub fn needs_refresh(state: &NousState, now: i64) -> bool {
    if state.access_token.trim().is_empty() {
        return true;
    }
    if state.expires_at <= 0 {
        return false;
    }
    now + REFRESH_SKEW_SECS >= state.expires_at
}

/// A connection is usable when we hold a refresh token (can always mint) OR an
/// access token that isn't known to be expired. Mirrors Hermes's `logged_in`.
pub fn state_is_connected(state: &NousState, now: i64) -> bool {
    if !state.refresh_token.trim().is_empty() {
        return true;
    }
    !state.access_token.trim().is_empty() && (state.expires_at <= 0 || state.expires_at > now)
}

#[derive(Debug, PartialEq)]
pub enum PollOutcome {
    Success(NousState),
    Pending,
    SlowDown,
    Error(String),
}

/// Classify a `POST /api/oauth/token` (device_code grant) response.
pub fn classify_poll(status: u16, body: &Value) -> PollOutcome {
    if status == 200 {
        return match build_state_from_payload(body, "") {
            Some(s) if !s.access_token.is_empty() => PollOutcome::Success(s),
            _ => PollOutcome::Error("Token response missing access_token".into()),
        };
    }
    let code = body.get("error").and_then(|x| x.as_str()).unwrap_or("");
    match code {
        "authorization_pending" => PollOutcome::Pending,
        "slow_down" => PollOutcome::SlowDown,
        other => {
            let desc = body
                .get("error_description")
                .and_then(|x| x.as_str())
                .unwrap_or(if other.is_empty() { "unknown error" } else { other });
            PollOutcome::Error(desc.to_string())
        }
    }
}

/// Build a NousState from a token payload, deriving `expires_at` from the JWT
/// `exp` first, then an `expires_in` field, falling back to `prev_refresh` when
/// the response omits a rotated refresh token.
pub fn build_state_from_payload(body: &Value, prev_refresh: &str) -> Option<NousState> {
    let access = body.get("access_token").and_then(|x| x.as_str())?.trim().to_string();
    let refresh = body
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(prev_refresh)
        .to_string();
    let expires_at = jwt_exp(&access).unwrap_or(0);
    Some(NousState {
        refresh_token: refresh,
        access_token: access,
        expires_at,
    })
}

/// Merge a refresh-grant response into prior state, preserving the rotated
/// refresh token (single-use — persisting it is mandatory).
pub fn merge_refresh(prev: &NousState, body: &Value) -> Option<NousState> {
    build_state_from_payload(body, &prev.refresh_token)
}

// ---------------------------------------------------------------------------
// Keychain state
// ---------------------------------------------------------------------------

fn load_state(key_ref: &str) -> Option<NousState> {
    let raw = entry(key_ref).ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

/// Like `load_state` but reports *why* it failed, for diagnostics at send time.
fn load_state_diag(key_ref: &str) -> Result<NousState, String> {
    let e = entry(key_ref)?;
    let raw = match e.get_password() {
        Ok(s) => s,
        Err(keyring::Error::NoEntry) => {
            return Err(format!(
                "No Nous Portal token in keychain for this provider (keyRef {}). Open Control Panel → Providers and click Reconnect.",
                &key_ref.chars().take(8).collect::<String>()
            ))
        }
        Err(err) => return Err(format!("Keychain read failed: {}", err)),
    };
    serde_json::from_str(&raw)
        .map_err(|e| format!("Stored Nous token is corrupt ({}) — click Reconnect.", e))
}

fn save_state(key_ref: &str, state: &NousState) -> Result<(), String> {
    let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
    entry(key_ref)?
        .set_password(&json)
        .map_err(|e| e.to_string())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Device-code flow + token minting
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri_complete: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[tauri::command]
pub async fn nous_device_start() -> Result<DeviceStart, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{PORTAL}/api/oauth/device/code"))
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("device code request failed: HTTP {} {}", s, b));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let device_code = get("device_code");
    let user_code = get("user_code");
    let verification_uri_complete = get("verification_uri_complete");
    if device_code.is_empty() || user_code.is_empty() || verification_uri_complete.is_empty() {
        return Err("device code response missing required fields".into());
    }
    Ok(DeviceStart {
        device_code,
        user_code,
        verification_uri_complete,
        interval: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5),
        expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900),
    })
}

/// Poll the token endpoint until the user approves (or timeout). On success the
/// refresh + access tokens are persisted under `key_ref`.
#[tauri::command]
pub async fn nous_device_poll(
    key_ref: String,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> Result<(), String> {
    if key_ref.trim().is_empty() {
        return Err("key_ref is empty".into());
    }
    let client = reqwest::Client::new();
    let deadline = now_secs() + expires_in.max(1) as i64;
    let mut wait = interval.clamp(1, 30);
    loop {
        if now_secs() >= deadline {
            return Err("Timed out waiting for Nous Portal approval".into());
        }
        let resp = client
            .post(format!("{PORTAL}/api/oauth/token"))
            .form(&[
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code",
                ),
                ("client_id", CLIENT_ID),
                ("device_code", &device_code),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let hdr_refresh = resp
            .headers()
            .get("x-nous-refresh-token")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        match classify_poll(status, &body) {
            PollOutcome::Success(mut state) => {
                // Nous mirrors its refresh token via the `x-nous-refresh-token`
                // response header; the JSON body may omit it. Capture it so a
                // later access-token mint can refresh instead of forcing a
                // reconnect.
                if state.refresh_token.trim().is_empty() && !hdr_refresh.trim().is_empty() {
                    state.refresh_token = hdr_refresh;
                }
                save_state(&key_ref, &state)?;
                return Ok(());
            }
            PollOutcome::Pending => {}
            PollOutcome::SlowDown => wait = (wait + 5).min(30),
            PollOutcome::Error(e) => return Err(e),
        }
        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
    }
}

/// Return a valid inference bearer for `key_ref`, refreshing (and persisting the
/// rotated refresh token) when the cached access token is near expiry.
pub async fn access_token(key_ref: &str) -> Result<String, String> {
    let state = load_state_diag(key_ref)?;
    if !needs_refresh(&state, now_secs()) {
        return Ok(state.access_token);
    }
    if state.refresh_token.trim().is_empty() {
        return Err("Nous Portal session expired — reconnect".into());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{PORTAL}/api/oauth/token"))
        .header("x-nous-refresh-token", &state.refresh_token)
        .form(&[("grant_type", "refresh_token"), ("client_id", CLIENT_ID)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let hdr_refresh = resp
        .headers()
        .get("x-nous-refresh-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status != 200 {
        let desc = body
            .get("error_description")
            .and_then(|x| x.as_str())
            .unwrap_or("refresh failed");
        return Err(format!("Nous Portal: {} — reconnect", desc));
    }
    let mut next = merge_refresh(&state, &body)
        .ok_or_else(|| "Refresh response missing access_token".to_string())?;
    if !hdr_refresh.trim().is_empty() {
        next.refresh_token = hdr_refresh;
    }
    save_state(key_ref, &next)?;
    Ok(next.access_token)
}

#[tauri::command]
pub fn nous_oauth_status(key_ref: String) -> Result<bool, String> {
    Ok(load_state(&key_ref)
        .map(|s| state_is_connected(&s, now_secs()))
        .unwrap_or(false))
}

#[tauri::command]
pub fn nous_oauth_clear(key_ref: String) -> Result<(), String> {
    let e = entry(&key_ref)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use serde_json::json;

    fn jwt_with_exp(exp: i64) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"{\"alg\":\"none\"}");
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!("{{\"exp\":{}}}", exp).as_bytes());
        format!("{header}.{payload}.sig")
    }

    #[test]
    fn jwt_exp_parses_payload() {
        assert_eq!(jwt_exp(&jwt_with_exp(1_900_000_000)), Some(1_900_000_000));
        assert_eq!(jwt_exp("not-a-jwt"), None);
        assert_eq!(jwt_exp(""), None);
    }

    #[test]
    fn needs_refresh_logic() {
        let now = 1_000_000;
        let fresh = NousState {
            refresh_token: "r".into(),
            access_token: "a".into(),
            expires_at: now + 600,
        };
        assert!(!needs_refresh(&fresh, now));
        let near = NousState { expires_at: now + 60, ..fresh.clone() };
        assert!(needs_refresh(&near, now)); // within 120s skew
        let no_access = NousState { access_token: "".into(), ..fresh.clone() };
        assert!(needs_refresh(&no_access, now));
        // Unknown expiry with a present token → usable, don't force refresh.
        let no_exp = NousState { expires_at: 0, ..fresh };
        assert!(!needs_refresh(&no_exp, now));
    }

    #[test]
    fn state_is_connected_logic() {
        let now = 1_000_000;
        // refresh token alone → connected
        assert!(state_is_connected(
            &NousState { refresh_token: "r".into(), access_token: "".into(), expires_at: 0 },
            now
        ));
        // valid access token, no refresh → connected
        assert!(state_is_connected(
            &NousState { refresh_token: "".into(), access_token: "a".into(), expires_at: now + 600 },
            now
        ));
        // access token with unknown expiry → connected (optimistic)
        assert!(state_is_connected(
            &NousState { refresh_token: "".into(), access_token: "a".into(), expires_at: 0 },
            now
        ));
        // expired access token, no refresh → not connected
        assert!(!state_is_connected(
            &NousState { refresh_token: "".into(), access_token: "a".into(), expires_at: now - 10 },
            now
        ));
        // nothing → not connected
        assert!(!state_is_connected(&NousState::default(), now));
    }

    #[test]
    fn classify_poll_pending_and_slowdown() {
        assert_eq!(
            classify_poll(400, &json!({"error": "authorization_pending"})),
            PollOutcome::Pending
        );
        assert_eq!(
            classify_poll(400, &json!({"error": "slow_down"})),
            PollOutcome::SlowDown
        );
    }

    #[test]
    fn classify_poll_error_uses_description() {
        match classify_poll(400, &json!({"error": "expired_token", "error_description": "it expired"})) {
            PollOutcome::Error(e) => assert_eq!(e, "it expired"),
            o => panic!("expected error, got {:?}", o),
        }
    }

    #[test]
    fn classify_poll_success_parses_tokens() {
        let exp = 1_900_000_000;
        let body = json!({
            "access_token": jwt_with_exp(exp),
            "refresh_token": "new-rt",
        });
        match classify_poll(200, &body) {
            PollOutcome::Success(s) => {
                assert_eq!(s.refresh_token, "new-rt");
                assert_eq!(s.expires_at, exp);
                assert!(!s.access_token.is_empty());
            }
            o => panic!("expected success, got {:?}", o),
        }
    }

    #[test]
    fn classify_poll_200_missing_access_is_error() {
        assert!(matches!(
            classify_poll(200, &json!({"refresh_token": "x"})),
            PollOutcome::Error(_)
        ));
    }

    #[test]
    fn merge_refresh_keeps_rotated_token() {
        let prev = NousState {
            refresh_token: "old-rt".into(),
            access_token: "old".into(),
            expires_at: 1,
        };
        let rotated = merge_refresh(&prev, &json!({
            "access_token": jwt_with_exp(2_000_000_000),
            "refresh_token": "rotated-rt",
        }))
        .unwrap();
        assert_eq!(rotated.refresh_token, "rotated-rt");
        assert_eq!(rotated.expires_at, 2_000_000_000);
    }

    #[test]
    fn merge_refresh_falls_back_to_prev_token() {
        let prev = NousState {
            refresh_token: "keep-rt".into(),
            access_token: "old".into(),
            expires_at: 1,
        };
        let merged = merge_refresh(&prev, &json!({
            "access_token": jwt_with_exp(2_000_000_000),
        }))
        .unwrap();
        assert_eq!(merged.refresh_token, "keep-rt");
    }
}
