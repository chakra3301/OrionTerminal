//! Local TCP bridge so the (out-of-process) MCP server can call back into
//! the running Tauri app for UI-state actions — opening apps, focusing
//! windows, switching projects, etc. The MCP server can't reach zustand
//! stores directly, so for anything beyond DB-only operations it sends a
//! one-line JSON message here, we emit a Tauri event to the frontend, and
//! the frontend executes the action against its stores.
//!
//! Protocol: newline-delimited JSON over localhost TCP. Each connection is
//! one request → one response, then close. Request shape:
//!   `{ "token": "<shared-secret>", "kind": "open_app", "payload": {...} }`
//! Response:
//!   `{ "ok": true }`  or  `{ "ok": false, "error": "..." }`
//!
//! Security: a process-local shared token gates every request. Random per
//! launch; passed to the MCP server via env vars when claude-code spawns it.

use once_cell::sync::{Lazy, OnceCell};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

/// Token + port published once the listener is bound. `mcp_config::write`
/// reads these to inject into the MCP server subprocess env.
static BRIDGE: OnceCell<BridgeInfo> = OnceCell::new();

/// In-flight requests awaiting a frontend reply, keyed by request id. The
/// connection task registers a oneshot here, emits `ui:action`, then awaits
/// the channel; `ui_bridge_respond` (called from the frontend) delivers the
/// result. This is what turns the bridge from fire-and-forget into a true
/// request→response RPC so tools can read state back.
static PENDING: Lazy<Mutex<HashMap<String, oneshot::Sender<BridgeResult>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// In-process equivalent of `PENDING`: the runtime's `dispatch_sync` blocks a
/// `spawn_blocking` thread on a std sync channel (not a tokio oneshot) because
/// it runs synchronously. `ui_bridge_respond` resolves whichever map holds the
/// request id.
static PENDING_SYNC: Lazy<Mutex<HashMap<String, std::sync::mpsc::Sender<BridgeResult>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct BridgeResult {
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
}

#[derive(Clone)]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
}

pub fn current() -> Option<&'static BridgeInfo> {
    BRIDGE.get()
}

#[derive(Deserialize)]
struct Request {
    token: String,
    kind: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Response {
    fn err(msg: impl Into<String>) -> Self {
        Response {
            ok: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

#[derive(Serialize, Clone)]
struct UiActionEvent {
    kind: String,
    payload: serde_json::Value,
    #[serde(rename = "requestId")]
    request_id: String,
}

/// Spawn the bridge listener. Returns the (port, token) we just bound so
/// the caller can stash them for child-process env injection.
pub async fn start(app: AppHandle) -> Result<BridgeInfo, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind ui_bridge: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = random_token();
    let info = BridgeInfo {
        port,
        token: token.clone(),
    };
    let _ = BRIDGE.set(info.clone());

    let app_clone = app.clone();
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => continue,
            };
            let app_for_conn = app_clone.clone();
            let token_for_conn = token.clone();
            tokio::spawn(async move {
                let (read_half, mut write_half) = socket.split();
                let mut reader = BufReader::new(read_half);
                let mut line = String::new();
                let _ = reader.read_line(&mut line).await;
                let response = handle_request(&app_for_conn, &token_for_conn, &line).await;
                let body = serde_json::to_string(&response)
                    .unwrap_or_else(|_| "{\"ok\":false}".to_string());
                let _ = write_half.write_all(body.as_bytes()).await;
                let _ = write_half.write_all(b"\n").await;
                let _ = write_half.shutdown().await;
            });
        }
    });
    Ok(info)
}

/// Removes a PENDING entry on ANY exit path (including a dropped/aborted
/// request future), so an abandoned request can't leak its slot + sender.
struct PendingGuard(String);
impl Drop for PendingGuard {
    fn drop(&mut self) {
        PENDING.lock().remove(&self.0);
    }
}

