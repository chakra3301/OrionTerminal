//! Chat view for Orion's agent tabs (Claude Code, Codex, Pi, Hermes): runs the
//! installed CLI headless in the project and normalises each harness's JSON
//! stream into one small schema the panel renders. The Terminal view is the
//! interactive PTY in `terminal.rs`; the two views are separate sessions, as in
//! Cursor.
//!
//! Normalised events (`agent:event` → `{chatId, event}`):
//!   {kind:"init", sessionId}
//!   {kind:"text", id, text}                 — full snapshot of one text part
//!   {kind:"tool", id, name, input}
//!   {kind:"tool_result", id, output, isError}
//!   {kind:"notice", text}                   — non-fatal CLI warning
//!   {kind:"error", text}
//!   {kind:"result", sessionId}
//! followed by one `agent:exit` → `{chatId, code, error}`.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::agent_cli::{clean, AgentOptions};

const OUTPUT_CAP: usize = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    Claude,
    Codex,
    Pi,
    Hermes,
}

impl Agent {
    pub fn parse(s: &str) -> Option<Agent> {
        match s {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            "pi" => Some(Agent::Pi),
            "hermes" => Some(Agent::Hermes),
            _ => None,
        }
    }
    fn program(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Pi => "pi",
            Agent::Hermes => "hermes",
        }
    }
}

/// argv + optional stdin for one headless turn. Each harness keeps its own
/// login, config and default model, like its interactive terminal mode.
/// Model / effort / mode left unset use the CLI's own configured default.
pub fn agent_argv(
    agent: Agent,
    prompt: &str,
    cwd: &str,
    session_id: Option<&str>,
    mcp_config: Option<&str>,
    opts: &AgentOptions,
) -> (Vec<String>, Option<String>) {
    let sid = session_id.filter(|s| !s.trim().is_empty());
    let s = |v: &str| v.to_string();
    let model = clean(&opts.model);
    let effort = clean(&opts.effort);
    let mode = clean(&opts.mode);
    match agent {
        Agent::Claude => {
            let permission = match mode {
                Some("plan") => "plan",
                _ => "acceptEdits",
            };
            let mut a = vec![
                s("--print"),
                s("--output-format"),
                s("stream-json"),
                s("--verbose"),
                s("--include-partial-messages"),
                s("--permission-mode"),
                s(permission),
            ];
            if let Some(m) = model {
                a.extend([s("--model"), s(m)]);
            }
            if let Some(e) = effort {
                a.extend([s("--effort"), s(e)]);
            }
            if let Some(m) = mcp_config {
                a.extend([s("--mcp-config"), s(m)]);
            }
            if let Some(sid) = sid {
                a.extend([s("--resume"), s(sid)]);
            }
            // `--mcp-config` is variadic; `--` stops it from eating the prompt.
            a.extend([s("--"), s(prompt)]);
            (a, None)
        }
        Agent::Codex => {
            let sandbox = match mode {
                Some("read-only") => "read-only",
                _ => "workspace-write",
            };
            let mut a = match sid {
                // `exec resume` rejects -s/-C; it keeps the thread's cwd and takes
                // the sandbox as a config override (checked on codex 0.163).
                Some(sid) => vec![s("exec"), s("resume"), s(sid), s("-c"), format!("sandbox_mode=\"{sandbox}\"")],
                None => vec![s("exec"), s("-s"), s(sandbox), s("-C"), s(cwd)],
            };
            a.extend([s("--json"), s("--skip-git-repo-check")]);
            if let Some(m) = model {
                a.extend([s("-m"), s(m)]);
            }
            if let Some(e) = effort {
                a.extend([s("-c"), format!("model_reasoning_effort=\"{e}\"")]);
            }
            a.push(s("-"));
            (a, Some(format!("{prompt}\n")))
        }
        Agent::Pi => {
            let mut a = vec![s("--mode"), s("json"), s("--print")];
            if let Some(m) = model {
                a.extend([s("--model"), s(m)]);
            }
            if let Some(e) = effort {
                a.extend([s("--thinking"), s(e)]);
            }
            if let Some(sid) = sid {
                a.extend([s("--session-id"), s(sid)]);
            }
            a.extend([s("--"), s(prompt)]);
            (a, None)
        }
        Agent::Hermes => {
            let mut a = vec![
                s("chat"),
                s("--query-file"),
                s("-"),
                s("-Q"),
                s("--format"),
                s("stream-json"),
                s("--in"),
                s(cwd),
            ];
            if let Some(m) = model {
                a.extend([s("-m"), s(m)]);
            }
            if let Some(e) = effort {
                a.extend([s("--reasoning"), s(e)]);
            }
            if let Some(sid) = sid {
                a.extend([s("--resume"), s(sid)]);
            }
            (a, Some(prompt.to_string()))
        }
    }
}

