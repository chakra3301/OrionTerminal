# RepoLens — Website "Design MD" Extractor

**Date:** 2026-06-15
**Status:** approved — ready for implementation planning
**Branch:** `feat/repolens-website-ripper` (this feature builds directly on the Website Ripper, which lives on that branch — see "Context" below)
**Scope:** A per-website "Extract MD" action that uses the subscription `claude` CLI to analyze a finished clone's design and produce a **structured Design Spec**, rendered as a rich visual style-guide board (color swatches, type specimens, component cards) inside a new **Design MDs** sub-view of the Websites tab. Exportable to a real `.md`.

---

## 0. Context a fresh session needs

This extends the **RepoLens Website Ripper** (spec: [docs/superpowers/specs/2026-06-15-repolens-website-ripper-design.md](2026-06-15-repolens-website-ripper-design.md)). Read that first. Current state on the branch:

- RepoLens lives at `src/apps/archives/repolens/`. Class prefix `.rl-*`. Accent var `--repolens-green` (#1fb85f).
- The **Websites tab** already exists: `RepoLensView.tsx` has a `tab: "repos" | "websites"` toggle (local `useState`); the websites side renders `RepoLensWebsitesLibrary.tsx` (grid of `WebsiteRipRow` cards + a live progress panel).
- Website rips are stored in table `repolens_websites` (migration `0022`). Frontend read layer: `repolensWebsitesDb.ts` (`WebsiteRipRow`, `listRips`, `getRip`, `deleteRipRow`). Store: `useRepoLensWebsites.ts` (`rips`, `load`, `rip`, `cancel`, `continueRip`, `remove`, `openInOrion`, `applyEvent`).
- Each rip's cloned project lives at `<project_path>` = `$APPDATA/repolens/websites/<id>/project/`. `$APPDATA` on macOS = `~/Library/Application Support/com.lucaorion.orion-terminal`.
- The rip engine is Rust `src-tauri/src/repolens_website.rs` (single-agent, mirrors `hermes.rs`). It already has helpers: `open_conn`, `now_ms`, `augmented_path` (from `claude_cli`). Commands registered in `lib.rs` `generate_handler!`.
- **Highest existing migration = 0022.** This feature adds **0023** (append-only — never edit an applied migration).
- RepoLens already renders structured AI output as rich cards: `RepoLensReport.tsx` parses a `RepoAnalysis` (via `parser.ts` `parseClaudeResponse`) and renders a hero + `.rl-card` sections (health ring, pros/cons, pills). **Mirror this pattern** — the Design MD view is a structured render, NOT raw markdown.
- Subscription claude infra: `repolens_claude_call(prompt, model) -> RepoLensReply { result: String, cost: f64 }` (`src-tauri/src/repolens.rs:189`), serialized through a 1200ms queue. Image attach mechanism (from `claude_oneshot_with_image`): the CLI reads **`@<abs-path>` references inline in the prompt** — append `\n\n@<path>` per image at the end of the prompt.
- Shared model picker: `RepoLensPickers.tsx` + `useRepoLens` `model.default_model`. Reuse it (the Websites tab already shows it).

**⚠️ A `tauri dev` restart is required** (new migration 0023 + new Rust command).

---

## 1. Locked decisions (user-approved 2026-06-15)

| Question | Decision |
|---|---|
| What the AI analyzes | The clone's **extracted artifacts + screenshots** (not a re-fetch, not the generated code) |
| Storage / scope | **One design spec per website, re-extractable** (overwrites). A column on `repolens_websites`. |
| Where it lives | **Inner toggle inside the Websites tab: `Rips` \| `Design MDs`** (not a top-level tab) |
| Output form | **Structured JSON** (`DesignSpec`) rendered as a visual board; `.md` is a derived export |
| Model | The **shared RepoLens model picker** |
| Screenshots attached | The **original-site recon** shots (describe the real design) |

---

## 2. Data model — migration `0023_repolens_website_design.sql`

Append-only ALTER on the existing table:

```sql
ALTER TABLE repolens_websites ADD COLUMN design_json TEXT;
ALTER TABLE repolens_websites ADD COLUMN design_at INTEGER;
```

- `design_json` — the raw JSON string returned by the AI (the `DesignSpec`; null until extracted). Stored raw; the frontend parses it (mirrors how `repolens_scans.analysis_json` is stored raw and parsed by `parser.ts`).
- `design_at` — epoch ms of the last successful extraction (null until extracted).

Register in `lib.rs` after the version-22 `Migration` entry:
```rust
Migration {
    version: 23,
    description: "repolens: per-website design spec (extract MD)",
    sql: include_str!("../migrations/0023_repolens_website_design.sql"),
    kind: MigrationKind::Up,
},
```

Frontend: add `design_json: string | null` and `design_at: number | null` to `WebsiteRipRow` in `repolensWebsitesDb.ts` (SELECT * already returns them).

---

## 3. The `DesignSpec` schema (structured output)

New file `src/apps/archives/repolens/designSpec.ts` — types + a fail-soft parser (mirror `parser.ts`).

```typescript
export type ColorSwatch = {
  name: string;        // "Primary", "Surface", "Accent", "Text"
  role: string;        // short role description
  hex: string;         // "#39ff88" — used directly as the swatch background
  ramp?: string[];     // optional shades, light→dark, each a hex
};

export type TypeSpecimen = {
  role: string;        // "Display", "Heading", "Body", "Label"
  family: string;      // "Inter", "Space Grotesk", ...
  fallback?: string;   // "sans-serif" | "serif" | "monospace" — for the specimen
  sizePx?: number;     // representative size for the specimen
  weight?: number;     // 400, 600, 700
  sample?: string;     // sample text (default "Aa")
  usage?: string;      // where it's used
};

export type ComponentNote = {
  name: string;        // "Primary Button", "Search Input", "Badge"
  description: string; // styling + behavior, 1-3 sentences
  // optional visual hints the renderer can use for a mini preview:
  preview?: { kind: "button" | "input" | "badge" | "card" | "other"; fillHex?: string; textHex?: string; radiusPx?: number };
};

export type DesignSpec = {
  title: string;            // site/design name
  aesthetic: string;        // one-line vibe ("dark, neon-accented, brutalist grid")
  designLanguage: string;   // 1 paragraph: mood, references, overall feel
  colors: ColorSwatch[];
  typography: TypeSpecimen[];
  spacing: { scale: number[]; notes?: string }; // e.g. [4,8,12,16,24,40], container widths in notes
  components: ComponentNote[];
  motion: string;           // animations, transitions, scroll behavior (prose)
  responsive: string;       // breakpoints + what changes (prose)
  imagery: string;          // imagery/iconography style (prose)
  voice: string;            // content tone (prose)
  rebuildNotes: string;     // how to rebuild this look (prose)
};

// Fail-soft: salvage fenced/prose-wrapped JSON exactly like parser.ts.
export function parseDesignSpec(raw: string): DesignSpec { /* indexOf("{") .. lastIndexOf("}"), JSON.parse, coerce arrays to [] */ }

// Serialize a DesignSpec to a clean Markdown document for the Copy/Download .md action.
export function designSpecToMarkdown(s: DesignSpec): string { /* headings per section; colors/type as tables */ }
```

Both functions are pure → unit-test them (`designSpec.test.ts`): parse a sample fenced response, assert arrays default to `[]` on junk, and round-trip `designSpecToMarkdown` contains the title + each color hex.

---

## 4. Generation — Rust command `repolens_website_extract_design`

Add to `src-tauri/src/repolens_website.rs`:

```rust
#[tauri::command]
pub async fn repolens_website_extract_design(
    app: AppHandle,
    id: String,
    model: Option<String>,
) -> Result<String, String>
```

Behavior:
1. Read the row's `project_path` from `repolens_websites`.
2. **Gather artifacts** from `<project_path>/`, each read fail-soft and **size-capped** (e.g. 24k chars each, total budget ~80k):
   - `docs/research/style.css` (original site CSS — colors, fonts, spacing)
   - `docs/research/dom-structure.json` and `docs/research/global-ui-structure.json` (structure)
   - `src/app/globals.css` (the generated token set)
   - `docs/research/BEHAVIORS.md` / `PAGE_TOPOLOGY.md` if present (motion/responsive)
   - a head excerpt of `docs/research/source.html` (for fonts/meta) — small cap
3. **Pick screenshots** to attach: the original-site recon shots under `docs/design-references/` — prefer names containing `desktop` then `mobile`, falling back to any non-`clone-`/non-`comparison` image (reuse the rip's "exclude scaffold placeholders" idea). Cap at 2 images.
4. Build the prompt = the **DESIGN_PROMPT** (section 5) + the gathered artifact text, then append `\n\n@<abs path>` for each chosen screenshot (the CLI reads these inline — see `claude_oneshot_with_image`).
5. Call claude via the same machinery as `repolens_claude_call` (augmented PATH, `--print --output-format text`, `--model <model or default>`, subscription auth — funnel through the existing serialized queue if reachable; otherwise a direct call mirroring `repolens.rs`). Capture the result text.
6. Save: `UPDATE repolens_websites SET design_json = ?, design_at = ? WHERE id = ?`.
7. Return the raw result string.

It's a single ~20-40s awaited call (not a long agent), so no streaming/events — the frontend awaits with a spinner. Register the command in `lib.rs` `generate_handler!` next to the other `repolens_website_*` commands. Add the ipc wrapper `repolensWebsiteExtractDesign(id, model)` in `ipc.ts`.

---

## 5. The DESIGN_PROMPT

Instruct the model to return **only** a fenced ```json block matching `DesignSpec`, populated from the attached screenshots + artifacts, with **exact hex values** and real font families. Key directives:
- "You are a senior design systems analyst. Reverse-engineer the design system of this website from the screenshots and extracted CSS/DOM."
- "Return ONLY one fenced ```json code block, no prose, matching this TypeScript type: <inline the DesignSpec type>."
- "Colors: extract the real palette as hex from the CSS/screenshots; group into named roles; include ramps where the site uses shades. Typography: identify each font family actually used and its roles/sizes/weights. Components: inventory the distinctive UI components with their styling. Be specific and exact — no placeholders."
- "If a field is unknown, use a short honest string or an empty array — never invent."

(Optionally a tone preamble via the existing `tone.ts` `withTone`, if the Websites tab exposes tone — otherwise omit.)

---

## 6. UI

### 6a. Rips subtab — the "Extract MD" button
In `RepoLensWebsitesLibrary.tsx`, on each **done** website card, add an **"Extract MD"** action (button on the card and/or context-menu item):
- Click → store action `extractDesign(id)` → button shows **"Extracting…"** + disabled (track an in-flight set in the store).
- On success → toast "Design MD ready", and the card gains a subtle "has design" marker; the spec appears in the Design MDs subtab.
- Re-click on a card that already has one → re-extracts (overwrites), confirm-gated via the existing toast/confirm pattern is optional.

### 6b. Inner toggle in the Websites tab
In `RepoLensView.tsx` websites branch (or inside `RepoLensWebsitesLibrary`), add a secondary toggle `webSub: "rips" | "designs"` (local `useState`), styled like the existing `.rl-tabs`/`.rl-tab` (reuse classes). `rips` → current grid; `designs` → `<RepoLensDesignMDs />`.

### 6c. Design MDs subtab — `RepoLensDesignMDs.tsx`
- **Grid** of websites where `design_json != null`: cards showing hostname + thumbnail + `design_at` age. Empty state explains "Extract a design MD from a finished clone."
- **Click a card → the visual board** (`DesignSpecBoard`, can be a section in the same file): parse `design_json` via `parseDesignSpec`, then render RepoLens-style (`.rl-card` sections, hero with hostname + thumbnail):
  - **Color system**: swatch ramps — each `ColorSwatch` is a tile with `style={{ background: hex }}`, the name, role, and the hex label; ramps render as a horizontal strip of shade chips. (Like the user's reference board.)
  - **Typography**: per `TypeSpecimen`, a big `Aa` (or `sample`) rendered with `style={{ fontFamily: \`${family}, ${fallback ?? "sans-serif"}\`, fontSize, fontWeight }}` + a label line (family · weight · size · usage). Honest fallback when the font isn't web-available.
  - **Components**: small cards per `ComponentNote`; render a mini preview when `preview` is present (e.g. a styled button/badge using `fillHex`/`radiusPx`), else just name + description.
  - **Spacing**: the `scale` as labeled bars (width ∝ value).
  - **Narrative cards**: design language, motion, responsive, imagery, voice, rebuild notes — readable `.rl-card`s.
  - **Actions**: **Re-extract** (calls `extractDesign`), **Copy .md** / **Download .md** (via `designSpecToMarkdown` → clipboard / `exportImport` save pattern already used in Archives).
- CSS: a `.rl-dm-*` block in `tokens.css` (swatch grid, specimen, component preview, bars), cohesive with the `.rl-*` RepoLens chrome + `--repolens-green` accent.

### 6d. Store additions (`useRepoLensWebsites.ts`)
```typescript
extracting: Set<string>;                 // rip ids currently extracting
extractDesign: (id: string) => Promise<void>;  // sets extracting, awaits ipc, reloads row, toasts
```
`hasDesign(row)` is just `row.design_json != null`. The Design MDs grid filters `rips` by that.

---

## 7. Files touched

| Area | Files |
|---|---|
| Rust | `src-tauri/src/repolens_website.rs` (+`repolens_website_extract_design`), `src-tauri/src/lib.rs` (migration 23 + command reg), `src-tauri/migrations/0023_repolens_website_design.sql` |
| TS data/logic | `src/apps/archives/repolens/designSpec.ts` (+`designSpec.test.ts`), `repolensWebsitesDb.ts` (row fields) |
| TS store/ipc | `useRepoLensWebsites.ts` (`extractDesign`), `src/lib/ipc.ts` (`repolensWebsiteExtractDesign`) |
| TS UI | `RepoLensWebsitesLibrary.tsx` (button + inner toggle), new `RepoLensDesignMDs.tsx` (grid + `DesignSpecBoard`), maybe `RepoLensView.tsx` |
| CSS | `.rl-dm-*` block in `src/styles/tokens.css` |

---

## 8. v1 scope

**In:** Extract MD button per done rip · Rust extract command (artifacts + 2 screenshots → DesignSpec JSON) · migration 0023 · Rips/Design MDs inner toggle · visual board (color swatches, type specimens, component cards, spacing bars, narrative) · re-extract · copy/download .md · pure-logic tests for `parseDesignSpec` + `designSpecToMarkdown`.

**Out (deferred):** versioned/multiple design MDs per site · diffing two sites' design systems · auto-loading the original Google Font for exact specimens · editing the spec in-app · feeding the spec back into XDesign.

---

## 9. Notes / risks

- **Restart required** (migration 0023 + new Rust command).
- **Font specimens** only render in the true face if it's web-available; otherwise they fall back while still conveying size/weight (stated to the user, accepted).
- **Token cost**: one subscription-CLI call per extract (no per-token billing on the Max plan); artifacts are size-capped to keep the prompt bounded.
- **Parsing robustness**: mirror `parser.ts`'s salvage approach; coerce all array fields to `[]` so a malformed reply degrades to a partial board instead of throwing.
- **UI is human-unverified** (agent can't run Tauri) — gate each slice on `tsc` / `vitest` / `cargo check` / `cargo test` / `npm run build` exit codes, then a user smoke test.

---

## 10. Smoke test (user)

1. Restart `tauri dev`. RepoLens → Websites → Rips → on a **done** clone card, click **Extract MD** → "Extracting…" → toast "ready".
2. Switch the inner toggle to **Design MDs** → the site appears → click it → a visual board renders: real color swatches with hex, `Aa` type specimens, component cards, spacing bars, narrative sections.
3. **Re-extract** overwrites; **Download .md** saves a readable markdown file.
