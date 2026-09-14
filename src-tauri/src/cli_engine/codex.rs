//! Use Codex's real auth home without loading user config. Copying auth into a
//! second home forks rotating refresh tokens and breaks native-keyring auth.

use crate::cli_engine::SpawnSpec;
use tauri::AppHandle;

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
            "--ignore-user-config".into(),
            "-m".into(),
            model.into(),
            "--skip-git-repo-check".into(),
            "-".into(),
        ];
    }
    vec![
        "exec".into(),
        "--json".into(),
        "--ignore-user-config".into(),
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

fn restrict_args(args: &mut Vec<String>, tools: &[String]) {
    let shell = tools.iter().any(|t| t == "Bash");
    if !shell {
        if let Some(at) = args.iter().position(|arg| arg == "workspace-write") { args[at] = "read-only".into(); }
    }
    let mut extra = vec!["-c".into(), "approval_policy=\"never\"".into(), "-c".into(),
        format!("web_search=\"{}\"", if tools.iter().any(|t| t == "WebSearch") { "live" } else { "disabled" })];
    for feature in ["apps", "plugins", "remote_plugin", "image_generation", "multi_agent", "view_image",
        "skill_search", "sleep_tool", "tool_suggest", "request_permissions_tool", "code_mode",
        "code_mode_only", "code_mode_prewarm", "shell_snapshot"] {
        extra.extend(["--disable".into(), feature.into()]);
    }
    // Code-mode-only models need the V8 dispatcher; it invokes the same scoped tool registry.
    extra.extend(["--enable".into(), "code_mode_host".into()]);
    // 0.154 keeps unified_exec enabled; ShellTool gates both execution paths.
    if !shell { extra.extend(["--disable".into(), "shell_tool".into()]); }
    args.splice(1..1, extra);
}

/// MCP secrets travel through the child environment, never command arguments.
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
    if allowed_tools.is_some() && session_id.is_some_and(|id| !id.is_empty()) {
        return Err("Restricted Codex turns must start fresh with text history, not resume an older sandbox policy.".into());
    }
    if allowed_tools.is_some_and(|ts| ts.iter().any(|t| t == "WebFetch") && !ts.iter().any(|t| t == "WebSearch")) {
        return Err("Codex cannot enforce a fetch-only web grant. Choose a connector with separate WebFetch support.".into());
    }
    let cwd = project_root
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    let mut args = codex_args(model, &cwd, session_id);
    if let Some(tools) = allowed_tools { restrict_args(&mut args, tools); }
    let server = crate::mcp_config::scoped_server(app, allowed_tools, ui_run_id)?;
    let overrides = mcp_overrides(&server);
    args.splice(1..1, overrides);
    let envs = server.env;

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
        envs,
        cwd,
        stdin_data: Some(format!("{full_prompt}\n")),
        _configs: vec![],
    })
}

fn mcp_overrides(server: &crate::cli_engine::config::OrionServer) -> Vec<String> {
    let vars: Vec<&str> = server.env.iter().map(|(k, _)| k.as_str()).collect();
    [
        ("command", serde_json::to_string(&server.command).unwrap()),
        ("args", serde_json::to_string(&server.args).unwrap()),
        ("env_vars", serde_json::to_string(&vars).unwrap()),
        // Orion enforces immutable grants at list AND call time; no second CLI prompt is needed.
        ("default_tools_approval_mode", "\"approve\"".into()),
        ("required", "true".into()),
        ("startup_timeout_sec", "10".into()),
    ].into_iter().flat_map(|(key, value)| ["-c".into(), format!("mcp_servers.orion.{key}={value}")]).collect()
}

#[cfg(test)]
mod codex_args_tests {
    use super::{codex_args, restrict_args};

    #[test]
    fn restricted_turns_disable_native_execution_and_cloud_capabilities() {
        let mut args = codex_args("model", "/proj", None);
        restrict_args(&mut args, &[]);
        assert!(args.windows(2).any(|w| w == ["-s", "read-only"]));
        assert!(args.contains(&"web_search=\"disabled\"".into()));
        assert!(args.contains(&"approval_policy=\"never\"".into()));
        for feature in ["shell_tool", "apps", "image_generation", "multi_agent", "plugins", "view_image"] {
            assert!(args.windows(2).any(|w| w == ["--disable", feature]));
        }
        assert!(args.windows(2).any(|w| w == ["--enable", "code_mode_host"]));
        assert!(!args.windows(2).any(|w| w == ["--disable", "code_mode_host"]));
        assert_eq!(args.last().unwrap(), "-");
    }

    #[test]
    fn only_the_scoped_orion_server_gets_noninteractive_tool_approval() {
        let server = crate::cli_engine::config::OrionServer {
            command: "/orion".into(), args: vec!["--mcp-serve".into()],
            env: vec![("ORION_TOOL_GRANTS".into(), "[\"Read\"]".into())],
        };
        let args = super::mcp_overrides(&server);
        assert!(args.contains(&"mcp_servers.orion.default_tools_approval_mode=\"approve\"".into()));
        assert!(args.contains(&"mcp_servers.orion.required=true".into()));
        assert!(args.iter().all(|arg| arg == "-c" || arg.starts_with("mcp_servers.orion.")));
        assert!(!args.iter().any(|arg| arg.contains("[\"Read\"]")));
    }

    #[test]
    fn shell_and_web_access_require_explicit_grants() {
        let mut args = codex_args("model", "/proj", None);
        restrict_args(&mut args, &["Bash".into(), "WebSearch".into()]);
        assert!(args.windows(2).any(|w| w == ["-s", "workspace-write"]));
        assert!(!args.windows(2).any(|w| w == ["--disable", "shell_tool"]));
        assert!(args.contains(&"web_search=\"live\"".into()));
    }

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
