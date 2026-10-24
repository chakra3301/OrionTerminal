# Incubator — native local skill lifecycle acceptance

2026-09-28, continued 2026-09-29. Local-only checks in an isolated macOS proof app. **Inspection, staging, installation, disabled persistence, reviewed update/rollback, re-enable and confirmed removal/restart passed. [Local Forge/foreground selection and repair](capability-importer-forge-selection-acceptance.md) subsequently passed; live provider activation remains pending.** No product-code changes, provider sends/logins, dependency installations or fixture script execution.

## New proof environment

The earlier `/tmp/incubator-*-proof` directories now contain mostly empty remnants: the accepted SDK proof executable and control/evidence files were no longer available. Their September 17–18 repository receipts remain historical reports, but do not assume those temporary raw artifacts can still be inspected or reused. No attempt was made to recreate old evidence.

A fresh release-profile proof was built from HEAD `5abece2` plus the preserved Incubator worktree:

- Durable root: `~/.local/share/orion-proof/skills-20260928/` (private directory, not `/tmp`). Contains `control.py`, `evidence.py`, fixtures, configuration, logs, screenshots, ten SQLite receipts and `assertions.json`.
- Bundle: `target/release/bundle/macos/Orion Terminal Skill Proof.app` beneath that root.
- Identifier/profile: `com.lucaorion.orion-terminal.skill-proof`; `~/Library/Application Support/com.lucaorion.orion-terminal.skill-proof`.
- Executable SHA-256: `b0af66e21b06fe552454531759105640fbc66f824d7ff41951f41b5fd5578204`.
- Separate frontend output and copy-on-write clone of the release cache; offline Cargo build, ad-hoc signing. Vite/native build exited 0. No new tsc or automated-suite run; prior counts are historical, not repeated here.
- Empty private CLI homes and stripped API/auth overrides. Setup skipped through native UI. Incubator enabled explicitly in this new profile. Production app/profile was not used for testing; production/debug/release executable hashes unchanged.
- All interaction used the real UI/native picker. No frontend/IPC injection, imported-skill database mutation or existing-profile migration test. SQLite evidence reads used read-only connections.

## Inspected local fixture

Two locally authored folders, `fixtures/v1/skill-proof` and `fixtures/v2/skill-proof`, share the source label/entrypoint/name required for reviewed updates. Each has four files / 617 bytes:

- `SKILL.md`: version-specific description/body, declared `allowed-tools: Bash Read`, literal `<script>DO_NOT_EXECUTE</script>` for escaped preview.
- `DESIGN.md`: version-specific plain text resource.
- `LICENSE`: local permission/attribution text, not a third-party rights assessment.
- `inactive.py`: deliberately throwing source; stored as inactive code, never run.

All retained file bytes/hashes were compared with the authored originals. These are synthetic small fixtures, not new acceptance of the real 87 KB taste skill or Stitch resource.

| Version | Candidate ID | Artifact SHA-256 |
| --- | --- | --- |
| v1 | `01M3MB8SSKXA2RF423JE7T1199` | `cb8f4e225e05146e0692af8215e5ce06a7521c51768cdf035510ebf00eaa4299` |
| v2 | `01M3MBKSQ0E7GYSBJ8S0RJ46BY` | `c2eecc232c01e77451f72478ef1d1977c3ab7e37bbcee75a8ef1e9182dd3886c` |

Installed identity throughout: `imported:01M3MBF95HGCTEX9XH2AFD7RV6`.

## Observed boundaries

