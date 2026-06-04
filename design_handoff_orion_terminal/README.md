# Handoff: Orion Terminal

> A liquid-glass, dark-neon personal workstation in the spirit of Iron Man's J.A.R.V.I.S. — a desktop OS shell that runs three deeply integrated apps (Archives 47, Orion, XDesign) with Claude embedded inside each one as a context-specific collaborator.

---

## About the design files

The files bundled with this handoff are **design references created in HTML/React/CSS** — high-fidelity prototypes that show the intended look, layout, and behavior of Orion Terminal. They are **not production code to ship directly.** They use:

- React 18 via UMD CDN (no build step)
- Babel Standalone to transpile JSX in the browser
- Plain CSS (no Tailwind / no design-system framework)
- A bespoke `window.claude.complete` call to talk to the model — this is a sandbox helper, not a real API

Your task is to **recreate this design in your real codebase's existing environment** (whatever framework you're using — React/Next, SwiftUI, Tauri/Electron, Vite + Web Components, etc.) using its established component library, styling system, and AI SDK. If no environment exists yet, pick the framework that best fits a multi-window desktop product (Electron, Tauri, or a desktop-shell React app are all reasonable; Tauri + React is recommended for size/perf).

## Fidelity

**High-fidelity.** Every color, type ramp, spacing value, shadow, border, and copy line in the prototype is intentional. Recreate it pixel-faithfully using your codebase's primitives. The only thing that is rough is **content stand-ins** (sample notes, sample code, sample design layers) — those are illustrative; you'll wire them up to real data sources.

---

## Concept

Orion Terminal is one app that contains three apps, plus a J.A.R.V.I.S.-style assistant.

| Layer | Name | Role |
|---|---|---|
| Shell | Orion Terminal | Wallpaper, menubar, dock, draggable windows, Spotlight (⌘K), system clock |
| App 1 | **Archives 47** | Personal Notion — notes, journal, mood boards, media library |
| App 2 | **Orion** | AI-first code editor with file tree, syntax-highlighted source, live visualizer, inline Claude diff suggestions, integrated terminal |
| App 3 | **XDesign** | Design studio — Figma + Photoshop + Illustrator + Unicorn.studio hybrid, with tool rail, layers panel, infinite canvas, and inspector |
| Assistant | **Claude** | Context-specific in each app — different system prompt, different opening line, different suggestion chips, different accent color |

> "Orion" is intentionally both the name of the workstation **and** the name of the code editor. They're branded as one ecosystem.

---

## Visual language

### Palette (acid green + cyan + yellow on near-black)

| Token | Hex | Use |
|---|---|---|
| `--bg-0` | `#03060a` | Deepest background |
| `--bg-1` | `#060a0f` | Card/section background |
| `--bg-2` | `#0a1015` | Raised surfaces |
| `--bg-3` | `#10171d` | Hover / focused surfaces |
| `--neon-green` | `#39ff88` | **Archives accent**, primary CTA, success, "claude online" |
| `--neon-cyan` | `#00e0ff` | **Orion accent**, info, branch / git markers |
| `--neon-yellow` | `#e6ff3a` | Warnings, unsaved-changes dot |
| `--neon-magenta` | `#ff3ea5` | **XDesign accent**, errors, selection handles |
| `--neon-violet` | `#b14cff` | Aurora layer, syntax keywords |
| `--t-primary` | `#e6f4ec` | Primary text |
| `--t-secondary` | `#9ab0a8` | Secondary text |
| `--t-tertiary` | `#5a706a` | Tertiary text, hints |
| `--t-faint` | `#324036` | Disabled / dividers |

**Each app has its own accent color** (green for Archives, cyan for Orion, magenta for XDesign). The accent appears in: app icon glow, active-tab underline, Claude orb gradient, selection highlights, primary button gradients.

### Typography

| Family | Used for |
|---|---|
| **Space Grotesk** (300, 400, 500, 600, 700) | All UI text, headings, body copy |
| **JetBrains Mono** (300, 400, 500, 600) | Code, timestamps, status pills, ALL-CAPS section labels, telemetry |

