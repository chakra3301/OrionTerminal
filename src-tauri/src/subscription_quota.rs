use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    id: String,
    label: String,
    used_percent: f64,
    reset_at: Option<Value>,
    window_seconds: Option<f64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionQuota {
    status: String,
    message: Option<String>,
    plan: Option<String>,
    windows: Vec<QuotaWindow>,
    profile: Option<Value>,
    reset_credits: Option<Value>,
    fetched_at: u64,
    retry_at: Option<u64>,
}
impl SubscriptionQuota {
    fn empty(status: &str, message: &str) -> Self {
        Self {
            status: status.into(),
            message: Some(message.into()),
            plan: None,
            windows: vec![],
            profile: None,
            reset_credits: None,
            fetched_at: now_ms(),
            retry_at: None,
        }
    }
}
struct Cached {
    identity: String,
    until: u64,
    snapshot: SubscriptionQuota,
}
static CODEX: Lazy<Mutex<Option<Cached>>> = Lazy::new(|| Mutex::new(None));
static CLAUDE: Lazy<Mutex<Option<Cached>>> = Lazy::new(|| Mutex::new(None));
static BACKOFF: Lazy<Mutex<std::collections::HashMap<&'static str, u64>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn number(v: Option<&Value>) -> Option<f64> {
    v?.as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 9_007_199_254_740_991.0)
}
fn text(v: Option<&Value>, max: usize) -> Option<String> {
    v?.as_str()
        .filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .map(str::to_owned)
}

