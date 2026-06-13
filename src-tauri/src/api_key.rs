use keyring::Entry;

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
