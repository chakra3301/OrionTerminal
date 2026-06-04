use once_cell::sync::Lazy;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

static PTYS: Lazy<Mutex<HashMap<String, PtyHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct DataPayload {
    #[serde(rename = "ptyId")]
    pty_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    #[serde(rename = "ptyId")]
    pty_id: String,
}

fn standard_env(builder: &mut CommandBuilder, cwd: &str) {
    builder.cwd(cwd);
    if let Ok(home) = std::env::var("HOME") {
        builder.env("HOME", home);
    }
    if let Ok(term) = std::env::var("TERM") {
        builder.env("TERM", term);
    } else {
        builder.env("TERM", "xterm-256color");
    }
    if let Ok(path) = std::env::var("PATH") {
        builder.env("PATH", path);
    }
}

fn spawn_pty_with(
    app: AppHandle,
    pty_id: String,
    builder: CommandBuilder,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if PTYS.lock().contains_key(&pty_id) {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut child = pair.slave.spawn_command(builder).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let writer_arc = Arc::new(Mutex::new(writer));
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    PTYS.lock().insert(
        pty_id.clone(),
        PtyHandle {
            master: pair.master,
            writer: writer_arc,
        },
    );

    let app_for_reader = app.clone();
    let id_for_reader = pty_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_for_reader.emit(
                        "terminal:data",
                        DataPayload {
                            pty_id: id_for_reader.clone(),
                            data: s,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_for_reader.emit(
            "terminal:exit",
            ExitPayload {
                pty_id: id_for_reader.clone(),
            },
        );
        PTYS.lock().remove(&id_for_reader);
    });

    let id_for_waiter = pty_id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        PTYS.lock().remove(&id_for_waiter);
    });

    Ok(())
}

#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    pty_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "cmd.exe".to_string()
        } else {
            "/bin/bash".to_string()
        }
    });
    let mut builder = CommandBuilder::new(&shell);
    standard_env(&mut builder, &cwd);
    spawn_pty_with(app, pty_id, builder, cols, rows)
}

/// Spawn an interactive Claude Code session directly inside a pty. Same as
/// running `claude` in a shell, but bypasses the shell so the session is a
/// dedicated surface with no extra prompt state. Model pinned to Opus 4.7 to
/// match the chat-rail path. Also registers Orion's in-process MCP server
/// (same binary, --mcp-serve mode) so the agent has Orion-aware tools
/// alongside its built-in Read/Edit/Bash toolset.
#[tauri::command]
pub fn terminal_open_claude(
    app: AppHandle,
    pty_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut builder = CommandBuilder::new("claude");
    builder.args(["--model", crate::claude_cli::OPUS_MODEL]);
    if let Some(mcp_config_path) = crate::mcp_config::write(&app) {
        builder.args(["--mcp-config", &mcp_config_path]);
    }
    standard_env(&mut builder, &cwd);
    // Identify ourselves so claude doesn't try to auto-install its VS Code
    // extension (which fails with ERR_STREAM_PREMATURE_CLOSE when `code` is
    // not on PATH). Setting TERM_PROGRAM to a non-IDE value makes claude skip
    // the install path entirely.
    builder.env("TERM_PROGRAM", "OrionTerminal");
    spawn_pty_with(app, pty_id, builder, cols, rows)
}

#[tauri::command]
pub fn terminal_write(pty_id: String, data: String) -> Result<(), String> {
    let map = PTYS.lock();
    let handle = map
        .get(&pty_id)
        .ok_or_else(|| format!("no pty: {}", pty_id))?;
    let mut w = handle.writer.lock();
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = PTYS.lock();
    let handle = map
        .get(&pty_id)
        .ok_or_else(|| format!("no pty: {}", pty_id))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_kill(pty_id: String) -> Result<(), String> {
    PTYS.lock().remove(&pty_id);
    Ok(())
}
