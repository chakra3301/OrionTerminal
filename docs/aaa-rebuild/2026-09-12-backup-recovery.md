# Verified SQLite backups and non-destructive recovery — 2026-09-12

Continuation of [normal quit safety](2026-09-12-quit-safety.md). **SQLite snapshot/retention and restore-copy slice accepted; unsaved-draft crash recovery, full-profile promotion and release clearance are not.** Existing WIP preserved; no commits, production writes, cloud AI requests or prior migration edits.

## Source findings and implementation

`src-tauri/src/db_backup.rs` previously opened second-resolution destination names nonexclusively, matched arbitrary `orion-*.db` names for pruning, ignored deletion failures, retried SQLite BUSY/LOCKED without a deadline, and rotated without checking integrity. Its previous "never costs more than one session" guarantee was unjustified and removed.

The replacement:

- Snapshot names are `orion-YYYYMMDD-HHMMSS-ULID.db`. A private, exclusively created `.pending-ULID/` directory contains the working file. After SQLite copy, validation, connection close and file sync, same-filesystem hard-link publication atomically refuses existing destinations. The parent directory is synced on Unix before retention. No overwrite/rename fallback on filesystems lacking hard links.
- New directories/files are Unix **0700/0600**; the existing managed backup directory is restricted to0700. Backups remain unencrypted and include sensitive data stored in SQLite. External media, CLI auth files, keychains and memory-only drafts are not copied.
- SQLite's online backup API copies committed WAL state without a raw live-file copy. Output is converted to self-contained DELETE journal mode. Short busy waits, bounded step loops and a progress handler share a30-second cooperative deadline; source/output file limit2GiB. This is not a hard deadline for stalled filesystem/kernel I/O or a power-loss certification.
- Before publication, `integrity_check(1)` must return `ok`, required core tables/columns must exist, and the SQLx migration ledger must be a successful contiguous prefix with exact SHA-384 checksums from the **same migration list used by app startup**. Unknown/newer/failed/modified histories are refused. This validates physical SQLite structure and basic compatibility, not every row's nested JSON, foreign-key/application semantics or logical correctness.
- A permanent regular `.rotation.lock` inode uses `File::try_lock`, released on close/process exit; never unlink an advisory-lock inode. Competing backup work fails safely rather than racing publication/pruning. This coordinates Orion backup processes, not arbitrary same-user external writers.
- Retention validates all recognized candidates before deleting anything, retains five valid compatible snapshots, and always protects the newly created snapshot even after clock rollback. Both strict legacy timestamps and new timestamp/ULID names are recognized. Symlinks, directories, unrelated names, invalid/future-history files and candidates with WAL/SHM/journal sidecars are preserved, not counted as good backups. Read-only immutable candidate connections avoid creating sidecars on older WAL-header snapshots. More than128 candidates or a deadline failure leaves retention for manual review.
- Invalid or interrupted `.pending-*` leftovers are not automatically reaped; another process could still own them. The five-snapshot policy is **not a total disk-space bound**, independent off-device backup, or guarantee against repeated logically bad saves.
- Startup failures remain nonfatal, but are latched in native state and surfaced after hydration as a sticky **Database backup needs attention** toast. Snapshot failure says older backups were not rotated; cleanup failure distinguishes a verified new snapshot from incomplete retention. A failure to query status is also visible. Migration loading still proceeds after a backup failure: this is not a migration-abort gate.

`src-tauri/src/lib.rs::database_migrations()` is now the shared list; no SQL files changed. Existing rusqlite enables its **hooks** feature (no new package). `File::try_lock` needs Rust1.89+; actual verification used1.95, not a minimum-version certification. A Node configuration contract refuses SQL preloads in the checked-in Tauri config: plugin preloads run before app setup and would bypass this backup order. Overrides that add preloads are unsupported.

## Restore-copy command

The newly built executable handles this mode **before** Tauri/MCP startup:

```sh
"/path/to/updated/Orion Terminal.app/Contents/MacOS/orion-terminal" \
  --restore-db-copy "/path/to/backups/orion-…db" "/path/to/NEW-recovery-directory"
```

Exactly two path arguments are required; destination must not exist, even as an empty directory. It creates a private directory containing verified `orion.db`, using the same copy/validation/publication path. It does not open the desktop, start model processes, migrate the copy, or replace any live profile. Wrong arguments exit2; refused copy exits1; verified copy exits0. A directory-sync error can leave a published copy to inspect rather than destroy. Files outside SQLite are not included; data inside SQLite may be sensitive.

