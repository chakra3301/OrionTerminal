//! Hermes execution engine. A "Hermes agent" is a headless `claude` run; a
//! task can fan out to a PARALLEL SWARM of them. Dispatching a task spawns one
//! subprocess per dispatchable agent, streams each agent's assistant text back
//! to the frontend via `hermes:*` events, and persists final state to orion.db
//! so results survive a relaunch. The frontend store mirrors the events live;
//! during a run the engine is the sole DB writer for agent/task status.
//!
//! Reuses the same subscription-CLI plumbing as the chat rails (augmented
//! PATH, Opus model, the Orion MCP config) so swarm agents get Orion-aware
//! tools alongside claude-code's built-ins.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::claude_cli::{augmented_path, OPUS_MODEL};

/// Live agent subprocesses keyed by agent id, for cancellation.
static AGENTS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("orion.db"))
}

/// Fresh short-lived connection with a busy timeout so concurrent agent
/// writers (and the frontend sqlx pool) don't trip "database is locked".
/// Never held across an `.await` — keeps `Connection` off the async boundary.
fn open_conn(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    let _ = conn.busy_timeout(Duration::from_secs(5));
    Ok(conn)
}

#[derive(Serialize, Clone)]
struct AgentTextEvent {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct AgentStatusEvent {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    status: String,
    output: String,
    error: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct TaskEvent {
    #[serde(rename = "taskId")]
    task_id: String,
    status: String,
    #[serde(rename = "columnId")]
    column_id: String,
}

fn emit_agent_text(app: &AppHandle, task_id: &str, agent_id: &str, text: &str) {
    let _ = app.emit(
        "hermes:agent",
        AgentTextEvent {
            task_id: task_id.to_string(),
            agent_id: agent_id.to_string(),
            text: text.to_string(),
        },
    );
}

fn emit_agent_status(
    app: &AppHandle,
    task_id: &str,
    agent_id: &str,
    status: &str,
    output: &str,
    error: &str,
    session_id: Option<String>,
) {
    let _ = app.emit(
        "hermes:agentStatus",
        AgentStatusEvent {
            task_id: task_id.to_string(),
            agent_id: agent_id.to_string(),
            status: status.to_string(),
            output: output.to_string(),
            error: error.to_string(),
            session_id,
        },
    );
}

fn emit_task(app: &AppHandle, task_id: &str, status: &str, column_id: &str) {
    let _ = app.emit(
        "hermes:task",
        TaskEvent {
            task_id: task_id.to_string(),
            status: status.to_string(),
            column_id: column_id.to_string(),
        },
    );
}

struct DispatchAgent {
    id: String,
    prompt: String,
    session_id: Option<String>,
}

/// Agents eligible to (re)run: never-run, failed, or cancelled. Prompt falls
/// back to the parent task's prompt when the agent's own is blank.
fn read_dispatch_agents(app: &AppHandle, task_id: &str) -> Result<Vec<DispatchAgent>, String> {
    let conn = open_conn(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, COALESCE(NULLIF(a.prompt, ''), t.prompt), a.session_id \
               FROM hermes_agents a \
               JOIN hermes_tasks t ON t.id = a.task_id \
              WHERE a.task_id = ?1 AND a.status IN ('idle', 'failed', 'cancelled') \
              ORDER BY a.position, a.created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id], |r| {
            Ok(DispatchAgent {
                id: r.get(0)?,
                prompt: r.get(1)?,
                session_id: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn read_agent_ids(app: &AppHandle, task_id: &str) -> Result<Vec<String>, String> {
    let conn = open_conn(app)?;
    let mut stmt = conn
        .prepare("SELECT id FROM hermes_agents WHERE task_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn set_agent_running(app: &AppHandle, id: &str, now: i64) -> Result<(), String> {
    let conn = open_conn(app)?;
    conn.execute(
        "UPDATE hermes_agents SET status = 'running', started_at = ?2, error = '', updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn finish_agent(
    app: &AppHandle,
    id: &str,
    status: &str,
    output: &str,
    error: &str,
    session: Option<&str>,
    now: i64,
) -> Result<(), String> {
    let conn = open_conn(app)?;
    conn.execute(
        "UPDATE hermes_agents \
            SET status = ?2, output = ?3, error = ?4, \
                session_id = COALESCE(?5, session_id), finished_at = ?6, updated_at = ?6 \
          WHERE id = ?1",
        params![id, status, output, error, session, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Roll the task status up from its agents once none are still running. Only
/// touches a task that is still 'running' so a manual move isn't clobbered.
fn maybe_finalize_task(app: &AppHandle, task_id: &str) {
    let conn = match open_conn(app) {
        Ok(c) => c,
        Err(_) => return,
    };
    let (mut running, mut failed, mut cancelled, mut total) = (0i64, 0i64, 0i64, 0i64);
    if let Ok(mut stmt) =
        conn.prepare("SELECT status, COUNT(*) FROM hermes_agents WHERE task_id = ?1 GROUP BY status")
    {
        if let Ok(rows) =
            stmt.query_map(params![task_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        {
            for (st, n) in rows.flatten() {
                total += n;
                match st.as_str() {
                    "running" | "idle" => running += n,
                    "failed" => failed += n,
                    "cancelled" => cancelled += n,
                    _ => {}
                }
            }
        }
    }
    if total == 0 || running > 0 {
        return;
    }
    let (status, col) = if failed > 0 {
        ("failed", "blocked")
    } else if cancelled > 0 {
        ("cancelled", "ready")
    } else {
        ("completed", "review")
    };
    let now = now_millis();
    let affected = conn
        .execute(
            "UPDATE hermes_tasks SET status = ?2, column_id = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'running'",
            params![task_id, status, col, now],
        )
        .unwrap_or(0);
    if affected > 0 {
        emit_task(app, task_id, status, col);
    }
}

/// Pull joined text blocks out of a stream-json `assistant` snapshot.
fn extract_assistant_text(v: &Value) -> Option<String> {
    let content = v.get("message")?.get("content")?.as_array()?;
    let mut parts = Vec::new();
    for block in content {
        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                parts.push(t.to_string());
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

async fn run_agent(
    app: AppHandle,
    task_id: String,
    agent: DispatchAgent,
    cwd: String,
    mcp: Option<String>,
) {
    let _ = set_agent_running(&app, &agent.id, now_millis());
    emit_agent_status(&app, &task_id, &agent.id, "running", "", "", None);

    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        OPUS_MODEL,
    ]);
    if let Some(ref m) = mcp {
        cmd.args(["--mcp-config", m]);
    }
    if let Some(ref sid) = agent.session_id {
        if !sid.is_empty() {
            cmd.args(["--resume", sid]);
        }
    }
    // `--mcp-config` is variadic; the `--` sentinel stops it eating the prompt.
    cmd.arg("--");
    cmd.arg(&agent.prompt);
    cmd.current_dir(&cwd);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("failed to spawn `claude` — is the CLI on PATH? ({})", e);
            let _ = finish_agent(&app, &agent.id, "failed", "", &msg, None, now_millis());
            emit_agent_status(&app, &task_id, &agent.id, "failed", "", &msg, None);
            maybe_finalize_task(&app, &task_id);
            return;
        }
    };

    let cancel = Arc::new(Notify::new());
    AGENTS.lock().insert(agent.id.clone(), cancel.clone());

    // Drain stderr into a capped buffer so a chatty subprocess can't block on a
    // full pipe, and so we have something to report on failure.
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut s = buf.lock();
                s.push_str(&line);
                s.push('\n');
                if s.len() > 4000 {
                    let cut = s.len() - 4000;
                    s.replace_range(0..cut, "");
                }
            }
        });
    }

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = finish_agent(&app, &agent.id, "failed", "", "no stdout from agent", None, now_millis());
            emit_agent_status(&app, &task_id, &agent.id, "failed", "", "no stdout from agent", None);
            AGENTS.lock().remove(&agent.id);
            maybe_finalize_task(&app, &task_id);
            return;
        }
    };

    let mut lines = BufReader::new(stdout).lines();
    let mut current_text = String::new();
    let mut session_id: Option<String> = None;

    // Ok(true)=success, Ok(false)=process error, Err(())=cancelled.
    let outcome: Result<bool, ()> = loop {
        tokio::select! {
            _ = cancel.notified() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                break Err(());
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                                session_id = Some(sid.to_string());
                            }
                            match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                                "assistant" => {
                                    if let Some(t) = extract_assistant_text(&v) {
                                        current_text = t;
                                        emit_agent_text(&app, &task_id, &agent.id, &current_text);
                                    }
                                }
                                "result" => {
                                    if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
                                        if !r.is_empty() {
                                            current_text = r.to_string();
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    Ok(None) => {
                        let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
                        break Ok(ok);
                    }
                    Err(_) => {
                        let _ = child.kill().await;
                        break Ok(false);
                    }
                }
            }
        }
    };

    AGENTS.lock().remove(&agent.id);
    let now = now_millis();
    match outcome {
        Ok(true) => {
            let _ = finish_agent(&app, &agent.id, "completed", &current_text, "", session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "completed", &current_text, "", session_id.clone());
        }
        Ok(false) => {
            let err = {
                let s = stderr_buf.lock();
                let t = s.trim();
                if t.is_empty() {
                    "agent exited with an error".to_string()
                } else {
                    t.to_string()
                }
            };
            let _ = finish_agent(&app, &agent.id, "failed", &current_text, &err, session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "failed", &current_text, &err, session_id.clone());
        }
        Err(()) => {
            let _ = finish_agent(&app, &agent.id, "cancelled", &current_text, "", session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "cancelled", &current_text, "", session_id.clone());
        }
    }
    maybe_finalize_task(&app, &task_id);
}

/// Dispatch a task: spawn its dispatchable agents as parallel `claude` runs.
/// Returns immediately with the number of agents launched; progress arrives
/// via `hermes:*` events. This is the only path that actually executes work —
/// ROSIE plans the board but never calls it (approval gate).
#[tauri::command]
pub async fn hermes_dispatch_task(
    app: AppHandle,
    task_id: String,
    project_root: Option<String>,
) -> Result<u32, String> {
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".to_string());

    let agents = read_dispatch_agents(&app, &task_id)?;
    if agents.is_empty() {
        return Err("no dispatchable agents on this task — add an agent first".to_string());
    }

    let now = now_millis();
    {
        let conn = open_conn(&app)?;
        conn.execute(
            "UPDATE hermes_tasks SET status = 'running', column_id = 'running', dispatched_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![task_id, now],
        )
        .map_err(|e| e.to_string())?;
    }
    emit_task(&app, &task_id, "running", "running");

    // Attach the Orion MCP server so swarm agents have Orion-aware tools.
    // Non-fatal if it can't be written — agents still run, just without them.
    let mcp = crate::mcp_config::write(&app);
    let count = agents.len() as u32;
    for agent in agents {
        let app2 = app.clone();
        let tid = task_id.clone();
        let cwd2 = cwd.clone();
        let mcp2 = mcp.clone();
        tauri::async_runtime::spawn(async move {
            run_agent(app2, tid, agent, cwd2, mcp2).await;
        });
    }
    Ok(count)
}

#[tauri::command]
pub fn hermes_stop_agent(agent_id: String) -> Result<(), String> {
    if let Some(n) = AGENTS.lock().remove(&agent_id) {
        n.notify_waiters();
    }
    Ok(())
}

#[tauri::command]
pub fn hermes_stop_task(app: AppHandle, task_id: String) -> Result<(), String> {
    let ids = read_agent_ids(&app, &task_id)?;
    let mut map = AGENTS.lock();
    for id in ids {
        if let Some(n) = map.remove(&id) {
            n.notify_waiters();
        }
    }
    Ok(())
}
