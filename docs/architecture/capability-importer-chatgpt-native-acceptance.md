# Incubator — native synthetic ChatGPT acceptance

2026-09-29. **Bounded plain-model context transport, zero-grant configuration, active-use mutation refusal, local early Stop and fresh retry passed.** Not full Incubator, sandbox, streaming-cancellation or all-provider acceptance. Follows [ChatGPT preflight](capability-importer-chatgpt-preflight.md) and [local Forge/selection](capability-importer-forge-selection-acceptance.md).

## Isolation and exact scope

- Reused updated Skill Proof SHA-256 `372813aa37f3a7b56a6678279e49e3cd57abe7fad91f79d9927230ad16b9d88f`, identifier/profile `com.lucaorion.orion-terminal.skill-proof`. No source edits, rebuild, automated-suite rerun or dependency installation in this slice.
- Owner selected ChatGPT, completed interactive sign-in and approved synthetic skill/prompt content, no personal files/tool grants. Owner freed the desktop. Global-input helpers checked exact owned executable/identifier/foreground; this is not delivery isolation against concurrent focus changes. Final owned PID38565 quit normally.
- Native Providers displayed **SESSION CONNECTED** and the exact proof `empty-codex` credential profile (l06). Private Codex0.154.0 remained pinned; global0.155.1 and production/debug/release executables unchanged. A pass-through private observer logged only argv/cwd/profile path/empty grant value/run-ID presence, then exec'd the unmodified pinned CLI. It never logged bridge tokens, auth contents or prompt stdin.
- Fresh locally authored `fixtures/live/provider-proof/`: SKILL.md781 bytes, DESIGN.md168, LICENSE207, inactive.py67; total1,223 bytes. Unlike the older local-only fixture, its text explicitly permits this synthetic transport test. Declared Bash/Read remains ungranted metadata; Python never executed.
- Native Incubator inspect → stage → separate rights acknowledgement → install created `imported:01M3QQK9DKNM6EAPVG0P86P1GD`, version/candidate `01M3QQGR1Q9BJGHFXGNGRM2D43`, artifact hash `cc46e0bd296a40e773c79b9d24397edcc8a0643c389a4e08839d695c1458ff2b`. Exact installed bytes/hashes asserted; legacy instructions/tools remained empty.
- Selected provider-qualified `provider:builtin%3Acodex-cli/gpt-5.6-terra` in Orion. First review attached only SKILL.md+DESIGN.md (949 bytes), not LICENSE/Python, with a conservative32,000 capacity acknowledgement. This is not tokenizer/model-entitlement certification. Ordinary Orion context chips also included the previously authored **synthetic** workspace README (78 bytes) on some turns;949 describes imported resources, not the entire request. No personal document was selected for these turns. Harness did not read/copy credential contents; the CLI used its normal owner-authorized authentication.

## Observed results

| Boundary | Evidence |
| --- | --- |
| Missing capacity / draft preservation | First Send without capacity displayed `Confirm the selected model’s context capacity in the skill controls. Nothing was sent.` Draft stayed visible (l32). One empty chat was created, zero messages/session; observer showed zero model executions. This is missing-acknowledgement refusal, **not over-budget refusal**. New-chat creation reset the picker, so context was explicitly reviewed again before actual Send. |
| Full entrypoint + optional resource transport | First live prompt named marker fields but did not supply their values. Reply returned `ORION_ENTRY_4D79F6C2`, `ORION_END_A831E5B0`, `ORION_RESOURCE_B682C9D4` (l44). Rollout contains complete exact SKILL.md/DESIGN.md bodies, version/hash wrappers; LICENSE/Python bodies absent. |
| Fresh restricted CLI routing | Five distinct CLI session IDs; every start was `exec`, never `resume`, with pinned0.154.0, correct private auth home, `--ignore-user-config`, read-only sandbox, never approval, web/shell/native/cloud feature restrictions and `ORION_TOOL_GRANTS=[]`. Later turns explicitly replayed conversation text in fresh sessions rather than inheriting the older sandbox. Only the first turn attached DESIGN.md; subsequent imported blocks contained SKILL.md only. |
| Active-use mutation refusal | Second bounded long response was still running at recorded time23:30:52Z/PID37848. Native Settings Disable displayed `Stop the response using this skill before updating, disabling or removing it.` (l63). Immutable package stayed enabled and unchanged. After that response completed, Disable succeeded and explicit re-enable restored selection. Update/removal/rollback attempts during active use were not exercised. |
| Late Stop attempt — **not counted** | Second response completed at23:31:10Z with500 synthetic lines before attempted Stop (l65 at19:31:28 local). `live-stopped`/process absence do not prove cancellation. Third fresh reply returned `RECOVERY_OK` plus the entry marker, but was initially captured while thinking; l87 and final rollout prove completion, not the early receipt filename. |
| Actual early local Stop | Fourth fresh CLI turn was observed task-started/not-completed with live PID38300 at23:38:06Z, then native Stop ended that process (l101/l102, `live-actual-cancel.json`). Its rollout has no task_complete/output reply. This proves local connector cleanup before output, **not remote cancellation, upload retraction, billing cancellation or Stop during confirmed token streaming**. |
| Fresh retry after actual Stop | Owner asked to try again. Fifth new session returned `RETRY_OK ORION_ENTRY_4D79F6C2` (l106), no resume. Prior cancelled user text remained in replayed history; no dangling-session resume. |
| Packaged native zero-grant broker | Separately ran the exact packaged executable in stdio MCP mode with explicit empty grants/private DB. tools/list returned `[]`; forced read/write/shell calls all returned `Tool is not authorized for this run`. Synthetic README hash unchanged, denied output absent. This is a same-binary broker probe, not model-generated tool attempts or comprehensive native-tool isolation. |
| Cleanup/restart | Removed only the imported fixture through reviewed native UI, restored original Opus selection, restarted, then normally quit. No staged/installed skill, versions/files or synthetic agents remain. One synthetic nine-message chat and five CLI rollouts remain privately as evidence; private login retained for future separately scoped tests. Removed receipt survives; not secure erasure. |

