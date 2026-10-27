#![recursion_limit = "256"]
mod agent_chat;
mod agent_cli;
mod api_key;
mod app_handle;
mod asset;
mod autocomplete;
mod characters;
mod claude_cli;
mod connector_status;
mod provider_selection;
mod process_group;
mod cli_engine;
mod cli_auth;
mod codex_subscription;
mod cursor_engine;
pub mod db_backup;
mod draft_recovery;
mod quit_guard;
#[cfg(target_os = "macos")]
mod quit_guard_macos;
mod fs_ops;
mod fs_watch;
mod git_ops;
mod hermes;
mod inline_edit;
mod intake;
mod learn;
mod lsp;
mod mcp_config;
mod mcp_grants;
pub mod mcp_server;
mod messages_chat;
mod media_download;
mod nous_oauth;
mod pi_engine;
mod plugin_runtime;
mod provider_keys;
mod repolens;
mod repolens_website;
mod runtime;
mod spotify;
mod sysstats;
mod subscription_quota;
mod quota_keychain;
mod terminal;
mod ui_bridge;
mod wallpaper;
mod xdesign_image;
mod xdesign_assets;
mod xdesign_room;
mod xdesign_state;
mod xdesign_archive;
mod xdesign_project_imports;
mod xdesign_history;
mod xdesign_photo;
mod xdesign_fonts;
mod xdesign_web;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    { window.open_devtools(); Ok(()) }
    #[cfg(not(debug_assertions))]
    { let _ = window; Err("Devtools are disabled in release builds".into()) }
}

