# Message boundaries and project transactions — 2026-09-12

Continuation of [UI callback lifetimes](2026-09-12-ui-callback-lifetimes.md). **Not release clearance.** Production data/bundle and pre-existing WIP remain untouched; no commit or release.

## Message formatting

The FX/text helper merged all assistant text without retaining message IDs. Distinct native messages therefore rendered as `preamble.Final reply`. `AssistantTextAccumulator` now tracks message identity, updates snapshots in place and separates distinct messages with paragraphs. Explicit deltas append, including repeated chunks; unmarked legacy streams retain their previous heuristic. Tool-only and non-assistant events do not contribute text. Output/message-count/identity bounds fail visibly rather than silently truncate.

Codex and native HTTP text snapshots are marked explicitly. Gemini's installed 0.47 emitter sends `delta:true`; the transcoder now accumulates those chunks and starts a separate text identity after tool use. This is source/fixture verification for Gemini, **not a new live-account acceptance**. Cursor's upstream legacy heuristics and broad token-level streaming remain separate work. The change does not pretend completed-message CLI output is token-by-token streaming.

Packaged Terra FX read-only test: `FORMAT_BEGIN` → get-scene → `FORMAT_END` displayed as two separate paragraphs, with the existing scene unchanged. Two actual `custom_tool_call` code-mode wrappers (discovery plus get-scene); these are not OS shell calls. No API fallback or file tools. Evidence `format-fx-result.png` and `format-recovery-live-result.json`.

## Project write recovery

Previously creation hydrated/published a project before its list entry was saved; deletion removed document slots before saving the list. A failed second write could leave orphan documents or a listed project with no document. Rename also displayed a new name before persistence completed.

- New native `xdesign_state_commit` uses a **single SQLite connection and transaction** for project document/list writes. It runs on a blocking worker, opens the existing DB read/write, uses a five-second busy timeout, validates scoped keys/JSON/registry shape, and limits batches to four entries /64MB. No migration or dependency change.
- Creation commits the initial document and registry before replacing the live canvas. Deletion commits the registry and all three document-slot removals together. A failed transaction preserves the prior UI state and documents.
- Registry updates are computed, persisted and published inside the serialization queue. A queued autosave timestamp update cannot overwrite a pending rename using a stale registry snapshot. Transaction publication also occurs before releasing that queue.
- If deletion succeeds but the neighbour cannot be loaded, the UI returns Home with an explicit warning instead of keeping the deleted project active.
- Rust regression injects an actual SQLite trigger failure on the second write and checks rollback of both attempted document creation and deletion. Frontend tests cover failure/retry, live-canvas preservation, failed rename, autosave/rename ordering and a missing neighbour. These are deterministic failure tests, not a physical power-loss experiment.

## Native workflow acceptance

In **Orion Terminal Validation** only:

1. Created `Recovery transaction proof` through the new native transaction binding.
2. Renamed it via the tab editor and drew a rectangle (x197/y189/w215/h147).
3. Quit normally, restarted, reopened the named project and verified its rectangle.
4. Used the inspected confirmation dialog to delete only that disposable fixture.
5. Read-only SQLite verification found its registry entry and all three document slots gone, all pre-existing document JSON unchanged, background opt-ins still off, and `PRAGMA quick_check` = `ok`.

Evidence under `/tmp/orion-release-next/`: `format-recovery-before.json`, `recovery-fixture.json`, `format-recovery-live-result.json`, `format-recovery-{build.log,mcp.json}`. Screenshots under `/tmp/orion-release-closure/format-*` and `recovery-*`. Initial Rust test compilation caught an old GeminiState fixture missing the new fields; fixed with Default initialization and retained the failed log.

## Gates and remaining scope

`verify-format-recovery-final.log` exit0: **182 frontend files /1,166 tests ·21 Node contracts ·222 Rust passed /1 ignored**, TypeScript/Vite passed. Validation build, deep/strict ad-hoc signature and packaged MCP policy smoke passed. Fresh root/runtime npm audits report zero vulnerabilities; known-pattern scan: zero findings /2,988 text versions /127 binary-or-large skips, not comprehensive privacy clearance. Selected native audit remains the previous unchanged-dependency macOS graph (zero blocking/five UNIC maintenance), not a fresh whole-lockfile clearance.

Not established: full provider/specialist streaming parity, physical crash/power-loss recovery, startup/legacy-adoption recovery, corrupted-registry discovery/restore, orphan retention cleanup, atomicity with HTML artifact localStorage or shared media files. **Next concrete UI recovery checks:** rename inputs currently dismiss before their async save completes; failed-autosave dirty-state protection during plugin disable needs review. Broader security, accessibility, rights/maintenance, clean-machine app/DMG installation and remote CI remain release gates.