**Type scale:**
- Display H1 (journal title): 36–38px, weight 500, letter-spacing −0.02em
- Section H2: 22–24px, weight 500
- Card H3 (mono): 11px, weight 400, letter-spacing 0.18em, uppercase
- Body: 13–15px, weight 400, line-height 1.6–1.75
- Caption / mono labels: 10–11px, letter-spacing 0.1–0.2em, uppercase
- Code: 12.5px, line-height 1.65

### "Liquid glass" surface treatment

The original design used `backdrop-filter: blur(40px) saturate(180%)` heavily. **We stripped this for renderer-perf reasons** (six nested blurs crashed Chromium). In a real desktop app you can put it back — Electron/Tauri runners handle it fine. The recipe for one glass surface:

```css
background: rgba(8, 14, 18, 0.62);
backdrop-filter: blur(40px) saturate(180%);
border: 1px solid rgba(180, 255, 220, 0.18);
box-shadow:
  inset 0 1px 0 rgba(255, 255, 255, 0.08),   /* top highlight */
  0 40px 100px -20px rgba(0, 0, 0, 0.8);     /* outer drop */
```

Add a `::before` overlay with a 160deg gradient (white 6% → transparent) to fake top-light refraction.

The opaque fallback (what ships in the prototype) uses `rgba(8, 14, 18, 0.92)` and no blur. Both read as glass thanks to the inset highlight + outer shadow.

### Radii, shadows, spacing

| Token | Value |
|---|---|
| `--r-sm` | 6px |
| `--r-md` | 10px |
| `--r-lg` | 16px (windows) |
| `--r-xl` | 22px (dock) |
| `--r-pill` | 999px |
| `--shadow-window` | `0 30px 80px -20px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(0,0,0,0.5)` |
| `--shadow-glow-green` | `0 0 24px -4px rgba(57, 255, 136, 0.5)` |
| `--shadow-glow-cyan` | `0 0 24px -4px rgba(0, 224, 255, 0.5)` |

Spacing follows a loose 4/8/12/14/18/28/44 scale. Window padding is 14–18px; section padding is 28–44px.

---

## Shell

### Wallpaper

Multi-layer composite (z-stacked from back to front):

1. **Base radial:** `radial-gradient(circle at 50% 50%, #07101a 0%, #03060a 80%)`
2. **Magenta+cyan+green radial bloom** in the corners
3. **Three aurora blobs** (radial gradients, ~600–800px diameter, opacity 0.25–0.4) — magenta top-left, cyan mid-right, green bottom-center. In production: animate with `transform: translate()` over 30s for slow drift.
4. **Star field** — ten 1×1px radial-gradient dots at varying opacity (0.4–0.8)
5. **Perspective grid** (synthwave horizon) — bottom 50% of viewport, `linear-gradient` cross-hatch at 80px, `transform: perspective(600px) rotateX(60deg)`, opacity 0.3
6. **Horizon line** — 2px tall, `linear-gradient(to right, transparent, cyan, green, yellow, transparent)`, glow shadow, sits at 45% from bottom
7. **Orion constellation** — top-right corner, ~220×280px, seven cyan/white dots connected by faint cyan lines (0.25 opacity). This is the brand mark hiding in plain sight.

### Menubar (32px tall, fixed top)

- Left: `ORION TERMINAL` wordmark with a pulsing green dot (2s ease-in-out, opacity 1↔0.4)
- Then the active app's name (bold) + its menu items (`File`, `Edit`, …) — items change based on focused window
- Right: a green "CLAUDE • ONLINE" pill, wifi icon, battery `84%`, date (`Wed, May 13`), live clock `HH:MM:SS` (24h)
- Background: `rgba(3, 6, 10, 0.92)`, no blur in the prototype but should be `blur(28px) saturate(160%)` in real builds

### Dock (centered bottom, 14px from edge)

