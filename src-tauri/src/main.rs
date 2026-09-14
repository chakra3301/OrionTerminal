// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--restore-db-copy")) {
        let args: Vec<_> = std::env::args_os().skip(2).collect();
        if args.len() != 2 {
            eprintln!("Usage: orion-terminal --restore-db-copy BACKUP NEW_DIRECTORY");
            std::process::exit(2);
        }
        match orion_terminal_lib::db_backup::restore_copy(std::path::Path::new(&args[0]), std::path::Path::new(&args[1])) {
            Ok(()) => { println!("Verified database-only copy created. No live profile was replaced. Files outside SQLite were not copied."); std::process::exit(0); }
            Err(error) => { eprintln!("Database copy refused: {error}"); std::process::exit(1); }
        }
    }
    // Mode-switch: when claude-code (or any MCP host) spawns us with
    // `--mcp-serve`, become a stdio MCP server instead of booting the Tauri
    // UI. Same binary, two entry points — no second build target.
    if std::env::args().nth(1).as_deref() == Some("--mcp-serve") {
        orion_terminal_lib::mcp_server::serve();
    }
    orion_terminal_lib::run()
}
