# RepoLens — Website Ripper

**Date:** 2026-06-15  
**Status:** approved-for-planning  
**Scope:** Website clone pipeline inside RepoLens (Archives), separate **Websites** library tab  
**Template reference:** [JCodesMore/ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template) (MIT)

---

## 0. What this is

A new surface inside **RepoLens** (Archives) that reverse-engineers any public URL into a full **Next.js 16 + shadcn/Tailwind** codebase — the same multi-phase pipeline as the template’s `/clone-website` skill (recon → foundation → component specs → parallel builders → assembly).

Ripped sites live in their **own library tab** (separate from repo scans), each card showing a **thumbnail** captured during recon. Click a finished rip → **open the project in Orion**.

Execution model: **Hermes-style** — one long-running `claude` subprocess per rip, streaming progress into the UI. Browser automation via **`claude --chrome`** (template requirement).

---

## 1. Locked decisions (user-approved 2026-06-15)

| Question | Choice |
|---|---|
| Rip fidelity | **Full clone pipeline** (template `/clone-website` equivalent) |
| Storage | **App data** — best for library + thumbnails |
| Click finished card | **Open in Orion** (file tree + preview; user runs `npm run dev`) |
| Execution | **Hermes-style streaming agent** (dedicated engine, not Hermes kanban) |

---

## 2. UI

### Library tabs

RepoLens library splits into two tabs:

- **Repos** — existing scan grid (unchanged)
- **Websites** — website rip grid (new)

Scan bar adapts to active tab:

- Repos: existing placeholder + **Scan**
- Websites: `Paste a URL…` + **Rip**

Global model picker and tone picker remain shared (same as repo scans).

### Website cards

Grid layout (Media-style thumbnail hero):

- `thumbnail.webp` via `convertFileSrc(thumbnail_path)`
- Hostname (primary label)
- Status badge: `Queued` / `Recon` / `Building` / `Done` / `Error`
- Relative age
- Fallback when no thumbnail yet: hostname on neutral panel + status badge

Cards appear immediately when a rip starts; thumbnail fills in after recon saves a screenshot.

**Interactions:**

- Click **done** → `openProjectAtPath(project/)` + `openApp("orion")` + toast “Run `npm run dev` to preview”
- Click **in progress** → progress panel (live tool feed + phase label, Hermes-style)
- Context menu: Open in Orion · Re-rip · Reveal in Finder · Delete

**Concurrency (v1):** **1 active rip** at a time; extras queue (simpler than repo scans’ 3-way cap given browser + build load).

### Empty state (Websites tab)

When no rips exist: short explainer — paste a URL, RepoLens clones it into an editable Next.js project, saved here with a preview thumbnail.

Footer note: template’s legal disclaimer (no phishing/impersonation; respect site ToS).

---

## 3. Storage layout

```
$APPDATA/repolens/websites/<ulid>/
  thumbnail.webp          # 512px WebP, from recon screenshot
  project/                # vendored scaffold + generated code
    src/...
    docs/research/...
    docs/design-references/...
```

---

## 4. Data model — migration `0022_repolens_websites.sql`

```sql
CREATE TABLE IF NOT EXISTS repolens_websites (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  hostname        TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,  -- queued|running|done|error|cancelled|paused
  phase           TEXT NOT NULL DEFAULT '',
  project_path    TEXT NOT NULL,
  thumbnail_path  TEXT,
  log             TEXT NOT NULL DEFAULT '',
  session_id      TEXT,
  error           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repolens_websites_updated ON repolens_websites(updated_at DESC);
```

Frontend: `repolensWebsitesDb.ts` — `saveRip`, `getRip`, `listRips`, `updateRip`, `deleteRip`.

---

## 5. Clone engine (Rust — `repolens_website.rs`)

Modeled on `hermes.rs` but **single-agent per rip**, purpose-built.

### Commands

| command | behavior |
|---|---|
| `repolens_website_rip(url)` | Validate URL, ULID row, copy scaffold, `npm install`, spawn agent, return `id` |
| `repolens_website_cancel(id)` | Kill subprocess, set `cancelled` |
| `repolens_website_continue(id)` | Resume paused agent (`--resume session_id`) |
| `repolens_website_delete(id)` | Cancel if running, delete files + DB row |

### Agent spawn (cwd = `project/`)

