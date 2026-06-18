# Agent Runtime Phase 3 — Brain → Action Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, batch with checkpoints — per user). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a forged agent has a distinct Action model, run a chat turn as two passes on the same chat — the Brain plans (no tools, streamed as a "Planning" block) then the Action executes the plan with tools — orchestrated entirely on the frontend over the existing `dispatchSend` seam.

**Architecture:** Both passes share the **same rail chatId**, so existing `claude:event`/`claude:exit` streaming renders plan-then-execution into the rail with no new event shapes. A module-level **coordinator** (`twoPassCoordinator.ts`) holds a `Map<chatId, entry>`; the EventBridge `claude:exit` handler consults it before finalizing — on the Brain pass's exit it seals the plan message and fires the Action pass instead of finalizing; on the Action pass's exit the entry clears and the turn finalizes normally. Single-pass turns never create an entry → byte-identical to today. Engine-agnostic: each pass routes independently through `routeFor` via the extracted `dispatchResolved`.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest. Frontend-only — no Rust, no migration, hot-reloads.

## Global Constraints

- **No emoji, ever** — in code, copy, comments, or commit messages.
- **Non-regression is the headline guarantee (test-enforced):** plain model selections and agents whose Action model is empty or equal to Brain route through `dispatchResolved` with **byte-identical** `claudeSend`/`runtimeSend`/`cliSend` IPC args; the existing `dispatchSend.routing.test.ts` stays green unchanged.
- **Additive only:** new types/functions/fields; no existing Rust signature, migration, or event shape changes.
- **The coordinator entry (two-pass flag) is set ONLY on two-pass turns.** A normal single-pass turn finalizes on its single `claude:exit` with no entry created.
- **Two-pass trigger:** engages iff the resolved Action model is non-empty AND differs from the Brain model.
- **v1 surface:** full two-pass + Planning block on the **Orion rail** (`chatStore`) — the validated surface. Archives / XDesign / ROSIE rails are wired to `dispatchAgentTurn` but pass **no two-pass hooks**, so a two-pass agent there runs single-pass on the Brain model exactly as today (explicit v1 deferral; matches spec §9 chat-rails-only framing). No regression on any rail.
- **Gates, every task:** `npx tsc --noEmit` · full `npx vitest run` · `npm run build` (exit 0). No `cargo`. Match Orion styling for the Planning block (label in the agent accent, collapsible).
- **Commits:** commit only the files each task names; end every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- `src/features/agents/dispatchSend.ts` — **modify.** Extract `dispatchResolved`; rewrite `dispatchSend` over it; add `dispatchAgentTurn`; extend `dispatchCancel` for phase-aware routing.
- `src/features/agents/twoPass.ts` — **create.** Pure builders `shouldTwoPass` / `planningSystem` / `executionPrompt`.
- `src/features/agents/twoPassCoordinator.ts` — **create.** Module-level `Map<chatId, entry>` + `beginTwoPass` / `twoPassPhase` / `twoPassValue` / `clearTwoPass` / `onPassExit`.
- `src/features/agents/resolveSend.ts` — **modify.** `ResolvedSend` gains `actionModel`.
- `src/features/agents/composeAgent.ts` — **modify.** `ComposedAgent` gains `actionModel`.
- `src/store/chatStore.ts` — **modify.** `ChatMessage.planning?`; new `sealPlanningTurn()` action.
- `src/app/EventBridge.tsx` — **modify.** `claude:exit` handler consults `onPassExit` before finalizing.
- `src/apps/orion/OrionClaudeRail.tsx` — **modify.** Send via `dispatchAgentTurn` + two-pass hooks; cancel unchanged call shape.
- `src/components/ClaudeChat.tsx` — **modify.** `ClaudeChatMessage.planning?`; collapsible Planning block render.
- `src/features/controlpanel/AgentForge.tsx` — **modify.** Drop the Action "soon" hint; copy + two-pass indicator.

New test files: `twoPass.test.ts`, `twoPassCoordinator.test.ts`, `chatStore.twopass.test.ts`, `dispatchSend.twopass.test.ts`.

---

## Task 1: Extract `dispatchResolved` (byte-identical refactor)

**Files:**
- Modify: `src/features/agents/dispatchSend.ts`
- Test: `src/features/agents/dispatchSend.routing.test.ts` (must stay green; no edits required)

**Interfaces:**
- Produces: `dispatchResolved(chatId: string, r: ResolvedSend, prompt: string, history: RuntimeMsg[], opts: ResolvedDispatchOpts): Promise<void>` where `ResolvedDispatchOpts = { projectRoot?: string | null; sessionId?: string | null; imagePath?: string | null }`.
- `dispatchSend(args: DispatchSendArgs)` becomes `resolveSendFromStores(args.value)` → `dispatchResolved(...)`.

- [ ] **Step 1: Read the current routing body** (`dispatchSend.ts` lines 77–114) so the extracted function preserves the exact branch order and argument lists.

- [ ] **Step 2: Add `ResolvedDispatchOpts` + `dispatchResolved`, rewrite `dispatchSend`**

Replace the body of `dispatchSend` (lines 77–114) with the extraction below. Keep all imports.

