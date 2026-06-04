# Personal Workstation — Build Brief (Week 3)

## Where we are

Week 1 shipped the shell, command registry, palette, file tree, Monaco read-only, persistence. Week 2 shipped Monaco editing, the Claude CLI chat panel with streaming, inline edits with diff overlay, terminal, OS-keychain API key. If any of that is shaky — especially the streaming pipeline or the command registry — fix it first. Week 3 piles new surfaces on top of both.

## What Week 3 is

The week Orion stops being a code editor and becomes a workstation. Three things plug in:

1. **Notes** — BlockNote-powered, hierarchical, lives in the main canvas as a new tab type alongside files
2. **Assets** — drag-drop / paste / screenshot ingest, viewable as a grid, queryable, taggable
3. **Unified search** — one query box (in the palette) that searches files, notes, asset metadata, and chat history simultaneously, ranked. FTS5 for keyword, local embeddings for semantic.

The unifier is the palette. Cmd+K already opens commands and files. Now it also opens notes, assets, past chats, and free-text search across all of them.

## Stack additions — locked

- **Block editor:** `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine` (the Mantine theme is the closest to our aesthetic and we'll override its tokens; we are not pulling in Mantine itself for anything else)
- **Embeddings (local):** `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` (384-dim, ~25MB, CPU-friendly). Runs in the renderer via WebAssembly. No GPU required.
- **Vector search:** `sqlite-vec` extension loaded into the existing SQLite connection. 384-dim cosine similarity. ~50KB extension.
- **Image handling:** `image` crate in Rust for thumbnail generation. JPEG/PNG/WebP/GIF in, WebP thumbnails out.
- **URL metadata:** `scraper` + `reqwest` in Rust to extract OpenGraph tags. No headless browser.
- **Screenshot capture:** `tauri-plugin-screenshots` if it covers our needs, otherwise a thin Rust wrapper over `screencapture` / `gnome-screenshot` / Windows API. Decide after a 30-min spike.
- **Drag-drop:** Tauri's built-in `tauri://drag-drop` event. No JS lib needed.
- **Fuzzy ranking:** `fuzzysort` (already small) for in-memory ranking of palette results post-FTS

Do not introduce other libraries without flagging it first.

## Week 3 deliverables — only these

By end of Week 3 the app should:

1. **Notes pane.** Cmd+N creates a note. Notes appear in the sidebar under a "NOTES" section with a tree (parent_id hierarchy). Open a note and BlockNote renders in the main canvas as a new tab type. Edits autosave with 500ms debounce. Cmd+P inside a note inserts a `[[link]]` to another note via inline palette.
2. **Asset ingest.** Drag-drop a file onto the window → asset created, file copied to `~/.orion/assets/<id>.<ext>`, thumbnail generated for images. Paste a URL anywhere in the app → asset created with OG metadata fetched. Cmd+Shift+4 takes a region screenshot and creates an image asset. Paste image from clipboard → asset created.
3. **Asset grid.** New view (Cmd+Shift+A) showing all assets as a dense grid: thumbnail for images, OG card for URLs, monospace preview for snippets, file icon for files. Filter bar at top with kind chips and tag chips. Click an asset → detail pane on the right with metadata, tags, source, "open external," "copy reference."
4. **Tags.** Add/remove tags from notes and assets via a `#tag` autocomplete in any tag input. New tags created on the fly. Tag list view (Cmd+Shift+T) shows all tags with counts and lets you filter into the asset grid or note list.
5. **Unified search.** Palette has a free-text mode (no `>` prefix and no file picker shortcut) that searches across notes (title + body), asset metadata (title + URL + OG description + tags), chat history (titles + messages), and project files (filename only — content search comes later). Results grouped by entity type, ranked by FTS5 score with recency tiebreak.
6. **Semantic search.** Cmd+Shift+F opens a dedicated search overlay. Embeds the query, runs cosine similarity against `embeddings` table, returns top 20 across notes/assets/chats. Falls back gracefully if embeddings haven't been generated yet for a given entity.

Nothing else. No artifact rendering, no Supabase, no cross-device sync, no AI tagging, no auto-summarization.

## Architecture: notes

### Storage

`notes.blocks_json` stores the BlockNote document as JSON. BlockNote's serialize/deserialize is a straight `editor.document` JSON blob. Don't try to be clever with the storage format — store what BlockNote gives you.

### Tabs

Notes share the existing tab system with files. A tab has a `kind` discriminator: `'file' | 'note' | 'asset-grid' | 'asset-detail'`. The store key changes from "open file paths" to "open tab descriptors." This is a refactor of Week 1 state — do it cleanly, not with a parallel system.

```ts
type TabDescriptor =
  | { kind: 'file'; path: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'asset-grid'; filter?: AssetFilter }
  | { kind: 'asset-detail'; assetId: string };
```

### Hierarchy

`parent_id` references on notes give you the tree. Sidebar renders it. Drag-drop reordering and reparenting in the sidebar is **out of scope** for this week — context-menu "move to…" is fine. Don't get sucked into building a full tree DnD lib.

### Inline note links

`[[double bracket]]` syntax. When the user types `[[`, intercept and open a small palette anchored to the cursor showing notes by title. Selecting one inserts a BlockNote link node (custom block or inline content) carrying the note id. Click in read mode → switch to that note's tab.

### Autosave

500ms debounce after last keystroke. Save writes the full `blocks_json` and updates `updated_at`. No partial/incremental saves. If the doc is large enough that this is slow, the doc is too large — we'll deal with it later.

## Architecture: assets

### Storage layout

```
~/.orion/
├── orion.db                # the SQLite DB
└── assets/
    ├── <ulid>.png          # original
    ├── <ulid>.thumb.webp   # thumbnail (max 512px on long side)
    └── ...
```

`file_path` in the DB stores the relative path inside `~/.orion/assets/`, not absolute. Resolve at read time.

### Asset kinds

```
'image'     — png/jpg/webp/gif, file_path set, thumb generated
'url'       — web link, url + metadata_json (title, description, og:image url, site_name, fetched_at)
'snippet'   — code or text snippet, body in metadata_json.body, language in metadata_json.language
'file'      — anything else (PDF, audio, video, doc), file_path set, no thumb
'note-ref'  — RESERVED for future, do not implement
```

### Ingest paths (all converge on the same `create_asset` Rust command)

- **Drag-drop file**: copy to `~/.orion/assets/<id>.<ext>`, generate thumb if image, infer kind by extension
- **Paste URL** (detected from clipboard text matching a URL regex when the palette is open or right-rail focus): fetch HEAD + first 64KB, parse `<title>`, `<meta og:*>`, store metadata. 5s timeout, gracefully degrade to just the URL if fetch fails.
- **Paste image from clipboard**: write bytes to file, generate thumb
- **Screenshot**: invoke OS capture, get bytes back, treat as paste image
- **Paste snippet**: detected when clipboard is plain text >40 chars and not a URL — palette offers "Save as snippet" command. Don't auto-create from every clipboard event.

### Thumbnails

Generate eagerly on ingest. Use `image` crate, resize to max 512px on long side, encode WebP at quality 75. If thumb generation fails (corrupt image, unsupported format), log and continue — the asset still exists, just without thumb. Grid falls back to a kind icon.

### Asset grid

Virtualized — `react-virtuoso` is fine if needed; don't add it preemptively. Start with naive rendering and only virtualize if you hit slowdown past 500 assets in dev.

Card layout:

```
┌──────────────────────┐
│   [thumbnail 1:1]    │
│                      │
├──────────────────────┤
│ title (truncate)     │
│ kind · 14:32 · 3 tags│
└──────────────────────┘
```

Aesthetic: square thumbs, hairline borders only, hover reveals a checkbox for multi-select and an inline tag input. No card shadows. No rounded corners beyond 2px.

## Architecture: tags

`tags` and `*_tags` tables already exist from Week 1. Just wire them up.

- Tag input is a single component reused in note frontmatter, asset detail, and as a filter in the grid
- `#` triggers autocomplete from existing tags, sorted by usage count
- Creating a new tag: type a tag that doesn't exist + Enter → tag row created + association added in one transaction
- Deleting a tag from one entity removes only that association. Deleting a tag globally is a separate destructive command (`tags.delete`) that requires confirmation.

## Architecture: search

### FTS5 triggers

Wire `search_index` (Week 1 schema) to populate via SQLite triggers:

```sql
CREATE TRIGGER notes_search_insert AFTER INSERT ON notes BEGIN
  INSERT INTO search_index(entity_id, entity_type, title, body)
  VALUES (NEW.id, 'note', NEW.title, json_extract(NEW.blocks_json, '$.plaintext'));
END;
-- mirror update + delete triggers for notes, assets, chats
```

The `plaintext` extraction is the hard part. BlockNote doesn't give you plaintext for free — write a small recursive walker over the document JSON that concatenates text nodes. Run it on save (in TS), store the plaintext in a column or alongside the JSON. Triggers then read that column. **Do not try to do the JSON walk inside SQLite.**

For assets: index `title || ' ' || metadata_json` (the JSON-as-text approach is good enough for OG descriptions). For chats: index the concatenated message texts, regenerated on each save of the chat.

### Search query

```sql
SELECT entity_id, entity_type, title, snippet(search_index, 3, '<mark>', '</mark>', '...', 16) as preview, rank
FROM search_index
WHERE search_index MATCH ? ORDER BY rank LIMIT 50;
```

Use `bm25(search_index)` for ranking; SQLite FTS5's default rank is bm25-based. Combine with a recency multiplier in TS:

```
final_score = fts_score * (0.7 + 0.3 * recency_factor)
recency_factor = exp(-age_days / 30)
```

### Embeddings table

```sql
CREATE TABLE embeddings (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  embedding BLOB NOT NULL,           -- 384 floats as bytes (sqlite-vec format)
  generated_at INTEGER NOT NULL,
  source_hash TEXT NOT NULL,         -- hash of source text, regenerate if changed
  PRIMARY KEY (entity_id, entity_type)
);
```

### Embedding pipeline

- Generated lazily on a background timer when the app is idle (5s after last input event), in batches of 10
- Notes: embed title + plaintext body, truncated to 512 tokens
- Assets: embed title + OG description + tags
- Chats: embed title + last 4 messages
- Hash the source string. If hash matches stored row, skip. If not, regenerate.
- Run `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` in the renderer. First load is ~25MB and slow — show a one-time "preparing semantic search…" status on first use, then it's cached by the browser/Tauri webview.

### Semantic search query

Embed the query string, run via `sqlite-vec`'s `vec_distance_cosine` against the `embeddings` table, top 20. Hydrate the entity rows in a second query.

### Unified palette behavior

Palette has implicit modes based on input prefix:

- `>` → commands only
- `@` → notes only
- `#` → tags only
- (file extension match like `.ts`) → file priority
- otherwise → free-text search across all entities, ranked

Cmd+Shift+F always opens semantic mode regardless of prefix.

## New commands to register

- `note.new` (Mod+N when not in editor; Mod+Shift+N always)
- `note.delete`
- `note.openByTitle`
- `note.linkInsert` (Mod+P inside a note)
- `asset.openGrid` (Mod+Shift+A)
- `asset.screenshot` (Mod+Shift+4)
- `asset.pasteFromClipboard`
- `asset.openByTitle`
- `tags.list` (Mod+Shift+T)
- `tags.delete`
- `search.semantic` (Mod+Shift+F)
- `search.regenerateEmbeddings` — dev/admin command, force regenerate all

## Data model: confirm and add

Mostly already in Week 1's schema. Add:

```sql
ALTER TABLE notes ADD COLUMN plaintext TEXT NOT NULL DEFAULT '';
-- existing notes get backfilled on first open via the BlockNote walker

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
-- this was implied in Week 1 ("note_tags") but verify it exists; if not, migration

-- embeddings table as specified above
-- search triggers as specified above
```

New migration file. Do not edit prior migrations.

## Quality bar (additions)

- Drag-drop never blocks the UI. Ingest is async; the asset card appears immediately with a loading state, thumb fills in when ready.
- Search results stream in as they're computed — FTS results within 50ms, semantic within ~300ms (the embedding inference is the bottleneck)
- BlockNote autosave is invisible — no spinners, no "saved" toasts. The status line shows a single dot indicator if there are pending writes.
- Embedding model load happens once per app session, in a worker if possible to avoid blocking the main thread
- Asset detail "copy reference" puts a markdown-style reference on the clipboard: `![title](orion://asset/<id>)` for images, `[title](orion://asset/<id>)` for everything else. Implement the `orion://` protocol handler in Tauri so these can be clicked from notes.

## What NOT to do this week

- Do not implement note backlinks panel ("notes that reference this note"). Week 4 polish, maybe.
- Do not implement asset versioning or edit history.
- Do not auto-tag with AI. The user tags manually.
- Do not auto-summarize notes or assets with Claude. That's a separate feature, later.
- Do not implement folder-style organization for assets. Tags only.
- Do not import from other tools (Notion, Obsidian, Apple Notes). Future feature.
- Do not build cloud sync.
- Do not render PDFs or videos inline. The detail pane shows metadata + an "open external" button.
- Do not build full-text search inside project source files. Filename-only this week.
- Do not pre-generate embeddings on a giant batch at first run. Lazy + idle-time only.

## How to start

1. Read this whole brief.
2. Restate the 6 deliverables.
3. Audit the Week 1/2 state for two specific things and report back before coding:
   - Is the tab system extensible (i.e., does it close over a `kind` discriminator or hardcode "file paths")? If hardcoded, the first move is the refactor.
   - Are the FTS5 triggers from the Week 1 schema actually firing? Quick sanity check by inserting a row and querying `search_index`.
4. Build order: tab system refactor → notes (BlockNote + autosave + sidebar) → tags wiring → asset ingest pipeline (drag-drop first, then URL paste, then clipboard, then screenshot last) → asset grid → FTS unified search in palette → embeddings + semantic search.
5. Ask before installing any dependency not listed.

When you can take a screenshot, paste it, drop it into a note via `[[link]]`, then find that note three days later by typing a vague description into Cmd+Shift+F — Week 3 is done.
