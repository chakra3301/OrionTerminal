use once_cell::sync::{Lazy, OnceCell};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;
use tokio::process::Command;
use tokio::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

static VALIDATION_CODEX_HOME: OnceCell<PathBuf> = OnceCell::new();

pub(crate) fn init(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.config().identifier != "com.lucaorion.orion-terminal.validation" {
        return Ok(());
    }
    let directory = app.path().app_config_dir()?.join("codex-auth");
    if let Ok(meta) = std::fs::symlink_metadata(&directory) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Validation Codex profile must be a real directory".into());
        }
    }
    std::fs::create_dir_all(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    VALIDATION_CODEX_HOME
        .set(directory)
        .map_err(|_| "Validation auth profile already initialized")?;
    Ok(())
}
pub(crate) fn codex_home_override() -> Option<std::ffi::OsString> {
    VALIDATION_CODEX_HOME
        .get()
        .map(|path| path.as_os_str().to_owned())
}
pub(crate) fn apply_profile(cmd: &mut Command) {
    if let Some(home) = codex_home_override() {
        cmd.env("CODEX_HOME", home);
    }
}

static CLAUDE: Lazy<RwLock<()>> = Lazy::new(|| RwLock::new(()));
static CODEX: Lazy<RwLock<()>> = Lazy::new(|| RwLock::new(()));
static GEMINI: Lazy<RwLock<()>> = Lazy::new(|| RwLock::new(()));

fn lock(engine: &str) -> Result<&'static RwLock<()>, String> {
    match engine {
        "claude" => Ok(&CLAUDE),
        "codex_cli" => Ok(&CODEX),
        "gemini_cli" => Ok(&GEMINI),
        _ => Err("Unknown subscription connector".into()),
    }
}
pub(crate) fn use_account(engine: &str) -> Result<RwLockReadGuard<'static, ()>, String> {
    lock(engine)?
        .try_read()
        .map_err(|_| "Account sign-out is in progress. Wait and retry.".into())
}
pub(crate) fn change_account(engine: &str) -> Result<RwLockWriteGuard<'static, ()>, String> {
    lock(engine)?.try_write().map_err(|_| {
        "Stop active requests for this subscription before changing its account.".into()
    })
}

const CLEARED: &[&str] = &[
    "NODE_OPTIONS",
    "NODE_PATH",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "OPENAI_BASE_URL",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
];

