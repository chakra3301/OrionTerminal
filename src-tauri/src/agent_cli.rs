//! Finding and describing the agent CLIs (Claude Code, Codex, Pi, Hermes)
//! that Orion's agent tabs run, for any user's install.
//!
//! Lookup uses the user's login-shell PATH (where installers put these CLIs)
//! before Orion's fallbacks, and skips package-local `node_modules` dirs:
//! `npm run tauri dev` puts those first, so a stale copy in `~/node_modules`
//! shadowed the real install.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

static LOGIN_PATH: Lazy<Option<String>> = Lazy::new(login_shell_path);

/// PATH from the user's interactive login shell; None if it can't be read quickly.
fn login_shell_path() -> Option<String> {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| s.starts_with('/') && Path::new(s).exists())
            .unwrap_or_else(|| "/bin/zsh".into());
        let mut child = Command::new(shell)
            .args(["-ilc", "printf '__ORION_PATH__%s__ORION_PATH__' \"$PATH\""])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let mut stdout = child.stdout.take()?;
        let reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stdout.read_to_string(&mut s);
            s
        });
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        let out = reader.join().ok()?;
        let start = out.find("__ORION_PATH__")? + "__ORION_PATH__".len();
        let end = start + out[start..].find("__ORION_PATH__")?;
        Some(out[start..end].to_string()).filter(|p| !p.trim().is_empty())
    }
    #[cfg(not(unix))]
    None
}

/// PATH for agent CLIs: login-shell PATH, then Orion's fallbacks, without
/// `node_modules` dirs or duplicates.
pub fn agent_path() -> String {
    agent_path_from(LOGIN_PATH.as_deref(), &crate::claude_cli::augmented_path())
}

fn agent_path_from(login: Option<&str>, fallback: &str) -> String {
    let mut seen = HashSet::new();
    login
        .unwrap_or("")
        .split(':')
        .chain(fallback.split(':'))
        .filter(|p| !p.is_empty() && p.starts_with('/') && !p.contains("/node_modules/") && !p.ends_with("/node_modules"))
        .filter(|p| seen.insert(*p))
        .collect::<Vec<_>>()
        .join(":")
}

fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    p.is_file()
}

/// Absolute path of `program` on `path`.
pub fn resolve_in(program: &str, path: &str) -> Option<PathBuf> {
    path.split(':').map(|d| Path::new(d).join(program)).find(|p| is_executable(p))
}

/// Absolute path of an agent CLI, or the bare name (so spawn errors still name it).
pub fn program(name: &str) -> String {
    resolve_in(name, &agent_path())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

/// Install command shown when a CLI is missing.
pub fn install_hint(agent: &str) -> &'static str {
    match agent {
        "claude" => "npm install -g @anthropic-ai/claude-code",
        "codex" => "npm install -g @openai/codex",
        "pi" => "npm install -g @earendil-works/pi-coding-agent",
        _ => "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
    }
}

// ───────────────────────────── Hermes ─────────────────────────────

/// Env that makes Hermes work in the project folder Orion passes with `--in`.
/// A profile's `terminal.cwd` (e.g. `~/Studio`) otherwise overrides `--in` for
/// every tool call. Hermes' managed-config layer, pointed at an Orion-owned
/// dir with `terminal.cwd: "."`, defers to the process cwd for this run only;
/// the user's config is never edited. Skipped when a real managed scope exists.
pub fn hermes_env(app: &tauri::AppHandle) -> Option<(&'static str, String)> {
    use tauri::Manager;
    if std::env::var_os("HERMES_MANAGED_DIR").is_some() || Path::new("/etc/hermes").is_dir() {
        return None;
    }
    let dir = app.path().app_data_dir().ok()?.join("hermes-session");
    std::fs::create_dir_all(&dir).ok()?;
    let file = dir.join("config.yaml");
    let body = "# Written by Orion Terminal for Hermes runs in a project folder.\nterminal:\n  cwd: \".\"\n";
    if std::fs::read_to_string(&file).ok().as_deref() != Some(body) {
        std::fs::write(&file, body).ok()?;
    }
    Some(("HERMES_MANAGED_DIR", dir.to_string_lossy().into_owned()))
}

// ───────────────────────────── info ─────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOptions {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub mode: Option<String>,
}

