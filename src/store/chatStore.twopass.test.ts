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
