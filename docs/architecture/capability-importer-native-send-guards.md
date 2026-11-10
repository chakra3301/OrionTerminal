# Incubator — native Send refusal guards

2026-09-29. **Over-budget refusal/retry and disabled/missing imported-agent Send refusal passed, with visible drafts retained and no new model execution.** Narrow synthetic acceptance, not all budget boundaries/providers/agents or restart-safe composer recovery. Follows [ChatGPT transport acceptance](capability-importer-chatgpt-native-acceptance.md) and [Forge selection](capability-importer-forge-selection-acceptance.md).

## Isolation

Reused Skill Proof `com.lucaorion.orion-terminal.skill-proof`, executable SHA-256 `372813aa37f3a7b56a6678279e49e3cd57abe7fad91f79d9927230ad16b9d88f`. Evidence remains under `~/.local/share/orion-proof/skills-20260928/`. No product edits, rebuild, suite rerun, dependency installation or provider inference in this slice. Private Codex0.154.0/observer remained configured; global Codex/protected production/debug/release executables unchanged. No credential contents read/copied by the harness.

Fresh owner-authored `fixtures/guards/budget-proof/` contains only synthetic text:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| SKILL.md | 32,534 | `bfb37552f2c130c09b68fe4dbac59748bd2b1867ae85343396a9198dd9389337` |
| LICENSE | 155 | `62368d3dfc889ba2db864206cd517fed6187cad948d138c18eceb8733436c4f1` |

Bash/Read declarations are metadata, not grants. Native inspect → stage → separate rights acknowledgement → install preserved both exact files, empty legacy instructions/tools. Host ID `imported:01M3QWSC5JHX99D48C9M4E3GQA`, version `01M3QWM0MZJQ6579HC7FK0CQD1`, artifact `a9f053c0ffa32b9a8e521925c4137aa3ccd3d15e47be01dc63ffca608fd95f58`.

## Observed boundaries

| Check | Outcome and evidence |
| --- | --- |
| Actual over-budget Send | Created a new empty chat, selected provider-qualified GPT-5.6 Terra, full SKILL.md only, unchecked LICENSE and confirmed **32,000 tokens or more** (g29). Send refused a conservative33,600 input allowance plus8,192 output/headroom (g33). This differs from the earlier missing-capacity refusal. No truncation/upload/message/session was observed. |
| Retry/draft retention | Replaced the long test draft with `BUDGET_DRAFT_6C42`, then retried. Conservative33,277 plus8,192 again exceeded the acknowledged limit; the complete short draft remained visible (g37). These are conservative byte-budget allowances, not measured model tokens or verified model capacity. |
| Disabled attached-skill Send | Saved `Native Skill Guard Proof`, ID `01M3QX42JZPSP87RD8R5K02S70`, Brain `provider:builtin%3Acodex-cli/gpt-5.6-terra`, empty Action model, one imported ID. Disable succeeded after the failed budget preflight. With the actual agent selected, Send returned `Imported skill "budget-proof" is disabled. Enable it or detach it in Agent Forge.` Complete `DISABLED_DRAFT_97B1` remained visible (g68). This is Send-time refusal, not the previous Forge save-time check. |
| Missing attached-skill Send | Reviewed removal named the attached agent (g73). Approval deleted installed identity/link/version/resources but preserved the agent's attachment. Send returned `Imported skill imported:01M3QWSC5JHX99D48C9M4E3GQA is missing. Repair this agent in Agent Forge.` Complete `MISSING_DRAFT_A361` remained visible (g79). No silent detach, fallback or replacement session. |
| Before-provider evidence | Observer exec count stayed at the five historical ChatGPT starts; zero new execs. New chat `01M3QWSH6SWD6VR9FPJB89A6X7` stayed at zero messages/null session across every refusal. Original private chat retained its nine-message count/session. Agent row/timestamp/attachment stayed identical after save, disable and removal. |

Screenshot/action names are labels, not acceptance. Initial agent-selection attempts g51/g60 did not select the agent and were not counted; g63 confirmed actual selection before Send. g70 focused a URL field after Settings remount reset scroll, not removal; only g73/g74 review/approval and SQLite deletion are counted.

## Desktop safety and historical cleanup hold

