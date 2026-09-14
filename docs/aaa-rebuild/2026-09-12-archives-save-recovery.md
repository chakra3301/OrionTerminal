# Archives note save recovery — 2026-09-12

Continuation of [XDesign save safety](2026-09-12-save-safety-release-rehearsal.md). **This closes the scoped Archives failed-save/overlap blocker, not release clearance.** No dependencies, migrations, cloud AI requests, account changes, production-data changes, commit or publish.

## Implementation

- `src/store/notesStore.ts`: title/body drafts enter shared memory **before** the 500ms debounce. Per-note queues serialize frontend saves/deletion while allowing other notes to save independently. Revision-specific acknowledgments cannot clear newer edits. Failed patches are retained and merged into subsequent saves/retries, including location, collection, favorite and parent edits. `pendingWrites` now includes staged/failed work; `saving` tracks outstanding jobs separately.
- `src/features/notes/NoteSaveStatus.tsx`: **Unsaved changes / Saving… / Changes not saved**, with **Save now / Retry save**. A sticky failure toast warns that changes remain in memory and must be retried before quitting. Archives plugin disable remains blocked after a failed operation settles.
- `NoteEditor.tsx`: title edits no longer live only in a debounce closure. Navigation flushes the originating note's shared draft, without re-staging an old editor document. BlockNote instances are keyed by note ID: the installed hook memoizes its editor with empty dependencies, so merely changing initialContent was not sufficient when switching notes. Unchanged editors no longer save merely because they unmount.
- Refresh preserves dirty notes and local mutations/deletions occurring during the read; older requests cannot replace a newer refresh. Read failures retain memory and expose retry. Malformed JSON/non-array stored bodies become read-only errors rather than editable blank fallbacks. This is an envelope guard, **not full nested BlockNote schema validation**.
- `src/lib/db.ts::updateNote`: related metadata can travel with the same retained patch, and an UPDATE affecting no note now fails visibly rather than falsely acknowledging a disappeared row. Tag-write failures also have visible errors; tag tables are not part of a new cross-table transaction.

Queues govern frontend store writes, not every independent MCP/SQLite writer. Preserving local drafts during refresh is not multi-user conflict resolution. **Memory retention is not a crash backup**: app-wide quit/crash/power-loss and backup restoration/retention remain open.

## Deterministic verification

`/tmp/orion-release-next/verify-archives-save-final.log` / `.exit`: **0**. The earlier full run also passed; final refinements add explicit ordering/queued-failure assertions only, with no production-code change after native acceptance.

- TypeScript and Vite passed.
- **186 frontend files /1,198 tests**, including 18 added regressions: immediate staging, merged failure/retry, overlapping and independent saves, revision-specific dirty state, metadata/body recovery, immutable snapshots, stale/out-of-order refreshes, deletion ordering/failure, malformed data, missing-row SQL acknowledgment, actual editor lifecycle and actual plugin-manager disable/retry.
- **21 Node contracts**, **222 Rust passed /1 ignored**. Rust source unchanged in this slice.
- `archives-save-focused.log` and `archives-save-types-tests.log` passed. Editor tests mock BlockNote's construction/events but exercise the actual React editor wrapper and real note store; native acceptance below uses real BlockNote and SQLite.
- Fresh root/runtime npm audits: **zero vulnerabilities**. Selected Apple Silicon native audit: **343 packages, zero blocking /five maintenance**; raw/other-target findings remain outside this clearance.
- Known-pattern secret scan: **zero findings /2,997 text versions /127 binary-or-large skips** (`archives-save-secret-scan.json`), not comprehensive secret/privacy clearance. No new cloud AI turns; successful note saves may run the existing local embedding indexer.

## Native failure → retry → restart

Fresh isolated **Orion Terminal Validation** app/DMG. Initial PID34045, normal restart PID34199. Executable SHA256: `a32bb87acfa76996e85818fb74f8f7c92de209327cbaa32d03920abbf5710e9f`.

1. Created only fixture `01M2BEKZ9HN58B3845N5FDJWS5`, initially **Archives recovery proof**.
2. A narrowly scoped BEFORE UPDATE trigger rejected only that note with **Validation injected note save failure**, SQLite code1811; five-minute cleanup watchdog installed.
3. Typed **Archives recovered draft** and **ARCHIVES_SAVE_RECOVERY_47**. Both remained visible; Retry save appeared. Read-only checks confirmed the entire original fixture row was unchanged on disk.
4. Navigated back to the note list and reopened it in the same process: title/body and retry state survived editor unmount/remount.
5. Removed the trigger and clicked Retry save: latest title/body persisted together and the dirty indicator disappeared. Historical failure toast remained until dismissal/restart; it is not the current saved-state indicator.
6. Quit normally, restarted, reopened Notes and the fixture: title/body remained saved. This restart happened **after successful retry**, not after a failed save.
7. Inspected the native deletion confirmation's exact fixture name, confirmed and removed the fixture. All three prior notes' full-row fingerprints and all XDesign state fingerprints unchanged; all background opt-ins off; trigger absent; `PRAGMA quick_check` = `ok`. Installed and checkout production executable fingerprints unchanged.

Evidence: `/tmp/orion-release-next/archives-save-{before,fixture,injected-failure-result,retried-note,live-result}.json`; `archives-save-fault.py`; screenshots `/tmp/orion-release-closure/archives-save-*`.

Inconclusive probes retained: initial automation calls omitted helper screenshot/modifier arguments (only Spotlight opened); the first native confirmation coordinate click left the dialog open and fixture present. Inspected it again and used Return; subsequent DB verification established deletion. Plugin-disable blocking and malformed-load behavior were deterministically tested, **not separately accepted through the native settings UI**.

## Packaging and remaining gates

`archives-save-build.log/.exit`0; deep/strict ad-hoc signature and packaged MCP policy smoke passed. Fresh DMG copied to `archives-save-validation.dmg`, verified and mounted read-only; mounted app signature/executable hash matched, then detached (`archives-save-dmg-result.json`). No Applications install, notarization, clean-machine acceptance or remote CI claim.

Current release still requires app-wide quit/crash/backup recovery, broader supported workflows and specialist/account acceptance, token-level streaming, narrow/accessibility checks, security/provenance/native maintenance review, normal-product clean-machine install/upgrade and actual remote CI. Older image/edit/provider evidence keeps its original build attribution; no new AI entitlement/billing tests were run here.
