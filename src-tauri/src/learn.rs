//! Learn section — thin Rust surface for one-shot subscription-CLI calls.
//! Mirrors `repolens::repolens_claude_call` exactly, adding an optional
//! web-search mode (drops `--strict-mcp-config`, enables WebSearch tool).

use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize)]
pub struct LearnReply {
    pub result: String,
    pub cost: f64,
    pub model: String,
}

#[tauri::command]
pub async fn learn_claude_call(
    prompt: String,
    model: String,
    allow_web: bool,
) -> Result<LearnReply, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let model = if model.trim().is_empty() {
        "claude-sonnet-4-6".to_string()
    } else {
        model
    };

    let mut cmd = Command::new("claude");
    if allow_web {
        // Web-search mode: allow the WebSearch tool; omit --strict-mcp-config
        // so the CLI can reach the network.
        cmd.args([
            "-p",
            "--output-format",
            "json",
            "--allowedTools",
            "WebSearch",
            "--model",
            &model,
        ]);
    } else {
        // Tool-less mode: identical to repolens_claude_call — no MCP servers,
        // no tools, fastest startup.
        cmd.args([
            "-p",
            "--output-format",
            "json",
            "--strict-mcp-config",
            "--model",
            &model,
        ]);
    }

    if let Some(home) = std::env::var_os("HOME") {
        cmd.current_dir(home);
    }
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    } // stdin dropped → EOF, claude starts

    let out = match tokio::time::timeout(
        std::time::Duration::from_secs(180),
        child.wait_with_output(),
    )
    .await
    {
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
    let env: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("bad claude envelope: {e}"))?;
    let is_error = env
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
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
    let cost = env
        .get("total_cost_usd")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    Ok(LearnReply {
        result,
        cost,
        model,
    })
}
