# Archives Downloads — configurable storage/time limits

Implemented 2026-10-18 as a continuation of the approved Stacher-parity rebuild. This closes the fixed-size configuration gap, not large-transfer/native-dialog/full-tool acceptance. No new schema, dependency or engine version.

## Controls and snapshots

**Storage & time limits** appears in the source inspector and **Download settings → New-link defaults**. Values are whole MiB/minutes, validated in both React and native commands:

| Limit | Accepted range | Historical/default value |
|---|---:|---:|
| Maximum final media file | 16–65536 MiB | 2048 MiB (2 GiB) |
| Combined unfinished work | 32–262144 MiB, at least twice the file cap | 4096 MiB (4 GiB) |
| Keep free on disk | 512–65536 MiB | 512 MiB |
| Each engine operation | 1–1440 minutes | 45 minutes |

1024 MiB = 1 GiB. This is not a quality/size estimator or a disk reservation. Two-times headroom is a minimum, not a guarantee: intermediate conversion, source streams and other retained jobs can need more. Choose limits within the actual space available; raising a cap never creates disk space.

Old preferences/jobs omit `limits` and retain the historical defaults. Unknown limit keys, malformed numbers, overflow, fractional/out-of-range input and insufficient work headroom are refused; damaged stored defaults are not silently overwritten. New inspections, batches and playlist selections snapshot defaults. Existing staged jobs keep their own values after defaults change. Native local playable-copy jobs snapshot current default limits while retaining their existing dedicated conversion policy. Resource limits do **not** change output-variant/archive identity.

## Native enforcement

- yt-dlp receives the exact selected byte cap; compatible conversion and caption-label remux receive the selected FFmpeg `-fs`. Output probing/publication independently check actual bytes. Shared probe/export helpers have a separate 64 GiB absolute ceiling so larger permitted jobs are not accidentally rejected at the historical 2 GiB check. This is not proof that every extractor/postprocessor honors an exact peak-byte cap.
- Transfer, caption remux and compatible conversion each receive their own selected timeout. Inspection, small poster generation and auth scratch retain separate bounds; this is not a single whole-job deadline. Stop/timeout/resource failure terminates and reaps engine processes before scratch cleanup, leaving recoverable private transfer files.
- The sampled work budget counts all unfinished job directories, including paused, failed and ready files. Initial playable-copy admission also includes the pending full source copy. Different shared-work-cap snapshots cannot run in the same queue cohort: later jobs wait for active jobs to finish rather than silently inheriting a different cap. Other per-job file/time/reserve values can differ.
- Work scans tolerate only entries/directories disappearing during a peer's rename/cleanup. Links, unexpected directories/special files, entry-count overflow and permission/other I/O errors still refuse. Scans are not atomic filesystem snapshots.
- Free-space admission selects the containing physical volume and includes a full pending media copy **plus** the chosen reserve. Engine checks run on the existing sampled watcher; publication checks again before copying, during copying and before no-clobber publication. Poster publication uses the original job's reserve as well as its separate 512 KiB JPEG bound.
- Checks are advisory and sampled: external writers and concurrent work can consume space between checks. There is no OS quota, filesystem/network sandbox or hard preallocated reservation.
- A ready job bypasses transfer admission and stays `ready` with an actionable error if publication cannot proceed. Completed private bytes remain available for a later save; a disk-space refusal must not turn them into a transfer retry that deletes them.
- Long publication copies retain a `saving` activity claim without holding the global activity mutex, so unrelated polling/Stop remains responsive. Stop during publication remains refused, preserving atomic receipt semantics. Local playable-copy preparation creates a durable job immediately and runs its private initial copy on the blocking pool, with cancellation/work checks; failed/cancelled preparation never changes its original and cleans only its own incomplete temporary copy.

Manual **Export a copy…** is a separate user-granted operation: existing media up to 64 GiB can be copied with an independent 512 MiB free reserve, including room for the whole export. It does not inherit a later downloader default or persist a folder grant. Generic Archives file intake keeps its separate 512 MiB cap.

## Verification and evidence

Current focused gates: **72 frontend tests, 81 ordinary native tests, five opted-in synthetic installed-engine fixtures**, typecheck, notices and diff checks. The five installed fixtures rerun the previously verified synthetic download/extraction, pause/range-resume, AV1 normalization, embedding/clipping and poster paths with the new APIs; none is a real large Internet download.

New regressions cover boundary/default/corrupt configuration, exact engine/FFmpeg arguments, unchanged archive identity, frozen batch snapshots, queue cohort compatibility, pending-copy/shared-work accounting, concurrent peer rename/cleanup, publication reserve/no-clobber behavior, cancelled private-copy cleanup, preservation of ready jobs and a fake engine terminated/reaped after exceeding a small selected work cap with partial bytes retained. File/publication cap tests use sparse files, not a physical multi-GiB transfer. Poster reserve tests compare against the actual temporary volume's current free space and preserve the source.

Private evidence: `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-limits-01/`. Six nonpersistent, background WK renders exercise actual React/theme CSS in Liquid/Ivory/420px source/default views with native IPC/model actions blocked. The fixture deliberately seeds 8192/16384/2048 MiB and 90 minutes; it is not native preference persistence or owner workflow acceptance. Receipts record controls and layout; screenshots show no horizontal overflow. Harness servers/hosts exit after capture and never activate/input into the owner app.

Still unaccepted: real 4K/large authenticated transfers, end-to-end native cold-default/save dialogs, UI Stop during a large local copy, actual low-disk/timeout during a real download, broader whole-shell/fault/power-loss behavior and owner visual/full parity acceptance. The constrained development disk was not filled to test these paths.
