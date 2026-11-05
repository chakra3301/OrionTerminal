# Archives 47 as a standalone macOS app: proposal

Status: **proposal, waiting for owner approval. No code written.**
Branch: `alpha/archives-app` (worktree `~/Orion_Terminal-worktrees/archives-app`, from `45f1b14`).
Date: 2026-11-04.

## What Archives needs from the rest of Orion (measured)

**TypeScript.** `src/apps/archives/` has 121 source files (158 with tests). Following every import from there reaches **886 files**: 486 of them are XDesign, and the rest include the Orion editor, Command Center, Hermes, Incubator, LSP, voice/wake word and the pptx vendor bundle. All of that comes in through about 10 "hub" edges. Cutting those edges leaves **246 files**: Archives itself plus `features/notes` (21), `features/agents` (15), `features/database` (3), `components/effects` (10, the orb), about 30 stores and about 20 `lib/` files (`db`, `ipc`, `embeddings`, `embeddingIndexer`, `searchHybrid`, `semanticSearch`, `vectorStorage`, `inferenceClient`, `log`, `time`, `fileDrop`, …).

The hub edges to cut, or turn into injected hooks:

| Edge | Why it pulls in everything | Fix |
|---|---|---|
| `components/ClaudeChat` → `features/context/contextProviders` → `plugins/builtinApps` (+ `apps/orion/ptyTerminal`, `pluginManagerStore`) | builtinApps lazy-registers every app; the context providers offer terminal output, git diff and the file tree | Context providers become a registry that the host fills. Orion registers what it registers today; Archives registers notes only |
| `features/agents/dispatchSend` and `resolveSend` → `features/intake/skillActivation`, `skillRuns` | imported-skill activation | Skill activation becomes an optional hook (a no-op in Archives) |
| `store/appConfigStore` → `apps/orion/claude`, `apps/xdesign/claude`, `skillsStore` → `features/intake` | the per-app persona defaults table | A defaults registry; each app registers its own |
| `store/pluginManagerStore` → `commandStore` → `apps/command/*`, `hermesStore`, `builtinApps` | plugin enable state | Archives doesn't load the plugin manager; its contributions register directly |
| `apps/archives/searchNav` → `features/rosie` (dynamic) | Rosie chat hits | A host-provided router |
| `shell/store/useShell` (5 uses: `openApp("archives")`, 2× `openApp("orion")`) | in-canvas windows | A host `openApp`: no-op/focus in Archives; "Open in Orion Terminal" when it's installed |
| `store/projectStore` → `apps/orion/runtimeActivity` | RepoLens's "open site in Orion" | The same host hook |
| `lib/db.ts` → `apps/xdesign/projectAssetImport` | type-only; erased at build | None needed |

**Native.** About 55 Tauri commands are reachable after the cut, plus `tauri-plugin-sql`:
- media download: 29
- RepoLens: 8 (including website rip, which needs node/npx)
- assets: 3 (`asset_store_file`, `asset_store_bytes`, `asset_delete_file`)
- AI send and cancel: 8 (`claude_*`, `cli_*`, `cursor_*`, `runtime_cancel`; plus `learn_claude_call` and `repolens_claude_call`)
- file system: 4 (`read_file`, `save_file_atomic`, `path_exists`, `read_dir_tree`)
- other: `analysis_work_dir`, `git_working_diff`, and `xdesign_state_*` (only through `db.ts`, never called by Archives)

The Rust modules involved are `learn`, `repolens`, `repolens_website`, `asset`, `media_download` (11.7k lines), `fs_ops`, `claude_cli`, `cli_engine`, `cursor_engine`, `runtime`, `provider_keys`, `api_key`, `cli_auth`, `connector_status`, `process_group`, `db_backup`, `draft_recovery`, and `mcp_config`/`mcp_server` (these give the AI rail its note tools through `--mcp-serve`). They all live in the single crate `orion_terminal_lib`, whose `run()` registers about 266 commands.

**Database.** `orion.db` lives in `~/Library/Application Support/com.lucaorion.orion-terminal/` (240 MB, WAL mode). It has 39 append-only migrations, which `tauri-plugin-sql` runs in whichever app opens the file. The tables Archives uses:
- notes and organisation: `notes`, `note_tags`, `tags`, `collections`, `collection_properties`, `collection_views`, `note_property_values`
- media and boards: `assets`, `asset_tags`, `asset_transcripts`, `mood_boards`, `mood_board_assets`
- AI and search: `chats`, `embeddings`, `search_index`
- Learn and RepoLens: `learn_topics`, `learn_nodes`, `learn_edges`, `learn_reviews`, `learn_achievements`, `repolens_scans`, `repolens_websites`
- downloads: `media_download_*`
- shared: `app_state` (shared key/value), `activity_log`

Asset files sit beside the DB in `assets/`, and the asset protocol is scoped to `$APPDATA/assets/**`.