- Pill-shaped, ~22px radius
- Padding 8/12, gap 10
- App tiles: 48×48 rounded 14px, each tile wraps a 32×32 gradient backdrop in its app color + outline-stroke icon in white at 18px
- Hover: `translateY(-6px) scale(1.08)` over 200ms
- Active app: 4px green dot 8px below the tile, glow 6px
- Divider after the 3 apps; then a Spotlight (search icon) and the Claude orb (24px)

### Windows

Behavior:
- **Draggable** by the titlebar (mousedown → mousemove → mouseup)
- **Z-index focus management** — clicking anywhere in the window brings it to the front and dims unfocused windows to `opacity: 0.96, filter: saturate(0.85) brightness(0.92)`
- **Traffic lights** (red/yellow/green dots, 12px, 8px gap):
  - red = close (sets `minimized: true`, app stays available in dock)
  - yellow = minimize (same as close in this prototype)
  - green = maximize (toggles full-screen minus 24px margins and 78px chrome)
- Title centered, mono, ALL-CAPS letter-spaced; format `APP NAME · subtitle`
- Right edge of titlebar shows `⌘K` keyboard hint
- Body uses CSS flex with min-height: 0 so internal scroll regions work

### Spotlight (⌘K)

- Modal: 520px wide, 16% from top
- Black overlay at 0.7 opacity behind (no blur in prototype; `blur(6px)` in production)
- Glass surface with a green-tinted outer glow
- Input row: Claude orb (20px) + autofocused text field + ESC hint
- Result list: icon + label + mono hint + keyboard shortcut
- First result highlighted with green left-border + green-tinted bg
- Footer: `↑↓ nav` / `↵ open` / "claude · listening" indicator
- Toggle: bind to Cmd+K (Mac) and Ctrl+K (others); Esc closes

---

## Archives 47 (green accent)

### Layout

- **Left sidebar (200px):** search input → "Library" section (Today / Journal / Notes / Mood Boards / Media) → "Collections" (Personal / Work / Research / Dreams) with 8×8 colored swatches → "Tags" wrap of mono pills
- **Main column (flex 1):** toolbar (breadcrumb + share/star/+/⋯) → scrolling content
- **Right rail (320px):** Claude chat panel

### Today view (default)

Hero: greeting block (`Wed · May 13 · 2026` in green mono → `Good evening, Eli.` 38px) + a right-aligned italic quote (last note to self)

Two-column grid below:
- **Left col:** "Today's journal" card (entries with timestamp/title/preview, dividers) + "Recent threads" 2×2 grid
- **Right col:** "Captured today" (4 media thumbnails) + "On this day, last year" (italic memory + date) + a green-glow "Claude's read of your week" callout with colored span highlights

### Journal editor

- Sticky 44px formatting toolbar: H1/B/I groups, list/quote/code, image/link, separator pills, right-aligned auto-save badge (`draft · auto-saved 14:42`)
- Max-width 760px column, 38/60 padding
- Title 36px, then mono stamp row (date · tag chips)
- Body: 15px text, 1.75 line-height
- Blockquote: 2px cyan left border, italic, secondary text
- "Claude noted" callout: green gradient background, sparkle icon, label + body. This is how Claude annotates writing inline.

### Notes

2-column card grid. Each note: tag chip top-left, date top-right, title 16px, preview 13px @ 1.6 line-height.

### Mood boards

- Header: title 24px + "12 tiles · last edit 2h ago" + chips (collaborative / claude curating)
- Pinterest-style masonry via CSS `columns: 3; column-gap: 14px`
- Tile heights vary (140/160/180/220/260/280). Each is a gradient-filled placeholder — production should swap to real images
- Hover reveals a mono caption at the bottom of the tile (gradient overlay)

### Media library

- Pill toolbar: All · Images · Video · Audio · Docs counts → right side: "auto-tagged by Claude" + grid toggle
- Grid: `repeat(auto-fill, minmax(160px, 1fr))`
- Each tile: 110px gradient preview (color-coded by file type) + name + size + tag chip

### Claude in Archives

