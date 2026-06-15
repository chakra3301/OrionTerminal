use keyring::Entry;

const SERVICE: &str = "personal-workstation";

fn account(key_ref: &str) -> String {
    format!("provider:{}", key_ref)
}

fn entry(key_ref: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &account(key_ref))
        .map_err(|e| format!("Secret storage unavailable ({})", e))
}

pub fn read(key_ref: &str) -> Option<String> {
    match entry(key_ref) {
        Ok(e) => match e.get_password() {
            Ok(s) if !s.trim().is_empty() => Some(s),
            _ => None,
        },
        Err(_) => None,
    }
}

#[tauri::command]
pub fn provider_key_set(key_ref: String, key: String) -> Result<(), String> {
    if key_ref.trim().is_empty() {
        return Err("key_ref is empty".into());
    }
    if key.trim().is_empty() {
        return Err("api key is empty".into());
    }
    entry(&key_ref)?
        .set_password(key.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn provider_key_clear(key_ref: String) -> Result<(), String> {
    let e = entry(&key_ref)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn provider_key_status(key_ref: String) -> Result<bool, String> {
    Ok(read(&key_ref).is_some())
}
