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
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::claude_cli::augmented_path;

const MAX_TURNS: &str = "50";
const IMAGE_EXTS: [&str; 4] = ["png", "webp", "jpg", "jpeg"];
const PLAYWRIGHT_ARGS: [&str; 4] = ["-y", "@playwright/mcp@0.0.80", "--headless", "--isolated"];

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
static RIPS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

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
    let read = || -> std::io::Result<String> {
        use std::io::Read;
        if !std::fs::symlink_metadata(path)?.file_type().is_file() {
            return Err(std::io::Error::other("Not a regular artifact file"));
        }
        let mut bytes = Vec::new();
        std::fs::File::open(path)?.take(cap.saturating_mul(4) as u64).read_to_end(&mut bytes)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    };
    match read() {
        Ok(s) if !s.trim().is_empty() => {
            let body: String = s.chars().take(cap).collect();
            format!("\n\n===== {label} =====\n{body}")
        }
        _ => String::new(),
    }
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
    for resource in ["website-cloner-scaffold", "_up_/resources/website-cloner-scaffold", "resources/website-cloner-scaffold"] {
        if let Ok(p) = app.path().resolve(resource, tauri::path::BaseDirectory::Resource) {
            if p.is_dir() { return Ok(p); }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RipEngine {
    Claude,
    Codex,
}

fn rip_engine(provider_kind: &str) -> Result<RipEngine, String> {
    match provider_kind {
        "anthropic" => Ok(RipEngine::Claude),
        "codex_cli" => Ok(RipEngine::Codex),
        _ => Err("Website reconstruction requires a Claude or Codex subscription connector. Choose one explicitly.".into()),
    }
}

fn resolve_rip_model(app: &AppHandle, selection: Option<&str>) -> Result<(RipEngine, String, String), String> {
    let selection = selection.ok_or("Choose a website agent model")?;
    let provider = crate::provider_selection::resolve(&open_conn(app)?, selection)?;
    Ok((rip_engine(&provider.kind)?, provider.model.clone(), provider.value()))
}

fn rip_codex_args(model: &str, cwd: &str, resume: Option<&str>) -> Vec<String> {
    let mut args = crate::cli_engine::codex::codex_args(model, cwd, resume);
    args.splice(1..1, [
        "-c".into(), "mcp_servers.playwright.command=\"npx\"".into(),
        "-c".into(), format!("mcp_servers.playwright.args={}", serde_json::to_string(&PLAYWRIGHT_ARGS).unwrap()),
        "-c".into(), "mcp_servers.playwright.default_tools_approval_mode=\"approve\"".into(),
    ]);
    args
}

/// Dedicated rip MCP config: headless Playwright only. Returns the file path.
fn write_rip_mcp(project: &Path) -> Result<String, String> {
    let cfg = serde_json::json!({
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": PLAYWRIGHT_ARGS
            }
        }
    });
    let path = project.join(".rip-mcp.json");
    crate::mcp_config::write_private(&path, cfg.to_string().as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn validate_rip_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err("Invalid website project ID".into());
    }
    Ok(())
}

fn rip_codex_home(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_rip_id(id)?;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("cli-engines")
        .join("repolens-codex")
        .join(id))
}

fn clone_prompt(url: &str, engine: RipEngine) -> String {
    let skill_path = match engine {
        RipEngine::Claude => ".claude/skills/clone-website/SKILL.md",
        RipEngine::Codex => ".codex/skills/clone-website/SKILL.md",
    };
    let parallel_note = match engine {
        RipEngine::Claude => {
            "Create worktrees for parallel builders and merge them back as instructed."
        }
        RipEngine::Codex => {
            "If subagents are unavailable, build the extracted sections sequentially in this workspace. Respect permission denials and report blocked actions; never bypass restrictions."
        }
    };
    format!(
        "You are cloning a website into THIS Next.js project (your current working directory).\n\n\
Target URL: {url}\n\n\
Follow the clone-website skill verbatim. Read the full instructions at `{skill_path}` \
in this project and execute every phase (recon, foundation, component specs, construction, assembly, visual QA).\n\n\
Browser automation: a headless Playwright MCP server named `playwright` is attached. \
Use its browser tools for all navigation, screenshots, and DOM/CSS extraction.\n\n\
IMPORTANT for progress reporting:\n\
- Very early in recon, save a full-page desktop screenshot (1440px) into \
`docs/design-references/` (e.g. `home-desktop.png`). This is used as the rip's preview thumbnail, so do it before deep extraction.\n\
- This project is already a git repository with an initial commit. {parallel_note}\n\
- Verify `npm run build` passes before you finish.\n"
    )
}