// ───────────────────────────── normaliser ─────────────────────────────

#[derive(Default)]
pub struct Norm {
    seq: u64,
    /// Text parts streamed so far, keyed by part id.
    parts: HashMap<String, String>,
    /// Current streaming text part (pi / hermes / claude partials).
    current: Option<String>,
    /// Claude: message ids that produced streamed text (skip their full copy).
    streamed_messages: Vec<String>,
    claude_message: Option<String>,
    claude_blocks: HashMap<u64, String>,
    /// Hermes: tool calls without ids, matched to results by name.
    open_tools: Vec<(String, String)>,
    started_tools: Vec<String>,
    session: Option<String>,
}

fn cap(s: &str) -> String {
    if s.len() <= OUTPUT_CAP {
        return s.to_string();
    }
    let mut cut = OUTPUT_CAP;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &s[..cut])
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|i| i.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other
            .get("content")
            .map(text_of)
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| other.to_string()),
    }
}

/// Error strings from model APIs are often a JSON envelope; show its message.
fn error_message(raw: &str) -> String {
    let inner = raw.find('{').and_then(|at| serde_json::from_str::<Value>(&raw[at..]).ok());
    inner
        .as_ref()
        .and_then(|v| v.pointer("/error/message").or_else(|| v.get("message")))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| raw.trim().to_string())
}

impl Norm {
    fn next_id(&mut self, prefix: &str) -> String {
        self.seq += 1;
        format!("{prefix}{}", self.seq)
    }
    fn append(&mut self, id: &str, delta: &str) -> Value {
        let text = self.parts.entry(id.to_string()).or_default();
        text.push_str(delta);
        json!({ "kind": "text", "id": id, "text": text })
    }
    fn set_text(&mut self, id: &str, text: &str) -> Value {
        self.parts.insert(id.to_string(), text.to_string());
        json!({ "kind": "text", "id": id, "text": text })
    }
    fn init(&mut self, sid: &str) -> Value {
        self.session = Some(sid.to_string());
        json!({ "kind": "init", "sessionId": sid })
    }
    fn result(&self) -> Value {
        json!({ "kind": "result", "sessionId": self.session.clone().unwrap_or_default() })
    }
    fn tool(&mut self, id: &str, name: &str, input: Value) -> Value {
        self.started_tools.push(id.to_string());
        self.current = None;
        json!({ "kind": "tool", "id": id, "name": name, "input": input })
    }
    fn tool_result(id: &str, output: &str, is_error: bool) -> Value {
        json!({ "kind": "tool_result", "id": id, "output": cap(output), "isError": is_error })
    }

    pub fn line(&mut self, agent: Agent, line: &str) -> Vec<Value> {
        let Some(v) = serde_json::from_str::<Value>(line).ok().filter(Value::is_object) else {
            return vec![];
        };
        match agent {
            Agent::Claude => self.claude(&v),
            Agent::Codex => self.codex(&v),
            Agent::Pi => self.pi(&v),
            Agent::Hermes => self.hermes(&v),
        }
    }

