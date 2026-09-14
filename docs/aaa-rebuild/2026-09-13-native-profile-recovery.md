# Native core-profile recovery — accepted within scope

## Result

**Passed:** a separately generated core data profile was restored, promoted to its real app path, opened/used in the packaged app, restarted, and rolled back without destroying either version. This is native acceptance beyond the earlier SQL/directory-only rehearsal.

Isolated app: **Orion Terminal Recovery Proof**, identifier `com.lucaorion.orion-terminal.recovery-proof`. No production/Validation profile was used as fixture input. No real credentials copied or cloud AI calls made. Validation was normally quit; its bundle and both protected production bundles remain unchanged.

## Accepted sequence

1. Generated a schema28 database from the checked-in migration prefix, notes/journal, valid checker PNG, XDesign canvas + SQLite webpage, retained file journal and an external workspace. All paths referred to the eventual live locations. No account/reset/auth bypass was needed: existing-data profiles support account-free local use.
2. Preserved the source hashes and cold directory. The packaged `--restore-db-copy` produced a separate candidate; associated files and workspace were copied. Promoted that candidate at the same paths, retaining the original directories.
3. **Actual Tauri SQL plugin startup applied migration29.** Checked the ledger, new table, integrity and foreign keys. This is a generated historical prefix, not a database supplied by a real older-version user.
4. Native UI rendered the note, journal, Archives image, XDesign webpage and image layer. Orion opened the external workspace file with its exact marker. Recovery read the retained journal and exported an exact0600 new-file copy.
5. A native note edit persisted and survived a normal app restart. Original source hashes stayed unchanged.
6. Stopped the owned app and checked its storage handles. Preserved the used restored profile, promoted a **copy** of the preserved original, and restored the workspace at the original path. The native app opened that rollback copy; note rows matched the original without the later edits. The current app migrated the working rollback copy again; this did not mutate the preserved original.
7. After final checks, normally quit and quarantined the working profile/workspace under the private evidence directory. Original, used-restored and final-rollback versions remain available. Active fixture paths are absent; no blanket deletion of locks/backups/browser stores.

## Two keyboard defects found and fixed

Native testing exposed fullscreen's capturing Escape handler preventing Recovery's native dialog cancellation. It also allowed ⌘K to open Spotlight behind the native modal: its input could not receive focus, and later query typing went into the synthetic note after the modal closed. The failed probe and its extra synthetic text are preserved with the used-restored version, not hidden.

- `src/shell/FullscreenNav.tsx`: defer Escape/app cycling to open dialogs and Spotlight.
- `src/lib/hotkeys.tsx`: do not open palette/Control Panel behind an open native dialog.
- Added focused regressions in `FullscreenNav.test.tsx` and `hotkeys.test.tsx`.
- **Final native acceptance:** ⌘K during Recovery does not open the underlying palette; Escape closes Recovery while retaining fullscreen; subsequent Spotlight receives `SPOTLIGHT_FOCUS_PROOF_47`; the note stays unchanged; Escape closes Spotlight without exiting fullscreen.

Platform behavior checked against [MDN dialog cancellation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/cancel_event). This is not a complete keyboard/VoiceOver audit.

## Evidence attribution

Under `/tmp/orion-release-next/native-profile-proof/`:

- `result.json`, `promotion.json`, `rollback.json`, source/candidate/workspace manifests.
- `native-rollback-result.json`, `restart-and-keyboard-probe.json`, `keyboard-fixed-result.json` and inspected PNG screenshots.
- Native recovery/rollback: SHA `0aad2330a29e98b9f13357b949fd5b06c4369bc5fc46d9956ab49bf4b565326b`, PIDs55968→56208→56271.
- Keyboard-fixed package: SHA `0d64b66352cf3b8da51349316e391d9df0287f03551e01d164419e00671dd7e6`, PID57308, now closed. Older data-flow evidence retains its original binary attribution.
- `preserved-original`, `restored-after-use`, `rollback-after-validation` and corresponding workspace copies are **generated, private evidence**, not backups of the user's profile. Their absolute references require the documented same-path placement before reuse.

Adjacent `/tmp/orion-release-next/`: `native-profile-verify-final.log` (TypeScript/Vite,196 frontend files/1243 tests,23 Node,240 Rust passed/1 ignored), `native-profile-build-final.log`, `native-profile-signature.log`, `native-profile-mcp.json`. Initial test-mock/type mistakes remain recorded; corrected before the final build. Existing unchanged dependency audits are reused, not called fresh security clearance. No new DMG or publication in this continuation.

## Boundaries

This closes **generated native core-data same-path recovery and rollback**, not every possible user profile. Untested here: real historical-user datasets, another machine, older-binary rollback, path rebasing, raw WebKit/OS-keychain/account restoration, custom wallpaper/character and specialist/plugin directories, hard power loss or a global independent-writer barrier. The earlier fixture harness covers additional directory bytes/interrupted-promotion cases; those are not renderer acceptance.

Full-profile breadth, licensing, remaining supported-workflow/accessibility checks, reviewed remote CI, clean-machine testing and explicit release approval still apply. No source commit, production replacement or release occurred.
