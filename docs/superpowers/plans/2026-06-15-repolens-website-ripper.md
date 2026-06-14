# RepoLens Website Ripper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Websites" tab inside RepoLens (Archives) that clones any public URL into an editable Next.js 16 + shadcn project via a streaming, long-running `claude` subprocess, saves each rip to its own library card with a thumbnail, and opens finished rips in Orion.

**Architecture:** A dedicated Rust engine (`repolens_website.rs`) modeled on `hermes.rs` runs **one** clone agent per rip in `$APPDATA/repolens/websites/<ulid>/project/` (a vendored, git-initialized scaffold of the [JCodesMore template](https://github.com/JCodesMore/ai-website-cloner-template), MIT). The agent drives a **headless Playwright MCP** browser and follows the template's vendored `SKILL.md`. Progress streams to the frontend via a `repolens:website` Tauri event; a poll-based watcher promotes the agent's first recon screenshot to the card thumbnail. The frontend adds a Repos/Websites tab toggle, a websites grid, and a live progress panel — all under the existing RepoLens surface.

**Tech Stack:** Tauri 2 (Rust), React 19 + TypeScript + Zustand, `claude` CLI (stream-json), Playwright MCP (`npx @playwright/mcp`), SQLite (`tauri-plugin-sql`, append-only migrations). Vendored scaffold: Next.js 16 / React 19 / shadcn / Tailwind v4.

---

## Improvements baked in beyond the original spec

These correct gaps found while grounding the spec against the real codebase, the real template `SKILL.md`, and the live environment. They are **decisions already made** (two confirmed with the user) — implement them as written:

1. **Browser = Playwright MCP, not `--chrome`** (user-confirmed). The engine writes a dedicated rip MCP config containing only a headless Playwright server and runs the agent with `--strict-mcp-config`. `--chrome` is a real flag but attaches to the interactive Claude-in-Chrome integration, unreliable from a headless `--print` subprocess. Playwright MCP is self-contained and deterministic. The Orion MCP is intentionally **excluded** from rips (a clone doesn't need note/file tools; excluding it also cuts the per-turn token cost flagged in CLAUDE.md).
2. **Thumbnails = raw recon screenshot, CSS-scaled** (user-confirmed). The codebase has no image-resize code; the spec's "512px WebP" would add unapproved Rust crates. Instead `thumbnail_path` points at the first full-page screenshot the agent saves under `docs/design-references/`, displayed with `object-fit: cover`. No new dependencies.
3. **`git init` + commit the scaffold before spawning** (spec missed this). The `SKILL.md` dispatches parallel builders **in git worktrees** and merges them. Worktree creation fails unless `project/` is already a git repo with at least one commit.
4. **Node ≥ 24 is a hard prerequisite** (spec missed this). The template declares `"engines": { "node": ">=24" }` and builds Next.js 16; the dev machine currently runs Node 22. The engine performs a preflight Node-version check and surfaces a clear error instead of letting `npm install`/`build` fail cryptically. **The user must upgrade Node (e.g. `nvm install 24 && nvm alias default 24`) before rips will succeed.**
5. **CLONE_PROMPT references the vendored `SKILL.md` by path** rather than inlining 475 lines — the agent runs with `cwd = project/`, so it reads `.claude/skills/clone-website/SKILL.md` verbatim. Keeps the prompt small and avoids drift from the upstream skill.
6. **First-rip environment setup is explicit**: the engine runs `npx -y playwright install chromium` (idempotent, cached) during setup so the browser binary exists. This adds time to the first rip only.

---

## File Structure

**Rust (backend):**
- Create `src-tauri/src/repolens_website.rs` — the engine: commands, subprocess spawn, stream-json parsing, thumbnail watcher, boot reconcile, scaffold copy, preflight.
- Create `src-tauri/migrations/0022_repolens_websites.sql` — the `repolens_websites` table.
- Modify `src-tauri/src/lib.rs` — declare `mod repolens_website;`, register migration 22, register the four commands, call boot reconcile in `.setup`.
- Modify `src-tauri/tauri.conf.json` — add `bundle.resources` so the scaffold ships in the `.app`.
- Vendor `resources/website-cloner-scaffold/**` — the template at a pinned commit (no `.git`, no `node_modules`).

**TypeScript (frontend), all under `src/apps/archives/repolens/`:**
- Create `repolensWebsitesDb.ts` — CRUD helpers + `WebsiteRipRow` type.
- Create `websiteRip.ts` — pure helpers (hostname parse, status reducer, queue pump, thumbnail URL) — the unit-tested core.
- Create `websiteRip.test.ts` — tests for the pure helpers.
- Create `useRepoLensWebsites.ts` — Zustand store: rips list, queue, dispatch/cancel/continue/delete, event appliers.
- Create `RepoLensWebsitesLibrary.tsx` — the websites grid (cards + context menus + empty state).
- Create `RepoLensWebsiteProgress.tsx` — live progress panel (tool feed + phase) for an in-flight rip.
- Modify `RepoLensView.tsx` — Repos/Websites tab toggle; adapt scan bar (Scan vs Rip); route body.

**Wiring:**
- Modify `src/lib/ipc.ts` — four `ipc.repolensWebsite*` wrappers.
- Modify `src/app/EventBridge.tsx` — listen for `repolens:website`, route to the store.
- Modify `src/styles/tokens.css` — `.rl-web-*` block.

---

## Task 1: Vendor the cloner scaffold

**Files:**
- Create: `resources/website-cloner-scaffold/**` (copied)
- Create: `resources/website-cloner-scaffold/VENDOR.md` (provenance note)

- [ ] **Step 1: Clone the template at HEAD of `master` and strip git**

Run:
```bash
cd /tmp && rm -rf wct && git clone --depth 1 --branch master https://github.com/JCodesMore/ai-website-cloner-template.git wct
cd /tmp/wct && git rev-parse HEAD   # record this SHA for VENDOR.md
rm -rf /tmp/wct/.git
cd /Users/lucaorion/Orion_Terminal && mkdir -p resources/website-cloner-scaffold
cp -R /tmp/wct/. resources/website-cloner-scaffold/
```
Expected: `resources/website-cloner-scaffold/` contains `package.json`, `package-lock.json`, `src/`, `docs/`, `.claude/skills/clone-website/SKILL.md`, `LICENSE`, `components.json`, `next.config.ts`, etc. It must **not** contain `.git/` or `node_modules/`.

- [ ] **Step 2: Verify the vendored skill and license are present**

Run: `ls resources/website-cloner-scaffold/.claude/skills/clone-website/SKILL.md resources/website-cloner-scaffold/LICENSE`
Expected: both paths exist (no error).

- [ ] **Step 3: Write the provenance note**

Create `resources/website-cloner-scaffold/VENDOR.md`:
```markdown
# Vendored scaffold

Source: https://github.com/JCodesMore/ai-website-cloner-template (MIT, © JCodesMore)
Pinned commit: <SHA recorded in Step 1>
Vendored: 2026-06-15

This directory is copied verbatim per website rip into
`$APPDATA/repolens/websites/<id>/project/`. Do not edit by hand — re-vendor
from upstream to update. The MIT LICENSE is retained alongside the source.
```

- [ ] **Step 4: Add MIT attribution to Settings → About**

Modify the About section of `src/features/settings/SettingsPanel.tsx` (find the existing attribution/credits area) to add one line: `Website Ripper scaffold © JCodesMore (MIT) — github.com/JCodesMore/ai-website-cloner-template`.

- [ ] **Step 5: Commit**
```bash
git add resources/website-cloner-scaffold src/features/settings/SettingsPanel.tsx
git commit -m "feat(repolens): vendor ai-website-cloner-template scaffold (MIT)"
```

---

## Task 2: Migration 0022 — `repolens_websites`

**Files:**
- Create: `src-tauri/migrations/0022_repolens_websites.sql`
- Modify: `src-tauri/src/lib.rs` (migrations vec)

- [ ] **Step 1: Write the migration**

Create `src-tauri/migrations/0022_repolens_websites.sql`:
```sql
CREATE TABLE IF NOT EXISTS repolens_websites (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  hostname        TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,           -- queued|running|done|error|cancelled|paused
  phase           TEXT NOT NULL DEFAULT '',
  project_path    TEXT NOT NULL,
  thumbnail_path  TEXT,
  log             TEXT NOT NULL DEFAULT '',
  session_id      TEXT,
  error           TEXT,
  model           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repolens_websites_updated ON repolens_websites(updated_at DESC);
```

- [ ] **Step 2: Register the migration in lib.rs**

In `src-tauri/src/lib.rs`, immediately after the version-21 `Migration { ... }` entry (around line 149), add:
```rust
        Migration {
            version: 22,
            description: "repolens: website rips (clone pipeline runs + thumbnails)",
            sql: include_str!("../migrations/0022_repolens_websites.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (migration is `include_str!`'d — a missing file fails the build).

- [ ] **Step 4: Commit**
```bash
git add src-tauri/migrations/0022_repolens_websites.sql src-tauri/src/lib.rs
git commit -m "feat(repolens): migration 0022 repolens_websites"
```

---

## Task 3: Frontend DB helpers — `repolensWebsitesDb.ts`

**Files:**
- Create: `src/apps/archives/repolens/repolensWebsitesDb.ts`

Mirror the existing `repolensDb.ts` pattern (uses the shared SQLite handle from `src/lib/db.ts` — open the existing file first to copy its `getDb()`/query idiom exactly).

- [ ] **Step 1: Read the existing db helper to copy the exact handle pattern**

Run: `sed -n '1,40p' src/apps/archives/repolens/repolensDb.ts`
Expected: shows how it imports the DB handle and runs `select`/`execute`. Use the identical import + handle accessor below.

- [ ] **Step 2: Write the helper module**

Create `src/apps/archives/repolens/repolensWebsitesDb.ts`:
```typescript
import { getDb } from "../../../lib/db"; // match the import path used by repolensDb.ts

export type WebsiteStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled"
  | "paused";

export type WebsiteRipRow = {
  id: string;
  url: string;
  hostname: string;
  title: string;
  status: WebsiteStatus;
  phase: string;
  project_path: string;
  thumbnail_path: string | null;
  log: string;
  session_id: string | null;
  error: string | null;
  model: string;
  created_at: number;
  updated_at: number;
};

export async function listRips(limit = 100): Promise<WebsiteRipRow[]> {
  const db = await getDb();
  return db.select<WebsiteRipRow[]>(
    "SELECT * FROM repolens_websites ORDER BY updated_at DESC LIMIT ?1",
    [limit],
  );
}

export async function getRip(id: string): Promise<WebsiteRipRow | null> {
  const db = await getDb();
  const rows = await db.select<WebsiteRipRow[]>(
    "SELECT * FROM repolens_websites WHERE id = ?1",
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteRipRow(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM repolens_websites WHERE id = ?1", [id]);
}
```
Note: inserts/updates during a rip are owned by the **Rust engine** (single writer while running), so the frontend only reads and deletes here. Deletion of files is handled by the engine command in Task 5 (`repolens_website_delete`); `deleteRipRow` is a fallback for rows with no files.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors referencing `repolensWebsitesDb.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/apps/archives/repolens/repolensWebsitesDb.ts
git commit -m "feat(repolens): website rip db read helpers"
```

---

## Task 4: Pure helpers + tests — `websiteRip.ts`

**Files:**
- Create: `src/apps/archives/repolens/websiteRip.ts`
- Test: `src/apps/archives/repolens/websiteRip.test.ts`

These are the testable, framework-free pieces. TDD them.

- [ ] **Step 1: Write the failing tests**

Create `src/apps/archives/repolens/websiteRip.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  parseUrl,
  isTerminal,
  nextQueued,
  phaseLabel,
} from "./websiteRip";
import type { WebsiteRipRow } from "./repolensWebsitesDb";

describe("parseUrl", () => {
  it("extracts hostname and normalizes a bare domain", () => {
    expect(parseUrl("example.com")).toEqual({
      url: "https://example.com",
      hostname: "example.com",
    });
  });
  it("keeps an explicit scheme and strips www", () => {
    expect(parseUrl("https://www.stripe.com/pricing")).toEqual({
      url: "https://www.stripe.com/pricing",
      hostname: "stripe.com",
    });
  });
  it("returns null for junk", () => {
    expect(parseUrl("not a url")).toBeNull();
    expect(parseUrl("")).toBeNull();
  });
});

describe("isTerminal", () => {
  it("is true for done/error/cancelled, false for active states", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("error")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("paused")).toBe(false);
  });
});

describe("nextQueued", () => {
  const row = (id: string, status: WebsiteRipRow["status"]): WebsiteRipRow => ({
    id, url: "https://x", hostname: "x", title: "", status, phase: "",
    project_path: "", thumbnail_path: null, log: "", session_id: null,
    error: null, model: "", created_at: 0, updated_at: 0,
  });
  it("returns null when a rip is already running", () => {
    expect(nextQueued([row("a", "running"), row("b", "queued")])).toBeNull();
  });
  it("returns the oldest queued id when nothing is running", () => {
    expect(nextQueued([row("a", "done"), row("b", "queued"), row("c", "queued")])).toBe("b");
  });
  it("returns null when nothing is queued", () => {
    expect(nextQueued([row("a", "done")])).toBeNull();
  });
});

describe("phaseLabel", () => {
  it("maps known phases to friendly labels and passes through unknown", () => {
    expect(phaseLabel("recon")).toBe("Recon");
    expect(phaseLabel("building")).toBe("Building");
    expect(phaseLabel("")).toBe("Working");
    expect(phaseLabel("foundation")).toBe("Foundation");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/apps/archives/repolens/websiteRip.test.ts`
Expected: FAIL — `websiteRip.ts` does not exist / exports undefined.

- [ ] **Step 3: Implement the helpers**

Create `src/apps/archives/repolens/websiteRip.ts`:
```typescript
import type { WebsiteRipRow, WebsiteStatus } from "./repolensWebsitesDb";

export function parseUrl(raw: string): { url: string; hostname: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (!u.hostname.includes(".")) return null;
  const hostname = u.hostname.replace(/^www\./i, "");
  return { url: withScheme, hostname };
}

export function isTerminal(status: WebsiteStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

// Concurrency cap = 1. Returns the id of the oldest queued rip to dispatch,
// or null if one is already running (or nothing is queued).
export function nextQueued(rows: WebsiteRipRow[]): string | null {
  if (rows.some((r) => r.status === "running")) return null;
  const queued = rows
    .filter((r) => r.status === "queued")
    .sort((a, b) => a.created_at - b.created_at);
  return queued[0]?.id ?? null;
}

const PHASES: Record<string, string> = {
  queued: "Queued",
  recon: "Recon",
  foundation: "Foundation",
  building: "Building",
  assembly: "Assembly",
  qa: "Visual QA",
  done: "Done",
};

export function phaseLabel(phase: string): string {
  if (!phase) return "Working";
  return PHASES[phase] ?? phase.charAt(0).toUpperCase() + phase.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/apps/archives/repolens/websiteRip.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**
```bash
git add src/apps/archives/repolens/websiteRip.ts src/apps/archives/repolens/websiteRip.test.ts
git commit -m "feat(repolens): pure website-rip helpers + tests"
```

---

## Task 5: Rust engine — `repolens_website.rs`

**Files:**
- Create: `src-tauri/src/repolens_website.rs`
- Modify: `src-tauri/src/lib.rs` (mod decl, command registration, boot reconcile)

This is the largest task. Build it incrementally; verify with `cargo check`/`cargo test` after each sub-step. It mirrors `hermes.rs` — open `src-tauri/src/hermes.rs` and copy its exact idioms for: `augmented_path()` use, `Command` construction, stdout stream-json line loop, `tokio::select!` cancel, `AppHandle.emit`, `Connection` open + `busy_timeout`, and the `AGENTS`/`Notify` cancel map.

- [ ] **Step 1: Write a unit-testable helper test first (thumbnail picker + node version check)**

Create the test at the bottom of `src-tauri/src/repolens_website.rs` (Rust convention — `#[cfg(test)] mod tests`). First write just the failing test and the empty function signatures:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_major_parses() {
        assert_eq!(parse_node_major("v24.3.0\n"), Some(24));
        assert_eq!(parse_node_major("v22.14.0"), Some(22));
        assert_eq!(parse_node_major("garbage"), None);
    }

    #[test]
    fn first_image_picks_png_over_md() {
        // pick_thumbnail returns the first image-extension file name from a list,
        // ignoring non-image files; preserves input order.
        let files = vec![
            "BEHAVIORS.md".to_string(),
            "hero-desktop.png".to_string(),
            "notes.txt".to_string(),
        ];
        assert_eq!(pick_thumbnail(&files), Some("hero-desktop.png".to_string()));
        assert_eq!(pick_thumbnail(&["only.md".to_string()]), None);
    }
}
```

- [ ] **Step 2: Write the module skeleton with the two tested helpers + types**

Create `src-tauri/src/repolens_website.rs` (top of file; full command bodies come in later steps):
```rust
//! Website-rip engine: one long-running `claude` clone agent per rip.
//! Modeled on `hermes.rs` (single-agent variant). Drives a headless Playwright
//! MCP browser, follows the vendored clone-website SKILL.md, streams progress
//! via the `repolens:website` event, and promotes the first recon screenshot
//! to the rip's thumbnail.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::claude_cli::{augmented_path, OPUS_MODEL};

const MAX_TURNS: &str = "50";
const IMAGE_EXTS: [&str; 4] = ["png", "webp", "jpg", "jpeg"];

static RIPS: Lazy<Mutex<HashMap<String, Arc<Notify>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
struct WebsiteEvent {
    id: String,
    status: String,
    phase: String,
    #[serde(rename = "logDelta", skip_serializing_if = "Option::is_none")]
    log_delta: Option<String>,
    #[serde(rename = "thumbnailPath", skip_serializing_if = "Option::is_none")]
    thumbnail_path: Option<String>,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("orion.db"))
}

fn open_conn(app: &AppHandle) -> Result<Connection, String> {
    let c = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    let _ = c.busy_timeout(Duration::from_secs(5));
    Ok(c)
}

fn parse_node_major(version_output: &str) -> Option<u32> {
    let v = version_output.trim().trim_start_matches('v');
    v.split('.').next()?.parse::<u32>().ok()
}

fn pick_thumbnail(file_names: &[String]) -> Option<String> {
    file_names.iter().find(|n| {
        Path::new(n.as_str())
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
            .unwrap_or(false)
    }).cloned()
}
```

- [ ] **Step 3: Run the helper tests**

Run: `cd src-tauri && cargo test repolens_website`
Expected: PASS (`node_major_parses`, `first_image_picks_png_over_md`). It will warn about unused functions — acceptable until later steps wire them.

- [ ] **Step 4: Add the rips dir, scaffold copy, MCP config writer, and CLONE_PROMPT**

Append to `repolens_website.rs`:
```rust
fn websites_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?
        .join("repolens").join("websites");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn scaffold_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Bundled resource in release; resolves from the project in dev.
    let p = app.path()
        .resolve("website-cloner-scaffold", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if p.exists() { return Ok(p); }
    // Dev fallback: repo-relative resources dir.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().map(|r| r.join("resources").join("website-cloner-scaffold"))
        .ok_or("scaffold not found")?;
    if dev.exists() { Ok(dev) } else { Err("website-cloner-scaffold resource missing".into()) }
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// Dedicated rip MCP config: headless Playwright only. Returns the file path.
fn write_rip_mcp(project: &Path) -> Result<String, String> {
    let cfg = serde_json::json!({
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]
            }
        }
    });
    let path = project.join(".rip-mcp.json");
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn clone_prompt(url: &str) -> String {
    format!(
        "You are cloning a website into THIS Next.js project (your current working directory).\n\n\
Target URL: {url}\n\n\
Follow the clone-website skill verbatim. Read the full instructions at \
`.claude/skills/clone-website/SKILL.md` in this project and execute every phase \
(recon, foundation, component specs, parallel builders in git worktrees, assembly, visual QA).\n\n\
Browser automation: a headless Playwright MCP server is attached (tools prefixed \
`mcp__playwright__`). Use it for all navigation, screenshots, and DOM/CSS extraction.\n\n\
IMPORTANT for progress reporting:\n\
- Very early in recon, save a full-page desktop screenshot (1440px) into \
`docs/design-references/` (e.g. `home-desktop.png`). This is used as the rip's preview thumbnail, so do it before deep extraction.\n\
- This project is already a git repository with an initial commit; create worktrees off the current branch for parallel builders and merge them back.\n\
- Verify `npm run build` passes before you finish.\n",
        url = url
    )
}
```

- [ ] **Step 5: Add preflight (Node ≥ 24) and the dispatch command**

Append to `repolens_website.rs`:
```rust
fn preflight() -> Result<(), String> {
    let out = std::process::Command::new("node")
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .map_err(|_| "Node.js not found on PATH. Install Node 24+ to use the website ripper.".to_string())?;
    let ver = String::from_utf8_lossy(&out.stdout);
    match parse_node_major(&ver) {
        Some(n) if n >= 24 => Ok(()),
        Some(n) => Err(format!("Node {n} found, but the cloner scaffold needs Node 24+. Upgrade Node (e.g. `nvm install 24`).")),
        None => Err("Could not determine the Node.js version.".into()),
    }
}

#[tauri::command]
pub async fn repolens_website_rip(
    app: AppHandle,
    url: String,
    model: Option<String>,
) -> Result<String, String> {
    let parsed = url.trim().to_string();
    let host = parsed
        .replace("https://", "").replace("http://", "")
        .split('/').next().unwrap_or("site").trim_start_matches("www.").to_string();
    let id = crate::ulid_like(); // see Step 5b
    let root = websites_root(&app)?;
    let dir = root.join(&id);
    let project = dir.join("project");
    let model = model.filter(|m| !m.is_empty()).unwrap_or_else(|| OPUS_MODEL.to_string());

    // Insert the row up front so the card appears immediately.
    {
        let conn = open_conn(&app)?;
        conn.execute(
            "INSERT INTO repolens_websites (id, url, hostname, title, status, phase, project_path, thumbnail_path, log, session_id, error, model, created_at, updated_at) \
             VALUES (?1, ?2, ?3, '', 'running', 'recon', ?4, NULL, '', NULL, NULL, ?5, ?6, ?6)",
            params![id, parsed, host, project.to_string_lossy(), model, now_ms()],
        ).map_err(|e| e.to_string())?;
    }
    emit(&app, &id, "running", "recon", None, None, None);

    // Heavy setup + run happens on a background task so the command returns fast.
    let app2 = app.clone();
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = setup_and_run(app2.clone(), id2.clone(), parsed, project, model).await {
            fail(&app2, &id2, &e);
        }
    });
    Ok(id)
}
```

- [ ] **Step 5b: Add a small ULID helper if one isn't already exported**

Check first: `grep -rn "pub fn ulid" src-tauri/src`. If hermes/asset already exposes one, import and use it instead of `crate::ulid_like`. Otherwise add to `repolens_website.rs`:
```rust
fn ulid_like() -> String {
    // Time-ordered, collision-resistant enough for local rip ids.
    let t = now_ms();
    let r: u64 = {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        RandomState::new().build_hasher().finish()
    };
    format!("rip_{:x}{:x}", t, r)
}
```
and replace `crate::ulid_like()` with `ulid_like()`.

- [ ] **Step 6: Implement `setup_and_run` (scaffold copy → npm install → git init → playwright install → spawn agent → stream)**

Append:
```rust
async fn setup_and_run(
    app: AppHandle,
    id: String,
    url: String,
    project: PathBuf,
    model: String,
) -> Result<(), String> {
    preflight()?;

    // 1. Copy scaffold.
    set_phase(&app, &id, "running", "recon");
    let scaffold = scaffold_dir(&app)?;
    {
        let project = project.clone();
        tauri::async_runtime::spawn_blocking(move || copy_dir_all(&scaffold, &project))
            .await.map_err(|e| e.to_string())?
            .map_err(|e| format!("copy scaffold: {e}"))?;
    }

    // 2. npm install + git init + playwright browser (blocking, augmented PATH).
    {
        let project = project.clone();
        tauri::async_runtime::spawn_blocking(move || run_setup_commands(&project))
            .await.map_err(|e| e.to_string())??;
    }

    // 3. Spawn the clone agent and stream.
    let mcp = write_rip_mcp(&project)?;
    run_agent(app, id, url, project, model, mcp, None).await
}

fn run_setup_commands(project: &Path) -> Result<(), String> {
    let path = augmented_path();
    let sh = |args: &[&str], cwd: &Path| -> Result<(), String> {
        let out = std::process::Command::new(args[0])
            .args(&args[1..]).current_dir(cwd).env("PATH", &path)
            .output().map_err(|e| format!("{}: {e}", args[0]))?;
        if !out.status.success() {
            return Err(format!("{} failed: {}", args[0], String::from_utf8_lossy(&out.stderr)));
        }
        Ok(())
    };
    sh(&["npm", "install"], project)?;
    sh(&["git", "init"], project)?;
    sh(&["git", "add", "-A"], project)?;
    sh(&["git", "commit", "-m", "scaffold", "--quiet",
         "-c", "user.email=ripper@orion.local", "-c", "user.name=Orion Ripper"], project)?;
    // Best-effort browser download (idempotent/cached); don't fail the rip if it errors.
    let _ = sh(&["npx", "-y", "playwright", "install", "chromium"], project);
    Ok(())
}
```

- [ ] **Step 7: Implement `run_agent` (stream-json loop, tool-feed compose, thumbnail watcher, cancel, paused)**

Append (mirror hermes.rs `run_agent` exactly for the parse loop; the snippet below is the spine — fill tool-feed composition by copying hermes's `collect_tool_uses`/`compose_feed` helpers into this module or factoring them shared):
```rust
async fn run_agent(
    app: AppHandle,
    id: String,
    url: String,
    project: PathBuf,
    model: String,
    mcp: String,
    resume: Option<String>,
) -> Result<(), String> {
    let mut cmd = Command::new("claude");
    cmd.args(["--print", "--output-format", "stream-json", "--verbose",
              "--permission-mode", "bypassPermissions", "--model", &model,
              "--mcp-config", &mcp, "--strict-mcp-config",
              "--max-turns", MAX_TURNS]);
    if let Some(sid) = resume.filter(|s| !s.is_empty()) {
        cmd.args(["--resume", &sid]);
    }
    cmd.arg("--").arg(clone_prompt(&url));
    cmd.current_dir(&project);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    let cancel = Arc::new(Notify::new());
    RIPS.lock().insert(id.clone(), cancel.clone());

    // Thumbnail watcher: poll docs/design-references for the first image.
    spawn_thumbnail_watcher(app.clone(), id.clone(), project.clone());

    let mut log = String::new();
    let mut session: Option<String> = None;
    let mut paused = false;
    let result: Result<(), ()> = loop {
        tokio::select! {
            _ = cancel.notified() => { let _ = child.kill().await; let _ = child.wait().await; break Err(()); }
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let v: serde_json::Value = match serde_json::from_str(&l) { Ok(v) => v, Err(_) => continue };
                        if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                            if session.as_deref() != Some(sid) { session = Some(sid.to_string()); }
                        }
                        // Compose a tool-feed / prose line exactly as hermes does.
                        if let Some(delta) = hermes_style_feed_line(&v) {
                            log.push_str(&delta); log.push('\n');
                            persist_log(&app, &id, &log);
                            emit(&app, &id, "running", &infer_phase(&log), Some(delta), None, session.clone());
                        }
                        if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                            let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
                            let is_err = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
                            if subtype == "error_max_turns" { paused = true; break Ok(()); }
                            if is_err || (subtype != "success" && !subtype.is_empty()) {
                                let msg = v.get("result").and_then(|r| r.as_str()).unwrap_or("agent error").to_string();
                                RIPS.lock().remove(&id);
                                return Err(msg);
                            }
                            break Ok(());
                        }
                    }
                    Ok(None) => break Ok(()),
                    Err(_) => break Err(()),
                }
            }
        }
    };
    RIPS.lock().remove(&id);

    let _ = child.wait().await;
    match result {
        Err(_) => { mark(&app, &id, "cancelled", None, session); Ok(()) }
        Ok(()) if paused => { mark(&app, &id, "paused", None, session); Ok(()) }
        Ok(()) => {
            // Title from the cloned <title> if available; else hostname.
            mark(&app, &id, "done", None, session);
            Ok(())
        }
    }
}
```
Helper functions referenced above (`emit`, `mark`, `fail`, `set_phase`, `persist_log`, `infer_phase`, `hermes_style_feed_line`, `spawn_thumbnail_watcher`) are defined in Step 8. `infer_phase` is a coarse phase guess from the latest log text (e.g. contains "worktree"/"builder" → "building", "globals.css"/"foundation" → "foundation", "QA"/"comparison" → "qa", else current).

- [ ] **Step 8: Implement the emit/persist/thumbnail helpers**

Append:
```rust
fn emit(app: &AppHandle, id: &str, status: &str, phase: &str,
        log_delta: Option<String>, thumb: Option<String>, session: Option<String>) {
    let _ = app.emit("repolens:website", WebsiteEvent {
        id: id.to_string(), status: status.to_string(), phase: phase.to_string(),
        log_delta, thumbnail_path: thumb, session_id: session,
    });
}

