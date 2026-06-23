# Command Center — CC-3 Per-Profile Memory — Build Plan

**Date:** 2026-06-20
**Spec:** [../specs/2026-06-20-command-center-design.md](../specs/2026-06-20-command-center-design.md) §2.4
**Builds on:** CC-2. **Goal:** each profile gets its OWN growing brain (today every profile's `llm-wiki` writes to the global `~/.llm-wiki` vault, so divisions secretly share one memory), plus visibility into what a division knows.

## Research finding (verified)

`@zosmaai/pi-llm-wiki` resolves its personal vault root from **`WIKI_HOME`** env (else `homedir()` → global `~/.llm-wiki`). Vault layout: `<root>/.llm-wiki/wiki/{sources,concepts,entities,analyses,requirements,syntheses}/*.md`. So per-profile routing = **set `WIKI_HOME=<profile workspace>` on the pi subprocess** — then `wiki_observe`/`wiki_recall`/`wiki_retro` all read+write that profile's own vault. Zero plugin changes.

## Tasks (each green: tsc · vitest · cargo · build)

- **CC-3a — Per-profile vault routing (the fix):** `pi_send` + `pi_oneshot` spawn pi with `.env("WIKI_HOME", cwd)`. Each profile's brain now lives at `<workspace>/.llm-wiki/`. The AGENTS.md already tells profiles to `wiki_recall` at start + `wiki_retro` after work → divisions now actually compound their own knowledge. (Tiny, highest-value.)
- **CC-3b — Memory visibility:** Rust `cc_vault_pages(wiki_root, limit)` reads `<root>/.llm-wiki/wiki/**/*.md`, returns recent pages `{title, path, kind, mtime}` (title = first `# heading` or filename). Frontend: a **"Memory"** section in the profile aside listing recent pages (kind chip + title), click → open the `.md` via `cc_open_path`. Shows a division's brain growing. Pure `parseVaultTitle` tested.
- **CC-3c — Obsidian graph view (deferred to its own slice):** parse `[[wikilinks]]` across a vault → nodes/edges → reuse Learn's `forceLayout.ts`; full-surface toggle per profile. Bigger visual piece, best built with on-screen iteration — scoped here, built next.

## Smoke (needs tauri dev restart — WIKI_HOME on spawn + new cc_vault_pages)

Restart → send the Design Captain a task that records a learning → its observation now lands in `divisions/design/.llm-wiki/wiki/sources/` (NOT global). Profile aside "Memory" lists its recent pages; click opens the note. Different divisions show different memory.
