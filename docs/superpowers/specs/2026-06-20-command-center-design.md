# Command Center — Design Spec

**Date:** 2026-06-20
**Status:** Approved (refinement complete) — ready for implementation planning
**Replaces:** the Hermes Kanban surface (`src/apps/hermes/`). Hermes data tables stay read-only for history; the dock tile and board UI retire.
**Builds on:** Agent Forge / Control Panel (`agents`, `skills`, `providers`), the provider+CLI runtime (`runtime/`, `cli_engine/`), LLM Wiki (`wiki_*`), Learn's force-graph (`forceLayout.ts`), `activity_log`, and ROSIE's approval-gated planning pattern.

---

## 1. What this is

Command Center is a new top-level Orion app (gold "command" accent) that turns the terminal into a **commandable AI organization**. You (the Commander) run an org of **profiles**; you chat with them in **channels**; they **delegate, report, and accumulate field knowledge** in their own growing memory vaults.

**One engine, many profiles.** There is a single runtime — **pi**, driven headless via its SDK (`session.prompt()` + event streaming) as a sidecar. A *profile* is a saved configuration over that engine: persona + brain model + skill set + its own LLM-Wiki vault + a rank. Different divisions are different profiles, not different beings.

**Flat org — no swarms, no operatives.** Each division *is* a profile and does its own work, serially, in its own session. We are explicitly **not** building parallel agent fan-out (that was Hermes; it retires).

### Ranks (locked)

- **Commander** — you. Issues missions, approves, receives briefings, can talk to anyone.
- **General (GM)** — a **pure coordinator** profile. Decomposes missions into directives, routes them to divisions, aggregates division reports into one briefing for you. Does **not** do division work itself.
- **Captain** — one per division (Design, Marketing, Research, Dev, …). A profile = pi + its own wiki + its own skills. Works directives itself, serially. Talks to the General, peer Captains (handoffs), and the Commander.

### Locked decisions (2026-06-20)

1. **New top-level app**, gold accent. Replaces the Hermes tile; Hermes board UI retires, `hermes_tasks` kept read-only.
2. **Pi engine via SDK sidecar** — every profile gets the real llm-wiki skill + extensions.
3. **Vault-per-profile** — clean separation, independent growth, scoped recall.
4. **General = pure coordinator** (single throat-to-choke reporting to the Commander).
5. **Channel-first surface** (Slack-like) + a lightweight per-profile mission list.
6. **Start clean** — fresh `cc_missions`; existing Hermes tasks stay read-only for history.

---

## 2. Architecture

### 2.1 Data model — migration `0027_command_center.sql` (append-only)

```sql
cc_profiles    id, name, rank('commander'|'general'|'captain'), division, accent,
               brain_model, skill_ids_json, wiki_root, charter, autonomy_level, created_at, updated_at
cc_channels    id, kind('command'|'division'|'cross'|'dm'), division, name, created_at
cc_messages    id, channel_id, from_profile_id, to_profile_id, -- to nullable
               kind('chat'|'directive'|'report'|'handoff'), body, mission_ref, ts
cc_missions    id, title, brief, status('draft'|'planned'|'running'|'review'|'done'|'blocked'),
               autonomy_level, assigned_profile_id, origin_profile_id, ts, updated_at
```