    fn claude(&mut self, v: &Value) -> Vec<Value> {
        let t = v.get("type").and_then(Value::as_str).unwrap_or("");
        match t {
            "system" if v.get("subtype").and_then(Value::as_str) == Some("init") => {
                let sid = v.get("session_id").and_then(Value::as_str).unwrap_or("").to_string();
                vec![self.init(&sid)]
            }
            "stream_event" => {
                let e = v.get("event").cloned().unwrap_or(Value::Null);
                match e.get("type").and_then(Value::as_str) {
                    Some("message_start") => {
                        self.claude_message = e.pointer("/message/id").and_then(Value::as_str).map(str::to_string);
                        self.claude_blocks.clear();
                        vec![]
                    }
                    Some("content_block_start") => {
                        if e.pointer("/content_block/type").and_then(Value::as_str) == Some("text") {
                            let idx = e.get("index").and_then(Value::as_u64).unwrap_or(0);
                            let msg = self.claude_message.clone().unwrap_or_else(|| "m".into());
                            self.claude_blocks.insert(idx, format!("{msg}:{idx}"));
                            if !self.streamed_messages.contains(&msg) {
                                self.streamed_messages.push(msg);
                            }
                        }
                        vec![]
                    }
                    Some("content_block_delta") => {
                        let idx = e.get("index").and_then(Value::as_u64).unwrap_or(0);
                        let delta = e.pointer("/delta/text").and_then(Value::as_str);
                        match (self.claude_blocks.get(&idx).cloned(), delta) {
                            (Some(id), Some(d)) if !d.is_empty() => vec![self.append(&id, d)],
                            _ => vec![],
                        }
                    }
                    _ => vec![],
                }
            }
            "assistant" => {
                let msg_id = v.pointer("/message/id").and_then(Value::as_str).unwrap_or("m").to_string();
                let streamed = self.streamed_messages.contains(&msg_id);
                let mut out = vec![];
                if let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) {
                    for b in blocks {
                        match b.get("type").and_then(Value::as_str) {
                            Some("text") if !streamed => {
                                let id = self.next_id(&format!("{msg_id}:full"));
                                let text = b.get("text").and_then(Value::as_str).unwrap_or("");
                                if !text.is_empty() {
                                    out.push(self.set_text(&id, text));
                                }
                            }
                            Some("tool_use") => {
                                let id = b.get("id").and_then(Value::as_str).unwrap_or("tool").to_string();
                                let name = b.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                                out.push(self.tool(&id, &name, b.get("input").cloned().unwrap_or(json!({}))));
                            }
                            _ => {}
                        }
                    }
                }
                out
            }
            "user" => v
                .pointer("/message/content")
                .and_then(Value::as_array)
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
                        .map(|b| {
                            let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("tool");
                            let is_error = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                            Self::tool_result(id, &text_of(b.get("content").unwrap_or(&Value::Null)), is_error)
                        })
                        .collect()
                })
                .unwrap_or_default(),
            "result" => {
                if let Some(sid) = v.get("session_id").and_then(Value::as_str) {
                    self.session = Some(sid.to_string());
                }
                let mut out = vec![];
                if v.get("is_error").and_then(Value::as_bool) == Some(true) {
                    let errors = v.get("errors").map(text_of).filter(|e| !e.is_empty());
                    let text = errors
                        .or_else(|| v.get("result").and_then(Value::as_str).map(str::to_string))
                        .unwrap_or_else(|| "Claude Code reported an error.".into());
                    out.push(json!({ "kind": "error", "text": error_message(&text) }));
                }
                out.push(self.result());
                out
            }
            _ => vec![],
        }
    }

    fn codex(&mut self, v: &Value) -> Vec<Value> {
        let t = v.get("type").and_then(Value::as_str).unwrap_or("");
        match t {
            "thread.started" => {
                let sid = v.get("thread_id").and_then(Value::as_str).unwrap_or("").to_string();
                vec![self.init(&sid)]
            }
            "item.started" | "item.completed" => {
                let Some(item) = v.get("item") else { return vec![] };
                let id = item.get("id").and_then(Value::as_str).unwrap_or("item").to_string();
                let done = t == "item.completed";
                let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
                let mut out = vec![];
                let start = |n: &mut Norm, name: &str, input: Value, out: &mut Vec<Value>| {
                    if !n.started_tools.contains(&id) {
                        out.push(n.tool(&id, name, input));
                    }
                };
                match kind {
                    "agent_message" if done => {
                        let text = item.get("text").and_then(Value::as_str).unwrap_or("").trim_end().to_string();
                        if !text.is_empty() {
                            out.push(self.set_text(&id, &text));
                        }
                    }
                    "command_execution" => {
                        let command = item.get("command").and_then(Value::as_str).unwrap_or("");
                        start(self, "shell", json!({ "command": command }), &mut out);
                        if done {
                            let output = item.get("aggregated_output").and_then(Value::as_str).unwrap_or("");
                            let code = item.get("exit_code").and_then(Value::as_i64).unwrap_or(0);
                            out.push(Self::tool_result(&id, output, code != 0));
                        }
                    }
                    "file_change" => {
                        let changes = item.get("changes").cloned().unwrap_or(json!([]));
                        start(self, "edit", json!({ "changes": changes }), &mut out);
                        if done {
                            let failed = item.get("status").and_then(Value::as_str).is_some_and(|s| s != "completed");
                            let files = changes
                                .as_array()
                                .map(|c| c.iter().filter_map(|x| x.get("path").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"))
                                .unwrap_or_default();
                            out.push(Self::tool_result(&id, &files, failed));
                        }
                    }
                    "mcp_tool_call" => {
                        let server = item.get("server").and_then(Value::as_str).unwrap_or("mcp");
                        let tool = item.get("tool").and_then(Value::as_str).unwrap_or("tool");
                        start(self, &format!("{server}.{tool}"), item.get("arguments").cloned().unwrap_or(json!({})), &mut out);
                        if done {
                            let err = item.pointer("/error/message").and_then(Value::as_str);
                            let output = err.map(str::to_string).unwrap_or_else(|| text_of(item.get("result").unwrap_or(&Value::Null)));
                            out.push(Self::tool_result(&id, &output, err.is_some()));
                        }
                    }
                    "web_search" => {
                        let query = item.get("query").and_then(Value::as_str).unwrap_or("");
                        start(self, "web_search", json!({ "query": query }), &mut out);
                        if done {
                            out.push(Self::tool_result(&id, "", false));
                        }
                    }
                    "error" if done => {
                        let msg = item.get("message").and_then(Value::as_str).unwrap_or("error");
                        out.push(json!({ "kind": "notice", "text": msg }));
                    }
                    _ => {}
                }
                out
            }
            "turn.completed" => vec![self.result()],
            "turn.failed" => {
                let msg = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("Codex turn failed.");
                vec![json!({ "kind": "error", "text": error_message(msg) })]
            }
            "error" => {
                let msg = v.get("message").and_then(Value::as_str).unwrap_or("Codex error.");
                vec![json!({ "kind": "error", "text": error_message(msg) })]
            }
            _ => vec![],
        }
    }

    fn pi(&mut self, v: &Value) -> Vec<Value> {
        match v.get("type").and_then(Value::as_str).unwrap_or("") {
            "session" => {
                let sid = v.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                vec![self.init(&sid)]
            }
            "message_start" if v.pointer("/message/role").and_then(Value::as_str) == Some("assistant") => {
                self.current = Some(self.next_id("pi"));
                vec![]
            }
            "message_update" => {
                let e = v.get("assistantMessageEvent").cloned().unwrap_or(Value::Null);
                if e.get("type").and_then(Value::as_str) != Some("text_delta") {
                    return vec![];
                }
                let delta = e.get("delta").and_then(Value::as_str).unwrap_or("");
                if delta.is_empty() {
                    return vec![];
                }
                let id = match self.current.clone() {
                    Some(id) => id,
                    None => {
                        let id = self.next_id("pi");
                        self.current = Some(id.clone());
                        id
                    }
                };
                vec![self.append(&id, delta)]
            }
            "message_end" if v.pointer("/message/role").and_then(Value::as_str) == Some("assistant") => {
                if v.pointer("/message/stopReason").and_then(Value::as_str) == Some("error") {
                    let raw = v.pointer("/message/errorMessage").and_then(Value::as_str).unwrap_or("Pi reported an error.");
                    return vec![json!({ "kind": "error", "text": error_message(raw) })];
                }
                vec![]
            }
            "tool_execution_start" => {
                let id = v.get("toolCallId").and_then(Value::as_str).unwrap_or("tool").to_string();
                let name = v.get("toolName").and_then(Value::as_str).unwrap_or("tool").to_string();
                vec![self.tool(&id, &name, v.get("args").cloned().unwrap_or(json!({})))]
            }
            "tool_execution_end" => {
                let id = v.get("toolCallId").and_then(Value::as_str).unwrap_or("tool");
                let is_error = v.get("isError").and_then(Value::as_bool).unwrap_or(false);
                let output = text_of(v.get("result").unwrap_or(&Value::Null));
                vec![Self::tool_result(id, &output, is_error)]
            }
            "agent_end" => vec![self.result()],
            _ => vec![],
        }
    }

    fn hermes(&mut self, v: &Value) -> Vec<Value> {
        match v.get("type").and_then(Value::as_str).unwrap_or("") {
            "system" if v.get("subtype").and_then(Value::as_str) == Some("init") => {
                let sid = v.get("session_id").and_then(Value::as_str).unwrap_or("").to_string();
                vec![self.init(&sid)]
            }
            "text" => {
                let delta = v.get("text").and_then(Value::as_str).unwrap_or("");
                if delta.is_empty() {
                    return vec![];
                }
                let id = match self.current.clone() {
                    Some(id) => id,
                    None => {
                        let id = self.next_id("h");
                        self.current = Some(id.clone());
                        id
                    }
                };
                vec![self.append(&id, delta)]
            }
            "tool_use" => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                let id = match v.get("tool_call_id").and_then(Value::as_str) {
                    Some(id) => id.to_string(),
                    None => self.next_id("ht"),
                };
                self.open_tools.push((id.clone(), name.clone()));
                vec![self.tool(&id, &name, v.get("input").cloned().unwrap_or(json!({})))]
            }
            "tool_result" => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or("");
                let id = match v.get("tool_call_id").and_then(Value::as_str) {
                    Some(id) => id.to_string(),
                    None => match self.open_tools.iter().position(|(_, n)| n == name) {
                        Some(at) => self.open_tools.remove(at).0,
                        None => return vec![],
                    },
                };
                self.open_tools.retain(|(open, _)| open != &id);
                let is_error = v.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                let output = v.get("output").and_then(Value::as_str).unwrap_or("");
                vec![Self::tool_result(&id, output, is_error)]
            }
            "result" => {
                if let Some(sid) = v.get("session_id").and_then(Value::as_str) {
                    self.session = Some(sid.to_string());
                }
                let code = v.get("exit_code").and_then(Value::as_i64).unwrap_or(0);
                let text = v.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string();
                let mut out = vec![];
                if code != 0 {
                    let err = v.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or(text);
                    out.push(json!({ "kind": "error", "text": if err.is_empty() { "Hermes reported an error.".into() } else { error_message(&err) } }));
                } else {
                    // -Q may skip streamed deltas; the final answer always arrives here.
                    let streamed = self.current.as_ref().and_then(|id| self.parts.get(id)).is_some_and(|t| !t.trim().is_empty());
                    if !streamed && !text.is_empty() {
                        let id = self.next_id("h");
                        out.push(self.set_text(&id, &text));
                    }
                }
                out.push(self.result());
                out
            }
            _ => vec![],
        }
    }
}

