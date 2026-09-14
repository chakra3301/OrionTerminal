//! MCP config writers for the subscription CLI engines. Both serialize the
//! same Orion MCP server (`orion --mcp-serve`) into each CLI's config schema,
//! confirmed live during the Task-0 spike. Pure + unit-tested.

/// The Orion MCP server definition, decomposed for serialization into each
/// CLI's config schema. Mirrors the `orion` server `mcp_config::write` emits.
#[derive(Debug, Clone)]
pub struct OrionServer {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Render a Gemini `settings.json` body attaching the Orion MCP server with
/// `trust:true` (auto-approve its tool calls) and excluding the native edit
/// tools so writes route through the Orion MCP edit tools (§6 parity).
pub fn gemini_mcp_config(s: &OrionServer, tools: Option<&[String]>) -> String {
    let env: serde_json::Map<String, serde_json::Value> = s
        .env
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
        .collect();
    let mut v = serde_json::json!({
        "mcpServers": {
            "orion": {
                "command": s.command,
                "args": s.args,
                "env": env,
                "trust": true,
            }
        },
        "tools": { "exclude": ["write_file", "replace", "edit"] },
        "mcp": { "allowed": ["orion"] },
        "security": { "auth": { "selectedType": "oauth-personal", "enforcedType": "oauth-personal", "useExternal": false } },
    });
    if let Some(tools) = tools {
        let core: Vec<&str> = tools.iter().filter_map(|tool| match tool.as_str() {
            "Bash" => Some("run_shell_command"),
            "WebSearch" => Some("google_web_search"),
            "WebFetch" => Some("web_fetch"),
            _ => None,
        }).collect();
        v["tools"]["core"] = serde_json::json!(core);
        v["hooksConfig"] = serde_json::json!({"enabled": false});
    }
    serde_json::to_string_pretty(&v).expect("JSON values serialize")
}

#[cfg(test)]
mod gemini_config_tests {
    use super::*;
    #[test]
    fn restricted_gemini_uses_an_explicit_core_allowlist_and_one_mcp_server() {
        let server = OrionServer { command: "/orion".into(), args: vec![], env: vec![] };
        let empty: serde_json::Value = serde_json::from_str(&gemini_mcp_config(&server, Some(&[]))).unwrap();
        assert_eq!(empty["tools"]["core"], serde_json::json!([]));
        assert_eq!(empty["mcp"]["allowed"], serde_json::json!(["orion"]));
        assert_eq!(empty["hooksConfig"]["enabled"], false);
        let tools = vec!["Read".into(), "Edit".into(), "Bash".into()];
        let restricted: serde_json::Value = serde_json::from_str(&gemini_mcp_config(&server, Some(&tools))).unwrap();
        assert_eq!(restricted["tools"]["core"], serde_json::json!(["run_shell_command"]));
    }
    #[test]
    fn writes_gemini_settings_json() {
        let s = OrionServer {
            command: "/orion".into(),
            args: vec!["--mcp-serve".into()],
            env: vec![("ORION_DB_PATH".into(), "/x/orion.db".into())],
        };
        let json = gemini_mcp_config(&s, None);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["mcpServers"]["orion"]["command"], "/orion");
        assert_eq!(v["mcpServers"]["orion"]["args"][0], "--mcp-serve");
        assert_eq!(v["mcpServers"]["orion"]["trust"], true);
        assert_eq!(v["security"]["auth"]["selectedType"], "oauth-personal");
        assert_eq!(v["security"]["auth"]["enforcedType"], "oauth-personal");
        assert_eq!(v["security"]["auth"]["useExternal"], false);
        assert_eq!(v["mcpServers"]["orion"]["env"]["ORION_DB_PATH"], "/x/orion.db");
        let ex = v["tools"]["exclude"].as_array().unwrap();
        assert!(ex.iter().any(|t| t == "write_file"));
        assert!(ex.iter().any(|t| t == "replace"));
    }
}