fn codex_window(v: &Value, id: &str, group: Option<&str>, now: u64) -> Option<QuotaWindow> {
    let used = number(v.get("used_percent"))?.min(100.0);
    let seconds = number(v.get("limit_window_seconds")).filter(|n| *n > 0.0 && *n <= 31_536_000.0);
    let label = match seconds {
        Some(n) if (n - 604800.0).abs() < 1.0 => "Weekly limit".into(),
        Some(n) if (n - 18000.0).abs() < 1.0 => "5-hour limit".into(),
        Some(n) if n >= 86400.0 => format!("{}-day limit", n / 86400.0),
        Some(n) => format!("{}-hour limit", n / 3600.0),
        None => if id == "secondary" {
            "Weekly limit"
        } else {
            "Session limit"
        }
        .into(),
    };
    let reset = number(v.get("reset_at"))
        .map(|n| n * 1000.0)
        .or_else(|| number(v.get("reset_after_seconds")).map(|n| now as f64 + n * 1000.0));
    Some(QuotaWindow {
        id: id.into(),
        label: group.map(|g| format!("{g} · {label}")).unwrap_or(label),
        used_percent: used,
        reset_at: reset.filter(|n| *n <= 8.64e15).map(|n| json!(n)),
        window_seconds: seconds,
    })
}
fn codex_snapshot(v: &Value, now: u64) -> SubscriptionQuota {
    let mut out = SubscriptionQuota::empty("ok", "");
    out.message = None;
    out.fetched_at = now;
    out.plan = text(v.get("plan_type"), 48);
    for (key, id) in [
        ("primary_window", "primary"),
        ("secondary_window", "secondary"),
    ] {
        if let Some(w) = v
            .get("rate_limit")
            .and_then(|r| r.get(key))
            .and_then(|w| codex_window(w, id, None, now))
        {
            out.windows.push(w);
        }
    }
    if let Some(extra) = v.get("additional_rate_limits").and_then(Value::as_array) {
        for (i, e) in extra.iter().take(8).enumerate() {
            let name = text(e.get("limit_name"), 80)
                .or_else(|| text(e.get("metered_feature"), 80))
                .unwrap_or_else(|| "Additional limit".into());
            for key in ["primary_window", "secondary_window"] {
                if let Some(w) = e
                    .get("rate_limit")
                    .and_then(|r| r.get(key))
                    .and_then(|w| codex_window(w, &format!("extra-{i}-{key}"), Some(&name), now))
                {
                    out.windows.push(w);
                }
            }
        }
    }
    for key in ["primary_window", "secondary_window"] {
        if let Some(w) = v
            .get("code_review_rate_limit")
            .and_then(|r| r.get(key))
            .and_then(|w| codex_window(w, &format!("review-{key}"), Some("Code review"), now))
        {
            out.windows.push(w);
        }
    }
    if out.windows.is_empty() {
        out.status = "unavailable".into();
        out.message = Some("The account endpoint did not report any quota windows.".into());
    }
    out
}
fn claude_snapshot(v: &Value, now: u64, plan: Option<String>) -> SubscriptionQuota {
    let mut out = SubscriptionQuota::empty("ok", "");
    out.message = None;
    out.fetched_at = now;
    out.plan = plan;
    for (key, id, label, seconds) in [
        ("five_hour", "primary", "5-hour limit", 18000),
        ("seven_day", "secondary", "Weekly limit", 604800),
        ("seven_day_sonnet", "sonnet", "Sonnet · weekly", 604800),
        ("seven_day_opus", "opus", "Opus · weekly", 604800),
    ] {
        if let Some(w) = v.get(key) {
            if let Some(used) = number(w.get("utilization")) {
                out.windows.push(QuotaWindow {
                    id: id.into(),
                    label: label.into(),
                    used_percent: used.min(100.0),
                    reset_at: text(w.get("resets_at"), 64).map(Value::String),
                    window_seconds: Some(seconds as f64),
                });
            }
        }
    }
    if out.windows.is_empty() {
        out.status = "unavailable".into();
        out.message = Some("Claude did not report any subscription windows.".into());
    }
    out
}
fn profile(v: &Value) -> Option<Value> {
    let stats = v.get("stats")?.as_object()?;
    let mut out = serde_json::Map::new();
    for key in [
        "lifetime_tokens",
        "peak_daily_tokens",
        "longest_running_turn_sec",
        "current_streak_days",
        "longest_streak_days",
    ] {
        out.insert(
            key.into(),
            number(stats.get(key)).map_or(Value::Null, |n| json!(n)),
        );
    }
    let mut days = std::collections::BTreeMap::new();
    if let Some(buckets) = stats.get("daily_usage_buckets").and_then(Value::as_array) {
        for bucket in buckets.iter().take(10000) {
            if let (Some(day), Some(tokens)) = (
                text(bucket.get("start_date"), 10),
                number(bucket.get("tokens")),
            ) {
                if day.len() == 10
                    && day.bytes().enumerate().all(|(i, b)| {
                        if i == 4 || i == 7 {
                            b == b'-'
                        } else {
                            b.is_ascii_digit()
                        }
                    })
                {
                    days.insert(day, tokens);
                }
            }
        }
        out.insert(
            "daily_usage_buckets".into(),
            json!(days
                .into_iter()
                .rev()
                .take(366)
                .map(|(start_date, tokens)| json!({ "start_date": start_date, "tokens": tokens }))
                .collect::<Vec<_>>()),
        );
    }
    Some(Value::Object(out))
}
fn reset_credits(v: &Value) -> Option<Value> {
    let list = v.get("credits").and_then(Value::as_array);
    let count = v
        .get("available_count")
        .and_then(Value::as_u64)
        .or_else(|| {
            list.filter(|l| {
                l.iter()
                    .all(|c| c.get("status").and_then(Value::as_str).is_some())
            })
            .map(|l| l.iter().filter(|c| c["status"] == "available").count() as u64)
        })?;
    let expires: Vec<_> = list
        .into_iter()
        .flatten()
        .take(2000)
        .filter(|c| c["status"] == "available")
        .filter_map(|c| text(c.get("expires_at"), 64))
        .collect();
    Some(json!({ "availableCount": count, "expiresAt": expires }))
}

struct Authorization {
    headers: HeaderMap,
    identity: String,
    plan: Option<String>,
}
fn claude_authorization(interactive: bool) -> Result<Authorization, String> {
    let scope = crate::cli_auth::cli_auth_scope("claude".into())?;
    let dir = std::path::Path::new(&scope.directory);
    if !dir.is_absolute()
        || dir
            .components()
            .any(|p| matches!(p, std::path::Component::ParentDir))
    {
        return Err("Use an absolute CLAUDE_CONFIG_DIR for quota access.".into());
    }
    let explicit = match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(value) => !value.is_empty(),
        Err(std::env::VarError::NotPresent) => false,
        Err(_) => return Err("Invalid Claude credential scope".into()),
    };
    let service = if explicit {
        format!(
            "Claude Code-credentials-{}",
            &format!(
                "{:x}",
                Sha256::digest(scope.directory.trim_end_matches('/').as_bytes())
            )[..8]
        )
    } else {
        "Claude Code-credentials".into()
    };
    let bytes = match crate::quota_keychain::read(&service, None, interactive)? {
        Some(bytes) => bytes,
        None => {
            let file = std::fs::File::open(dir.join(".credentials.json")).map_err(|_| {
                "Claude subscription credentials are unavailable. Connect Claude in Providers."
            })?;
            let mut bytes = Vec::new();
            file.take(1_048_577)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read scoped Claude credentials")?;
            if bytes.len() > 1_048_576 {
                return Err("Invalid credential document size".into());
            }
            bytes
        }
    };
    let v: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid Claude credential document")?;
    let oauth = v
        .get("claudeAiOauth")
        .ok_or("Claude subscription login is required")?;
    let token = oauth
        .get("accessToken")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or("Claude subscription login is required")?;
    let mut headers = HeaderMap::new();
    let mut bearer = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "Invalid Claude credential")?;
    bearer.set_sensitive(true);
    headers.insert(AUTHORIZATION, bearer);
    headers.insert(
        "anthropic-beta",
        HeaderValue::from_static("oauth-2025-04-20"),
    );
    // Hash only: neither token nor credential document can enter the response/cache.
    let identity = format!(
        "{:x}",
        Sha256::digest(format!("{}|{token}", scope.directory).as_bytes())
    );
    Ok(Authorization {
        headers,
        identity,
        plan: text(oauth.get("subscriptionType"), 48),
    })
}