/// Options are passed as argv values; allow only model-id-like strings.
pub fn clean(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| {
        !s.is_empty()
            && s.len() <= 120
            && !s.starts_with('-')
            && s.chars().all(|c| c.is_ascii_alphanumeric() || "._:/[]-@".contains(c))
    })
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ModelOpt {
    pub id: String,
    pub label: String,
    pub group: Option<String>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub install: String,
    pub models: Vec<ModelOpt>,
    pub default_model: Option<String>,
    pub default_effort: Option<String>,
    pub efforts: Vec<String>,
    pub account: Option<String>,
}

fn run(bin: &Path, args: &[&str], path: &str) -> Option<String> {
    let mut child = Command::new(bin)
        .args(args)
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .env("TERM_PROGRAM", "OrionTerminal")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    reader.join().ok()
}

/// "codex-cli 0.163.0" / "2.1.306 (Claude Code)" / "Hermes Agent v0.21.6+762.g…" → "0.163.0" etc.
pub fn parse_version(s: &str) -> Option<String> {
    s.lines().next()?.split_whitespace().find_map(|t| {
        let t = t.strip_prefix('v').unwrap_or(t);
        let core: String = t.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        (core.contains('.') && core.starts_with(|c: char| c.is_ascii_digit())).then(|| core.trim_end_matches('.').to_string())
    })
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn efforts(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn claude_info(info: &mut AgentInfo) {
    let dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".claude"));
    let settings: Value = std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    info.default_model = settings["model"].as_str().map(str::to_string);
    info.default_effort = settings["effortLevel"].as_str().map(str::to_string);
    // Ids verified against Claude Code 2.1.306 (`--model` resolves each).
    info.models = [
        ("claude-opus-5-5", "Opus 5.5"),
        ("claude-sonnet-5-5", "Sonnet 5.5"),
        ("claude-haiku-5-5", "Haiku 5.5"),
        ("claude-fable-5-1", "Fable 5.1"),
    ]
    .into_iter()
    .map(|(id, label)| ModelOpt { id: id.into(), label: label.into(), group: None })
    .collect();
    info.efforts = efforts(&["low", "medium", "high", "xhigh", "max"]);
}

/// Top-level `key = "value"` from a TOML file (before the first table).
fn toml_top(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            break;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                return Some(v.trim().trim_matches('"').trim_matches('\'').to_string()).filter(|s| !s.is_empty());
            }
        }
    }
    None
}

pub fn parse_codex_models(json: &str) -> (Vec<ModelOpt>, Vec<String>) {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let mut levels: Vec<String> = vec![];
    let models = v["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|m| m["visibility"].as_str().unwrap_or("list") == "list")
                .filter_map(|m| {
                    for l in m["supported_reasoning_levels"].as_array().into_iter().flatten() {
                        if let Some(e) = l["effort"].as_str() {
                            if !levels.iter().any(|x| x == e) {
                                levels.push(e.to_string());
                            }
                        }
                    }
                    let id = m["slug"].as_str()?.to_string();
                    let label = m["display_name"].as_str().unwrap_or(&id).to_string();
                    Some(ModelOpt { id, label, group: None })
                })
                .collect()
        })
        .unwrap_or_default();
    (models, levels)
}

fn codex_info(info: &mut AgentInfo, bin: &Path, path: &str) {
    let home_dir = crate::cli_auth::codex_home_override()
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("CODEX_HOME").map(PathBuf::from))
        .unwrap_or_else(|| home().join(".codex"));
    let cfg = std::fs::read_to_string(home_dir.join("config.toml")).unwrap_or_default();
    info.default_model = toml_top(&cfg, "model");
    info.default_effort = toml_top(&cfg, "model_reasoning_effort");
    let (models, levels) = run(bin, &["debug", "models"], path).map(|j| parse_codex_models(&j)).unwrap_or_default();
    info.models = models;
    info.efforts = if levels.is_empty() { efforts(&["low", "medium", "high", "xhigh"]) } else { levels };
}

pub fn parse_pi_models(table: &str) -> Vec<ModelOpt> {
    table
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let (provider, model) = (it.next()?, it.next()?);
            (provider != "provider").then(|| ModelOpt {
                id: format!("{provider}/{model}"),
                label: model.to_string(),
                group: Some(provider.to_string()),
            })
        })
        .collect()
}

