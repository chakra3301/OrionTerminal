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
    model: String,
}

/// Agents eligible to (re)run: never-run, failed, or cancelled. Prompt falls
/// back to the parent task's prompt when the agent's own is blank.
fn read_dispatch_agents(app: &AppHandle, task_id: &str) -> Result<Vec<DispatchAgent>, String> {
    let conn = open_conn(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, COALESCE(NULLIF(a.prompt, ''), t.prompt), a.session_id, a.model \
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
                model: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
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
    let (mut running, mut failed, mut cancelled, mut paused, mut total) =
        (0i64, 0i64, 0i64, 0i64, 0i64);
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
                    "paused" => paused += n,
                    _ => {}
                }
            }
        }
    }
    if total == 0 || running > 0 {
        return;
    }
    let (status, col) = if paused > 0 {
        // Needs the user to Continue (or stop) the paused agent(s).
        ("paused", "review")
    } else if failed > 0 {
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

/// Strip an MCP namespace prefix so `mcp__orion__create_note` reads as
/// `create_note`; leaves bare tool names (Bash, Read…) untouched.
fn prettify_tool(name: &str) -> String {
    name.rsplit("__").next().unwrap_or(name).to_string()
}

/// One-line, length-capped version of a string for the activity feed.
fn truncate_one_line(s: &str, max: usize) -> String {
    let flat = s.trim().split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max {
        let kept: String = flat.chars().take(max).collect();
        format!("{}…", kept)
    } else {
        flat
    }
}

/// A short, human-readable hint of what a tool call is doing — pick the most
/// telling input field, else fall back to compact JSON.
fn summarize_tool_input(input: &Value) -> String {
    for key in [
        "command",
        "query",
        "pattern",
        "path",
        "file_path",
        "url",
        "prompt",
        "description",
        "title",
    ] {
        if let Some(s) = input.get(key).and_then(|x| x.as_str()) {
            if !s.trim().is_empty() {
                return truncate_one_line(s, 72);
            }
        }
    }
    match input {
        Value::Null => String::new(),
        Value::Object(m) if m.is_empty() => String::new(),
        _ => truncate_one_line(&input.to_string(), 72),
    }
}

/// Tool calls (id, pretty-name, brief) from a stream-json `assistant` snapshot.
fn collect_tool_uses(v: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    if let Some(content) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        for block in content {
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                let id = block.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let name = prettify_tool(block.get("name").and_then(|x| x.as_str()).unwrap_or("tool"));
                let brief = block.get("input").map(summarize_tool_input).unwrap_or_default();
                out.push((id, name, brief));
            }
        }
    }
    out
}

/// Failed tool results (tool_use_id, error-snippet) from a `user` snapshot.
/// Successful results are intentionally skipped to keep the feed concise.
fn collect_tool_errors(v: &Value) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(content) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        for block in content {
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result")
                && block.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false)
            {
                let id = block
                    .get("tool_use_id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let snippet = match block.get("content") {
                    Some(Value::String(s)) => truncate_one_line(s, 72),
                    Some(Value::Array(arr)) => truncate_one_line(
                        &arr.iter()
                            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join(" "),
                        72,
                    ),
                    _ => String::new(),
                };
                out.push((id, snippet));
            }
        }
    }
    out
}

/// Compose the live agent output: the accumulated tool-activity feed, then a
/// blank line, then the latest assistant prose.
fn compose_feed(feed: &[String], text: &str) -> String {
    let mut out = String::new();
    if !feed.is_empty() {
        out.push_str(&feed.join("\n"));
    }
    let text = text.trim();
    if !text.is_empty() {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(text);
    }
    out
}

/// Per-leg turn budget. When an agent hits this it PAUSES (status "paused")
/// instead of failing, and the user can Continue to grant another budget.
const MAX_TURNS: &str = "25";

