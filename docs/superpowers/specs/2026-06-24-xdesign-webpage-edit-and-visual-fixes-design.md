# XDesign — generated-webpage editing + interactive-visual rendering fixes

**Status:** spec / plan (no code written yet). Hand off to a fresh build session.
**Date:** 2026-06-24
**Branch base:** current `main`-equivalent tip (XDesign is feature-complete per CLAUDE.md pt6).
**Discipline:** TDD pure logic first; gates per slice = `tsc` clean · `vitest` · `cargo check`/`test` (only if Rust touched) · `npm run build` exit 0. Commit each green slice. UI slices end at a user smoke-test gate (the agent can't run Tauri). Additive only — don't break the existing 🌐/🖥️/🎥 artifact flows.

---

## 0. Context for a fresh session (read first)

XDesign is the design app inside **Orion Terminal** (Tauri 2 + React 19 + Vite + TS). Its AI rail is `src/apps/xdesign/XDesignClaudeRail.tsx`. There are **two separate worlds**:

1. **Canvas** — vector shapes (`src/apps/xdesign/store.ts`, `Canvas.tsx`, `Inspector.tsx`, `LayersPanel.tsx`, `ToolRail.tsx`). All the editing tools operate on this shape model.
2. **HTML artifacts** — `🌐 Build webpage` / `🖥️ Build deck` / `🎥 Motion` generate a single self-contained HTML string that renders in a **sandboxed `<iframe srcdoc>`** inside `HtmlArtifactPreview.tsx`. State lives in `htmlArtifactStore.ts` (`html`, `title`, `open`, `viewport`, `builder`, `refiner`; persisted to `localStorage["xd-html-artifact"]`). Generation prompts + extract/strip live in `htmlArtifact.ts`; output quality guards in `artifactGuard.ts`; the generation pipeline (image-slot inlining + guard + auto-repair) is `renderArtifact`/`finishArtifact` in `XDesignClaudeRail.tsx`.

**The two worlds share nothing.** That's why none of the canvas tools can touch a generated webpage, and it's the crux of Part 2.

**Critical enabler:** the preview iframe uses `sandbox="allow-scripts allow-same-origin ..."`. Because it's **same-origin `srcdoc`**, the parent app can fully read AND edit `iframe.contentDocument` — select elements, edit text, change styles, re-serialize. This makes an in-place visual editor possible **without** converting HTML into canvas shapes (do NOT attempt HTML→shape import — it's lossy, huge, and the wrong direction).

---

## 1. Problem statement

Two user-reported issues (screenshot: a "DYE//RIOT" landing page; the hero shows a conic/"tie-dye" gradient square with a hard pinwheel seam):

1. **Interactive/generative hero visuals render broken.** A cursor-reactive or generative gradient (canvas/WebGL or CSS `conic-gradient`) shows a frozen / half-initialized / hard-seam state. It looks unfinished.
2. **A generated webpage can't be edited with the tools.** Only the conversational *Refine* box or *Export* exist. The user wants to select + edit elements directly.

---

## 2. Part 1 — interactive-visual rendering quality

### 2.1 Hypotheses (confirm by reading the real markup first)
The square is in the hero-visual slot. Most likely one of:
- **(A) Cursor-reactive `<canvas>`/WebGL** that warps toward the mouse — renders a frozen/partial first frame before any `mousemove`.
- **(B) CSS `conic-gradient`** "tie-dye" — the hard radial seam is the 0°/360° wrap discontinuity (start stop ≠ end stop).
- **(C) Custom-cursor element** (a `div` following the pointer) stuck at its default position.

Hard seam + clashing stops ⇒ most likely **(A)** or **(B)**.

### 2.2 Investigation (do this before coding)
- Reproduce, then **read the generated HTML**: it's in `localStorage["xd-html-artifact"]` and `useHtmlArtifact.getState().html`; or click **Export** in the preview and open the `.html`.
- Identify the square: `conic-gradient`? `<canvas>` + `requestAnimationFrame` + `mousemove`? WebGL? custom cursor?
- Verify live: (a) does it paint a good **first frame before any mouse move**? (b) does `mousemove` reach it inside the iframe? (c) is an overlay stealing `pointer-events`?

### 2.3 Fix — primary lever is generation rules (cheap, high ROI)
Add an **"Interactive & animated visuals"** block to the webpage `SHARED_RULES` in `src/apps/xdesign/htmlArtifact.ts` (the `sharedRules(imagesAvailable)` builder). Rules:
- Every effect must paint a **complete, tasteful static first frame** — never blank/half-init before interaction.
- Cursor-reactive effects must **degrade gracefully with no pointer present** and honor `prefers-reduced-motion` (static frame).
- **No hard `conic-gradient` seams**: match the 0%/100% stops, or prefer layered radial gradients / a blurred multi-stop mesh / inline SVG for organic gradients; a soft grain/blur overlay sells "tie-dye."
- **Keep the native cursor** — don't replace it with a custom element inside an artifact (reads as broken in preview).
- Any `<canvas>`/WebGL must guard for failed context creation and paint a fallback fill.

Apply the same block to `deckRules` and `buildMotionPrompt` where relevant (motion already has the canvas/reduced-motion guidance; keep them consistent).

### 2.4 Fix — optional guard (secondary)
In `src/apps/xdesign/artifactGuard.ts`, add a **soft** check: a `conic-gradient(...)` whose first and last color stops differ ⇒ a new `ArtifactIssue` code (e.g. `gradient-seam`) routed into the existing **one-shot auto-repair** in `finishArtifact`. Keep it conservative (avoid false positives); it's a nudge, not a hard block. Pure + unit-tested in `artifactGuard.test.ts`.

