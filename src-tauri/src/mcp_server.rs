//! In-process MCP server. Spawned as a subprocess of `claude-code` when the
//! user opens the Claude Code tab (or any other path that wants Orion-aware
//! tools available). We piggy-back on the main `orion-terminal` binary by
//! mode-switching on the `--mcp-serve` flag — no second binary to bundle.
//!
//! Protocol: stdio JSON-RPC 2.0 per the MCP spec. We implement the bare
//! minimum needed for tools: `initialize`, `tools/list`, `tools/call`.
//! Notifications (`notifications/initialized`) are accepted and ignored.
//!
//! Tools in v1 are READ-ONLY against the SQLite DB. They open a fresh
//! connection per call (cheap; SQLite handles concurrency via WAL). The
//! DB path comes from the `ORION_DB_PATH` env var that the main process
//! sets when spawning claude-code.

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";

pub fn serve() -> ! {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut reader = stdin.lock();

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => std::process::exit(0), // EOF — claude closed us
            Ok(_) => {}
            Err(_) => std::process::exit(1),
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue, // malformed line; drop
        };
        if let Some(response) = handle_request(&request) {
            let s = response.to_string();
            let _ = writeln!(out, "{}", s);
            let _ = out.flush();
        }
    }
}

fn handle_request(req: &Value) -> Option<Value> {
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = req.get("id").cloned();
    let params = req.get("params").cloned().unwrap_or(json!({}));

    // Notifications have no id and don't expect a response.
    let is_notification = id.is_none();

    let result_or_error = dispatch(method, &params);

    if is_notification {
        return None;
    }
    let id_val = id.unwrap_or(Value::Null);
    Some(match result_or_error {
        Ok(result) => json!({
            "jsonrpc": "2.0",
            "id": id_val,
            "result": result,
        }),
        Err(err) => json!({
            "jsonrpc": "2.0",
            "id": id_val,
            "error": {
                "code": err.code,
                "message": err.message,
            },
        }),
    })
}

struct RpcError {
    code: i32,
    message: String,
}