async fn handle_request(app: &AppHandle, expected_token: &str, line: &str) -> Response {
    let req: Request = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(e) => return Response::err(format!("malformed request: {}", e)),
    };
    if req.token != expected_token {
        return Response::err("bad token");
    }

    let request_id = format!("req-{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel::<BridgeResult>();
    PENDING.lock().insert(request_id.clone(), tx);
    let _guard = PendingGuard(request_id.clone());

    let emitted = app.emit(
        "ui:action",
        UiActionEvent {
            kind: req.kind,
            payload: req.payload,
            request_id: request_id.clone(),
        },
    );
    if emitted.is_err() {
        PENDING.lock().remove(&request_id);
        return Response::err("failed to emit ui:action");
    }

    // Wait for the frontend to call `ui_bridge_respond`. Bounded so a closed
    // app / thrown handler can't hang the calling tool. The frontend is
    // expected to ALWAYS respond (even for fire-and-forget kinds), so a
    // timeout means something genuinely went wrong.
    match timeout(Duration::from_secs(5), rx).await {
        Ok(Ok(result)) => Response {
            ok: result.ok,
            data: result.data,
            error: result.error,
        },
        Ok(Err(_)) => {
            PENDING.lock().remove(&request_id);
            Response::err("ui handler dropped without responding")
        }
        Err(_) => {
            PENDING.lock().remove(&request_id);
            Response::err("ui action timed out (is the target app open?)")
        }
    }
}

/// Emit a `ui:action` event and block (synchronously) for the frontend's
/// `ui_bridge_respond`. Used by the in-process runtime tool dispatch, which
/// runs on `spawn_blocking`. Same 5s bound + request shape as the TCP path.
pub fn dispatch_sync(app: &AppHandle, kind: &str, payload: Value) -> Result<Value, String> {
    use serde_json::json;
    let request_id = format!("req-{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = std::sync::mpsc::channel::<BridgeResult>();
    PENDING_SYNC.lock().insert(request_id.clone(), tx);

    let emitted = app.emit(
        "ui:action",
        UiActionEvent {
            kind: kind.to_string(),
            payload,
            request_id: request_id.clone(),
        },
    );
    if emitted.is_err() {
        PENDING_SYNC.lock().remove(&request_id);
        return Err("failed to emit ui:action".into());
    }

    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(result) => {
            if result.ok {
                Ok(result.data.unwrap_or_else(|| json!({})))
            } else {
                Err(result.error.unwrap_or_else(|| "ui action failed".into()))
            }
        }
        Err(_) => {
            PENDING_SYNC.lock().remove(&request_id);
            Err("ui action timed out (is the target app open?)".into())
        }
    }
}

/// Frontend → backend: deliver the result of a `ui:action` back to the
/// waiting bridge connection (TCP or in-process). No-op if the request
/// already timed out (the sender will have been removed from both maps).
#[tauri::command]
pub fn ui_bridge_respond(
    request_id: String,
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
) {
    let result = BridgeResult { ok, data, error };
    if let Some(tx) = PENDING.lock().remove(&request_id) {
        let _ = tx.send(result);
        return;
    }
    if let Some(tx) = PENDING_SYNC.lock().remove(&request_id) {
        let _ = tx.send(result);
    }
}

fn random_token() -> String {
    // 16 bytes from system random source → hex. No external deps.
    let mut bytes = [0u8; 16];
    if getrandom(&mut bytes).is_err() {
        // Fallback: timestamp-derived (low entropy but still launch-unique).
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{:032x}", now);
    }
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn getrandom(buf: &mut [u8]) -> Result<(), std::io::Error> {
    use std::fs::File;
    use std::io::Read;
    // /dev/urandom is universal on macOS + Linux. Tauri also runs on
    // Windows; this code path is best-effort, falling back to the
    // timestamp-derived token if reading fails.
    let mut f = File::open("/dev/urandom")?;
    f.read_exact(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn respond_resolves_sync_pending_map() {
        let (tx, rx) = mpsc::channel::<BridgeResult>();
        PENDING_SYNC.lock().insert("req-sync-test".to_string(), tx);
        ui_bridge_respond(
            "req-sync-test".to_string(),
            true,
            Some(serde_json::json!({ "ok": 1 })),
            None,
        );
        let got = rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        assert!(got.ok);
        assert_eq!(got.data.unwrap()["ok"], 1);
    }

    #[test]
    fn respond_unknown_id_is_noop() {
        // Must not panic when the id is in neither map.
        ui_bridge_respond("nope".to_string(), true, None, None);
    }
}