| Step | Native evidence |
| --- | --- |
| Inspect with root attribution | Incubator picker/discovery/explicit inspection; `inspected-only.json` has no staged or installed rows. Screenshot14 discloses declared requests as ungranted and classifies Python as inactive code. |
| Escaped resource preview | Screenshot16 displays literal script markup as text. No source execution or provider upload. |
| Separate staging | `staged-v1.json`: one immutable candidate, zero installed skills. |
| Real staged restart | `staged-restart.json` and screenshot20: staged v1 persists, still uninstalled. |
| Rights acknowledgement gate | Click on disabled install before checkbox leaves `unapproved-install.json` unchanged. Separate acknowledgement then installation succeeds. |
| Explicit install | `installed-v1.json`: staging consumed; host identity, one version/four files. Enabled **for selection**, not model activation. Legacy instructions remain empty; `tools_json` is exactly `[]` despite declared Bash/Read. |
| Disable and real restart | `disabled-restart.json`: same identity/version, disabled, bytes intact. |
| Settings entry point / v2 staging | Native Settings → Skill Library → choose v2 → attribution → inspect → stage. `staged-v2.json`: disabled v1 remains authoritative until separate update. |
| Explicit destination and comparison | Screenshot43: owner selects Update rather than default new identity; comparison shows DESIGN.md/SKILL.md changed, LICENSE/Python unchanged, fresh unchecked rights acknowledgement. Analysis model remains unselected; no AI request. |
| Reviewed update | `updated-v2-disabled.json`: same installed identity, active v2, prior v1 retained, still disabled, staging consumed. Both versions' exact bytes verified. |
| Real update restart | `v2-restart.json`: v2 remains disabled with v1 retained; no instruction/tool leakage into legacy rows. |

Ten state receipts passed assertions. Before documentation, all 131 existing dirty/untracked baseline hashes remained unchanged.

## September 28 pause (historical; resolved below)

After the update restart, foreground verification detected Chrome rather than the owned proof app. The helper refused the pending scroll and stopped global input. Normal termination targeted only the verified proof PID87070 via `NSRunningApplication`; app exited without global quit keys or forced termination.

`final-held-disabled.json` confirms **one disabled imported skill, two immutable versions/eight stored files, zero staged candidates**. The fixture is intentionally retained in this private profile so remaining checks can resume without repeating acquisition/update. No fixture skill was sent to an AI provider or attached to an agent.

The September 29 continuation below completed the remaining local lifecycle checks with this same binary. Use stable/exclusive desktop focus or verified target-specific input for any future native work. The durable helper validates executable, identifier and owned PID; foreground checks before global events still do not provide delivery isolation under concurrent use.

## September 29 — rollback, preview and removal closure

No rebuild/product edits, automated-suite rerun, provider call or fixture script execution. Exact proof hash verified before launch. Evidence remains in the same durable root, screenshots50–81, ten additional SQLite receipts and `rollback-assertions.json`.

- `rollback-before.json` / screenshot52: persisted disabled v2, prior v1 available.
- Review then **Cancel rollback review** leaves v2/disabled unchanged (`rollback-cancelled.json`).
- First attempted Apply missed the control: `rollback-applied.json` and `rollback-restart.json` still show v2 and are **not** successful rollback evidence. Screenshot60 has the Apply button below the visible region. Reopened review, scrolled and verified controls before applying again.
- Screenshot66 / `rollback-confirmed.json`: same skill identity now points to v1, remains disabled and retains v2. `rollback-confirmed-restart.json` verifies actual restart persistence.
- Explicit Enable changes only selection availability (`rollback-reenabled.json`); no model send. Screenshot73 reads the real installed DESIGN.md and displays `RESOURCE_VERSION_1`. Every retained resource matches its original fixture bytes/hash.
- Removal dialog warns about both retained versions/resources. Focused Cancel + Enter leaves enabled v1 and both versions intact (`removal-cancelled.json`).
- Separate **Remove imported skill** approval removes the imported identity, link, both versions and all eight package-file rows (`removal-approved.json`). `removal-restart.json` confirms absence after real restart; screenshot81 shows Settings Skill Library 0/24 with no imported skills. Two installation receipts remain marked removed, preventing silent resurrection; this is logical deletion, not secure erasure of backups/free pages.
- Final owned PID19781 exited normally. No staged/imported fixture remains in the private profile. Authored fixture folders, historical receipts and proof bundle remain for evidence; they are not installed capabilities.

Ten continuation receipts were asserted independently of the earlier ten. All132 pre-existing dirty/untracked baseline hashes matched before documentation; protected production/debug/release executables were unchanged. Final cleanup state supersedes the historical disabled fixture retained at the September28 pause.

A subsequent [Forge/foreground selection receipt](capability-importer-forge-selection-acceptance.md) covers local attachments, selection, disabled/missing save refusal and repair without Send. This does not accept live plain-model/Forge turns, budget refusal/draft retention, leases during provider responses, legacy-profile migration, real upstream fixture UX, injected database failures, backups/crash recovery or comprehensive security. See [Slice C](capability-importer-slice-c.md) for existing tested contracts and [handoff](capability-importer-handoff.md) for remaining platform work.
