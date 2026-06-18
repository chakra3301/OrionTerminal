//! MCP config writers for the subscription CLI engines. Both serialize the
//! same Orion MCP server (`orion --mcp-serve`) into each CLI's config schema,
//! confirmed live during the Task-0 spike. Pure + unit-tested.

use std::fmt::Write as _;

/// The Orion MCP server definition, decomposed for serialization into each
/// CLI's config schema. Mirrors the `orion` server `mcp_config::write` emits.
#[derive(Debug, Clone)]
pub struct OrionServer {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

fn toml_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Render a Codex `config.toml` body attaching the Orion MCP server.
/// Schema confirmed live: `[mcp_servers.orion]` command/args + nested env table.
pub fn codex_mcp_config(s: &OrionServer) -> String {
    let mut env = s.env.clone();
    env.sort_by(|a, b| a.0.cmp(&b.0));
    let mut out = String::new();
    let _ = writeln!(out, "[mcp_servers.orion]");
    let _ = writeln!(out, "command = \"{}\"", toml_escape(&s.command));
    let args: Vec<String> = s
        .args
        .iter()
        .map(|a| format!("\"{}\"", toml_escape(a)))
        .collect();
    let _ = writeln!(out, "args = [{}]", args.join(", "));
    let _ = writeln!(out);
    let _ = writeln!(out, "[mcp_servers.orion.env]");
    for (k, v) in &env {
        let _ = writeln!(out, "{} = \"{}\"", k, toml_escape(v));
    }
    out
}

/// Render a Gemini `settings.json` body attaching the Orion MCP server with
/// `trust:true` (auto-approve its tool calls) and excluding the native edit
/// tools so writes route through the Orion MCP edit tools (§6 parity).
pub fn gemini_mcp_config(s: &OrionServer) -> String {
    let env: serde_json::Map<String, serde_json::Value> = s
        .env
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
        .collect();
    let v = serde_json::json!({
        "mcpServers": {
            "orion": {
                "command": s.command,
                "args": s.args,
                "env": env,
                "trust": true,
            }
        },
        "excludeTools": ["write_file", "replace", "edit"],
    });
    serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into())
}

#[cfg(test)]
mod codex_config_tests {
    use super::*;
    fn sample() -> OrionServer {
        OrionServer {
            command: "/Apps/Orion.app/Contents/MacOS/orion".into(),
            args: vec!["--mcp-serve".into()],
            env: vec![
                ("ORION_DB_PATH".into(), "/x/orion.db".into()),
                ("ORION_BRIDGE_PORT".into(), "7777".into()),
            ],
        }
    }
    #[test]
    fn writes_codex_toml_with_sorted_env() {
        let t = codex_mcp_config(&sample());
        assert!(t.contains("[mcp_servers.orion]"));
        assert!(t.contains("command = \"/Apps/Orion.app/Contents/MacOS/orion\""));
        assert!(t.contains("args = [\"--mcp-serve\"]"));
        assert!(t.contains("[mcp_servers.orion.env]"));
        // sorted: BRIDGE_PORT before DB_PATH
        let bp = t.find("ORION_BRIDGE_PORT").unwrap();
        let db = t.find("ORION_DB_PATH").unwrap();
        assert!(bp < db);
    }
    #[test]
    fn escapes_quotes_and_backslashes() {
        let mut s = sample();
        s.command = "/weird\"path".into();
        assert!(codex_mcp_config(&s).contains("command = \"/weird\\\"path\""));
    }
}

#[cfg(test)]
mod gemini_config_tests {
    use super::*;
    #[test]
    fn writes_gemini_settings_json() {
        let s = OrionServer {
            command: "/orion".into(),
            args: vec!["--mcp-serve".into()],
            env: vec![("ORION_DB_PATH".into(), "/x/orion.db".into())],
        };
        let json = gemini_mcp_config(&s);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["mcpServers"]["orion"]["command"], "/orion");
        assert_eq!(v["mcpServers"]["orion"]["args"][0], "--mcp-serve");
        assert_eq!(v["mcpServers"]["orion"]["trust"], true);
        assert_eq!(v["mcpServers"]["orion"]["env"]["ORION_DB_PATH"], "/x/orion.db");
        let ex = v["excludeTools"].as_array().unwrap();
        assert!(ex.iter().any(|t| t == "write_file"));
        assert!(ex.iter().any(|t| t == "replace"));
    }
}
