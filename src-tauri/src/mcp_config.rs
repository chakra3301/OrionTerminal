//! Writes the per-launch MCP config file that tells `claude-code` how to
//! reach our in-process MCP server (mode-switched `orion-terminal --mcp-serve`).
//! Both `terminal_open_claude` (Claude Code tab) and `claude_send` (chat
//! rails + Core) call this so every claude subprocess shares the same
//! Orion-aware tool surface.

use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(crate) fn write_private(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("orion-mcp.json");
    let tmp = path.with_file_name(format!(".{file_name}.{}.tmp", ulid::Ulid::new()));

    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

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
    write_private(&config_path, json.to_string().as_bytes()).ok()?;
    Some(config_path.to_string_lossy().into_owned())
}

/// Read enabled user-configured MCP servers out of `app_state.mcp.servers`
/// (a JSON array of `{ name, enabled, config }`, persisted by the frontend
/// `mcpServersStore`). Returns (name, claude-config-object) pairs. Best-
/// effort: any read/parse failure yields an empty list so the built-in
/// `orion` server still ships.
fn read_user_mcp_servers(db_path: &std::path::Path) -> Vec<(String, serde_json::Value)> {
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

/// Decompose the Orion MCP server into command/args/env for the CLI-engine
/// config writers (Phase 2c). Mirrors the `orion` server `write()` emits.
/// Returns None if the current exe / config dir can't be resolved.
pub fn orion_server(app: &AppHandle) -> Option<crate::cli_engine::config::OrionServer> {
    let exe = std::env::current_exe().ok()?;
    let config_dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&config_dir);
    let db_path = config_dir.join("orion.db");
    let context_path = config_dir.join("orion-context.json");
    let mut env: Vec<(String, String)> = vec![
        (
            "ORION_DB_PATH".into(),
            db_path.to_string_lossy().into_owned(),
        ),
        (
            "ORION_CONTEXT_PATH".into(),
            context_path.to_string_lossy().into_owned(),
        ),
    ];
    if let Some(bridge) = crate::ui_bridge::current() {
        env.push(("ORION_BRIDGE_PORT".into(), bridge.port.to_string()));
        env.push(("ORION_BRIDGE_TOKEN".into(), bridge.token.clone()));
    }
    Some(crate::cli_engine::config::OrionServer {
        command: exe.to_string_lossy().into_owned(),
        args: vec!["--mcp-serve".into()],
        env,
    })
}

#[derive(Debug, Clone)]
pub struct ScopedConfig(std::sync::Arc<ConfigFile>);

#[derive(Debug)]
struct ConfigFile(std::path::PathBuf);

impl Drop for ConfigFile {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

impl ScopedConfig {
    pub fn write(dir: &Path, prefix: &str, contents: &[u8]) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{prefix}-{}.json", ulid::Ulid::new()));
        write_private(&path, contents).map_err(|e| e.to_string())?;
        Ok(Self(std::sync::Arc::new(ConfigFile(path))))
    }
    pub fn path(&self) -> &Path { &self.0.0 }
}

pub fn scoped_server(app: &AppHandle, tools: Option<&[String]>, ui_run_id: Option<&str>) -> Result<crate::cli_engine::config::OrionServer, String> {
    crate::ui_bridge::validate_run_id(ui_run_id)?;
    let tools = crate::mcp_grants::normalized(tools)?;
    let mut server = orion_server(app).ok_or("Orion MCP bridge is unavailable. Restart the app before sending.")?;
    server.env.push((crate::mcp_grants::ENV_KEY.into(), serde_json::to_string(&tools).map_err(|e| e.to_string())?));
    if let Some(id) = ui_run_id {
        server.env.push(("ORION_UI_RUN_ID".into(), id.into()));
    }
    Ok(server)
}

pub fn write_scoped(app: &AppHandle, tools: Option<&[String]>, ui_run_id: Option<&str>) -> Result<ScopedConfig, String> {
    let server = scoped_server(app, tools, ui_run_id)?;
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let env: serde_json::Map<String, serde_json::Value> = server.env.into_iter()
        .map(|(k, v)| (k, serde_json::Value::String(v))).collect();
    let mut servers = serde_json::Map::new();
    servers.insert("orion".into(), serde_json::json!({"command": server.command, "args": server.args, "env": env}));
    for (name, config) in read_user_mcp_servers(&config_dir.join("orion.db")) {
        let prefix = format!("mcp__{name}");
        if name != "orion" && tools.is_none_or(|ts| ts.iter().any(|t| t == &prefix || t.starts_with(&format!("{prefix}__")))) {
            servers.insert(name, config);
        }
    }
    ScopedConfig::write(&config_dir, "orion-mcp", serde_json::json!({"mcpServers": servers}).to_string().as_bytes())
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

#[cfg(test)]
mod tests {
    use super::{write_private, ScopedConfig};

    #[test]
    fn scoped_configs_are_unique_and_removed_only_after_the_last_owner() {
        let dir = std::env::temp_dir().join(format!("orion-scoped-test-{}", ulid::Ulid::new()));
        let first = ScopedConfig::write(&dir, "settings", b"one").unwrap();
        let second = ScopedConfig::write(&dir, "settings", b"two").unwrap();
        assert_ne!(first.path(), second.path());
        let path = first.path().to_path_buf();
        let copy = first.clone();
        drop(first);
        assert_eq!(std::fs::read(&path).unwrap(), b"one");
        drop(copy);
        assert!(!path.exists());
        drop(second);
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn private_write_replaces_contents() {
        let dir = std::env::temp_dir().join(format!("orion-mcp-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");

        write_private(&path, b"first").unwrap();
        write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        std::fs::remove_dir_all(dir).unwrap();
    }
}