- Name: **Archive Assistant** · Sub: "indexed · 1,284 notes · 412 media"
- Accent: green
- System prompt (paraphrased): "You are Claude embedded in Archives 47, the user's personal knowledge base for notes, journals, and mood boards. Help organize, summarize, find connections, suggest tags. Warm, concise (1–3 sentences)."
- Suggestion chips: `Summarize today's notes` / `Find linked ideas` / `Suggest tags` / `What did I journal last week?`
- Opening line: "I noticed you wrote about Orion Terminal yesterday and again this morning — want me to start a thread linking the two entries?"

---

## Orion (cyan accent)

### Layout (left → right)

1. **File explorer (220px)** — `EXPLORER` mono header, recursive tree with folder/file icons (folders cyan when open), indent 12px per level, active file gets cyan left-border + tinted bg. Dirty files show a yellow dot. Bottom row: git branch (green) + "3 changes · 1 staged"
2. **Editor area (flex 1):**
   - Tab strip (32px): each tab has icon + filename + close X (or dirty dot). Active tab gets cyan top-border + darker bg.
   - Split below: **live preview pane (360px)** | **code area (flex 1)**
   - Preview pane: top bar "● LIVE · localhost:3047 · refresh" + render area showing a stylized mini Orion-inside-Orion (recursive 🤯) + "UPDATED 0.3s AGO · HOT RELOAD" caption
   - Code area: gutter (50px, line numbers right-aligned) + monospaced syntax-highlighted source
   - **Inline Claude diff suggestion** appears between code lines — green-glow card, sparkle icon, "CLAUDE SUGGESTED" label, body, then `⌘ ↵ ACCEPT` / `ESC` buttons. Accept/reject removes the card.
3. **Integrated terminal (150px tall)** — tabs (dev/build/tests/+), output with green prompts, cyan paths, yellow warnings, mock `npm run dev` output that ends with "claude ❯" suggesting a fix
4. **Status bar (24px)** — git branch (green) · 0 errors · 2 warnings · cursor pos · file type · "⌘K claude" hint

### Syntax tokens

| Token | Color |
|---|---|
| Keywords (`import`, `const`, `return`) | `#ff7eb6` (pink) |
| Functions / components | cyan |
| Strings | yellow |
| Numbers | magenta |
| Comments | faint, italic |
| JSX tags | violet |
| JSX attrs | green |
| Variables | `#f8e88c` (warm yellow) |

The current line gets a 4% cyan wash + cyan gutter number. Diff lines: `+` rows green-tinted, `−` rows red-tinted at 0.6 opacity.

### Claude in Orion

- Name: **Code Companion** · Sub: "reading · Orion.tsx · 27 lines"
- Accent: cyan
- System prompt: "You are Claude embedded inside Orion, an AI-first code editor. You have read-access to the file being edited. Help the user write, refactor, and explain code. Reply concisely. Reference code by line or symbol when relevant."
- Suggestion chips: `Explain this file` / `Refactor useClaude hook` / `Add tests` / `Fix the warning`
- Opening line: "I see Orion.tsx wires the file tree, editor, and visualizer in one workspace. Want me to extract the layout into a Workspace component, or keep it inline?"

---

## XDesign (magenta accent)

### Layout (left → right)

1. **Tool rail (52px)** — vertical column of 36×36 tool buttons: Move, Hand, [divider], Rect, Ellipse, Vector pen, Text, Image, Pen, [divider], AI tool (sparkle, green). Active tool has magenta gradient bg + 4×14px magenta indicator hanging off the right edge. Each button shows its keyboard shortcut as a tiny 8px char in the corner.
2. **Layers panel (240px)** — Tabs: Layers / Assets / Pages. Magenta underline on active tab. Section header "Page · orion-marketing". Layer rows: 14×14 color swatch + name + eye/lock icons that appear on hover. Indent for grouped layers. Selected layer: magenta left border + tinted bg.
3. **Canvas (flex 1)** — dotted background (22px grid), 36px toolbar (zoom % · X/Y · current frame pill · dimensions · "✦ Claude designing"). Stage area is `overflow: hidden`; artboards are absolutely positioned around the origin. Each artboard has a mono label above-left with `WIDTH × HEIGHT` in faint text.
   - **Three artboards** in the demo: "Orion Hero / Frame 02" (selected, 540×340) with a stylized mini-Orion-Terminal inside; "Onboarding / Frame 01" (280×180) with a single Claude orb centered; "Logo / Mark" (220×180) showing a vector Orion-constellation logo.
   - **Selected artboard** gets a magenta selection rect with 8 handles (corners + midpoints, 8×8 white squares with magenta border), and a small magenta dimension badge `340 × 200` floating below the bottom-left handle.