Five fresh CLI starts produced four completed replies and one local cancellation. No function/tool-call records observed in these rollouts. Empty grant/config evidence and explicit broker denial are stronger than model self-report, but do not establish hostile-provider/core-tool/sandbox security clearance.

## Durable evidence and preservation

Root: `~/.local/share/orion-proof/skills-20260928/`. Screenshots l01–l115; `codex-observer.jsonl`, frozen `live-model-executions.json`, private Codex session rollouts, `live-packaged-zero-grant-mcp.json`, `live-actual-cancel.json`, `live-retry-result.json`, `live_assertions.py`, `live-assertions.json` and thirteen state receipts:

`live-before`, `live-installed`, `live-capacity-refused`, `live-first-complete`, `live-disable-held`, `live-stopped`, `live-disabled-after-stop`, `live-reenabled`, `live-recovery-complete`, `live-actual-cancelled`, `live-retry-complete`, `live-cleanup`, `live-cleanup-restart`.

Receipt names are labels; actual completion/cancellation assertions use timestamps, process state and rollout events. Before documentation all135 baseline dirty/untracked hashes matched; protected executables/global Codex unchanged. No production profile/bundle, commit, publication or release change. New proof app closed, sources/auth/synthetic transcript retained privately.

## Later refusal follow-up

[Native Send guards](capability-importer-native-send-guards.md) subsequently passed actual over-budget/retry and disabled/missing agent **Send-time** refusal with retained visible drafts and zero new model starts. A later cleanup follow-up restored the default model, removed that test agent through verified target-specific accessibility after global input was blocked, and confirmed absence/default persistence after restart. Proof app closed; no installed fixture/agent remains, two synthetic chats/auth retained. These later endpoints supersede the earlier profile state, not the historical results above.

## Still open

- Other budget/capacity boundaries and imported/plain-model option edges; missing capacity, budget refusal, Forge **save-time** refusal and agent **Send-time** refusal are distinct accepted boundaries.
- Live Forge/multiple-skill/agent combinations, real upstream taste/Stitch transport and other providers/models.
- Stop during confirmed token streaming, cancel-pending mutation/lease races, late/stale callbacks, remote execution/billing semantics and provider/account changes during preparation.
- [Later native synthetic analysis/history/plans](capability-importer-analysis-native-acceptance.md) passed its one reviewed Terra request/local saves/restart/shared Settings reopening. Its local follow-up confirms Incubator record removal/retained historical plan/restart/missing-source block. Real-source/repository-document/other-provider analysis, plan faults/Settings removals and existing-user migration/recovery remain open.
- Hostile core/remote tools, frames, networking/resource/TOCTOU attacks, general filesystem/storage/power-loss recovery.
- Owner-fixture repository/remote-tool/XDesign adapters and separately approved local runtime isolation. UI polish remains deferred; the whole Incubator platform is not finished.

See [handoff](capability-importer-handoff.md).
