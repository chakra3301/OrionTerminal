//! Language-server process management (Phase 1.6). Deliberately dumb: spawn
//! a server, speak the LSP base protocol's Content-Length framing on its
//! stdio, and shuttle whole JSON payloads to/from the frontend as events.
//! Every bit of protocol intelligence (initialize, sync, requests) lives in
//! TypeScript where iteration is cheap.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};

use crate::claude_cli::augmented_path;

struct LspProc {
    child: Child,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
}

static SERVERS: Lazy<Mutex<HashMap<String, LspProc>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct MessagePayload {
    #[serde(rename = "serverId")]
    server_id: String,
    message: String,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    #[serde(rename = "serverId")]
    server_id: String,
}

/// Is this server binary on PATH (augmented with the usual user dirs)?
#[tauri::command]
pub async fn lsp_probe(cmd: String) -> bool {
    let mut probe = Command::new(&cmd);
    probe.arg("--version");
    probe.env("PATH", augmented_path());
    probe.stdin(Stdio::null());
    probe.stdout(Stdio::null());
    probe.stderr(Stdio::null());
    matches!(probe.status().await, Ok(s) if s.success())
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    server_id: String,
    cmd: String,
    args: Vec<String>,
    root: String,
) -> Result<(), String> {
    if SERVERS.lock().contains_key(&server_id) {
        return Ok(());
    }

    let mut command = Command::new(&cmd);
    command.args(&args);
    command.current_dir(&root);
    command.env("PATH", augmented_path());
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn {cmd}: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take();

    // stderr → log so server crashes are diagnosable.
    if let Some(mut se) = stderr {
        let sid = server_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match se.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        eprintln!("[lsp:{sid}] {}", String::from_utf8_lossy(&buf[..n]));
                    }
                }
            }
        });
    }

    // stdout reader: Content-Length framed JSON → `lsp:message` events.
    {
        let sid = server_id.clone();
        let app = app.clone();
        let mut out = stdout;
        tauri::async_runtime::spawn(async move {
            let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
            let mut chunk = [0u8; 16 * 1024];
            loop {
                match out.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        loop {
                            let Some(header_end) = find_subslice(&buf, b"\r\n\r\n") else {
                                break;
                            };
                            let header = String::from_utf8_lossy(&buf[..header_end]);
                            let Some(len) = header
                                .lines()
                                .find_map(|l| l.strip_prefix("Content-Length:"))
                                .and_then(|v| v.trim().parse::<usize>().ok())
                            else {
                                // Unparseable header — drop it to resync.
                                buf.drain(..header_end + 4);
                                continue;
                            };
                            let body_start = header_end + 4;
                            if buf.len() < body_start + len {
                                break; // body not fully read yet
                            }
                            let body =
                                String::from_utf8_lossy(&buf[body_start..body_start + len])
                                    .into_owned();
                            buf.drain(..body_start + len);
                            let _ = app.emit(
                                "lsp:message",
                                MessagePayload {
                                    server_id: sid.clone(),
                                    message: body,
                                },
                            );
                        }
                    }
                }
            }
            SERVERS.lock().remove(&sid);
            let _ = app.emit("lsp:exit", ExitPayload { server_id: sid });
        });
    }

    SERVERS.lock().insert(
        server_id,
        LspProc {
            child,
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn lsp_send(server_id: String, message: String) -> Result<(), String> {
    let stdin = {
        let servers = SERVERS.lock();
        let proc = servers.get(&server_id).ok_or("server not running")?;
        proc.stdin.clone()
    };
    let framed = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
    let mut guard = stdin.lock().await;
    guard
        .write_all(framed.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    guard.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_stop(server_id: String) -> Result<(), String> {
    let proc = SERVERS.lock().remove(&server_id);
    if let Some(mut p) = proc {
        let _ = p.child.kill().await;
    }
    Ok(())
}

/// Kill every running language server. Called on app exit. `start_kill` is the
/// non-async SIGKILL trigger on tokio's Child, safe to call from the sync
/// RunEvent handler.
pub fn kill_all() {
    let mut map = SERVERS.lock();
    for (_, mut proc) in map.drain() {
        let _ = proc.child.start_kill();
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

#[cfg(test)]
mod lsp_tests {
    use super::find_subslice;

    #[test]
    fn finds_header_terminator() {
        assert_eq!(find_subslice(b"Content-Length: 2\r\n\r\n{}", b"\r\n\r\n"), Some(17));
        assert_eq!(find_subslice(b"partial\r\n", b"\r\n\r\n"), None);
    }
}
