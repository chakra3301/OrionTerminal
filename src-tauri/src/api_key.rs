use keyring::Entry;
use once_cell::sync::Lazy;
use parking_lot::Mutex;

const SERVICE: &str = "personal-workstation";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| {
        format!(
            "Secret storage unavailable — is your OS keyring running? ({})",
            e
        )
    })
}

pub fn read() -> Result<Option<String>, String> {
    let e = entry()?;
    match e.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn api_key_set(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("api key is empty".into());
    }
    let e = entry()?;
    e.set_password(&key).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn api_key_clear() -> Result<(), String> {
    let e = entry()?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn api_key_status() -> Result<bool, String> {
    Ok(read()?.is_some())
}

// ── GitHub token (optional) ──────────────────────────────────────────────────
// Used by the RepoLens fetchers to raise GitHub's 60 req/h unauthenticated
// limit to 5000 req/h. Stored in the same OS keychain service, separate account.
const GITHUB_ACCOUNT: &str = "github-token";

fn github_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, GITHUB_ACCOUNT).map_err(|e| {
        format!(
            "Secret storage unavailable — is your OS keyring running? ({})",
            e
        )
    })
}

/// Read the stored GitHub token, if any. None when unset or empty.
pub fn github_token() -> Option<String> {
    match github_entry() {
        Ok(e) => match e.get_password() {
            Ok(s) if !s.trim().is_empty() => Some(s),
            _ => None,
        },
        Err(_) => None,
    }
}

#[tauri::command]
pub fn github_token_set(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("github token is empty".into());
    }
    github_entry()?
        .set_password(token.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn github_token_clear() -> Result<(), String> {
    let e = github_entry()?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn github_token_status() -> Result<bool, String> {
    Ok(github_token().is_some())
}

// ── Cursor API key (Control Panel → Cursor SDK provider) ─────────────────────
const CURSOR_ACCOUNT: &str = "cursor-api-key";
const CURSOR_LEGACY_KEY_REF: &str = "builtin:cursor-sdk";

/// Dev builds can write to Keychain but fail an immediate read-back until the
/// user approves access in Keychain Access. Cache the last successful save for
/// this process so status + sends work in-session.
static CURSOR_KEY_CACHE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn cursor_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, CURSOR_ACCOUNT).map_err(|e| {
        format!(
            "Secret storage unavailable — is your OS keyring running? ({})",
            e
        )
    })
}

fn read_cursor_slot() -> Option<String> {
    match cursor_entry() {
        Ok(e) => match e.get_password() {
            Ok(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Err(keyring::Error::NoEntry) => None,
            _ => None,
        },
        Err(_) => None,
    }
}

/// Read the stored Cursor API key. Falls back to the legacy provider-key slot
/// so keys saved before the dedicated account existed still work.
pub fn cursor_api_key() -> Option<String> {
    if let Some(k) = CURSOR_KEY_CACHE.lock().clone() {
        return Some(k);
    }
    read_cursor_slot().or_else(|| crate::provider_keys::read(CURSOR_LEGACY_KEY_REF))
}

#[tauri::command]
pub fn cursor_api_key_set(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("api key is empty".into());
    }
    cursor_entry()?
        .set_password(trimmed)
        .map_err(|err| err.to_string())?;
    *CURSOR_KEY_CACHE.lock() = Some(trimmed.to_string());
    let _ = crate::provider_keys::provider_key_clear(CURSOR_LEGACY_KEY_REF.to_string());
    Ok(())
}

#[tauri::command]
pub fn cursor_api_key_clear() -> Result<(), String> {
    let e = cursor_entry()?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }?;
    *CURSOR_KEY_CACHE.lock() = None;
    let _ = crate::provider_keys::provider_key_clear(CURSOR_LEGACY_KEY_REF.to_string());
    Ok(())
}

#[tauri::command]
pub fn cursor_api_key_status() -> Result<bool, String> {
    Ok(cursor_api_key().is_some())
}
