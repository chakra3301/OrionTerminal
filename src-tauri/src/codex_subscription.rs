use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const CODEX_IMAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/codex/images/generations";
const OPENAI_TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_KEYRING_SERVICE: &str = "Codex Auth";
const REFRESH_MARGIN_SECS: u64 = 5 * 60;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

static AUTH_REFRESH_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionStatus {
    pub auth_mode: Option<String>,
    pub subscription_ready: bool,
    pub image_ready: bool,
    pub detail: String,
}

#[derive(Clone, Debug)]
enum AuthSource {
    File(PathBuf),
    DirectKeyring { account: String },
}

#[derive(Clone, Debug)]
struct StoredAuth {
    source: AuthSource,
    document: Value,
}

#[derive(Clone, Debug)]
struct Session {
    source: AuthSource,
    document: Value,
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    account_id: String,
    fedramp: bool,
}

fn codex_home() -> Result<PathBuf, String> {
    if let Some(home) = crate::cli_auth::codex_home_override().or_else(|| std::env::var_os("CODEX_HOME")) {
        return Ok(PathBuf::from(home));
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "home directory is unavailable".to_string())?;
    Ok(PathBuf::from(home).join(".codex"))
}

fn direct_keyring_account(codex_home: &Path) -> String {
    let canonical = codex_home
        .canonicalize()
        .unwrap_or_else(|_| codex_home.to_path_buf());
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    let hex = format!("{digest:x}");
    format!("cli|{}", &hex[..16])
}

fn read_auth_document() -> Result<StoredAuth, String> {
    let home = codex_home()?;
    let file = home.join("auth.json");
    match std::fs::read_to_string(&file) {
        Ok(contents) => {
            let document = serde_json::from_str(&contents)
                .map_err(|_| "Codex auth.json is not valid JSON".to_string())?;
            return Ok(StoredAuth {
                source: AuthSource::File(file),
                document,
            });
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("could not read Codex credentials: {e}")),
    }

    let account = direct_keyring_account(&home);
    let entry = keyring::Entry::new(CODEX_KEYRING_SERVICE, &account)
        .map_err(|e| format!("Codex credential storage is unavailable: {e}"))?;
    match entry.get_password() {
        Ok(contents) => {
            let document = serde_json::from_str(&contents)
                .map_err(|_| "Codex keyring credentials are not valid JSON".to_string())?;
            Ok(StoredAuth {
                source: AuthSource::DirectKeyring { account },
                document,
            })
        }
        Err(keyring::Error::NoEntry) => Err(
            "ChatGPT subscription credentials were not found. Connect with ChatGPT first."
                .to_string(),
        ),
        Err(e) => Err(format!("could not read Codex keyring credentials: {e}")),
    }
}

fn string_at(document: &Value, pointer: &str) -> Option<String> {
    document
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(str::to_string)
}

fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn account_id_from_token(token: &str) -> Option<String> {
    let claims = jwt_claims(token)?;
    claims
        .pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")
        .and_then(Value::as_str)
        .or_else(|| claims.get("chatgpt_account_id").and_then(Value::as_str))
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn token_is_fedramp(token: &str) -> bool {
    jwt_claims(token)
        .and_then(|claims| {
            claims
                .pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_is_fedramp")
                .and_then(Value::as_bool)
        })
        .unwrap_or(false)
}

fn token_needs_refresh(token: &str, now_secs: u64) -> bool {
    let Some(exp) = jwt_claims(token).and_then(|claims| claims.get("exp").and_then(Value::as_u64))
    else {
        return false;
    };
    exp <= now_secs.saturating_add(REFRESH_MARGIN_SECS)
}

fn session_from(stored: StoredAuth) -> Result<Session, String> {
    let auth_mode = string_at(&stored.document, "/auth_mode");
    if auth_mode.as_deref() != Some("chatgpt") {
        return Err(
            "Codex is not connected with ChatGPT. Choose Connect with ChatGPT, not API key."
                .to_string(),
        );
    }
    let access_token = string_at(&stored.document, "/tokens/access_token")
        .ok_or_else(|| "ChatGPT access token is missing. Reconnect with ChatGPT.".to_string())?;
    let id_token = string_at(&stored.document, "/tokens/id_token");
    let account_id = string_at(&stored.document, "/tokens/account_id")
        .or_else(|| id_token.as_deref().and_then(account_id_from_token))
        .or_else(|| account_id_from_token(&access_token))
        .ok_or_else(|| "ChatGPT account id is missing. Reconnect with ChatGPT.".to_string())?;
    let fedramp =
        id_token.as_deref().is_some_and(token_is_fedramp) || token_is_fedramp(&access_token);
    let refresh_token = string_at(&stored.document, "/tokens/refresh_token");
    Ok(Session {
        source: stored.source,
        document: stored.document,
        access_token,
        refresh_token,
        id_token,
        account_id,
        fedramp,
    })
}

fn status_from_stored(stored: StoredAuth) -> SubscriptionStatus {
    let auth_mode = string_at(&stored.document, "/auth_mode");
    match session_from(stored) {
        Ok(session)
            if token_needs_refresh(&session.access_token, now_secs())
                && session.refresh_token.is_none() =>
        {
            SubscriptionStatus {
                auth_mode,
                subscription_ready: false,
                image_ready: false,
                detail: "ChatGPT session expired and cannot be refreshed. Reconnect with ChatGPT."
                    .to_string(),
            }
        }
        Ok(_) => SubscriptionStatus {
            auth_mode,
            subscription_ready: true,
            image_ready: true,
            detail: "Ready · ChatGPT subscription powers chat + image generation.".to_string(),
        },
        Err(detail) => SubscriptionStatus {
            auth_mode,
            subscription_ready: false,
            image_ready: false,
            detail,
        },
    }
}

pub fn status() -> SubscriptionStatus {
    match read_auth_document() {
        Ok(stored) => status_from_stored(stored),
        Err(detail) => SubscriptionStatus {
            auth_mode: None,
            subscription_ready: false,
            image_ready: false,
            detail,
        },
    }
}

fn set_token_fields(
    document: &mut Value,
    access_token: &str,
    refresh_token: Option<&str>,
    id_token: Option<&str>,
    account_id: &str,
) -> Result<(), String> {
    let root = document
        .as_object_mut()
        .ok_or_else(|| "Codex credentials must be a JSON object".to_string())?;
    root.insert(
        "auth_mode".to_string(),
        Value::String("chatgpt".to_string()),
    );
    let tokens = root
        .entry("tokens")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "Codex credential tokens must be a JSON object".to_string())?;
    tokens.insert(
        "access_token".to_string(),
        Value::String(access_token.to_string()),
    );
    tokens.insert(
        "account_id".to_string(),
        Value::String(account_id.to_string()),
    );
    if let Some(token) = refresh_token {
        tokens.insert(
            "refresh_token".to_string(),
            Value::String(token.to_string()),
        );
    }
    if let Some(token) = id_token {
        tokens.insert("id_token".to_string(), Value::String(token.to_string()));
    }
    Ok(())
}