fn dispatch(method: &str, params: &Value) -> Result<Value, RpcError> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "orion-mcp", "version": "0.1.0" },
        })),
        "notifications/initialized" => Ok(Value::Null),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => call_tool(params),
        _ => Err(RpcError {
            code: -32601,
            message: format!("method not found: {}", method),
        }),
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "orion_list_recent_notes",
            "description": "List the user's most recently updated notes from \
                Archives 47. Returns id, title, kind (note/journal/project), \
                and updated_at. Use to see what the user has been working on.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max rows. Defaults to 20.",
                    }
                },
            }
        },
        {
            "name": "orion_search_archive",
            "description": "Full-text search across the user's notes, chats, \
                and assets in Archives 47. Returns up to 10 ranked hits with \
                title + snippet. Use to find anything the user has captured.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" }
                },
                "required": ["query"],
            }
        },
        {
            "name": "orion_list_projects",
            "description": "List projects the user has opened in Orion, \
                sorted most-recently-opened first.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "orion_create_note",
            "description": "Create a new note in Archives 47. Returns the new \
                note id. `kind` defaults to 'note'; use 'journal' for a \
                dated entry, 'project' for a Notion-style nested page. \
                `body` is optional plaintext; the note opens empty if \
                omitted. The note appears in the user's UI within a few \
                seconds (next focus/refresh).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "kind": {
                        "type": "string",
                        "enum": ["note", "journal", "project"]
                    }
                },
                "required": ["title"]
            }
        },
        {
            "name": "orion_update_note_body",
            "description": "Replace the body (plaintext) of an existing note \
                by id. Title and other metadata are left untouched. Use after \
                orion_search_archive or orion_list_recent_notes to get an id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "body": { "type": "string" }
                },
                "required": ["id", "body"]
            }
        },
        {
            "name": "orion_open_app",
            "description": "Open (or focus, if already open) one of Orion \
                Terminal's apps in a new window: 'archives' (notes/journal/\
                projects/mood boards/media), 'orion' (code editor), or \
                'xdesign' (design studio). Returns immediately; the window \
                animates in.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "enum": ["archives", "orion", "xdesign"]
                    }
                },
                "required": ["app"]
            }
        },
        {
            "name": "orion_switch_project",
            "description": "Switch the active code project Orion is bound to, \
                by exact name or id (use orion_list_projects first if unsure). \
                Triggers a per-project workspace layout swap and opens Orion.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name_or_id": { "type": "string" }
                },
                "required": ["name_or_id"]
            }
        },
        {
            "name": "orion_open_file",
            "description": "Open a file in the Orion code editor. Accepts an \
                absolute path or one relative to the active project's root. \
                Opens Orion if not already open and adds a tab in the editor \
                panel. Use this AFTER reading/editing a file with Bash/Read/\
                Edit if you want the user to actually see it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "orion_get_context",
            "description": "Snapshot of what the user is currently looking at: \
                focused app, active code project, open file/note, current \
                Archives view, count + paths of open editor tabs. ALWAYS call \
                this BEFORE acting on vague references like 'this', 'here', \
                'the file I'm on'. Cheap — reads a JSON snapshot the app \
                writes whenever UI state changes.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "orion_search_files",
            "description": "Find files in the active project's tree by name \
                or path substring (case-insensitive). Returns up to 30 paths \
                relative to the project root. Use to locate code before \
                reading/editing. Skips common build/git/node_modules dirs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "orion_list_assets",
            "description": "List the user's Archives 47 assets (images, \
                video, audio, docs). Returns id, title, kind, tags, \
                created_at, file_path. Optional kind filter narrows results.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["image", "video", "audio", "doc", "other"]
                    },
                    "limit": { "type": "integer" }
                }
            }
        },
        {
            "name": "orion_search_assets",
            "description": "Find assets in Archives 47 by tag, filename, or \
                kind. Free-text query matched against title, original \
                filename, and tags. Returns up to 20 hits.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "orion_run_in_terminal",
            "description": "Send a shell command line to Orion's open terminal \
                pty so the user sees it execute in their real terminal panel. \
                Adds a trailing newline. Opens the terminal tab if it isn't \
                already. Differs from your Bash tool: this is for things the \
                user should SEE happen; Bash is for your own internal work.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" }
                },
                "required": ["command"]
            }
        },
        {
            "name": "orion_xdesign_add_rect",
            "description": "Add a rectangle to the active XDesign page. \
                Coordinates are in document space (pixels). Opens XDesign \
                if not already open. Fill is a CSS color string; defaults \
                to neon cyan.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "w": { "type": "number" },
                    "h": { "type": "number" },
                    "fill": { "type": "string" },
                    "radius": { "type": "number" }
                },
                "required": ["x", "y", "w", "h"]
            }
        },
        {
            "name": "orion_xdesign_add_text",
            "description": "Add a text shape to the active XDesign page. \
                Opens XDesign if not already open. fontSize defaults to 24.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "text": { "type": "string" },
                    "fontSize": { "type": "number" },
                    "fill": { "type": "string" }
                },
                "required": ["x", "y", "text"]
            }
        },
        {
            "name": "orion_xdesign_add_ellipse",
            "description": "Add an ellipse to the active XDesign page. \
                Coordinates + dimensions in document pixels.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "w": { "type": "number" },
                    "h": { "type": "number" },
                    "fill": { "type": "string" }
                },
                "required": ["x", "y", "w", "h"]
            }
        },
        {
            "name": "orion_xdesign_add_frame",
            "description": "Add a frame (container) to the active XDesign \
                page. Frames are layout boxes that can hold child shapes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "w": { "type": "number" },
                    "h": { "type": "number" },
                    "fill": { "type": "string" }
                },
                "required": ["x", "y", "w", "h"]
            }
        },
        {
            "name": "orion_xdesign_get_canvas",
            "description": "Read the current XDesign canvas: every layer on \
                the active page with its full properties (id, kind, name, \
                x/y/w/h, fill, stroke, gradient, effects, rotation, opacity, \
                hidden/locked, parent), plus the current selection and page \
                info. Use this to know the authoritative state before editing \
                — target shapes by their `id`. Returns {} fields when XDesign \
                isn't open.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "orion_xdesign_get_selection",
            "description": "Read the full properties of the currently-selected \
                XDesign shapes. Use this for 'make THIS bigger/blue/etc' so \
                you have exact current values to compute from.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "orion_xdesign_apply",
            "description": "Apply a batch of canvas edits as ONE undo step and \
                get back the new shape ids. This is the PREFERRED way to \
                mutate the canvas (over emitting <canvas-command> text). \
                `ops` is an array; each op is an object with an `action`:\n\
                - addRect/addEllipse/addFrame {x,y,w,h, fill?,stroke?,strokeWidth?,radius?,rotation?,name?}\n\
                - addText {x,y,text, fontSize?,fill?,w?,h?,name?}\n\
                - addStar {cx,cy,outerR,innerR, points?,fill?,stroke?}\n\
                - addPath {x,y,w,h,points:[{x,y}(0..1)],closed?,...}\n\
                - update {id, ...props to patch} (fill, fillGradient, fillImage, stroke, strokeWidth, effects, radius, rotation, x,y,w,h, text, fontSize, opacity, hidden, locked, and auto-layout props layoutMode/itemSpacing/padding*/primaryAxisAlign/counterAxisAlign/layoutSizingH/layoutSizingV)\n\
                - delete {id}\n\
                - select {ids:[...]}\n\
                - clearCanvas {}\n\
                - group {ids} (→ new frame id) / ungroup {ids} / reparent {id, parentId|null}\n\
                - makeComponent {id} / createInstance {mainId, x?, y?} (→ instance id; pass x/y to place it, else it offsets right) / syncInstance {id} / detachInstance {id}\n\
                - addVariable {name, value, varType?} (→ id) / setVariableValue {id, modeId, value} / addMode {name} (→ id) / setActiveMode {id}; use a variable on a shape via update {id, fill:\"var:<varId>\"}\n\
                - bringToFront {ids} / sendToBack {ids} / duplicate {ids} (→ new ids)\n\
                - addPage {name?} (→ id; also switches to it) / switchPage {id} / renamePage {id, name} / deletePage {id}. Page nav is a hard undo boundary — create a page in one call, then add its content in a follow-up call.\n\
                Returns { applied, results:[{action, ok, id?, error?}] } — use \
                the returned ids to target shapes in later calls.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ops": {
                        "type": "array",
                        "items": { "type": "object" }
                    }
                },
                "required": ["ops"]
            }
        },
        {
            "name": "orion_create_mood_board",
            "description": "Create a new mood board in Archives 47. Returns \
                the new board id. Optional `asset_ids` populates it with \
                existing assets in one shot (use orion_list_assets / \
                orion_search_assets to find ids first).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "asset_ids": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["title"]
            }
        },
        {
            "name": "orion_add_to_mood_board",
            "description": "Add an existing asset to an existing mood board. \
                Idempotent — adding a member already on the board is a \
                no-op. Returns ok if the row was inserted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "board_id": { "type": "string" },
                    "asset_id": { "type": "string" }
                },
                "required": ["board_id", "asset_id"]
            }
        },
        {
            "name": "orion_attach_tag",
            "description": "Attach a tag (free-text label) to an asset or \
                note. Tag is created if it doesn't exist. Use for adding \
                light metadata — agent-driven categorization, marking \
                favorites, etc.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target_kind": {
                        "type": "string",
                        "enum": ["asset", "note"]
                    },
                    "target_id": { "type": "string" },
                    "tag": { "type": "string" }
                },
                "required": ["target_kind", "target_id", "tag"]
            }
        },
        {
            "name": "orion_delete_note",
            "description": "Delete a note from Archives 47 by id. PERMANENT — \
                triggers cascade through search_index. Confirm with the \
                user first if it's not clearly what they asked for.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }
        }
    ])
}