async fn preflight() -> Result<(), String> {
    let out = crate::connector_status::probe("node", &["--version"]).await
        .filter(|output| output.status.success())
        .ok_or("Node.js probe failed or timed out. Install Node 24+ to use the website ripper.")?;
    let ver = String::from_utf8_lossy(&out.stdout);
    match parse_node_major(&ver) {
        Some(n) if n >= 24 => Ok(()),
        Some(n) => Err(format!(
            "Node {n} found, but the cloner scaffold needs Node 24+. Upgrade Node (e.g. `nvm install 24`)."
        )),
        None => Err("Could not determine the Node.js version.".into()),
    }
}

async fn preflight_agent(engine: RipEngine) -> Result<(), String> {
    let program = if engine == RipEngine::Codex { "codex" } else { "claude" };
    crate::connector_status::probe(program, &["--version"]).await
        .filter(|output| output.status.success())
        .ok_or_else(|| format!("{program} is unavailable or timed out. Connect it in Control Panel → Providers."))?;
    if engine == RipEngine::Codex {
        let output = crate::connector_status::probe("codex", &["login", "status"]).await
            .ok_or("Codex login status timed out. Reconnect ChatGPT in Control Panel → Providers.")?;
        let status = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        if !output.status.success() || !status.to_lowercase().contains("logged in using chatgpt") {
            return Err("ChatGPT subscription login required. API-key auth is not used for website reconstruction.".into());
        }
    }
    Ok(())
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
    let id = format!("rip_{}", ulid::Ulid::new());
    let root = websites_root(&app)?;
    let dir = root.join(&id);
    let project = dir.join("project");
    let (_, _, model) = resolve_rip_model(&app, model.as_deref())?;

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
    preflight().await?;
    let (engine, _, _) = resolve_rip_model(&app, Some(&model))?;
    preflight_agent(engine).await?;

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
                let name =
                    prettify_tool(block.get("name").and_then(|x| x.as_str()).unwrap_or("tool"));
                let brief = block
                    .get("input")
                    .map(summarize_tool_input)
                    .unwrap_or_default();
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
                && block
                    .get("is_error")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false)
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
    let (engine, model, _) = resolve_rip_model(&app, Some(&model))?;
    match engine {
        RipEngine::Claude => run_claude_agent(app, id, url, project, model, mcp, resume).await,
        RipEngine::Codex => run_codex_agent(app, id, url, project, model, resume).await,
    }
}

