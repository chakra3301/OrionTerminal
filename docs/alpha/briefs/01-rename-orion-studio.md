# Brief 01: Rename "Orion Terminal" to "Orion Studio" (in-repo)

Assigned to: GPT 6.1 (Codex). Coordinator: Claude. Owner: Luca.

## Where you work

- Worktree: `/Users/lucaorion/Orion_Terminal-worktrees/rename`, branch `alpha/rename-orion-studio`, cut from `2aabd42`.
- `node_modules` there is a symlink to the main checkout's. Never edit anything inside it.
- The main checkout `/Users/lucaorion/Orion_Terminal` is the owner's live dev app. Never write to it. The only exception is the shared Rust build folder below.
- **Leave all changes uncommitted.** No commits, pushes, deploys, GitHub edits, or anything that leaves this machine. The coordinator reviews the diff and the owner approves before anything is committed.
- Read `AGENTS.md` (the repo rules) before you start.

## Goal

The product is now called **Orion Studio**. Every place a person can *see* the product name says Orion Studio. Every machine identifier stays exactly as it is, so existing installs keep their data, settings, keys and permissions.

## Change (human-visible name)

- "Orion Terminal" → "Orion Studio", "ORION TERMINAL" → "ORION STUDIO", "orion terminal" in prose → "orion studio". Match the case the text already uses.
- Split wordmarks ("ORION" and "TERMINAL" rendered separately as the product name): change TERMINAL to STUDIO. Don't change "terminal" where it means the terminal *feature* (xterm panel, shell, Terminal.app).
- Includes:
  - `productName` in `src-tauri/tauri.conf.json`, window titles, menubar/About text, onboarding and boot copy, notifications, dialogs, error messages, MCP tool/server *descriptions* (not their ids), and Rust user-facing strings.
  - The website in `landing/`: page text, `<title>`, meta/OG tags, alt text.
  - `README.md`, `BETA.md`, `AGENTS.md` (title and Summary only; keep the `OrionTerminal` component-name rule exactly as written), `design/` docs, non-history docs under `docs/`, and package/Cargo *descriptions*.
  - Build/release/install scripts that name the bundle (`Orion Terminal.app` → `Orion Studio.app`, DMG names). List each one in the report, because they change behaviour.
  - Tests that assert the old visible copy: update them to the new copy.
  - Licence notices that name the product: rename, then run `python3 scripts/sync-license-materials.py` if the manifest needs re-syncing, then `npm run licenses:check`.

## Keep exactly as is

- The bundle identifier `com.lucaorion.orion-terminal`, plus everything derived from it or keyed on it: data/log/cache folders, the database, keychain service and account names, URL schemes and deep links, the single-instance and autostart labels, storage/app_state/localStorage keys, env var names, IPC command and event names, plugin ids, MCP server and tool ids, and the Cargo package and binary names plus the npm `name`.
- File and folder names in the repo, and test fixture ids.
- URLs: the domain `orionterminal.app` and every `github.com/chakra3301/OrionTerminal` link. List them; don't edit them.
- History stays: `PROGRESS.md`, `CLAUDE_LOG_ARCHIVE.md`, `docs/releases/v0.1.0-alpha.1.md` (published), everything under `docs/superpowers/`, released CHANGELOG entries, and git history.
- Third-party code: `src-tauri/vendor/`, `node_modules/`, photocraft.
- Logo and icon images (`src-tauri/icons/`, any logo `.png/.svg/.icns/.ico`). A separate job replaces them.
- Videos and other media files.

If a string is ambiguous (you can't tell whether it is shown to people or used as an identifier), keep it and list it under "Ambiguous" in the report.

## Risks to check and report (don't fix silently)

For each of these, say what happens on an existing install when `productName` changes, and whether you changed anything for it:

1. **macOS permissions** (Screen Recording, Accessibility, Automation, Files). How are release builds signed (see `tauri.conf.json` `bundle.macOS` and the scripts)? Will users have to re-grant?
2. **Autostart / login items, if used.** Would the rename leave an old login item behind, so the app starts twice?
3. **Code that finds the app by name.** For example `open -a "Orion Terminal"`, AppleScript `tell application`, `/Applications/Orion Terminal.app` paths, process-name checks, or the Activity Monitor name.
4. **The main binary name inside the .app.** Does it follow `productName` in this Tauri version, and does anything depend on it?
5. **Updater and release asset names, if any.**
6. **How the `landing/` site is deployed** (look for vercel/netlify/CNAME/GitHub Pages config). Report it; don't deploy.

## Gates (run all; paste the result lines into the report)

- `npm run typecheck`
- `npm test` (the full vitest run, once, at the end)
- `npm run licenses:check`
- `cargo test --lib` from `src-tauri`, with `CARGO_TARGET_DIR=/Users/lucaorion/Orion_Terminal/src-tauri/target`. That shares the main checkout's build folder, because the disk is tight. Run `df -h ~` first; if less than 10 GB is free, skip it and say so.
- The final sweep: `git grep -n -i -E "orion[ _-]?terminal"` in the worktree. Every remaining hit must appear in the report under a Keep reason.

## Deliverable

Write `docs/alpha/rename-report.md` in the worktree with:

1. A summary: files changed, and occurrences changed vs kept.
2. A Changed list, grouped by area (app UI, Rust, website, docs, scripts, tests).
3. A Kept list: every remaining hit from the final sweep, each with its reason.
4. An Ambiguous list.
5. The Risks section: items 1–6, each with your finding.
6. **Outside the repo (owner decides).** Give your recommendation for each, and change none of them:
   - the GitHub repo name, description and homepage
   - the website domain
   - names of future release assets
7. The gate results.

End your final message with the report's path and the gate results.
