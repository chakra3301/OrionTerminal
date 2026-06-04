# Personal Workstation — Build Brief (Week 4)

## Where we are

Three weeks in, Orion is real. Week 1 shipped the shell + command spine. Week 2 wired Claude Code, inline edits, and the terminal. Week 3 added notes, assets, tags, and unified search. Anything still rough from the prior weeks gets fixed first — Week 4 is polish + the last big surface, not a place to bury technical debt.

## What Week 4 is

The week Orion becomes *yours* — pulled up from anywhere, themed precisely, and capable of rendering Claude's output as live UI rather than just text. Five things plug in:

1. **Artifact rendering** — when Claude outputs HTML, React, or SVG in a chat response, render it in a sandboxed iframe in the right rail
2. **Global hotkey** — Alt+Space from anywhere on the OS pops the palette, even when Orion isn't focused
3. **Aesthetic lockdown** — the design tokens from the Orion mockup become the actual production CSS. Real fonts loaded, motion specs honored, scanline overlay applied.
4. **Keybinding reference** — discoverable cheat sheet of every registered command and its hotkey, generated from the registry
5. **Optional Supabase sync** — stretch goal, fully gated, off by default

The first three are mandatory. Four is one afternoon. Five is bonus if you finish early.

## Stack additions — locked

- **Artifact sandbox:** raw `<iframe sandbox="allow-scripts">` with `srcdoc`. No `allow-same-origin`. No npm sandbox library.
- **React-in-iframe:** Babel Standalone (`@babel/standalone`) loaded *inside* the iframe via CDN script tag for JSX transform. React 18 UMD also loaded inside the iframe via CDN. The host app does not bundle these.
- **Global hotkey:** `tauri-plugin-global-shortcut` v2 (the v2-compatible plugin)
- **Window control on hotkey:** `tauri-plugin-window-state` (already installed if you persisted window size in Week 1; otherwise add now)
- **Fonts:** self-hosted via `@fontsource/jetbrains-mono` (variable font) — no Google Fonts CDN, no FOUT, works offline
- **Motion:** Framer Motion is overkill for what we need — use CSS transitions and a tiny `useReducedMotion` hook. Don't pull a library.
- **Sync (stretch only):** `@supabase/supabase-js` v2. Encrypted client-side with `tweetnacl` if syncing chat history.

Do not introduce other libraries without flagging it first.

## Week 4 deliverables — only these

By end of Week 4 the app should:

1. **Artifact detection + rendering.** When a Claude response contains a fenced code block tagged `html`, `svg`, or `jsx`/`react`, render an "Open as artifact" affordance on the message. Click it → artifact mounts in a sub-panel of the right rail (toggleable) with the rendered output running live.
2. **Artifact controls.** Each artifact has: a header showing detected type and source message, a refresh button, an "open in new window" button (spawns a Tauri webview window), and a copy-source button. No edit-in-place this week.
3. **Global hotkey.** Alt+Space (Cmd+Space on macOS — see note below) from anywhere on the OS focuses Orion (un-minimizing if needed, raising window) and opens the palette in free-text mode. Configurable via settings.
4. **Production aesthetic.** Every Week 1–3 surface uses the locked color tokens (`--void`, `--obsidian`, `--graphite`, `--steel`, `--ash`, `--bone`, `--signal`, `--ember`). JetBrains Mono Variable loaded and applied globally. Scanline overlay implemented as a global pseudo-element at 2.5% opacity. Status line redesigned as a proper vim-style modeline. Hairline-only borders enforced — audit and remove any thick borders or rounded corners >2px.
5. **Keybinding reference.** Cmd+/ opens a modal listing every registered command grouped by `group`, showing label, hotkey, and id. Generated entirely from the command registry — adding a new command later automatically shows up here.
6. **Optional: Supabase sync.** Off by default. When enabled in settings: push-only sync of `notes`, `chats`, and `assets` (metadata, not files) every 30s when there are unsaved changes. No conflict resolution, last-write-wins, single device. This is an escape hatch for backups, not a multi-device feature.

## Architecture: artifact rendering

This is the trickiest piece this week. Get the sandbox right or get owned.

### Detection

In the chat panel's markdown renderer, override the code block component. When `language` matches `html` / `svg` / `jsx` / `react` / `tsx` and the block exceeds 30 chars, surface a small inline `[ ARTIFACT // RENDER ]` link beneath the code. Click → opens the artifact panel.

Don't auto-render. The user clicks. This is partly a security choice and partly a sanity choice — you don't want every chat response spinning up iframes.

### Iframe shape

```html
<iframe
  sandbox="allow-scripts"
  srcdoc="..."
  referrerpolicy="no-referrer"
  loading="lazy"
></iframe>
```

**Critical:** no `allow-same-origin`. The iframe runs in a null origin, cannot read cookies, cannot fetch from the host's origin, cannot touch parent DOM. This is the security floor — if you weaken this, the artifact has access to the user's local app state.

