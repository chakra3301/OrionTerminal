//! Tab autocomplete — the one surface on the Messages API (locked decision:
//! Haiku 4.5 for ghost-text latency; everything else rides the subscription
//! CLI). Non-streaming single shot, shared keep-alive client, one in-flight
//! request at a time: a newer completion aborts the older server-side.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

use crate::api_key;

const MODEL: &str = "claude-haiku-4-5-20251001";
const API_URL: &str = "https://api.anthropic.com/v1/messages";

static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("reqwest client")
});

static CURRENT: Lazy<Mutex<Option<Arc<Notify>>>> = Lazy::new(|| Mutex::new(None));

const SYSTEM: &str = "You are a code-completion engine inside an editor. Given the text before and after <CURSOR> in a file, output ONLY the text to insert at the cursor. Rules: no explanations, no markdown fences, never repeat text that already appears before or after the cursor. Match the file's indentation, naming, and style exactly. Complete the current statement or small block naturally and stop at a natural boundary (statement end, line end, or a short block — at most ~8 lines). If there is nothing useful to complete, output nothing.";

#[derive(Deserialize)]
pub struct AutocompleteCtx {
    pub path: String,
    pub language: String,
    pub prefix: String,
    pub suffix: String,
    #[serde(default)]
    pub diagnostics: Option<String>,
    #[serde(rename = "recentEdits", default)]
    pub recent_edits: Option<String>,
}

/// Strip one surrounding ``` fence if the model disobeyed. Leading
/// whitespace is meaningful in a completion — only trailing is trimmed.
fn strip_fence(s: &str) -> String {
    let body = s.trim_end();
    let lead = body.trim_start_matches(['\n', '\r']);
    if let Some(rest) = lead.strip_prefix("```") {
        if let Some(nl) = rest.find('\n') {
            let inner = rest[nl + 1..].trim_end_matches(['\n', '\r', ' ']);
            if let Some(stripped) = inner.strip_suffix("```") {
                return stripped.trim_end().to_string();
            }
        }
    }
    body.to_string()
}

#[tauri::command]
pub async fn autocomplete_run(ctx: AutocompleteCtx) -> Result<String, String> {
    let key = match api_key::read()? {
        Some(k) => k,
        // No API key configured — quietly suggest nothing (the feature
        // simply doesn't exist until a key is added in Settings).
        None => return Ok(String::new()),
    };

    let cancel = Arc::new(Notify::new());
    {
        let mut cur = CURRENT.lock();
        if let Some(prev) = cur.take() {
            prev.notify_waiters();
        }
        *cur = Some(cancel.clone());
    }

    let diag = ctx
        .diagnostics
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|d| format!("Nearby diagnostics:\n{}\n\n", d))
        .unwrap_or_default();
    let recent = ctx
        .recent_edits
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|r| format!("{}\n\n", r))
        .unwrap_or_default();
    let user = format!(
        "File: {}\nLanguage: {}\n\n{}{}--- BEFORE CURSOR ---\n{}<CURSOR>\n--- AFTER CURSOR ---\n{}",
        ctx.path, ctx.language, recent, diag, ctx.prefix, ctx.suffix
    );

    let body = serde_json::json!({
        "model": MODEL,
        "max_tokens": 200,
        "temperature": 0,
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": user }],
    });

    let send = CLIENT
        .post(API_URL)
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send();

    let resp = tokio::select! {
        _ = cancel.notified() => return Ok(String::new()),
        r = send => r.map_err(|e| e.to_string())?,
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let brief: String = text.chars().take(300).collect();
        return Err(format!("autocomplete API {}: {}", status, brief));
    }
    let v = tokio::select! {
        _ = cancel.notified() => return Ok(String::new()),
        j = resp.json::<serde_json::Value>() => j.map_err(|e| e.to_string())?,
    };

    {
        let mut cur = CURRENT.lock();
        if cur.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
            *cur = None;
        }
    }

    let text: String = v
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect()
        })
        .unwrap_or_default();
    Ok(strip_fence(&text))
}

#[cfg(test)]
mod tests {
    use super::strip_fence;

    #[test]
    fn passes_clean_completions_through() {
        assert_eq!(strip_fence("  return x;\n"), "  return x;");
        assert_eq!(strip_fence("\n  indented()"), "\n  indented()");
    }

    #[test]
    fn strips_a_disobedient_fence() {
        assert_eq!(strip_fence("```ts\nreturn x;\n```"), "return x;");
        assert_eq!(strip_fence("```\nfoo()\n```\n"), "foo()");
    }

    #[test]
    fn preserves_leading_indentation() {
        assert_eq!(strip_fence("    const a = 1;"), "    const a = 1;");
    }
}
