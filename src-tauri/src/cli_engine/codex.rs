//! Codex CLI spawn spec: writes an isolated `CODEX_HOME` (config.toml with the
//! Orion MCP server) + bridges the user's auth.json into it, then builds the
//! `codex exec --json` invocation. The pure arg-builder is unit-tested; the
//! side-effectful `prepare` is exercised by the user smoke checklist.

use crate::cli_engine::SpawnSpec;
use tauri::{AppHandle, Manager};

/// Build the `codex exec` argv. Current Codex exec is non-interactive and no
/// longer accepts the top-level `-a` approval flag. Its `resume` subcommand
/// also does not accept `--sandbox` or `--cd`, so resumed turns use the
/// process cwd and the thread's existing sandbox policy.
pub fn codex_args(model: &str, cwd: &str, session_id: Option<&str>) -> Vec<String> {
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        return vec![
            "exec".into(),
            "resume".into(),
            sid.into(),
            "--json".into(),
            "-m".into(),
            model.into(),
            "--skip-git-repo-check".into(),
            "-".into(),
        ];
    }
    vec![
        "exec".into(),
        "--json".into(),
        "-m".into(),
        model.into(),
        "-s".into(),
        "workspace-write".into(),
        "--skip-git-repo-check".into(),
        "-C".into(),
        cwd.into(),
        "-".into(),
    ]
}

/// Write the isolated CODEX_HOME (config.toml with the Orion MCP server) and
/// bridge the user's auth.json into it, then build the SpawnSpec.
pub fn prepare(
    app: &AppHandle,
    prompt: &str,
    project_root: Option<&str>,
    session_id: Option<&str>,
    model: &str,
    system_append: &str,
) -> Result<SpawnSpec, String> {
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let codex_home = config_dir.join("cli-engines").join("codex-home");
    std::fs::create_dir_all(&codex_home).map_err(|e| e.to_string())?;

    // Write config.toml (best-effort — without it, the engine runs sans MCP).
    if let Some(server) = crate::mcp_config::orion_server(app) {
        let toml = crate::cli_engine::config::codex_mcp_config(&server);
        let _ = std::fs::write(codex_home.join("config.toml"), toml);
    }
    // Bridge auth: CODEX_HOME relocates auth.json, so copy the user's creds in.
    if let Some(home) = std::env::var_os("HOME") {
        let src = std::path::Path::new(&home).join(".codex").join("auth.json");
        if src.exists() {
            let _ = std::fs::copy(&src, codex_home.join("auth.json"));
        }
    }

    let args = codex_args(model, &cwd, session_id);

    // Persona: Codex has no append-system-prompt flag; prepend instructions.
    let full_prompt = if system_append.trim().is_empty() {
        prompt.to_string()
    } else {
        format!(
            "[System instructions]\n{}\n\n{}",
            system_append.trim(),
            prompt
        )
    };

    Ok(SpawnSpec {
        program: "codex".into(),
        args,
        envs: vec![(
            "CODEX_HOME".into(),
            codex_home.to_string_lossy().into_owned(),
        )],
        cwd,
        stdin_data: Some(format!("{full_prompt}\n")),
    })
}

#[cfg(test)]
mod codex_args_tests {
    use super::codex_args;

    #[test]
    fn builds_headless_argv() {
        let a = codex_args("gpt-5.1-codex", "/proj", None);
        assert_eq!(a[0], "exec");
        assert!(a.contains(&"--json".to_string()));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-m" && w[1] == "gpt-5.1-codex"));
        assert!(!a.contains(&"-a".to_string()));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-s" && w[1] == "workspace-write"));
        assert!(a.contains(&"--skip-git-repo-check".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "-C" && w[1] == "/proj"));
        assert_eq!(a.last().map(String::as_str), Some("-"));
    }

    #[test]
    fn resume_uses_only_supported_subcommand_flags() {
        let a = codex_args("gpt-5.6-sol", "/proj", Some("thread-1"));
        assert_eq!(&a[..3], ["exec", "resume", "thread-1"]);
        assert!(a.contains(&"--json".to_string()));
        assert!(!a.contains(&"-a".to_string()));
        assert!(!a.contains(&"-s".to_string()));
        assert!(!a.contains(&"-C".to_string()));
        assert_eq!(a.last().map(String::as_str), Some("-"));
    }
}
