//! Archives 47 as a standalone macOS app, built from this crate with the
//! `archives_app` cfg (set by build.rs when ORION_APP_TARGET=archives) and `tauri.archives.conf.json`. It has its own
//! bundle identifier (so its own data dir), its own database (`archives.db`),
//! its own keychain service, and registers only the native commands Archives
//! uses. Nothing here reads or writes Orion Studio's data.

use tauri::Manager;

/// Every native command the Archives 47 app exposes. Kept as a list so a test
/// can check it against the frontend (`archivesCommands.test.ts`) and against
/// commands that must never ship in the standalone app.
pub const COMMANDS: &[&str] = &[
    "database_backup_warning",
    "drafts_begin",
    "drafts_write",
    "drafts_list",
    "drafts_read",
    "drafts_discard",
    "drafts_export",
    "app_quit_pending",
    "app_quit_decide",
    "read_file",
    "read_file_base64",
    "save_file_atomic",
    "write_file_base64",
    "analysis_work_dir",
    "path_exists",
    "reveal_in_os",
    "ui_bridge_respond",
    "api_key_set",
    "api_key_clear",
    "api_key_status",
    "github_token_set",
    "github_token_clear",
    "github_token_status",
    "cursor_api_key_set",
    "cursor_api_key_clear",
    "cursor_api_key_status",
    "provider_key_set",
    "provider_key_clear",
    "provider_key_status",
    "nous_device_start",
    "nous_device_poll",
    "nous_oauth_status",
    "nous_oauth_clear",
    "intake_installed",
    "intake_skill_context",
    "learn_claude_call",
    "repolens_claude_call",
    "repolens_fetch_repo",
    "repolens_fetch_source",
    "repolens_website_rip",
    "repolens_website_cancel",
    "repolens_website_continue",
    "repolens_website_delete",
    "repolens_website_extract_design",
    "messages_chat_run",
    "messages_chat_cancel",
    "open_devtools",
    "claude_status",
    "claude_send",
    "claude_cancel",
    "runtime_send",
    "runtime_send_reviewed",
    "runtime_cancel",
    "cli_status",
    "cli_login",
    "cli_auth_scope",
    "cli_logout",
    "cli_send",
    "cli_cancel",
    "cursor_status",
    "cursor_install_sdk",
    "cursor_send",
    "cursor_cancel",
    "media_download_engines",
    "media_download_list",
    "media_download_inspect",
    "media_download_start",
    "media_download_playable_copy",
    "media_download_stop",
    "media_download_import",
    "media_download_remove",
    "media_download_preferences",
    "media_download_archive_count",
    "media_download_archive_forget",
    "media_download_export",
    "media_download_asset_extras",
    "media_download_export_sidecar",
    "media_download_index_captions",
    "media_download_clear_captions",
    "media_download_sidecar_cancel",
    "media_download_search_captions",
    "media_download_refresh_caption_matches",
    "media_download_batch",
    "media_download_queue_status",
    "media_download_queue_run",
    "media_download_queue_hold",
    "media_download_queue_add",
    "media_download_queue_pause",
    "media_download_queue_resume",
    "media_download_queue_reorder",
    "media_download_playlist",
    "media_download_playlist_queue",
    "asset_store_file",
    "asset_store_bytes",
    "asset_delete_file",
];