4. **Inspector (240px)** — Tabs: Design / Prototype. Sections: Frame (X/Y/W/H, rotate, radius), Fill (color picker with swatch + hex + opacity), Backdrop (blur), Stroke (color + weight), Effects (rows for liquid glass / outer glow / drop shadow with toggle eyes), Auto-layout (direction / gap / padding). Each field is `60px label / value-input` grid, mono 11px values.

### Claude in XDesign

- Name: **Design Partner** · Sub: "watching · Archives 47 Frame · 340×200"
- Accent: magenta
- System prompt: "You are Claude embedded inside XDesign, an AI-assisted design studio. You can see the user's selected layer and suggest visual changes, generate variations, critique compositions. Concise. Speak like a design partner, not a tutorial."
- Suggestion chips: `Critique this frame` / `Try 3 hue variants` / `Tighten the hierarchy` / `Add a dark variant`
- Opening line: "Selection looks balanced but the hero text is fighting the dock for attention. Want me to push the type up two steps and dim the dock by 20%?"

---

## Claude chat panel (shared component)

Right rail, 320px wide, full window height.

- **Header (12/14 padding):** Claude orb (26px, radial-gradient white→accent→cyan, 16px glow, 4s ease-in-out pulse from 1.0→1.08) + name (mono, uppercase, letter-spaced) + sub (11px tertiary) + ⋯ icon
- **Messages area (flex 1, 14px padding, 12px gap):** empty state shows centered sparkle + "Ready when you are."
  - **User message:** right-aligned, max 92% width, green-tinted bg, green border, 12/10 padding, 4px br-radius on bottom-right corner
  - **Assistant message:** left-aligned, neutral 4% white bg, 4px br-radius on bottom-left
  - **Thinking state:** italic tertiary "thinking" with a green blinking caret pseudo-element
- **Suggestion chips:** wrap, cyan-tinted pills. Show only when conversation is under 2 messages.
- **Input row:** textarea (rgba 0.3 bg, 1px border, focus → green ring) + 36×36 gradient send button (green→cyan, dark icon)
- Enter sends, Shift+Enter newline, send is disabled while busy or empty

### Wiring Claude in production

The prototype calls `window.claude.complete({ messages, system })` which is a sandbox helper. In production, replace with your AI SDK call. The contract:

```ts
type Args = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  system: string;
};
type Return = Promise<string>;
```

Pass the system prompt per app (see the three system prompts above). Stream tokens if your SDK supports it — the panel is already set up to swap a "thinking" placeholder for the final message.

---

## Interactions

| Trigger | Behavior |
|---|---|
| Click dock app icon | If minimized, restore; bring to front with max z-index |
| Click traffic-light red | Set window `minimized: true`; still in dock |
| Click traffic-light green | Toggle maximize (full-screen minus menubar + dock margins) |
| Mousedown on titlebar | Begin drag; `cursor: grabbing`; track delta; clamp `y >= 32` so window can't slide under menubar |
| Click anywhere in window | Focus it (move to top of z-stack), dim others |
| ⌘K / Ctrl+K | Toggle Spotlight |
| Esc (in Spotlight) | Close |
| Click ⌘K item | Run its action + close Spotlight |
| Click a sidebar nav item (Archives) | Switch the main content view |
| Click a tool (XDesign) | Set it active (visual only in prototype) |
| Click a layer (XDesign) | Set it selected (visual only) |
| Type in Claude input + Enter | Append user message, set busy=true, render "thinking", call API, append assistant message |
| Hover dock item | `translateY(-6px) scale(1.08)` |
| Hover mood-board tile | Fade in caption gradient |

