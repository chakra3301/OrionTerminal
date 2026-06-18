use once_cell::sync::Lazy;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
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

/// Number of trailing bytes that form the start of a multi-byte UTF-8
/// character whose continuation bytes haven't all arrived yet. These should be
/// held back until the next read so the character isn't split across emits.
/// Returns 0 when the buffer ends on a complete character (or invalid bytes,
/// which we let `from_utf8_lossy` replace as before).
fn incomplete_tail_len(bytes: &[u8]) -> usize {
    let len = bytes.len();
    let max_back = 3.min(len);
    for back in 1..=max_back {
        let b = bytes[len - back];
        if b < 0x80 {
            return 0; // ASCII byte — everything after it is complete
        }
        if b >= 0xC0 {
            // Leading byte of a multi-byte sequence; how long should it be?
            let expected = if b >= 0xF0 {
                4
            } else if b >= 0xE0 {
                3
            } else {
                2
            };
            return if back < expected { back } else { 0 };
        }
        // else: continuation byte (0x80..=0xBF) — keep walking back
    }
    0
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
    let killer = child.clone_killer();

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let writer_arc = Arc::new(Mutex::new(writer));
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    PTYS.lock().insert(
        pty_id.clone(),
        PtyHandle {
            master: pair.master,
            writer: writer_arc,
            killer,
        },
    );

    let app_for_reader = app.clone();
    let id_for_reader = pty_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // A multi-byte UTF-8 character (box-drawing glyphs, emoji in claude's
        // TUI, etc.) can straddle a read boundary. Decoding each chunk in
        // isolation mangles those split bytes into U+FFFD, corrupting the
        // stream. Hold any incomplete trailing sequence back for the next read.
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let hold = incomplete_tail_len(&carry);
                    let split = carry.len() - hold;
                    if split > 0 {
                        let s = String::from_utf8_lossy(&carry[..split]).into_owned();
                        let _ = app_for_reader.emit(
                            "terminal:data",
                            DataPayload {
                                pty_id: id_for_reader.clone(),
                                data: s,
                            },
                        );
                        carry.drain(..split);
                    }
                }
                Err(_) => break,
            }
        }
        if !carry.is_empty() {
            let s = String::from_utf8_lossy(&carry).into_owned();
            let _ = app_for_reader.emit(
                "terminal:data",
                DataPayload {
                    pty_id: id_for_reader.clone(),
                    data: s,
                },
            );
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
    if let Some(mut handle) = PTYS.lock().remove(&pty_id) {
        let _ = handle.killer.kill();
    }
    Ok(())
}

/// Kill every live PTY child. Called on app exit so no shell/claude session
/// outlives the window.
pub fn kill_all() {
    let mut map = PTYS.lock();
    for (_, mut handle) in map.drain() {
        let _ = handle.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::incomplete_tail_len;

    #[test]
    fn ascii_holds_nothing() {
        assert_eq!(incomplete_tail_len(b"hello"), 0);
        assert_eq!(incomplete_tail_len(b""), 0);
    }

    #[test]
    fn complete_multibyte_holds_nothing() {
        // '✓' = E2 9C 93 (3 bytes), fully present
        assert_eq!(incomplete_tail_len("a✓".as_bytes()), 0);
        // '😀' = F0 9F 98 80 (4 bytes), fully present
        assert_eq!(incomplete_tail_len("😀".as_bytes()), 0);
    }

    #[test]
    fn split_multibyte_holds_the_partial_tail() {
        // First 1/2/3 bytes of the 3-byte '✓'
        assert_eq!(incomplete_tail_len(&[0xE2]), 1);
        assert_eq!(incomplete_tail_len(&[0xE2, 0x9C]), 2);
        // First 3 bytes of the 4-byte '😀'
        assert_eq!(incomplete_tail_len(&[0xF0, 0x9F, 0x98]), 3);
        // Preceding ASCII doesn't change the held tail
        assert_eq!(incomplete_tail_len(&[0x41, 0xE2, 0x9C]), 2);
    }

    #[test]
    fn reassembly_across_a_boundary_round_trips() {
        let full = "box ─┐ ✓ 😀 end".as_bytes().to_vec();
        // Split at every position; the held tail + remainder must reconstruct
        // the original string with no replacement characters.
        for cut in 0..=full.len() {
            let mut carry: Vec<u8> = Vec::new();
            let mut out = String::new();
            for chunk in [&full[..cut], &full[cut..]] {
                carry.extend_from_slice(chunk);
                let hold = incomplete_tail_len(&carry);
                let split = carry.len() - hold;
                out.push_str(&String::from_utf8_lossy(&carry[..split]));
                carry.drain(..split);
            }
            out.push_str(&String::from_utf8_lossy(&carry));
            assert_eq!(out, "box ─┐ ✓ 😀 end", "failed at cut {cut}");
            assert!(!out.contains('\u{FFFD}'), "replacement char at cut {cut}");
        }
    }
}