async fn run_claude_agent(
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
        "acceptEdits",
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
    cmd.arg("--").arg(clone_prompt(&url, RipEngine::Claude));
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

async fn run_codex_agent(
    app: AppHandle,
    id: String,
    url: String,
    project: PathBuf,
    model: String,
    resume: Option<String>,
) -> Result<(), String> {
    let _account = crate::cli_auth::use_account("codex_cli")?;
    let mut cmd = Command::new("codex");
    crate::cli_auth::apply_profile(&mut cmd);
    crate::cli_engine::subscription_environment(crate::cli_engine::CliEngine::Codex, &mut cmd);
    cmd.args(rip_codex_args(&model, &project.to_string_lossy(), resume.as_deref()));
    cmd.current_dir(&project);
    cmd.env("PATH", augmented_path());
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn codex: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(clone_prompt(&url, RipEngine::Codex).as_bytes())
            .await
            .map_err(|e| format!("write Codex prompt: {e}"))?;
        stdin.shutdown().await.map_err(|e| e.to_string())?;
    }
    let stdout = child.stdout.take().ok_or("no Codex stdout")?;
    let mut lines = BufReader::new(stdout).lines();
    let mut stderr = child.stderr.take().ok_or("no Codex stderr")?;
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });

    let cancel = Arc::new(Notify::new());
    RIPS.lock().insert(id.clone(), cancel.clone());
    spawn_thumbnail_watcher(app.clone(), id.clone(), project.clone());

    let mut log = String::new();
    let mut session: Option<String> = None;
    let mut seen_tools: HashSet<String> = HashSet::new();
    let mut tool_names: HashMap<String, String> = HashMap::new();
    let mut run_error: Option<String> = None;
    let mut codex_state = crate::cli_engine::transcode::CodexState::default();

    let result: Result<(), ()> = 'stream: loop {
        tokio::select! {
            _ = cancel.notified() => {
                let _ = child.kill().await;
                break Err(());
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(raw)) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                            match value.get("type").and_then(|kind| kind.as_str()) {
                                Some("turn.failed") | Some("error") => {
                                    run_error = Some(
                                        value.get("error")
                                            .and_then(|error| error.get("message"))
                                            .and_then(|message| message.as_str())
                                            .or_else(|| value.get("message").and_then(|message| message.as_str()))
                                            .unwrap_or("Codex website agent failed")
                                            .to_string(),
                                    );
                                }
                                _ => {}
                            }
                        }
                        for event in crate::cli_engine::transcode::codex_line_to_events(
                            &raw,
                            &mut codex_state,
                        ) {
                            if event.get("type").and_then(|kind| kind.as_str()) == Some("system") {
                                if let Some(sid) = event.get("session_id").and_then(|value| value.as_str()) {
                                    session = Some(sid.to_string());
                                }
                            }
                            if let Some(delta) = hermes_style_feed_line(
                                &event,
                                &mut seen_tools,
                                &mut tool_names,
                            ) {
                                log.push_str(&delta);
                                log.push('\n');
                                persist_log(&app, &id, &log);
                                emit(
                                    &app,
                                    &id,
                                    "running",
                                    &infer_phase(&log),
                                    Some(delta),
                                    None,
                                    session.clone(),
                                );
                            }
                            if event.get("type").and_then(|kind| kind.as_str()) == Some("result") {
                                break 'stream Ok(());
                            }
                        }
                    }
                    Ok(None) => break Ok(()),
                    Err(_) => break Err(()),
                }
            }
        }
    };
    RIPS.lock().remove(&id);

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    if let Some(message) = run_error {
        return Err(message);
    }
    match result {
        Err(_) => {
            mark(&app, &id, "cancelled", None, session);
            Ok(())
        }
        Ok(()) if !status.success() => {
            Err(format!("Codex exited {}: {}", status, stderr_text.trim()))
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
        n.notify_one();
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
    validate_rip_id(&id)?;
    let (engine, _, selected) = resolve_rip_model(&app, Some(&model))?;
    preflight_agent(engine).await?;
    // Legacy Codex threads lived in an isolated auth home. Recover from the
    // saved project rather than resuming a thread in the wrong credential home.
    let session = if model.starts_with("provider:") { session } else { None };
    let project = PathBuf::from(project);
    let mcp = write_rip_mcp(&project)?;
    {
        let conn = open_conn(&app)?;
        let changed = conn.execute(
            "UPDATE repolens_websites SET model = ?2, session_id = ?3, status = 'running', phase = 'building', updated_at = ?4 WHERE id = ?1 AND status != 'running'",
            params![id, selected, session, now_ms()],
        ).map_err(|e| e.to_string())?;
        if changed == 0 { return Err("This website agent is already running.".into()); }
    }
    let model = selected;
    emit(&app, &id, "running", "building", None, None, session.clone());
    let app2 = app.clone();
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            run_agent(app2.clone(), id2.clone(), url, project, model, mcp, session).await
        {
            fail(&app2, &id2, &e);
        }
    });
    Ok(())
}

