import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    claudeSend: vi.fn().mockResolvedValue(undefined),
    runtimeSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    runtimeCancel: vi.fn().mockResolvedValue(undefined),
    cliSend: vi.fn().mockResolvedValue(undefined),
    cliCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ipc } from "@/lib/ipc";
import { dispatchSend, dispatchCancel } from "./dispatchSend";
import { useProvidersStore } from "@/store/providersStore";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "./seedData";
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
  useProvidersStore.setState({
    providers: [BUILTIN_PROVIDER, openai, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER],
    loaded: true,
  });
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
      [],
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

describe("dispatchSend CLI routing (Phase 2c)", () => {
  it("a codex model routes to cliSend and never claudeSend/runtimeSend", async () => {
    await dispatchSend({
      chatId: "c3", value: "gpt-5.1-codex", prompt: "PROMPT",
      history: [], projectRoot: "/proj", sessionId: "t1",
    });
    expect(ipc.cliSend).toHaveBeenCalledTimes(1);
    expect(ipc.cliSend).toHaveBeenCalledWith(
      "codex_cli", "c3", "PROMPT", "/proj", "t1", "gpt-5.1-codex", "",
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });
  it("a gemini model routes to cliSend with the gemini_cli engine", async () => {
    await dispatchSend({ chatId: "c4", value: "gemini-2.5-pro", prompt: "P", history: [] });
    expect(ipc.cliSend).toHaveBeenCalledWith(
      "gemini_cli", "c4", "P", null, null, "gemini-2.5-pro", "",
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
  });
  it("cancel routes a CLI selection to cliCancel", async () => {
    await dispatchCancel("c3", "gpt-5.1-codex");
    expect(ipc.cliCancel).toHaveBeenCalledWith("c3");
  });
});