### Animations

| Element | Property | Duration | Easing |
|---|---|---|---|
| Menubar status dot | opacity 1↔0.4 | 2s infinite | ease-in-out |
| Claude orb | scale 1↔1.08 | 4s infinite | ease-in-out |
| Aurora blobs (prod) | translate + scale | 30s alternate | ease-in-out |
| Dock item hover | transform | 200ms | ease |
| Mood-tile caption | opacity | 150ms | ease |
| Window focus dim | opacity + filter | (instantaneous in prototype; 200ms recommended) | ease-out |
| Tree open/close | chev rotate | 150ms | ease |

---

## State

In the prototype, all state is local React state. For a real product, lift this:

- **Shell state** (windows array: `{ id, x, y, w, h, z, focused, minimized, maximized }`, plus spotlight open) → a zustand/jotai store called `useShell`
- **Each app's state** → independent stores: `useArchives`, `useOrion`, `useXDesign`
- **Claude conversations** → per-app conversation log, persisted across window close (only cleared on explicit "new chat")
- **Persisted to disk:** window positions, last-open files/notes, conversation history, theme tweaks

---

## File / asset inventory

The bundle includes:

| File | What it is |
|---|---|
| `Orion Terminal.html` | Root document — loads React, Babel, fonts, all source files |
| `styles.css` | Global tokens (palette, radii, shadows, type), shell chrome (wallpaper, menubar, dock, window), shared primitives (sidebar, claude rail, glass) |
| `src/icons.jsx` | Single `Icon` factory + an `I` registry of ~30 line icons (24×24 viewBox, 1.5 stroke). Replace with your icon system (Lucide is the closest match in spirit) |
| `src/wallpaper.jsx` | `Wallpaper` (composite layers + constellation SVG) and `MenuBar` (active-app aware) |
| `src/shell.jsx` | `WindowFrame` + `useDraggable` hook, `Dock` |
| `src/claude-chat.jsx` | `ClaudeChat` — the shared right-rail panel. Single source of truth for assistant UI. |
| `src/archives-styles.js` | Scoped CSS for Archives — injected via DOM at load |
| `src/archives.jsx` | `ArchivesApp` shell (sidebar + nav state + Claude wiring) + `ArchivesToday` + `ArchivesToolbar` |
| `src/archives-views.jsx` | `ArchivesJournal`, `ArchivesNotes`, `ArchivesMood`, `ArchivesMedia` |
| `src/orion-styles.js` | Scoped CSS for Orion |
| `src/orion.jsx` | `OrionApp`, `OrionTreeNode`, `OrionEditor` (with syntax tokens), `OrionPreview`, `OrionTerminalPanel`, mock code + tree data |
| `src/xdesign-styles.js` | Scoped CSS for XDesign |
| `src/xdesign.jsx` | `XDesignApp`, `XDToolRail`, `XDLayers`, `XDCanvas` (with three demo artboards), `XDInspector` |
| `src/main.jsx` | Top-level desktop component — owns windows array, focus/minimize/maximize, Spotlight, ⌘K key handler |

### Assets used