`srcdoc` is fully self-contained. The host app builds the full HTML string in memory and passes it to the iframe.

### Three artifact types

**HTML/SVG:** trivial. Wrap in a minimal HTML shell with the dark-theme CSS variables injected so it doesn't render on white-on-white.

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      :root { --void: #07090C; /* ...all tokens... */ }
      body { margin: 0; background: var(--void); color: var(--bone);
             font-family: 'JetBrains Mono', monospace; }
    </style>
  </head>
  <body>{user code}</body>
</html>
```

**JSX/React:** load React 18 UMD + Babel Standalone from a CDN inside the iframe, transpile and mount.

```html
<!DOCTYPE html>
<html>
  <head>
    <style>{token CSS}</style>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-presets="react,typescript">
      {user code}
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<App />);
    </script>
  </body>
</html>
```

The user's JSX must export a default component named `App` (or use the standard "the last expression is the component" pattern — pick one and document it). If neither applies, render a friendly error inside the iframe instead of failing silently.

### CSP for the iframe

Inside `srcdoc`, set a meta CSP:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net;
           style-src 'unsafe-inline';
           img-src data: https:;
           font-src https: data:;
           connect-src https:;">
```

`unsafe-eval` is required for Babel Standalone. `unsafe-inline` script is required for the bootstrap. These would be alarming on the web; inside a null-origin sandboxed iframe, they only let the artifact run *itself*, not touch your app.

### Errors

Wrap the user code in a try/catch that catches both sync errors and unhandled promise rejections, render the error stack in the iframe with red `--ember` styling and a `[ ARTIFACT // ERROR ]` header. The artifact panel never silently goes blank.

### Open in new window

`webviewWindow.create()` from Tauri spawns a separate window with the same `srcdoc` content. Inherits the same sandbox rules. Useful for big artifacts or when you want to keep one running while navigating chats.

## Architecture: global hotkey

### Default binding