A recovery copy is an inspection/rehearsal artifact, **not automatic restoration of the complete app**. Before any manual promotion, preserve the original database plus its WAL/SHM together, stop all app/CLI/MCP/sync writers, preserve associated media separately, and never combine the restored database with stale sidecars. Do not use raw `cp` on a live WAL database as a substitute for the online API. No live-profile replacement or credential-file copying was performed here. Full-profile promotion, attachments, historical-schema upgrades and cross-version restoration still need their own acceptance.

## Evidence

Under `/tmp/orion-release-next/` unless otherwise stated:

- **`verify-backup-safety-complete.log/.exit`0**: TypeScript/Vite passed; **191 frontend files /1,218 tests ·22 Node contracts ·234 Rust passed /1 ignored**. Four UI regressions and14 backup tests (replacing four old tests) cover WAL/uncommitted exclusion, full29-migration schema, same-second uniqueness, permissions, atomic no-clobber, malformed/page-corrupt sources, migration history/schema refusal, strict retention/clock rollback/candidate limits, locks/deadlines, symlinks, first launch and restore-copy refusal/round trip. A final test-only SQL-preload contract was added after native build; production code did not change afterward.
- Final serial Validation `.app`/DMG build `backup-safety-build-final.log/.exit`0; deep/strict ad-hoc signature and packaged MCP smoke `backup-safety-mcp-final.json` passed. First MCP probe used a relative binary path and failed usage validation; empty output retained, corrected absolute invocation passed. An earlier successful build/startup remains attributed separately in `backup-safety-startup-result.json`; the final build clarified CLI wording that SQLite copies may contain sensitive database data.
- Current accepted executable SHA **`4bbb1837432619bcea58b4ef379c6c346522b437360d37fa59073f85fd1dd47f`**. Final failure-probe PID42854; healthy-restart PID42951. Prior initial build PID41558.
- Actual Validation startup created a new verified0600 snapshot, restricted backup directory0700 and retained exactly five recognized backups; surviving older backup hashes were unchanged. No pending or sidecar files remained.
- A fixture-only bounded Python helper held Validation's backup lock for at most180seconds. Native startup showed the inspected sticky failure toast, created no snapshot, and left all backup hashes unchanged. Helper was signaled after PID/command verification; lock release checked directly; inode preserved. Normal quit/restart without the lock created a verified snapshot and showed no backup warning. `backup-safety-lock-result.json`, `backup-safety-live-result.json`; screenshots `/tmp/orion-release-closure/backup-safety-{locked,recovered}-startup.png`.
- Actual packaged **restore-copy CLI** recovered a Validation snapshot to a new private disposable directory. Note/XDesign/consent hashes matched, integrity and29-migration ledger passed, and a synthetic note insert exercised the real FTS trigger inside a rolled-back transaction on the recovered copy. Existing destination (including empty), corrupt input, unsupported history and missing arguments were refused; source and existing target hashes stayed unchanged; failed output directories were cleaned. `backup-restore-cli-result.json`. All disposable recovered/synthetic database copies were removed after verification. No live profile was replaced.
- Original three notes and XDesign state unchanged; background opt-ins off; quick_check ok; no save-failure triggers; installed and checkout production executable fingerprints unchanged. Startup legitimately rotated only managed Validation backups. No production data or credentials were accessed for fault injection.
- `backup-safety-validation.dmg`: verified, mounted read-only, mounted app signature/executable hash matched, detached (`backup-safety-dmg-result.json`). Not notarization, Applications installation, clean-machine or remote-CI acceptance.
- Root/runtime npm audit0findings; selected Apple Silicon native graph343packages/0blocking/5maintenance warnings. Raw/unselected findings retained. Known-pattern secret scanning is separate from privacy/distribution clearance.

## Still open

Unsaved drafts on crash/Force Quit/power loss; safe full-profile promotion and historical upgrades; external media/HTML localStorage durability; deeper application-state validation; private-temp retention after process death; broader provider/specialist/security/accessibility/provenance gates; normal-product clean-machine installation and remote CI. No whole-lockfile/native-platform, universal recovery or release sign-off claim.
