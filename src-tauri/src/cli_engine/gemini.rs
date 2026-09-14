//! Gemini CLI spawn spec: writes an isolated system-settings JSON (Orion MCP
//! server, injected via `GEMINI_CLI_SYSTEM_SETTINGS_PATH` so the user's real
//! config is untouched) + a persona system-prompt file, then builds the
//! `gemini -p -o stream-json` invocation. Pure arg-builder is unit-tested.

use crate::cli_engine::SpawnSpec;
use tauri::{AppHandle, Manager};

/// Build the `gemini` headless argv. Prompt passed via -p (Gemini reads it as
/// an arg in non-interactive mode). Orion's MCP server is trusted explicitly;
/// that must not implicitly approve arbitrary native shell commands.
pub fn gemini_args(model: &str, prompt: &str, session_id: Option<&str>) -> Vec<String> {
    let mut a = vec![
        "-p".into(),
        prompt.into(),
        "-o".into(),
        "stream-json".into(),
        "-m".into(),
        model.into(),
        "--skip-trust".into(),
        "--approval-mode".into(),
        "default".into(),
    ];
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        a.push("--resume".into());
        a.push(sid.to_string());
    }
    a
}

pub fn prepare(
    app: &AppHandle,
    prompt: &str,
    project_root: Option<&str>,
    session_id: Option<&str>,
    model: &str,
    system_append: &str,
    allowed_tools: Option<&[String]>,
    ui_run_id: Option<&str>,
) -> Result<SpawnSpec, String> {
    crate::mcp_grants::orion_only(allowed_tools)?;
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let gem_dir = config_dir.join("cli-engines");
    std::fs::create_dir_all(&gem_dir).map_err(|e| e.to_string())?;

    let server = crate::mcp_config::scoped_server(app, allowed_tools, ui_run_id)?;
    let json = crate::cli_engine::config::gemini_mcp_config(&server, allowed_tools);
    let settings = crate::mcp_config::ScopedConfig::write(&gem_dir, "gemini-settings", json.as_bytes())?;
    let envs = vec![("GEMINI_CLI_SYSTEM_SETTINGS_PATH".into(), settings.path().to_string_lossy().into_owned())];
    // A shared GEMINI_SYSTEM_MD file races across app rails and replaces the
    // engine's own system prompt. Keep per-turn context in this turn instead.
    let prompt = if system_append.trim().is_empty() { prompt.to_string() } else {
        format!("[Assistant instructions]\n{}\n\n{}", system_append.trim(), prompt)
    };

    Ok(SpawnSpec {
        program: "gemini".into(),
        args: gemini_args(model, &prompt, session_id),
        envs,
        cwd,
        stdin_data: None,
        _configs: vec![settings],
    })
}

#[cfg(test)]
mod gemini_args_tests {
    use super::gemini_args;
    #[test]
    fn builds_headless_argv() {
        let a = gemini_args("gemini-2.5-pro", "hello", None);
        assert!(a.windows(2).any(|w| w[0] == "-p" && w[1] == "hello"));
        assert!(a.windows(2).any(|w| w[0] == "-o" && w[1] == "stream-json"));
        assert!(a.windows(2).any(|w| w[0] == "-m" && w[1] == "gemini-2.5-pro"));
        assert!(a.contains(&"--skip-trust".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--approval-mode" && w[1] == "default"));
    }
    #[test]
    fn appends_resume_when_session_present() {
        let a = gemini_args("gemini-2.5-pro", "hi", Some("sess9"));
        assert!(a.windows(2).any(|w| w[0] == "--resume" && w[1] == "sess9"));
    }
}
