# Notion research — June 2026 (Phase 2 ground truth)

Condensed from two web passes (features + sentiment) + a code audit of Archives.

## Strategic thesis (the gift from sentiment research)
Notion's TOP complaints map 1:1 to Archives' structural moats:
- **#1 complaint = performance / capture latency.** Notion has a hard network-round-trip floor; "8s to open a page." The metric that matters for notes is **time-to-captured-thought**, and people leave for Apple Notes because it's "invisible." → We're local SQLite = instant. **Capture speed is our biggest winnable moat.**
- **Offline still half-baked** (50-row DB cap, dies on web, 30-day data-loss risk). → We're offline by default. Already won.
- **AI Q&A over your own notes is Notion's MOST-criticized AI surface** AND paywalled to Business tier. → We already have embeddings + hybrid FTS5. **"Ask your Archive" RAG attacks their weakest, using pieces we own.**
- **Lossy export / lock-in** (DBs export as CSV, toggles/callouts flatten). → Local SQLite + clean export = the Obsidian/Anytype trust pitch.
- **Build-then-abandon trap**: personal users spend 5–20h setup, abandon after 3–6 weeks. → We must **work great day one, near-zero setup, AI handles organization.**

But DON'T lose what people LOVE: multi-view databases, relations, all-in-one, nested wiki, templates.
Winning position = **"Notion's structure + Apple Notes' capture speed + Obsidian's local trust."** (Exactly the lane Anytype is praised for.)

## Notion features that matter (daily 80%)
- **Databases**: ~24 property types; views = table/board/calendar/list/gallery (+ timeline/chart/feed/map newer). Each view = independent filters (AND/OR groups, 3-deep) / sorts (multi-level) / grouping (+sub-group) / saved views. Sub-items (self-relation tree). Linked databases (same data, per-view config). Formulas 2.0 (JS-like).
- **Blocks**: callout, toggle (+toggle headings), synced block, columns, code (highlighted), equation/LaTeX, simple table, button (w/ @Today + formula vars), table-of-contents, breadcrumb, 300+ embeds.
- **Linking**: @-mention pages/people/dates (canonical; `[[` is a shortcut to the same picker), automatic **backlinks** panel, synced blocks, link-to-page. No visual graph (that's Obsidian).
- **AI 2026**: inline write/continue/summarize/translate; **workspace Q&A with citations** (RAG over your pages); AI autofill DB properties (auto-tag/summarize per row); agents (3.0/3.3, mostly team-gated). Multi-model routing.
- **Capture**: quick-capture inbox, web clipper (AI-summarizes on clip), **database templates with @Today + Repeat schedule** = the daily-note/recurring engine, template buttons.
- **Top daily workflows**: ⌘K jump · open today's daily note from template · quick-capture to inbox · /-block while writing · drag tasks in a filtered board · @-mention a project in a journal · Ask AI over workspace · inline AI assist · re-filter/flip DB views · web-clip · backlinks review.

## Archives audit verdict (current code)
| Area | Verdict |
|---|---|
| Data model | PARTIAL — title+blocks+kind+tags+1 collection+favorite; **NO typed-property/database layer** |
| Editor (BlockNote) | PARTIAL — stock blocks only (para/headings/lists/quote/code/image/table); no callouts/toggles/synced/columns |
| Views | PARTIAL — Today/Journal/Projects-tree/Notes-grid/Mood/Media/Favorites; **no table/board/gallery/calendar over notes** |
| Linking | MISSING — one-way orion:// links unreachable in-app; **no [[wikilink]], no @-mention, no backlinks** |
| Search | STRONG as hybrid FTS5+semantic navigation; **MISSING as "ask your notes" RAG** |
| AI in Archives | PARTIAL — strong agentic side-rail (MCP tools); **no inline editor AI; note auto-tag missing** (assets-only) |
| Capture/templates | MISSING — ⌘N only; **no quick-capture/daily-note/templates** |
| Stores | STRONG (but capped by the flat data model) |

Three biggest structural gaps: (1) database/views, (2) [[wikilinks]]+backlinks, (3) templates/quick-capture/daily-note.

## Ranked plan (impact-ordered — capture+AI first = our moats & Notion's weak spots)
1. **Capture & ritual** — global quick-capture hotkey → inbox; daily-note; templates w/ variables. (Our moat; day-one value.)
2. **AI-native Archives** — inline editor AI (rewrite/continue/summarize) + "Ask your Archive" RAG w/ citations + note auto-tag. (Attacks Notion's weakest+paywalled AI using retrieval we own.)
3. **Database views** — typed properties (additive migration) → table/board/gallery/calendar + filters/sorts/groups/saved views. (#1 structural gap & #1 loved Notion feature; biggest build, may split.)
4. **Linking & knowledge graph** — [[wikilink]] autocomplete + backlinks panel + unlinked mentions + working orion:// deep links.
5. **Editor power** — callouts, toggles, highlighted code, columns, better md paste, PDF export.

CUT (explicit, not silent): formulas/rollups/relations depth · timeline/chart/feed/map/form views · synced blocks · web clipper / cross-app AI connectors · multiplayer.