- macOS: **Cmd+Shift+Space** (Cmd+Space alone collides with Spotlight — don't fight the OS)
- Windows/Linux: **Alt+Space**

User-configurable in settings. Validate the input (must include at least one modifier, must not collide with reserved system hotkeys where the OS will let us check).

### Behavior on hotkey

1. Window state currently: focused, unfocused-but-visible, minimized, hidden-to-tray (if Week 4 adds tray support — out of scope).
2. On hotkey: ensure window is visible, raise to front, focus, dispatch the `palette.openFreeText` command (palette opens with no prefix, ready for any-entity search).
3. On a *second* press while already open: close the palette and return focus to wherever it was. The hotkey is a toggle.

### Implementation outline (Rust side)

```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
    if event.state() == ShortcutState::Pressed {
        let window = app.get_webview_window("main").unwrap();
        if !window.is_visible().unwrap_or(false) { let _ = window.show(); }
        if window.is_minimized().unwrap_or(false) { let _ = window.unminimize(); }
        let _ = window.set_focus();
        let _ = app.emit("palette:openFreeText", ());
    }
})
```

Handle re-registration cleanly when the user changes the hotkey in settings (unregister old, register new, atomic).

### macOS quirk

Tauri global shortcuts work on macOS but the app needs Accessibility permissions for some key combinations. If registration fails silently, surface a settings notice with a "Open System Settings" button.

## Architecture: aesthetic lockdown

This is the audit-and-fix week, not a redesign. Three passes:

### Pass 1: Token migration

Find every hardcoded color in the codebase. Grep for hex values, `rgb(`, `rgba(`, named colors like `gray-*`, `slate-*`. Replace with token references. Tailwind arbitrary value style: `bg-[var(--obsidian)]`, `text-[var(--bone)]`, `border-[var(--steel)]`.

The CSS variables themselves live in `src/styles/tokens.css`, imported once at app root. Define them on `:root` so the iframe injection (above) can use the same source of truth.

### Pass 2: Hairline + radius audit

Grep for `border-2`, `border-4`, `rounded-md`, `rounded-lg`, `rounded-xl`, `shadow-*`. These should mostly be deleted. Borders are 1px in `--steel`. Radii are 0 or 2px (`rounded-sm`). No box shadows. If a thing visually needs separation, use a hairline.

Acceptable exceptions: avatar circles (none in app yet), the `--signal` border on the active palette item (that's the design language).

### Pass 3: Typography

- Body: 12px/1.5 mono
- UI labels: 11px UPPERCASE, `letter-spacing: 0.15em`, `--ash` color
- Headings in notes: BlockNote's defaults, but skinned mono via the BlockNote theme prop
- All `font-family` declarations resolve to JetBrains Mono Variable with `ui-monospace` fallback

Load JetBrains Mono Variable via `@fontsource/jetbrains-mono/variable.css` imported once. No font flash.

### Scanline overlay

Single global pseudo-element on the app root:

```css
.app-root::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.025) 0px,
    rgba(255, 255, 255, 0.025) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: overlay;
  z-index: 9999;
}
```

If reduced-motion / accessibility is on, omit the overlay.

### Status line redesign

Bottom of window, 22px tall, mono 11px, `--ash` text on `--obsidian` background, 1px `--steel` top border. Sections separated by ` ─── `:

```
─── ORION ─── /home/luca/projects/ekko ─── main● ─── claude:idle ─── 14 notes · 67 assets ─── 14:32:07 ───
```

Real data sourced from stores. Time updates once per second (single interval, not per-section). Don't put it on a 60Hz tick.

### Pulse animation spec

The `--signal` dot when Claude is streaming. CSS keyframes, 1.4s ease-in-out, 0.4 → 1.0 opacity. Single rule, applied via class. Disable on reduced-motion.

## Architecture: keybinding reference

Trivial because the registry already has everything.

```tsx
// src/features/help/KeybindingsModal.tsx
const grouped = groupBy(commands, (c) => c.group ?? 'Other');
// render each group as a section, each command as a row:
//   {label}                  {hotkey}                {id in --ash}
```

Searchable via the same input shape as the palette. `Esc` closes. `Cmd+/` toggles.

This is a 1-hour task. Don't overbuild it.

## Architecture: optional Supabase sync (stretch)

**Skip this section entirely if Weeks 1–3 polish isn't 100% solid.** Sync is the kind of thing that looks small and eats four days.

### Schema mirror

In a Supabase project, mirror three tables: `notes`, `chats`, `assets` (metadata only — no files). Plus a `sync_state` table tracking `last_synced_at` per device.

### Push-only

The app pushes local changes upstream. It does not pull. This is a **backup**, not a sync. Two devices both syncing will overwrite each other. Single-device use only.

If the user wants real multi-device sync, that's a v2 feature with conflict resolution (probably CRDT-based for notes).

### Encryption

Sensitive content gets client-side encrypted before push. `tweetnacl` + a passphrase-derived key (Argon2 KDF, stored in the keychain). The Supabase row stores ciphertext only. Optional toggle in settings — off-by-default for now since this app is local-first.

### Timer

Every 30s, if any of `notes` / `chats` / `assets` have `updated_at > last_synced_at`, run a sync pass. Backoff on errors (1s → 5s → 30s → give up until next manual trigger).

### UI

Settings has a sync section: enable toggle, Supabase URL + anon key inputs, encryption passphrase, manual "Sync now" button, last-sync timestamp + count of pushed rows.

## New commands to register

- `artifact.toggle` — show/hide artifact panel
- `artifact.openInWindow`
- `artifact.refresh`
- `artifact.copySource`
- `palette.openFreeText` (Mod+Space — but rebind doesn't matter, hotkey is configurable)
- `keybindings.show` (Mod+/)
- `theme.toggleScanlines`
- `sync.now` (only if sync enabled)

## Quality bar (additions)

- The app feels designed. Open it next to Cursor and Linear and Raycast — Orion holds its own visually. If something feels generic, it isn't done.
- Global hotkey latency under 150ms (window raise + palette open). Pre-warm the palette component so it's not lazy-loaded on first invocation.
- Scanline overlay does not bleed into the artifact iframe (it's a separate document, by design).
- Reduced-motion preference is respected: scanlines off, signal pulse off, transitions reduced to instant.
- Artifact iframe never breaks the host app. Force a runtime error inside it during testing — host should be unaffected.
- Font is loaded before first paint of any text-heavy surface. Block initial render briefly if needed; FOUT is forbidden.

## What NOT to do this week

- Do not build a plugin system. Tempting; out of scope.
- Do not build a settings cloud. Settings live in `app_state` locally.
- Do not implement collaborative editing.
- Do not build mobile companion apps.
- Do not implement undo across the entire app. Local undo per editor is enough.
- Do not add a notification center / inbox.
- Do not add an MCP server config UI for Claude Code (still defer to `~/.claude/`).
- Do not redesign the layout. The three-pane + bottom + status structure is locked.
- Do not auto-update the artifact when Claude streams new content into the source message. Refresh is manual.
- Do not implement multi-device sync. Push-only backup, single device.

## How to start

1. Read this whole brief.
2. Restate the 5 mandatory deliverables (sync excluded).
3. Audit checkpoint: confirm command registry has `group` set on every existing command. The keybinding modal needs it. If any are missing or `'Other'`, fix the registrations rather than letting them fall through.
4. Build order: aesthetic lockdown (most existing surfaces churn here, do it before adding more) → keybinding modal (free signal that the registry is clean) → artifact rendering (the meaty new feature) → global hotkey (small, high-impact) → optional sync.
5. Ask before installing any dependency not listed.

When you can pop Orion from anywhere with a hotkey, paste a Claude artifact into the right rail and watch it run, see the keybinding cheat sheet match every action you can actually do, and the whole thing looks like the mockup — Week 4 is done. Orion ships.
