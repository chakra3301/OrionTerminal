//! Command Center pi engine — drives `pi --mode json --print` as a subprocess
//! (mirrors `cli_engine`), transcoding its NDJSON into flat `cc:event`/`cc:exit`
//! events keyed by `runId`. Each profile runs with cwd = its vault, persona via
//! `--append-system-prompt`, model via `--model`, and a stable `--session-id`
//! for resume. Auth is inherited from `~/.pi/agent/auth.json`. Additive.

pub mod transcode;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::Notify;

static PI_CHILDREN: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct EventPayload {
    #[serde(rename = "runId")]
    run_id: String,
    event: serde_json::Value,
}
#[derive(Serialize, Clone)]
struct ExitPayload {
    #[serde(rename = "runId")]
    run_id: String,
    code: Option<i32>,
    error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PiStatus {
    pub installed: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub detail: String,
}

/// Pure arg builder for one headless pi run. Prompt is passed as the trailing
/// positional message. Order kept stable for unit testing.
///
/// `--approve` trusts the profile's own workspace so its project-local skills
/// (`.pi/skills`, `.agents/skills`) + AGENTS.md persona load — without it pi
/// silently drops project-local skills (verified: 5 skills vs 23 with approve).
pub fn pi_args(model: &str, session_id: &str, system_append: &str, prompt: &str) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "--mode".into(),
        "json".into(),
        "--print".into(),
        "--approve".into(),
    ];
    if !model.is_empty() {
        a.push("--model".into());
        a.push(model.into());
    }
    if !session_id.is_empty() {
        a.push("--session-id".into());
        a.push(session_id.into());
    }
    if !system_append.is_empty() {
        a.push("--append-system-prompt".into());
        a.push(system_append.into());
    }
    a.push(prompt.into());
    a
}

fn pi_detail(installed: bool, logged_in: bool) -> String {
    match (installed, logged_in) {
        (false, _) => "pi CLI not found on PATH. Install pi to run profiles.".into(),
        (true, false) => "pi installed. Run `pi` once and sign in (auth.json missing).".into(),
        (true, true) => "Ready.".into(),
    }
}

async fn probe_version(bin: &str) -> Option<String> {
    let out = TokioCommand::new(bin)
        .arg("--version")
        .env("PATH", crate::claude_cli::augmented_path())
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn pi_status() -> PiStatus {
    let version = probe_version("pi").await;
    let installed = version.is_some();
    let logged_in = installed
        && std::env::var("HOME")
            .ok()
            .map(|h| {
                std::path::Path::new(&h)
                    .join(".pi")
                    .join("agent")
                    .join("auth.json")
                    .exists()
            })
            .unwrap_or(false);
    let detail = pi_detail(installed, logged_in);
    PiStatus { installed, logged_in, version, detail }
}

/// Resolve a profile's vault path (stored relative) to an absolute dir under
/// app-data, creating it so the run has a real cwd / vault.
fn resolve_vault(app: &AppHandle, wiki_root: &str) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let rel = if wiki_root.trim().is_empty() {
        "command-center"
    } else {
        wiki_root
    };
    let dir = base.join(rel);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create vault dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pi_send(
    app: AppHandle,
    run_id: String,
    prompt: String,
    model: String,
    session_id: String,
    system_append: String,
    wiki_root: String,
) -> Result<(), String> {
    let cwd = resolve_vault(&app, &wiki_root)?;
    let args = pi_args(&model, &session_id, &system_append, &prompt);

    let mut cmd = TokioCommand::new("pi");
    cmd.args(&args);
    cmd.current_dir(&cwd);
    cmd.env("PATH", crate::claude_cli::augmented_path());
    // Route this profile's llm-wiki to its OWN vault (<workspace>/.llm-wiki),
    // not the global ~/.llm-wiki — each division grows a separate brain.
    cmd.env("WIKI_HOME", &cwd);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn `pi` — is it installed and on PATH? ({e})"))?;

    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let cancel = Arc::new(Notify::new());
    PI_CHILDREN.lock().insert(run_id.clone(), cancel.clone());

    let app_loop = app.clone();
    let run_loop = run_id.clone();
    let mut lines = BufReader::new(stdout).lines();
    let mut state = transcode::PiState::default();

    let result: Result<Option<i32>, String> = async {
        loop {
            tokio::select! {
                _ = cancel.notified() => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Ok(None);
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            for ev in transcode::pi_line_to_events(&text, &mut state) {
                                let _ = app_loop.emit("cc:event", EventPayload {
                                    run_id: run_loop.clone(), event: ev });
                            }
                        }
                        Ok(None) => {
                            let status = child.wait().await.map_err(|e| e.to_string())?;
                            return Ok(status.code());
                        }
                        Err(e) => { let _ = child.kill().await; return Err(e.to_string()); }
                    }
                }
            }
        }
    }
    .await;

    PI_CHILDREN.lock().remove(&run_id);
    match result {
        Ok(code) => {
            let _ = app.emit("cc:exit", ExitPayload { run_id, code, error: None });
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "cc:exit",
                ExitPayload { run_id, code: None, error: Some(e.clone()) },
            );
            Err(e)
        }
    }
}

