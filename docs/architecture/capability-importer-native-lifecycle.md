# Incubator — isolated native SDK lifecycle acceptance

2026-09-17. Bounded packaged macOS acceptance, **not a release or broad plugin-security sign-off**. Follows [reviewed removal](capability-importer-package-removal.md), [recovery](capability-importer-package-recovery.md) and [disabled intake](capability-importer-local-packages.md).

## Isolation and artifacts

- Ad-hoc-signed release-profile app **Orion Terminal Incubator Proof**, identifier `com.lucaorion.orion-terminal.incubator-proof`.
- App: `/tmp/incubator-native-proof/target/aarch64-apple-darwin/release/bundle/macos/Orion Terminal Incubator Proof.app`.
- Generated profile: `~/Library/Application Support/com.lucaorion.orion-terminal.incubator-proof`. No production profile was copied or edited.
- Build/frontend/evidence output confined to `/tmp/incubator-native-proof`; cloned an earlier private validation build cache. Built once for discovery and once after the CSP fix. No production replacement, normal release artifacts, notarization, commit or publication.
- Final executable SHA-256: `31d14dcea9450112b7336075a59c9feaba91556f8b31ae57c16a284ed0dc1a7c`.
- Empty private Claude/Codex/Gemini homes, auth/API environment overrides removed, no login or AI request. Providers visibly reported login needed. No repository acquisition, package dependency installation or arbitrary upstream execution.
- Fixture `dev.orion.incubator-proof` derives from the in-repo Hello Orion example. Two versions differ in manifest version and visible marker. Counter uses private storage; a deliberate `workspace.listHandles` request exercises denial without requesting/granting workspace permission. Only this inspected sample-derived JavaScript executed, after explicit enablement.
- Fixture package fingerprints: v1 `28aeb9fc92670fecc5601de1e3be5209f7a27779dfcacb9fb7082f6df71d939a`; v2 `3ffddfee4ab8701a887ceb65f4233612bc2c38aec593e744a5892044c620d889`.
- `control.py` binds input/screenshot operations to the exact owned PID/binary and foreground application. Real native folder pickers, mouse/keyboard input and WebKit rendering were used; no injected frontend store/IPC calls.
- `evidence.py` reads only this generated profile, recomputes installed/retained payload fingerprints, and records full host states, private counter data, broker audit and pending slots. Evidence JSON and numbered screenshots remain in that private directory. Screenshot filenames describe attempted steps; the observations/state receipts below govern, not filenames alone.

## Defect found and fixed

The first packaged app installed and enabled v1 but rendered **“Waiting for the opaque sandbox handshake”** indefinitely. `first-open.json` recorded enabled v1 with zero broker calls and no storage. SDK Blob documents attempted inline scripts; their `unsafe-inline` meta policy cannot relax the inherited production shell CSP. HTML appearance alone was not functional acceptance.

`src/plugins/pluginDocument.ts` now reuses the existing exact-hash opaque evaluator in `src/apps/xdesign/preview-bootstrap.js` (raw source only, no XDesign runtime/store). **Shell CSP and its hashes are unchanged.** It refuses top-level/same-origin/native-API contexts, initializes the SDK bridge only in an opaque child, and evaluates classic standalone scripts after document parsing. Background source is JSON-encoded rather than inserted as raw HTML. Modules are rejected; HTML event-handler attributes/external scripts are not a supported execution path.

A trusted opaque guard permits only `about:` child frames, preventing the content document from granting itself external frame-navigation authority. Its relay binds source window, channel, version, session and message direction. Child bootstrap failures become bounded session-bound SDK errors. `SandboxPluginFrame` uses incarnation-keyed iframes, recognizes readiness without counting it as malformed RPC, and holds/quarantines startup that never completes within ten seconds. Generic sessionless loader errors are not trusted as current-incarnation errors; timeout handles outer-loader failure.

First binary retained at `/tmp/incubator-native-proof/before-bootstrap-fix.app`. After the fix, the same profile/version visibly became Ready with native host identity, `Tauri authority visible: no`, and real storage broker calls. This is not proof of every forbidden API/network/navigation path; broader hostile-package testing remains open.

## Observed native sequence