fn write_file_atomic(path: &Path, document: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("auth.json");
    let tmp = path.with_file_name(format!(".{name}.orion-{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec_pretty(document).map_err(|e| e.to_string())?;
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
    if let Err(e) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    drop(file);
    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn save_document(source: &AuthSource, document: &Value) -> Result<(), String> {
    match source {
        AuthSource::File(path) => write_file_atomic(path, document),
        AuthSource::DirectKeyring { account } => {
            let serialized = serde_json::to_string(document).map_err(|e| e.to_string())?;
            keyring::Entry::new(CODEX_KEYRING_SERVICE, account)
                .map_err(|e| e.to_string())?
                .set_password(&serialized)
                .map_err(|e| format!("could not update Codex keyring credentials: {e}"))
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

async fn refresh_session(
    client: &reqwest::Client,
    mut session: Session,
) -> Result<Session, String> {
    let refresh_token = session.refresh_token.clone().ok_or_else(|| {
        "ChatGPT session expired and cannot be refreshed. Reconnect with ChatGPT.".to_string()
    })?;
    let response = client
        .post(OPENAI_TOKEN_ENDPOINT)
        .json(&json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": OPENAI_OAUTH_CLIENT_ID,
        }))
        .send()
        .await
        .map_err(|e| format!("ChatGPT token refresh failed: {e}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|_| format!("ChatGPT token refresh returned HTTP {status}"))?;
    if !status.is_success() {
        let detail = value
            .get("error_description")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Reconnect with ChatGPT.");
        return Err(format!("ChatGPT token refresh failed: {detail}"));
    }
    let access_token = string_at(&value, "/access_token")
        .ok_or_else(|| "ChatGPT token refresh did not return an access token".to_string())?;
    let id_token = string_at(&value, "/id_token").or(session.id_token.clone());
    let new_refresh = string_at(&value, "/refresh_token").or(session.refresh_token.clone());
    let account_id = id_token
        .as_deref()
        .and_then(account_id_from_token)
        .or_else(|| account_id_from_token(&access_token))
        .unwrap_or_else(|| session.account_id.clone());
    set_token_fields(
        &mut session.document,
        &access_token,
        new_refresh.as_deref(),
        id_token.as_deref(),
        &account_id,
    )?;
    save_document(&session.source, &session.document)?;
    session.access_token = access_token;
    session.refresh_token = new_refresh;
    session.id_token = id_token;
    session.account_id = account_id;
    session.fedramp = session.id_token.as_deref().is_some_and(token_is_fedramp)
        || token_is_fedramp(&session.access_token);
    Ok(session)
}

async fn fresh_session(client: &reqwest::Client) -> Result<Session, String> {
    let _guard = AUTH_REFRESH_LOCK.lock().await;
    let session = session_from(read_auth_document()?)?;
    if token_needs_refresh(&session.access_token, now_secs()) {
        refresh_session(client, session).await
    } else {
        Ok(session)
    }
}

async fn session_after_unauthorized(
    client: &reqwest::Client,
    failed_access_token: &str,
) -> Result<Session, String> {
    let _guard = AUTH_REFRESH_LOCK.lock().await;
    let current = session_from(read_auth_document()?)?;
    if current.access_token != failed_access_token {
        return Ok(current);
    }
    refresh_session(client, current).await
}

fn image_headers(session: &Session) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let bearer = HeaderValue::from_str(&format!("Bearer {}", session.access_token))
        .map_err(|_| "ChatGPT access token contains invalid characters".to_string())?;
    headers.insert(AUTHORIZATION, bearer);
    headers.insert(
        "chatgpt-account-id",
        HeaderValue::from_str(&session.account_id)
            .map_err(|_| "ChatGPT account id contains invalid characters".to_string())?,
    );
    if session.fedramp {
        headers.insert("x-openai-fedramp", HeaderValue::from_static("true"));
    }
    Ok(headers)
}

async fn read_limited(response: reqwest::Response) -> Result<(reqwest::StatusCode, Value), String> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|len| len > MAX_RESPONSE_BYTES as u64)
    {
        return Err("image provider response exceeded 64 MB".to_string());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("image response failed: {e}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("image provider response exceeded 64 MB".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| {
        format!("ChatGPT image generation returned HTTP {status} with invalid JSON")
    })?;
    Ok((status, value))
}

fn image_body(prompt: &str, size: &str) -> Value {
    json!({
        "model": "gpt-image-2",
        "prompt": prompt,
        "n": 1,
        "size": size,
    })
}

async fn send_image_request(
    client: &reqwest::Client,
    session: &Session,
    prompt: &str,
    size: &str,
) -> Result<(reqwest::StatusCode, Value), String> {
    let response = client
        .post(CODEX_IMAGE_ENDPOINT)
        .headers(image_headers(session)?)
        .json(&image_body(prompt, size))
        .send()
        .await
        .map_err(|e| format!("ChatGPT image request failed: {e}"))?;
    read_limited(response).await
}

pub async fn generate_image(
    prompt: &str,
    size: &str,
) -> Result<crate::xdesign_image::GeneratedImage, String> {
    let _account = crate::cli_auth::use_account("codex_cli")?;
    if prompt.trim().is_empty() {
        return Err("image prompt is empty".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut session = fresh_session(&client).await?;
    let (mut status, mut value) = send_image_request(&client, &session, prompt, size).await?;
    if status == reqwest::StatusCode::UNAUTHORIZED {
        session = session_after_unauthorized(&client, &session.access_token).await?;
        (status, value) = send_image_request(&client, &session, prompt, size).await?;
    }
    if !status.is_success() {
        return Err(crate::xdesign_image::parse_openai_image(&value)
            .err()
            .unwrap_or_else(|| format!("ChatGPT image generation returned HTTP {status}")));
    }
    crate::xdesign_image::parse_openai_image(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
        )
    }

    fn stored(document: Value) -> StoredAuth {
        StoredAuth {
            source: AuthSource::File(PathBuf::from("/tmp/auth.json")),
            document,
        }
    }

    #[test]
    fn parses_chatgpt_session_and_claims() {
        let token = jwt(json!({
            "exp": 2_000_000_000u64,
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "acct-1",
                "chatgpt_account_is_fedramp": true
            }
        }));
        let session = session_from(stored(json!({
            "auth_mode": "chatgpt",
            "tokens": { "access_token": token, "refresh_token": "refresh" }
        })))
        .unwrap();
        assert_eq!(session.account_id, "acct-1");
        assert!(session.fedramp);
        assert_eq!(session.refresh_token.as_deref(), Some("refresh"));
    }

    #[test]
    fn rejects_api_key_auth_mode() {
        let auth = stored(json!({
            "auth_mode": "apikey",
            "OPENAI_API_KEY": "secret"
        }));
        let status = status_from_stored(auth.clone());
        assert_eq!(status.auth_mode.as_deref(), Some("apikey"));
        assert!(!status.subscription_ready);
        assert!(!status.image_ready);
        let error = session_from(auth).unwrap_err();
        assert!(error.contains("ChatGPT"));
        assert!(!error.contains("secret"));
    }

    #[test]
    fn refresh_decision_uses_jwt_expiry_margin() {
        assert!(token_needs_refresh(&jwt(json!({ "exp": 1_299u64 })), 1_000));
        assert!(!token_needs_refresh(
            &jwt(json!({ "exp": 1_301u64 })),
            1_000
        ));
        assert!(!token_needs_refresh("not-a-jwt", 1_000));
    }

    #[test]
    fn token_update_preserves_unknown_fields() {
        let mut value = json!({
            "auth_mode": "chatgpt",
            "future_field": { "keep": true },
            "tokens": { "access_token": "old", "custom": 7 }
        });
        set_token_fields(&mut value, "new", Some("refresh"), None, "acct").unwrap();
        assert_eq!(value["future_field"]["keep"], true);
        assert_eq!(value["tokens"]["custom"], 7);
        assert_eq!(value["tokens"]["access_token"], "new");
        assert_eq!(value["tokens"]["account_id"], "acct");
    }

    #[test]
    fn image_body_is_fixed_to_subscription_model() {
        let body = image_body("a blue orb", "1024x1024");
        assert_eq!(body["model"], "gpt-image-2");
        assert_eq!(body["prompt"], "a blue orb");
        assert_eq!(body["n"], 1);
        assert_eq!(body["size"], "1024x1024");
    }

    #[test]
    fn image_headers_do_not_include_refresh_or_id_tokens() {
        let session = Session {
            source: AuthSource::File(PathBuf::from("/tmp/auth.json")),
            document: json!({}),
            access_token: "access".to_string(),
            refresh_token: Some("refresh-secret".to_string()),
            id_token: Some("id-secret".to_string()),
            account_id: "acct".to_string(),
            fedramp: false,
        };
        let headers = image_headers(&session).unwrap();
        assert_eq!(headers[AUTHORIZATION], "Bearer access");
        assert_eq!(headers["chatgpt-account-id"], "acct");
        let debug = format!("{headers:?}");
        assert!(!debug.contains("refresh-secret"));
        assert!(!debug.contains("id-secret"));
    }

    #[test]
    fn direct_keyring_key_matches_codex_shape() {
        let key = direct_keyring_account(Path::new("/path/that/does/not/exist"));
        assert!(key.starts_with("cli|"));
        assert_eq!(key.len(), 20);
    }

    #[tokio::test]
    #[ignore = "uses the current user's ChatGPT subscription and generates one real image"]
    async fn live_subscription_image_generation() {
        let status = status();
        assert!(status.image_ready, "{}", status.detail);
        let image = generate_image(
            "a small polished cyan orb on a plain dark background",
            "1024x1024",
        )
        .await
        .unwrap();
        assert_eq!(image.mime, "image/png");
        assert!(image.b64.len() > 1_000);
        let bytes = base64::engine::general_purpose::STANDARD.decode(&image.b64).unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        if let Some(path) = std::env::var_os("ORION_LIVE_IMAGE_OUTPUT") {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)] {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options.open(path).unwrap().write_all(&bytes).unwrap();
        }
    }

    #[test]
    fn atomic_writer_preserves_document_and_permissions() {
        let dir = std::env::temp_dir().join(format!(
            "orion-codex-auth-test-{}-{}",
            std::process::id(),
            now_secs()
        ));
        let path = dir.join("auth.json");
        write_file_atomic(&path, &json!({ "auth_mode": "chatgpt", "x": 1 })).unwrap();
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["x"], 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
