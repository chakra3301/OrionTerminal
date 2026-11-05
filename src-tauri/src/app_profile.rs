//! Which product this process is: Orion Terminal, or a standalone app built
//! from the same crate (Archives 47). The profile decides the database file,
//! the keychain service and the name used in user-facing messages, so two
//! products never share data or credentials. Set once at startup; anything
//! that reads it before then gets Orion.

use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    /// SQLite file inside the app config dir.
    pub db_file: &'static str,
    /// Keychain service for API keys and OAuth tokens.
    pub keychain_service: String,
    /// Short name for messages ("Orion", "Archives 47").
    pub short_name: &'static str,
    /// Full product name ("Orion Terminal", "Archives 47").
    pub product_name: &'static str,
    /// Prefix of startup database backups (`<prefix>-<stamp>-<ulid>.db`).
    pub backup_prefix: &'static str,
    /// When set, the MCP server only offers this app's tools.
    pub mcp_app: Option<&'static str>,
}

pub fn orion() -> Profile {
    Profile {
        db_file: "orion.db",
        keychain_service: "personal-workstation".into(),
        short_name: "Orion",
        product_name: "Orion Terminal",
        backup_prefix: "orion",
        mcp_app: None,
    }
}

/// `identifier` keeps a dev build's keychain items apart from the installed app's.
pub fn archives(identifier: &str) -> Profile {
    Profile {
        db_file: "archives.db",
        keychain_service: identifier.to_string(),
        short_name: "Archives 47",
        product_name: "Archives 47",
        backup_prefix: "archives",
        mcp_app: Some("archives"),
    }
}

static PROFILE: OnceLock<Profile> = OnceLock::new();

pub fn set(profile: Profile) -> Result<(), String> {
    PROFILE.set(profile).map_err(|_| "App profile already set".to_string())
}

pub fn current() -> Profile {
    PROFILE.get().cloned().unwrap_or_else(orion)
}

pub fn db_file() -> &'static str {
    PROFILE.get().map(|p| p.db_file).unwrap_or("orion.db")
}

pub fn sqlite_url() -> String {
    format!("sqlite:{}", db_file())
}

pub fn keychain_service() -> String {
    PROFILE
        .get()
        .map(|p| p.keychain_service.clone())
        .unwrap_or_else(|| orion().keychain_service)
}

pub fn short_name() -> &'static str {
    PROFILE.get().map(|p| p.short_name).unwrap_or("Orion")
}

pub fn product_name() -> &'static str {
    PROFILE.get().map(|p| p.product_name).unwrap_or("Orion Terminal")
}

pub fn db_path_in(config_dir: &std::path::Path) -> PathBuf {
    config_dir.join(db_file())
}

pub fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(db_path_in(&app.path().app_config_dir().map_err(|e| e.to_string())?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orion_profile_keeps_the_shipped_names() {
        let p = orion();
        assert_eq!(p.db_file, "orion.db");
        assert_eq!(p.keychain_service, "personal-workstation");
        assert_eq!(p.backup_prefix, "orion");
        assert_eq!(p.mcp_app, None);
    }

    #[test]
    fn archives_profile_shares_nothing_with_orion() {
        let o = orion();
        let a = archives("com.lucaorion.archives47");
        assert_eq!(a.db_file, "archives.db");
        assert_ne!(a.db_file, o.db_file);
        assert_ne!(a.keychain_service, o.keychain_service);
        assert_eq!(a.keychain_service, "com.lucaorion.archives47");
        assert_ne!(a.backup_prefix, o.backup_prefix);
        assert_eq!(a.mcp_app, Some("archives"));
        assert!(!a.product_name.contains("Orion"));
        assert_ne!(
            archives("com.lucaorion.archives47.dev").keychain_service,
            a.keychain_service,
            "dev builds keep their own keychain items"
        );
    }

    #[test]
    fn unset_profile_reads_as_orion() {
        // Tests never call `set`, so every accessor must fall back to Orion.
        assert_eq!(db_file(), "orion.db");
        assert_eq!(sqlite_url(), "sqlite:orion.db");
        assert_eq!(keychain_service(), "personal-workstation");
        assert_eq!(short_name(), "Orion");
        assert_eq!(product_name(), "Orion Terminal");
        assert_eq!(
            db_path_in(std::path::Path::new("/x")),
            std::path::PathBuf::from("/x/orion.db")
        );
    }
}
