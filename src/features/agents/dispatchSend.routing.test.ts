import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    claudeSend: vi.fn().mockResolvedValue(undefined),
    runtimeSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    runtimeCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ipc } from "@/lib/ipc";
import { dispatchSend, dispatchCancel } from "./dispatchSend";
import { useProvidersStore } from "@/store/providersStore";
import { BUILTIN_PROVIDER } from "./seedData";
import type { Provider } from "./agentTypes";

const openai: Provider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: [{ id: "gpt-4o", label: "GPT-4o" }],
  keyRef: "p1",
  enabled: true,
  builtin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useProvidersStore.setState({ providers: [BUILTIN_PROVIDER, openai], loaded: true });
});

describe("dispatchSend routing", () => {
  it("a Claude model calls claudeSend with byte-identical args and never runtimeSend", async () => {
    await dispatchSend({
      chatId: "c1",
      value: "claude-opus-4-8",
      prompt: "PROMPT",
      history: [{ role: "user", content: "hi" }],
      projectRoot: "/proj",
      sessionId: "sess",
      imagePath: "/snap.png",
    });
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    expect(ipc.claudeSend).toHaveBeenCalledWith(
      "c1",
      "PROMPT",
      "/proj",
      "sess",
      "/snap.png",
      "claude-opus-4-8",
      null,
      null,
    );
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });

  it("a provider model calls runtimeSend with mapped args and never claudeSend", async () => {
    await dispatchSend({
      chatId: "c2",
      value: "gpt-4o",
      prompt: "PROMPT",
      history: [{ role: "user", content: "hi" }],
    });
    expect(ipc.runtimeSend).toHaveBeenCalledTimes(1);
    expect(ipc.runtimeSend).toHaveBeenCalledWith(
      "c2",
      "openai",
      "https://api.openai.com/v1",
      "p1",
      "gpt-4o",
      "",
      [{ role: "user", content: "hi" }],
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
  });

  it("cancel routes to the owning engine", async () => {
    await dispatchCancel("c1", "claude-opus-4-8");
    expect(ipc.claudeCancel).toHaveBeenCalledWith("c1");
    await dispatchCancel("c2", "gpt-4o");
    expect(ipc.runtimeCancel).toHaveBeenCalledWith("c2");
  });
});