#[derive(Serialize, Clone)]
pub struct PiOneshot {
    pub result: String,
    pub cost: f64,
}

/// Run a profile to completion and return its final text + cost. Used by the
/// delegation protocol (General planning / briefing, Captain directive runs)
/// where the structured result matters more than live streaming.
#[tauri::command]
pub async fn pi_oneshot(
    app: AppHandle,
    prompt: String,
    model: String,
    system_append: String,
    wiki_root: String,
) -> Result<PiOneshot, String> {
    let cwd = resolve_vault(&app, &wiki_root)?;
    // No --session-id: one-shots are stateless w.r.t. the profile's chat session.
    let args = pi_args(&model, "", &system_append, &prompt);

    let mut cmd = TokioCommand::new("pi");
    cmd.args(&args);
    cmd.current_dir(&cwd);
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env("WIKI_HOME", &cwd);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn `pi` ({e})"))?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let mut state = transcode::PiState::default();
    while let Ok(Some(text)) = lines.next_line().await {
        let _ = transcode::pi_line_to_events(&text, &mut state);
    }
    let _ = child.wait().await;
    Ok(PiOneshot { result: state.text, cost: state.cost })
}

/// Resolve a profile's (relative) wiki_root to its absolute workspace dir so
/// the UI can open/reveal it. Creates it if missing (idempotent).
#[tauri::command]
pub fn cc_workspace_path(app: AppHandle, wiki_root: String) -> Result<String, String> {
    resolve_vault(&app, &wiki_root)
}

/// Open a file/dir from the chat. `reveal` => show it in Finder; otherwise open
/// it in the default app. Uses macOS `open` directly so it needs no opener-
/// plugin scope/permission (avoids the asset/opener capability friction).
#[tauri::command]
pub fn cc_open_path(path: String, reveal: bool) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    if reveal {
        cmd.arg("-R");
    }
    cmd.arg(&path);
    cmd.spawn().map(|_| ()).map_err(|e| format!("open failed: {e}"))
}

