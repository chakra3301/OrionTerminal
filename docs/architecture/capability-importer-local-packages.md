# Incubator — disabled local SDK package intake

2026-09-17. First bounded managed-app-package path after [review plans](capability-importer-review-plans.md). **Actual installation of prepared SDK directories**, not repository conversion, generated adapters, remote connectors or local engines.

## Delivered workflow

Both Incubator and the shared Settings intake now expose:

1. **Choose package folder · inspect only** — an explicit native directory picker. No automatic detection/download on repository discovery or drag/drop.
2. Review escaped manifest, declared (unauthenticated) publisher, exact capability names, file/byte counts and complete package fingerprint. No source HTML preview is executed.
3. Explicit source/rights/permission acknowledgement, then **Install disabled package**.
4. Existing Plugin Manager owns enablement, windows, commands, dependencies, safe mode, workspace grants, updates and removal. New package identities only; intake refuses replacement, including a race with another installation.

Inspection/selection/dismissal perform no writes or inference. Late picker/inspection results are ignored after dismissal/unmount. Dismissal does not abort an in-progress filesystem read or close the OS picker; committed installation is not cancellable. Errors retain review and clear acknowledgement; another source clears it too. Source path is shown in the transient review, not added to a new provenance database.

## Native boundary and lifecycle reuse

- New distinct commands `plugin_inspect_intake_directory` and `plugin_install_intake_directory`; old binaries fail closed without falling back to the activating legacy command.
- `src-tauri/src/plugin_runtime/intake.rs` reuses SDK manifest/permission validation, fingerprint format, installed-state layout, package mutex and native broker. No new registry, migration, runtime or dependency. `communityPluginStore.install(..., "intake-disabled", rightsReviewed)` uses this route without calling runtime synchronization, activation or startup markers. Ordinary Plugin Manager behavior remains unchanged.
- Reuses Intake's existing descriptor-relative no-follow reader. Selected paths must be physical directories; internal paths are bounded ASCII without traversal. Symlinks, special files, case collisions and reserved state names are rejected. Bounds: 512 files, 1,024 walked entries, 16 directory levels, 240-character relative paths, 25 MiB payload, 5 MiB/file, 64 KiB manifest and 2 MiB entrypoints. Directory enumeration also caps 512 entries per directory. Non-macOS/Linux readers fail closed; this session tested macOS only.
- Bytes are captured into a bounded in-memory snapshot; its exact manifest is parsed and its exact files hashed. Installation recaptures and checks the reviewed fingerprint and exact nonduplicate permission set, then writes **those captured bytes**, not a later copy from mutable source paths. Source mutations after capture cannot substitute installed bytes.
- Worker-thread I/O with one new-path read/install worker admitted at a time. Filesystem operations have no force-cancellation or wall-clock deadline; a stalled filesystem can keep this path busy.
- Publication uses a unique private temporary directory and rename under the package lock. Files are created without clobbering, written/synced, then state is published `enabled:false`, no workspace grants, approved capabilities dormant. Failures before publication remove the temporary directory; an existing identity is untouched. Interrupted-process/power-loss durability, orphan cleanup and adversarial same-user mutation of app-data storage are **not accepted/proven** here.
- At this slice's completion, the ordinary manager had not been migrated. **Follow-up:** [captured manager updates](capability-importer-package-updates.md) now remove the live-copy gap and bind UI approval to installed state. Broader crash/rollback recovery and packaged acceptance remain open.

No dependency installation, build, model call, package-provided script execution, background startup or silent enablement. No license/security/functionality clearance: the owner must inspect source and rights; declared names/publishers are not authenticated. A repository README/manifest review or saved plan never becomes an installable package through this path.

## Checks

- TypeScript clean; **42 focused frontend tests / 6 files**: new review/approval/lifetime/error/schema UI tests, disabled-only store publication and old-binary no-fallback, duplicate identity and missing acknowledgement, preserved ordinary manager behavior, shared intake plus manifest/runtime/dependency regressions.
- **13 focused native plugin-runtime tests**, including six new tests: changed source/permissions denial; exact disabled state and temporary storage reread; mutation after capture; existing identity refusal; reserved/oversized/missing/symlink rejection; existing in-repo `hello-orion.orion-plugin` read-only snapshot → disabled temporary package → state reread. Native fixture checks did not run the HTML/JavaScript or launch an app.
- Logs `/tmp/incubator-packages-{tsc,frontend,native}.log`; dirty baseline `/tmp/incubator-packages-before.json`.
- No external repository/provider requests, new dependencies, third-party execution, production profile/app changes, release build, commit or release.

## Remaining acceptance

An updated non-production binary is required. Exercise both entry points: inspect → dismiss/reinspect → approve disabled install → verify no runtime → explicitly enable in Plugin Manager → open and test actual SDK behavior → restart → disable/remove. Verify native permission denial, safe mode, failed writes, duplicate identities and source changes. Existing tests are not packaged UI or functional acceptance.

Remote tool/XDesign/local-engine adapters, generic repository packaging, Ripper adaptation, archive intake, persistent source/plan-to-package lineage, app update/rollback crash recovery and the full ranked platform remain open. Owner fixtures and approved local-runtime isolation/dependencies are still needed for those families.
