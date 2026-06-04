// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Mode-switch: when claude-code (or any MCP host) spawns us with
    // `--mcp-serve`, become a stdio MCP server instead of booting the Tauri
    // UI. Same binary, two entry points — no second build target.
    if std::env::args().nth(1).as_deref() == Some("--mcp-serve") {
        orion_terminal_lib::mcp_server::serve();
    }
    orion_terminal_lib::run()
}