/// Read a local image as a base64 data URL so the chat can render an inline
/// thumbnail without depending on the asset:// protocol scope (which skips
/// hidden dirs like `.previews`). Size-guarded.
#[tauri::command]
pub fn cc_read_image(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 6_000_000 {
        return Err("image too large".into());
    }
    let lower = path.to_ascii_lowercase();
    let mime = if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        return Err("unsupported image type".into());
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[derive(Serialize, Clone)]
pub struct CcPage {
    pub title: String,
    pub path: String,
    pub kind: String,
    pub mtime: f64,
}

/// First markdown H1 (`# ...`) as the page title, else the fallback (filename).
fn page_title(content: &str, fallback: &str) -> String {
    for line in content.lines().take(40) {
        let t = line.trim();
        if let Some(h) = t.strip_prefix("# ") {
            let h = h.trim();
            if !h.is_empty() {
                return h.to_string();
            }
        }
    }
    fallback.to_string()
}

/// List a profile's most-recent wiki pages from its own vault
/// (`<workspace>/.llm-wiki/wiki/<kind>/*.md`) so the UI can show the division's
/// growing brain. Recency-sorted, bounded.
#[tauri::command]
pub fn cc_vault_pages(app: AppHandle, wiki_root: String, limit: usize) -> Vec<CcPage> {
    let root = match resolve_vault(&app, &wiki_root) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return vec![],
    };
    let wiki = root.join(".llm-wiki").join("wiki");
    let mut pages: Vec<CcPage> = vec![];
    let mut stack: Vec<(std::path::PathBuf, u32)> = vec![(wiki, 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 3 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push((path, depth + 1));
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let fname = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("page")
                    .to_string();
                let kind = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                pages.push(CcPage {
                    title: page_title(&content, &fname),
                    path: path.to_string_lossy().to_string(),
                    kind,
                    mtime: mtime_ms(&meta) as f64,
                });
            }
        }
    }
    pages.sort_by(|a, b| b.mtime.partial_cmp(&a.mtime).unwrap_or(std::cmp::Ordering::Equal));
    pages.truncate(limit.min(50));
    pages
}

/// Extract `[[wikilink]]` targets from page content (strips `|alias` + `#sec`).
fn extract_links(content: &str) -> Vec<String> {
    let bytes = content.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(end) = content[i + 2..].find("]]") {
                let inner = &content[i + 2..i + 2 + end];
                let target = inner
                    .split('|')
                    .next()
                    .unwrap_or("")
                    .split('#')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !target.is_empty() {
                    out.push(target.to_string());
                }
                i += 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Normalize a title/link for fuzzy matching: lowercase, keep alphanumerics +
/// spaces, collapse whitespace.
fn norm_key(s: &str) -> String {
    let mut out = String::new();
    let mut prev_space = false;
    for c in s.to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
            prev_space = false;
        } else if c.is_whitespace() || c == '-' || c == '_' {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
        }
    }
    out.trim().to_string()
}

#[derive(Serialize, Clone)]
pub struct CcGraphNode {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub path: String,
}
#[derive(Serialize, Clone)]
pub struct CcGraphEdge {
    pub from: String,
    pub to: String,
}
#[derive(Serialize, Clone)]
pub struct CcGraph {
    pub nodes: Vec<CcGraphNode>,
    pub edges: Vec<CcGraphEdge>,
}

/// Build the wikilink graph for a profile's vault: nodes = pages, edges =
/// resolved `[[links]]` (matched by normalized title or filename slug).
#[tauri::command]
pub fn cc_vault_graph(app: AppHandle, wiki_root: String) -> CcGraph {
    let root = match resolve_vault(&app, &wiki_root) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return CcGraph { nodes: vec![], edges: vec![] },
    };
    let wiki = root.join(".llm-wiki").join("wiki");
    let mut nodes: Vec<CcGraphNode> = vec![];
    let mut contents: Vec<(String, String)> = vec![]; // (id, content)
    let mut stack: Vec<(std::path::PathBuf, u32)> = vec![(wiki, 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 3 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push((path, depth + 1));
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let kind = path.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()).unwrap_or("").to_string();
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                nodes.push(CcGraphNode {
                    id: id.clone(),
                    title: page_title(&content, &id),
                    kind,
                    path: path.to_string_lossy().to_string(),
                });
                contents.push((id, content));
            }
        }
    }
    // Resolve links by normalized title or slug.
    let mut by_key: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for n in &nodes {
        by_key.entry(norm_key(&n.title)).or_insert_with(|| n.id.clone());
        by_key.entry(norm_key(&n.id)).or_insert_with(|| n.id.clone());
    }
    let mut edges: Vec<CcGraphEdge> = vec![];
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for (id, content) in &contents {
        for link in extract_links(content) {
            if let Some(to) = by_key.get(&norm_key(&link)) {
                if to != id && seen.insert((id.clone(), to.clone())) {
                    edges.push(CcGraphEdge { from: id.clone(), to: to.clone() });
                }
            }
        }
    }
    CcGraph { nodes, edges }
}