fn persist_log(app: &AppHandle, id: &str, log: &str) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET log = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, log, now_ms()]);
    }
}

fn set_phase(app: &AppHandle, id: &str, status: &str, phase: &str) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET status = ?2, phase = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, status, phase, now_ms()]);
    }
    emit(app, id, status, phase, None, None, None);
}

fn mark(app: &AppHandle, id: &str, status: &str, error: Option<&str>, session: Option<String>) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET status = ?2, error = ?3, session_id = COALESCE(?4, session_id), updated_at = ?5 WHERE id = ?1",
            params![id, status, error, session, now_ms()]);
    }
    emit(app, id, status, "", None, None, session);
}

fn fail(app: &AppHandle, id: &str, msg: &str) {
    mark(app, id, "error", Some(msg), None);
}

fn spawn_thumbnail_watcher(app: AppHandle, id: String, project: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let refs = project.join("docs").join("design-references");
        for _ in 0..900 {  // up to ~30 min at 2s
            if RIPS.lock().get(&id).is_none() { return; } // rip ended
            if let Ok(rd) = std::fs::read_dir(&refs) {
                let mut names: Vec<String> = rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned()).collect();
                names.sort();
                if let Some(img) = pick_thumbnail(&names) {
                    let full = refs.join(&img).to_string_lossy().into_owned();
                    if let Ok(conn) = open_conn(&app) {
                        let _ = conn.execute(
                            "UPDATE repolens_websites SET thumbnail_path = ?2, updated_at = ?3 WHERE id = ?1 AND thumbnail_path IS NULL",
                            params![id, full, now_ms()]);
                    }
                    emit(&app, &id, "running", "", None, Some(full), None);
                    return;
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
```
For `hermes_style_feed_line` and `infer_phase`: copy hermes.rs's tool-feed composition (the `▸ <tool>  <brief>` / `✗ <tool> failed` / prose-tail logic) into this module as `hermes_style_feed_line(v: &serde_json::Value) -> Option<String>`, returning the rendered line for assistant/tool events. Keep it small.

- [ ] **Step 9: Implement cancel / continue / delete commands**

Append:
```rust
#[tauri::command]
pub fn repolens_website_cancel(id: String) -> Result<(), String> {
    if let Some(n) = RIPS.lock().remove(&id) { n.notify_waiters(); }
    Ok(())
}

#[tauri::command]
pub async fn repolens_website_continue(app: AppHandle, id: String) -> Result<(), String> {
    let (url, project, model, session) = {
        let conn = open_conn(&app)?;
        conn.query_row(
            "SELECT url, project_path, model, session_id FROM repolens_websites WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?)),
        ).map_err(|e| e.to_string())?
    };
    set_phase(&app, &id, "running", "building");
    let project = PathBuf::from(project);
    let mcp = write_rip_mcp(&project)?;
    let app2 = app.clone(); let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_agent(app2.clone(), id2.clone(), url, project, model, mcp, session).await {
            fail(&app2, &id2, &e);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn repolens_website_delete(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(n) = RIPS.lock().remove(&id) { n.notify_waiters(); }
    let dir = {
        let conn = open_conn(&app)?;
        let p: String = conn.query_row(
            "SELECT project_path FROM repolens_websites WHERE id = ?1", params![id],
            |r| r.get(0)).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM repolens_websites WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        // project_path is <dir>/project — delete the parent rip dir.
        PathBuf::from(p).parent().map(|p| p.to_path_buf())
    };
    if let Some(d) = dir { let _ = std::fs::remove_dir_all(d); }
    Ok(())
}

// Called once at boot: any rip left "running" by a crash → "error".
pub fn reconcile_on_boot(app: &AppHandle) {
    if let Ok(conn) = open_conn(app) {
        let _ = conn.execute(
            "UPDATE repolens_websites SET status = 'error', error = 'interrupted by restart', updated_at = ?1 WHERE status = 'running'",
            params![now_ms()]);
    }
}
```

- [ ] **Step 10: Wire into lib.rs**

In `src-tauri/src/lib.rs`:
- After `mod repolens;` (line 15) add: `mod repolens_website;`
- In `.setup(|app| { ... })` (near line 162), after existing init, add: `repolens_website::reconcile_on_boot(&app.handle());`
- In `tauri::generate_handler![ ... ]`, after the `repolens::*` entries (line 216), add:
```rust
            repolens_website::repolens_website_rip,
            repolens_website::repolens_website_cancel,
            repolens_website::repolens_website_continue,
            repolens_website::repolens_website_delete,
```

- [ ] **Step 11: Add the scaffold to bundled resources**

In `src-tauri/tauri.conf.json`, inside `"bundle": { ... }`, add (create the key if absent):
```json
    "resources": ["../resources/website-cloner-scaffold"],
```
Note: verify the relative path resolves from `src-tauri/` — adjust to `"resources/..."` if the project root is the bundle base.

- [ ] **Step 12: Verify backend compiles and helper tests pass**

Run: `cd src-tauri && cargo check && cargo test repolens_website`
Expected: compiles clean; the two unit tests pass.

- [ ] **Step 13: Commit**
```bash
git add src-tauri/src/repolens_website.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "feat(repolens): website rip engine (Rust) + bundle scaffold resource"
```

---

## Task 6: IPC wrappers

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the four wrappers**

In `src/lib/ipc.ts`, alongside the `hermes*` wrappers (~line 205), add:
```typescript
  repolensWebsiteRip: (url: string, model: string | null = null): Promise<string> =>
    invoke<string>("repolens_website_rip", { url, model }),
  repolensWebsiteCancel: (id: string): Promise<void> =>
    invoke("repolens_website_cancel", { id }),
  repolensWebsiteContinue: (id: string): Promise<void> =>
    invoke("repolens_website_continue", { id }),
  repolensWebsiteDelete: (id: string): Promise<void> =>
    invoke("repolens_website_delete", { id }),
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/lib/ipc.ts
git commit -m "feat(repolens): website rip ipc wrappers"
```

---

## Task 7: Store — `useRepoLensWebsites.ts`

**Files:**
- Create: `src/apps/archives/repolens/useRepoLensWebsites.ts`

- [ ] **Step 1: Write the store**

Create `src/apps/archives/repolens/useRepoLensWebsites.ts`:
```typescript
import { create } from "zustand";
import { ipc } from "../../../lib/ipc";
import { listRips, type WebsiteRipRow } from "./repolensWebsitesDb";
import { parseUrl, isTerminal } from "./websiteRip";
import { toast } from "../../../shell/toastStore"; // match the actual toast import used elsewhere
import { useProjectStore } from "../../../store/projectStore";
import { useShell } from "../../../shell/store/useShell";

type WebsiteEvent = {
  id: string;
  status: WebsiteRipRow["status"];
  phase: string;
  logDelta?: string;
  thumbnailPath?: string;
  sessionId?: string | null;
};

type State = {
  rips: WebsiteRipRow[];
  loaded: boolean;
  load: () => Promise<void>;
  rip: (rawUrl: string, model: string | null) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  continueRip: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  openInOrion: (id: string) => Promise<void>;
  applyEvent: (e: WebsiteEvent) => void;
};

export const useRepoLensWebsites = create<State>((set, get) => ({
  rips: [],
  loaded: false,

  load: async () => {
    const rips = await listRips();
    set({ rips, loaded: true });
  },

  rip: async (rawUrl, model) => {
    const parsed = parseUrl(rawUrl);
    if (!parsed) { toast.error("Enter a valid URL"); return; }
    // Concurrency cap = 1: refuse if one is already running.
    if (get().rips.some((r) => r.status === "running")) {
      toast.info("A rip is already running — it'll need to finish first.");
      return;
    }
    try {
      await ipc.repolensWebsiteRip(parsed.url, model);
      await get().load();
    } catch (e) {
      toast.error(`Rip failed to start: ${String(e)}`);
    }
  },

  cancel: async (id) => { await ipc.repolensWebsiteCancel(id); await get().load(); },
  continueRip: async (id) => { await ipc.repolensWebsiteContinue(id); await get().load(); },
  remove: async (id) => {
    await ipc.repolensWebsiteDelete(id);
    set((s) => ({ rips: s.rips.filter((r) => r.id !== id) }));
  },

  openInOrion: async (id) => {
    const row = get().rips.find((r) => r.id === id);
    if (!row) return;
    await useProjectStore.getState().openProjectAtPath(row.project_path);
    useShell.getState().openApp("orion");
    toast.info("Run `npm run dev` in the terminal to preview the clone.");
  },

  applyEvent: (e) => {
    set((s) => {
      const i = s.rips.findIndex((r) => r.id === e.id);
      if (i === -1) { void get().load(); return s; }
      const cur = s.rips[i];
      const next: WebsiteRipRow = {
        ...cur,
        status: e.status,
        phase: e.phase || cur.phase,
        log: e.logDelta ? `${cur.log}${e.logDelta}\n` : cur.log,
        thumbnail_path: e.thumbnailPath ?? cur.thumbnail_path,
        session_id: e.sessionId ?? cur.session_id,
        updated_at: Date.now(),
      };
      const rips = [...s.rips]; rips[i] = next;
      return { rips };
    });
    if (isTerminal(e.status)) {
      if (e.status === "done") toast.success("Website clone finished");
      if (e.status === "error") toast.error("Website rip failed");
    }
  },
}));
```
Adjust imports (`toast`, `useProjectStore`, `useShell`) to the exact paths used elsewhere in the repo — grep for an existing `import { toast }` and `useProjectStore` usage to copy them verbatim.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (fix any import-path mismatches surfaced here).

- [ ] **Step 3: Commit**
```bash
git add src/apps/archives/repolens/useRepoLensWebsites.ts
git commit -m "feat(repolens): website rips store"
```

---

## Task 8: EventBridge listener

**Files:**
- Modify: `src/app/EventBridge.tsx`

- [ ] **Step 1: Add the listener**

In `src/app/EventBridge.tsx`, alongside the `hermes:*` listeners, add:
```typescript
    listen<{
      id: string;
      status: import("../apps/archives/repolens/repolensWebsitesDb").WebsiteStatus;
      phase: string;
      logDelta?: string;
      thumbnailPath?: string;
      sessionId?: string | null;
    }>("repolens:website", (e) => {
      useRepoLensWebsites.getState().applyEvent(e.payload);
    }).then((u) => unlisteners.push(u));
```
Add the import at the top: `import { useRepoLensWebsites } from "../apps/archives/repolens/useRepoLensWebsites";`

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/app/EventBridge.tsx
git commit -m "feat(repolens): route repolens:website events to the store"
```

---

## Task 9: Websites library grid + progress panel

**Files:**
- Create: `src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx`
- Create: `src/apps/archives/repolens/RepoLensWebsiteProgress.tsx`

Open `RepoLensLibrary.tsx` and `RepoLensScanTray.tsx` first to copy the exact card/grid/context-menu idioms (`useContextMenu`, `.rl-*` classes).

- [ ] **Step 1: Write the progress panel**

Create `src/apps/archives/repolens/RepoLensWebsiteProgress.tsx`:
```tsx
import { phaseLabel } from "./websiteRip";
import type { WebsiteRipRow } from "./repolensWebsitesDb";
import { useRepoLensWebsites } from "./useRepoLensWebsites";

export function RepoLensWebsiteProgress({ rip }: { rip: WebsiteRipRow }) {
  const cancel = useRepoLensWebsites((s) => s.cancel);
  const continueRip = useRepoLensWebsites((s) => s.continueRip);
  const lines = rip.log.split("\n").filter(Boolean).slice(-200);
  return (
    <div className="rl-web-progress">
      <div className="rl-web-progress-head">
        <span className="rl-web-host">{rip.hostname}</span>
        <span className="rl-web-phase">{phaseLabel(rip.phase)}</span>
        {rip.status === "running" && (
          <button className="rl-btn rl-btn--mini" onClick={() => void cancel(rip.id)}>Stop</button>
        )}
        {rip.status === "paused" && (
          <button className="rl-btn rl-btn--mini" onClick={() => void continueRip(rip.id)}>Continue</button>
        )}
      </div>
      <pre className="rl-web-feed">
        {lines.map((l, i) => (
          <div key={i} className={feedClass(l)}>{l}</div>
        ))}
      </pre>
    </div>
  );
}

function feedClass(line: string): string {
  if (line.startsWith("✗")) return "rl-feed-err";
  if (line.startsWith("▸")) return "rl-feed-tool";
  return "rl-feed-text";
}
```

- [ ] **Step 2: Write the websites grid**

Create `src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx`:
```tsx
import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe } from "lucide-react";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { RepoLensWebsiteProgress } from "./RepoLensWebsiteProgress";
import { phaseLabel } from "./websiteRip";
import { useContextMenu } from "../../../components/ContextMenu"; // match real path
import type { WebsiteRipRow } from "./repolensWebsitesDb";

export function RepoLensWebsitesLibrary() {
  const { rips, loaded, load, remove, continueRip, openInOrion } = useRepoLensWebsites();
  const { openAt, menu } = useContextMenu();

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const active = rips.find((r) => r.status === "running" || r.status === "paused");

  if (loaded && rips.length === 0) {
    return (
      <div className="rl-empty">
        <Globe />
        <h2>Clone any website</h2>
        <p>Paste a URL above and hit Rip. RepoLens reverse-engineers it into an
           editable Next.js project, saved here with a preview.</p>
        <p className="rl-web-legal">For learning and personal use only — do not use
           clones to impersonate, phish, or violate a site's terms.</p>
      </div>
    );
  }

  return (
    <>
      {active && <RepoLensWebsiteProgress rip={active} />}
      <div className="rl-lib-grid">
        {rips.map((r) => (
          <WebsiteCard key={r.id} r={r}
            onOpen={() => r.status === "done" ? void openInOrion(r.id) : undefined}
            onMenu={(e) => openAt(e, [
              { label: "Open in Orion", onClick: () => void openInOrion(r.id), disabled: r.status !== "done" },
              { label: "Continue", onClick: () => void continueRip(r.id), disabled: r.status !== "paused" },
              { label: "Delete", danger: true, onClick: () => void remove(r.id) },
            ])}
          />
        ))}
      </div>
      {menu}
    </>
  );
}

function WebsiteCard({ r, onOpen, onMenu }: {
  r: WebsiteRipRow;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const thumb = r.thumbnail_path ? convertFileSrc(r.thumbnail_path) : null;
  return (
    <div className={`rl-web-card rl-web-${r.status}`}
         onClick={onOpen} onContextMenu={onMenu}>
      <div className="rl-web-thumb">
        {thumb ? <img src={thumb} alt={r.hostname} /> : <div className="rl-web-thumb-empty"><Globe /></div>}
        <span className={`rl-web-badge rl-web-badge--${r.status}`}>
          {r.status === "running" ? phaseLabel(r.phase) : statusLabel(r.status)}
        </span>
      </div>
      <div className="rl-web-meta">
        <span className="rl-web-host">{r.hostname}</span>
      </div>
    </div>
  );
}

function statusLabel(s: WebsiteRipRow["status"]): string {
  return { queued: "Queued", running: "Running", done: "Done", error: "Error", cancelled: "Cancelled", paused: "Paused" }[s];
}
```
Adjust `useContextMenu`'s API to match the real signature found in `src/components/ContextMenu.tsx` (the explorer report showed `openAt(e, items)` + `menu`).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**
```bash
git add src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx src/apps/archives/repolens/RepoLensWebsiteProgress.tsx
git commit -m "feat(repolens): websites grid + live progress panel"
```

---

## Task 10: Tab toggle in RepoLensView

**Files:**
- Modify: `src/apps/archives/repolens/RepoLensView.tsx`

- [ ] **Step 1: Add Repos/Websites tab state and route the body**

In `RepoLensView.tsx`:
1. Add `import { useState } from "react";` (if not present) and `import { RepoLensWebsitesLibrary } from "./RepoLensWebsitesLibrary";` and `import { useRepoLensWebsites } from "./useRepoLensWebsites";`.
2. Add local state: `const [tab, setTab] = useState<"repos" | "websites">("repos");`
3. Render a tab toggle above the scan bar:
```tsx
      <div className="rl-tabs">
        <button className={tab === "repos" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setTab("repos")}>Repos</button>
        <button className={tab === "websites" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setTab("websites")}>Websites</button>
      </div>
```
4. Make the scan bar mode-aware. When `tab === "websites"` and no report is open, the input placeholder becomes `Paste a URL…` and the button says **Rip** and calls the websites store; otherwise keep the existing Scan behavior. Concretely, wrap the existing scan field/button so that in websites mode:
```tsx
        {tab === "websites" ? (
          <>
            <div className="rl-scan-field">
              <Globe size={15} />
              <input placeholder="Paste a URL…" value={webInput}
                onChange={(e) => setWebInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void rip(webInput, model.default_model); }} />
            </div>
            <RepoLensPickers />
            <button className="rl-btn" onClick={() => void rip(webInput, model.default_model)}>Rip</button>
          </>
        ) : (
          /* ...existing repo scan field + Scan button... */
        )}
```
with `const [webInput, setWebInput] = useState("");`, `const rip = useRepoLensWebsites((s) => s.rip);`, and `const model = useRepoLens((s) => s.model);` (reuse the existing model selection).
5. Route the body: when no `current` report and `tab === "websites"`, render `<RepoLensWebsitesLibrary />`; otherwise keep the existing `current ? <RepoLensReport/> : combinatorOpen ? <RepoLensCombinator/> : <RepoLensLibrary/>` logic for the repos tab.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/apps/archives/repolens/RepoLensView.tsx
git commit -m "feat(repolens): Repos/Websites tab toggle + Rip scan bar"
```

---

## Task 11: Styles

**Files:**
- Modify: `src/styles/tokens.css`

- [ ] **Step 1: Add the `.rl-web-*` and `.rl-tab*` block**

Append to the existing RepoLens (`.rl-*`) section of `src/styles/tokens.css` a block covering: `.rl-tabs` / `.rl-tab` / `.rl-tab--on` (segmented toggle matching the existing RepoLens chrome), `.rl-web-card` (grid card with a 16:9 `.rl-web-thumb` hero, `img { width:100%; height:100%; object-fit: cover; }`, `.rl-web-thumb-empty` neutral panel), `.rl-web-badge` + per-status color variants (running = repolens green, error = `--neon-magenta`, done = `--neon-green`, paused/queued = `--t-tertiary`), `.rl-web-progress` panel with `.rl-web-feed` monospace tool feed (`.rl-feed-tool` green, `.rl-feed-err` magenta, `.rl-feed-text` secondary), and `.rl-web-host` / `.rl-web-phase` / `.rl-web-legal`. Match radii/spacing tokens used elsewhere (`--r-md`, the 8/12/14 spacing scale). Reuse `--repolens-green` for the active accent.

- [ ] **Step 2: Verify the app still builds**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean, all tests pass, vite build succeeds.

- [ ] **Step 3: Commit**
```bash
git add src/styles/tokens.css
git commit -m "style(repolens): website ripper card/tab/progress styles"
```

---

## Task 12: Full green gate + restart note

- [ ] **Step 1: Run the whole gate**

Run:
```bash
npx tsc --noEmit
npx vitest run
( cd src-tauri && cargo check && cargo test )
npm run build
```
Expected: every command exits 0. Do not proceed on any failure — fix first.

- [ ] **Step 2: Commit any fixes, then note the restart requirement**

This feature adds migration 0022, a new Rust module, and a bundled resource → it requires a full **`tauri dev` restart** (not just a frontend hot-reload). Record this in the session log.

---

## User smoke test (human — agent cannot run Tauri)

> **Prerequisite:** Upgrade Node to ≥ 24 first (`nvm install 24 && nvm alias default 24`), then restart `tauri dev`.

1. Archives → RepoLens → **Websites** tab → empty state with the legal note is visible.
2. Paste `https://example.com` → **Rip** → a card appears (`Running`, phase `Recon`); the progress panel shows a live tool feed.
3. Within the first minute, a **thumbnail** appears on the card once the agent saves its first screenshot.
4. Let it finish (small sites are quick; complex ones take much longer) → status flips to **Done**.
5. Click the **Done** card → Orion opens with the project root = the clone; a toast says to run `npm run dev`.
6. Start a second rip, then **Stop** it mid-run → status `Cancelled`. Right-click → **Delete** → card and files removed.
7. If a rip hits the 50-turn budget → status **Paused** with a **Continue** button that resumes it.

---

## Self-Review (completed during planning)

**Spec coverage:** Websites tab (T10) · website cards + thumbnails (T9, T5 watcher) · streaming progress (T5/T8/T9) · open-in-Orion (T7) · cancel/continue/delete (T5/T7/T9) · migration 0022 (T2) · engine `repolens_website.rs` (T5) · vendored scaffold + MIT attribution (T1) · IPC + EventBridge (T6/T8) · `.rl-web-*` CSS (T11) · preflight + legal note (T5/T9). Concurrency cap = 1 enforced in the store (T7 `rip` refuses while one runs) and `nextQueued` helper exists for a future queue. **Deferred per spec (out of scope, intentionally not built):** side-by-side original/clone, auto dev server, parallel rips, "should I rip this?" briefing.

**Divergences from spec (justified above in "Improvements"):** Playwright MCP instead of `--chrome`; raw-screenshot thumbnail instead of 512px WebP; added `git init` + Node-24 preflight; CLONE_PROMPT references vendored SKILL.md. The DB `repolens_websites` schema gains a `model` column (not in the spec's DDL) to carry the per-rip model — reflected in T2's migration.

**Type consistency:** `WebsiteRipRow`/`WebsiteStatus` defined once in `repolensWebsitesDb.ts`, imported everywhere. Event shape `{id,status,phase,logDelta?,thumbnailPath?,sessionId?}` matches between Rust `WebsiteEvent` (camelCase serde renames), the EventBridge listener, and the store `applyEvent`. Commands match across Rust (`repolens_website_rip/cancel/continue/delete`), `ipc.ts`, and the store.

**Known risks to watch during execution:** (1) `claude --print` must auto-load/honor the vendored skill from cwd — if it doesn't read `.claude/skills/...` on its own, fall back to inlining the SKILL.md body into `clone_prompt`. (2) Playwright MCP server name/tool prefix — confirm the agent sees `mcp__playwright__*` tools; adjust the prompt wording if the prefix differs. (3) `tauri.conf.json` resource path may need tweaking (`resources/...` vs `../resources/...`) depending on bundle base. (4) Full clones with worktree fan-out are token-heavy and long — acceptable per spec, but watch usage.
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-repolens-website-ripper.md`.**
