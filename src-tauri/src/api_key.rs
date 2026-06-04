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