fn call_tool(params: &Value) -> Result<Value, RpcError> {
    let name = params
        .get("name")
        .and_then(|n| n.as_str())
        .ok_or_else(|| RpcError {
            code: -32602,
            message: "tools/call missing `name`".into(),
        })?;
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    let result = match name {
        "orion_list_recent_notes" => tool_list_recent_notes(&args),
        "orion_search_archive" => tool_search_archive(&args),
        "orion_list_projects" => tool_list_projects(&args),
        "orion_create_note" => tool_create_note(&args),
        "orion_update_note_body" => tool_update_note_body(&args),
        "orion_open_app" => tool_open_app(&args),
        "orion_switch_project" => tool_switch_project(&args),
        "orion_open_file" => tool_open_file(&args),
        "orion_get_context" => tool_get_context(&args),
        "orion_search_files" => tool_search_files(&args),
        "orion_list_assets" => tool_list_assets(&args),
        "orion_search_assets" => tool_search_assets(&args),
        "orion_run_in_terminal" => tool_run_in_terminal(&args),
        "orion_xdesign_add_rect" => tool_xdesign_add_rect(&args),
        "orion_xdesign_add_text" => tool_xdesign_add_text(&args),
        "orion_xdesign_add_ellipse" => tool_xdesign_add_ellipse(&args),
        "orion_xdesign_add_frame" => tool_xdesign_add_frame(&args),
        "orion_xdesign_get_canvas" => tool_xdesign_get_canvas(&args),
        "orion_xdesign_get_selection" => tool_xdesign_get_selection(&args),
        "orion_xdesign_apply" => tool_xdesign_apply(&args),
        "orion_create_mood_board" => tool_create_mood_board(&args),
        "orion_add_to_mood_board" => tool_add_to_mood_board(&args),
        "orion_attach_tag" => tool_attach_tag(&args),
        "orion_delete_note" => tool_delete_note(&args),
        other => Err(format!("unknown tool: {}", other)),
    };

    match result {
        Ok(text) => Ok(json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false,
        })),
        Err(msg) => Ok(json!({
            "content": [{ "type": "text", "text": format!("error: {}", msg) }],
            "isError": true,
        })),
    }
}

fn open_db() -> Result<Connection, String> {
    let path = std::env::var("ORION_DB_PATH")
        .map_err(|_| "ORION_DB_PATH env var not set".to_string())?;
    Connection::open(&path).map_err(|e| format!("open db: {}", e))
}

