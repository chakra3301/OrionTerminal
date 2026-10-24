# SDK package removal — reviewed, journaled, cleanup after commit

2026-09-17. Follow-up to [package recovery/rollback](capability-importer-package-recovery.md). Bounded implementation and temporary native evidence, not packaged UI or power-loss acceptance.

## Closed gap

The old remover renamed current code to trash, recursively deleted it, then tried to restore the trash directory if deletion failed. Recursive deletion can be partial: that could restore broken code. It also deleted retained history before current removal had committed. Frontend error handling could restart the old runtime without knowing which bytes remained.

## New boundary

- `plugin_runtime/recovery/removal.rs` captures/validates current and optional retained state/payload, writes a private versioned intent, then retires both directories to generated identity/nonce-bound slots. No recursive deletion happens before journal removal commits logical removal.
- A surviving removal intent restores intact current and retained code, holds current **disabled/quarantined** and clears its workspace grants. Recovery validates every occupied slot before moving anything and is repeatable across tested restoration boundaries. Missing, duplicated, changed or unknown records require manual review. Conflicting update/removal intents fail before recovery mutates either.
- After commit, recursive cleanup is best effort. Partial deletion or cleanup failure never restores retired code and never reports that the logical removal failed. Unconfirmed post-commit directory sync retains retired code instead of deleting it. Native diagnostics describe cleanup failures; private leftovers can remain and are never silently adopted. No secure-erasure claim or general orphan sweep.
- Native state reads, ordinary listing, installs and rollback reject pending removal intents. Existing startup/explicit **Reload packages / recover interrupted changes** handles both transition families; resource refresh stays read-only. V1 update journals retain their original schema.
- New `plugin_remove_reviewed` compares the exact approved public installed record under the package lock. Manager confirmation captures the version/hash before opening; duplicate starts and unmounted approval callbacks cannot remove anything. Store/native stale checks and a mutation lease close approval/activity races. There is no old-binary fallback. The legacy removal command retains its call shape and uses journaled removal, but lacks the new reviewed-record precondition.
- An unconfirmed removal preserves the frontend record but stops community runtimes and blocks mutations until explicit successful recovery reload; it never optimistically reactivates old code. Success publishes removal only after native acknowledgement. Namespaced plugin data remains separate and unchanged; neither removal nor rollback rewinds that data.

## Checks

- **58 focused frontend tests / 8 files + TypeScript**: removal review binding, stale approval, active-call/mutation leases, durable publication, old-binary denial, uncertain-removal hold, duplicate/unmount/cancel behavior, plus existing recovery/rollback/Incubator/frame regressions.
- **32 native plugin-runtime tests passed; two private worker fixtures ignored by the normal runner.** New cases cover three removal boundaries, three recovery boundaries, no-history packages, stale review/changed payload, invalid/duplicate/conflicting intents, and injected partial recursive deletion after commit. A separate file sentinel remains untouched.
- New private child **SIGKILL** cases stop after current retirement and after commit. Reopen recovers the former disabled with history intact, while the latter stays removed. These run alongside the prior update SIGKILL cases. Child fixtures are explicitly invoked by their parent tests and intentionally killed, not ordinary successful worker tests.
- This is real temporary filesystem/process evidence, **not a packaged app restart, live plugin execution or actual power failure**. No new dependency, external request, package-provided JS execution, production-profile change, build/release or commit. Native testing compiles only the existing debug test target.
- Logs `/tmp/incubator-removal-{tsc,frontend,native}.log`; baseline `/tmp/incubator-removal-before.json`.

## Remaining

Updated non-production GUI/lifecycle/function/permissions/restart acceptance is still required. Physical power loss, real disk-full/short-write/permission failures, general damaged-package repair, multi-process profile access, storage rollback and orphan cleanup remain unaccepted. Removal currently requires intact verified packages; it is not a force-delete or repair command for corrupted code. Rollback/recovery does not certify prior code as functional, secure or licensed.

Fixture-grounded repository/remote-tool/XDesign adapters, Ripper conversion and approved local-runtime isolation remain in the [full importer program](capability-importer-scope.md). UI polish remains deferred.
