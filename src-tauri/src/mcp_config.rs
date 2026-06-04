//! Writes the per-launch MCP config file that tells `claude-code` how to
//! reach our in-process MCP server (mode-switched `orion-terminal --mcp-serve`).
//! Both `terminal_open_claude` (Claude Code tab) and `claude_send` (chat
//! rails + Core) call this so every claude subprocess shares the same
//! Orion-aware tool surface.

use tauri::{AppHandle, Manager};

/// Materializes `<app_config_dir>/orion-mcp.json` pointing at the currently-
/// running binary with `--mcp-serve` plus the SQLite DB path in the env.
/// Returns the absolute path to the config file, or `None` on any failure —
/// callers proceed without MCP rather than blocking the user from launching
/// claude.
pub fn write(app: &AppHandle) -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let config_dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&config_dir);
    let db_path = config_dir.join("orion.db");
    let config_path = config_dir.join("orion-mcp.json");

    // If the UI bridge is up, share its port + token so the MCP server can
    // call back for UI-state actions. Bridge starts asynchronously at app
    // boot; if it hasn't bound yet, UI tools just return a "not available"
    // error to the agent, which is acceptable for the first ~50ms of life.
    let context_path = config_dir.join("orion-context.json");
    let mut env_map = serde_json::json!({
        "ORION_DB_PATH": db_path.to_string_lossy(),
        "ORION_CONTEXT_PATH": context_path.to_string_lossy(),
    });
    if let Some(bridge) = crate::ui_bridge::current() {
        env_map["ORION_BRIDGE_PORT"] = serde_json::json!(bridge.port.to_string());
        env_map["ORION_BRIDGE_TOKEN"] = serde_json::json!(bridge.token.clone());
    }

    let mut servers = serde_json::json!({
        "orion": {
            "command": exe.to_string_lossy(),
            "args": ["--mcp-serve"],
            "env": env_map,
        }
    });
    // Merge in the user's Orion-scoped MCP servers (Settings → MCP Servers,
    // persisted to app_state.mcp.servers). Enabled ones only. Failures are
    // swallowed — a malformed entry shouldn't break the whole config.
    if let Some(obj) = servers.as_object_mut() {
        for (name, cfg) in read_user_mcp_servers(&db_path) {
            // Don't let a user server shadow our built-in `orion` server.
            if name == "orion" {
                continue;
            }
            obj.insert(name, cfg);
        }
    }

    let json = serde_json::json!({ "mcpServers": servers });
    std::fs::write(&config_path, json.to_string()).ok()?;
    Some(config_path.to_string_lossy().into_owned())
}

/// Read enabled user-configured MCP servers out of `app_state.mcp.servers`
/// (a JSON array of `{ name, enabled, config }`, persisted by the frontend
/// `mcpServersStore`). Returns (name, claude-config-object) pairs. Best-
/// effort: any read/parse failure yields an empty list so the built-in
/// `orion` server still ships.
fn read_user_mcp_servers(
    db_path: &std::path::Path,
) -> Vec<(String, serde_json::Value)> {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let raw: String = match conn.query_row(
        "SELECT value FROM app_state WHERE key = 'mcp.servers'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let arr = match parsed.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in arr {
        let enabled = entry
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !enabled {
            continue;
        }
        let name = match entry.get("name").and_then(|v| v.as_str()) {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => continue,
        };
        if let Some(cfg) = entry.get("config") {
            out.push((name, cfg.clone()));
        }
    }
    out
}

/// Frontend writes its current context snapshot here (debounced). The MCP
/// server reads the file when `orion_get_context` is called so the agent
/// sees what the user is actually looking at.
#[tauri::command]
pub fn context_snapshot_write(app: AppHandle, json: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&config_dir);
    let path = config_dir.join("orion-context.json");
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}