### 2.5 Files / slices (Part 1)
- Slice P1a: `htmlArtifact.ts` rules block (+ a vitest asserting the new rules appear in `buildWebpagePrompt`). Gate + commit.
- Slice P1b (optional): `artifactGuard.ts` seam check + repair wording (+ vitest). Gate + commit.

**Effort:** small. No Rust, no migration.

---

## 3. Part 2 — edit a generated webpage with tools (in-place visual editor)

Build a visual editor **on the HTML artifact**, parent-side via the same-origin `contentDocument`. Do **not** import HTML into the canvas.

### 3.1 Phase 1 — click-select + inline text + mini toolbar (do this first)
Goal: fix copy and basic styling visually; covers ~80% of edits.

- Add an **Edit** toggle to `HtmlArtifactPreview.tsx`. When on, inject selection handlers into `iframe.contentDocument`:
  - Click an element → outline + mark it selected (an injected `<style>` for the outline; track the selected element via a stable path/marker).
  - Double-click a text element → `contentEditable` inline edit; commit on blur/Enter.
- A floating **contextual toolbar** for the selected element: font-size ±, bold/weight, text color, background color, delete, duplicate. (Writes inline styles / mutates the node.)
- **Persistence:** on any change, debounce-serialize `iframe.contentDocument.documentElement.outerHTML` back into `useHtmlArtifact.getState().setArtifact(serialized, title)` so edits persist + export. Guard against feedback loops (don't re-inject editor chrome into the saved HTML — strip injected `<style>`/attributes before serializing).
- **Reduced-motion / safety:** the Edit mode should pause artifact animations (or it's fine if they keep running) — verify selection works over animated canvases.

### 3.2 Phase 2 — element inspector (richer)
- A right-rail inspector for the selected element: typography (family/size/weight/line-height/tracking), color, padding/margin (spacing), background, border, radius — writing inline styles. Plus reorder among siblings (move up/down), delete, duplicate.
- Free-form drag in a flow layout is **Webflow-grade** — treat as a stretch, not Phase 2 core.

### 3.3 Phase 3 — element-scoped AI refine (bridges visual + AI; also the cleanest Part-1 fix)
- Click an element → type an instruction → the model rewrites **just that element's markup**. Reuses the refine pipeline (`buildRefinePrompt` → an element-scoped variant that passes the selected element's `outerHTML` + a selector and asks for the replacement node). e.g. select the broken hero square → "make this a smooth radial gradient, no seam."

### 3.4 Pure, testable core (TDD)
New `src/apps/xdesign/htmlEditor.ts` (pure, unit-tested):
- A stable element-path scheme (e.g. child-index path) to identify/select a node across re-serializations.
- `serializeForSave(doc)` — strip injected editor chrome (outline `<style>`, `data-xd-*` attributes, `contenteditable`) before persisting.
- Style read/write helpers (parse/merge an inline `style` string).
- Phase 3: `buildElementRefinePrompt(selectorOrOuterHTML, instruction, brand)`.
The DOM-bridge wiring in `HtmlArtifactPreview.tsx` is the thin, untested side-effect layer.

### 3.5 Files / slices (Part 2)
- Slice P2a: `htmlEditor.ts` pure core + tests (paths, serialize-strip, style merge).
- Slice P2b: `HtmlArtifactPreview.tsx` Edit toggle + selection bridge + inline text edit + persist. Smoke gate.
- Slice P2c: mini contextual toolbar (size/color/bold/delete/duplicate). Smoke gate.
- Slice P2d (Phase 2): element inspector. Smoke gate.
- Slice P2e (Phase 3): element-scoped refine (reuses `htmlArtifact.ts`). Smoke gate.

### 3.6 Risks / scope notes
- **Serialization normalizes markup** — keep it debounced and round-trip-tested; strip editor chrome first.
- **Keep `allow-same-origin`** on the iframe — the whole approach depends on it.
- **Don't** attempt HTML→canvas-shape import.
- Decks/motion artifacts also flow through this preview — Edit mode should be enabled for webpages (and probably decks) but is meaningless for a pure motion canvas; gate the toggle on `!hasCanvas` or always allow but expect limited utility on canvas-only artifacts.

---

## 4. Recommended order
1. **Part 1 §2.3 prompt rules** (immediate quality bump, tiny).
2. **Part 2 Phase 1** (`htmlEditor.ts` + Edit toggle + inline text + mini toolbar) — "I can actually edit it."
3. **Part 2 Phase 3** element-scoped refine — closes the loop and is the most natural fix for bad visuals.
4. Part 2 Phase 2 inspector + Part 1 §2.4 guard as polish.

## 5. Smoke tests (user-run, post-restart if Rust changes — Part 1/2 are frontend-only, no restart needed)
- Part 1: 🌐 Build a bold landing page with a generative hero → the hero renders a clean static visual (no hard conic seam, no frozen canvas); hovering animates it if interactive.
- Part 2 P1: open a generated page → toggle **Edit** → click a headline → it outlines; double-click → edit the text → it persists after closing/reopening the preview and in the exported HTML.
- Part 2 P1: select an element → mini toolbar changes its color/size; delete/duplicate works.
- Part 2 P3: select the hero square → "make this a smooth radial gradient" → only that element changes.

## 6. Gates (every slice)
`tsc` clean · `vitest` green · `npm run build` exit 0 · (`cargo check`/`test` only if Rust touched — Parts 1 & 2 are frontend-only). Commit each green slice. UI slices end at a user smoke-test gate.
