//! Website-rip engine: one long-running `claude` clone agent per rip.
//! Modeled on `hermes.rs` (single-agent variant). Drives a headless Playwright
//! MCP browser, follows the vendored clone-website SKILL.md, streams progress
//! via the `repolens:website` event, and promotes the first recon screenshot
//! to the rip's thumbnail.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::claude_cli::{augmented_path, OPUS_MODEL};

const MAX_TURNS: &str = "50";
const IMAGE_EXTS: [&str; 4] = ["png", "webp", "jpg", "jpeg"];

const DESIGN_PROMPT: &str = "You are a senior design systems analyst. Reverse-engineer the design system of this website from the attached original-site screenshots and the extracted CSS/DOM artifacts below.\n\n\
Return ONLY one fenced ```json code block, with no prose before or after, matching this TypeScript type exactly:\n\n\
type DesignSpec = {\n\
  title: string;            // site/design name\n\
  aesthetic: string;        // one-line vibe\n\
  designLanguage: string;   // 1 paragraph: mood, references, overall feel\n\
  colors: { name: string; role: string; hex: string; ramp?: string[] }[];\n\
  typography: { role: string; family: string; fallback?: string; sizePx?: number; weight?: number; sample?: string; usage?: string }[];\n\
  spacing: { scale: number[]; notes?: string };\n\
  components: { name: string; description: string; preview?: { kind: \"button\"|\"input\"|\"badge\"|\"card\"|\"other\"; fillHex?: string; textHex?: string; radiusPx?: number } }[];\n\
  motion: string; responsive: string; imagery: string; voice: string; rebuildNotes: string;\n\
};\n\n\
Colors: extract the real palette as hex from the CSS/screenshots; group into named roles; include ramps where the site uses shades. Typography: identify each font family actually used and its roles/sizes/weights. Components: inventory the distinctive UI components with their styling, and fill `preview` with real hex/radius hints where you can. Be specific and exact — no placeholders.\n\
If a field is unknown, use a short honest string or an empty array — never invent.\n";

/// Live rip subprocesses keyed by rip id, for cancellation.
static RIPS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
struct WebsiteEvent {
    id: String,
    status: String,
    phase: String,
    #[serde(rename = "logDelta", skip_serializing_if = "Option::is_none")]
    log_delta: Option<String>,
    #[serde(rename = "thumbnailPath", skip_serializing_if = "Option::is_none")]
    thumbnail_path: Option<String>,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("orion.db"))
}

/// Fresh short-lived connection with a busy timeout so concurrent writers
/// (the frontend sqlx pool, the thumbnail watcher) don't trip
/// "database is locked". Never held across an `.await`.
fn open_conn(app: &AppHandle) -> Result<Connection, String> {
    let c = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    let _ = c.busy_timeout(Duration::from_secs(5));
    Ok(c)
}

fn parse_node_major(version_output: &str) -> Option<u32> {
    let v = version_output.trim().trim_start_matches('v');
    v.split('.').next()?.parse::<u32>().ok()
}

fn is_image(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// From `(filename, mtime_millis)` pairs, pick the earliest-saved image whose
/// name is NOT in `initial` (the scaffold-shipped images, e.g. the placeholder
/// `comparison.png`). The first screenshot the agent saves is the recon shot of
/// the target site, so earliest-mtime is the right thumbnail. Ties break by name
/// for determinism.
fn earliest_new_image(entries: &[(String, u128)], initial: &HashSet<String>) -> Option<String> {
    entries
        .iter()
        .filter(|(name, _)| is_image(name) && !initial.contains(name))
        .min_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)))
        .map(|(name, _)| name.clone())
}