fn tool_list_recent_notes(args: &Value) -> Result<String, String> {
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(20)
        .clamp(1, 200);
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, kind, updated_at FROM notes \
             ORDER BY updated_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            let id: String = r.get(0)?;
            let title: String = r.get(1)?;
            let kind: String = r.get(2)?;
            let updated_at: i64 = r.get(3)?;
            Ok(json!({
                "id": id,
                "title": if title.is_empty() { "Untitled".to_string() } else { title },
                "kind": kind,
                "updated_at": updated_at,
            }))
        })
        .map_err(|e| e.to_string())?;
    let collected: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!({ "notes": collected }).to_string())
}

fn tool_search_archive(args: &Value) -> Result<String, String> {
    let raw_query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "query required".to_string())?;
    let cleaned: String = raw_query
        .chars()
        .map(|c| if matches!(c, '"' | '*' | '(' | ')') { ' ' } else { c })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return Ok(json!({ "hits": [] }).to_string());
    }
    let fts_query: String = cleaned
        .split_whitespace()
        .map(|t| format!("{}*", t))
        .collect::<Vec<_>>()
        .join(" ");
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.entity_id, s.entity_type, s.title, \
                    snippet(search_index, 3, '[', ']', '...', 16), \
                    n.kind \
               FROM search_index s \
          LEFT JOIN notes n ON n.id = s.entity_id AND s.entity_type = 'note' \
              WHERE search_index MATCH ?1 \
              ORDER BY rank LIMIT 10",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![fts_query], |r| {
            let entity_id: String = r.get(0)?;
            let entity_type: String = r.get(1)?;
            let title: String = r.get(2)?;
            let snippet: String = r.get(3)?;
            let note_kind: Option<String> = r.get(4)?;
            Ok(json!({
                "id": entity_id,
                "type": entity_type,
                "title": if title.is_empty() { "Untitled".to_string() } else { title },
                "snippet": snippet,
                "note_kind": note_kind,
            }))
        })
        .map_err(|e| e.to_string())?;
    let collected: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!({
        "query": raw_query,
        "hits": collected,
    })
    .to_string())
}

fn tool_create_note(args: &Value) -> Result<String, String> {
    let title = args
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "title required".to_string())?
        .trim();
    if title.is_empty() {
        return Err("title cannot be blank".to_string());
    }
    let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("").trim();
    let kind = args.get("kind").and_then(|v| v.as_str()).unwrap_or("note");
    if !matches!(kind, "note" | "journal" | "project") {
        return Err(format!("invalid kind: {} (must be note|journal|project)", kind));
    }

    let id = ulid::Ulid::new().to_string();
    let now = chrono_like_millis();
    // BlockNote-compatible shape — a single paragraph block carrying the
    // body text, plus a trailing empty paragraph so the editor cursor lands
    // somewhere natural when the user opens it.
    let blocks_json = if body.is_empty() {
        "[]".to_string()
    } else {
        let block_id_1 = ulid::Ulid::new().to_string();
        let block_id_2 = ulid::Ulid::new().to_string();
        serde_json::json!([
            {
                "id": block_id_1,
                "type": "paragraph",
                "props": {
                    "backgroundColor": "default",
                    "textColor": "default",
                    "textAlignment": "left"
                },
                "content": [{ "type": "text", "text": body, "styles": {} }],
                "children": []
            },
            {
                "id": block_id_2,
                "type": "paragraph",
                "props": {
                    "backgroundColor": "default",
                    "textColor": "default",
                    "textAlignment": "left"
                },
                "content": [],
                "children": []
            }
        ])
        .to_string()
    };
    let conn = open_db()?;
    // The search_index FTS5 triggers fire automatically on INSERT.
    conn.execute(
        "INSERT INTO notes \
         (id, title, blocks_json, plaintext, parent_id, kind, location, collection_id, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, '', NULL, ?6, ?6)",
        params![id, title, blocks_json, body, kind, now],
    )
    .map_err(|e| format!("insert note: {}", e))?;
    // Auto-navigate: open Archives behind the Core panel and surface the
    // new note so the user sees it without needing to click around. Bridge
    // failures are non-fatal — the note is in the DB regardless.
    let _ = send_ui_action(
        "open_note",
        json!({ "id": id, "kind": kind }),
    );
    Ok(json!({
        "ok": true,
        "id": id,
        "kind": kind,
        "title": title,
        "note": "Archives opened to the new note for the user.",
    })
    .to_string())
}

