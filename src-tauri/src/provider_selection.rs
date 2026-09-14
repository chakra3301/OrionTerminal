use rusqlite::Connection;
use serde::Deserialize;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SelectedProvider {
    pub id: String,
    pub kind: String,
    pub model: String,
}

impl SelectedProvider {
    pub fn value(&self) -> String {
        format!("provider:{}/{}", encode_component(&self.id), encode_component(&self.model))
    }
}

fn encode_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn decode_component(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3).ok_or("Invalid model selection encoding")?;
            let hex = std::str::from_utf8(hex).map_err(|_| "Invalid model selection encoding")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "Invalid model selection encoding")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(out).map_err(|_| "Invalid model selection encoding")?;
    if decoded.is_empty() || decoded.chars().any(char::is_control) {
        return Err("Invalid model selection".into());
    }
    Ok(decoded)
}

fn parse(value: &str) -> Result<(Option<String>, String), String> {
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
        return Err("Choose an available provider and model".into());
    }
    let Some(encoded) = value.strip_prefix("provider:") else {
        return Ok((None, value.into()));
    };
    let parts: Vec<_> = encoded.split('/').collect();
    if parts.len() != 2 { return Err("Invalid model selection".into()); }
    Ok((Some(decode_component(parts[0])?), decode_component(parts[1])?))
}

#[derive(Deserialize)]
struct Model { id: String }

pub(crate) fn resolve(conn: &Connection, selection: &str) -> Result<SelectedProvider, String> {
    let (provider_id, model) = parse(selection)?;
    let mut statement = conn.prepare("SELECT id, kind, models_json FROM providers WHERE enabled = 1")
        .map_err(|e| format!("Read providers: {e}"))?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    let mut matches = Vec::new();
    for row in rows {
        let (id, kind, models_json) = row.map_err(|e| e.to_string())?;
        if provider_id.as_ref().is_some_and(|wanted| wanted != &id) { continue; }
        let models: Vec<Model> = serde_json::from_str(&models_json).unwrap_or_default();
        if models.iter().any(|candidate| candidate.id == model) {
            matches.push(SelectedProvider { id, kind, model: model.clone() });
        }
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err("The selected provider/model is unavailable. Enable it or choose another model.".into()),
        _ => Err("This model belongs to multiple providers. Choose its provider explicitly.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE providers (id TEXT, kind TEXT, models_json TEXT, enabled INTEGER);
            INSERT INTO providers VALUES ('subscription', 'codex_cli', '[{\"id\":\"shared\"},{\"id\":\"not-a-gpt-prefix\"}]', 1);
            INSERT INTO providers VALUES ('api', 'openai', '[{\"id\":\"shared\"}]', 1);
            INSERT INTO providers VALUES ('disabled', 'codex_cli', '[{\"id\":\"disabled-model\"}]', 0);").unwrap();
        conn
    }
    #[test]
    fn preserves_provider_identity_and_rejects_ambiguous_legacy_values() {
        let conn = fixture();
        assert!(resolve(&conn, "shared").unwrap_err().contains("multiple"));
        assert_eq!(resolve(&conn, "provider:subscription/shared").unwrap().kind, "codex_cli");
        assert_eq!(resolve(&conn, "provider:api/shared").unwrap().kind, "openai");
        assert_eq!(resolve(&conn, "not-a-gpt-prefix").unwrap().kind, "codex_cli");
    }
    #[test]
    fn rejects_missing_disabled_and_malformed_selections() {
        let conn = fixture();
        for value in ["missing", "disabled-model", "provider:disabled/disabled-model", "provider:api/", "provider:api/%GG", "provider:api/%FF", "provider:a/b/c", "provider:api/%00"] {
            assert!(resolve(&conn, value).is_err(), "{value}");
        }
    }
    #[test]
    fn round_trips_frontend_component_encoding() {
        let selection = SelectedProvider { id: "account:/東京+".into(), kind: "custom".into(), model: "vendor/model v2".into() };
        assert_eq!(parse(&selection.value()).unwrap(), (Some(selection.id), selection.model));
    }
}