/// Pick up to `cap` recon screenshots to attach for design analysis. Prefer
/// names containing `desktop`, then `mobile`, then any other image — always
/// excluding scaffold/generated shots (`clone-*`, `comparison`). Operates on
/// bare file names; deterministic ordering.
fn pick_design_screenshots(file_names: &[String], cap: usize) -> Vec<String> {
    let eligible = |n: &str| {
        let lower = n.to_lowercase();
        is_image(n) && !lower.starts_with("clone-") && !lower.contains("comparison")
    };
    let mut desktop: Vec<String> = file_names
        .iter()
        .filter(|n| eligible(n) && n.to_lowercase().contains("desktop"))
        .cloned()
        .collect();
    let mut mobile: Vec<String> = file_names
        .iter()
        .filter(|n| eligible(n) && n.to_lowercase().contains("mobile"))
        .cloned()
        .collect();
    let mut other: Vec<String> = file_names
        .iter()
        .filter(|n| {
            eligible(n)
                && !n.to_lowercase().contains("desktop")
                && !n.to_lowercase().contains("mobile")
        })
        .cloned()
        .collect();
    desktop.sort();
    mobile.sort();
    other.sort();
    let mut out = Vec::new();
    for group in [desktop, mobile, other] {
        for name in group {
            if out.len() >= cap {
                return out;
            }
            if !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out
}

/// Read a file fail-soft, capped to `cap` chars (char-boundary safe). Returns a
/// labeled block, or empty string if the file is missing/unreadable/empty.
fn read_capped(path: &Path, label: &str, cap: usize) -> String {
    match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => {
            let body: String = s.chars().take(cap).collect();
            format!("\n\n===== {label} =====\n{body}")
        }
        _ => String::new(),
    }
}

fn ulid_like() -> String {
    // Time-ordered, collision-resistant enough for local rip ids.
    let t = now_ms();
    let r: u64 = {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        RandomState::new().build_hasher().finish()
    };
    format!("rip_{:x}{:x}", t, r)
}

fn websites_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("repolens")
        .join("websites");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn scaffold_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Bundled resource in release; resolves from the project in dev.
    if let Ok(p) = app
        .path()
        .resolve("website-cloner-scaffold", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Ok(p);
        }
    }
    // Dev fallback: repo-relative resources dir.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|r| r.join("resources").join("website-cloner-scaffold"))
        .ok_or("scaffold not found")?;
    if dev.exists() {
        Ok(dev)
    } else {
        Err("website-cloner-scaffold resource missing".into())
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Dedicated rip MCP config: headless Playwright only. Returns the file path.
fn write_rip_mcp(project: &Path) -> Result<String, String> {
    let cfg = serde_json::json!({
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]
            }
        }
    });
    let path = project.join(".rip-mcp.json");
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn clone_prompt(url: &str) -> String {
    format!(
        "You are cloning a website into THIS Next.js project (your current working directory).\n\n\
Target URL: {url}\n\n\
Follow the clone-website skill verbatim. Read the full instructions at \
`.claude/skills/clone-website/SKILL.md` in this project and execute every phase \
(recon, foundation, component specs, parallel builders in git worktrees, assembly, visual QA).\n\n\
Browser automation: a headless Playwright MCP server is attached (tools prefixed \
`mcp__playwright__`). Use it for all navigation, screenshots, and DOM/CSS extraction.\n\n\
IMPORTANT for progress reporting:\n\
- Very early in recon, save a full-page desktop screenshot (1440px) into \
`docs/design-references/` (e.g. `home-desktop.png`). This is used as the rip's preview thumbnail, so do it before deep extraction.\n\
- This project is already a git repository with an initial commit; create worktrees off the current branch for parallel builders and merge them back.\n\
- Verify `npm run build` passes before you finish.\n",
        url = url
    )
}

fn preflight() -> Result<(), String> {
    let out = std::process::Command::new("node")
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .map_err(|_| {
            "Node.js not found on PATH. Install Node 24+ to use the website ripper.".to_string()
        })?;
    let ver = String::from_utf8_lossy(&out.stdout);
    match parse_node_major(&ver) {
        Some(n) if n >= 24 => Ok(()),
        Some(n) => Err(format!(
            "Node {n} found, but the cloner scaffold needs Node 24+. Upgrade Node (e.g. `nvm install 24`)."
        )),
        None => Err("Could not determine the Node.js version.".into()),
    }
}

#[tauri::command]
pub async fn repolens_website_rip(
    app: AppHandle,
    url: String,
    model: Option<String>,
) -> Result<String, String> {
    let parsed = url.trim().to_string();
    let host = parsed
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or("site")
        .trim_start_matches("www.")
        .to_string();
    let id = ulid_like();
    let root = websites_root(&app)?;
    let dir = root.join(&id);
    let project = dir.join("project");
    let model = model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| OPUS_MODEL.to_string());

    // Insert the row up front so the card appears immediately.
    {
        let conn = open_conn(&app)?;
        conn.execute(
            "INSERT INTO repolens_websites (id, url, hostname, title, status, phase, project_path, thumbnail_path, log, session_id, error, model, created_at, updated_at) \
             VALUES (?1, ?2, ?3, '', 'running', 'recon', ?4, NULL, '', NULL, NULL, ?5, ?6, ?6)",
            params![id, parsed, host, project.to_string_lossy(), model, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    }
    emit(&app, &id, "running", "recon", None, None, None);

    // Heavy setup + run happens on a background task so the command returns fast.
    let app2 = app.clone();
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = setup_and_run(app2.clone(), id2.clone(), parsed, project, model).await {
            fail(&app2, &id2, &e);
        }
    });
    Ok(id)
}