```ts
export type ResolvedDispatchOpts = {
  projectRoot?: string | null;
  sessionId?: string | null;
  imagePath?: string | null;
};

/** Route an already-resolved send to the owning engine. Byte-identical IPC
 *  output to the pre-refactor dispatchSend body. */
export async function dispatchResolved(
  chatId: string,
  r: ResolvedSend,
  prompt: string,
  history: RuntimeMsg[],
  opts: ResolvedDispatchOpts,
): Promise<void> {
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, r.model);
  if (route === "claude") {
    return ipc.claudeSend(
      chatId,
      prompt,
      opts.projectRoot ?? null,
      opts.sessionId ?? null,
      opts.imagePath ?? null,
      r.model,
      r.systemAppend,
      r.allowedTools,
    );
  }
  if (typeof route === "object" && "engine" in route) {
    return ipc.cliSend(
      route.engine,
      chatId,
      prompt,
      opts.projectRoot ?? null,
      opts.sessionId ?? null,
      r.model,
      r.systemAppend ?? "",
    );
  }
  return ipc.runtimeSend(
    chatId,
    route.kind,
    route.baseUrl,
    route.keyRef,
    r.model,
    r.systemAppend ?? "",
    history,
    mapToRuntimeTools(r.allowedTools),
  );
}

export async function dispatchSend(args: DispatchSendArgs): Promise<void> {
  const r = resolveSendFromStores(args.value);
  return dispatchResolved(args.chatId, r, args.prompt, args.history, {
    projectRoot: args.projectRoot,
    sessionId: args.sessionId,
    imagePath: args.imagePath,
  });
}
```

`ResolvedSend` must be imported as a type. Add to the top imports if not already present:

```ts
import type { ResolvedSend } from "@/features/agents/resolveSend";
```

(`resolveSendFromStores` is already imported.)

- [ ] **Step 3: Run the existing routing test — must stay green**

Run: `npx vitest run src/features/agents/dispatchSend.routing.test.ts`
Expected: PASS (all cases — Claude byte-identical, runtime, codex/gemini CLI, cancels).

- [ ] **Step 4: Typecheck + full test run + build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/dispatchSend.ts
git commit -m "refactor(runtime-3): extract dispatchResolved (byte-identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Surface `actionModel` on `ComposedAgent` + `ResolvedSend`

**Files:**
- Modify: `src/features/agents/composeAgent.ts`
- Modify: `src/features/agents/resolveSend.ts`
- Test: `src/features/agents/composeAgent.test.ts`, `src/features/agents/resolveSend.test.ts`

**Interfaces:**
- Produces: `ComposedAgent.actionModel: string` (from `agent.actionModel`).
- Produces: `ResolvedSend.actionModel: string | null` — for an agent: `agent.actionModel || null`; for a plain model selection: `null`; for a missing agent (fallback): `null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/agents/composeAgent.test.ts`:

```ts
it("carries the agent's actionModel through", () => {
  const agent = {
    id: "a1", name: "Pilot", role: "", accent: "#fff",
    avatarAssetId: null, avatarUrl: null,
    brainModel: "claude-opus-4-8", actionModel: "claude-haiku-4-5-20251001",
    skillIds: [],
  };
  expect(composeAgent(agent, []).actionModel).toBe("claude-haiku-4-5-20251001");
});

it("actionModel is empty string when the agent has none", () => {
  const agent = {
    id: "a2", name: "Solo", role: "", accent: "#fff",
    avatarAssetId: null, avatarUrl: null,
    brainModel: "claude-opus-4-8", actionModel: "", skillIds: [],
  };
  expect(composeAgent(agent, []).actionModel).toBe("");
});
```

Append to `src/features/agents/resolveSend.test.ts`:

```ts
it("a plain model selection resolves actionModel to null", () => {
  expect(resolveSend("claude-opus-4-8", [], []).actionModel).toBeNull();
});

it("an agent with a distinct action model resolves it", () => {
  const agent = {
    id: "ag1", name: "Pilot", role: "", accent: "#fff",
    avatarAssetId: null, avatarUrl: null,
    brainModel: "claude-opus-4-8", actionModel: "claude-haiku-4-5-20251001",
    skillIds: [],
  };
  const r = resolveSend("agent:ag1", [agent], []);
  expect(r.model).toBe("claude-opus-4-8");
  expect(r.actionModel).toBe("claude-haiku-4-5-20251001");
});

it("an agent with no action model resolves actionModel to null", () => {
  const agent = {
    id: "ag2", name: "Solo", role: "", accent: "#fff",
    avatarAssetId: null, avatarUrl: null,
    brainModel: "claude-opus-4-8", actionModel: "", skillIds: [],
  };
  expect(resolveSend("agent:ag2", [agent], []).actionModel).toBeNull();
});
```

