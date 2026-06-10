mod api_key;
mod asset;
mod claude_cli;
mod fs_ops;
mod fs_watch;
mod hermes;
mod inline_edit;
mod mcp_config;
pub mod mcp_server;
mod messages_chat;
mod sysstats;
mod terminal;
mod ui_bridge;
mod wallpaper;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:orion.db", migrations)
                .build(),
        )
        .setup(|app| {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_ops::read_dir_tree,
            fs_ops::read_file,
            fs_ops::read_file_base64,
            fs_ops::count_files,
            fs_ops::save_file_atomic,
            fs_ops::path_exists,
            fs_ops::search_in_files,
            fs_ops::create_path,
            fs_ops::rename_path,
            fs_ops::delete_path,
            fs_ops::reveal_in_os,
            mcp_config::context_snapshot_write,
            ui_bridge::ui_bridge_respond,
            api_key::api_key_set,
            api_key::api_key_clear,
            api_key::api_key_status,
            inline_edit::inline_edit_run,
            inline_edit::inline_edit_cancel,
            messages_chat::messages_chat_run,
            messages_chat::messages_chat_cancel,
            claude_cli::claude_send,
            claude_cli::claude_cancel,
            claude_cli::claude_oneshot,
            claude_cli::claude_oneshot_with_image,
            hermes::hermes_dispatch_task,
            hermes::hermes_continue_agent,
            hermes::hermes_stop_agent,
            hermes::hermes_stop_task,
            terminal::terminal_open,
            terminal::terminal_open_claude,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            asset::asset_store_file,
            asset::asset_store_bytes,
            asset::asset_delete_file,
            asset::xdesign_snapshot_write,
            fs_watch::fs_watch_set_root,
            wallpaper::wallpaper_store_file,
            wallpaper::wallpaper_clear_file,
            sysstats::system_stats,
            sysstats::claude_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