// ───────────────────────────── runner ─────────────────────────────

static RUNS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct EventPayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    event: Value,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    #[serde(rename = "chatId")]
    chat_id: String,
    code: Option<i32>,
    error: Option<String>,
}

fn exit_error(agent: Agent, code: Option<i32>, stderr: &str, saw_error: bool) -> Option<String> {
    let code = code.filter(|c| *c != 0)?;
    if saw_error {
        return None;
    }
    let tail: String = stderr.trim().lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    Some(if tail.is_empty() {
        format!("`{}` exited with code {code}", agent.program())
    } else {
        format!("`{}` exited with code {code}: {tail}", agent.program())
    })
}

#[tauri::command]
pub async fn agent_chat_send(
    app: AppHandle,
    agent: String,
    chat_id: String,
    prompt: String,
    cwd: String,
    session_id: Option<String>,
    options: Option<AgentOptions>,
) -> Result<(), String> {
    let agent = Agent::parse(&agent).ok_or_else(|| format!("unknown agent: {agent}"))?;
    let options = options.unwrap_or_default();
    if chat_id.is_empty() || chat_id.len() > 128 {
        return Err("Invalid chat id".into());
    }
    if !std::path::Path::new(&cwd).is_dir() {
        return Err(format!("Project folder not found: {cwd}"));
    }
    if prompt.trim().is_empty() {
        return Err("Message is empty".into());
    }
    let cancel = {
        let mut runs = RUNS.lock();
        if runs.contains_key(&chat_id) {
            return Err("This agent is still answering. Stop it first.".into());
        }
        let n = Arc::new(Notify::new());
        runs.insert(chat_id.clone(), n.clone());
        n
    };
    struct Release(String);
    impl Drop for Release {
        fn drop(&mut self) {
            RUNS.lock().remove(&self.0);
        }
    }
    let _release = Release(chat_id.clone());

    let mcp = if agent == Agent::Claude { crate::mcp_config::write(&app) } else { None };
    let (args, stdin_data) = agent_argv(agent, &prompt, &cwd, session_id.as_deref(), mcp.as_deref(), &options);
    let program = crate::agent_cli::program(agent.program());
    if !program.starts_with('/') {
        return Err(format!(
            "{} isn't installed. Install it with `{}`, then try again.",
            agent.program(),
            crate::agent_cli::install_hint(agent.program())
        ));
    }
    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .current_dir(&cwd)
        .env("PATH", crate::agent_cli::agent_path())
        .env("TERM_PROGRAM", "OrionTerminal")
        .env("NO_COLOR", "1")
        .stdin(if stdin_data.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if agent == Agent::Codex {
        crate::cli_auth::apply_profile(&mut cmd);
    }
    if agent == Agent::Hermes {
        if let Some((k, v)) = crate::agent_cli::hermes_env(&app) {
            cmd.env(k, v);
        }
    }
    let (mut child, mut group) = crate::process_group::spawn(&mut cmd)
        .map_err(|e| format!("Couldn't start `{}`. Is it installed and on PATH? ({e})", agent.program()))?;

    if let (Some(data), Some(mut stdin)) = (stdin_data, child.stdin.take()) {
        tokio::spawn(async move {
            let _ = stdin.write_all(data.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let stderr_task = tokio::spawn(async move {
        let mut captured = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if captured.len() < 8192 {
                captured.push_str(&line);
                captured.push('\n');
            }
        }
        captured
    });

    let mut norm = Norm::default();
    let mut saw_error = false;
    let mut lines = BufReader::new(stdout).lines();
    let outcome: Result<Option<i32>, String> = loop {
        tokio::select! {
            _ = cancel.notified() => {
                group.terminate();
                let _ = child.kill().await;
                let _ = child.wait().await;
                break Ok(None);
            }
            line = lines.next_line() => match line {
                Ok(Some(text)) => {
                    for event in norm.line(agent, &text) {
                        saw_error |= event.get("kind").and_then(Value::as_str) == Some("error");
                        let _ = app.emit("agent:event", EventPayload { chat_id: chat_id.clone(), event });
                    }
                }
                Ok(None) => {
                    let status = child.wait().await.map_err(|e| e.to_string());
                    group.disarm();
                    break status.map(|s| s.code());
                }
                Err(e) => {
                    group.terminate();
                    let _ = child.kill().await;
                    break Err(e.to_string());
                }
            }
        }
    };
    let stderr_text = stderr_task.await.unwrap_or_default();
    let (code, error) = match outcome {
        Ok(code) => (code, exit_error(agent, code, &stderr_text, saw_error)),
        Err(e) => (None, Some(e)),
    };
    let _ = app.emit("agent:exit", ExitPayload { chat_id, code, error: error.clone() });
    match error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn agent_chat_cancel(chat_id: String) -> Result<(), String> {
    if let Some(n) = RUNS.lock().get(&chat_id) {
        n.notify_one();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(agent: Agent, lines: &[&str]) -> Vec<Value> {
        let mut n = Norm::default();
        lines.iter().flat_map(|l| n.line(agent, l)).collect()
    }
    fn kinds(evs: &[Value]) -> Vec<&str> {
        evs.iter().map(|e| e["kind"].as_str().unwrap()).collect()
    }

    #[test]
    fn argv_matches_each_harness() {
        let none = AgentOptions::default();
        let (a, stdin) = agent_argv(Agent::Claude, "hi", "/p", Some("s1"), Some("/m.json"), &none);
        assert!(a.windows(2).any(|w| w == ["--resume", "s1"]));
        assert_eq!(&a[a.len() - 2..], ["--", "hi"]);
        assert!(stdin.is_none());
        let (a, stdin) = agent_argv(Agent::Codex, "hi", "/p", None, None, &none);
        assert!(a.windows(2).any(|w| w == ["-C", "/p"]));
        assert_eq!(a.last().unwrap(), "-");
        assert_eq!(stdin.as_deref(), Some("hi\n"));
        let (a, _) = agent_argv(Agent::Codex, "hi", "/p", Some("t1"), None, &none);
        assert_eq!(&a[..3], ["exec", "resume", "t1"]);
        assert!(!a.contains(&"-C".to_string()) && !a.contains(&"-s".to_string()));
        let (a, _) = agent_argv(Agent::Pi, "-rf", "/p", Some("p1"), None, &none);
        assert_eq!(&a[a.len() - 2..], ["--", "-rf"]);
        let (a, stdin) = agent_argv(Agent::Hermes, "hi", "/p", None, None, &none);
        assert!(a.windows(2).any(|w| w == ["--in", "/p"]));
        assert_eq!(stdin.as_deref(), Some("hi"));
    }

    #[test]
    fn options_map_to_each_cli_flag() {
        let o = |m: &str, e: &str, mode: Option<&str>| AgentOptions { model: Some(m.into()), effort: Some(e.into()), mode: mode.map(str::to_string) };
        let has = |a: &[String], k: &str, v: &str| a.windows(2).any(|w| w[0] == k && w[1] == v);
        let (a, _) = agent_argv(Agent::Claude, "hi", "/p", None, None, &o("claude-sonnet-5-5", "high", Some("plan")));
        assert!(has(&a, "--model", "claude-sonnet-5-5") && has(&a, "--effort", "high") && has(&a, "--permission-mode", "plan"));
        assert_eq!(&a[a.len() - 2..], ["--", "hi"]);
        let (a, _) = agent_argv(Agent::Codex, "hi", "/p", None, None, &o("gpt-6-luna", "low", Some("read-only")));
        assert!(has(&a, "-m", "gpt-6-luna") && has(&a, "-c", "model_reasoning_effort=\"low\"") && has(&a, "-s", "read-only"));
        let (a, _) = agent_argv(Agent::Codex, "hi", "/p", Some("t1"), None, &o("gpt-6-luna", "low", None));
        assert!(has(&a, "-c", "sandbox_mode=\"workspace-write\"") && has(&a, "-m", "gpt-6-luna"));
        assert_eq!(a.last().unwrap(), "-");
        let (a, _) = agent_argv(Agent::Pi, "hi", "/p", None, None, &o("anthropic/claude-opus-5-5", "high", None));
        assert!(has(&a, "--model", "anthropic/claude-opus-5-5") && has(&a, "--thinking", "high"));
        let (a, _) = agent_argv(Agent::Hermes, "hi", "/p", None, None, &o("claude-opus-5-5[1m]", "high", None));
        assert!(has(&a, "-m", "claude-opus-5-5[1m]") && has(&a, "--reasoning", "high"));
        let (a, _) = agent_argv(Agent::Claude, "hi", "/p", None, None, &o("--evil", "x y", Some("bypassPermissions")));
        assert!(!a.iter().any(|x| x == "--evil" || x == "x y" || x == "bypassPermissions"));
        assert!(has(&a, "--permission-mode", "acceptEdits"));
    }

    #[test]
    fn claude_streams_partials_and_tools_without_duplicating_text() {
        let evs = run(Agent::Claude, &[
            r#"{"type":"system","subtype":"init","session_id":"cs"}"#,
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hel"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"lo"}}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hello"}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"tu1","name":"Bash","input":{"command":"echo hi"}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"hi"}]}}"#,
            r#"{"type":"result","subtype":"success","session_id":"cs","is_error":false}"#,
        ]);
        assert_eq!(kinds(&evs), ["init", "text", "text", "tool", "tool_result", "result"]);
        assert_eq!(evs[2]["text"], "Hello");
        assert_eq!(evs[4]["output"], "hi");
        assert_eq!(evs[5]["sessionId"], "cs");
    }

    #[test]
    fn claude_without_partials_uses_the_full_message() {
        let evs = run(Agent::Claude, &[r#"{"type":"assistant","message":{"id":"m2","content":[{"type":"text","text":"Done"}]}}"#]);
        assert_eq!(evs[0]["text"], "Done");
    }

    #[test]
    fn codex_items_become_steps() {
        let evs = run(Agent::Codex, &[
            r#"{"type":"thread.started","thread_id":"t1"}"#,
            r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I'll run ls.\n"}}"#,
            r#"{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}"#,
            r#"{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"hello.txt\n","exit_code":0,"status":"completed"}}"#,
            r#"{"type":"item.completed","item":{"id":"item_2","type":"error","message":"Model metadata for `x` not found."}}"#,
            r#"{"type":"turn.completed","usage":{}}"#,
        ]);
        assert_eq!(kinds(&evs), ["init", "text", "tool", "tool_result", "notice", "result"]);
        assert_eq!(evs[1]["text"], "I'll run ls.");
        assert_eq!(evs[3]["output"], "hello.txt\n");
        assert_eq!(evs[5]["sessionId"], "t1");
    }

    #[test]
    fn pi_streams_text_and_tools_and_surfaces_api_errors() {
        let evs = run(Agent::Pi, &[
            r#"{"type":"session","id":"ps"}"#,
            r#"{"type":"message_start","message":{"role":"assistant"}}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Wri"}}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ting"}}"#,
            r#"{"type":"tool_execution_start","toolCallId":"c1","toolName":"write","args":{"path":"a.txt"}}"#,
            r#"{"type":"tool_execution_end","toolCallId":"c1","toolName":"write","result":{"content":[{"type":"text","text":"ok"}]},"isError":false}"#,
            r#"{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"400 {\"type\":\"error\",\"error\":{\"message\":\"You're out of extra usage.\"}}"}}"#,
            r#"{"type":"agent_end"}"#,
        ]);
        assert_eq!(kinds(&evs), ["init", "text", "text", "tool", "tool_result", "error", "result"]);
        assert_eq!(evs[2]["text"], "Writing");
        assert_eq!(evs[4]["output"], "ok");
        assert_eq!(evs[5]["text"], "You're out of extra usage.");
    }

    #[test]
    fn hermes_pairs_unnamed_tools_and_falls_back_to_result_text() {
        let evs = run(Agent::Hermes, &[
            r#"{"type": "system", "subtype": "init", "session_id": "hs"}"#,
            r#"{"type": "tool_use", "name": "terminal", "input": {"command": "ls"}}"#,
            r#"{"type": "tool_result", "name": "terminal", "output": "a.txt", "is_error": false}"#,
            r#"{"type": "result", "session_id": "hs", "exit_code": 0, "text": "Listed it."}"#,
        ]);
        assert_eq!(kinds(&evs), ["init", "tool", "tool_result", "text", "result"]);
        assert_eq!(evs[1]["id"], evs[2]["id"]);
        assert_eq!(evs[3]["text"], "Listed it.");
        let failed = run(Agent::Hermes, &[r#"{"type": "result", "exit_code": 1, "text": "Sign in again."}"#]);
        assert_eq!(kinds(&failed), ["error", "result"]);
    }

    #[test]
    fn hermes_streamed_text_is_not_repeated() {
        let evs = run(Agent::Hermes, &[
            r#"{"type": "text", "text": "Hi"}"#,
            r#"{"type": "result", "exit_code": 0, "text": "Hi"}"#,
        ]);
        assert_eq!(kinds(&evs), ["text", "result"]);
    }

    #[test]
    fn exit_errors_prefer_reported_errors_and_keep_the_stderr_tail() {
        assert_eq!(exit_error(Agent::Pi, Some(0), "x", false), None);
        assert_eq!(exit_error(Agent::Pi, Some(1), "boom", true), None);
        assert_eq!(exit_error(Agent::Pi, Some(2), "a\nboom", false).unwrap(), "`pi` exited with code 2: a\nboom");
    }
}