- **Fonts:** Space Grotesk + JetBrains Mono via Google Fonts CDN. In production, self-host woff2 files.
- **Icons:** All hand-drawn line icons via inline SVG. No raster art. **Recommended replacement:** [Lucide](https://lucide.dev) — same visual language, 24×24, 1.5 stroke. Map names below.
- **Images:** None. The mood board and media library use CSS-gradient placeholders. **In production:** the user uploads their own images, or you ship a default set in `public/seed/`.

#### Icon name → Lucide equivalent

| Internal | Lucide |
|---|---|
| `archives` | `Archive` |
| `orion` | `CodeXml` or custom |
| `xdesign` | `Sparkles` or custom |
| `search` | `Search` |
| `plus` | `Plus` |
| `send` | `Send` |
| `mic` | `Mic` |
| `wifi` | `Wifi` |
| `battery` | `Battery` |
| `cmd` | `Command` |
| `bold`/`italic`/`heading`/`list`/`quote`/`code`/`image`/`link` | same names in Lucide |
| `folder`/`file`/`chev` | `Folder`, `File`, `ChevronRight` |
| `pen` | `Pen` |
| `layers` | `Layers` |
| `move`/`hand`/`square`/`circle`/`type`/`vector`/`eye`/`lock` | matching Lucide names |
| `play`/`terminal`/`branch` | `Play`, `Terminal`, `GitBranch` |
| `sparkles` | `Sparkles` |
| `x`/`more`/`filter`/`grid`/`tag`/`refresh`/`download`/`share` | matching Lucide names |

---

## Implementation notes / gotchas

1. **The two-OrionTerminal bug.** I (the designer) initially named both the workstation and the code-editor's terminal pane `OrionTerminal`. They were loaded via separate Babel scripts so the second declaration overrode the first → `OrionApp` rendered `OrionTerminal` recursively → renderer crash. In your real codebase use ES modules and this won't bite. But: **never reuse "Orion Terminal" as a component name** — it's the product name.
2. **Backdrop-filter cost.** Six nested glass layers killed Chromium. In Electron/Tauri it's fine. If you ship on the web, use it sparingly (one layer per window, not per panel).
3. **Window dragging** in the prototype uses raw mouse events. For production, use [`@use-gesture/react`](https://use-gesture.netlify.dev/) — handles touch + pointer + edge clamping for free.
4. **Z-index management:** keep a single `maxZ` counter in the shell store; on focus, set the focused window to `maxZ + 1`. Reset to small numbers periodically to avoid runaway integers.
5. **Spotlight should be fuzzy-searchable.** Use [Fuse.js](https://fusejs.io/) for filtering across "open app", "recent notes", "files", "commands", and "ask Claude" as a single index.
6. **The Claude orb gradient** uses three stacked radial-gradients to fake a soft 3D sphere. In production you can also use a `<canvas>` or shader for an animated marble effect.
7. **The wallpaper's perspective grid** uses `transform: perspective(600px) rotateX(60deg)`. This forces a compositor layer — fine on desktop, expensive on mobile.
8. **Live preview pane in Orion** renders a stylized mini-Orion. In a real editor wire this to whatever sandbox you use (esbuild + iframe is the common pattern).

---

## Recommended next steps (not in this handoff)

These were discussed but not built — flag for the next round:

- Window open/close animations (scale 0.95→1 + opacity 0→1 on mount, reverse on close, 200ms cubic-bezier(0.2, 0, 0, 1))
- Dock magnify on hover (Mac-style, neighboring icons scale based on cursor distance)
- A global voice waveform that appears in the menubar when Claude is listening
- A fourth placeholder slot in the dock for "and more to come…" with a faint `+` glyph
- Real persistence (window positions, conversation history, recent files) via IndexedDB or your app's data layer
- Multi-window-per-app (e.g. open two journal entries side by side)
- Light theme — would need a full token re-pass; current design is built for dark only

---

## Quick-start (for the dev)

1. Decide your framework. Recommendation: **Tauri + React + Zustand + Lucide + Framer Motion** — best size/perf for a real desktop app with this design density.
2. Set up the design tokens (CSS variables or a `tokens.ts` exporting the table at the top).
3. Build the shell first (`Wallpaper` → `MenuBar` → `Dock` → `WindowFrame`). Verify drag + focus + minimize + maximize.
4. Build `ClaudeChat` as a reusable component — it's used three times.
5. Build each app shell (sidebar + main + claude rail) and stub the content.
6. Wire one Claude conversation end-to-end with your real SDK. Confirm the system prompts work and the per-app personalities feel distinct.
7. Fill in content for each view, pixel-matching the prototype.
8. Polish: window animations, dock magnify, voice waveform, fourth-app slot.

Refer to the HTML files in this bundle whenever you need the exact value of anything — they're the ground truth.
