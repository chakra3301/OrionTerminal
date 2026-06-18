# Provider-Agnostic Agent Runtime — Phase 3 (Brain → Action Routing) Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Builds on:** Phase 1 (Agent Forge: agents carry `brainModel` + `actionModel`), Phase 2a/2b (HTTP runtime + tools, emits `claude:event`), and the Claude CLI path — all on branch `feat/control-panel-agent-forge`. Phase 2c (subscription CLI engines) is independent; Phase 3 works over whatever engines exist and gains 2c's engines for free once they land.

---

## 1. What this is

The Agent Forge already lets a user pick a **Brain** model and an **Action** model per agent, but only the Brain runs today — the Action slot is shown and stored but unused (its UI even says "soon"). Phase 3 wires up the **literal two-model split** from the original vision ("Sonnet thinks, Haiku does"): a **planner/executor** pass where the Brain plans and the Action executes.

### Locked decisions

- **Cooperation model: Plan → Execute.** Brain produces a plan (no tools); Action runs the agentic tool loop to carry it out. One reasoning pass + cheap execution rounds. (Deferred alternative: Brain-orchestrates-Action-as-subtasks.)
- **Trigger: only agents with a distinct Action model.** Two-pass engages iff a forged agent's `actionModel` is non-empty **and** differs from its `brainModel`. Plain model picks and agents with Action = "same as brain" stay single-pass — byte-identical to today. Opt-in via the Forge.
- **Engine-agnostic.** Each pass routes independently via `routeFor`, so Brain and Action can be different engines (e.g. Claude brain + Nemotron action, or a runtime brain + Claude action).
- **Frontend orchestration, no Rust.** Built over the existing `dispatchSend` seam + the shared `claude:event`/`claude:exit` stream. No new Rust, no migration → hot-reloads (but it touches `chatStore`, a core store, so handle with care).
- **Non-regression:** the single-pass path is byte-identical; only distinct-Action-model agents take the new path.

---

## 2. The Plan → Execute flow

On a chat turn for a two-pass agent, on the **same chatId**:

1. **Plan (Brain).** Run the Brain model with the agent's persona + skill instructions plus a planning directive: *"Produce a concise, ordered execution plan as numbered steps. Do not call tools or perform the work yet."* **Tools disabled** (`allowedTools: []`). Output streams live into the chat as a distinct **Planning** block.
2. **Execute (Action).** Run the Action model with the agent's normal system prompt + equipped tools, with the Brain's plan injected as context. It runs the agentic tool loop (edits via `orion_apply_edit`, search, MCP tools, etc.) and produces the final answer, streaming exactly as a turn does today.

The result in the rail: `[you] → [Planning: …] → [execution: tool steps + final answer]`.

---

## 3. The seam — pure logic + a thin orchestrator

### 3.1 Refactor `dispatchSend` (non-regressive)

Extract the routing body of [dispatchSend.ts](../../../src/features/agents/dispatchSend.ts) (lines 74–97) into:

```ts
// runs routeFor → claudeSend / runtimeSend for an explicit resolved object
dispatchResolved(chatId, resolved: ResolvedSend, prompt, history, opts): Promise<void>
```

`dispatchSend(args)` becomes `resolveSendFromStores(args.value) → dispatchResolved(...)` — **byte-identical IPC output**. The existing `dispatchSend.routing.test` stays green (Claude selection → `claudeSend` with identical args; runtime selection → `runtimeSend`, never the other).

### 3.2 Surface the Action model

Extend the resolver types (additive — null for plain models and single-model agents):

- `ComposedAgent` ([composeAgent.ts](../../../src/features/agents/composeAgent.ts)) gains `actionModel: string` (from `agent.actionModel`).
- `ResolvedSend` ([resolveSend.ts](../../../src/features/agents/resolveSend.ts)) gains `actionModel: string | null`. For an agent, `model = brainModel`, `actionModel = agent.actionModel || null`. For a plain model selection, `actionModel = null`.

### 3.3 Pure builders (unit-tested)

```ts
shouldTwoPass(r: ResolvedSend): boolean
  // true iff r.actionModel is non-empty AND r.actionModel !== r.model
planningSystem(agentSystemAppend: string | null): string
  // agentSystemAppend + the planning directive (plan-only, no tools)
executionPrompt(userPrompt: string, plan: string): string
  // "Execute this plan:\n<plan>\n\nOriginal request:\n<userPrompt>"
```

### 3.4 The orchestrator

```ts
dispatchAgentTurn(args: DispatchSendArgs): Promise<void>
```

