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

const claudeSend = ipc.claudeSend as ReturnType<typeof vi.fn>;
const claudeCancel = ipc.claudeCancel as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  clearTwoPass("c1");
  useProvidersStore.setState({ providers: [BUILTIN_PROVIDER], loaded: true });
  useAgentsStore.setState({
    agents: new Map([[twoPassAgent.id, twoPassAgent], [soloAgent.id, soloAgent]]),
  } as never);
  useSkillsStore.setState({ skills: new Map() } as never);
});

describe("dispatchAgentTurn single-pass", () => {
  it("a plain model goes straight through dispatchResolved (claudeSend, no entry)", async () => {
    await dispatchAgentTurn({ chatId: "c1", value: "claude-opus-4-8", prompt: "P", history: [] });
    expect(claudeSend).toHaveBeenCalledTimes(1);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("an Action=same-as-brain agent is single-pass (no entry)", async () => {
    await dispatchAgentTurn(
      { chatId: "c1", value: "agent:solo", prompt: "P", history: [] },
      { capturePlan: () => "", nextHistory: () => [] },
    );
    expect(claudeSend).toHaveBeenCalledTimes(1);
    expect(twoPassPhase("c1")).toBeNull();
  });

  it("a two-pass agent WITHOUT hooks falls back to single-pass on the Brain", async () => {
    await dispatchAgentTurn({ chatId: "c1", value: "agent:tp", prompt: "P", history: [] });
    expect(claudeSend).toHaveBeenCalledTimes(1);
    expect(claudeSend.mock.calls[0]![5]).toBe("claude-opus-4-8");
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
    expect(claudeSend).toHaveBeenCalledTimes(1);
    const brain = claudeSend.mock.calls[0]!;
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

    // Action pass: Haiku, tools NOT disabled (null), plan in prompt.
    expect(claudeSend).toHaveBeenCalledTimes(2);
    const action = claudeSend.mock.calls[1]!;
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
    expect(claudeSend).toHaveBeenCalledTimes(1);
    expect(onPassExit("c1", "boom")).toBe(false);
    expect(claudeSend).toHaveBeenCalledTimes(1); // no Action pass
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
    expect(claudeCancel).toHaveBeenCalledWith("c1");
    expect(twoPassPhase("c1")).toBeNull();
    // A late exit now finds no entry → returns false (normal finalize).
    expect(onPassExit("c1", null)).toBe(false);
    expect(claudeSend).toHaveBeenCalledTimes(1);
  });
});
