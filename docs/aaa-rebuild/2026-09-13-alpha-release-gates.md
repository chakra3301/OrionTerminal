# Public alpha — evidence and remaining release actions

No unrelated feature expansion. Uncommitted work is not automatically publishable. **2026-09-14:** public alpha is the agreed direction, not a mandatory private-testing phase. CI and recipient fresh-Mac smoke checks passed at `86ec7cf`; the requested first-launch/default changes need their own focused acceptance and a new candidate. Historical evidence below retains its original build attribution.

## Frozen scope

**Scoped acceptance already recorded:** desktop/windowing and selected themes; Archives note persistence/search; Orion editor/explicit saves and tested diagnostics; selected ChatGPT/Terra chat/tool/cancellation/image paths; basic XDesign canvas/FX editing and specified exports; native quit protection, verified SQLite copies and acknowledged note/file crash journals. These are particular workflows/builds/accounts, not universal parity.

**Experimental / not release promises:** webpage generation (scoped saved-page durability is now accepted below), motion/video/audio/custom shaders, img2model, website reconstruction, untested provider/model combinations, Hermes/Command and API-key inline/Tab workflows lacking separate live acceptance. XDesign Home now labels the relevant entry points rather than calling generated HTML “shippable.” Existing features are not silently removed or rerouted to paid providers.

## Recovery work in this continuation

- Recovery action feedback is rendered inside its top-layer dialog, including no-overwrite errors and confirmed success. An uncertain discard response no longer falsely promises that the source still exists. UI regressions cover error→success, cancellation and uncertain acknowledgment.
- `scripts/rehearse-profile-recovery.py` accepts only a built executable and report path. **It cannot accept or replace a user's profile.** All input profiles are generated under an exclusive temporary directory and removed afterward.
- It restores 26 generated schema prefixes (3–28) through the real native `--restore-db-copy`, applies the remaining checked-in migration SQL, verifies content/FTS/integrity/foreign keys, and validates the upgraded copy again. This is shared-SQL fixture coverage, **not the Tauri SQL plugin upgrading a real historical user's database**.
- A controlled writer leaves committed WAL state; its lease blocks cold recovery until the owned process exits. The rehearsal copies DB/WAL/SHM together into a disposable input before native recovery. It verifies associated content, same-path references, manifests, bad-candidate/symlink/existing-destination refusals, original preservation, interrupted-promotion rollback and preservation of both versions on rollback.
- A real failed first run discovered that a SQLite read-only connection can update `orion.db-shm` read marks. The corrected procedure never recovers directly against the sole preserved tuple. Failed and corrected evidence are retained.
- Browser data is an explicit **logical synthetic export**, not a WebKit store transplant. Credential-directory contents are omitted (the only auth-directory test data is a non-credential sentinel). File bytes in wallpaper/character/snapshot fixtures establish preservation, not renderer acceptance.
- CI and release workflows now run this fixture rehearsal before proceeding. **Verification CI subsequently passed at `86ec7cf`; no release workflow was dispatched.**

## Why “database copy” is not “full profile restored”

On macOS, app configuration/data contains SQLite plus `assets`, `wallpapers`, `characters`, `snapshots`, `draft-recovery`, generated RepoLens/Command work and plugin storage. Orion workspaces can be anywhere outside it. Saved generated HTML now lives in SQLite project documents; matching registered legacy pages migrate from `xd-html-artifact.*` without deleting browser originals. Orphaned browser entries, image-model preferences and rail UI settings remain in WebView localStorage. WebKit storage, OS keychains, shared Claude/Gemini/Codex homes and optional runtimes are separate. Database values can themselves contain sensitive content or credential references.

For same-path recovery, stop **every** app/CLI/MCP/sync/editor writer, preserve the original full directory and DB/WAL/SHM tuple together, work on a copy, and prepare a separately validated candidate. Never mix old sidecars into its new `orion.db`. Keep the original/quarantined directory until the recovered profile and asset references are verified. If promotion is interrupted, establish which directories exist before restoring names—never overwrite either version. Moving to another path additionally requires supported reference rebasing; this rehearsal intentionally avoids guessing at embedded absolute paths.

