use super::{runtime_root, check_sdk, resolve_script, SDK_LIFECYCLE, supported_node, probe_node_version};
use tauri::AppHandle;
use tokio::process::Command;
use std::process::Stdio;
use std::time::Duration;

#[tauri::command]
pub async fn cursor_install_sdk(app: AppHandle) -> Result<(), String> {
    let _exclusive = SDK_LIFECYCLE.try_write().map_err(|_| "Stop active Cursor runs before installing its SDK")?;
    if !probe_node_version().await.as_deref().is_some_and(supported_node) {
        return Err("Install Node 22.13+ and npm, then restart Orion Terminal".into());
    }
    let root = runtime_root(&app)?;
    let marker = root.join(".orion-managed");
    if root.exists() && !marker.exists() && std::fs::read_dir(&root).map_err(|e| e.to_string())?.next().is_some() {
        return Err("The Cursor runtime directory contains an unmanaged installation. Move it aside before using managed setup.".into());
    }
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    for (name, data) in [
        (".orion-managed", "orion-cursor-runtime-v1\n"),
        ("package.json", include_str!("../../../resources/cursor-runtime/package.json")),
        ("package-lock.json", include_str!("../../../resources/cursor-runtime/package-lock.json")),
        ("npmrc.empty", ""),
    ] {
        crate::fs_ops::save_file_atomic(root.join(name).to_string_lossy().into_owned(), data.into())?;
    }
    let mut command = Command::new("npm");
    command.args(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"])
        .current_dir(&root).env_clear()
        .env("PATH", crate::claude_cli::augmented_path())
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .env("TMPDIR", std::env::temp_dir())
        .env("npm_config_userconfig", root.join("npmrc.empty"))
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
    if let Ok(system_root) = std::env::var("SystemRoot") { command.env("SystemRoot", system_root); }
    let status = tokio::time::timeout(Duration::from_secs(300), command.status()).await
        .map_err(|_| "Cursor SDK installation timed out; retry when the registry is reachable")?
        .map_err(|_| "Could not start npm; install Node 22.13+ and restart Orion Terminal")?;
    if !status.success() { return Err(format!("Cursor SDK installation failed (exit {:?}); check network access and available disk space, then retry", status.code())); }
    let script = resolve_script(&app).ok_or("Cursor bridge is missing; reinstall Orion Terminal")?;
    if !check_sdk(&script, &root).await { return Err("SDK files installed, but the offline module check failed. Verify Node 22.13+ and retry.".into()); }
    Ok(())
}
