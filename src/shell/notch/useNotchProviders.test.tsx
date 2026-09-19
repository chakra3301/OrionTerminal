import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/features/agents/agentTypes";
const api = vi.hoisted(() => ({ claudeStatus: vi.fn(), cliStatus: vi.fn(), cursorStatus: vi.fn(), providerKeyStatus: vi.fn(), nousOauthStatus: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: api }));
import { providerConnected, useNotchProviders } from "./useNotchProviders";
const provider = (kind: Provider["kind"], enabled = true): Provider => ({ id: kind, kind, enabled, name: kind, keyRef: "", baseUrl: "", models: [], builtin: true });
let host: HTMLDivElement;
let root: Root;
let current: Provider[];
function Probe({ providers }: { providers: Provider[] }) {
  current = useNotchProviders(providers, true);
  return <>{current.map(p => p.kind).join(",")}</>;
}
const render = (providers: Provider[]) => act(async () => root.render(<Probe providers={providers} />));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); current = [];
  Object.values(api).forEach(mock => mock.mockReset());
  api.claudeStatus.mockResolvedValue({ loggedIn: true });
  api.cliStatus.mockImplementation(async engine => ({ loggedIn: engine === "codex_cli", subscriptionReady: engine === "codex_cli" }));
  api.cursorStatus.mockResolvedValue({ ready: false });
  api.providerKeyStatus.mockResolvedValue(false);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("notch follows Orion provider connections", () => {
  it("shows only Claude and Codex when Gemini and Cursor are unused, even though seeds are enabled", async () => {
    await render([provider("anthropic"), provider("codex_cli"), provider("gemini_cli"), provider("cursor_sdk")]);
    expect(current.map(p => p.kind)).toEqual(["anthropic", "codex_cli"]);
  });
  it("removes disabled providers without changing their account", async () => {
    const original = [provider("anthropic"), provider("codex_cli")];
    await render(original);
    expect(current).toHaveLength(2);
    await render([provider("anthropic", false), provider("codex_cli")]);
    expect(current.map(p => p.kind)).toEqual(["codex_cli"]);
    expect(original[0]?.enabled).toBe(true);
  });
  it("cannot resurrect a provider from a late connection check", async () => {
    let resolve!: (v: unknown) => void;
    api.claudeStatus.mockReturnValue(new Promise(r => { resolve = r; }));
    await render([provider("anthropic")]);
    await render([provider("anthropic", false)]);
    await act(async () => { resolve({ loggedIn: true }); });
    expect(current).toEqual([]);
  });
  it("doesn't inspect disabled credentials or equate a missing API key with a connection", async () => {
    expect(await providerConnected(provider("anthropic", false))).toBe(false);
    expect(api.claudeStatus).not.toHaveBeenCalled();
    expect(await providerConnected(provider("openai"))).toBe(false);
    expect(api.providerKeyStatus).not.toHaveBeenCalled();
    expect(await providerConnected({ ...provider("openai_compat"), baseUrl: "http://localhost:11434/v1" })).toBe(true);
  });
  it("hides unavailable connections rather than guessing they are ready", async () => {
    api.claudeStatus.mockRejectedValue(new Error("status unavailable"));
    await render([provider("anthropic"), provider("codex_cli")]);
    expect(current.map(p => p.kind)).toEqual(["codex_cli"]);
  });
});