fn pi_info(info: &mut AgentInfo, bin: &Path, path: &str) {
    let settings: Value = std::fs::read_to_string(home().join(".pi/agent/settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    info.default_model = match (settings["defaultProvider"].as_str(), settings["defaultModel"].as_str()) {
        (Some(p), Some(m)) => Some(format!("{p}/{m}")),
        (None, Some(m)) => Some(m.to_string()),
        _ => None,
    };
    info.default_effort = settings["defaultThinkingLevel"].as_str().map(str::to_string);
    info.models = run(bin, &["--list-models"], path).map(|t| parse_pi_models(&t)).unwrap_or_default();
    info.efforts = efforts(&["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
}

fn hermes_info(info: &mut AgentInfo, bin: &Path, path: &str) {
    let get = |key: &str| {
        run(bin, &["config", "get", key], path)
            .and_then(|s| s.lines().rev().map(str::trim).find(|l| !l.is_empty()).map(str::to_string))
            .filter(|s| !s.eq_ignore_ascii_case("none") && !s.eq_ignore_ascii_case("null"))
    };
    info.default_model = get("model.default");
    let provider = get("model.provider");
    info.default_effort = get("agent.reasoning_effort");
    info.account = provider.clone();
    if let Some(m) = &info.default_model {
        info.models = vec![ModelOpt { id: m.clone(), label: m.clone(), group: provider }];
    }
    info.efforts = efforts(&["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
}

#[tauri::command]
pub async fn agent_cli_info(agent: String) -> Result<AgentInfo, String> {
    let name = match agent.as_str() {
        "claude" | "codex" | "pi" | "hermes" => agent.clone(),
        _ => return Err(format!("unknown agent: {agent}")),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let path = agent_path();
        let mut info = AgentInfo { install: install_hint(&name).into(), ..Default::default() };
        let Some(bin) = resolve_in(&name, &path) else {
            return info;
        };
        info.installed = true;
        info.path = Some(bin.to_string_lossy().into_owned());
        info.version = run(&bin, &["--version"], &path).and_then(|s| parse_version(&s));
        match name.as_str() {
            "claude" => claude_info(&mut info),
            "codex" => codex_info(&mut info, &bin, &path),
            "pi" => pi_info(&mut info, &bin, &path),
            _ => hermes_info(&mut info, &bin, &path),
        }
        info
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_path_drops_node_modules_and_keeps_login_order() {
        let p = agent_path_from(
            Some("/u/.local/bin:/opt/homebrew/bin"),
            "/proj/node_modules/.bin:/u/node_modules/.bin:/x/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/opt/homebrew/bin:/usr/bin:relative",
        );
        assert_eq!(p, "/u/.local/bin:/opt/homebrew/bin:/usr/bin");
        assert_eq!(agent_path_from(None, "/a:/a:/b"), "/a:/b");
    }

    #[test]
    fn versions_parse_from_each_cli() {
        assert_eq!(parse_version("2.1.306 (Claude Code)").as_deref(), Some("2.1.306"));
        assert_eq!(parse_version("codex-cli 0.163.0\n").as_deref(), Some("0.163.0"));
        assert_eq!(parse_version("1.3.0").as_deref(), Some("1.3.0"));
        assert_eq!(parse_version("Hermes Agent v0.21.6+762.g4eba3eb (2026.9.24) · stable").as_deref(), Some("0.21.6"));
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn model_lists_parse() {
        let (m, l) = parse_codex_models(r#"{"models":[{"slug":"a","display_name":"A","visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"max"}]},{"slug":"h","visibility":"hide"}]}"#);
        assert_eq!(m, vec![ModelOpt { id: "a".into(), label: "A".into(), group: None }]);
        assert_eq!(l, ["low", "max"]);
        let p = parse_pi_models("provider   model   context\nanthropic  claude-opus-5-5  1M\nopenai gpt-6 1M\n");
        assert_eq!(p[0].id, "anthropic/claude-opus-5-5");
        assert_eq!(p[1].group.as_deref(), Some("openai"));
        assert_eq!(toml_top("model = \"gpt-6.1-sol\"\n[x]\nmodel = \"no\"", "model").as_deref(), Some("gpt-6.1-sol"));
    }

    #[test]
    fn options_reject_flags_and_shell_text() {
        assert_eq!(clean(&Some(" anthropic/claude-opus-5-5 ".into())), Some("anthropic/claude-opus-5-5"));
        assert_eq!(clean(&Some("opus[1m]".into())), Some("opus[1m]"));
        assert_eq!(clean(&Some("--dangerously".into())), None);
        assert_eq!(clean(&Some("a b".into())), None);
        assert_eq!(clean(&Some("x;rm".into())), None);
        assert_eq!(clean(&None), None);
    }
}