async fn run_claude_design_call(
    project: &Path,
    prompt: &str,
    model: &str,
) -> Result<String, String> {
    let mut cmd = Command::new("claude");
    cmd.args([
        "-p",
        "--output-format",
        "json",
        "--strict-mcp-config",
        "--model",
        model,
    ]);
    cmd.current_dir(project);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    }
    let out = match tokio::time::timeout(Duration::from_secs(180), child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| e.to_string())?,
        Err(_) => return Err("claude timed out after 180s — try again or a smaller model".into()),
    };
    if !out.status.success() {
        return Err(format!(
            "claude exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let envelope: Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("bad claude envelope: {e}"))?;
    let is_error = envelope
        .get("is_error")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let bad_subtype = envelope
        .get("subtype")
        .and_then(|value| value.as_str())
        .map(|value| value != "success")
        .unwrap_or(false);
    if is_error || bad_subtype {
        return Err(format!(
            "claude returned error: {}",
            envelope
                .get("result")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown")
        ));
    }
    envelope
        .get("result")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| "no .result in claude envelope".to_string())
}

async fn run_codex_design_call(
    project: &Path,
    prompt: &str,
    model: &str,
    images: &[PathBuf],
) -> Result<String, String> {
    let mut args = vec![
        "exec".to_string(),
        "--json".to_string(),
        "--model".to_string(),
        model.to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--skip-git-repo-check".to_string(),
        "--ignore-user-config".to_string(),
        "--ephemeral".to_string(),
        "--cd".to_string(),
        project.to_string_lossy().into_owned(),
    ];
    for image in images {
        args.push("--image".to_string());
        args.push(image.to_string_lossy().into_owned());
    }
    args.push("-".to_string());

    let _account = crate::cli_auth::use_account("codex_cli")?;
    let mut cmd = Command::new("codex");
    crate::cli_auth::apply_profile(&mut cmd);
    crate::cli_engine::subscription_environment(crate::cli_engine::CliEngine::Codex, &mut cmd);
    cmd.args(args);
    cmd.current_dir(project);
    cmd.env("PATH", augmented_path());
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn codex: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    }
    let out = match tokio::time::timeout(Duration::from_secs(180), child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| e.to_string())?,
        Err(_) => return Err("Codex timed out after 180s — try again or a smaller model".into()),
    };
    if !out.status.success() {
        return Err(format!(
            "Codex exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let mut answer = String::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|kind| kind.as_str()) == Some("item.completed")
            && value
                .get("item")
                .and_then(|item| item.get("type"))
                .and_then(|kind| kind.as_str())
                == Some("agent_message")
        {
            if let Some(text) = value
                .get("item")
                .and_then(|item| item.get("text"))
                .and_then(|text| text.as_str())
            {
                answer.push_str(text);
            }
        }
        if matches!(
            value.get("type").and_then(|kind| kind.as_str()),
            Some("turn.failed") | Some("error")
        ) {
            return Err(value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .or_else(|| value.get("message").and_then(|message| message.as_str()))
                .unwrap_or("Codex design extraction failed")
                .to_string());
        }
    }
    if answer.trim().is_empty() {
        Err("Codex returned no design spec".into())
    } else {
        Ok(answer)
    }
}

#[tauri::command]
pub async fn repolens_website_extract_design(
    app: AppHandle,
    id: String,
    model: Option<String>,
) -> Result<String, String> {
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
    let (engine, model, _) = resolve_rip_model(&app, model.as_deref())?;
    preflight_agent(engine).await?;

    // 2. Gather artifacts (fail-soft, size-capped per file; ~80k total budget).
    let docs = project.join("docs");
    let research = docs.join("research");
    let mut artifacts = String::new();
    artifacts.push_str(&read_capped(
        &research.join("style.css"),
        "ORIGINAL SITE CSS (style.css)",
        24_000,
    ));
    artifacts.push_str(&read_capped(
        &research.join("dom-structure.json"),
        "DOM STRUCTURE",
        12_000,
    ));
    artifacts.push_str(&read_capped(
        &research.join("global-ui-structure.json"),
        "GLOBAL UI STRUCTURE",
        12_000,
    ));
    artifacts.push_str(&read_capped(
        &project.join("src").join("app").join("globals.css"),
        "GENERATED TOKENS (globals.css)",
        12_000,
    ));
    artifacts.push_str(&read_capped(
        &research.join("BEHAVIORS.md"),
        "BEHAVIORS",
        8_000,
    ));
    artifacts.push_str(&read_capped(
        &research.join("PAGE_TOPOLOGY.md"),
        "PAGE TOPOLOGY",
        4_000,
    ));
    artifacts.push_str(&read_capped(
        &research.join("source.html"),
        "SOURCE HTML (head excerpt)",
        6_000,
    ));

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

    // 4. Route extraction through the selected subscription engine. Claude
    // reads @path image mentions; Codex receives native --image attachments.
    let base_prompt = format!("{DESIGN_PROMPT}{artifacts}");
    let image_paths: Vec<PathBuf> = shots.iter().map(|shot| refs_dir.join(shot)).collect();
    let result = match engine {
        RipEngine::Claude => {
            let mut prompt = base_prompt;
            for image in &image_paths {
                prompt.push_str(&format!("\n\n@{}", image.to_string_lossy()));
            }
            run_claude_design_call(&project, &prompt, &model).await?
        }
        RipEngine::Codex => {
            run_codex_design_call(&project, &base_prompt, &model, &image_paths).await?
        }
    };

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

fn checked_rip_directory(root: &Path, id: &str, project: &Path) -> Result<PathBuf, String> {
    validate_rip_id(id)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let dir = project.parent().ok_or("Invalid website project directory")?;
    let parent = dir.parent().ok_or("Invalid website project directory")?.canonicalize().map_err(|e| e.to_string())?;
    if parent != root || dir.file_name().and_then(|name| name.to_str()) != Some(id) {
        return Err("Website project is outside its managed directory".into());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(dir) {
        if !metadata.file_type().is_dir() { return Err("Website directory must not be a symlink or special file".into()); }
    }
    Ok(dir.to_path_buf())
}

#[tauri::command]
pub async fn repolens_website_delete(app: AppHandle, id: String) -> Result<(), String> {
    validate_rip_id(&id)?;
    let conn = open_conn(&app)?;
    let (project, status): (String, String) = conn.query_row(
        "SELECT project_path, status FROM repolens_websites WHERE id = ?1", params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;
    if status == "running" || RIPS.lock().contains_key(&id) {
        return Err("Stop the website agent and wait for it to finish before deleting its project.".into());
    }
    let dir = checked_rip_directory(&websites_root(&app)?, &id, Path::new(&project))?;
    if let Err(error) = std::fs::remove_dir_all(&dir) {
        if error.kind() != std::io::ErrorKind::NotFound { return Err(format!("Website project was not deleted: {error}")); }
    }
    let home = rip_codex_home(&app, &id)?;
    if let Err(error) = std::fs::remove_dir_all(home) {
        if error.kind() != std::io::ErrorKind::NotFound { return Err(format!("Legacy website session cleanup failed: {error}")); }
    }
    conn.execute("DELETE FROM repolens_websites WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
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
    fn website_agent_routes_subscription_models_to_their_cli() {
        assert_eq!(rip_engine("anthropic").unwrap(), RipEngine::Claude);
        assert_eq!(rip_engine("codex_cli").unwrap(), RipEngine::Codex);
        assert!(rip_engine("openai").is_err());
        assert!(rip_engine("gpt-5.6-sol").is_err());
        assert!(clone_prompt("https://example.com", RipEngine::Claude)
            .contains(".claude/skills/clone-website/SKILL.md"));
        let codex = clone_prompt("https://example.com", RipEngine::Codex);
        assert!(codex.contains(".codex/skills/clone-website/SKILL.md"));
        assert!(codex.contains("Playwright MCP server"));
    }

    #[test]
    fn codex_website_uses_real_auth_with_isolated_pinned_mcp_config() {
        for session in [None, Some("thread-1")] {
            let args = rip_codex_args("model-alias", "/test/project", session);
            assert!(args.contains(&"--ignore-user-config".into()));
            assert!(args.iter().any(|arg| arg.contains("@playwright/mcp@0.0.80")));
            assert!(!args.iter().any(|arg| arg.contains("auth.json") || arg.contains("@latest") || arg.contains("CODEX_HOME")));
            assert_eq!(args.last().map(String::as_str), Some("-"));
            if session.is_some() { assert!(!args.contains(&"-s".into())); }
        }
    }

    #[test]
    fn deletion_scope_and_artifact_read_bounds() {
        let root = std::env::temp_dir().join(format!("orion-rip-scope-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("rip_one/project")).unwrap();
        assert!(checked_rip_directory(&root, "rip_one", &root.join("rip_one/project")).is_ok());
        assert!(checked_rip_directory(&root, "rip_other", &root.join("rip_one/project")).is_err());
        assert!(checked_rip_directory(&root, "rip_one", &root.join("project")).is_err());
        let artifact = root.join("artifact.txt");
        std::fs::write(&artifact, "🙂".repeat(10_000)).unwrap();
        assert_eq!(read_capped(&artifact, "TEST", 3), "\n\n===== TEST =====\n🙂🙂🙂");
        #[cfg(unix)] {
            std::os::unix::fs::symlink(root.join("rip_one"), root.join("rip_link")).unwrap();
            assert!(checked_rip_directory(&root, "rip_link", &root.join("rip_link/project")).is_err());
            std::os::unix::fs::symlink(&artifact, root.join("linked.txt")).unwrap();
            assert!(read_capped(&root.join("linked.txt"), "TEST", 3).is_empty());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_rip_path_traversal_ids() {
        for id in ["../x", "a/b", "", ".", "a\\b"] { assert!(validate_rip_id(id).is_err()); }
        assert!(validate_rip_id("rip_01ABC-123").is_ok());
    }

    #[test]
    fn earliest_new_image_skips_scaffold_and_picks_first_real_screenshot() {
        let initial: HashSet<String> = ["comparison.png".to_string(), ".gitkeep".to_string()]
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
            vec![
                "home-desktop.png".to_string(),
                "home-mobile.png".to_string()
            ]
        );
        let plain = vec!["comparison.png".to_string(), "screenshot.png".to_string()];
        assert_eq!(
            pick_design_screenshots(&plain, 2),
            vec!["screenshot.png".to_string()]
        );
        let many = vec![
            "a-desktop.png".to_string(),
            "b-desktop.png".to_string(),
            "c-desktop.png".to_string(),
        ];
        assert_eq!(pick_design_screenshots(&many, 2).len(), 2);
    }
}