Do not copy auth homes/keychains or a whole WebKit directory as a supposedly credential-free data backup. Unmigrated/orphaned HTML needs separate review/export; raw browser stores can contain other sensitive state. **There is no accepted one-click full-profile promotion/rebasing or WebKit recovery feature here.** The rehearsal is evidence for safe building blocks, not permission to replace production.

## Concrete remaining release gates

| Gate | State / owner action |
| --- | --- |
| Local verify, packaged MCP, recovery rehearsal, signature/DMG and scoped audits | **Passed within scope:**198 frontend files/1254 tests,30 Node,240 Rust+1 ignored; latest core-dialog/minimum-window package/signature/MCP proof below. Native workflow, DMG, audit and recovery evidence retains its original binary attribution |
| Remote CI | **Passed at `86ec7cf`:** [run34893323117](https://github.com/chakra3301/OrionTerminal/actions/runs/34893323117),198 frontend files/1254 tests,31 Node,240 Rust+1 ignored, recovery rehearsal and scoped dependency audits. New first-launch work still needs its own commit/run; release publication and merging `main` remain separate approvals |
| Fresh Apple Silicon installation | **User-reported passed at `86ec7cf`:** another Mac with no previous Orion install, reported Tahoe26.6; install/desktop, Archives note, Orion file, XDesign canvas/PNG, full quit/reopen persistence, ChatGPT onboarding/basic chat. Not independent inspection, an upgrade test, or evidence for the new setup flow |
| Native core-data recovery and rollback | **Passed for a generated profile:** actual packaged promotion/open/edit/restart/rollback; Tauri SQL plugin upgraded generated schema28→29; originals and used-restored version preserved |
| Broader full-profile/real historical-user recovery | **Open:** other profile content, real historical-user datasets, raw WebKit/auth, rebasing and clean-machine paths were not accepted by the core-profile test |
| Other provider/model/account/billing workflows | **Open/experimental:** requires separately authorized accounts/keys/live tests; no API fallback or account reset to manufacture a pass |
| Licensing/provenance | **Notice/source packaging passed:**213 frontend/342 native packages,8 matching MPL archives, identified adapted-code notices, owner-confirmed icon/models. Historical input/baseline limits are disclosed, not automatically release blockers. Creator confirmed stock wallpaper authorship and redistribution on2026-09-15; no blanket legal clearance is claimed |
| Accessibility/narrow layout and specialist media workflows | **Scoped core checks passed:** native safe Cancel+Enter, Tab wrapping, modal/menu priority and800×500 chat/header; browser long-dialog and192–360px rail checks. **Still open:** VoiceOver, broader keyboard/theme/surface matrix and specialist media |
| Publish/sign-off | **Public alpha publication authorized2026-09-15:** commit/push and tagged prerelease with new DMG/checksums. The release workflow must pass before assets publish. No notarization or local production replacement |

## Latest continuation — core dialog safety and minimum-window checks

[Evidence and exact scope](2026-09-13-modal-accessibility.md): fixed destructive Cancel+Enter, native focus-loop escape, missing dialog labels/lifetime settlement, menu/fullscreen conflicts, file-row menu bubbling and clipped narrow chat headers. Added conservative rename guards. Final Accessibility Proof SHA `4ec77e337e3f9eedfc30ac7faf41f1ca83e3fe0c5c101445fcb07407a08a3b4e`, PID75125 now closed; generated profile/workspace quarantined. No real credentials/model calls/production replacement. This is not full accessibility or release approval.

## Distribution notices and matching source

[Packaged licensing evidence](2026-09-13-distribution-licenses.md): readable main/worker/native notices and matching MPL source archives are included and byte-verified; missing/stale material fails builds. Historical/current img2threejs grants and missing RepoLens/noise/shadcn notices retained. Owner confirmed original icon authorship. Recovery Proof SHA `109ef3b7cf2cc5586d0a78b35f7a1a8cb868794a444624f1173ee2bc993924e4`; build/signature/MCP passed, no UI launch/new DMG/production replacement. This closes identified material-packaging defects, not final legal/provenance or release approval.

## Native core recovery and keyboard safety

[Native core-profile evidence](2026-09-13-native-profile-recovery.md): a separate generated Recovery Proof profile was promoted and opened in the packaged app; notes/journal/media/canvas/webpage/workspace and retained draft copy worked. Native editing survived restart; rollback opened the original data while preserving both versions. Two demonstrated modal/fullscreen keyboard defects were fixed and accepted natively. Latest Recovery Proof SHA `0d64b66352cf3b8da51349316e391d9df0287f03551e01d164419e00671dd7e6`; test app is closed and generated profiles quarantined privately. Production and Validation bundles untouched. This is not every-profile/clean-machine/real-historical-user certification.

## Webpage durability continuation

[Native webpage durability evidence](2026-09-13-webpage-durability.md): actual WebKit→SQLite migration, injected save failure→retry, restart after removing only the synthetic browser source, exact webpage content in a real startup backup/native restored copy, and confirmed fixture cleanup passed. No cloud calls or production replacement. This closes registered design-page primary persistence, **not full-profile promotion or a webpage crash journal**. Latest Validation SHA `90fafa6d8c155ac7fd51d842a120835969b28434b6cac4fa18796e62d9c04f45`, PID54995; final package/signature/MCP/rehearsal/matching read-only DMG accepted.

## Previous recovery-feedback build evidence

Validation binary SHA256 `0fb96c6ec0a388af7024df730998053ba3644a1395ecfebd62f09174159d6447`, PID51301. Evidence under `/tmp/orion-release-next/`:

- `verify-profile-recovery-final.log`: TypeScript/Vite,193 frontend files/1227 tests,23 Node contracts,240 Rust passed/1 ignored. The earlier `verify-profile-recovery.log` type-error probe is retained; corrected before build.
- `profile-recovery-build.log`, `profile-recovery-signature.log`, `profile-recovery-mcp.json`: fresh Validation app/deep-strict ad-hoc signature/packaged grant smoke.
- `profile-rehearsal-release.json`: latest fixture harness, actual XDesign registry/document/asset and workspace references,26 generated schema upgrades, cold WAL/SHM and rollback checks. `profile-rehearsal-refusals.json`: existing-report preservation and optimized-Python refusal. Earlier rehearsal reports are historical revisions.
- `profile-recovery-live-result.json`: native top-layer no-overwrite error, new-file success, discard confirmation feedback and Escape close; native webpage/motion/model experimental labels. This used a manually generated retained session, **not another process crash**. Initial fixture lacked its ownership `.lock`, so listing correctly refused; fixed only the fixture. Normal startup/list error/retry screenshots are retained.
- `profile-recovery-dmg-result.json`: fresh image verified, mounted read-only, deep/strict ad-hoc signature and exact native-tested executable hash matched, then detached. Not clean-machine install/notarization.
- `profile-recovery-{npm,native}-audit.log`: root/optional-runtime npm zero findings; selected Apple Silicon zero blocking/five UNIC maintenance advisories. Raw/excluded findings retained; third-party notices explicitly remain incomplete.
- Native fixture session discarded through confirmed UI; both exact-content0600 fixture/export files removed. Original three notes, XDesign state, background flags and production executable fingerprints unchanged. No nonempty retained sessions or fault triggers; empty ownership metadata retained. No cloud calls, production replacement, commit or release.

Screenshots: `/tmp/orion-release-closure/profile-recovery-*`. Older note/file crash, quit, image/provider and backup evidence keeps its own binary attribution. Full accessibility/VoiceOver/narrow-layout acceptance is not inferred from these screenshots.

## Repeat locally

```sh
npm run verify
python3 scripts/rehearse-profile-recovery.py \
  --binary "/absolute/path/to/built/orion-terminal" \
  --report "/tmp/orion-release-next/profile-rehearsal.json"
```

macOS/Unix fixture harness requires Python3 and `fcntl`; no extra Python packages. Use a new report filename on each run; existing report destinations and optimized Python (which disables assertions) are refused. The binary command exits before Tauri/MCP/model startup. Reports contain hashes/results, not credentials. The lease is only for owned test writers, not a global process barrier. Temporary fixtures are bounded/generated; this is not a generic backup utility or hard power-loss certification.
