# SDK package recovery and reviewed rollback

2026-09-17. Follow-up to [reviewed manager updates](capability-importer-package-updates.md). Code complete for the bounded paths below; **not packaged UI, power-loss, general corruption or whole-platform acceptance**.

## Implemented

- Ordinary manager installs/updates publish through a private, versioned per-package transition journal. The journal records exact state hashes, identities and generated slot names; paths are derived locally, not taken from arbitrary journal paths. Source snapshots and directory entries are synced before publication. Removing the journal is the commit point.
- One previous reviewed package is retained in the existing Plugin Manager filesystem layout. This is **not proof that the previous version works**. A successful later update replaces the exposed previous version; obsolete cleanup failures can leave hidden artifacts.
- A surviving journal conservatively restores prior code **disabled and quarantined**, clears its workspace handles and preserves the earlier retained version. An interrupted first installation is abandoned, not silently completed. Recovery itself is restartable across its tested rename/state-write boundaries.
- Native state reads/mutations reject an outstanding transition. New `plugin_recover_installed` performs recovery at community-store startup or explicit **Reload packages / recover interrupted changes**, returning full records before runtime reconciliation. Ordinary `plugin_list_installed` remains read-only and refuses pending transitions: a resource-handle refresh must never perform hidden recovery while leaving stale enablement/version state in React.
- Unknown versions, malformed/conflicting layouts, missing versions, changed payloads and metadata mismatches fail closed. Failed recovery preserves the frontend view but resets community runtimes and blocks mutation/clear-safe-mode until successful reload. Clearing the error message does not clear this block.
- **Review rollback** fetches/hash-checks the retained package through `plugin_previous_version`. The confirmation shows both fingerprints, versions, retained permission requests and the private-data limitation. `plugin_rollback_reviewed` compares both approved public records under the native package lock, republishes captured retained bytes, advances the installation timestamp and keeps the restored package **disabled** with **no workspace handles**. The replaced version becomes the new previous version.
- The frontend holds the existing mutation lease, rejects active calls/stale reviews, ignores unmounted review continuations and publishes only after native acknowledgement. It validates the disabled receipt and retires now-unsatisfied dependants without starting replacement runtimes. None of the three new native commands has an old-binary fallback; an updated binary is required for community startup/recovery.
- Private namespaced plugin data is **not rolled back**. Older code may be incompatible with newer stored data. Enabling, workspace approval and functional verification remain explicit follow-ups. Removal includes the retained code version; storage remains separate.
- Incubator still installs new identities disabled through its existing separate snapshot path. It refuses identities with pending transitions/orphan retained history. No automatic adapter, AI upload, dependency installation or execution was added.

## Storage and integrity boundaries

`src-tauri/src/plugin_runtime/recovery.rs` reuses SDK contracts, permission validation, package identity hashing and the no-follow byte collector. Recovery/rollback validates payload fingerprint plus manifest/state agreement, not publisher authenticity, licensing or security. Host state is excluded only when reading installed snapshots; source packages still reject that reserved path. A 512-file source remains readable after host metadata is added; ordinary skill/source enumeration limits are unchanged.

Payload limits remain 512 files / 25 MiB, bounded depth/path/individual files. State reads cap at 1 MiB, intents at 4 MiB, and pending journal enumeration at 64. Journals and state staging files use private create-new writes. Retained snapshots contain historical host state, including old workspace paths; rollback/recovery never reactivates those grants. No secure-erasure claim.

## Evidence

- **53 focused frontend tests / 8 files + TypeScript**: reviewed rollback, cancellation/unmount, native-command failure without fallback, durable-before-visible publication, active-call leases, dependent retirement, stale resource-refresh suppression after version/grant changes, unexpected-receipt blocking, recovery load failure/retry, existing manager/Incubator/frame regressions.
- **25 native plugin-runtime tests passed; one child fixture ignored by the normal runner.** Checkpoint fixtures cover five publication boundaries, four recovery boundaries, first-install abort, repeated recovery, stale approvals, changed retained bytes, unknown/inconsistent intents, no-follow retained paths, private journals and the maximum-size file inventory.
- The native suite also launches its own private fixture child and sends real **SIGKILL** after the current directory is parked and after the candidate is published. Reopening those temporary records recovers the prior package disabled, clears workspace access and preserves earlier history. The ignored worker is explicitly invoked by this parent test; it deliberately never exits successfully. This is real process-stop/filesystem evidence, **not an app restart or WebKit test**.
- Shared Intake/reader regression filter: **49 passed / 3 opt-in ignored**, with 8 overlapping SDK tests: **66 distinct native passes** across the two filters.
- Logs: `/tmp/incubator-recovery-{tsc,frontend,native,reader}.log`; pre-work baseline `/tmp/incubator-recovery-before.json`.
- No new dependency, external repository/provider request, package-supplied JS/HTML execution, production-profile change, release build, commit or release.

## Subsequent removal slice

[Reviewed journaled removal](capability-importer-package-removal.md) now closes the partial-delete/restoration gap, with pre/post-commit SIGKILL and injected partial-cleanup checks. It supersedes the removal implementation gap below, not packaged, power-loss or general-corruption acceptance.

## Remaining gates at this slice

Updated non-production GUI inspect/update → rollback review → disabled/no-runtime → explicit enable/function test → restart/disable/remove, permission denial, safe mode and real native frame lifetimes remain open. So do physical power loss, disk-full/short-write/permission failure injection, general damaged-current-package repair, multi-process access to one profile and full removal/storage rollback. Current rollback requires intact current and retained packages; ambiguous data is held for manual review rather than overwritten.

Pre-journal staging, failed cleanup and older pre-feature backup directories can remain orphaned; there is no broad automatic sweep or legacy-backup adoption. Post-commit sync/cleanup failures produce native diagnostics, not a false failed-install result. File/directory sync is not a claim of physical power-loss durability. Do not rely on an older binary to interpret new recovery metadata. macOS was tested; Linux acceptance remains open and unsupported readers fail closed.

Repository/remote-tool/XDesign adapters, Ripper output conversion, owner fixtures and separately approved local-runtime isolation remain in the [full program](capability-importer-scope.md). UI polish remains deferred.