fn retry_delay_ms(header: Option<&str>, now: u64) -> u64 {
    let seconds = header
        .and_then(|h| h.trim().parse::<u64>().ok())
        .or_else(|| {
            let parts: Vec<_> = header?.split_whitespace().collect();
            if parts.len() != 6 || parts[5] != "GMT" {
                return None;
            }
            let year: u64 = parts[3].parse().ok()?;
            if !(1970..=9999).contains(&year) {
                return None;
            }
            let month = [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ]
            .iter()
            .position(|m| *m == parts[2])?;
            let leap = |y: u64| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
            let months = [
                31,
                if leap(year) { 29 } else { 28 },
                31,
                30,
                31,
                30,
                31,
                31,
                30,
                31,
                30,
                31,
            ];
            let day: u64 = parts[1].parse().ok()?;
            let time: Vec<u64> = parts[4]
                .split(':')
                .map(str::parse)
                .collect::<Result<_, _>>()
                .ok()?;
            if day == 0
                || day > months[month]
                || time.len() != 3
                || time[0] > 23
                || time[1] > 59
                || time[2] > 59
            {
                return None;
            }
            let days = (1970..year)
                .map(|y| if leap(y) { 366u64 } else { 365u64 })
                .sum::<u64>()
                + months[..month].iter().sum::<u64>()
                + day
                - 1;
            Some(
                (days * 86400 + time[0] * 3600 + time[1] * 60 + time[2]).saturating_sub(now / 1000),
            )
        })
        .unwrap_or(600);
    seconds.clamp(60, 2_678_400) * 1000
}
fn quota_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
}
#[derive(Debug)]
struct HttpError {
    status: String,
    message: String,
    retry_ms: u64,
}
async fn get(
    client: &reqwest::Client,
    url: &'static str,
    headers: &HeaderMap,
) -> Result<Value, HttpError> {
    if let Some(until) = BACKOFF
        .lock()
        .await
        .get(url)
        .copied()
        .filter(|until| *until > now_ms())
    {
        return Err(HttpError {
            status: "rate_limited".into(),
            message: "Usage endpoint is rate limited. Waiting before retrying.".into(),
            retry_ms: until.saturating_sub(now_ms()),
        });
    }
    let failure = || HttpError {
        status: "error".into(),
        message: "Subscription usage could not be read. Retrying shortly.".into(),
        retry_ms: 60_000,
    };
    let response = client
        .get(url)
        .headers(headers.clone())
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache, no-store")
        .send()
        .await
        .map_err(|_| failure())?;
    let status = response.status();
    if status.as_u16() == 429 {
        let delay = retry_delay_ms(
            response
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok()),
            now_ms(),
        );
        BACKOFF
            .lock()
            .await
            .insert(url, now_ms().saturating_add(delay));
        return Err(HttpError {
            status: "rate_limited".into(),
            message: "Usage endpoint is rate limited. Waiting before retrying.".into(),
            retry_ms: delay,
        });
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(HttpError {
            status: "auth".into(),
            message:
                "Quota access was rejected. Re-check the subscription connection in Providers."
                    .into(),
            retry_ms: 60_000,
        });
    }
    if !status.is_success() {
        return Err(failure());
    }
    if response.content_length().is_some_and(|n| n > 1_048_576) {
        return Err(failure());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| failure())?;
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err(failure());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| failure())
}

async fn authorization(engine: &'static str, interactive: bool) -> Result<Authorization, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if engine == "codex_cli" {
            crate::codex_subscription::quota_authorization(interactive).map(
                |(headers, identity)| Authorization {
                    headers,
                    identity,
                    plan: None,
                },
            )
        } else {
            claude_authorization(interactive)
        }
    })
    .await
    .map_err(|_| "Credential lookup failed")?
}

