use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    installed: bool,
    logged_in: bool,
    version: Option<String>,
    detail: String,
}

pub(crate) async fn probe(program: &str, args: &[&str]) -> Option<std::process::Output> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("PATH", crate::claude_cli::augmented_path())
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    crate::cli_auth::apply_profile(&mut cmd);
    if program == "claude" { subscription_environment(&mut cmd); }
    tokio::time::timeout(Duration::from_secs(10), cmd.output()).await.ok()?.ok()
}

pub(crate) fn subscription_environment(cmd: &mut Command) {
    for key in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "NODE_OPTIONS", "NODE_PATH"] {
        cmd.env_remove(key);
    }
}

pub(crate) async fn require_claude_subscription() -> Result<(), String> {
    if probe("claude", &["auth", "status", "--json"]).await
        .is_some_and(|out| out.status.success() && subscription_connected(&out.stdout)) {
        Ok(())
    } else {
        Err("Claude subscription login is required. Connect in Providers; API-key authentication will not be used for this subscription connector.".into())
    }
}

fn subscription_connected(bytes: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else { return false };
    value["loggedIn"].as_bool() == Some(true)
        && value["authMethod"].as_str() == Some("oauth")
}

#[tauri::command]
pub async fn claude_status() -> ClaudeStatus {
    let version = probe("claude", &["--version"]).await
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string());
    let installed = version.is_some();
    let logged_in = if installed {
        probe("claude", &["auth", "status", "--json"]).await
            .map(|out| out.status.success() && subscription_connected(&out.stdout))
            .unwrap_or(false)
    } else { false };
    let detail = if !installed {
        "Claude CLI not found. Install Claude Code, then connect your subscription."
    } else if !logged_in {
        "Subscription login needed. API keys for inline edits are configured separately."
    } else {
        "Subscription connected. A live request is needed to verify model access."
    };
    ClaudeStatus { installed, logged_in, version, detail: detail.into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subscription_command_removes_inherited_api_and_execution_overrides() {
        let mut cmd = Command::new("claude");
        cmd.env("ANTHROPIC_API_KEY", "fixture").env("CLAUDE_CONFIG_DIR", "/isolated");
        subscription_environment(&mut cmd);
        let env: std::collections::HashMap<_, _> = cmd.as_std().get_envs().collect();
        for key in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "NODE_OPTIONS", "NODE_PATH"] {
            assert_eq!(env.get(std::ffi::OsStr::new(key)), Some(&None));
        }
        assert_eq!(env.get(std::ffi::OsStr::new("CLAUDE_CONFIG_DIR")), Some(&Some(std::ffi::OsStr::new("/isolated"))));
    }
    #[test]
    fn status_requires_subscription_and_rejects_invalid_output() {
        assert!(subscription_connected(br#"{"loggedIn":true,"authMethod":"oauth"}"#));
        assert!(!subscription_connected(br#"{"loggedIn":false,"authMethod":"none"}"#));
        assert!(!subscription_connected(br#"{"loggedIn":true,"authMethod":"api_key"}"#));
        assert!(!subscription_connected(b"not JSON"));
    }
}