**Settings, accounts and AI.**
- Per-app persona and tools: `appConfigStore`.
- Providers and models: `providersStore`, `modelPrefsStore`, `agentsDb` (`providers`, `agents`, `skills` tables).
- Keys: in the keychain under service `personal-workstation`.
- Subscriptions: the CLI subscriptions (Claude, Codex) are per macOS user.

**Plugin hooks.** `registerArchivesContributions` adds 12 commands with hotkeys (⌘N, ⌘⇧N, ⌘⇧A, ⌘⇧D, ⌘P, …), 4 global overlays, the `open_note` bridge action, and the internal events.

## 1. Approach

| | (a) Archives-only build target in the Orion repo | (b) Extract a shared package | (c) Separate copy |
|---|---|---|---|
| What | A second Vite entry (`archives.html` → `src/standalone/archives/main.tsx`), a second Tauri config overlay, and a second Rust entry (`run_archives()`) in the same crate that registers only the ~55 commands | Move Archives and its 246-file closure into `packages/archives` (npm workspaces), with Orion and Archives.app both consuming it | Copy the 246 TS files and the Rust modules into a new repo |
| Up-front cost | Medium: cut the ~10 hub edges in shared Orion code (behind tests), plus a host shell, menu, config and scripts | High: Orion has no workspaces today, every `@/` import is rewritten, git blame churns, and the in-flight `boot`, `companions` and `dock` branches conflict | Low on day one |
| Drift | None: one source | None | Immediate. Archives code changed in 5 commits in the last 60 days; every fix lands twice, and the migrations diverge |
| Ongoing risk | An Orion change can break the standalone build, so a boundary test and a standalone typecheck/build run in `verify` | Lowest coupling once done | Two products, two bug lists |
| Release | Tied to the Orion repo and its version | Separately versionable | Fully independent |
| Binary | Same crate; commands that aren't registered are dead-stripped, so the bundle is smaller than Orion's (~100 MB) | Same | Smallest |

**Recommendation: (a), shaped so (b) stays possible later.** The hub cuts are the same work (b) would need first: an `ArchivesHost` interface in `src/apps/archives/host.ts` that Orion and the standalone shell each implement. If Archives later needs its own version line, or an EMP-style plugin build, moving the folder into a package becomes mechanical.

## 2. Data

