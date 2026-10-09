# Orion Terminal

<!-- CLAUDE.md in this repo is a symlink to this file. Edit AGENTS.md only. -->

Durable orientation for agents. Keep it lean: what it is, locked decisions, stack, commands, architecture, rules. Current state lives in [PROGRESS.md](PROGRESS.md), the rebuild plan in [PLAN.md](PLAN.md), design in [design/](design/DESIGN.md), and per-session detail in [CLAUDE_LOG_ARCHIVE.md](CLAUDE_LOG_ARCHIVE.md). The whole file should still read end-to-end in ~60 seconds a year from now.

## Summary

**Orion Terminal** is a JARVIS-style personal workstation: one desktop OS shell hosting three deeply-integrated apps with a selectable AI embedded inside each as a context-specific collaborator.

- Shell: wallpaper, menubar, dock, in-canvas windows, Spotlight (⌘K)
- App 1 — **Archives 47**: personal Notion (notes, journal, mood boards, media). Green accent.
- App 2 — **Orion**: AI-first code editor (file tree, Monaco, live preview, terminal, inline Claude edits). Cyan accent.
- App 3 — **XDesign**: design studio UI shell (Figma + PS + Illustrator + Unicorn.studio hybrid). Magenta accent.

"Orion Terminal" is the product. "Orion" is the editor app inside it. **Never reuse `OrionTerminal` as a component name.**

## Session routine

**Start of session, before touching code:**

1. Read this file, `PLAN.md`, `PROGRESS.md` and `design/` (`DESIGN.md` + `tokens.json`).
2. Confirm you're on the branch the latest `PROGRESS.md` entry names (`git branch --show-current`).

**End of session, before stopping — even if the work is unfinished:**

1. Add an entry at the top of `PROGRESS.md`: what changed, what's next, open questions, current branch. Long per-session detail goes to `CLAUDE_LOG_ARCHIVE.md`.
2. Commit only if the owner has authorized commits for this work (see Repo rules). Otherwise leave the changes uncommitted and say so in the entry.

Claude and GPT models may alternate between sessions. The next session starts from `PROGRESS.md`, not from chat history.

## Stack (locked — do not propose alternatives)

- Tauri 2 + React 19 + Vite + TypeScript
- Monaco editor, BlockNote (notes), xterm.js (terminal), cmdk (legacy palette internals), Zustand (state), react-resizable-panels
- SQLite via `tauri-plugin-sql`; migrations are **append-only**
- Subscription Claude path = Claude CLI subprocess (`claude --print --output-format stream-json --verbose --permission-mode acceptEdits`)
- Inline-edit path = Messages API directly (streaming, OS-keychain key)
- Fonts: Space Grotesk (UI) + JetBrains Mono (code, mono labels) via `@fontsource/*`
- Spotlight fuzzy match: `fuse.js`

## Commands

Node **22.13+**.

| Task | Command |
|------|---------|
| dev (desktop app) | `npm run tauri dev` |
| dev (frontend only) | `npm run dev` |
| test | `npm test` (vitest) · `npm run test:bridges` (Node) · `npm run test:native` (`cargo test --lib`) |
| typecheck | `npm run typecheck` |
| build | `npm run build` (tsc + vite) · `npm run tauri build` (app bundle) |
| full gate | `npm run verify` |
| environment check | `npm run doctor` |

## Locked architectural decisions

1. **In-canvas windowing**, not Tauri native multi-window. One OS window; apps render as React components positioned absolutely inside an HTML canvas.
2. **Hard cutover on aesthetics.** All surfaces move to new design tokens in one pass — no half-old / half-new state for more than a day.
3. **Unified Spotlight**, replacing the standalone `cmdk` palette. Same command registry underneath. `>` prefix = commands only; otherwise fuzzy match across apps, notes, files, recent chats, commands.
4. **Reference fidelity is the default.** When the user says “just like” a supplied reference, match its visuals, actual brand marks, motion, behavior and visibility rules—not an approximation—unless explicitly told otherwise. Provider trackers show only providers enabled and connected/configured in Orion; idle is not disconnected.
5. **Imported app cohesion (2026-10-01 owner request).** Apps brought through Incubator should adopt Orion's active-theme typography, controls, surfaces and soft chrome/interior UI—not remain visually foreign websites. Preserve functionality, brand/attribution and content/semantic colors; no rewriting skill instructions. Scoped opt-in appearance layer/Original option precedes repository preparation, not universal CSS injection or silent retrofits.

## Architecture map

```
src/shell/                 wallpaper, menubar, dock, windowframe, spotlight, useShell, useDraggable
src/apps/orion/            Orion editor — file tree, tabs, editor, preview, terminal, statusbar, claude config
src/apps/archives/         Archives stub (sidebar + main placeholder + ClaudeChat)
src/apps/xdesign/          XDesign stub (no Claude rail in Phase A)
src/components/ClaudeChat  reusable, props-driven chat panel — three instances
src/styles/tokens.css      design tokens (new canon)
src/commands/              global command registry (still global, unchanged shape)
```

Stores:

- `useShell` — windows[], maxZ, focusedWindowId, spotlightOpen
- `useClaude` — conversations keyed by appId
- `useArchives`, `useOrion`, `useXDesign` — per-app state (Phase A may keep them minimal)
- `useCommands` — existing registry singleton, untouched

Window state shape:

```ts
type WindowState = {
  id: string;                          // ULID
  app: 'archives' | 'orion' | 'xdesign';
  x: number; y: number;
  w: number; h: number;
  z: number;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  preMaximize?: { x: number; y: number; w: number; h: number };
};
```

## Conventions

### Don'ts (carry-forward rules)

- Don't edit prior migrations — append only.
- Don't break any Week 1/2 functionality. If a feature used to work, it works after the refactor.
- Don't propose alternatives to the locked stack.
- Don't reuse `OrionTerminal` as a component name.
- Don't couple ClaudeChat to a specific backend — props-driven, `onSend` callback.
- Don't add comments narrating what code does. Only the why, and only when non-obvious.
- Don't introduce dependencies outside the approved list without asking.
- Don't bring back the old single-window architecture.

### Quality bar

- Window drag at 60fps
- Spotlight under 50ms perceived
- Claude streaming feels like claude.ai (visible token-by-token)
- Inline-edit diff within ~500ms of submit
- Copy from the design handoff appears exactly as specified (typos and capitalization included): `Ready when you are.`, `⌘K claude`, `claude · listening`, etc.
- Atomic file saves (.tmp + rename) preserved

### Repo rules

Lifted from owner notes in the project log (originals kept verbatim in PROGRESS.md):

- No commits, pushes, releases or production replacement unless the owner authorizes that specific action.
- Preserve pre-existing dirty work.
- Keep turns short and cost-conscious: focused tests and native inspection are allowed; avoid repeated broad suites/builds (owner, 2026-09-16).
- Freeze new migrations immediately after registration while the dev watcher runs.
- The Rust gate is `cargo test --lib`, not `cargo check` (check never compiles tests).

## Design

The design source of truth is [design/DESIGN.md](design/DESIGN.md) (direction, rules, theme decisions) plus [design/tokens.json](design/tokens.json) (Phase A canon values). Read both before UI work. Implemented values live in `src/styles/tokens.css`; if it disagrees with `design/`, flag it in `PROGRESS.md` instead of picking one.

The root `DESIGN.md` is the BMW M theme analysis, referenced by docs in `docs/architecture/`. It is a theme reference, not the system spec.

Never invent tokens. If a value you need is missing, use the closest existing token and add the gap to the open questions in `PROGRESS.md` for the design owner (Hermes).
