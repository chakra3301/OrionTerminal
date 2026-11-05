# Incubator — native workspace permission acceptance

2026-09-17. Follow-up to [isolated SDK lifecycle](capability-importer-native-lifecycle.md). **Bounded macOS acceptance; no product-code change, rebuild, broad test rerun or release.**

## Boundary

Reused the same ad-hoc-signed Incubator Proof binary/profile, identifier `com.lucaorion.orion-terminal.incubator-proof`, executable SHA-256 `31d14dcea9450112b7336075a59c9feaba91556f8b31ae57c16a284ed0dc1a7c`. Production, repository debug and prior Onboarding Proof executable hashes remained unchanged. No production profile, login, model call, repository acquisition or dependency installation.

All new fixtures/evidence live in `/tmp/incubator-workspace-proof` (private directory). The actual folder picker granted **only** its `workspace/` subdirectory. It contains a synthetic `marker.txt`, an `escape.txt` symlink to a synthetic sibling sentinel, and subsequently the plugin-written `result.txt`. Nothing in the user's real workspaces was selected. Only the locally authored, inspected fixture JavaScript ran, after explicit enabling.

`dev.orion.workspace-proof` uses the existing SDK sample manifest shape, UI contribution and broker API. Permissions: `storage.plugin`, `workspace.read`, `workspace.write`. v1 and v2 differ only in version/visible/output markers. The fixture deliberately retains its last opaque handle in private storage, so clearing host grants can be tested against a real stale handle instead of merely an empty picker.

Package fingerprints:

- v1: `10b97577ced5b0a2e9071d89ca1dc078481c4687861a4858a8e36d7eee3caf12`
- v2: `95b06cd6b48b2ef8f0dbff930c9300bc95a7bd84e9f2f83f3339b415fa170bc5`

Real WebKit UI, native folder dialogs, ordinary confirmations and process quit/relaunch were used. PID/binary/foreground-bound `control.py` and read-only `evidence.py` were adapted from the preceding proof. No frontend store or IPC injection. A helper initially used the wrong host-state field spelling; corrected to serialized `workspaceGrants`, with no product change.

## Results

| Check | Observed evidence |
| --- | --- |
| Install through Incubator | Screenshots10–12, `installed-disabled.json`: exact permissions/hash reviewed, acknowledgement then disabled install; no grants, storage or new broker calls. Complements the earlier Settings installation. |
| Gesture gate | Screenshot19: startup `requestAccess('read')` rejected for lack of a recent trusted click/key press; no picker or grant. Genuine button clicks crossed the nested guard and opened the native picker. |
| Picker cancellation | Screenshot21, `picker-cancelled.json`: returned null, no grant or stored handle. |
| Read-only scope | Screenshot31, `read-only-denials.json`: marker read succeeded; write denied even though manifest includes `workspace.write`; traversal `../outside.txt` and symlink read denied. No result file created. Public handle reply contains id/label/read/write, not root path. |
| Explicit read/write approval | Native picker upgraded the same folder's handle; screenshot37, `write-granted.json`: wrote `WRITTEN BY WORKSPACE FIXTURE v1` only to `workspace/result.txt`. |
| Host revocation | Manager visibly showed `workspace READ + WRITE`; confirmation screenshots41–43. `host-revoked.json`: no grants. Same still-open iframe retained its cached ID; screenshot47 and `stale-handle-denied.json` show read/write rejected as unknown/revoked and listHandles empty. |
| Revocation survives restart | Normal quit/relaunch; `revoked-restart.json`: still enabled, no grants, cached old ID retained. An early attempted read happened before startup was ready and did not reach the broker; this row asserts persisted state, not that attempted click. |
| New consent | `regranted.json`: explicit native folder approval created a different read/write handle. No silent resurrection of the old ID. |
| Reviewed update with grant | Screenshot62 exact version/hash/permissions review, `updated-with-grant.json`: v2 enabled, reviewed grant retained, v1 retained. `v2-wrote.json`: real v2 execution replaced the synthetic result with its v2 marker. |
| Rollback clears authority | Screenshot71 review →72 apply; `rollback-cleared.json`: v1 disabled, grants empty, v2 retained. Private storage still contains the old ID and external result still contains v2 data. Retained metadata has historical grants; those are not active authority. |
| Restart and explicit enable after rollback | `rollback-restart.json`: disabled/no grants/no new broker calls. Explicit re-enable/open followed by actual read/write/list attempts: screenshot82, `rollback-cached-handle-denied.json` show both operations denied and no handles. |
| Fresh read-only consent after rollback | Another native folder approval produced a **third distinct handle**. `fresh-consent-read-only.json`: marker readable again, write still denied, v2 result unchanged. |
| SDK self-revocation | `sdk-revoked.json`, screenshots90–91: SDK revoke cleared the grant and subsequent cached read failed. |
| Cleanup | Reviewed removal of the active fixture retired its window and removed current/previous code. `removed.json`: no code or grants/pending intent; private cached-ID data and synthetic output deliberately retained. Owned proof process exited normally. |

## Evidence and limits

- **16 state receipts checked by assertions** in `assertions.json`; payload fingerprints recomputed whenever current/retained code existed.
- **30 fixture-specific native audit events** (42 total including12 from the previous fixture): four successful grants, two successful reads, two successful writes, four denied writes, five denied reads, three handle listings, one host revoke, one SDK revoke, and eight private-storage operations. Frontend no-gesture rejection and cancelled picker correctly do not masquerade as native grants.
- Three distinct handle IDs verified. Every receipt preserves the original input SHA-256 `80eeec0845cc03f356ca145d8de6a0dde9f5bf3e3999cd050a9db68e8b0047d7` and exact outside-sentinel text. v2 result remains unchanged through rollback, denied writes, revocation and removal.
- Before documentation, all273 dirty/untracked baseline file hashes matched `/tmp/incubator-permissions-before.json`. Only acceptance documents are changed in this slice. No commits or blanket formatting. Prior automated test counts remain historical, not newly rerun passes.
- No fault, concurrent filesystem mutation, symlink-swap race, multi-process profile, OS sandbox, hostile-origin/network, broad accessibility or power-loss guarantee. This proves the selected gesture/mode/handle/lifecycle boundaries in the packaged app.
- Subsequent background attempt: prepared fixtures at `/tmp/incubator-background-proof` but stopped GUI automation when foreground changed and the proof UI did not advance. Nothing installed/executed; `paused-no-install.json` confirms no background package/storage/startup marker/safe mode. Closed only the exact owned PID with `NSRunningApplication.terminate()`, without global quit keys or forced termination. Foreground checks before global input are not delivery isolation during concurrent desktop use; future automation must avoid that race. This does not undo the independently observed workspace results above. Resumed successfully after the owner freed the desktop on 2026-09-18: [bounded background/quarantine/synthetic-safe-mode acceptance](capability-importer-background-acceptance.md).
- Still open: disabled-plugin host revocation, other workspace operations/edge cases, actual startup crashes/remaining background and safe-mode failure variants, GUI interrupted journals, native skills/live-provider workflows and fixture-grounded adapters. Local Node/Python/GPU runtimes still require separate approvals.
