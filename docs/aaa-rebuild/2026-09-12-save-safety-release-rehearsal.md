# Save safety and Validation DMG rehearsal — 2026-09-12

Continuation of [message boundaries/project transactions](2026-09-12-format-project-recovery.md). **Not release sign-off.** No new features beyond recovery controls, dependencies, commit, publish, production-data changes or account changes.

## Closed in this slice

- **Failed names:** `ProjectNameInput` is shared by tabs/Home. Drafts live outside the component, survive an in-canvas window remount, remain editable after failure, and support Enter retry/Escape discard. In-flight saves are read-only; Enter/blur duplicates and Escape-after-submit cannot drop the pending request. Known unfinished names block plugin disable.
- **Dirty documents:** `saveState.ts` tracks revisions separately from transient save activity. An older successful write cannot acknowledge newer work. `flushActive` only clears the matching revision after document plus registry metadata persistence; failures retain dirty/error state and show a sticky warning. Tabs expose **Retry save**. Confirmed deletion clears only that project's retained state.
- **Actual plugin path:** a regression drives a real subscribed canvas change, rejects its autosave, and verifies `usePluginManager.setEnabled` refuses disable until a successful retry. All three XDesign document kinds mark dirty before debounce; timers retain originating-project identity.
- **Startup:** coalesced initialization precedes project changes/ensureActive. Strict project JSON reads distinguish missing storage from invalid data. Registry identity/shape validation refuses malformed data instead of creating an empty list. Home shows a retryable load error. Legacy adoption uses the existing native document/list transaction; an explicitly empty list no longer resurrects old deleted legacy work.
- **Failed hydration:** malformed design envelopes and unknown FX effects are refused rather than silently blanked/stripped. Model hydration builds its candidate before publishing the spec/reference/root. Failed project loading does not clear the existing assistant transcript. These are targeted guards, not a complete validator for every nested document property or future schema.
- **Public guidance:** README/BETA now distinguish source validation from older published assets, subscription versus API billing, experimental specialists, ad-hoc signature versus notarization, and memory retention versus crash recovery. Removed blanket safety/forever-launch/competitor-parity claims.

## Native failure/retry acceptance

Rebuilt **Orion Terminal Validation** only. Created a disposable canvas and installed a short-lived SQLite trigger scoped exclusively to its document and the intended new name. It rejected real native writes with `Validation injected save failure` (code1811).

1. The failed name remained in its editor after closing/reopening the in-canvas window **in the same process**; the stored name stayed unchanged.
2. A rectangle remained visible after autosave failed; **Retry save** appeared and the stored document remained unchanged.
3. Removed the trigger, retried the name and document successfully, and observed the retry indicator disappear.
4. Quit normally, restarted and reopened the saved name/rectangle.
5. Confirmed deletion of only the disposable fixture. Read-only checks: prior document JSON unchanged, original project membership restored, trigger absent, all background opt-ins off, `PRAGMA quick_check` = `ok`.

No live model requests in this slice. Evidence under `/tmp/orion-release-next/`: `save-safety-{live-result,injected-failure-result,fixture,retried-document}.json`; `save-safety-fault.py` (fixture-only trigger plus five-minute cleanup watchdog). Screenshots under `/tmp/orion-release-closure/save-safety-*`. Initial post-restart dock navigation did not open the intended surface; retained that probe and used Spotlight for the verified reopen. Failure toasts remain until dismissed; the saved-state indicator and read-only DB checks establish recovery.

## Verification and packaging

- `verify-save-safety-final.log` exit0: **184 frontend files /1,180 tests ·21 Node contracts ·222 Rust passed /1 ignored**, TypeScript/Vite passed. Initial test authoring incorrectly assumed testing-library was installed; rewrote using the existing React act/createRoot harness, no dependency added. Failed logs retained.
- Fresh root/runtime npm audits: **zero vulnerabilities**. Known-pattern secret scan: **zero findings /2,993 text versions /127 binary-or-large skips**; not comprehensive privacy clearance.
- Fresh selected `aarch64-apple-darwin`, `tauri/custom-protocol`, normal/build native audit: **343 packages, zero blocking/five UNIC maintenance**. RSA/GLib/proc-macro-error findings remain in the non-selected/raw audit scope; other targets and whole-lockfile clearance are not established. Initial invocation missing the required target was retained, then corrected.
- Scoped doctor exit0; local status/version probes, not entitlement or model acceptance.
- Fresh Validation `.app` **and `.dmg`**, deep/strict ad-hoc signature and packaged MCP policy smoke passed. DMG verified, mounted **read-only**, mounted app signature checked and executable hash matched, then detached. Copy retained as `/tmp/orion-release-next/save-safety-validation.dmg` with hashes in `save-safety-dmg-result.json`.
- Existing installed and checkout production executable fingerprints remained unchanged. No installation over Applications, notarization, normal-product release, remote CI run or clean-machine acceptance is claimed.

## Remaining, in priority order

1. **Archives write recovery:** source review found `notesStore.saveBlocks` clears pendingWrites in finally after failure/overlapping writes; saveTitle optimistically publishes without dirty retention. NoteEditor invokes body saves with void. Add per-note ordering, durable-in-memory failure state, visible retry and plugin-disable protection. This is a source finding, not reproduced native data loss; Archives code was not changed here.
2. App-wide quit/crash/power-loss and backup restore/retention remain unaccepted. Current drafts are memory-only; do not quit after a failed save. HTML localStorage/media-file atomicity and deeper schemas remain separate.
3. Supported specialist/provider workflows, token-level streaming, narrow layouts/VoiceOver and wider editor/Archives/Learn/import/export testing.
4. Full attribution/provenance/native-maintenance review, clean-machine normal-app install/upgrade and actual remote CI. Existing tool/process/connector boundary limitations still apply.
