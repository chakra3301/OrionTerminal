# Incubator — native Forge and foreground selection acceptance

2026-09-29. **Local attachment/selection/repair checks passed; no provider Send was attempted.** Reused the exact separate-identifier Skill Proof binary from [local lifecycle acceptance](capability-importer-skill-native-acceptance.md). No product changes, rebuild, automated-suite rerun, dependency installation or production replacement.

## Isolation and setup

- Durable evidence: `~/.local/share/orion-proof/skills-20260928/`, screenshots `f01`–`f88`, `forge-*.json`, `forge-assertions.json`, native launch logs.
- Profile/identifier: `com.lucaorion.orion-terminal.skill-proof`; executable SHA-256 remains `b0af66e21b06fe552454531759105640fbc66f824d7ff41951f41b5fd5578204`.
- Previous lifecycle fixture was removed. Re-inspected/staged/rights-reviewed the existing synthetic v1 through native Incubator controls, creating new identity `imported:01M3PTWCJHTV1JWX7GSE3DBNRF`, candidate `01M3PTS97V1DAPG8P1S4X6NMGK`. Old removed receipts were not reused/resurrected. Same four files/617 bytes and v1 artifact hash.
- Created a private `selection-workspace/README.md` only, then opened it in Orion to expose the foreground rail. No project scripts/install/dev server were run. README remains unchanged.
- Existing empty CLI homes stayed unauthenticated; no connect/login or AI-send control was invoked. Settings briefly opened its existing provider-status view; this is not provider inference acceptance. A model name in a picker is not evidence of authenticated access.
- Used native UI/keyboard/pickers and read-only SQLite receipts, not injected frontend state or mutated database rows. Companion was hidden temporarily through the existing Spotlight command for visibility; it returns on restart. Narrow picker scrolling was usable but no UI polish claim is made.

## Verified behavior

| Boundary | Observed evidence |
| --- | --- |
| Forge attachment/save | Equipped only the imported fixture; saved `Native Skill Attachment Proof`, agent `01M3PTY5Y8NR7NPNX1N2DSSJ7Z`, Brain `claude-opus-4-8`, no Action override. `forge-agent-saved.json` records exactly one imported ID and no hand-authored attachments. An accidental Note-Taker selection during scrolling was unequipped before save. |
| Plain-model selection | f34 shows the installed version and full SKILL.md (333 bytes), unchecked DESIGN.md/LICENSE resources, and no inactive Python option. f35 checks DESIGN.md and disclosure becomes416 bytes; LICENSE remains unchecked. No Send. |
| Capacity review | f40–f41 show a local32,000-token capacity choice. This is a UI acknowledgement exercise, not a verified model limit or budget enforcement test. |
| Switching to saved agent | f46 resolves its imported attachment automatically; resource choices reset to unchecked and333 bytes. f48 shows capacity reset to the prompt. Earlier arrow-key attempt f42–f43 did not change the model and is not counted. |
| Restart | `forge-agent-restart.json`/f49 preserve the agent's exact saved imported ID; Orion still selects the saved agent and displays its installed version. No chat rows. |
| Disable attached skill | Settings disable changes package state without silently removing the agent attachment. f58 shows the foreground missing/disabled repair warning. |
| Disabled attachment save refusal | Editing the saved agent and pressing Forge shows `Enable or detach unavailable imported skills before saving this agent.` (f64). `forge-disabled-save-refused.json` retains the exact original row including update timestamp. |
| Remove attached skill | f68 names the attached agent and warns about repair. Approved removal deletes package resources while preserving the agent's missing ID. f70 shows the foreground missing warning. `forge-missing-restart.json` confirms missing reference survives real restart, rather than silently becoming an ordinary skill. |
| Missing attachment repair | f75 shows `Missing imported skill` and **Detach missing skill**. Save without repair is refused (f76), original row unchanged. Explicit detach then save removes only the attachment; `forge-repaired.json`/`forge-repair-restart.json` retain the same agent identity with `skill_ids_json: []`. |
| Cleanup | Restored Orion's default model through its picker, deleted only the synthetic agent through Forge, then restarted. `forge-cleanup-restart.json` has no agent, imported skill, staged candidate, package version/file or chat rows. f88 shows normal Opus4.8 selection. Final owned PID21957 exited normally. |

Eleven state receipts plus the initial saved-agent row were asserted. No chat/messages/session were created, and legacy imported instructions/tools remained empty while installed. These facts support the local no-Send sequence; they are not a network traffic audit or proof of live provider tool isolation.

Before documentation all132 pre-existing dirty/untracked hashes matched. Production/debug/release protected executable hashes unchanged. Private authored sources, README, removed installation receipts, screenshots and proof bundle remain as evidence; the skill and agent are no longer installed.

## Subsequent provider follow-up

[Native synthetic ChatGPT acceptance](capability-importer-chatgpt-native-acceptance.md) subsequently passed bounded plain-model context/freshness/zero-grant configuration, active-use Disable refusal, early local Stop and retry. Its late Stop attempt was not counted; remote/streaming/cancel-pending races remain open. It used the updated private proof binary, not the unchanged binary of this local no-Send receipt. No live Forge/multiple-skill acceptance is implied.

## Still open

- Broader imported provider/agent combinations, Stop during confirmed streaming, cancel-pending mutation/lease races and remote execution/billing semantics.
- Native budget refusal/draft retention, four-skill/multiple-agent combinations, plain-model disabled-option interaction, legacy migration and injected persistence failure.
- Disabled and missing attachment **save** refusal and visible chat warnings passed; this session did not press Send to test pre-dispatch rejection.
- UI clipping/accessibility polish, broader adversarial/runtime/recovery checks and real repository/remote-tool/XDesign adapters are not accepted by these local checks.

See [handoff](capability-importer-handoff.md) and [Slice C contracts](capability-importer-slice-c.md). Further provider testing needs an explicitly selected test recipient/account and upload scope; no login, account reuse or real skill upload is implied by this receipt.
