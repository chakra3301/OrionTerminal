use super::private_dir;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::process::Command;

static LIVE: Lazy<Mutex<BTreeSet<PathBuf>>> = Lazy::new(|| Mutex::new(BTreeSet::new()));
#[derive(Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Browser {
    Chrome,
    Chromium,
    Brave,
    Edge,
    Firefox,
    Opera,
    Vivaldi,
    Safari,
}
impl Browser {
    fn name(&self) -> &'static str {
        match self {
            Self::Chrome => "chrome",
            Self::Chromium => "chromium",
            Self::Brave => "brave",
            Self::Edge => "edge",
            Self::Firefox => "firefox",
            Self::Opera => "opera",
            Self::Vivaldi => "vivaldi",
            Self::Safari => "safari",
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieChoice {
    browser: Browser,
    profile: Option<String>,
}
impl CookieChoice {
    fn validate(&self) -> Result<(), String> {
        if let Some(p) = &self.profile {
            if p.is_empty()
                || p.len() > 64
                || p.trim() != p
                || p == "."
                || p == ".."
                || p.contains("..")
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b" ._-".contains(&b))
            {
                return Err("Use a browser profile’s folder name, not a path, cookie file or CLI expression.".into());
            }
        }
        match &self.browser {
            Browser::Opera if self.profile.is_some() => {
                Err("Opera uses its standard cookie store; a profile name is not supported.".into())
            }
            Browser::Safari
                if self
                    .profile
                    .as_deref()
                    .is_some_and(|p| p != "system" && p != "container") =>
            {
                Err("Choose Safari’s system or container cookie store.".into())
            }
            _ => Ok(()),
        }
    }
    fn label(&self) -> String {
        format!(
            "{} · {}",
            self.browser.name(),
            self.profile.as_deref().unwrap_or(match self.browser {
                Browser::Firefox => "most recently modified cookie database",
                Browser::Safari => "system cookie store",
                Browser::Opera => "standard store",
                _ => "Default",
            })
        )
    }
    fn argument(&self, home: &Path) -> Result<String, String> {
        self.validate()?;
        let base = home.join("Library/Application Support");
        let path = match &self.browser {
            Browser::Firefox => {
                let root = base.join("Firefox/Profiles");
                self.profile.as_ref().map(|p| root.join(p)).unwrap_or(root)
            }
            Browser::Safari => home.join(if self.profile.as_deref() == Some("container") {
                "Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"
            } else {
                "Library/Cookies/Cookies.binarycookies"
            }),
            Browser::Opera => base.join("com.operasoftware.Opera"),
            browser => base
                .join(match browser {
                    Browser::Chrome => "Google/Chrome",
                    Browser::Chromium => "Chromium",
                    Browser::Brave => "BraveSoftware/Brave-Browser",
                    Browser::Edge => "Microsoft Edge",
                    Browser::Vivaldi => "Vivaldi",
                    _ => unreachable!(),
                })
                .join(self.profile.as_deref().unwrap_or("Default")),
        };
        Ok(format!(
            "{}:{}",
            self.browser.name(),
            path.to_string_lossy()
        ))
    }
}

struct Lease(fs::File);
impl Drop for Lease {
    fn drop(&mut self) {
        // Other concurrent spawns may briefly inherit the descriptor before exec.
        let _ = self.0.unlock();
    }
}
pub(super) struct Access {
    argument: String,
    dir: PathBuf,
    _lease: Lease,
}
impl Access {
    pub(super) fn apply(&self, command: &mut Command) {
        command
            .env("TMPDIR", &self.dir)
            .args(["--cookies-from-browser", &self.argument]);
    }
    pub(super) fn check_size(&self) -> Result<(), String> {
        let mut total = 0u64;
        for (i, entry) in walkdir::WalkDir::new(&self.dir)
            .follow_links(false)
            .into_iter()
            .enumerate()
        {
            let entry = entry.map_err(|_| "Cannot check temporary browser-cookie files.")?;
            if i >= 128
                || entry.depth() > 3
                || (!entry.file_type().is_dir() && !entry.file_type().is_file())
            {
                return Err("Unexpected temporary browser-cookie files.".into());
            }
            let m = entry
                .metadata()
                .map_err(|_| "Cannot check temporary browser-cookie files.")?;
            total = total.saturating_add(if m.is_file() { m.len() } else { 0 });
            if total > 64 * 1024 * 1024 {
                return Err("Temporary browser-cookie files exceeded 64 MiB.".into());
            }
        }
        Ok(())
    }
}
impl Drop for Access {
    fn drop(&mut self) {
        let mut live = LIVE.lock();
        if fs::remove_dir_all(&self.dir).is_err() {
            eprintln!("Temporary browser-cookie cleanup needs attention; idle Downloads will retry cleanup.");
        }
        live.remove(&self.dir);
    }
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("media-download-auth"))
}
fn secure_dir(path: &Path) -> Result<(), String> {
    private_dir(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions()
            .mode()
            & 0o077
            != 0
        {
            return Err("Temporary browser-cookie storage must be private to this user.".into());
        }
    }
    Ok(())
}
#[cfg(unix)]
fn lease(root: &Path) -> Result<Option<Lease>, String> {
    use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
    unsafe extern "C" {
        fn flock(fd: std::os::raw::c_int, operation: std::os::raw::c_int) -> std::os::raw::c_int;
    }
    #[cfg(target_os = "macos")]
    const NOFOLLOW: i32 = 0x100;
    #[cfg(not(target_os = "macos"))]
    const NOFOLLOW: i32 = 0x20000;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(NOFOLLOW)
        .open(root.join(".lease"))
        .map_err(|_| "Cannot open the browser-cookie storage lease.")?;
    let meta = file
        .metadata()
        .map_err(|_| "Cannot check the browser-cookie storage lease.")?;
    if !meta.is_file() || meta.len() != 0 {
        return Err("Unexpected browser-cookie storage lease.".into());
    }
    if unsafe { flock(file.as_raw_fd(), 2 | 4) } != 0 {
        if std::io::Error::last_os_error().kind() == std::io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        return Err("Cannot lock temporary browser-cookie storage.".into());
    }
    Ok(Some(Lease(file)))
}
#[cfg(not(unix))]
fn lease(_: &Path) -> Result<Option<Lease>, String> {
    Err("Browser-cookie storage leases are unsupported on this platform.".into())
}
fn stage(root: &Path, argument: String) -> Result<Access, String> {
    super::private_dir(root.parent().ok_or("Missing private scratch parent.")?)?;
    secure_dir(root)?;
    let lease=lease(root)?.ok_or("Another browser-cookie operation is already using this profile. Finish it before approving a new one.")?;
    cleanup_leased(root)?;
    let mut live = LIVE.lock();
    let dir = root.join(ulid::Ulid::new().to_string());
    secure_dir(&dir)?;
    live.insert(dir.clone());
    Ok(Access {
        argument,
        dir,
        _lease: lease,
    })
}
fn permit(root: &Path, argument: String, confirm: impl FnOnce() -> bool) -> Result<Access, String> {
    if !confirm() {
        return Err("Browser access canceled. No operation was started.".into());
    }
    stage(root, argument)
}
#[cfg(test)]
pub(super) fn synthetic_access(root: &Path) -> Access {
    stage(root, "chrome:/synthetic/browser/Default".into()).unwrap()
}
#[cfg(test)]
pub(super) fn remove_fixture(root: &Path) {
    fs::remove_dir_all(root).unwrap();
}
fn cleanup(root: &Path) -> Result<(), String> {
    if !root
        .try_exists()
        .map_err(|_| "Cannot check browser-cookie scratch storage.")?
    {
        return Ok(());
    }
    secure_dir(root)?;
    let Some(_lease) = lease(root)? else {
        return Ok(());
    };
    cleanup_leased(root)
}
fn cleanup_leased(root: &Path) -> Result<(), String> {
    let live = LIVE.lock();
    let mut stale = Vec::new();
    for (i, e) in fs::read_dir(root)
        .map_err(|_| "Cannot read browser-cookie scratch storage.")?
        .enumerate()
    {
        if i >= 128 {
            return Err(
                "Too many temporary browser-cookie directories; review scratch storage locally."
                    .into(),
            );
        }
        let e = e.map_err(|_| "Cannot read browser-cookie scratch storage.")?;
        if e.file_name() == ".lease" {
            continue;
        }
        super::id_check(&e.file_name().to_string_lossy())?;
        let m = fs::symlink_metadata(e.path())
            .map_err(|_| "Cannot check browser-cookie scratch storage.")?;
        if !m.is_dir() || m.is_symlink() {
            return Err("Unexpected browser-cookie scratch entry. Nothing was followed.".into());
        }
        if !live.contains(&e.path()) {
            stale.push(e.path());
        }
    }
    for path in stale {
        fs::remove_dir_all(path).map_err(|_| {
            "Temporary browser-cookie cleanup failed. Retry Downloads before using cookies again."
        })?;
    }
    Ok(())
}
pub(super) fn cleanup_orphans(app: &AppHandle) -> Result<(), String> {
    cleanup(&root(app)?)
}
pub(super) async fn authorize(
    app: &AppHandle,
    id: &str,
    source: &str,
    choice: Option<CookieChoice>,
    operation: &str,
) -> Result<Option<Access>, String> {
    let Some(choice) = choice else {
        return Ok(None);
    };
    choice.validate()?;
    if !cfg!(target_os = "macos") {
        return Err("Browser-cookie access is currently implemented for macOS.".into());
    }
    let url = super::policy::url(source)?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Cannot locate the selected browser’s home directory.")?;
    let argument = choice.argument(&home)?;
    let prompt=format!("Allow {} for this {} only?\n\nSource: {}\nJob: {}\n\nThe external yt-dlp engine reads this browser profile’s cookie jar, potentially including other sites, and sends matching cookies for the source and its redirects. Your browser vault/keychain may ask for access.\n\nIt may copy the cookie database into private temporary storage (sampled 64 MiB limit). Orion removes this after the operation; after an abnormal crash, idle Downloads retries cleanup. No cookie values or browser choice are saved in Orion settings/history or model prompts. Retry requires new approval.",choice.label(),operation,url.as_str(),id);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        permit(&root, argument, || {
            app.dialog()
                .message(prompt)
                .title("Browser cookies · one-operation permission")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Allow once".into(),
                    "Cancel".into(),
                ))
                .blocking_show()
        })
        .map(Some)
    })
    .await
    .map_err(|_| "Browser permission could not be confirmed.")?
}
pub(super) async fn budget(access: Option<&Access>) -> Result<(), String> {
    let Some(access) = access else {
        return std::future::pending().await;
    };
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        access.check_size()?;
    }
}
pub(super) fn redact<T>(
    result: Result<T, String>,
    authenticated: bool,
    canceled: bool,
) -> Result<T, String> {
    if !authenticated || result.is_ok() {
        return result;
    }
    if canceled {
        return Err("Stopped. Temporary cookie cleanup runs after the engine exits.".into());
    }
    Err("Authenticated operation failed. Check the selected browser/profile, source access and engines, then approve a fresh retry. Credential diagnostics were not saved.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_and_profile_are_fixed_choices_not_arbitrary_cli_or_file_paths() {
        for p in [
            "../secret",
            "/private/cookies",
            "Default::container",
            "Default+keyring",
            "--exec=bad",
            "a\\b",
            ".",
            "..",
            "",
        ] {
            let c = CookieChoice {
                browser: Browser::Chrome,
                profile: Some(p.into()),
            };
            assert!(c.validate().is_err(), "{p}");
        }
        assert!(
            serde_json::from_str::<CookieChoice>(r#"{"browser":"--exec","profile":null}"#).is_err()
        );
        assert!(serde_json::from_str::<CookieChoice>(
            r#"{"browser":"chrome","cookieFile":"secret"}"#
        )
        .is_err());
        let c = CookieChoice {
            browser: Browser::Chrome,
            profile: Some("Profile 2".into()),
        };
        assert_eq!(
            c.argument(Path::new("/synthetic/user")).unwrap(),
            "chrome:/synthetic/user/Library/Application Support/Google/Chrome/Profile 2"
        );
    }
    #[test]
    fn cookie_arguments_do_not_restore_ambient_home_or_write_a_cookie_export() {
        let root = std::env::temp_dir().join(format!("orion-auth-args-{}", ulid::Ulid::new()));
        let access = stage(&root, "chrome:/synthetic/browser/Default".into()).unwrap();
        let mut c = Command::new("/synthetic/yt-dlp");
        c.env("HOME", "/synthetic/private-job");
        access.apply(&mut c);
        let args: Vec<_> = c
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "--cookies-from-browser",
                "chrome:/synthetic/browser/Default"
            ]
        );
        assert!(
            c.as_std()
                .get_envs()
                .any(|(k, v)| k == "HOME"
                    && v == Some(std::ffi::OsStr::new("/synthetic/private-job")))
        );
        let dir = access.dir.clone();
        drop(access);
        assert!(!dir.exists());
        remove_fixture(&root);
    }
    #[test]
    fn scratch_cleanup_removes_orphans_but_never_active_authorization() {
        let root = std::env::temp_dir().join(format!("orion-auth-cleanup-{}", ulid::Ulid::new()));
        let access = stage(&root, "firefox:/synthetic/browser".into()).unwrap();
        let stale = root.join(ulid::Ulid::new().to_string());
        secure_dir(&stale).unwrap();
        fs::write(stale.join("synthetic-cookie-db"), b"synthetic only").unwrap();
        cleanup(&root).unwrap();
        assert!(stale.exists());
        assert!(access.dir.exists());
        assert!(stage(&root, "chrome:/synthetic/other".into()).is_err());
        drop(access);
        cleanup(&root).unwrap();
        assert!(!stale.exists());
        remove_fixture(&root);
    }
    #[cfg(unix)]
    #[test]
    fn scratch_storage_refuses_links_and_budget_overflow() {
        let root = std::env::temp_dir().join(format!("orion-auth-budget-{}", ulid::Ulid::new()));
        let access = stage(&root, "safari:/synthetic/cookies".into()).unwrap();
        let file = fs::File::create(access.dir.join("synthetic-large-db")).unwrap();
        file.set_len(64 * 1024 * 1024 + 1).unwrap();
        assert!(access.check_size().is_err());
        fs::remove_file(access.dir.join("synthetic-large-db")).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", access.dir.join("unexpected-link")).unwrap();
        assert!(access.check_size().is_err());
        drop(access);
        remove_fixture(&root);
    }
    #[test]
    fn canceled_permission_does_not_stage_or_reuse_access() {
        let root = std::env::temp_dir().join(format!("orion-auth-cancel-{}", ulid::Ulid::new()));
        assert!(permit(&root, "chrome:/synthetic/browser/Default".into(), || false).is_err());
        assert!(!root.exists());
        assert!(serde_json::from_str::<CookieChoice>(
            r#"{"browser":"chrome","profile":null,"approved":true}"#
        )
        .is_err());
    }
    #[test]
    fn authenticated_diagnostics_are_never_retained_as_cookie_or_credential_text() {
        let result: Result<(), String> =
            Err("ERROR: signed cookie token SECRET /personal/profile".into());
        let out = redact(result, true, false).unwrap_err();
        assert!(!out.contains("SECRET"));
        assert!(!out.contains("/personal"));
        assert!(redact::<()>(Err("sensitive".into()), true, true)
            .unwrap_err()
            .starts_with("Stopped."));
    }
}