```bash
claude --print --output-format stream-json --verbose \
  --permission-mode bypassPermissions \
  --model <opus or RepoLens model picker> \
  --chrome \
  --max-turns 50 \
  --mcp-config <orion-mcp> \
  -- "<CLONE_PROMPT: URL + inlined SKILL.md essentials>"
```

**Differs from Hermes:**

- **`--chrome`** enabled (browser required)
- **`Task` allowed** — parallel section builders per template
- **`--max-turns 50`**; on `error_max_turns` → **`paused`** + Continue button (Hermes pattern)
- RepoLens scan calls use `--strict-mcp-config`; website rips need browser + builder tools — evaluate lean MCP vs full config in implementation plan

### Events — `repolens:website`

```ts
{ id, status, phase, logDelta?, thumbnailPath?, sessionId? }
```

Frontend subscribes via EventBridge; store mirrors Hermes feed composition (`▸ tool`, prose tail).

### Thumbnail pipeline

1. Agent saves screenshot under `docs/design-references/` during recon
2. Rust watcher (poll every 2s while `running`) detects first PNG/WebP
3. Resize to 512px long side → WebP q75 → `thumbnail.webp` (same approach as Archives asset thumbs)
4. Update `thumbnail_path` + emit event so library card refreshes

### Scaffold

Pin snapshot at `resources/website-cloner-scaffold/` (vendored from template at a fixed commit). Copied per rip — isolated projects. Include `SKILL.md` + `AGENTS.md` in scaffold. MIT attribution in Settings → About.

`npm install` in `project/` before agent spawn (Rust `spawn_blocking`).

### Preflight (surfaced in UI)

On first rip or failure, checklist:

- Claude Code CLI on PATH
- `--chrome` / browser automation working
- Node.js 24+
- Disk space under `$APPDATA`

---

## 6. Orion handoff

```ts
await useProjectStore.getState().openProjectAtPath(`${rip.project_path}/project`);
useShell.getState().openApp("orion");
toast.info("Run npm run dev in the terminal to preview the clone.");
```

**Deferred:** auto-spawn terminal tab with `npm run dev`.

---

## 7. Architecture choice (rejected alternatives)

| Approach | Verdict |
|---|---|
| **Dedicated `repolens_website.rs` engine** | ✅ **Chosen** |
| Reuse Hermes kanban | ❌ Wrong UX; disallows `Task` |
| Frontend-only spawn | ❌ No relaunch survival / weak cancel |

---

## 8. v1 scope

**In:** full SKILL pipeline, Websites library tab + thumbnails, streaming progress, open in Orion, cancel/continue/delete, queue (1 active)

**Out:** side-by-side original vs clone, auto dev server, parallel rips, AI “should I rip this?” briefing, screenshot→layers shortcut

---

## 9. Prerequisites & risks

- **Browser dependency:** rips fail without working `claude --chrome`. Preflight must be explicit.
- **Duration:** full clones can run 30–90+ minutes; Continue/pause is essential.
- **Disk:** each rip = full Next.js tree + assets; user should delete old rips.
- **Legal:** template’s “not for phishing/impersonation” disclaimer in Websites empty state.
- **Restart:** migration + Rust module → **`tauri dev` restart** required.

---

## 10. Files touched (implementation preview)

| area | files |
|---|---|
| Rust | `src-tauri/src/repolens_website.rs`, `lib.rs`, `migrations/0022_repolens_websites.sql` |
| Scaffold | `resources/website-cloner-scaffold/**` |
| TS | `repolensWebsitesDb.ts`, `useRepoLensWebsites.ts`, `RepoLensWebsitesLibrary.tsx`, `RepoLensWebsiteProgress.tsx`, `RepoLensView.tsx`, `RepoLensLibrary.tsx` (tabs) |
| CSS | `.rl-web-*` block in `tokens.css` |
| IPC | `ipc.ts` + EventBridge listener |

---

## 11. Test plan (smoke)

1. RepoLens → **Websites** tab → empty state visible
2. Paste `https://example.com` → Rip → card appears (`queued` → `running`)
3. Progress panel shows tool feed + phase updates
4. Thumbnail appears after recon screenshot lands
5. On done → click card → Orion opens with project root = clone
6. Cancel mid-rip → status `cancelled`; Delete removes files + card