| Check | Evidence/result |
| --- | --- |
| Fresh native startup | SQLite `_sqlx_migrations` contains successful 30 and 31; native startup reached schema31. This is not an existing-user upgrade acceptance. |
| Settings → Skill Library inspection | Native folder selection, escaped package metadata/permissions/hash and rights acknowledgement. `pre-install.json`: no installed package or broker activity. |
| Explicit disabled installation | `installed-disabled.json`, screenshot16: v1 disabled, not quarantined, no workspace handles, storage or broker calls, no pending transaction. |
| Explicit enable/open | Plugin Manager enable + Spotlight launch; first binary exposed the CSP defect above. Fixed binary: screenshot26 and `fixed-startup.json` show real Ready/host identity and two broker calls. |
| Function and permission denial | Screenshots27–29, `working-v1.json`: counter advanced to2; workspace call reported `permission denied: workspace.read`. Five audited calls, no quarantine. |
| Reviewed update | Native v2 picker, screenshot39 exact fingerprint/permissions/activation warning. `update-reviewed-not-applied.json` remained v1. Approval produced enabled v2, retained v1, preserved counter2; old app window retired. |
| v2 actual execution | Screenshots42–43, `working-v2.json`: visible v2 marker, counter incremented to3 through native storage. |
| Real app quit/restart | `v2-quit.json` → `v2-restart.json`, screenshot44: enabled v2, retained v1 and counter3 survived; reopened app made two fresh reads, no quarantine. |
| Rollback cancellation | Screenshot49 shows both fingerprints and code-only/data-incompatibility warning. Escape cancelled; `rollback-cancelled.json` stayed v2. |
| Reviewed rollback | Screenshot52/`rolled-back-disabled.json`: v1 disabled, v2 retained, fresh installed timestamp, no workspace handles, counter remains3. No new broker calls. |
| Disabled restart | Real quit/relaunch, screenshot53/`disabled-restart.json`: v1 remained disabled, no fixture app/runtime or new broker audit activity. |
| Explicit re-enable/open | Screenshots65–67/`reopened-v1.json`: actual v1 marker, Ready/host identity and persisted counter3. This fixture's old code can read its newer counter data; not general data compatibility. |
| Explicit disable | Confirmation screenshot73 then approval screenshot74/`explicitly-disabled.json`: disabled v1; fixture window retired and data/history preserved. |
| Reviewed removal cancellation | Screenshot75 version/hash/retention warning. Enter on focused **Cancel** dismissed; `removal-cancelled.json` preserved both code versions and counter3. |
| Reviewed removal and restart | Screenshot78/`removed.json`, real quit/relaunch, screenshot79/`removal-restart.json`: active and retained code absent, counter3 deliberately retained, audit unchanged at12, no pending slots. |
| Incubator entry point | Actual Incubator window, native folder picker and review in screenshots81–89; `incubator-inspect-only.json` shows no reinstallation/execution. Unchecked review discarded in screenshot90; `final.json` still no code and counter3 retained. Installation itself was exercised through Settings, not repeated through Incubator. |

All owned app processes exited normally after the final check. First AppleEvent quit returned an automation error despite the owned process having exited; later quits used foreground ⌘Q and checked process exit. No app SIGKILL was needed here. Generated profile/evidence retained privately, fixture code removed through Plugin Manager.

## Focused checks and preservation

- `npx tsc --noEmit`: pass.
- **73 frontend tests /10 files**: manager review, store, activity, frame validation/lifetime, new document/bootstrap/relay tests, runtime, both Intake components and existing XDesign preview contracts.
- **5 Node evaluator contracts**: exact existing CSP hash in production/development, privileged-realm refusal, source/direction relay, child-only evaluation and preview watchdog.
- Both isolated native bundles built successfully. No Rust source changed in this slice; the earlier 32 native runtime passes remain historical evidence, not a new rerun.
- Protected production `/Applications/Orion Terminal.app`, repository debug executable, and prior Onboarding Proof executable hashes remained unchanged. Production profile was not used by the control/evidence helpers.
- Worktree baseline `/tmp/incubator-native-before.json` recorded269 dirty/untracked files:262 unrelated hashes unchanged,7 expected frame/test/documentation edits (`final-preservation.json`). Also changed the previously clean frame contract test and added the document helper/tests plus this receipt. Scoped diff/new-file whitespace and documentation links passed. No reset/stash/blanket formatting/commit.

## Still open / next

**Follow-up:** [workspace permission acceptance](capability-importer-workspace-acceptance.md) now covers real temporary-folder grants, read/write mode enforcement, host/SDK revocation and rollback/restart re-consent using this exact binary without a rebuild. That receipt also covers disabled installation directly through Incubator. [Background acceptance](capability-importer-background-acceptance.md) subsequently passed enabled/disabled startup, synchronous-error quarantine and synthetic-marker safe-mode cancel/retry on this binary; actual startup crashes remain untested.

- Native skills staging/install/Forge/plain-model activation, reviewed live-provider analysis/history/plans, existing-profile migration, remaining workspace edge cases/disabled-plugin revocation, remaining safe-mode/quarantine/failure variants, actual startup crashes and adversarial callback/navigation/resource tests.
- GUI interrupted-journal recovery and uncertain outcomes, physical power loss, disk-full/short-write/permission faults, damaged-package repair, private-storage rollback, orphan cleanup and multi-process profile access. Prior private SIGKILL tests are not upgraded to app-crash acceptance by this successful lifecycle.
- Old-binary refusal/no-fallback remains unit/contract evidence, not a native old-binary rehearsal.
- Owner-selected app/tool/image-to-3D/Ripper fixtures and actual adapters; separately approved local-runtime isolation/dependencies. No arbitrary repository conversion or upstream feature-parity claim.
- UI polish and owner visual acceptance remain deferred. Shell DOM shortcuts such as ⌘, were not handled while the SDK iframe held focus; Settings remained accessible through the dock. No claim of full shortcut/accessibility acceptance.