fn database_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "extend chats with session/project/cost",
            sql: include_str!("../migrations/0002_chats_extend.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "search triggers, plaintext, note_tags, embeddings",
            sql: include_str!("../migrations/0003_search_and_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "fix fts5 triggers to use delete+insert",
            sql: include_str!("../migrations/0004_fix_search_triggers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add kind column to notes (note vs journal)",
            sql: include_str!("../migrations/0005_note_kind.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add location column to notes for journal metadata",
            sql: include_str!("../migrations/0006_journal_metadata.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "extend assets with mime_type, size_bytes, original_name",
            sql: include_str!("../migrations/0007_asset_metadata.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "mood boards + mood_board_assets join",
            sql: include_str!("../migrations/0008_mood_boards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "collections + notes.collection_id",
            sql: include_str!("../migrations/0009_collections.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "embeddings for semantic search",
            sql: include_str!("../migrations/0010_embeddings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "per-project workspace layouts",
            sql: include_str!("../migrations/0011_workspace_layouts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "chats.origin for cross-app routing",
            sql: include_str!("../migrations/0012_chat_origin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "rename chat origin core -> rosie",
            sql: include_str!("../migrations/0013_rename_core_origin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "favorite flag on notes/assets/mood_boards",
            sql: include_str!("../migrations/0014_favorites.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "hermes tasks + parallel-swarm agents",
            sql: include_str!("../migrations/0015_hermes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "per-agent model override for hermes swarms",
            sql: include_str!("../migrations/0016_hermes_agent_model.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "ambient activity log for R.O.S.I.E cross-app awareness",
            sql: include_str!("../migrations/0017_activity_log.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "per-project code embeddings for codebase semantic search",
            sql: include_str!("../migrations/0018_code_embeddings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "agent-edit checkpoints (pre-images per turn)",
            sql: include_str!("../migrations/0019_checkpoints.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "database layer: collection property schema + values + saved views",
            sql: include_str!("../migrations/0020_database_views.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "repolens: saved repo scans + on-demand lens results",
            sql: include_str!("../migrations/0021_repolens.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "repolens: website rips (clone pipeline runs + thumbnails)",
            sql: include_str!("../migrations/0022_repolens_websites.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "repolens: per-website design spec (extract MD)",
            sql: include_str!("../migrations/0023_repolens_website_design.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "learn: topics/nodes/edges/reviews",
            sql: include_str!("../migrations/0024_learn.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "learn: topic figures + mastery achievements",
            sql: include_str!("../migrations/0025_learn_figures_achievements.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "control panel: providers, skills, agents",
            sql: include_str!("../migrations/0026_control_panel.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "command center: profiles, channels, messages, missions",
            sql: include_str!("../migrations/0027_command_center.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "command center: per-profile avatar",
            sql: include_str!("../migrations/0028_cc_avatar.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "xdesign: design systems (brand contracts)",
            sql: include_str!("../migrations/0029_xdesign_design_systems.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "local skill intake staging",
            sql: include_str!("../migrations/0030_skill_intake_staging.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "immutable installed skill packages",
            sql: include_str!("../migrations/0031_installed_skill_packages.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "immutable pinned static-app source captures",
            sql: include_str!("../migrations/0032_static_app_sources.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "immutable static-app prepared candidates",
            sql: include_str!("../migrations/0033_static_app_candidates.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "Archives media download history",
            sql: include_str!("../migrations/0034_media_downloads.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 35,
            description: "Media format options and non-destructive playback copies",
            sql: include_str!("../migrations/0035_media_download_options.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 36,
            description: "Download defaults and durable source archive",
            sql: include_str!("../migrations/0036_media_download_preferences.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 37,
            description: "URL-scoped generic extractor archive identities",
            sql: include_str!("../migrations/0037_media_download_generic_archive.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 38,
            description: "Durable held media download queue",
            sql: include_str!("../migrations/0038_media_download_queue.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 39,
            description: "Explicit local asset caption indexes and preserved archive search",
            sql: include_str!("../migrations/0039_asset_transcripts.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database_migrations();
    tauri::Builder::default()
        .manage(quit_guard::QuitGuard::default())
        .manage(draft_recovery::Recovery::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(spotify::global_shortcut_plugin())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:orion.db", migrations)
                .build(),
        )
        .setup(|app| {
            cli_auth::init(app.handle())?;
            // Synchronous on purpose: the snapshot must land before the
            // frontend opens the DB and migrations run.
            db_backup::run(app.handle());
            repolens_website::reconcile_on_boot(&app.handle());
            // Make the runtime's in-process tool dispatch self-sufficient:
            // record the app handle so send_ui_action can emit directly, and
            // export the same paths the MCP subprocess gets via its config so
            // in-process tool handlers can open the DB / read context.
            crate::app_handle::set(app.handle().clone());
            #[cfg(target_os = "macos")]
            quit_guard_macos::install()?;
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                std::env::set_var("ORION_DB_PATH", dir.join("orion.db"));
                std::env::set_var("ORION_CONTEXT_PATH", dir.join("orion-context.json"));
            }
            let handle = app.handle().clone();
            // Spawn the localhost UI bridge so out-of-process MCP servers
            // can reach the running app to drive UI-state actions
            // (open_app, focus_window, etc.). Failure is non-fatal — the
            // app still runs, just without remote UI control.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::ui_bridge::start(handle).await {
                    eprintln!("[ui_bridge] failed to start: {}", e);
                }
            });
            // OS-level media hotkeys for Spotify (work while Orion is
            // unfocused). Non-fatal if a combo is already claimed.
            spotify::register_global_shortcuts(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_backup::database_backup_warning,
            draft_recovery::drafts_begin,
            draft_recovery::drafts_write,
            draft_recovery::drafts_list,
            draft_recovery::drafts_read,
            draft_recovery::drafts_discard,
            draft_recovery::drafts_export,
            quit_guard::app_quit_pending,
            quit_guard::app_quit_decide,
            fs_ops::read_dir_tree,
            fs_ops::read_file,
            fs_ops::theme_read_markdown,
            intake::intake_discover,
            intake::intake_inspect,
            intake::intake_release,
            intake::intake_stage,
            intake::intake_list,
            intake::intake_discard,
            intake::intake_read,
            intake::github::intake_github_discover,
            intake::github::intake_github_inspect,
            intake::github::review::intake_github_review,
            intake::github::intake_github_cancel,
            intake::github::static_apps::intake_static_fetch,
            intake::github::static_apps::intake_static_cancel,
            intake::github::static_apps::intake_static_list,
            intake::github::static_apps::intake_static_read,
            intake::github::static_apps::intake_static_discard,
            intake::github::static_apps::prepared::intake_prepared_save,
            intake::github::static_apps::prepared::intake_prepared_list,
            intake::github::static_apps::prepared::intake_prepared_read,
            intake::github::static_apps::prepared::intake_prepared_discard,
            intake::github::static_apps::prepared::install::intake_prepared_install,
            intake::installed::intake_installed,
            intake::installed::intake_install,
            intake::installed::intake_skill_change,
            intake::installed::intake_skill_context,
            intake::installed::intake_installed_read,
            fs_ops::read_file_base64,
            fs_ops::count_files,
            fs_ops::save_file_atomic,
            fs_ops::write_file_base64,
            fs_ops::analysis_work_dir,
            fs_ops::path_exists,
            fs_ops::search_in_files,
            fs_ops::create_path,
            fs_ops::rename_path,
            fs_ops::delete_path,
            fs_ops::reveal_in_os,
            git_ops::git_working_diff,
            git_ops::git_status,
            git_ops::git_head_content,
            git_ops::git_stage,
            git_ops::git_unstage,
            git_ops::git_discard,
            git_ops::git_commit,
            git_ops::git_push,
            git_ops::git_branches,
            git_ops::git_checkout,
            git_ops::git_create_branch,
            git_ops::git_pull,
            git_ops::git_file_diff,
            git_ops::git_blame_line,
            lsp::lsp_probe,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            mcp_config::context_snapshot_write,
            ui_bridge::ui_bridge_respond,
            api_key::api_key_set,
            api_key::api_key_clear,
            api_key::api_key_status,
            api_key::github_token_set,
            api_key::github_token_clear,
            api_key::github_token_status,
            api_key::cursor_api_key_set,
            api_key::cursor_api_key_clear,
            api_key::cursor_api_key_status,
            provider_keys::provider_key_set,
            provider_keys::provider_key_clear,
            provider_keys::provider_key_status,
            plugin_runtime::plugin_inspect_directory,
            plugin_runtime::intake::plugin_inspect_intake_directory,
            plugin_runtime::intake::plugin_install_intake_directory,
            plugin_runtime::plugin_install_directory,
            plugin_runtime::plugin_install_reviewed_directory,
            plugin_runtime::recovery::plugin_previous_version,
            plugin_runtime::recovery::plugin_rollback_reviewed,
            plugin_runtime::plugin_list_installed,
            plugin_runtime::plugin_recover_installed,
            plugin_runtime::plugin_set_enabled,
            plugin_runtime::plugin_quarantine,
            plugin_runtime::plugin_remove,
            plugin_runtime::recovery::removal::plugin_remove_reviewed,
            plugin_runtime::plugin_read_entrypoint,
            plugin_runtime::plugin_workspace_grant,
            plugin_runtime::plugin_workspace_revoke,
            plugin_runtime::plugin_broker_call,
            plugin_runtime::plugin_boot_status,
            plugin_runtime::plugin_runtime_begin,
            plugin_runtime::plugin_runtime_ready,
            plugin_runtime::plugin_safe_mode_clear,
            nous_oauth::nous_device_start,
            nous_oauth::nous_device_poll,
            nous_oauth::nous_oauth_status,
            nous_oauth::nous_oauth_clear,
            learn::learn_claude_call,
            repolens::repolens_claude_call,
            repolens::repolens_fetch_repo,
            repolens::repolens_fetch_source,
            repolens_website::repolens_website_rip,
            repolens_website::repolens_website_cancel,
            repolens_website::repolens_website_continue,
            repolens_website::repolens_website_delete,
            repolens_website::repolens_website_extract_design,
            autocomplete::autocomplete_run,
            inline_edit::inline_edit_run,
            inline_edit::inline_edit_cancel,
            messages_chat::messages_chat_run,
            messages_chat::messages_chat_cancel,
            open_devtools,
            connector_status::claude_status,
            claude_cli::claude_send,
            claude_cli::claude_cancel,
            runtime::runtime_send,
            runtime::runtime_send_reviewed,
            runtime::runtime_cancel,
            cli_engine::cli_status,
            cli_engine::cli_login,
            cli_auth::cli_auth_scope,
            cli_auth::cli_logout,
            cli_engine::cli_send,
            cli_engine::cli_cancel,
            cursor_engine::cursor_status,
            cursor_engine::install::cursor_install_sdk,
            cursor_engine::cursor_send,
            cursor_engine::cursor_cancel,
            pi_engine::pi_status,
            pi_engine::pi_send,
            pi_engine::pi_cancel,
            pi_engine::pi_oneshot,
            pi_engine::cc_workspace_path,
            pi_engine::cc_recent_artifacts,
            pi_engine::cc_open_path,
            pi_engine::cc_read_image,
            pi_engine::cc_vault_pages,
            pi_engine::cc_vault_graph,
            hermes::hermes_dispatch_task,
            hermes::hermes_continue_agent,
            hermes::hermes_stop_agent,
            hermes::hermes_stop_task,
            terminal::terminal_open,
            terminal::terminal_open_claude,
            terminal::terminal_open_agent,
            agent_chat::agent_chat_send,
            agent_chat::agent_chat_cancel,
            agent_cli::agent_cli_info,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            media_download::media_download_engines,
            media_download::media_download_list,
            media_download::media_download_inspect,
            media_download::media_download_start,
            media_download::media_download_playable_copy,
            media_download::media_download_stop,
            media_download::media_download_import,
            media_download::media_download_remove,
            media_download::preferences::media_download_preferences,
            media_download::preferences::media_download_archive_count,
            media_download::preferences::media_download_archive_forget,
            media_download::export::media_download_export,
            media_download::sidecars::media_download_asset_extras,
            media_download::sidecars::media_download_export_sidecar,
            media_download::sidecars::media_download_index_captions,
            media_download::sidecars::media_download_clear_captions,
            media_download::sidecars::media_download_sidecar_cancel,
            media_download::sidecars::media_download_search_captions,
            media_download::sidecars::media_download_refresh_caption_matches,
            media_download::queue::media_download_batch,
            media_download::queue::media_download_queue_status,
            media_download::queue::media_download_queue_run,
            media_download::queue::media_download_queue_hold,
            media_download::queue::media_download_queue_add,
            media_download::queue::media_download_queue_pause,
            media_download::queue::media_download_queue_resume,
            media_download::queue::media_download_queue_reorder,
            media_download::playlists::media_download_playlist,
            media_download::playlists::media_download_playlist_queue,
            asset::asset_store_file,
            asset::asset_store_bytes,
            asset::asset_delete_file,
            asset::xdesign_snapshot_write,
            xdesign_assets::xdesign_asset_request,
            xdesign_assets::xdesign_stock_image,
            xdesign_room::xdesign_room_open,
            xdesign_room::xdesign_room_request,
            xdesign_room::xdesign_room_image_file_request,
            xdesign_room::xdesign_room_cancel,
            xdesign_room::xdesign_room_close,
            xdesign_room::xdesign_room_key_set,
            xdesign_room::xdesign_room_key_clear,
            xdesign_room::xdesign_room_key_status,
            xdesign_image::xdesign_image_gen,
            xdesign_web::xdesign_fetch_url,
            xdesign_web::xdesign_save_bytes,
            xdesign_state::xdesign_state_commit,
            xdesign_archive::xdesign_project_export,
            xdesign_archive::xdesign_project_import,
            xdesign_archive::xdesign_project_clone,
            xdesign_project_imports::xdesign_project_import_control,
            xdesign_history::xdesign_state_save,
            xdesign_history::xdesign_checkpoint_create,
            xdesign_history::xdesign_checkpoint_list,
            xdesign_history::xdesign_checkpoint_delete,
            xdesign_history::xdesign_checkpoint_restore,
            xdesign_photo::xdesign_photo_open,
            xdesign_photo::xdesign_photo_color_settings,
            xdesign_photo::xdesign_photo_clipboard,
            xdesign_photo::xdesign_photo_copy_text,
            xdesign_photo::xdesign_photo_import_decision,
            xdesign_photo::xdesign_photo_command,
            xdesign_photo::xdesign_photo_source_inspect,
            xdesign_photo::xdesign_storage_report,
            xdesign_photo::xdesign_storage_startup,
            xdesign_photo::xdesign_storage_schedule_compaction,
            xdesign_photo::xdesign_photo_channel_operation,
            xdesign_photo::xdesign_photo_new_documents,
            xdesign_photo::xdesign_photo_catalog,
            xdesign_photo::xdesign_photo_export,
            xdesign_photo::xdesign_photo_render,
            xdesign_photo::xdesign_photo_tile,
            xdesign_photo::xdesign_photo_layer_thumbnails,
            xdesign_photo::xdesign_photo_channel_thumbnails,
            xdesign_photo::xdesign_photo_histogram,
            xdesign_photo::xdesign_photo_sample,
            xdesign_photo::xdesign_photo_tone_pixels,
            xdesign_photo::xdesign_photo_view_preview,
            xdesign_photo::xdesign_photo_command_preview,
            xdesign_photo::xdesign_photo_magnetic_trace,
            xdesign_photo::xdesign_photo_preset_preview,
            xdesign_photo::xdesign_photo_stroke_preview,
            xdesign_photo::xdesign_photo_stroke_pixels,
            xdesign_photo::xdesign_photo_stroke_preview_pixels,
            xdesign_photo::xdesign_photo_stroke_end,
            xdesign_photo::xdesign_photo_smart_open,
            xdesign_photo::xdesign_photo_smart_apply,
            xdesign_fonts::xdesign_font_families,
            xdesign_fonts::xdesign_font_load,
            fs_watch::fs_watch_set_root,
            wallpaper::wallpaper_store_file,
            wallpaper::wallpaper_clear_file,
            characters::character_store_file,
            characters::character_clear_file,
            sysstats::system_stats,
            sysstats::claude_usage,
            sysstats::claude_limits,
            subscription_quota::subscription_quota,
            spotify::spotify_now_playing,
            spotify::spotify_control,
            spotify::spotify_seek,
            spotify::spotify_connect,
            spotify::spotify_status,
            spotify::spotify_disconnect,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if !quit_guard::take_approval(app_handle) {
                        api.prevent_exit();
                        quit_guard::request(app_handle);
                    }
                }
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
                    api.prevent_close();
                    quit_guard::request(app_handle);
                }
                tauri::RunEvent::Exit => {
                    crate::plugin_runtime::runtime_shutdown(app_handle);
                    crate::terminal::kill_all();
                    crate::lsp::kill_all();
                }
                _ => {}
            }
        });
}