The private helper originally reactivated the already-frontmost app before each event, which interfered with native popup selection. Removed that reactivation: it now verifies exact owned PID/executable/identifier and **requires** existing foreground ownership before global input. This private harness change is not a product fix and still does not isolate delivery against concurrent focus changes.

Focus changed before cleanup input. All five queued cleanup actions failed their foreground checks; no input was sent. Stopped GUI work and normally terminated verified owned PID39968 with `NSRunningApplication.terminate()`; no force-kill/global quit shortcut. Post-exit SQLite receipt confirms the installed fixture is gone, but **cleanup was not complete at that endpoint**:

- `Native Skill Guard Proof` remains with its missing imported ID, still selected in the private Orion model preference.
- One empty guard chat plus the earlier synthetic nine-message chat/auth/evidence remain privately.
- No cleanup restart/model restoration/agent deletion was performed. Draft checks prove same-lifetime visible restoration, not persistence through quit/crash/restart or secure erasure.

That hold is now resolved by the follow-up below; it remains historical evidence of the stopped actions, not the current cleanup state.

## Follow-up cleanup

After owner confirmed the desktop was available, reused the exact binary without product/build/suite changes. Native **Use default AI** restored the Opus display (h07). Focus switched to Terminal before Delete, so the global-input helper refused the action; no deletion click was delivered.

Read-only accessibility inspection exposed the owned app's controls. A new private `guard_cleanup_targeted.py` verifies executable hash/PID/bundle, exact sole agent ID/name in read-only SQLite, default model preference and absent installed fixture. It then requires exactly one matching visible agent label and one enabled Delete button in that app's accessibility tree before issuing **AXPress directly on the target element**. No global mouse/key input or app reactivation. This is a specific verified UI action, not a general automation/sandbox clearance; it does not remove global-input races from other helpers.

The native handler removed only `Native Skill Guard Proof`. Normal quit/restart retained empty agent/import/staging/version/resource tables and the default model preference. After full startup hydration, native accessibility readback displayed **Model or agent for this assistant · Opus 4.8** (h13); the earlier h12 screenshot was captured before the Orion window finished loading. Verified owned PIDs41770/42456 normally exited. **Current state: cleanup complete, proof app closed.** Earlier nine-message chat/auth plus the empty guard chat remain privately; no additional message/session/provider inference or secure-erasure claim.

Four new state receipts (`guard-cleanup-before`, `guard-cleanup-agent-removed`, `guard-cleanup-restart`, `guard-cleanup-closed`) are asserted by `guard_cleanup_assertions.py` / `guard-cleanup-assertions.json`; targeted action receipt `guard-cleanup-targeted.json`, h01–h09/h11–h13 screenshots, launch/restart logs and `guard-cleanup-preservation*.json` retained. h10 was not captured because its input was blocked. All137 baseline dirty/untracked hashes matched before docs; protected/proof/global CLI unchanged. The original `guard-assertions.json` records the historical held endpoint; its script's live-state assertion is not replayable against this legitimately cleaned profile.

Next: separately approve the exact synthetic analysis recipient/files/goal and capacity before upload; then native history and local plan save/reload checks. Completed refusal tests need not be repeated.

## Evidence and remaining scope

`guard_assertions.py` / `guard-assertions.json` assert twelve state receipts: `guard-before`, `guard-installed`, `guard-chat-before-send`, `guard-budget-refused`, `guard-budget-retry-refused`, `guard-agent-saved`, `guard-disabled`, `guard-disabled-send-refused`, `guard-attachment-removed`, `guard-missing-send-refused`, `guard-held-before-exit`, `guard-closed`. Visual outcomes were manually reviewed, not programmatically OCR-asserted. Screenshots g01–g79, `guard-fixture-hashes.json`, `guard-baseline.json`, `guard-preservation-before-docs.json`, `guard-preservation.json`, `guards.log` and existing observer evidence are retained privately.

All136 preexisting dirty/untracked hashes matched before docs; protected executables/proof binary/global Codex unchanged. No production profile replacement, commit or publication. This does not cover exact-limit/other-capacity boundaries, disabled plain-model option edges, live Forge/multiple-skill combinations, streaming Stop/cancel-pending races, native analysis/history/plans, real upstream transport, broad hostile-tool/security/storage recovery or unfinished repository/runtime adapters. Next functional acceptance after cleanup: separately reviewed native analysis/history/plans or an explicitly scoped live Forge combination. See [handoff](capability-importer-handoff.md).