- A **profile reuses the Forge concept** but is its own row (rank + division + wiki_root are Command-Center-specific). Decision: keep `cc_profiles` standalone rather than join onto `agents` — avoids coupling the org chart to Control-Panel agent lifecycle. Brain model + skills are copied/referenced by id.
- **No `cc_agents` fan-out table** — there is no worker tier.
- Missions are tracked as a per-profile list (the Kanban's job, absorbed). No swarm.

### 2.2 The pi engine (the one net-new runtime)

Add a pi engine alongside `cli_engine/codex.rs` / `gemini.rs`, OR a Node SDK sidecar process. **Decision: SDK sidecar** so profiles get real llm-wiki skill + extensions + skills discovery.

- A profile spawns a pi `AgentSession` with: its `brain_model`, its `wiki_root` as cwd/context, its `skill_ids` resolved to instructions, and the Orion tool surface.
- Output transcodes into the existing `claude:event`/`claude:exit` contract (same trick the CLI engines use) so the channel UI streams with zero new event plumbing.
- **[P-SPIKE]** confirm headless pi invocation + llm-wiki skill availability + per-session cwd/vault isolation in a Task-0 capability spike before committing the engine slice (mirror the 2c spike-findings doc).

### 2.3 The delegation protocol (structured messages, not free chat)

Every arrow below is one typed `cc_messages` row; the channel UI is a view over the log.

```
Commander → Mission ──▶ General        (or straight to a Captain)
General   → Plan (divisions·deliverables·deps) ──▶ [approval gate] ──▶ Directives
Directive ──▶ Captain
Captain   → works it itself, serially, in its own pi session
            outputs ──▶ division wiki + activity_log
Captain   → Report ──▶ General
General   → Briefing ──▶ Commander
Cross-division need ──▶ Handoff message (Captain → Captain, logged)
```

### 2.4 Memory — brains that grow

```
command-center/
  org/wiki/                 General's org-wide index · mission history
  divisions/<name>/wiki/    one vault per Captain profile
```

- After a mission, the profile runs `wiki_retro` into its vault. Reusable skills **promote into the Control Panel Skill Library** (any profile can equip them).
- **Obsidian-style graph view** reuses Learn's `forceLayout.ts` + wiki backlinks; per-vault, switchable, with a whole-org union mode.

### 2.5 Autonomy ladder

`0 manual` → `1 approve-each` (default) → `2 auto-within-budget` (token/task ceiling) → `3 full-auto+digest`. Per profile. Same gate pattern as ROSIE/Hermes — a column + a check, not new orchestration.

---

## 3. Surface (channel-first)

- **Left rail:** org tree (Commander · General · Captains by division) + channel list (command, per-division, cross-division, DMs).
- **Center:** active channel — streaming message thread (chat + directive/report/handoff cards rendered distinctly).
- **Right:** selected profile's mission list + memory-vault peek (recent wiki pages) + autonomy control.
- **Graph view:** full-surface toggle, the Obsidian clone over the selected vault / whole org.

---

## 4. Reuse map

| Need | Reuse |
| --- | --- |
| Profile config (persona/model/skills) | Agent Forge / `composeAgent.ts` |
| Run a profile | provider runtime + new pi sidecar; `dispatchSend.ts` routing |
| Streaming into channels | `claude:event`/`claude:exit` contract |
| Cross-app memory / reporting | `activity_log` + Notification Center |
| Approval gating | ROSIE gated-planning pattern |
| Graph view | Learn `forceLayout.ts` |
| Memory vaults | LLM Wiki `wiki_*` tools |

---

## 5. Non-goals / deferrals

- No parallel swarms / operatives (Hermes' model — retired).
- No multi-user. No cloud. Local-first, single Commander.
- Cross-division auto-handoff at autonomy ≥2 is a later slice; v1 routes handoffs through approval.
- Voice command of the org — later.

---

## 6. Open spike before build

- **[P-SPIKE] Task 0:** headless pi via SDK sidecar — confirm session spawn with a chosen model, per-session vault/cwd isolation, llm-wiki skill loads, tool surface attaches, and output can be transcoded to `claude:event`. Record findings doc (mirror `2026-06-18-agent-runtime-2c-spike-findings.md`). Everything downstream depends on this being real.

---

## 7. Phased build (to be ranked into a plan doc on approval)

- **Phase CC-0 — Foundation:** migration 0027 · `cc_profiles`/channels/messages/missions DB layer (TDD pure logic) · read-only org/channel shell (no engine yet) · retire Hermes tile.
- **Phase CC-1 — Pi engine:** Task-0 spike · sidecar · profile→session run · stream into a channel · single-profile chat works end-to-end.
- **Phase CC-2 — Delegation:** mission → General plan → approval gate → directive → Captain run → report → briefing, as typed messages.
- **Phase CC-3 — Memory:** per-profile vaults · `wiki_retro` after missions · skill promotion · Obsidian graph view.
- **Phase CC-4 — Autonomy + polish:** autonomy ladder · budgets · cross-division handoffs · cohesion pass.