fn tool_update_note_body(args: &Value) -> Result<String, String> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "id required".to_string())?;
    let body = args
        .get("body")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "body required".to_string())?;
    let block_id = ulid::Ulid::new().to_string();
    let blocks_json = if body.trim().is_empty() {
        "[]".to_string()
    } else {
        serde_json::json!([
            {
                "id": block_id,
                "type": "paragraph",
                "props": {
                    "backgroundColor": "default",
                    "textColor": "default",
                    "textAlignment": "left"
                },
                "content": [{ "type": "text", "text": body, "styles": {} }],
                "children": []
            }
        ])
        .to_string()
    };
    let now = chrono_like_millis();
    let conn = open_db()?;
    let affected = conn
        .execute(
            "UPDATE notes SET blocks_json = ?1, plaintext = ?2, updated_at = ?3 WHERE id = ?4",
            params![blocks_json, body, now, id],
        )
        .map_err(|e| format!("update note: {}", e))?;
    if affected == 0 {
        return Err(format!("no note with id: {}", id));
    }
    // Look up kind so the navigation lands on the right Archives view.
    // Falls back to 'note' if the lookup fails for any reason.
    let kind: String = conn
        .query_row(
            "SELECT kind FROM notes WHERE id = ?1",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "note".to_string());
    let _ = send_ui_action(
        "open_note",
        json!({ "id": id, "kind": kind }),
    );
    Ok(json!({ "ok": true, "id": id, "updated_at": now }).to_string())
}

fn tool_open_app(args: &Value) -> Result<String, String> {
    let app = args
        .get("app")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "app required".to_string())?;
    if !matches!(app, "archives" | "orion" | "xdesign") {
        return Err(format!("invalid app: {} (archives|orion|xdesign)", app));
    }
    send_ui_action(
        "open_app",
        serde_json::json!({ "app": app }),
    )?;
    Ok(json!({ "ok": true, "opened": app }).to_string())
}

fn tool_switch_project(args: &Value) -> Result<String, String> {
    let q = args
        .get("name_or_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "name_or_id required".to_string())?;
    send_ui_action(
        "switch_project",
        serde_json::json!({ "name_or_id": q }),
    )?;
    Ok(json!({ "ok": true, "requested": q }).to_string())
}

fn tool_open_file(args: &Value) -> Result<String, String> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "path required".to_string())?
        .trim();
    if path.is_empty() {
        return Err("path cannot be blank".to_string());
    }
    send_ui_action("open_file", serde_json::json!({ "path": path }))?;
    Ok(json!({ "ok": true, "opened": path }).to_string())
}

/// Reads + returns the JSON snapshot the frontend writes whenever UI state
/// changes (see `contextSnapshot.ts` + `mcp_config::context_snapshot_write`).
/// Returns an empty stub if the file doesn't exist yet (first-launch race
/// before the frontend's snapshotter runs) so the agent doesn't choke.
fn tool_get_context(_args: &Value) -> Result<String, String> {
    let path = std::env::var("ORION_CONTEXT_PATH").map_err(|_| {
        "ORION_CONTEXT_PATH not set — context snapshot unavailable".to_string()
    })?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(_) => Ok(json!({
            "updated_at": 0,
            "note": "no snapshot yet — frontend hasn't written one",
        })
        .to_string()),
    }
}

/// Walk the active project's directory tree (from the context snapshot's
/// `active_project.root_path`) and return paths whose name OR relative
/// path contains the query (case-insensitive). Skips noise dirs.
fn tool_search_files(args: &Value) -> Result<String, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "query required".to_string())?
        .trim();
    if query.is_empty() {
        return Err("query cannot be blank".to_string());
    }
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(30)
        .clamp(1, 200) as usize;

    let context_path = std::env::var("ORION_CONTEXT_PATH").map_err(|_| {
        "ORION_CONTEXT_PATH not set".to_string()
    })?;
    let snapshot_str = std::fs::read_to_string(&context_path)
        .map_err(|e| format!("read context: {}", e))?;
    let snapshot: Value =
        serde_json::from_str(&snapshot_str).map_err(|e| format!("parse: {}", e))?;
    let root_path = snapshot
        .get("active_project")
        .and_then(|p| p.get("root_path"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "no active project — open a folder first".to_string())?;

    let ignore: &[&str] = &[
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".cache",
        ".venv",
        "__pycache__",
    ];
    let needle = query.to_lowercase();
    let mut hits: Vec<String> = Vec::new();
    let walker = walkdir::WalkDir::new(root_path).max_depth(12).into_iter();
    let walker = walker.filter_entry(|e| {
        if !e.file_type().is_dir() {
            return true;
        }
        let n = e.file_name().to_string_lossy();
        !ignore.iter().any(|d| *d == n.as_ref())
    });
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(root_path).unwrap_or(path);
        let rel_str = rel.to_string_lossy().to_string();
        if rel_str.to_lowercase().contains(&needle) {
            hits.push(rel_str);
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(json!({
        "root": root_path,
        "query": query,
        "hits": hits,
    })
    .to_string())
}

fn tool_list_assets(args: &Value) -> Result<String, String> {
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(50)
        .clamp(1, 500) as i64;
    let kind_filter = args.get("kind").and_then(|v| v.as_str());
    let conn = open_db()?;
    let query = match kind_filter {
        Some(k) => format!(
            "SELECT id, title, kind, file_path, original_name, created_at \
             FROM assets WHERE kind = '{}' ORDER BY created_at DESC LIMIT {}",
            k.replace('\'', ""),
            limit
        ),
        None => format!(
            "SELECT id, title, kind, file_path, original_name, created_at \
             FROM assets ORDER BY created_at DESC LIMIT {}",
            limit
        ),
    };
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let title: Option<String> = r.get(1)?;
            let kind: String = r.get(2)?;
            let file_path: Option<String> = r.get(3)?;
            let original_name: String = r.get(4)?;
            let created_at: i64 = r.get(5)?;
            Ok(json!({
                "id": id,
                "title": title.unwrap_or_default(),
                "kind": kind,
                "file_path": file_path,
                "original_name": original_name,
                "created_at": created_at,
            }))
        })
        .map_err(|e| e.to_string())?;
    let collected: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!({ "assets": collected }).to_string())
}