#[tauri::command]
pub async fn subscription_quota(
    app: tauri::AppHandle,
    provider_id: String,
    allow_keychain: Option<bool>,
) -> Result<SubscriptionQuota, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Profile unavailable")?
        .join("orion.db");
    let kind: String = tauri::async_runtime::spawn_blocking(move || {
        let db =
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "Provider storage unavailable")?;
        db.busy_timeout(Duration::from_secs(2))
            .map_err(|_| "Provider storage unavailable")?;
        db.query_row(
            "SELECT kind FROM providers WHERE id=?1 AND enabled=1",
            [provider_id],
            |row| row.get(0),
        )
        .map_err(|_| "Provider is not enabled")
    })
    .await
    .map_err(|_| "Provider lookup failed")??;
    let engine = match kind.as_str() {
        "codex_cli" => "codex_cli",
        "anthropic" => "claude",
        _ => {
            return Ok(SubscriptionQuota::empty(
                "unavailable",
                "No verified subscription quota connector for this provider.",
            ))
        }
    };
    let _account = crate::cli_auth::use_account(engine)?;
    let interactive = allow_keychain.unwrap_or(false);
    let mut auth = match authorization(engine, interactive).await {
        Ok(auth) => auth,
        Err(e) if e == "keychain_access" => {
            return Ok(SubscriptionQuota::empty(
                "keychain_access",
                "Allow Orion to read this connection's subscription usage.",
            ))
        }
        Err(_) => {
            return Ok(SubscriptionQuota::empty(
                "auth",
                "Subscription credentials unavailable. Re-check the connection in Providers.",
            ))
        }
    };
    let mut cache = if engine == "codex_cli" {
        CODEX.lock().await
    } else {
        CLAUDE.lock().await
    };
    let now = now_ms();
    if let Some(c) = cache.as_ref().filter(|c| {
        (c.identity == auth.identity || c.snapshot.status == "rate_limited") && now < c.until
    }) {
        return Ok(c.snapshot.clone());
    }
    let client = quota_client().map_err(|_| "Usage client unavailable")?;
    let url = if engine == "codex_cli" {
        "https://chatgpt.com/backend-api/wham/usage"
    } else {
        "https://api.anthropic.com/api/oauth/usage"
    };
    let mut result = get(&client, url, &auth.headers).await;
    if result.as_ref().is_err_and(|e| e.status == "auth") {
        // The owning CLI may have rotated credentials while this GET was in
        // flight. Re-read once, but never perform refresh/login ourselves.
        if let Ok(latest) = authorization(engine, false).await {
            if latest.identity != auth.identity {
                auth = latest;
                result = get(&client, url, &auth.headers).await;
            }
        }
    }
    let (mut snapshot, delay) = match result {
        Ok(v) => (
            if engine == "codex_cli" {
                codex_snapshot(&v, now)
            } else {
                claude_snapshot(&v, now, auth.plan)
            },
            60_000,
        ),
        Err(e) => (SubscriptionQuota::empty(&e.status, &e.message), e.retry_ms),
    };
    if snapshot.status == "ok" && engine == "codex_cli" {
        let mut credit_headers = auth.headers.clone();
        credit_headers.insert("openai-beta", HeaderValue::from_static("codex-1"));
        let (stats, credits) = tokio::join!(
            get(
                &client,
                "https://chatgpt.com/backend-api/wham/profiles/me",
                &auth.headers
            ),
            get(
                &client,
                "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
                &credit_headers
            )
        );
        snapshot.profile = stats.ok().and_then(|v| profile(&v));
        snapshot.reset_credits = credits.ok().and_then(|v| reset_credits(&v));
    }
    let until = now_ms().saturating_add(delay);
    snapshot.retry_at = Some(until);
    *cache = Some(Cached {
        identity: auth.identity,
        until,
        snapshot: snapshot.clone(),
    });
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn mock_http(response: String) -> &'static str {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 8192];
            let n = stream.read(&mut request).await.unwrap();
            assert!(std::str::from_utf8(&request[..n])
                .unwrap()
                .starts_with("GET "));
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        Box::leak(format!("http://{address}/quota-fixture").into_boxed_str())
    }
    #[tokio::test]
    async fn quota_transport_refuses_redirects_and_oversized_bodies() {
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = mock_http(format!("HTTP/1.1 302 Found\r\nLocation: http://{}/do-not-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", target.local_addr().unwrap())).await;
        assert!(get(&quota_client().unwrap(), url, &HeaderMap::new())
            .await
            .is_err());
        assert!(
            tokio::time::timeout(Duration::from_millis(100), target.accept())
                .await
                .is_err()
        );
        let url = mock_http(
            "HTTP/1.1 200 OK\r\nContent-Length: 1048577\r\nConnection: close\r\n\r\n".into(),
        )
        .await;
        assert!(get(&quota_client().unwrap(), url, &HeaderMap::new())
            .await
            .is_err());
    }
    #[tokio::test]
    async fn quota_transport_keeps_error_bodies_private_and_obeys_backoff() {
        let url = mock_http("HTTP/1.1 403 Forbidden\r\nContent-Length: 17\r\nConnection: close\r\n\r\nfixture-sensitive".into()).await;
        let error = get(&quota_client().unwrap(), url, &HeaderMap::new())
            .await
            .unwrap_err();
        assert_eq!(error.status, "auth");
        assert!(!error.message.contains("fixture-sensitive"));
        let url = mock_http("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 120\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()).await;
        assert_eq!(
            get(&quota_client().unwrap(), url, &HeaderMap::new())
                .await
                .unwrap_err()
                .retry_ms,
            120000
        );
        // The listener has gone: another network attempt would be a connection
        // error, not the cached rate-limit response.
        assert_eq!(
            get(&quota_client().unwrap(), url, &HeaderMap::new())
                .await
                .unwrap_err()
                .status,
            "rate_limited"
        );
        BACKOFF.lock().await.remove(url);
    }
    #[test]
    fn quota_preserves_week_when_primary_is_malformed_and_keeps_extras_separate() {
        let v = json!({"plan_type":"pro", "rate_limit":{"primary_window":{"used_percent":null},"secondary_window":{"used_percent":38,"limit_window_seconds":604800,"reset_at":1800000000}},"additional_rate_limits":[{"limit_name":"Spark","rate_limit":{"primary_window":{"used_percent":80}}}]});
        let q = codex_snapshot(&v, 1000);
        assert_eq!(q.windows.len(), 2);
        assert_eq!(q.windows[0].id, "secondary");
        assert_eq!(q.windows[0].used_percent, 38.0);
        assert_eq!(q.plan.as_deref(), Some("pro"));
        assert!(q.windows[1].id.starts_with("extra-"));
        assert!(codex_snapshot(&json!({}), 0).windows.is_empty());
    }
    #[test]
    fn quota_zero_is_real_but_missing_stats_and_credits_are_not_zero() {
        assert_eq!(
            codex_snapshot(
                &json!({"rate_limit":{"primary_window":{"used_percent":0}}}),
                0
            )
            .windows[0]
                .used_percent,
            0.0
        );
        assert!(profile(&json!({})).is_none());
        assert!(reset_credits(&json!({})).is_none());
        assert_eq!(
            reset_credits(&json!({"available_count":2,"credits":[]})).unwrap()["availableCount"],
            2
        );
        assert_eq!(
            reset_credits(&json!({"available_count":0})).unwrap()["availableCount"],
            0
        );
    }
    #[test]
    fn quota_filters_profile_to_numeric_statistics_only() {
        let p = profile(&json!({"email":"private", "stats":{"lifetime_tokens":28700000,"peak_daily_tokens":21000000,"secret":"never return","daily_usage_buckets":[{"start_date":"2026-09-15","tokens":100},{"start_date":"bad","tokens":12}]}})).unwrap();
        assert_eq!(p["lifetime_tokens"], 28700000.0);
        assert!(p.get("secret").is_none());
        assert_eq!(p["daily_usage_buckets"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn quota_retry_after_accepts_seconds_and_http_dates() {
        assert_eq!(retry_delay_ms(Some("120"), 0), 120000);
        assert_eq!(
            retry_delay_ms(Some("Thu, 01 Jan 1970 00:02:00 GMT"), 0),
            120000
        );
        assert_eq!(retry_delay_ms(Some("0"), 0), 60000);
        assert_eq!(retry_delay_ms(Some("invalid"), 0), 600000);
    }
    #[test]
    fn quota_claude_uses_subscription_utilization_not_local_tokens() {
        let q = claude_snapshot(
            &json!({"five_hour":{"utilization":12.5,"resets_at":"2026-09-15T22:00:00Z"},"seven_day":{"utilization":38},"seven_day_opus":null}),
            123,
            Some("max".into()),
        );
        assert_eq!(q.windows.len(), 2);
        assert_eq!(q.windows[1].id, "secondary");
        assert_eq!(q.windows[0].used_percent, 12.5);
    }
}