- Resolves the agent. If `!shouldTwoPass(resolved)` → `dispatchResolved` with the single resolved object (**== today's `dispatchSend`, byte-identical**) and return.
- If two-pass → run Section 4's orchestration.

Two explicit resolved objects are built:
- **Brain/plan pass:** `{ model: resolved.model, systemAppend: planningSystem(resolved.systemAppend), allowedTools: [] }`, prompt = the user prompt.
- **Action/exec pass:** `{ model: resolved.actionModel, systemAppend: resolved.systemAppend, allowedTools: resolved.allowedTools }`, prompt = `executionPrompt(userPrompt, plan)`.

Each pass calls `dispatchResolved`, which routes via `routeFor` independently → engine-agnostic.

The chat rails call `dispatchAgentTurn` in place of `dispatchSend`; `dispatchCancel` is extended to cancel whichever pass is active (Section 4).

---

## 4. Turn coordination + UX

The two passes are one logical turn but emit two `claude:exit`s. Coordination keeps the chat's running-state correct:

- A small **orchestration flag** on the chat (in `chatStore`, keyed by chatId) marks "two-pass turn active," recording the phase (`plan` | `execute`) and the active engine for cancel.
- On the **Brain pass's** `claude:exit`: the turn is **not** finalized. The orchestrator reads the Brain message's streamed text (the plan) from `chatStore`, builds the execution prompt/context, sets phase = `execute`, and fires the **Action pass**.
- On the **Action pass's** `claude:exit`: the flag clears and the turn finalizes normally (the existing end-of-turn path runs unchanged).
- **Normal (single-pass) turns never set the flag** → the existing `claude:exit` handling is identical. This is the non-regression guarantee at the store level.

**Plan capture is engine-agnostic:** the plan is the Brain assistant message's text in `chatStore`. For a runtime Action pass it rides along in `toRuntimeHistory`; for a Claude Action pass it's injected via `executionPrompt`. (Brain and Action are independent sends — no session is resumed across them; the plan is the handoff.)

**Errors / cancel:**
- A Brain-pass `claude:exit` carrying an error (or stderr-only failure) surfaces the error and **stops the turn** — no Action pass; flag cleared.
- A cancel during the Brain phase stops there (no Action pass); a cancel during Execute behaves like today. `dispatchCancel` routes the cancel to the active pass's engine (it reads the flag's phase + the corresponding model's route).

**UX:** the Planning block is visually distinct — a labeled "Planning" header in the agent's accent, collapsible, rendered from the Brain pass's streamed text. Execution streams below it as normal tool_use/result/text. `EventBridge`/`chatStore` event shapes are unchanged; only the turn-spanning coordination + the planning-block label are added.

---

## 5. Forge UI

- The Action slot in [AgentForge.tsx](../../../src/features/controlpanel/AgentForge.tsx) drops the "soon" hint; selecting an Action model that differs from Brain now activates two-pass. Label copy clarifies: *"Action · runs the plan."*
- The forge summary line already shows `Brain … · Action …`; keep it. Optionally surface a small "two-pass" indicator when `actionModel` differs from `brainModel`.
- No change to how agents are saved (`brainModel`/`actionModel` already persisted from Phase 1).

---

## 6. Testing & non-regression

**Pure-logic TDD (network-free):**
- `shouldTwoPass` — distinct action → true; empty action → false; action == brain → false; plain model → false.
- `planningSystem` — wraps the agent system + plan-only directive; null system handled.
- `executionPrompt` — plan + original request composed in the documented shape.
- `ResolvedSend`/`ComposedAgent` `actionModel` population — agent sets it; plain model → null.
- `dispatchResolved` / `dispatchSend` equivalence — `dispatchSend` produces the same `claudeSend`/`runtimeSend` calls as before the refactor (extend the existing routing test).

**Sequencing (integration-shaped):**
- A focused test that, given a two-pass agent, asserts: Brain pass fires first with tools disabled on the Brain model/engine; on its simulated `claude:exit` the Action pass fires on the Action model/engine with tools + the plan in context; the turn finalizes only on the second exit. Mock the IPC + emit synthetic `claude:exit`s. Where full event simulation is impractical, this ends at the user smoke checklist (Section 8).

**Non-regression (headline, test-enforced):**
- Single-pass: plain models + "same as brain" agents route through `dispatchResolved` with byte-identical IPC args; `dispatchSend.routing.test` green.
- `chatStore`: the orchestration flag is only set on two-pass turns; single-pass `claude:exit` handling is unchanged (a store test asserts a normal turn finalizes on its single exit with no flag).
- Additive types/functions only; no Rust, no migration.

**Gates:** `npx tsc --noEmit` · full `npx vitest run` · `npm run build` exit 0. (No `cargo` change.) Frontend-only → hot-reloads; **no `tauri dev` restart required**. UI is human-verified after reload (agent can't run Tauri).

---

## 7. Success criteria

1. A forged agent with **Brain = Sonnet, Action = Haiku** (or any distinct pair) runs a turn that shows a **Planning** block from the Brain, then an **execution** phase from the Action that calls tools / makes edits and answers.
2. **Mixed engines work:** Claude brain + a runtime (e.g. Nemotron) action, and vice-versa, both complete a turn.
3. The Action pass's edits land in the **same Accept/Reject DiffReview** as a single-model agent's (it's the same tool path).
4. An agent with **Action = "same as brain"** (or a plain model selection) behaves **byte-identically** to today — single pass, one assistant turn, no planning block.
5. Cancel during planning stops the turn cleanly (no execution); cancel during execution behaves as today.
6. All gates green; user smoke-tests after reload.

---

## 8. User smoke checklist (after reload)

1. Forge an agent: Brain = a strong model, Action = a different/faster model, equip an editing skill. Select it in the Orion rail; ask it to make a small code change. Confirm: Planning block appears (Brain), then execution runs tools and proposes an edit landing in DiffReview.
2. Forge an agent with Action = "same as brain"; confirm a single normal turn (no planning block) — unchanged.
3. Select a plain Claude model and a plain runtime model; confirm both are unchanged single-pass turns.
4. Try a mixed-engine pair (Claude brain + runtime action); confirm both phases stream.
5. Start a two-pass turn and cancel during the Planning block; confirm it stops without executing.

---

## 9. Explicit deferrals

- **Option B** (Brain orchestrates, Action executes subtasks as a sub-agent loop).
- **Multi-round re-planning** / per-step model routing / Brain reviewing Action's result.
- Brain→Action inside **⌘K inline-edit**, **Hermes** swarms, **Learn/RepoLens** one-shots — chat rails only in v1.
- 2c subscription-CLI engines as brain/action work automatically once 2c lands; no extra Phase 3 work.
- Per-pass cost breakdown in the UI (the rail's existing cost handling applies to the Action pass's `result`).