(If `resolveSend.test.ts` does not already import the symbols, match its existing imports — `resolveSend` is the export under test.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/agents/composeAgent.test.ts src/features/agents/resolveSend.test.ts`
Expected: FAIL — `actionModel` is `undefined` / property missing.

- [ ] **Step 3: Implement**

In `src/features/agents/composeAgent.ts`, add `actionModel` to the type and the return:

```ts
export type ComposedAgent = {
  model: string;
  actionModel: string;
  appendSystemPrompt: string;
  allowedTools: string[];
};
```

```ts
  return { model: agent.brainModel, actionModel: agent.actionModel, appendSystemPrompt, allowedTools: [...tools] };
```

In `src/features/agents/resolveSend.ts`, add `actionModel` to the type and all three return sites:

```ts
export type ResolvedSend = {
  model: string;
  actionModel: string | null;
  systemAppend: string | null;
  allowedTools: string[] | null;
};
```

```ts
export function resolveSend(value: string, agents: Agent[], skills: Skill[]): ResolvedSend {
  const sel = parseSelection(value);
  if (sel.kind === "model") {
    return { model: sel.id, actionModel: null, systemAppend: null, allowedTools: null };
  }
  const agent = agents.find((a) => a.id === sel.id);
  if (!agent) return { model: value, actionModel: null, systemAppend: null, allowedTools: null };
  const c = composeAgent(agent, skills);
  return {
    model: c.model,
    actionModel: c.actionModel || null,
    systemAppend: c.appendSystemPrompt || null,
    allowedTools: c.allowedTools.length ? c.allowedTools : null,
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/agents/composeAgent.test.ts src/features/agents/resolveSend.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0. (The routing test already builds a `ResolvedSend` indirectly via `resolveSendFromStores`; the added field is additive.)

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/composeAgent.ts src/features/agents/resolveSend.ts src/features/agents/composeAgent.test.ts src/features/agents/resolveSend.test.ts
git commit -m "feat(runtime-3): surface actionModel on ComposedAgent + ResolvedSend

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pure builders — `shouldTwoPass` / `planningSystem` / `executionPrompt`

**Files:**
- Create: `src/features/agents/twoPass.ts`
- Test: `src/features/agents/twoPass.test.ts`

**Interfaces:**
- Consumes: `ResolvedSend` (Task 2).
- Produces:
  - `shouldTwoPass(r: ResolvedSend): boolean` — true iff `r.actionModel` non-empty AND `r.actionModel !== r.model`.
  - `planningSystem(agentSystemAppend: string | null): string` — agent system + plan-only directive.
  - `executionPrompt(userPrompt: string, plan: string): string` — `"Execute this plan:\n<plan>\n\nOriginal request:\n<userPrompt>"`.

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/twoPass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldTwoPass, planningSystem, executionPrompt } from "./twoPass";
import type { ResolvedSend } from "./resolveSend";

function r(model: string, actionModel: string | null): ResolvedSend {
  return { model, actionModel, systemAppend: null, allowedTools: null };
}

describe("shouldTwoPass", () => {
  it("true when action is non-empty and distinct from brain", () => {
    expect(shouldTwoPass(r("opus", "haiku"))).toBe(true);
  });
  it("false when action equals brain", () => {
    expect(shouldTwoPass(r("opus", "opus"))).toBe(false);
  });
  it("false when action is empty string", () => {
    expect(shouldTwoPass(r("opus", ""))).toBe(false);
  });
  it("false when action is null (plain model)", () => {
    expect(shouldTwoPass(r("opus", null))).toBe(false);
  });
});

describe("planningSystem", () => {
  it("wraps a non-null agent system with the plan-only directive", () => {
    const out = planningSystem("You are Pilot.");
    expect(out).toContain("You are Pilot.");
    expect(out.toLowerCase()).toContain("plan");
    expect(out.toLowerCase()).toContain("do not");
  });
  it("handles a null agent system (directive only)", () => {
    const out = planningSystem(null);
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toContain("plan");
  });
});

describe("executionPrompt", () => {
  it("composes plan + original request in the documented shape", () => {
    expect(executionPrompt("Add a button", "1. open file\n2. edit")).toBe(
      "Execute this plan:\n1. open file\n2. edit\n\nOriginal request:\nAdd a button",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/agents/twoPass.test.ts`
Expected: FAIL — cannot resolve `./twoPass`.

- [ ] **Step 3: Implement**

Create `src/features/agents/twoPass.ts`:

```ts
import type { ResolvedSend } from "./resolveSend";

/** A turn runs two passes iff a distinct Action model is set. */
export function shouldTwoPass(r: ResolvedSend): boolean {
  return !!r.actionModel && r.actionModel !== r.model;
}

const PLAN_DIRECTIVE =
  "Produce a concise, ordered execution plan as numbered steps for the request below. " +
  "Plan only — do not call tools, do not perform the work, do not write code yet. " +
  "Output just the plan.";

/** The Brain pass system prompt: the agent persona + a plan-only directive. */
export function planningSystem(agentSystemAppend: string | null): string {
  return agentSystemAppend
    ? `${agentSystemAppend}\n\n${PLAN_DIRECTIVE}`
    : PLAN_DIRECTIVE;
}

/** The Action pass prompt: the Brain's plan plus the original request. */
export function executionPrompt(userPrompt: string, plan: string): string {
  return `Execute this plan:\n${plan}\n\nOriginal request:\n${userPrompt}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/agents/twoPass.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/twoPass.ts src/features/agents/twoPass.test.ts
git commit -m "feat(runtime-3): pure two-pass builders (shouldTwoPass/planningSystem/executionPrompt)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Two-pass coordinator module

**Files:**
- Create: `src/features/agents/twoPassCoordinator.ts`
- Test: `src/features/agents/twoPassCoordinator.test.ts`

**Interfaces:**
- Produces:
  - `type TwoPassPhase = "plan" | "execute"`
  - `type TwoPassEntry = { phase: TwoPassPhase; value: string; capturePlan: () => string; fireExecute: (plan: string) => void }`
  - `beginTwoPass(chatId: string, entry: TwoPassEntry): void`
  - `twoPassPhase(chatId: string): TwoPassPhase | null`
  - `twoPassValue(chatId: string): string | null`
  - `clearTwoPass(chatId: string): void`
  - `onPassExit(chatId: string, error: string | null): boolean` — returns `true` iff the exit was consumed by the plan→execute handoff (caller must NOT finalize). On an execute-phase exit it clears the entry and returns `false`. On a plan-phase **error** it clears the entry and returns `false` (caller finalizes with the error — turn stops, no Action). On a plan-phase success it captures the plan, flips phase to `execute`, fires the Action pass, and returns `true`.

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/twoPassCoordinator.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  beginTwoPass,
  twoPassPhase,
  twoPassValue,
  clearTwoPass,
  onPassExit,
} from "./twoPassCoordinator";

beforeEach(() => {
  clearTwoPass("c1");
});

describe("twoPassCoordinator", () => {
  it("onPassExit returns false when no entry exists", () => {
    expect(onPassExit("nope", null)).toBe(false);
  });

  it("plan-phase success captures plan, fires execute, flips to execute, consumes the exit", () => {
    const capturePlan = vi.fn(() => "PLAN");
    const fireExecute = vi.fn();
    beginTwoPass("c1", { phase: "plan", value: "agent:a", capturePlan, fireExecute });
    expect(twoPassPhase("c1")).toBe("plan");
    expect(twoPassValue("c1")).toBe("agent:a");

    const consumed = onPassExit("c1", null);
    expect(consumed).toBe(true);
    expect(capturePlan).toHaveBeenCalledTimes(1);
    expect(fireExecute).toHaveBeenCalledWith("PLAN");
    expect(twoPassPhase("c1")).toBe("execute");
  });

  it("execute-phase exit clears the entry and does NOT consume (caller finalizes)", () => {
    beginTwoPass("c1", { phase: "execute", value: "agent:a", capturePlan: () => "", fireExecute: vi.fn() });
    const consumed = onPassExit("c1", null);
    expect(consumed).toBe(false);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("plan-phase error clears the entry, does NOT fire execute, does NOT consume", () => {
    const fireExecute = vi.fn();
    beginTwoPass("c1", { phase: "plan", value: "agent:a", capturePlan: () => "PLAN", fireExecute });
    const consumed = onPassExit("c1", "boom");
    expect(consumed).toBe(false);
    expect(fireExecute).not.toHaveBeenCalled();
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("clearTwoPass removes the entry", () => {
    beginTwoPass("c1", { phase: "plan", value: "v", capturePlan: () => "", fireExecute: vi.fn() });
    clearTwoPass("c1");
    expect(twoPassPhase("c1")).toBeNull();
    expect(twoPassValue("c1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/agents/twoPassCoordinator.test.ts`
Expected: FAIL — cannot resolve `./twoPassCoordinator`.

- [ ] **Step 3: Implement**

Create `src/features/agents/twoPassCoordinator.ts`:

```ts
export type TwoPassPhase = "plan" | "execute";

export type TwoPassEntry = {
  phase: TwoPassPhase;
  /** Raw model-prefs selection value — for phase-aware cancel routing. */
  value: string;
  /** Seal the streamed plan message in the rail store and return its text.
   *  Implemented by the rail; must keep the turn's running flag true. */
  capturePlan: () => string;
  /** Fire the Action pass on the same chatId with the captured plan. */
  fireExecute: (plan: string) => void;
};

/** chatId → in-flight two-pass turn. Module scope so it survives EventBridge
 *  re-mounts and is shared between the orchestrator and the exit handlers. */
const turns = new Map<string, TwoPassEntry>();

export function beginTwoPass(chatId: string, entry: TwoPassEntry): void {
  turns.set(chatId, entry);
}

export function twoPassPhase(chatId: string): TwoPassPhase | null {
  return turns.get(chatId)?.phase ?? null;
}

export function twoPassValue(chatId: string): string | null {
  return turns.get(chatId)?.value ?? null;
}

export function clearTwoPass(chatId: string): void {
  turns.delete(chatId);
}

/** Consult on every rail `claude:exit`. Returns true iff the exit was the
 *  Brain pass and the Action pass was fired (caller must NOT finalize). */
export function onPassExit(chatId: string, error: string | null): boolean {
  const e = turns.get(chatId);
  if (!e) return false;
  if (e.phase === "execute") {
    // Action pass done — let the caller finalize normally.
    turns.delete(chatId);
    return false;
  }
  // Plan phase.
  if (error) {
    // Brain failed — stop the turn; the caller finalizes with the error.
    turns.delete(chatId);
    return false;
  }
  const plan = e.capturePlan();
  e.phase = "execute";
  e.fireExecute(plan);
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/agents/twoPassCoordinator.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/twoPassCoordinator.ts src/features/agents/twoPassCoordinator.test.ts
git commit -m "feat(runtime-3): two-pass coordinator (plan->execute handoff registry)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `chatStore` — `sealPlanningTurn` + `ChatMessage.planning`

**Files:**
- Modify: `src/store/chatStore.ts`
- Test: `src/store/chatStore.twopass.test.ts` (create)

**Interfaces:**
- Produces:
  - `ChatMessage.planning?: boolean`.
  - `sealPlanningTurn(): string` on the store — seals the pending assistant message (`pending: false`, `planning: true`), clears `pendingAssistantId`, **keeps `running` true**, and returns the message's concatenated text. Returns `""` when there is no active chat or no pending message.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Create `src/store/chatStore.twopass.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./chatStore";

beforeEach(() => {
  const s = useChatStore.getState();
  s.newChat(null);
  s.setRunning(false);
});

describe("chatStore non-regression: normal single-pass turn", () => {
  it("finishTurn finalizes on a single exit with no planning flag", () => {
    const s = useChatStore.getState();
    s.appendUserMessage("hi");
    s.setRunning(true);
    s.onAssistantBlocks([{ type: "text", text: "answer" }]);
    s.finishTurn();
    const st = useChatStore.getState();
    expect(st.running).toBe(false);
    expect(st.pendingAssistantId).toBeNull();
    const last = st.active!.messages.at(-1)!;
    expect(last.pending).toBeFalsy();
    expect(last.planning).toBeFalsy();
  });
});

describe("chatStore sealPlanningTurn", () => {
  it("seals the pending message as planning, keeps running, returns its text", () => {
    const s = useChatStore.getState();
    s.appendUserMessage("plan this");
    s.setRunning(true);
    s.onAssistantBlocks([{ type: "text", text: "1. step one\n2. step two" }]);

    const plan = useChatStore.getState().sealPlanningTurn();
    expect(plan).toBe("1. step one\n2. step two");

    const st = useChatStore.getState();
    expect(st.running).toBe(true); // turn continues into the Action pass
    expect(st.pendingAssistantId).toBeNull();
    const planMsg = st.active!.messages.find((m) => m.planning);
    expect(planMsg).toBeTruthy();
    expect(planMsg!.pending).toBeFalsy();

    // A subsequent assistant event opens a NEW message (execution), not the plan.
    useChatStore.getState().onAssistantBlocks([{ type: "text", text: "doing it" }]);
    const after = useChatStore.getState().active!.messages;
    expect(after.filter((m) => m.role === "assistant").length).toBe(2);
  });

  it("returns empty string with no pending message", () => {
    const s = useChatStore.getState();
    s.appendUserMessage("hi");
    expect(useChatStore.getState().sealPlanningTurn()).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/chatStore.twopass.test.ts`
Expected: FAIL — `sealPlanningTurn` is not a function.

- [ ] **Step 3: Implement**

In `src/store/chatStore.ts`:

Add `planning` to `ChatMessage`:

```ts
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  blocks: ContentBlock[];
  createdAt: number;
  pending?: boolean;
  planning?: boolean;
  pills?: MessagePill[];
};
```

Add the method to the `ChatState` type (next to `finishTurn`):

```ts
  finishTurn: () => void;
  sealPlanningTurn: () => string;
```

Add the implementation in the store object (place it right after `finishTurn`):

```ts
  sealPlanningTurn: () => {
    const s = get();
    if (!s.active) return "";
    const id = s.pendingAssistantId;
    if (!id) return "";
    const msg = s.active.messages.find((m) => m.id === id);
    const text = msg
      ? msg.blocks
          .filter((b): b is TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
      : "";
    set({
      pendingAssistantId: null, // running stays true — the Action pass continues
      active: {
        ...s.active,
        messages: s.active.messages.map((m) =>
          m.id === id ? { ...m, pending: false, planning: true } : m,
        ),
        updatedAt: Date.now(),
      },
    });
    return text;
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/chatStore.twopass.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/store/chatStore.ts src/store/chatStore.twopass.test.ts
git commit -m "feat(runtime-3): chatStore sealPlanningTurn + planning message flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `dispatchAgentTurn` orchestrator + phase-aware `dispatchCancel`

**Files:**
- Modify: `src/features/agents/dispatchSend.ts`
- Test: `src/features/agents/dispatchSend.twopass.test.ts` (create)

**Interfaces:**
- Consumes: `dispatchResolved` (Task 1), `shouldTwoPass`/`planningSystem`/`executionPrompt` (Task 3), `beginTwoPass`/`twoPassPhase`/`clearTwoPass` (Task 4), `RuntimeMsg`.
- Produces:
  - `type TwoPassHooks = { capturePlan: () => string; nextHistory: () => RuntimeMsg[]; beginExecute?: () => void }`
  - `dispatchAgentTurn(args: DispatchSendArgs, hooks?: TwoPassHooks): Promise<void>` — single-pass (no hooks or `!shouldTwoPass`) routes through `dispatchResolved` identically to `dispatchSend`; two-pass registers a coordinator entry and fires the Brain pass (tools disabled, `planningSystem`), with `fireExecute` firing the Action pass on the same chatId.
  - `dispatchCancel` extended: during the `execute` phase, route the cancel by the Action model; always `clearTwoPass` first so a cancel never triggers the Action pass.

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/dispatchSend.twopass.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    claudeSend: vi.fn().mockResolvedValue(undefined),
    runtimeSend: vi.fn().mockResolvedValue(undefined),
    cliSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    runtimeCancel: vi.fn().mockResolvedValue(undefined),
    cliCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ipc } from "@/lib/ipc";
import { dispatchAgentTurn, dispatchCancel } from "./dispatchSend";
import { onPassExit, twoPassPhase, clearTwoPass } from "./twoPassCoordinator";
import { useProvidersStore } from "@/store/providersStore";
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";
import { BUILTIN_PROVIDER } from "./seedData";
import type { Agent } from "./agentTypes";

const twoPassAgent: Agent = {
  id: "tp", name: "Planner", role: "", accent: "#fff",
  avatarAssetId: null, avatarUrl: null,
  brainModel: "claude-opus-4-8", actionModel: "claude-haiku-4-5-20251001",
  skillIds: [],
};
const soloAgent: Agent = {
  id: "solo", name: "Solo", role: "", accent: "#fff",
  avatarAssetId: null, avatarUrl: null,
  brainModel: "claude-opus-4-8", actionModel: "", skillIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  clearTwoPass("c1");
  useProvidersStore.setState({ providers: [BUILTIN_PROVIDER], loaded: true });
  useAgentsStore.setState({ agents: new Map([[twoPassAgent.id, twoPassAgent], [soloAgent.id, soloAgent]]) } as never);
  useSkillsStore.setState({ skills: new Map() } as never);
});

describe("dispatchAgentTurn single-pass", () => {
  it("a plain model goes straight through dispatchResolved (claudeSend, no entry)", async () => {
    await dispatchAgentTurn({ chatId: "c1", value: "claude-opus-4-8", prompt: "P", history: [] });
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("an Action=same-as-brain agent is single-pass (no entry)", async () => {
    await dispatchAgentTurn(
      { chatId: "c1", value: "agent:solo", prompt: "P", history: [] },
      { capturePlan: () => "", nextHistory: () => [] },
    );
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("a two-pass agent WITHOUT hooks falls back to single-pass on the Brain", async () => {
    await dispatchAgentTurn({ chatId: "c1", value: "agent:tp", prompt: "P", history: [] });
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    // Brain model, no tools-disabling, no entry.
    expect(ipc.claudeSend.mock.calls[0][5]).toBe("claude-opus-4-8");
    expect(twoPassPhase("c1")).toBeNull();
  });
});

describe("dispatchAgentTurn two-pass sequencing", () => {
  it("fires Brain (tools disabled) first; on Brain exit fires Action with the plan; finalizes only on the Action exit", async () => {
    const capturePlan = vi.fn(() => "1. do x");
    await dispatchAgentTurn(
      { chatId: "c1", value: "agent:tp", prompt: "Add a thing", history: [], projectRoot: "/p", sessionId: "s" },
      { capturePlan, nextHistory: () => [] },
    );

    // Brain pass: Opus, planning system, allowedTools = [].
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    const brain = ipc.claudeSend.mock.calls[0];
    expect(brain[5]).toBe("claude-opus-4-8");       // model
    expect(brain[1]).toBe("Add a thing");           // prompt = user prompt
    expect(brain[7]).toEqual([]);                   // allowedTools disabled
    expect(typeof brain[6]).toBe("string");         // planning system present
    expect((brain[6] as string).toLowerCase()).toContain("plan");
    expect(twoPassPhase("c1")).toBe("plan");

    // Simulate the Brain pass exit (no error) → coordinator fires Action.
    const consumed = onPassExit("c1", null);
    expect(consumed).toBe(true);
    expect(capturePlan).toHaveBeenCalledTimes(1);
    expect(twoPassPhase("c1")).toBe("execute");

    // Action pass: Haiku, tools NOT disabled (null → builtin agent tools), plan in prompt.
    expect(ipc.claudeSend).toHaveBeenCalledTimes(2);
    const action = ipc.claudeSend.mock.calls[1];
    expect(action[5]).toBe("claude-haiku-4-5-20251001"); // action model
    expect(action[1]).toContain("Execute this plan:");
    expect(action[1]).toContain("1. do x");
    expect(action[1]).toContain("Add a thing");

    // The Action pass exit clears the entry (caller then finalizes).
    expect(onPassExit("c1", null)).toBe(false);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("a Brain-pass error stops the turn: no Action pass", async () => {
    await dispatchAgentTurn(
      { chatId: "c1", value: "agent:tp", prompt: "X", history: [] },
      { capturePlan: () => "P", nextHistory: () => [] },
    );
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    expect(onPassExit("c1", "boom")).toBe(false);
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1); // no Action pass
    expect(twoPassPhase("c1")).toBeNull();
  });
});

describe("dispatchCancel phase-aware", () => {
  it("clears the entry and cancels (cancel during plan never fires Action)", async () => {
    await dispatchAgentTurn(
      { chatId: "c1", value: "agent:tp", prompt: "X", history: [] },
      { capturePlan: () => "P", nextHistory: () => [] },
    );
    await dispatchCancel("c1", "agent:tp");
    expect(ipc.claudeCancel).toHaveBeenCalledWith("c1");
    expect(twoPassPhase("c1")).toBeNull();
    // A late exit now finds no entry → returns false (normal finalize).
    expect(onPassExit("c1", null)).toBe(false);
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/agents/dispatchSend.twopass.test.ts`
Expected: FAIL — `dispatchAgentTurn` is not exported.

- [ ] **Step 3: Implement**

In `src/features/agents/dispatchSend.ts`:

Add imports near the top (after the existing imports):

```ts
import { shouldTwoPass, planningSystem, executionPrompt } from "./twoPass";
import {
  beginTwoPass,
  twoPassPhase,
  clearTwoPass,
} from "./twoPassCoordinator";
```

Add the orchestrator (place it after `dispatchSend`):

```ts
export type TwoPassHooks = {
  /** Seal the streamed plan message in the rail store and return its text. */
  capturePlan: () => string;
  /** Fresh runtime history (incl. the plan) for a runtime Action pass. */
  nextHistory: () => RuntimeMsg[];
  /** Rail-specific prep before the Action pass streams (e.g. open a new
   *  assistant message). Not needed for chatStore — it opens lazily. */
  beginExecute?: () => void;
};

/** A chat-turn dispatch that may split into Brain(plan) -> Action(execute).
 *  Without hooks, or for a single-pass selection, this is identical to
 *  dispatchSend. */
export async function dispatchAgentTurn(
  args: DispatchSendArgs,
  hooks?: TwoPassHooks,
): Promise<void> {
  const resolved = resolveSendFromStores(args.value);
  const opts: ResolvedDispatchOpts = {
    projectRoot: args.projectRoot,
    sessionId: args.sessionId,
    imagePath: args.imagePath,
  };
  if (!hooks || !shouldTwoPass(resolved)) {
    return dispatchResolved(args.chatId, resolved, args.prompt, args.history, opts);
  }

  const userPrompt = args.prompt;
  const actionModel = resolved.actionModel as string; // non-null by shouldTwoPass

  beginTwoPass(args.chatId, {
    phase: "plan",
    value: args.value,
    capturePlan: hooks.capturePlan,
    fireExecute: (plan) => {
      hooks.beginExecute?.();
      const action: ResolvedSend = {
        model: actionModel,
        actionModel: null,
        systemAppend: resolved.systemAppend,
        allowedTools: resolved.allowedTools,
      };
      const prompt = executionPrompt(userPrompt, plan);
      // Claude/CLI read `prompt`; the runtime reads `history` — give the
      // runtime an explicit execute turn so the plan rides along either way.
      const history: RuntimeMsg[] = [
        ...hooks.nextHistory(),
        { role: "user", content: prompt },
      ];
      void dispatchResolved(args.chatId, action, prompt, history, opts);
    },
  });

  const brain: ResolvedSend = {
    model: resolved.model,
    actionModel: null,
    systemAppend: planningSystem(resolved.systemAppend),
    allowedTools: [],
  };
  return dispatchResolved(args.chatId, brain, userPrompt, args.history, opts);
}
```

Replace `dispatchCancel` with the phase-aware version:

```ts
export async function dispatchCancel(chatId: string, value: string): Promise<void> {
  const phase = twoPassPhase(chatId);
  // A cancel ends the whole two-pass turn — drop the entry so the killed
  // subprocess's exit never triggers the Action pass.
  clearTwoPass(chatId);
  const r = resolveSendFromStores(value);
  const model = phase === "execute" && r.actionModel ? r.actionModel : r.model;
  const providers = useProvidersStore.getState().providers;
  const route = routeFor(providers, model);
  if (route === "claude") return ipc.claudeCancel(chatId);
  if (typeof route === "object" && "engine" in route) return ipc.cliCancel(chatId);
  return ipc.runtimeCancel(chatId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/agents/dispatchSend.twopass.test.ts src/features/agents/dispatchSend.routing.test.ts`
Expected: PASS — both the new sequencing test and the unchanged routing test.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/dispatchSend.ts src/features/agents/dispatchSend.twopass.test.ts
git commit -m "feat(runtime-3): dispatchAgentTurn orchestrator + phase-aware dispatchCancel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire EventBridge exit handler + Orion rail

**Files:**
- Modify: `src/app/EventBridge.tsx` (the `claude:exit` listener, lines ~701–724)
- Modify: `src/apps/orion/OrionClaudeRail.tsx` (`handleSend` send call)

**Interfaces:**
- Consumes: `onPassExit` (Task 4), `dispatchAgentTurn` + `TwoPassHooks` (Task 6), `useChatStore.sealPlanningTurn` (Task 5), `toRuntimeHistory` (existing).
- Produces: no new exports. Behavior: the Orion rail's two-pass turn is coordinated end-to-end.

- [ ] **Step 1: EventBridge — consult the coordinator before finalizing the Orion path**

In `src/app/EventBridge.tsx`, add the import near the other agent imports:

```ts
import { onPassExit } from "@/features/agents/twoPassCoordinator";
```

In the `claude:exit` listener, the Orion-path tail currently reads:

```ts
        const store = useChatStore.getState();
        if (!store.active || store.active.id !== e.payload.chatId) return;
        store.finishTurn();
        store.setRunning(false);
        if (e.payload.error) log.warn("[claude exit]", e.payload.error);
```

Replace it with:

```ts
        const store = useChatStore.getState();
        if (!store.active || store.active.id !== e.payload.chatId) return;
        // Two-pass agent? On the Brain pass's exit this seals the plan and
        // fires the Action pass — do NOT finalize. The Action pass's exit (or
        // a single-pass turn) falls through to the normal finalize below.
        if (onPassExit(e.payload.chatId, e.payload.error)) return;
        store.finishTurn();
        store.setRunning(false);
        if (e.payload.error) log.warn("[claude exit]", e.payload.error);
```

(Leave the app-chat branch above it untouched — Archives/XDesign pass no hooks, so `onPassExit` would no-op there; not wired in v1.)

- [ ] **Step 2: Orion rail — send via `dispatchAgentTurn` with two-pass hooks**

In `src/apps/orion/OrionClaudeRail.tsx`, update the import on line 9:

```ts
import { dispatchAgentTurn, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
```

Replace the `dispatchSend({...})` call inside `handleSend` (lines 134–142) with:

```ts
      await dispatchAgentTurn(
        {
          chatId: chat.id,
          value: useModelPrefs.getState().modelFor("orion"),
          prompt,
          history: toRuntimeHistory(useChatStore.getState().active?.messages ?? []),
          projectRoot: project.root_path,
          sessionId: chat.sessionId,
          imagePath: null,
        },
        {
          capturePlan: () => useChatStore.getState().sealPlanningTurn(),
          nextHistory: () =>
            toRuntimeHistory(useChatStore.getState().active?.messages ?? []),
        },
      );
```

(`cancel` already calls `dispatchCancel(active.id, …)` — unchanged; it now reads the coordinator phase.)

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0. (No new test here — sequencing is covered by Task 6's mocked-IPC test; the event-driven wiring ends at the Section 8 smoke checklist.)

- [ ] **Step 4: Commit**

```bash
git add src/app/EventBridge.tsx src/apps/orion/OrionClaudeRail.tsx
git commit -m "feat(runtime-3): wire two-pass coordination into EventBridge + Orion rail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Planning block UI in ClaudeChat

**Files:**
- Modify: `src/components/ClaudeChat.tsx`
- Modify: `src/apps/orion/OrionClaudeRail.tsx` (pass `planning` through the message map)

**Interfaces:**
- Consumes: `ChatMessage.planning` (Task 5).
- Produces: `ClaudeChatMessage.planning?: boolean`; a collapsible "Planning" block rendered in the agent accent.

- [ ] **Step 1: Extend the message type + render a collapsible Planning block**

In `src/components/ClaudeChat.tsx`, add `planning` to `ClaudeChatMessage`:

```ts
export type ClaudeChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: ReactNode | string;
  pending?: boolean;
  planning?: boolean;
  pills?: ClaudeChatPill[];
};
```

Add this small component above `ClaudeChat` (after `MessageBody`):

```tsx
function PlanningBlock({
  content,
  accent,
}: {
  content: ReactNode | string;
  accent: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ot-plan-block" style={{ borderColor: `${accent}40` }}>
      <button
        type="button"
        className="ot-plan-head"
        style={{ color: accent }}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={12} />
        <span>Planning</span>
        <span className="ot-plan-caret">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="ot-plan-body">
          <MessageBody content={content} />
        </div>
      )}
    </div>
  );
}
```

In the `messages.map(...)` render (the `<div className={\`ot-msg ${m.role}...\`}>` block), replace the `<MessageBody content={m.content} />` line with a planning-aware branch:

```tsx
              {m.planning ? (
                <PlanningBlock content={m.content} accent={accentColor} />
              ) : (
                <MessageBody content={m.content} />
              )}
```

- [ ] **Step 2: Style the Planning block**

Append to the Orion/ClaudeChat stylesheet — locate the file that defines `.ot-msg` / `.ot-claude-rail` (search `grep -rln "ot-claude-rail" src/styles`) and add at the end:

```css
.ot-plan-block {
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--r-sm);
  background: rgba(255, 255, 255, 0.02);
  margin: 2px 0;
  overflow: hidden;
}
.ot-plan-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: 0;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  font-family: var(--font-mono, monospace);
}
.ot-plan-caret { margin-left: auto; opacity: 0.7; }
.ot-plan-body { padding: 0 10px 8px; }
.ot-plan-body p:first-child { margin-top: 0; }
```

(If no `src/styles/*.css` matches, the rules belong in the same file that styles `.ot-msg` — use the grep to find it; do not invent a new stylesheet import.)

- [ ] **Step 3: Orion rail — pass `planning` through the message map**

In `src/apps/orion/OrionClaudeRail.tsx`, in the `messages` `useMemo` map (lines 91–97), add the `planning` field:

```ts
    return active.messages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: blocksToText(m) || (m.pending ? "…" : ""),
      pending: m.pending,
      planning: m.planning,
      pills: m.pills,
    }));
```

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ClaudeChat.tsx src/apps/orion/OrionClaudeRail.tsx src/styles
git commit -m "feat(runtime-3): collapsible Planning block in the chat rail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Adjust the `git add` path to the exact stylesheet file the grep found, if it is not under `src/styles`.)

---

## Task 9: Forge UI — activate the Action slot

**Files:**
- Modify: `src/features/controlpanel/AgentForge.tsx`

**Interfaces:**
- Consumes: nothing new (`brainModel`/`actionModel` already persisted).
- Produces: UI only — the Action slot drops "soon", reads "Action · runs the plan", and the summary shows a "two-pass" indicator when `actionModel` is set and differs from `brainModel`.

- [ ] **Step 1: Update the Action slot copy (drop "soon")**

In `src/features/controlpanel/AgentForge.tsx`, line 94 currently:

```tsx
            <div className="forge-slot-label"><Zap size={13} strokeWidth={2} /> Action · does <span className="forge-hint">soon</span></div>
```

Replace with:

```tsx
            <div className="forge-slot-label"><Zap size={13} strokeWidth={2} /> Action · runs the plan</div>
```

- [ ] **Step 2: Add a two-pass indicator to the summary line**

Line 123 currently:

```tsx
        <div className="forge-summary">Brain <b>{short(draft.brainModel)}</b> · Action <b>{short(draft.actionModel || draft.brainModel)}</b> · <b>{draft.skillIds.length}</b> skills</div>
```

Replace with:

```tsx
        <div className="forge-summary">
          Brain <b>{short(draft.brainModel)}</b> · Action <b>{short(draft.actionModel || draft.brainModel)}</b> · <b>{draft.skillIds.length}</b> skills
          {draft.actionModel && draft.actionModel !== draft.brainModel ? (
            <span className="forge-twopass"> · two-pass</span>
          ) : null}
        </div>
```

- [ ] **Step 3: Style the indicator**

Find the Forge stylesheet (`grep -rln "forge-summary" src/styles src`) and add near the `.forge-summary` rule:

```css
.forge-twopass {
  color: var(--neon-violet);
  font-weight: 600;
}
```

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0.

- [ ] **Step 5: Commit**

Include the carried Forge provider-filter fix (`builtin` → `enabled`, already in the working tree on line 67) in this commit since it lives in the same file.

```bash
git add src/features/controlpanel/AgentForge.tsx src/styles
git commit -m "feat(runtime-3): activate the Agent Forge Action slot (two-pass)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Adjust the `git add` stylesheet path to whatever the grep found.)

---

## Final verification

- [ ] **Run all gates one last time**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all exit 0; new tests present (`twoPass`, `twoPassCoordinator`, `chatStore.twopass`, `dispatchSend.twopass`) and the unchanged `dispatchSend.routing` green.

- [ ] **Confirm no Rust / migration touched**

Run: `git diff --name-only main...HEAD | grep -E "src-tauri|migrations" || echo "clean: no Rust/migration changes"`
Expected: `clean: no Rust/migration changes`.

---

## User smoke checklist (after `tauri dev` reload — no restart needed; frontend hot-reloads)

1. Forge an agent: Brain = a strong model, Action = a different/faster model, equip an editing skill. The Forge summary shows "two-pass" in violet. Select it in the **Orion** rail; ask for a small code change. Confirm: a **Planning** block appears (collapsible, accent header), then execution streams below and proposes an edit landing in DiffReview.
2. Forge an agent with Action = "same as brain"; confirm a single normal turn (no Planning block).
3. Select a plain Claude model and a plain runtime model; confirm both are unchanged single-pass turns.
4. Mixed-engine pair (Claude brain + a runtime action model, and vice-versa); confirm both phases stream.
5. Start a two-pass turn and cancel during the Planning block; confirm it stops without executing.

## v1 deferrals (explicit)

- Two-pass on the **Archives / XDesign / ROSIE** rails: they call the runtime via heterogeneous stores (and ROSIE owns a per-turn exit listener). v1 leaves them single-pass on the Brain for two-pass agents (byte-identical to today). Wiring their stores' `capturePlan`/`beginExecute` adapters is a clean follow-up.
- Everything in spec §9 (Option B orchestration, multi-round re-planning, inline-edit/Hermes/Learn surfaces, per-pass cost UI).