fn tool_search_assets(args: &Value) -> Result<String, String> {
    let q = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "query required".to_string())?
        .trim();
    if q.is_empty() {
        return Ok(json!({ "hits": [] }).to_string());
    }
    let needle = format!("%{}%", q.to_lowercase());
    let conn = open_db()?;
    // Hits on filename OR title OR tag name. Three small UNION queries kept
    // explicit so SQLite uses the obvious indexes.
    let sql = "
        SELECT DISTINCT a.id, a.title, a.kind, a.file_path, a.original_name
        FROM assets a
        LEFT JOIN asset_tags at ON at.asset_id = a.id
        LEFT JOIN tags t ON t.id = at.tag_id
        WHERE LOWER(a.title)         LIKE ?1
           OR LOWER(a.original_name) LIKE ?1
           OR LOWER(t.name)          LIKE ?1
        ORDER BY a.created_at DESC
        LIMIT 20
    ";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![needle], |r| {
            let id: String = r.get(0)?;
            let title: Option<String> = r.get(1)?;
            let kind: String = r.get(2)?;
            let file_path: Option<String> = r.get(3)?;
            let original_name: String = r.get(4)?;
            Ok(json!({
                "id": id,
                "title": title.unwrap_or_default(),
                "kind": kind,
                "file_path": file_path,
                "original_name": original_name,
            }))
        })
        .map_err(|e| e.to_string())?;
    let collected: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!({ "query": q, "hits": collected }).to_string())
}

fn tool_run_in_terminal(args: &Value) -> Result<String, String> {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "command required".to_string())?;
    let trimmed = command.trim_end();
    if trimmed.is_empty() {
        return Err("command cannot be blank".to_string());
    }
    send_ui_action(
        "run_in_terminal",
        serde_json::json!({ "command": trimmed }),
    )?;
    Ok(json!({ "ok": true, "sent": trimmed }).to_string())
}

fn tool_xdesign_add_rect(args: &Value) -> Result<String, String> {
    let x = args.get("x").and_then(|v| v.as_f64()).ok_or("x required")?;
    let y = args.get("y").and_then(|v| v.as_f64()).ok_or("y required")?;
    let w = args.get("w").and_then(|v| v.as_f64()).ok_or("w required")?;
    let h = args.get("h").and_then(|v| v.as_f64()).ok_or("h required")?;
    let fill = args.get("fill").and_then(|v| v.as_str()).unwrap_or("#00e0ff");
    let radius = args.get("radius").and_then(|v| v.as_f64()).unwrap_or(0.0);
    send_ui_action(
        "xdesign_add_rect",
        json!({
            "x": x, "y": y, "w": w, "h": h, "fill": fill, "radius": radius,
        }),
    )?;
    Ok(json!({ "ok": true, "added": "rect" }).to_string())
}

fn tool_xdesign_add_text(args: &Value) -> Result<String, String> {
    let x = args.get("x").and_then(|v| v.as_f64()).ok_or("x required")?;
    let y = args.get("y").and_then(|v| v.as_f64()).ok_or("y required")?;
    let text = args
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or("text required")?;
    let font_size = args.get("fontSize").and_then(|v| v.as_f64()).unwrap_or(24.0);
    let fill = args.get("fill").and_then(|v| v.as_str()).unwrap_or("#e6f4ec");
    send_ui_action(
        "xdesign_add_text",
        json!({
            "x": x, "y": y, "text": text, "fontSize": font_size, "fill": fill,
        }),
    )?;
    Ok(json!({ "ok": true, "added": "text" }).to_string())
}