async fn run_agent(
    app: AppHandle,
    task_id: String,
    agent: DispatchAgent,
    cwd: String,
    mcp: Option<String>,
) {
    let _ = set_agent_running(&app, &agent.id, now_millis());
    emit_agent_status(&app, &task_id, &agent.id, "running", "", "", None);

    // Per-agent model override; blank falls back to the shared default (Opus).
    let model = if agent.model.trim().is_empty() {
        OPUS_MODEL
    } else {
        agent.model.as_str()
    };
    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        model,
    ]);
    // Bound runaway usage: cap the turn budget (agent PAUSES at the limit —
    // the user can Continue) and forbid the swarm-spawning tools so one agent
    // can't recursively fan out into its own multi-agent / deep-research run.
    cmd.args(["--max-turns", MAX_TURNS]);
    cmd.args(["--disallowed-tools", "Task", "Workflow"]);
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
    // Live activity feed: tool calls (and failures) as they happen, plus the
    // latest assistant prose — so the card/transcript shows what the agent is
    // doing in real time, not just a final summary.
    let mut feed: Vec<String> = Vec::new();
    let mut seen_tools: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut tool_names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut last_text = String::new();
    let mut result_text: Option<String> = None;
    let mut result_error: Option<String> = None;
    let mut paused = false;
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
                                    let mut changed = false;
                                    for (id, name, brief) in collect_tool_uses(&v) {
                                        let key = if id.is_empty() {
                                            format!("{}:{}", name, brief)
                                        } else {
                                            id.clone()
                                        };
                                        if seen_tools.insert(key) {
                                            if !id.is_empty() {
                                                tool_names.insert(id, name.clone());
                                            }
                                            feed.push(if brief.is_empty() {
                                                format!("▸ {}", name)
                                            } else {
                                                format!("▸ {}  {}", name, brief)
                                            });
                                            changed = true;
                                        }
                                    }
                                    if let Some(t) = extract_assistant_text(&v) {
                                        last_text = t;
                                        changed = true;
                                    }
                                    if changed {
                                        emit_agent_text(
                                            &app,
                                            &task_id,
                                            &agent.id,
                                            &compose_feed(&feed, &last_text),
                                        );
                                    }
                                }
                                "user" => {
                                    let mut changed = false;
                                    for (id, snippet) in collect_tool_errors(&v) {
                                        let name = tool_names
                                            .get(&id)
                                            .cloned()
                                            .unwrap_or_else(|| "tool".to_string());
                                        feed.push(if snippet.is_empty() {
                                            format!("  ✗ {} failed", name)
                                        } else {
                                            format!("  ✗ {} failed — {}", name, snippet)
                                        });
                                        changed = true;
                                    }
                                    if changed {
                                        emit_agent_text(
                                            &app,
                                            &task_id,
                                            &agent.id,
                                            &compose_feed(&feed, &last_text),
                                        );
                                    }
                                }
                                "result" => {
                                    if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
                                        if !r.is_empty() {
                                            result_text = Some(r.to_string());
                                        }
                                    }
                                    // Run-level outcomes (usage/rate limits, API
                                    // errors, max-turns) arrive HERE, not on
                                    // stderr. Hitting the turn budget is a PAUSE
                                    // (resumable), not a failure — everything
                                    // else surfaces the real error reason.
                                    let subtype =
                                        v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
                                    let is_err = subtype == "error_max_turns"
                                        || v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false)
                                        || (!subtype.is_empty() && subtype != "success");
                                    if subtype == "error_max_turns" {
                                        paused = true;
                                    } else if is_err {
                                        let api_err = v
                                            .get("api_error_status")
                                            .and_then(|s| s.as_str())
                                            .filter(|s| !s.is_empty());
                                        let msg = v
                                            .get("result")
                                            .and_then(|r| r.as_str())
                                            .filter(|s| !s.is_empty())
                                            .map(|s| s.to_string())
                                            .or_else(|| api_err.map(|s| s.to_string()))
                                            .unwrap_or_else(|| {
                                                let st = v
                                                    .get("subtype")
                                                    .and_then(|s| s.as_str())
                                                    .unwrap_or("error");
                                                format!("agent error ({})", st)
                                            });
                                        result_error = Some(msg);
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

    // Final stored output = the activity feed + the agent's concluding prose.
    let final_text = result_text.unwrap_or(last_text);
    let final_output = compose_feed(&feed, &final_text);

    AGENTS.lock().remove(&agent.id);
    let now = now_millis();
    // Hitting the turn budget is a resumable PAUSE; a non-zero exit or an error
    // result event (that isn't a pause) is a failure.
    let paused_final = paused && matches!(outcome, Ok(_));
    let failed = !paused_final && (result_error.is_some() || matches!(outcome, Ok(false)));
    match outcome {
        Err(()) => {
            let _ = finish_agent(&app, &agent.id, "cancelled", &final_output, "", session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "cancelled", &final_output, "", session_id.clone());
        }
        _ if paused_final => {
            let _ = finish_agent(&app, &agent.id, "paused", &final_output, "", session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "paused", &final_output, "", session_id.clone());
        }
        _ if failed => {
            let err = result_error
                .or_else(|| {
                    let s = stderr_buf.lock();
                    let t = s.trim();
                    if t.is_empty() {
                        None
                    } else {
                        Some(t.to_string())
                    }
                })
                .unwrap_or_else(|| "agent exited with an error".to_string());
            let _ = finish_agent(&app, &agent.id, "failed", &final_output, &err, session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "failed", &final_output, &err, session_id.clone());
        }
        Ok(_) => {
            let _ = finish_agent(&app, &agent.id, "completed", &final_output, "", session_id.as_deref(), now);
            emit_agent_status(&app, &task_id, &agent.id, "completed", &final_output, "", session_id.clone());
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

/// Resume a single PAUSED agent with another turn budget. Reuses its claude
/// session so it picks up exactly where the turn cap stopped it.
#[tauri::command]
pub async fn hermes_continue_agent(
    app: AppHandle,
    agent_id: String,
    project_root: Option<String>,
) -> Result<(), String> {
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".to_string());

    let (task_id, session_id, model) = {
        let conn = open_conn(&app)?;
        conn.query_row(
            "SELECT task_id, session_id, model FROM hermes_agents WHERE id = ?1",
            params![agent_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };
    let sid = session_id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "this agent has no session to resume".to_string())?;

    {
        let conn = open_conn(&app)?;
        let now = now_millis();
        conn.execute(
            "UPDATE hermes_tasks SET status = 'running', column_id = 'running', updated_at = ?2 WHERE id = ?1",
            params![task_id, now],
        )
        .map_err(|e| e.to_string())?;
    }
    emit_task(&app, &task_id, "running", "running");

    let mcp = crate::mcp_config::write(&app);
    let agent = DispatchAgent {
        id: agent_id,
        prompt: "Please continue where you left off and finish the task.".to_string(),
        session_id: Some(sid),
        model,
    };
    let app2 = app.clone();
    let tid = task_id.clone();
    tauri::async_runtime::spawn(async move {
        run_agent(app2, tid, agent, cwd, mcp).await;
    });
    Ok(())
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