fn command(engine: &str) -> Result<&'static str, String> {
    match engine {
        "claude" => Ok("claude auth login"),
        "codex_cli" => Ok("codex login"),
        "gemini_cli" => Ok("gemini"),
        _ => Err("Unknown subscription connector".into()),
    }
}
pub(crate) async fn validate_login(engine: &str) -> Result<(), String> {
    // Parse the same command the terminal will run, without starting OAuth or a model.
    let mut parts = command(engine)?.split_ascii_whitespace();
    let program = parts.next().ok_or("Missing login command")?;
    let mut cmd = Command::new(program);
    cmd.args(parts)
        .arg("--help")
        .env("PATH", crate::claude_cli::augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for key in CLEARED {
        cmd.env_remove(key);
    }
    apply_profile(&mut cmd);
    let status = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.status())
        .await
        .map_err(|_| "Login command compatibility check timed out.".to_string())?
        .map_err(|_| "Could not check the installed login command.".to_string())?;
    if !status.success() {
        return Err(
            "The installed provider CLI rejected the login command. No login terminal was opened."
                .into(),
        );
    }
    Ok(())
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn environment() -> Vec<(String, String)> {
    let mut env = vec![("PATH".into(), crate::claude_cli::augmented_path())];
    for key in ["HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"] {
        if let Ok(value) = std::env::var(key) {
            env.push((key.into(), value));
        }
    }
    if let Some(home) = codex_home_override() {
        env.retain(|(key, _)| key != "CODEX_HOME");
        env.push(("CODEX_HOME".into(), home.to_string_lossy().into_owned()));
    }
    env
}
fn posix_invocation(engine: &str, env: &[(String, String)]) -> Result<String, String> {
    let clear = CLEARED
        .iter()
        .map(|key| format!("-u {key}"))
        .collect::<Vec<_>>()
        .join(" ");
    let assignments = env
        .iter()
        .map(|(key, value)| format!("{key}={}", quote(value)))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!(
        "/usr/bin/env {clear} {assignments} {}",
        command(engine)?
    ))
}
fn powershell_body(engine: &str, env: &[(String, String)]) -> Result<String, String> {
    let clear = CLEARED
        .iter()
        .map(|key| format!("Remove-Item Env:{key} -ErrorAction SilentlyContinue;"))
        .collect::<Vec<_>>()
        .join(" ");
    let assignments = env
        .iter()
        .map(|(key, value)| format!("$env:{key} = {};", ps_quote(value)))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!("{clear} {assignments} & {}; if ($LASTEXITCODE -eq 0) {{ Write-Host 'Login command completed. Return to Orion and Re-check.' }} else {{ Write-Host \"Login failed (exit $LASTEXITCODE). See the error above; return to Orion to retry.\" }}; Read-Host 'Press Enter to close'", command(engine)?))
}
pub(crate) fn terminal_script(engine: &str) -> Result<String, String> {
    let env = environment();
    if cfg!(windows) {
        let bytes: Vec<u8> = powershell_body(engine, &env)?
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        Ok(format!(
            "powershell -NoProfile -EncodedCommand {}",
            crate::claude_cli::base64_encode(&bytes)
        ))
    } else {
        Ok(format!("{}; ORION_LOGIN_STATUS=$?; if [ \"$ORION_LOGIN_STATUS\" -eq 0 ]; then printf '\\nLogin command completed. Return to Orion and Re-check.'; else printf '\\nLogin failed (exit %s). See the error above; return to Orion to retry.' \"$ORION_LOGIN_STATUS\"; fi; printf '\\nPress Return to close...'; read -r ORION_LOGIN_DONE", posix_invocation(engine, &env)?))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthScope {
    pub(crate) directory: String,
    shared: bool,
}
#[tauri::command]
pub fn cli_auth_scope(engine: String) -> Result<AuthScope, String> {
    let (key, folder) = match engine.as_str() {
        "claude" => ("CLAUDE_CONFIG_DIR", ".claude"),
        "codex_cli" => ("CODEX_HOME", ".codex"),
        "gemini_cli" => ("GEMINI_CLI_HOME", ".gemini"),
        _ => return Err("Unknown subscription connector".into()),
    };
    let directory = environment()
        .into_iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| {
            if engine == "gemini_cli" {
                std::path::Path::new(&value)
                    .join(".gemini")
                    .display()
                    .to_string()
            } else {
                value
            }
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map(|home| {
                    std::path::Path::new(&home)
                        .join(folder)
                        .display()
                        .to_string()
                })
                .unwrap_or_else(|_| format!("default {folder} profile"))
        });
    // A custom profile may still be shared by other tools; never label it private by inference.
    Ok(AuthScope {
        directory,
        shared: true,
    })
}

fn logout_command(engine: &str) -> Result<(&'static str, &'static [&'static str]), String> {
    match engine {
        "claude" => Ok(("claude", &["auth", "logout"])),
        "codex_cli" => Ok(("codex", &["logout"])),
        _ => Err("Use /auth signout inside Gemini CLI to clear its Google session. Disconnect from Orion does not remove shared credentials.".into()),
    }
}

#[tauri::command]
pub async fn cli_logout(engine: String) -> Result<(), String> {
    let (program, args) = logout_command(&engine)?;
    let _account = change_account(&engine)?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("PATH", crate::claude_cli::augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for key in CLEARED {
        cmd.env_remove(key);
    }
    apply_profile(&mut cmd);
    let status = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.status())
        .await
        .map_err(|_| "Sign-out timed out. Re-check the account before retrying.".to_string())?
        .map_err(|_| "Could not launch the provider's sign-out command.".to_string())?;
    if !status.success() {
        return Err(
            "The provider CLI could not complete sign-out. Re-check its account status.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn login_script_passes_the_exact_profile_to_a_stub_cli_without_injection() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("orion-auth-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("codex");
        std::fs::write(&executable, "#!/bin/sh\n[ -z \"${OPENAI_API_KEY+x}\" ] || exit 3\n[ -z \"${NODE_OPTIONS+x}\" ] || exit 4\n[ \"$1\" = login ] || exit 5\n[ \"$#\" -eq 1 ] || exit 6\nprintf '%s' \"$CODEX_HOME\" > \"$ORION_AUTH_SCOPE_RESULT\"\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let output = root.join("scope");
        let injected = root.join("injected");
        let profile = format!("test's profile $(touch {})", injected.display());
        let env = vec![
            ("PATH".into(), format!("{}:/usr/bin:/bin", root.display())),
            ("CODEX_HOME".into(), profile.clone()),
            (
                "ORION_AUTH_SCOPE_RESULT".into(),
                output.display().to_string(),
            ),
        ];
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", &posix_invocation("codex_cli", &env).unwrap()])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("OPENAI_API_KEY", "fixture-not-a-key")
            .env("NODE_OPTIONS", "fixture")
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(std::fs::read_to_string(output).unwrap(), profile);
        assert!(!injected.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn terminal_login_quotes_profile_paths_and_clears_billing_overrides() {
        let env = vec![(
            "CODEX_HOME".into(),
            "/tmp/test's home; $(touch unsafe)".into(),
        )];
        let script = posix_invocation("codex_cli", &env).unwrap();
        assert!(script.contains("CODEX_HOME='/tmp/test'\\''s home; $(touch unsafe)'"));
        assert!(script.ends_with("codex login"));
        assert!(!script.contains("--ignore-user-config"));
        assert!(script.contains("-u OPENAI_API_KEY"));
        assert!(script.contains("-u CLAUDE_CODE_OAUTH_TOKEN"));
        let ps = powershell_body("codex_cli", &env).unwrap();
        assert!(ps.contains("$env:CODEX_HOME = '/tmp/test''s home; $(touch unsafe)';"));
        assert!(terminal_script("unknown").is_err());
    }
    #[test]
    fn auth_commands_omit_exec_only_flags_and_report_terminal_failures() {
        assert_eq!(command("codex_cli").unwrap(), "codex login");
        assert_eq!(
            logout_command("codex_cli").unwrap(),
            ("codex", &["logout"][..])
        );
        let script = terminal_script("codex_cli").unwrap();
        assert!(!script.contains("--ignore-user-config"));
        if !cfg!(windows) {
            assert!(script.contains("ORION_LOGIN_STATUS=$?"));
            assert!(script.contains("Login failed (exit %s)"));
        }
        assert!(powershell_body("codex_cli", &[])
            .unwrap()
            .contains("$LASTEXITCODE -eq 0"));
    }

    #[test]
    fn account_changes_and_requests_are_exclusive() {
        let running = use_account("codex_cli").unwrap();
        assert!(change_account("codex_cli").is_err());
        drop(running);
        let changing = change_account("codex_cli").unwrap();
        assert!(use_account("codex_cli").is_err());
        assert!(use_account("claude").is_ok());
        drop(changing);
        assert!(use_account("codex_cli").is_ok());
    }
}
