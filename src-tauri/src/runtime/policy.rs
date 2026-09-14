use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use super::{provider::ToolCall, tools::ToolDef};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RuntimeConfig {
    pub kind: String,
    pub key_ref: String,
    pub endpoint: String,
}

pub(super) fn load(app: &AppHandle, provider_id: &str, model: &str) -> Result<RuntimeConfig, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("orion.db");
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "Cannot read the saved provider configuration")?;
    conn.busy_timeout(std::time::Duration::from_secs(1)).map_err(|e| e.to_string())?;
    resolve(&conn, provider_id, model)
}

#[derive(Deserialize)]
struct Model { id: String }

fn resolve(conn: &Connection, provider_id: &str, model: &str) -> Result<RuntimeConfig, String> {
    if provider_id.is_empty() || provider_id.len() > 512 || model.is_empty() || model.len() > 512
        || provider_id.chars().chain(model.chars()).any(char::is_control) {
        return Err("Invalid provider/model selection".into());
    }
    let row = conn.query_row(
        "SELECT kind, base_url, key_ref, models_json FROM providers WHERE id = ?1 AND enabled = 1",
        [provider_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
    ).optional().map_err(|_| "Cannot read the saved provider configuration")?
        .ok_or("The selected provider is unavailable or disabled")?;
    let (kind, base, key_ref, models_json) = row;
    if models_json.len() > 1_000_000 { return Err("Provider model catalog is too large".into()); }
    let models: Vec<Model> = serde_json::from_str(&models_json).map_err(|_| "Invalid provider model catalog")?;
    if !models.iter().any(|m| m.id == model) { return Err("The selected model is not configured for this provider".into()); }
    Ok(RuntimeConfig { endpoint: endpoint(&kind, &base, model)?, kind, key_ref })
}

fn endpoint(kind: &str, base: &str, model: &str) -> Result<String, String> {
    let default = match kind {
        "openai" => "https://api.openai.com/v1",
        "google" => "https://generativelanguage.googleapis.com/v1beta",
        "nous_oauth" => "https://inference-api.nousresearch.com/v1",
        "openai_compat" | "custom" => "",
        _ => return Err("This provider requires its own connector, not the HTTP runtime".into()),
    };
    let base = if base.trim().is_empty() { default } else { base.trim() };
    let url = reqwest::Url::parse(base).map_err(|_| "Configure a valid provider URL")?;
    let host = url.host_str().unwrap_or_default();
    let loopback = host == "localhost" || host.trim_start_matches('[').trim_end_matches(']')
        .parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || !(url.scheme() == "https" || (url.scheme() == "http" && loopback)) {
        return Err("Provider URLs require HTTPS (HTTP is allowed only for loopback servers), without embedded credentials, query or fragment".into());
    }
    if kind == "nous_oauth" && url.as_str().trim_end_matches('/') != default {
        return Err("Nous subscription credentials can only be sent to the fixed Nous inference endpoint".into());
    }
    if kind == "google" && (model.contains(['/', '\\', '?', '#', '%']) || model == "." || model == "..") {
        return Err("Google model ID must be a model name, not a URL or path".into());
    }
    Ok(super::provider::make_provider(kind).endpoint(url.as_str(), model))
}

pub(super) fn dispatch_authorized(
    call: &ToolCall,
    granted: &[ToolDef],
    dispatch: impl FnOnce(&str, &Value) -> Result<String, String>,
) -> Result<String, String> {
    if !granted.iter().any(|t| t.name == call.name) {
        return Err("Tool is not authorized for this turn".into());
    }
    if call.arguments.len() > 524_288 { return Err("Tool arguments exceed the size limit".into()); }
    let args: Value = serde_json::from_str(&call.arguments).map_err(|_| "Tool arguments must be valid JSON")?;
    if !args.is_object() { return Err("Tool arguments must be a JSON object".into()); }
    dispatch(&call.name, &args)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE providers(id TEXT,kind TEXT,base_url TEXT,key_ref TEXT,models_json TEXT,enabled INTEGER);
          INSERT INTO providers VALUES('account','openai','https://api.openai.com/v1','owned-key','[{\"id\":\"model\"}]',1);
          INSERT INTO providers VALUES('other','custom','http://127.0.0.1:9999/v1','other-key','[{\"id\":\"model\"}]',1);").unwrap();
        db
    }
    #[test]
    fn provider_identity_selects_the_stored_endpoint_and_key() {
        let db = fixture();
        let a = resolve(&db, "account", "model").unwrap();
        assert_eq!(a.key_ref, "owned-key");
        assert_eq!(a.endpoint, "https://api.openai.com/v1/chat/completions");
        assert_eq!(resolve(&db, "other", "model").unwrap().key_ref, "other-key");
        assert!(resolve(&db, "account", "unknown").is_err());
        db.execute("UPDATE providers SET enabled=0 WHERE id='account'", []).unwrap();
        assert!(resolve(&db, "account", "model").is_err());
    }
    #[test]
    fn configuration_change_invalidates_a_running_snapshot() {
        let db = fixture(); let initial = resolve(&db, "account", "model").unwrap();
        db.execute("UPDATE providers SET key_ref='replacement' WHERE id='account'", []).unwrap();
        assert_ne!(initial, resolve(&db, "account", "model").unwrap());
    }
    #[test]
    fn rejects_unsafe_urls_and_wrong_connector_families() {
        for base in ["https://user:secret@example.com", "https://example.com?key=secret", "https://example.com#x", "http://example.com", "file:///tmp/model"] {
            assert!(endpoint("custom", base, "model").is_err(), "{base}");
        }
        assert!(endpoint("custom", "http://[::1]:1234/v1", "model").is_ok());
        assert!(endpoint("custom", "http://localhost:1234/v1", "model").is_ok());
        for kind in ["anthropic", "cursor_sdk", "codex_cli", "gemini_cli", "unknown"] {
            assert!(endpoint(kind, "", "model").is_err());
        }
        assert!(endpoint("google", "", "../escape?x").is_err());
        assert!(endpoint("nous_oauth", "https://example.com/v1", "model").is_err());
        assert!(endpoint("nous_oauth", "", "model").is_ok());
    }
    #[test]
    fn denied_and_malformed_calls_never_reach_the_dispatcher() {
        let tool = ToolDef { name: "orion_read_file".into(), description: String::new(), parameters: serde_json::json!({}) };
        for (name, arguments) in [("orion_write_file", "{}"), ("mcp__orion", "{}"), ("orion_read_file", "[]"), ("orion_read_file", "not-json")] {
            let call = ToolCall { id: "test".into(), name: name.into(), arguments: arguments.into() };
            assert!(dispatch_authorized(&call, &[tool.clone()], |_, _| panic!("unauthorized dispatch")).is_err());
        }
        let call = ToolCall { id: "test".into(), name: "orion_read_file".into(), arguments: "{}".into() };
        assert!(dispatch_authorized(&call, &[], |_, _| panic!("tool-less dispatch")).is_err());
        assert_eq!(dispatch_authorized(&call, &[tool], |name, _| Ok(name.into())).unwrap(), "orion_read_file");
    }
}
