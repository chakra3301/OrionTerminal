# Incubator — native background, quarantine and safe-mode acceptance

2026-09-18. Bounded macOS continuation using the existing isolated Incubator Proof app. No product-code changes, rebuild, automated-suite rerun, provider call, dependency install, commit or production replacement.

## Isolation and fixture

- Reused `com.lucaorion.orion-terminal.incubator-proof`, generated profile and empty CLI homes from [native lifecycle acceptance](capability-importer-native-lifecycle.md).
- Executable SHA-256 remains `31d14dcea9450112b7336075a59c9feaba91556f8b31ae57c16a284ed0dc1a7c`. Production/debug/prior-proof protected executable hashes unchanged.
- Private evidence: `/tmp/incubator-background-proof`, `r*.png`, `r-*.json`, launch logs, inspected fixture directories and `r-assertions.json`.
- `dev.orion.background-proof` declares only `storage.plugin` and `workspace.read`; standalone `background.js`, `onStartup`, no UI/app/command contributions. No workspace was granted.
- v1 increments private `boots`, preserves a literal `</script><b>THIS IS DATA, NOT HTML</b>` string, and records denial of a background folder request. Fingerprint: `8753d13acf6a22fb3a653e42fdd86fb77d2a9cf28efefbbcce324d2e963f33f2`.
- v2 intentionally throws `EXPECTED BACKGROUND FIXTURE FAILURE`. Fingerprint: `1a8e13071bf7aeed24ce3910417570edafbde2db0c34495463e39e8e41ccb9e3`.
- Earlier foreground-interrupted attempts installed/executed nothing. Owner explicitly made the desktop available before this continuation. Automation checked exact owned PID/binary/foreground; outcomes below use persisted receipts, not attempted-action filenames. No frontend/IPC injection.

## Observed native results

| Boundary | Evidence / outcome |
| --- | --- |
| Incubator inspection and disabled installation | Screenshots r07–r09; `r-installed-disabled.json`: disabled v1, no storage/new broker calls/grants. |
| Explicit enable and background startup | `r-enabled.json`: boots1; actual native storage calls from the hidden sandbox. Literal preserved exactly. Folder request denied with `workspace access requires a visible plugin window`; no picker/grant. |
| Real enabled restart | `r-enabled-restart.json`: boots2, startup marker cleared. |
| Disable and restart | Explicit confirmation r19–r20; `r-disabled-restart.json`: disabled, boots2, no new broker calls. |
| Explicit re-enable | `r-reenabled.json`: boots3; normal quit before synthetic fault setup. |
| Incomplete-startup safe mode | Wrote one exclusive/private `startup-pending.json` while the owned app was stopped. `r-synthetic-startup-marker.json` identifies this as synthetic, **not an actual crash**. Launch consumed it into safe mode; `r-safe-mode.json`: enabled record retained but boots3/no new calls. Screenshot r27 shows the banner and working Manager. |
| Cancel and restart while held | Focused Cancel + Enter in r28–r29; `r-retry-cancelled.json` and `r-safe-mode-restart.json`: safe mode persists, boots3/no new calls. |
| Explicit safe-mode exit | Confirmed **Exit safe mode**; `r-safe-mode-exited.json`: safe-mode record cleared, background runs once, boots4. |
| Reviewed failing update | r37 review/r39 error UI; `r-quarantined.json`: v2 disabled and quarantined, reason `Runtime error: EXPECTED BACKGROUND FIXTURE FAILURE`, prior v1 retained, boots4. |
| Quarantine restart | `r-quarantine-restart.json`: disabled/quarantined v2 remains held, reason retained, no new storage calls. |
| Reviewed rollback | r45–r46; `r-rolled-back-disabled.json`: v1 disabled/unquarantined, v2 retained, boots4; code rollback does not reset private storage. |
| Explicit recovery enable | `r-restored-working.json`: v1 runs again, boots5. |
| Confirmed cleanup and restart | Later reviewed removal r54–r55; `r-cleanup-attempt.json` and `r-final-removed-restart.json`: current/prior absent, private boots7 retained, no pending transitions/safe mode/startup marker. Final owned PID99757 quit normally. |

**Do not infer removal from the first attempt:** r49 and misleadingly named `r-removed-restart.json` did not confirm removal; the latter actually shows enabled v1/boots6. A subsequent launch reached boots7, fresh reviewed removal succeeded, and the final restart confirmed absence. The first attempt's cause was not established; it is not counted as a successful removal or attributed to a product defect without evidence. Likewise r44 missed the rollback button; actual review is r45.

## Verification and remaining scope

- Sixteen state receipts asserted against exact enabled/quarantine/safe-mode/storage/audit states. Seven successful background runs produced **28 fixture-specific storage audit events** (70 total including prior fixtures). Background folder rejection occurs before the native broker and is evidenced by the returned error saved in storage, not a native workspace audit call.
- All 274 pre-existing dirty/untracked baseline file hashes matched before documentation. No product edits or test-count inflation; prior automated results remain historical.
- Fixture code/history removed through Manager; private fixture source, storage and evidence deliberately retained. Proof app closed; production app/profile not used for tests.
- This accepts selected background startup, a synchronous uncaught-error quarantine, and **synthetic-marker** safe-mode persistence/cancel/explicit retry. It does not accept actual startup crash timing, every asynchronous failure, unreadable marker recovery, multi-plugin/dependency interactions, hostile frame/navigation/network/resource behavior, GUI journal faults, power loss, general corruption, or secure erasure.
- Native skills/provider flows, remaining workspace edges/disabled-plugin host revocation and real repository/remote-tool/XDesign adapters remain open. See [handoff](capability-importer-handoff.md) and [workspace acceptance](capability-importer-workspace-acceptance.md).