async fn setup_and_run(
    app: AppHandle,
    id: String,
    url: String,
    project: PathBuf,
    model: String,
) -> Result<(), String> {
    preflight()?;

    // 1. Copy scaffold.
    set_phase(&app, &id, "running", "recon");
    let scaffold = scaffold_dir(&app)?;
    {
        let project = project.clone();
        tauri::async_runtime::spawn_blocking(move || copy_dir_all(&scaffold, &project))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("copy scaffold: {e}"))?;
    }

    // 2. npm install + git init + playwright browser (blocking, augmented PATH).
    {
        let project = project.clone();
        tauri::async_runtime::spawn_blocking(move || run_setup_commands(&project))
            .await
            .map_err(|e| e.to_string())??;
    }

    // 3. Spawn the clone agent and stream.
    let mcp = write_rip_mcp(&project)?;
    run_agent(app, id, url, project, model, mcp, None).await
}

fn run_setup_commands(project: &Path) -> Result<(), String> {
    let path = augmented_path();
    let sh = |args: &[&str], cwd: &Path| -> Result<(), String> {
        let out = std::process::Command::new(args[0])
            .args(&args[1..])
            .current_dir(cwd)
            .env("PATH", &path)
            .output()
            .map_err(|e| format!("{}: {e}", args[0]))?;
        if !out.status.success() {
            return Err(format!(
                "{} failed: {}",
                args[0],
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(())
    };
    sh(&["npm", "install"], project)?;
    sh(&["git", "init"], project)?;
    sh(&["git", "add", "-A"], project)?;
    sh(
        &[
            "git",
            "-c",
            "user.email=ripper@orion.local",
            "-c",
            "user.name=Orion Ripper",
            "commit",
            "-m",
            "scaffold",
            "--quiet",
        ],
        project,
    )?;
    // Best-effort browser download (idempotent/cached); don't fail the rip if it errors.
    let _ = sh(&["npx", "-y", "playwright", "install", "chromium"], project);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tool-feed composition — adapted from hermes.rs into single-line deltas.
// ---------------------------------------------------------------------------

/// Strip an MCP namespace prefix so `mcp__playwright__navigate` reads as
/// `navigate`; leaves bare tool names (Bash, Read…) untouched.
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
                let id = block
                    .get("id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
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

/// Render the new feed line(s) for a single stream-json event, mirroring
/// hermes.rs's `▸ <tool>  <brief>` / `✗ <tool> failed` / prose-tail format.
/// `seen_tools` dedups repeated tool_use blocks; `tool_names` maps tool ids to
/// names so a later error result can be labeled. Returns `None` when the event
/// produced nothing worth logging.
fn hermes_style_feed_line(
    v: &Value,
    seen_tools: &mut HashSet<String>,
    tool_names: &mut HashMap<String, String>,
) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "assistant" => {
            for (id, name, brief) in collect_tool_uses(v) {
                let key = if id.is_empty() {
                    format!("{}:{}", name, brief)
                } else {
                    id.clone()
                };
                if seen_tools.insert(key) {
                    if !id.is_empty() {
                        tool_names.insert(id, name.clone());
                    }
                    lines.push(if brief.is_empty() {
                        format!("▸ {}", name)
                    } else {
                        format!("▸ {}  {}", name, brief)
                    });
                }
            }
            if let Some(t) = extract_assistant_text(v) {
                let t = t.trim();
                if !t.is_empty() {
                    lines.push(t.to_string());
                }
            }
        }
        "user" => {
            for (id, snippet) in collect_tool_errors(v) {
                let name = tool_names
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "tool".to_string());
                lines.push(if snippet.is_empty() {
                    format!("✗ {} failed", name)
                } else {
                    format!("✗ {} failed — {}", name, snippet)
                });
            }
        }
        _ => {}
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

/// Coarse phase guess from the latest log text.
fn infer_phase(log: &str) -> String {
    let l = log.to_lowercase();
    if l.contains("worktree") || l.contains("builder") {
        "building".to_string()
    } else if l.contains("globals.css") || l.contains("foundation") {
        "foundation".to_string()
    } else if l.contains("visual qa") || l.contains("comparison") || l.contains(" qa") {
        "qa".to_string()
    } else {
        "running".to_string()
    }
}

async fn run_agent(
    app: AppHandle,
    id: String,
    url: String,
    project: PathBuf,
    model: String,
    mcp: String,
    resume: Option<String>,
) -> Result<(), String> {
    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        &model,
        "--mcp-config",
        &mcp,
        "--strict-mcp-config",
        "--max-turns",
        MAX_TURNS,
    ]);
    if let Some(sid) = resume.filter(|s| !s.is_empty()) {
        cmd.args(["--resume", &sid]);
    }
    // `--mcp-config` is variadic; the `--` sentinel stops it eating the prompt.
    cmd.arg("--").arg(clone_prompt(&url));
    cmd.current_dir(&project);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    let cancel = Arc::new(Notify::new());
    RIPS.lock().insert(id.clone(), cancel.clone());

    // Thumbnail watcher: poll docs/design-references for the first image.
    spawn_thumbnail_watcher(app.clone(), id.clone(), project.clone());

    let mut log = String::new();
    let mut session: Option<String> = None;
    let mut paused = false;
    let mut seen_tools: HashSet<String> = HashSet::new();
    let mut tool_names: HashMap<String, String> = HashMap::new();
    let mut run_error: Option<String> = None;

    // Ok(())=normal stream end, Err(())=cancelled.
    let result: Result<(), ()> = loop {
        tokio::select! {
            _ = cancel.notified() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                break Err(());
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let v: Value = match serde_json::from_str(&l) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                            if session.as_deref() != Some(sid) {
                                session = Some(sid.to_string());
                            }
                        }
                        if let Some(delta) = hermes_style_feed_line(&v, &mut seen_tools, &mut tool_names) {
                            log.push_str(&delta);
                            log.push('\n');
                            persist_log(&app, &id, &log);
                            emit(&app, &id, "running", &infer_phase(&log), Some(delta), None, session.clone());
                        }
                        if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                            let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
                            let is_err = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
                            // Hitting the turn budget is a resumable PAUSE.
                            if subtype == "error_max_turns" {
                                paused = true;
                                break Ok(());
                            }
                            if is_err || (subtype != "success" && !subtype.is_empty()) {
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
                                    .unwrap_or_else(|| format!("agent error ({})", subtype));
                                run_error = Some(msg);
                            }
                            break Ok(());
                        }
                    }
                    Ok(None) => break Ok(()),
                    Err(_) => break Err(()),
                }
            }
        }
    };
    RIPS.lock().remove(&id);

    let _ = child.wait().await;

    // A run-level error result trumps a normal stream end.
    if let Some(msg) = run_error {
        return Err(msg);
    }
    match result {
        Err(_) => {
            mark(&app, &id, "cancelled", None, session);
            Ok(())
        }
        Ok(()) if paused => {
            mark(&app, &id, "paused", None, session);
            Ok(())
        }
        Ok(()) => {
            mark(&app, &id, "done", None, session);
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// emit / persist / thumbnail helpers
// ---------------------------------------------------------------------------

fn emit(
    app: &AppHandle,
    id: &str,
    status: &str,
    phase: &str,
    log_delta: Option<String>,
    thumb: Option<String>,
    session: Option<String>,
) {
    let _ = app.emit(
        "repolens:website",
        WebsiteEvent {
            id: id.to_string(),
            status: status.to_string(),
            phase: phase.to_string(),
            log_delta,
            thumbnail_path: thumb,
            session_id: session,
        },
    );
}

fn persist_log(app: &AppHandle, id: &str, log: &str) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET log = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, log, now_ms()],
        );
    }
}