fn tool_xdesign_add_ellipse(args: &Value) -> Result<String, String> {
    let x = args.get("x").and_then(|v| v.as_f64()).ok_or("x required")?;
    let y = args.get("y").and_then(|v| v.as_f64()).ok_or("y required")?;
    let w = args.get("w").and_then(|v| v.as_f64()).ok_or("w required")?;
    let h = args.get("h").and_then(|v| v.as_f64()).ok_or("h required")?;
    let fill = args.get("fill").and_then(|v| v.as_str()).unwrap_or("#00e0ff");
    send_ui_action(
        "xdesign_add_ellipse",
        json!({ "x": x, "y": y, "w": w, "h": h, "fill": fill }),
    )?;
    Ok(json!({ "ok": true, "added": "ellipse" }).to_string())
}

fn tool_xdesign_add_frame(args: &Value) -> Result<String, String> {
    let x = args.get("x").and_then(|v| v.as_f64()).ok_or("x required")?;
    let y = args.get("y").and_then(|v| v.as_f64()).ok_or("y required")?;
    let w = args.get("w").and_then(|v| v.as_f64()).ok_or("w required")?;
    let h = args.get("h").and_then(|v| v.as_f64()).ok_or("h required")?;
    let fill = args
        .get("fill")
        .and_then(|v| v.as_str())
        .unwrap_or("rgba(255,255,255,0.03)");
    send_ui_action(
        "xdesign_add_frame",
        json!({ "x": x, "y": y, "w": w, "h": h, "fill": fill }),
    )?;
    Ok(json!({ "ok": true, "added": "frame" }).to_string())
}

fn tool_xdesign_get_canvas(_args: &Value) -> Result<String, String> {
    // The frontend returns the active page's layers (full props), selection,
    // and page metadata. We pass the data straight through to the agent.
    let data = send_ui_action("xdesign_get_canvas", json!({}))?;
    Ok(data.to_string())
}

fn tool_xdesign_get_selection(_args: &Value) -> Result<String, String> {
    let data = send_ui_action("xdesign_get_selection", json!({}))?;
    Ok(data.to_string())
}

fn tool_xdesign_apply(args: &Value) -> Result<String, String> {
    let ops = args
        .get("ops")
        .and_then(|v| v.as_array())
        .ok_or("ops (array) required")?;
    if ops.is_empty() {
        return Err("ops is empty — nothing to apply".to_string());
    }
    let data = send_ui_action("xdesign_apply", json!({ "ops": ops }))?;
    Ok(data.to_string())
}

fn tool_create_mood_board(args: &Value) -> Result<String, String> {
    let title = args
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "title required".to_string())?
        .trim();
    if title.is_empty() {
        return Err("title cannot be blank".to_string());
    }
    let asset_ids: Vec<String> = args
        .get("asset_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let id = ulid::Ulid::new().to_string();
    let now = chrono_like_millis();
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO mood_boards (id, title, cover_asset_id, created_at, updated_at) \
         VALUES (?1, ?2, NULL, ?3, ?3)",
        params![id, title, now],
    )
    .map_err(|e| format!("insert mood_board: {}", e))?;
    // Bulk-add any provided assets. Position increments per asset.
    let mut added = 0u32;
    for (i, asset_id) in asset_ids.iter().enumerate() {
        let res = conn.execute(
            "INSERT OR IGNORE INTO mood_board_assets (board_id, asset_id, position, added_at) \
             VALUES (?1, ?2, ?3, ?4)",
            params![id, asset_id, i as i64, now],
        );
        if let Ok(n) = res {
            added += n as u32;
        }
    }
    // First added asset becomes the cover by default.
    if added > 0 {
        let _ = conn.execute(
            "UPDATE mood_boards SET cover_asset_id = ( \
                SELECT asset_id FROM mood_board_assets \
                 WHERE board_id = ?1 ORDER BY position LIMIT 1 \
             ) WHERE id = ?1",
            params![id],
        );
    }
    Ok(json!({
        "ok": true,
        "id": id,
        "title": title,
        "assets_added": added,
    })
    .to_string())
}