Three options:
- **Shared** (both apps open Orion's `orion.db`). SQLite in WAL mode with a 5 s busy timeout won't corrupt the file when two processes write. The risks are in the apps:
  1. **Migration skew.** If one app ships migration 40 and the other is older, sqlx refuses to start the older one ("migration 40 was previously applied but is missing"), and that app can't open your library at all until it's rebuilt.
  2. **Lost edits.** `notesStore` hydrates into memory and writes back debounced whole-body patches. With no cross-process change feed, a note left open in one app can overwrite a newer edit made in the other (last writer wins).
  3. **Single-owner jobs run twice.**
     - The media-download lease file sits in each app's data dir, so both apps run the same queue rows.
     - On launch, `repolens_website::reconcile_on_boot` marks every `running` rip as "interrupted by restart", so opening Archives would fail an in-flight rip in Orion.
     - The embedding indexer and the startup DB backup run in both apps.
  4. **Assets.** The files live in Orion's data dir, outside Archives' asset-protocol scope.
- **Own** (Archives has its own data dir and DB). It's safe and simple, but your existing notes aren't there.
- **Own + import from Orion Terminal (recommended for v1).** File → "Import from Orion Terminal…":
  - It takes a consistent snapshot of `orion.db` with the SQLite backup API (as `db_backup.rs` already does), never opening the live file for writing.
  - It copies the Archives tables and the referenced asset files into Archives' own DB, idempotently by ULID.
  - Orion's data stays read-only, and the import can be re-run to pick up new notes.

  A live "use Orion's library" mode can come later, once there's a schema-version guard (refuse instead of crash) and a change feed that reloads notes when the other app writes.

## 3. v1 scope

All 13 views ship, because they all work on the cut-down closure: Today, Journal, Projects, Notes, Favorites, Databases, Media + Downloads, Mood boards, Search/Ask (`AskArchive`, hybrid search), Brain, Learn, RepoLens, and Chats.
- **Chats**: only Archives-origin chats; Orion editor chats stay in Orion (they arrive only if imported, and then read-only).
- **RepoLens**: the "Open in Orion" actions become "Open in Orion Terminal" when Orion is installed, and are hidden otherwise.
- **Downloads**: uses the same yt-dlp/ffmpeg discovery as Orion.

How the Orion-only pieces are replaced:
- **Accounts / sign-in / lock screen**: none. Single local user, like EMP.
- **AI providers**: a small Settings window (⌘,), "AI" section only. It reuses `providersStore`, `modelPrefsStore` and the provider-key commands: provider and model pick, CLI sign-in status, API keys, and the Archives persona/tools from `appConfigStore`. Keys: I propose sharing Orion's keychain service, so you don't re-enter them. macOS asks once to allow "Archives 47" to read each item. Separate keys are the alternative.
- **Companion (Rosie and the 3D companions)**: not shipped. The Archives AI rail (`ClaudeChat` with the Archives persona) stays. Its note tools come from `archives-47 --mcp-serve`, with the tool list limited to the archive tools (`orion_search_archive`, `orion_read_note`, `orion_create_note`, `orion_update_note_body`, `orion_list_recent_notes`, `orion_list_assets`, `orion_search_assets`).
- **Dock**: none; the app uses the normal macOS Dock icon.
- **Spotlight**: replaced by an in-app ⌘K palette, made from the existing archive search (`searchHybrid` hits) plus Archives' own commands behind the `>` prefix, the same behaviour as today.
- **Plugin hooks**: no community plugin runtime (no `plugin_*` commands). Archives' 12 contributions register straight into the local command registry and the native menu, and its 4 overlays mount in the host.
- **Kept infrastructure**: draft recovery (`drafts_*`) and the startup DB backup (keeps 5), both in Archives' own data dir.
- **Theme**: Orion's default tokens with the green accent. No theme picker in v1.

## 4. Window and menu bar

- **Window**: one native window titled "Archives 47", minimum 900×600. The title bar is an overlay with a hidden title, so the Archives sidebar runs under the traffic lights. No wallpaper, menubar component, dock, window frame, boot, welcome or lock screen.
- **Menu bar**: native, built with Tauri's JS menu API so every label comes from TypeScript:
  - **Archives 47**: About Archives 47 ("Archives 47 — an Orion Terminal app"), Settings… ⌘,, Hide, Quit.
  - **File**: New Note ⌘N, Quick Capture ⌘⇧N, New Journal Entry, Import from Orion Terminal…, Export….
  - **Edit**: the standard macOS items.
  - **View**: one item per section with ⌘1…⌘9, Toggle Sidebar, Toggle AI Rail, Search ⌘K.
  - **Window** and **Help**.
- **Brand constant**: `PARENT_BRAND = "Orion Terminal"` in `src/standalone/archives/brand.ts`. It feeds the About text, the import item and the bundle's `shortDescription`; the build script injects that into the Tauri config, so a rename touches one line.

## 5. Bundle, data, icon, commands

- **Bundle id**: `com.lucaorion.archives47` (the same pattern as `com.lucaorion.emp` and `com.lucaorion.orion-terminal`). Product name "Archives 47"; binary `archives-47`.
- **Data dir**: `~/Library/Application Support/com.lucaorion.archives47/`. Tauri derives it from the identifier, so every existing `app_config_dir()` call in the shared Rust lands there automatically. I'd name the DB `archives.db` through one helper replacing the ~6 hard-coded `"orion.db"` strings; Orion keeps `orion.db`.
- **Dev data**: dev builds use the identifier `com.lucaorion.archives47.dev`, so `npm run archives:dev` can never touch real data. A fixture seeder fills that dir with sample notes, journal entries, boards and chats for screenshots.
- **Icon**: the dock's Archives glyph in `#39ff88` on the same black rounded tile as the new Orion icon (an 824 px tile on a 1024 canvas). Preview: `docs/alpha/archives-app/icon-preview.png` (Orion on the left, Archives 47 on the right). A script generates `src-tauri/icons-archives/` with `magick` (already installed) and `npx tauri icon`. The glyph source is only a 512 px PNG; a vector would be crisper at 1024.
- **Commands**:

  | Task | Command |
  |---|---|
  | dev | `npm run archives:dev` (Vite on port **1447**, never 1420; Vite cache in the worktree, never the main checkout's `node_modules/.vite`) |
  | build `.app` only | `npm run archives:build` → `src-tauri/target/release/bundle/macos/Archives 47.app` |
  | build + install | `npm run archives:app` (EMP-style: quits a running copy, then installs with `ditto` to `/Applications/Archives 47.app`). Only run with your OK |

## Tests and gates (step 2)

- **Boundary test (vitest)**: walks the imports from `src/standalone/archives/main.tsx` and fails if it reaches `apps/{xdesign,orion,command,hermes,incubator}`, `features/{intake,rosie,lsp}`, `shell/` (except types) or `vendor/`.
- **Rust tests**:
  - The Archives handler list is exactly the allowed set (no `plugin_*`, `xdesign_*`, `terminal_*` or `git_*` writes).
  - The identifier and data-dir derivation are correct.
  - The DB-name helper works.
  - Importing from a **fixture** Orion DB copies the right rows and assets, is idempotent, and leaves the source byte-identical.
- **Orion gates**: `npm run typecheck`, vitest on the affected files, `cargo test --lib`. Orion's behaviour stays the same; the hub cuts keep their current wiring on Orion's side.
- **Visual check**: the Tauri dev app on the fixture data dir; screenshots use fixture data only.

## Open questions for the owner

1. Data: own DB + import (my recommendation), or shared from day one?
2. Should Archives share Orion's keychain items for AI keys?
3. DB file name: `archives.db` (my pick) or keep `orion.db` inside the new dir?
4. Disk: 20 GiB free. A separate Rust target dir for this worktree is probably 8–10 GB. Is that OK, or should it build into a shared target dir?
5. Is there a vector source for the Archives glyph?
