import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/features/agents/agentTypes";
import { ipc } from "@/lib/ipc";
import { invalidateCodexImageStatus, resolveImageProvider } from "./imageProviderRuntime";

vi.mock("@/lib/ipc", () => ({
  ipc: { cliStatus: vi.fn() },
}));

function provider(kind: Provider["kind"], id: string, keyRef = ""): Provider {
  return {
    id,
    name: id,
    kind,
    baseUrl: "",
    models: [],
    keyRef,
    enabled: true,
    builtin: kind === "codex_cli",
  };
}

const cliStatus = vi.mocked(ipc.cliStatus);

beforeEach(() => {
  invalidateCodexImageStatus();
  cliStatus.mockReset();
});

describe("resolveImageProvider", () => {
  it("ignores a late readiness result after disconnect or sign-out", async () => {
    let finish!: (value: Awaited<ReturnType<typeof ipc.cliStatus>>) => void;
    cliStatus.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const providers = [provider("codex_cli", "subscription")];
    const pending = resolveImageProvider(providers);
    invalidateCodexImageStatus();
    finish({ installed: true, loggedIn: true, version: "test", detail: "old", authMode: "chatgpt", subscriptionReady: true, imageReady: true });
    expect(await pending).toBeNull();
    expect(await resolveImageProvider([{ ...providers[0]!, enabled: false }])).toBeNull();
    expect(cliStatus).toHaveBeenCalledTimes(1);
  });
  it("prefers native ChatGPT subscription images when ready", async () => {
    cliStatus.mockResolvedValue({
      installed: true,
      loggedIn: true,
      version: "test",
      detail: "Ready",
      authMode: "chatgpt",
      subscriptionReady: true,
      imageReady: true,
    });
    const result = await resolveImageProvider([
      provider("openai", "api", "key"),
      provider("codex_cli", "subscription"),
    ]);
    expect(result?.id).toBe("subscription");
  });

  it("falls back to an API provider when ChatGPT subscription images are unavailable", async () => {
    cliStatus.mockResolvedValue({
      installed: true,
      loggedIn: true,
      version: "test",
      detail: "API login",
      authMode: "apikey",
      subscriptionReady: false,
      imageReady: false,
    });
    const result = await resolveImageProvider([
      provider("openai", "api", "key"),
      provider("codex_cli", "subscription"),
    ]);
    expect(result?.id).toBe("api");
  });
});