fn set_phase(app: &AppHandle, id: &str, status: &str, phase: &str) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET status = ?2, phase = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, status, phase, now_ms()],
        );
    }
    emit(app, id, status, phase, None, None, None);
}

fn mark(app: &AppHandle, id: &str, status: &str, error: Option<&str>, session: Option<String>) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET status = ?2, error = ?3, session_id = COALESCE(?4, session_id), updated_at = ?5 WHERE id = ?1",
            params![id, status, error, session, now_ms()],
        );
    }
    emit(app, id, status, "", None, None, session);
}

fn fail(app: &AppHandle, id: &str, msg: &str) {
    mark(app, id, "error", Some(msg), None);
}

fn spawn_thumbnail_watcher(app: AppHandle, id: String, project: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let refs = project.join("docs").join("design-references");
        // The scaffold ships placeholder images here (e.g. `comparison.png`);
        // snapshot them up front so we only ever pick a screenshot the agent
        // actually saved for this site.
        let initial: HashSet<String> = std::fs::read_dir(&refs)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .filter(|n| is_image(n))
                    .collect()
            })
            .unwrap_or_default();
        for _ in 0..900 {
            // up to ~30 min at 2s
            if RIPS.lock().get(&id).is_none() {
                return; // rip ended
            }
            if let Ok(rd) = std::fs::read_dir(&refs) {
                let entries: Vec<(String, u128)> = rd
                    .filter_map(|e| e.ok())
                    .map(|e| {
                        let name = e.file_name().to_string_lossy().into_owned();
                        let mtime = e
                            .metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis())
                            .unwrap_or(0);
                        (name, mtime)
                    })
                    .collect();
                if let Some(img) = earliest_new_image(&entries, &initial) {
                    let full = refs.join(&img).to_string_lossy().into_owned();
                    if let Ok(conn) = open_conn(&app) {
                        let _ = conn.execute(
                            "UPDATE repolens_websites SET thumbnail_path = ?2, updated_at = ?3 WHERE id = ?1 AND thumbnail_path IS NULL",
                            params![id, full, now_ms()],
                        );
                    }
                    emit(&app, &id, "running", "", None, Some(full), None);
                    return;
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// cancel / continue / delete / boot reconcile
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn repolens_website_cancel(id: String) -> Result<(), String> {
    if let Some(n) = RIPS.lock().remove(&id) {
        n.notify_waiters();
    }
    Ok(())
}

#[tauri::command]
pub async fn repolens_website_continue(app: AppHandle, id: String) -> Result<(), String> {
    let (url, project, model, session) = {
        let conn = open_conn(&app)?;
        conn.query_row(
            "SELECT url, project_path, model, session_id FROM repolens_websites WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };
    set_phase(&app, &id, "running", "building");
    let project = PathBuf::from(project);
    let mcp = write_rip_mcp(&project)?;
    let app2 = app.clone();
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_agent(app2.clone(), id2.clone(), url, project, model, mcp, session).await
        {
            fail(&app2, &id2, &e);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn repolens_website_extract_design(
    app: AppHandle,
    id: String,
    model: Option<String>,
) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;

    // 1. Resolve project_path.
    let project = {
        let conn = open_conn(&app)?;
        let p: String = conn
            .query_row(
                "SELECT project_path FROM repolens_websites WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        PathBuf::from(p)
    };
    let model = model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| OPUS_MODEL.to_string());

    // 2. Gather artifacts (fail-soft, size-capped per file; ~80k total budget).
    let docs = project.join("docs");
    let research = docs.join("research");
    let mut artifacts = String::new();
    artifacts.push_str(&read_capped(&research.join("style.css"), "ORIGINAL SITE CSS (style.css)", 24_000));
    artifacts.push_str(&read_capped(&research.join("dom-structure.json"), "DOM STRUCTURE", 12_000));
    artifacts.push_str(&read_capped(&research.join("global-ui-structure.json"), "GLOBAL UI STRUCTURE", 12_000));
    artifacts.push_str(&read_capped(&project.join("src").join("app").join("globals.css"), "GENERATED TOKENS (globals.css)", 12_000));
    artifacts.push_str(&read_capped(&research.join("BEHAVIORS.md"), "BEHAVIORS", 8_000));
    artifacts.push_str(&read_capped(&research.join("PAGE_TOPOLOGY.md"), "PAGE TOPOLOGY", 4_000));
    artifacts.push_str(&read_capped(&research.join("source.html"), "SOURCE HTML (head excerpt)", 6_000));

    // 3. Pick up to 2 recon screenshots.
    let refs_dir = docs.join("design-references");
    let names: Vec<String> = std::fs::read_dir(&refs_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let shots = pick_design_screenshots(&names, 2);

    // 4. Build the prompt; append @<abs path> per screenshot (CLI reads inline).
    let mut prompt = format!("{DESIGN_PROMPT}{artifacts}");
    for shot in &shots {
        let abs = refs_dir.join(shot);
        prompt.push_str(&format!("\n\n@{}", abs.to_string_lossy()));
    }

    // 5. Call claude (json envelope, subscription auth) — mirrors repolens.rs.
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--strict-mcp-config", "--model", &model]);
    cmd.current_dir(&project);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let out = match tokio::time::timeout(Duration::from_secs(180), child.wait_with_output()).await {
        Ok(r) => r.map_err(|e| e.to_string())?,
        Err(_) => return Err("claude timed out after 180s — try again or a smaller model".into()),
    };
    if !out.status.success() {
        return Err(format!(
            "claude exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let env: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("bad claude envelope: {e}"))?;
    let is_error = env.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
    let bad_subtype = env
        .get("subtype")
        .and_then(|v| v.as_str())
        .map(|s| s != "success")
        .unwrap_or(false);
    if is_error || bad_subtype {
        return Err(format!(
            "claude returned error: {}",
            env.get("result").and_then(|v| v.as_str()).unwrap_or("unknown")
        ));
    }
    let result = env
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or("no .result in claude envelope")?
        .to_string();

    // 6. Persist.
    {
        let conn = open_conn(&app)?;
        conn.execute(
            "UPDATE repolens_websites SET design_json = ?2, design_at = ?3, updated_at = ?3 WHERE id = ?1",
            params![id, result, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn repolens_website_delete(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(n) = RIPS.lock().remove(&id) {
        n.notify_waiters();
    }
    let dir = {
        let conn = open_conn(&app)?;
        let p: String = conn
            .query_row(
                "SELECT project_path FROM repolens_websites WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM repolens_websites WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // project_path is <dir>/project — delete the parent rip dir.
        PathBuf::from(p).parent().map(|p| p.to_path_buf())
    };
    if let Some(d) = dir {
        let _ = std::fs::remove_dir_all(d);
    }
    Ok(())
}

/// Called once at boot: any rip left "running" by a crash → "error".
pub fn reconcile_on_boot(app: &AppHandle) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET status = 'error', error = 'interrupted by restart', updated_at = ?1 WHERE status = 'running'",
            params![now_ms()],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_major_parses() {
        assert_eq!(parse_node_major("v24.3.0\n"), Some(24));
        assert_eq!(parse_node_major("v22.14.0"), Some(22));
        assert_eq!(parse_node_major("garbage"), None);
    }

    #[test]
    fn first_image_picks_png_over_md() {
        let files = vec![
            "BEHAVIORS.md".to_string(),
            "hero-desktop.png".to_string(),
            "notes.txt".to_string(),
        ];
        assert_eq!(pick_thumbnail(&files), Some("hero-desktop.png".to_string()));
        assert_eq!(pick_thumbnail(&["only.md".to_string()]), None);
    }

    #[test]
    fn earliest_new_image_skips_scaffold_and_picks_first_real_screenshot() {
        let initial: HashSet<String> =
            ["comparison.png".to_string(), ".gitkeep".to_string()]
                .into_iter()
                .collect();
        // (name, mtime) — comparison.png exists from t=0 (scaffold) and must be
        // ignored; among the agent's screenshots the earliest-saved one wins.
        let entries = vec![
            ("comparison.png".to_string(), 100u128),
            ("clone-desktop.png".to_string(), 400),
            ("home-desktop.png".to_string(), 300),
            ("notes.md".to_string(), 350),
        ];
        assert_eq!(
            earliest_new_image(&entries, &initial),
            Some("home-desktop.png".to_string())
        );
        // No new images yet (only the scaffold placeholder) → None.
        let only_scaffold = vec![("comparison.png".to_string(), 100u128)];
        assert_eq!(earliest_new_image(&only_scaffold, &initial), None);
    }

    #[test]
    fn design_screenshots_prefer_desktop_then_mobile_and_exclude_clone() {
        let imgs = vec![
            "comparison.png".to_string(),
            "clone-desktop.png".to_string(),
            "home-mobile.png".to_string(),
            "home-desktop.png".to_string(),
            "notes.md".to_string(),
        ];
        assert_eq!(
            pick_design_screenshots(&imgs, 2),
            vec!["home-desktop.png".to_string(), "home-mobile.png".to_string()]
        );
        let plain = vec!["comparison.png".to_string(), "screenshot.png".to_string()];
        assert_eq!(pick_design_screenshots(&plain, 2), vec!["screenshot.png".to_string()]);
        let many = vec![
            "a-desktop.png".to_string(),
            "b-desktop.png".to_string(),
            "c-desktop.png".to_string(),
        ];
        assert_eq!(pick_design_screenshots(&many, 2).len(), 2);
    }
}
