# Native quit safety and file-save acknowledgments — 2026-09-12

Continuation of [Archives recovery](2026-09-12-archives-save-recovery.md). **Scoped normal-quit protection, not crash recovery or release clearance.** No new dependencies/migrations, cloud AI requests, account changes, production-data changes, commit or publish.

## Changes

- `src-tauri/src/quit_guard.rs`: native exit/window-close requests stay pending until a main-window decision with the current request identity arrives. Duplicate requests coalesce; stale approvals fail; exit approval is consumed once. Pending requests can be recovered after frontend listener registration. Listener/assessment failure does not authorize exit.
- `src/features/recovery/`: inspects known dirty Archives drafts, all loaded dirty Orion buffers (not just visible tabs), XDesign documents/names, plugin transitions and existing built-in activity guards. Risky quits require **Quit without saving** or **Keep working**. Input is inert during the decision and approved handoff; cancellation restores it. This does **not** save everything automatically or stop all background writers.
- `src/store/tabsStore.ts` / `src/apps/orion/saveFileBuffer.ts`: acknowledgments use the exact persisted string, not whatever newer text happens to be in the buffer when an older write finishes. Same-path Save/Save All/LSP snapshot writes are queued; newer edits, including undo during save, remain dirty against the bytes actually written. Failures surface and retain the unsaved comparison. Independent filesystem/MCP writers are not globally serialized by this queue; no universal filesystem conflict-resolution claim.

## Important native failure and correction

The first implementation passed deterministic tests but **failed the actual macOS ⌘Q test**: the disposable unsaved draft was lost without confirmation. Failed binary SHA `ea40cb3585db343fe6240e5fa2a797456e7908edc96b00f55928ecd5311aa0fb`, PID37323; evidence `quit-safety-first-native-failure.json`. Persisted data remained unchanged and the trigger was removed before relaunch. This build is not accepted.

Reviewed Tao **0.35.3**: its Cocoa delegate implements `applicationWillTerminate:` but not `applicationShouldTerminate:`. NSApplication's standard Quit/AppleEvent path bypasses cancellable Tauri `ExitRequested`.

`src-tauri/src/quit_guard_macos.rs` adds the missing public delegate-protocol method using system Objective-C runtime FFI, no new dependency. It only installs on the reviewed `TaoAppDelegateParent` class, refuses an existing policy/unreviewed class, does not replace other delegate callbacks, returns `NSTerminateCancel` while asking the frontend, and contains panics at the FFI boundary. Approved quit proceeds through `AppHandle::exit`. **Tao/delegate changes require compatibility review.** This macOS adapter is exercised by native acceptance, not a mocked AppKit unit test.

## Verification and native acceptance

- Latest full `verify-quit-macos.log/.exit`: **0**, TypeScript/Vite passed; **190 frontend files /1,214 tests ·21 Node contracts ·224 Rust passed /1 ignored**. New tests cover snapshot acknowledgment, undo/overlap/failure, real staged/failed note state, XDesign/file risk detection, listener-before-query recovery, duplicates, denial, disposal and one-shot native decisions. File/LSP races have deterministic evidence, not fresh native LSP acceptance.
- Corrected Validation build: `quit-macos-build-serial.log/.exit`0; packaged MCP policy smoke and deep/strict ad-hoc signature passed. Copied DMG verified, mounted read-only, app signature/executable hash matched and detached (`quit-macos-dmg-result.json`); not an installation or notarization test. Root/runtime npm audit reported zero findings; selected Apple Silicon native audit zero blocking/five maintenance findings (`quit-safety-{npm,native}-audit.log`), not whole-lockfile/other-platform clearance. An earlier build overlapped another Vite verification; it was followed by this serial rebuild before acceptance. No running app was replaced.
- Accepted executable SHA **`712c4662974a1ed797d49b39052762ead71fcb496a6115b50990491b591fb069`**. Initial corrected PID39162; clean-quit restart PID39480; explicit-discard restart PID39595.
- Disposable note **`01M2BHDPMFWQCASM6X10Z3Z4QK`**: SQLite UPDATE failures retained **Quit safety retained / QUIT_SAFETY_DRAFT_47** only in memory. Corrected ⌘Q, OS red window-close and AppleEvent Quit each displayed the warning. Rechecked **Keep working** clicks left the process/window/draft intact. Removed the fault and retried; the saved note survived a clean normal quit and restart.
- Separate deliberate discard: failed title **Discard this synthetic draft**, removed the trigger, inspected the warning, explicitly chose Quit without saving. Process exited; restart showed only the earlier successfully saved title/body, not the discarded title. This is intentional loss after consent, not recovery.
- Inspected the fixture's deletion confirmation and removed only it. All three original note-row fingerprints and XDesign state fingerprints unchanged; background opt-ins all off, trigger absent, quick_check ok, installed/checkout production executable hashes unchanged.

Evidence under `/tmp/orion-release-next/`: `quit-macos-{live-result,clean-exit,explicit-discard,saved-note}.json`, `quit-safety-{before,fixture,first-native-failure}.json`, `quit-safety-fault.py` with five-minute cleanup watchdog. Screenshots under `/tmp/orion-release-closure/quit-macos-*`.

Inconclusive automation retained: first command arrived before startup was ready; Escape/AXPress did not dismiss the custom native alert. The old coordinate helper sometimes selected the smaller native dialog rather than the main window; it now selects the largest app window. Only rechecked button clicks establish cancellation/OS-close/AppleEvent acceptance. **Keyboard/VoiceOver cancellation and narrow all-surfaces warning layout remain unaccepted.** AppleEvent's immediate cancellation response is not proof the process has exited: always verify the PID before replacing a bundle.

## Limits and next slice

Normal quit confirmation is not a writer transaction barrier, an automatic save-all, or exhaustive dirty tracking for every specialist, unsent chat draft, setting/layout debounce or media pipeline. Executing operations may finish or be interrupted; quitting is not rollback. Force Quit, crashes, power loss, Tauri restart and other platforms are not covered by this acceptance.

**Next concrete source audit:** `src-tauri/src/db_backup.rs` currently uses second-resolution destinations opened without exclusive creation, broad filename-prefix pruning, no integrity check before rotation, and a log-only failure path. Its "never costs more than one session" comment is not an established guarantee. Backup collision/integrity/retention and disposable restoration tests are the next bounded recovery slice; not fixed here.

Broader specialist/account acceptance, token-level streaming, security/provenance/native maintenance review, accessibility, normal-product clean-machine installation/upgrade and remote CI remain open. Historical provider/image/edit evidence retains its original build attribution.