fn mtime_ms(meta: &std::fs::Metadata) -> u128 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn is_artifact_ext(name: &str) -> Option<bool> {
    // Some(true) = image (renderable thumbnail); Some(false) = other openable.
    let lower = name.to_ascii_lowercase();
    const IMG: [&str; 6] = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    const OTH: [&str; 4] = [".html", ".htm", ".pdf", ".mp4"];
    if IMG.iter().any(|e| lower.ends_with(e)) {
        Some(true)
    } else if OTH.iter().any(|e| lower.ends_with(e)) {
        Some(false)
    } else {
        None
    }
}

/// Scan a profile's workspace for openable artifacts (images, html, pdf)
/// created/modified at/after `since_ms` — i.e. what a run just produced — so the
/// UI can surface them without depending on the agent printing absolute paths.
/// Images first, then by recency; bounded + skips heavy dirs.
#[tauri::command]
pub fn cc_recent_artifacts(
    app: AppHandle,
    wiki_root: String,
    since_ms: f64,
    limit: usize,
) -> Vec<String> {
    let root = match resolve_vault(&app, &wiki_root) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return vec![],
    };
    let cutoff = (since_ms as u128).saturating_sub(2000);
    let skip = ["node_modules", ".git", ".cache", ".vite", "dist"];
    let mut found: Vec<(u128, bool, String)> = vec![];
    let mut stack: Vec<(std::path::PathBuf, u32)> = vec![(root, 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 6 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if !skip.contains(&name.as_str()) && !name.starts_with(".") || name == ".previews" {
                    stack.push((path, depth + 1));
                }
            } else if let Some(is_img) = is_artifact_ext(&name) {
                let m = mtime_ms(&meta);
                if m >= cutoff {
                    found.push((m, is_img, path.to_string_lossy().to_string()));
                }
            }
        }
    }
    // Images first, then most-recent first.
    found.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));
    found.into_iter().take(limit.min(20)).map(|(_, _, p)| p).collect()
}

#[tauri::command]
pub fn pi_cancel(run_id: String) -> Result<(), String> {
    if let Some(n) = PI_CHILDREN.lock().remove(&run_id) {
        n.notify_waiters();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_minimal_has_mode_print_approve_and_prompt() {
        let a = pi_args("", "", "", "hello");
        assert_eq!(a, vec!["--mode", "json", "--print", "--approve", "hello"]);
    }

    #[test]
    fn args_full_orders_flags_then_prompt() {
        let a = pi_args("anthropic/claude-haiku-4-5", "cc_p1", "You are Dev.", "do it");
        assert_eq!(
            a,
            vec![
                "--mode",
                "json",
                "--print",
                "--approve",
                "--model",
                "anthropic/claude-haiku-4-5",
                "--session-id",
                "cc_p1",
                "--append-system-prompt",
                "You are Dev.",
                "do it",
            ]
        );
    }

    #[test]
    fn extract_links_and_norm_key() {
        let links = extract_links("see [[Page One]] and [[Other|alias]] and [[Third#sec]]");
        assert_eq!(links, vec!["Page One", "Other", "Third"]);
        assert_eq!(norm_key("  Hello-World_Foo "), "hello world foo");
        assert_eq!(norm_key("⭐ Observation: X"), "observation x");
    }

    #[test]
    fn page_title_prefers_h1_else_fallback() {
        assert_eq!(page_title("# Hello World\nbody", "fname"), "Hello World");
        assert_eq!(page_title("no heading here", "fname"), "fname");
        assert_eq!(page_title("## sub only", "fname"), "fname");
        assert_eq!(
            page_title("---\nfrontmatter\n---\n# Real Title", "fname"),
            "Real Title"
        );
    }

    #[test]
    fn detail_copy() {
        assert!(pi_detail(false, false).contains("not found"));
        assert!(pi_detail(true, false).contains("sign in"));
        assert_eq!(pi_detail(true, true), "Ready.");
    }
}