fn tool_add_to_mood_board(args: &Value) -> Result<String, String> {
    let board_id = args
        .get("board_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "board_id required".to_string())?;
    let asset_id = args
        .get("asset_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "asset_id required".to_string())?;
    let now = chrono_like_millis();
    let conn = open_db()?;
    // Next position = max(position) + 1, or 0 if empty.
    let next_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM mood_board_assets WHERE board_id = ?1",
            params![board_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let affected = conn
        .execute(
            "INSERT OR IGNORE INTO mood_board_assets (board_id, asset_id, position, added_at) \
             VALUES (?1, ?2, ?3, ?4)",
            params![board_id, asset_id, next_pos, now],
        )
        .map_err(|e| format!("insert membership: {}", e))?;
    let _ = conn.execute(
        "UPDATE mood_boards SET updated_at = ?1 WHERE id = ?2",
        params![now, board_id],
    );
    Ok(json!({
        "ok": true,
        "added": affected > 0,
        "already_present": affected == 0,
    })
    .to_string())
}

fn tool_attach_tag(args: &Value) -> Result<String, String> {
    let target_kind = args
        .get("target_kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "target_kind required".to_string())?;
    let target_id = args
        .get("target_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "target_id required".to_string())?;
    let tag = args
        .get("tag")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "tag required".to_string())?
        .trim()
        .to_lowercase();
    if tag.is_empty() {
        return Err("tag cannot be blank".to_string());
    }
    if !matches!(target_kind, "asset" | "note") {
        return Err(format!("invalid target_kind: {}", target_kind));
    }
    let conn = open_db()?;
    // Upsert the tag row. Tags table has (id, name); we use the lowercased
    // name as the id so duplicate-name upserts are idempotent.
    let tag_id = format!("tag-{}", tag);
    conn.execute(
        "INSERT OR IGNORE INTO tags (id, name) VALUES (?1, ?2)",
        params![tag_id, tag],
    )
    .map_err(|e| format!("insert tag: {}", e))?;
    let join_table = if target_kind == "asset" {
        "asset_tags"
    } else {
        "note_tags"
    };
    let id_col = if target_kind == "asset" {
        "asset_id"
    } else {
        "note_id"
    };
    let affected = conn
        .execute(
            &format!(
                "INSERT OR IGNORE INTO {} ({}, tag_id) VALUES (?1, ?2)",
                join_table, id_col
            ),
            params![target_id, tag_id],
        )
        .map_err(|e| format!("attach tag: {}", e))?;
    Ok(json!({
        "ok": true,
        "tag": tag,
        "attached": affected > 0,
    })
    .to_string())
}

fn tool_delete_note(args: &Value) -> Result<String, String> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "id required".to_string())?;
    let conn = open_db()?;
    let affected = conn
        .execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| format!("delete note: {}", e))?;
    if affected == 0 {
        return Err(format!("no note with id: {}", id));
    }
    Ok(json!({ "ok": true, "id": id }).to_string())
}

/// Open a TCP connection to the running Orion main process, submit a
/// single-line JSON message, and return the frontend's result. The bridge
/// now round-trips: it emits a Tauri event, waits for the frontend to handle
/// it, and replies with `{ok, data?, error?}`. On `ok` we return `data` (or
/// `{}` if the action had no payload to report); otherwise we surface the
/// error to the tool so the agent sees it.
fn send_ui_action(kind: &str, payload: Value) -> Result<Value, String> {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let port = std::env::var("ORION_BRIDGE_PORT").map_err(|_| {
        "ORION_BRIDGE_PORT not set — UI bridge unavailable".to_string()
    })?;
    let token = std::env::var("ORION_BRIDGE_TOKEN").map_err(|_| {
        "ORION_BRIDGE_TOKEN not set — UI bridge unavailable".to_string()
    })?;
    let addr = format!("127.0.0.1:{}", port);
    let stream =
        TcpStream::connect(&addr).map_err(|e| format!("connect: {}", e))?;
    // Read window must comfortably exceed the bridge's frontend-wait timeout
    // (5s) so we don't cut the connection before the reply lands.
    stream
        .set_read_timeout(Some(Duration::from_secs(8)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .ok();
    let body = serde_json::json!({
        "token": token,
        "kind": kind,
        "payload": payload,
    });
    let mut line = body.to_string();
    line.push('\n');
    {
        let mut writer = &stream;
        writer.write_all(line.as_bytes()).map_err(|e| format!("write: {}", e))?;
    }
    let mut buf = String::new();
    let mut reader = BufReader::new(&stream);
    reader.read_line(&mut buf).map_err(|e| format!("read: {}", e))?;
    let resp: Value = serde_json::from_str(buf.trim())
        .map_err(|e| format!("bad bridge response: {}", e))?;
    if resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(resp.get("data").cloned().unwrap_or_else(|| json!({})))
    } else {
        Err(resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("ui action failed")
            .to_string())
    }
}

fn chrono_like_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn tool_list_projects(_args: &Value) -> Result<String, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, root_path, last_opened_at FROM projects ORDER BY last_opened_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let name: String = r.get(1)?;
            let root_path: String = r.get(2)?;
            let last_opened_at: i64 = r.get(3)?;
            Ok(json!({
                "id": id,
                "name": name,
                "root_path": root_path,
                "last_opened_at": last_opened_at,
            }))
        })
        .map_err(|e| e.to_string())?;
    let collected: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!({ "projects": collected }).to_string())
}
