# Plugin Manager — captured updates and version-bound review

2026-09-17. Follow-up to [disabled SDK intake](capability-importer-local-packages.md). Closes the ordinary manager's live-source-copy gap and normal-UI update races. **Not** whole-platform completion, generic adaptation, a native execution sandbox or crash-recovery acceptance.

## Source and consent boundary

- Manager inspection and installation now share captured-byte parsing/hashing with SDK intake. Manifest parsing uses the captured manifest; publication writes the captured files, never a later copy of mutable source paths. Legacy fingerprint ordering is checked against an independent test-only reference scanner, including nested and Unicode resources.
- Manager accepts UTF-8 resource names and resolves the selected root once before descriptor-relative no-follow traversal; Incubator retains its stricter physical-root/ASCII policy. Bounded 512 files, 25 MiB payload, 5 MiB/file, 64 KiB manifest, 2 MiB entrypoints, 1,024 walked entries and 16 directory levels; manager relative paths cap at 4,096 bytes. Reserved/case-colliding paths and nested symlinks are rejected. macOS checked; Linux needs acceptance. Unsupported reader platforms fail closed rather than using the former unsafe traversal (no Windows compatibility claim).
- UI installation uses new **`plugin_install_reviewed_directory`**, sending the captured installed record or explicit null for a new identity. Native code compares its current record under the package lock before mutation, including version/fingerprint, enablement/quarantine, exact grants and public workspace handles. Stale approvals fail. There is no old-binary command fallback.
- The legacy command remains callable for compatibility and also writes captured bytes, but does **not** gain the reviewed installed-state precondition. The ordinary UI no longer uses it. Manager activation semantics stay unchanged: new installs can activate, updates preserve reviewed enablement, safe mode still applies. Incubator remains disabled-only/new-identities-only.
- Picker errors are caught, duplicate starts blocked, and unmounted picker/inspection/approval continuations cannot install. Review captures current store state after inspection rather than an old render closure. Publisher claims remain unauthenticated; activation behavior and absence of security/license clearance are disclosed.

## Update and frame lifetimes

- `communityActivity` leases reject updates while broker or runtime-quarantine work is pending. During publication, new frame RPC is rejected without treating normal update waits as malformed traffic. Leases release on failure as well as success. This coordinates the trusted frontend; it is not a cross-process native tool sandbox.
- `SandboxPluginFrame` refreshes session/gesture identities with the installed fingerprint/timestamp/enablement/quarantine stamp. Current-version and disposal checks prevent old messages, native results, notifications and entrypoint-load failures from reaching or quarantining replacement frames. Disabled/quarantined frames do not start entrypoint reads.
- Runtime quarantine holds an activity lease until its native request settles. Source-dependent callbacks do not silently overwrite a newer frontend version.
- Native staging directories are private and uniquely named; writes do not clobber existing staged files. Failed promotion attempts restore the prior package; restoration failure is reported explicitly. Failure to delete a backup **after successful publication** no longer reports a failed install: it emits a native diagnostic and may leave a hidden recovery backup. No secure-erasure claim.

## Evidence

- **45 frontend tests / 8 focused files**, plus TypeScript. Includes manager picker/approval unmount and live-state capture, reviewed-command binding/no-fallback, active-call/update/quarantine leases, replacement-frame reply and error suppression, and existing Incubator/runtime/sandbox regressions.
- **56 distinct native tests passed; 3 opt-in tests ignored**: plugin-runtime filter 15; Intake/reader filter 49, with 8 overlapping SDK tests. Includes Unicode/captured-byte writes, legacy fingerprint/byte-count compatibility, changed installed-state refusal and strict skill-reader regressions. Native tests use bounded fixtures/temporary storage, not a packaged GUI session.
- Logs `/tmp/incubator-updates-{tsc,frontend,native,reader}.log`; baseline `/tmp/incubator-updates-before.json`.
- No new dependency, external repository/provider request, package-provided code execution, production profile change, release build, commit or release.

## Subsequent recovery slice

[Journaled publication and reviewed rollback](capability-importer-package-recovery.md) now retain one previous version and conservatively recover interrupted transitions disabled, without old workspace grants. Includes private native SIGKILL/reopen evidence, not packaged acceptance. That receipt supersedes the pre-journal backup/retention limitations below; broader power-loss/corruption/removal/storage acceptance remains open.

## Still open at this slice

An updated non-production binary is required for real inspect → approve → update → frame restart and permission-denial checks, plus safe mode, failures, user enable/disable/remove and normal restart. JSDOM lifetime tests are not opaque WebKit/native acceptance. Backup-cleanup and failed-restoration paths are not injected end-to-end; interrupted rename/power-loss recovery, backup discoverability/retention and durable app rollback remain unproven. Read dismissal does not force-abort filesystem I/O; a stalled filesystem can retain the read lock.

Repository/remote-tool/XDesign adapters and Ripper conversion still need owner fixtures and functional acceptance; local engines need approved isolation/dependencies. The full [ranked importer program](capability-importer-scope.md) remains incomplete.