#[cfg(archives_app)]
pub fn run() {
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();
    crate::app_profile::set(crate::app_profile::archives(&identifier))
        .expect("app profile is set once");
    tauri::Builder::default()
        .manage(crate::quit_guard::QuitGuard::default())
        .manage(crate::draft_recovery::Recovery::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&crate::app_profile::sqlite_url(), crate::database_migrations())
                .build(),
        )
        .setup(|app| {
            crate::cli_auth::init(app.handle())?;
            // Synchronous on purpose: the snapshot must land before the
            // frontend opens the DB and migrations run.
            crate::db_backup::run(app.handle());
            crate::repolens_website::reconcile_on_boot(app.handle());
            crate::app_handle::set(app.handle().clone());
            #[cfg(target_os = "macos")]
            crate::quit_guard_macos::install()?;
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                std::env::set_var("ORION_DB_PATH", crate::app_profile::db_path_in(&dir));
                std::env::set_var("ORION_CONTEXT_PATH", dir.join("archives-context.json"));
                std::env::set_var(crate::mcp_server::APP_SCOPE_ENV, "archives");
            }
            let handle = app.handle().clone();
            // The assistant's note tools call back through this bridge to
            // open the note they created.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::ui_bridge::start(handle).await {
                    eprintln!("[ui_bridge] failed to start: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::db_backup::database_backup_warning,
            crate::draft_recovery::drafts_begin,
            crate::draft_recovery::drafts_write,
            crate::draft_recovery::drafts_list,
            crate::draft_recovery::drafts_read,
            crate::draft_recovery::drafts_discard,
            crate::draft_recovery::drafts_export,
            crate::quit_guard::app_quit_pending,
            crate::quit_guard::app_quit_decide,
            crate::fs_ops::read_file,
            crate::fs_ops::read_file_base64,
            crate::fs_ops::save_file_atomic,
            crate::fs_ops::write_file_base64,
            crate::fs_ops::analysis_work_dir,
            crate::fs_ops::path_exists,
            crate::fs_ops::reveal_in_os,
            crate::ui_bridge::ui_bridge_respond,
            crate::api_key::api_key_set,
            crate::api_key::api_key_clear,
            crate::api_key::api_key_status,
            crate::api_key::github_token_set,
            crate::api_key::github_token_clear,
            crate::api_key::github_token_status,
            crate::api_key::cursor_api_key_set,
            crate::api_key::cursor_api_key_clear,
            crate::api_key::cursor_api_key_status,
            crate::provider_keys::provider_key_set,
            crate::provider_keys::provider_key_clear,
            crate::provider_keys::provider_key_status,
            crate::nous_oauth::nous_device_start,
            crate::nous_oauth::nous_device_poll,
            crate::nous_oauth::nous_oauth_status,
            crate::nous_oauth::nous_oauth_clear,
            crate::intake::installed::intake_installed,
            crate::intake::installed::intake_skill_context,
            crate::learn::learn_claude_call,
            crate::repolens::repolens_claude_call,
            crate::repolens::repolens_fetch_repo,
            crate::repolens::repolens_fetch_source,
            crate::repolens_website::repolens_website_rip,
            crate::repolens_website::repolens_website_cancel,
            crate::repolens_website::repolens_website_continue,
            crate::repolens_website::repolens_website_delete,
            crate::repolens_website::repolens_website_extract_design,
            crate::messages_chat::messages_chat_run,
            crate::messages_chat::messages_chat_cancel,
            crate::open_devtools,
            crate::connector_status::claude_status,
            crate::claude_cli::claude_send,
            crate::claude_cli::claude_cancel,
            crate::runtime::runtime_send,
            crate::runtime::runtime_send_reviewed,
            crate::runtime::runtime_cancel,
            crate::cli_engine::cli_status,
            crate::cli_engine::cli_login,
            crate::cli_auth::cli_auth_scope,
            crate::cli_auth::cli_logout,
            crate::cli_engine::cli_send,
            crate::cli_engine::cli_cancel,
            crate::cursor_engine::cursor_status,
            crate::cursor_engine::install::cursor_install_sdk,
            crate::cursor_engine::cursor_send,
            crate::cursor_engine::cursor_cancel,
            crate::media_download::media_download_engines,
            crate::media_download::media_download_list,
            crate::media_download::media_download_inspect,
            crate::media_download::media_download_start,
            crate::media_download::media_download_playable_copy,
            crate::media_download::media_download_stop,
            crate::media_download::media_download_import,
            crate::media_download::media_download_remove,
            crate::media_download::preferences::media_download_preferences,
            crate::media_download::preferences::media_download_archive_count,
            crate::media_download::preferences::media_download_archive_forget,
            crate::media_download::export::media_download_export,
            crate::media_download::sidecars::media_download_asset_extras,
            crate::media_download::sidecars::media_download_export_sidecar,
            crate::media_download::sidecars::media_download_index_captions,
            crate::media_download::sidecars::media_download_clear_captions,
            crate::media_download::sidecars::media_download_sidecar_cancel,
            crate::media_download::sidecars::media_download_search_captions,
            crate::media_download::sidecars::media_download_refresh_caption_matches,
            crate::media_download::queue::media_download_batch,
            crate::media_download::queue::media_download_queue_status,
            crate::media_download::queue::media_download_queue_run,
            crate::media_download::queue::media_download_queue_hold,
            crate::media_download::queue::media_download_queue_add,
            crate::media_download::queue::media_download_queue_pause,
            crate::media_download::queue::media_download_queue_resume,
            crate::media_download::queue::media_download_queue_reorder,
            crate::media_download::playlists::media_download_playlist,
            crate::media_download::playlists::media_download_playlist_queue,
            crate::asset::asset_store_file,
            crate::asset::asset_store_bytes,
            crate::asset::asset_delete_file,
        ])
        .build(context)
        .expect("error while building Archives 47")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !crate::quit_guard::take_approval(app_handle) {
                    api.prevent_exit();
                    crate::quit_guard::request(app_handle);
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                crate::quit_guard::request(app_handle);
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::COMMANDS;
    use std::collections::HashSet;

    fn handler_block() -> String {
        let src = include_str!("archives_app.rs");
        let start = src.find("generate_handler![").expect("handler list");
        let end = src[start..].find("])").expect("handler end") + start;
        src[start..end].to_string()
    }

    #[test]
    fn command_list_matches_the_registered_handlers() {
        let registered: Vec<String> = handler_block()
            .lines()
            .map(str::trim)
            .filter(|l| l.starts_with("crate::"))
            .map(|l| l.trim_end_matches(',').rsplit("::").next().unwrap().to_string())
            .collect();
        let listed: Vec<String> = COMMANDS.iter().map(|s| s.to_string()).collect();
        assert_eq!(registered, listed);
        assert_eq!(listed.len(), listed.iter().collect::<HashSet<_>>().len(), "no duplicates");
    }

    #[test]
    fn orion_only_commands_never_ship_in_archives() {
        for prefix in [
            "plugin_", "xdesign_", "terminal_", "git_", "lsp_", "hermes_", "pi_", "cc_", "spotify_",
            "wallpaper_", "character_", "intake_github", "intake_static", "intake_prepared",
            "fs_watch", "inline_edit", "autocomplete", "system_stats",
            "context_snapshot", "create_path", "rename_path", "delete_path", "search_in_files",
        ] {
            assert!(
                !COMMANDS.iter().any(|c| c.starts_with(prefix)),
                "Archives must not expose {prefix}*"
            );
        }
        // Listing installed skills (read-only, empty in Archives) is allowed; changing them is not.
        for exact in ["intake_install", "intake_skill_change", "intake_stage", "intake_discover"] {
            assert!(!COMMANDS.contains(&exact), "Archives must not expose {exact}");
        }
    }

    #[test]
    fn every_archives_command_exists_in_orion_too() {
        // Same implementation, so Orion's handler list must contain each one.
        let lib = include_str!("lib.rs");
        for c in COMMANDS {
            assert!(lib.contains(&format!("::{c},")) || lib.contains(&format!("            {c},")), "{c} missing from Orion");
        }
    }
}
