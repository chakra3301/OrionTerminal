import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliEngineStatus } from "./CliEngineStatus";
import { ProviderConnectionToggle } from "./ProviderConnectionToggle";
import { CODEX_CLI_PROVIDER } from "@/features/agents/seedData";
import { ipc } from "@/lib/ipc";
import { confirmAction } from "@/components/ConfirmModal";

const mocks = vi.hoisted(() => ({ setEnabled: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { cliStatus: vi.fn(), claudeStatus: vi.fn(), cliAuthScope: vi.fn(), cliLogout: vi.fn(), cliLogin: vi.fn() } }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: vi.fn() }));
vi.mock("@/features/agents/dispatchSend", () => ({ invalidateConnectorSessions: vi.fn() }));
vi.mock("@/store/providersStore", () => ({ useProvidersStore: { getState: () => ({ setEnabled: mocks.setEnabled }) } }));
vi.mock("@/apps/xdesign/imageProviderRuntime", () => ({ invalidateCodexImageStatus: mocks.invalidate }));

let host: HTMLDivElement;
let root: Root;
const connected = { installed: true, loggedIn: true, authMode: "chatgpt", subscriptionReady: true, imageReady: true, version: "0.154.0", detail: "Session detected" };
const signedOut = { ...connected, loggedIn: false, subscriptionReady: false, imageReady: false };
function button(text: string) { return Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(text))!; }
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(ipc.cliStatus).mockResolvedValue(connected);
  vi.mocked(ipc.cliAuthScope).mockResolvedValue({ directory: "/validation/codex-auth", shared: true });
  vi.mocked(confirmAction).mockResolvedValue(true);
  mocks.setEnabled.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("provider connection controls", () => {
  it("disconnects routing only after confirmation, without touching account credentials", async () => {
    await act(async () => root.render(<ProviderConnectionToggle provider={CODEX_CLI_PROVIDER} />));
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    await act(async () => button("Disconnect").click());
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    await act(async () => button("Disconnect").click());
    expect(mocks.setEnabled).toHaveBeenCalledWith(CODEX_CLI_PROVIDER.id, false);
    expect(ipc.cliLogout).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalled();
  });
  it("enables disconnected definitions and surfaces save failures", async () => {
    mocks.setEnabled.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => root.render(<ProviderConnectionToggle provider={{ ...CODEX_CLI_PROVIDER, enabled: false }} />));
    await act(async () => button("Enable").click());
    expect(confirmAction).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("disk full");
    await act(async () => button("Enable").click());
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(CODEX_CLI_PROVIDER.id, true);
  });
  it("confirms the actual profile before CLI logout, then offers a fresh login", async () => {
    await act(async () => root.render(<CliEngineStatus engine="codex_cli" />));
    expect(host.textContent).toContain("/validation/codex-auth");
    vi.mocked(ipc.cliStatus).mockResolvedValue(signedOut);
    await act(async () => button("Sign out").click());
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("/validation/codex-auth") }));
    expect(ipc.cliLogout).toHaveBeenCalledWith("codex_cli");
    expect(button("Connect with ChatGPT")).toBeTruthy();
    expect(host.textContent).toContain("Signed out");
  });
  it("does not claim sign-out when the CLI fails or still has a session", async () => {
    await act(async () => root.render(<CliEngineStatus engine="codex_cli" />));
    vi.mocked(ipc.cliLogout).mockRejectedValueOnce(new Error("Stop active requests"));
    await act(async () => button("Sign out").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Stop active requests");
    await act(async () => button("Sign out").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("still reports a session");
  });
  it("polls user-completed login without calling a model", async () => {
    vi.useFakeTimers();
    vi.mocked(ipc.cliStatus).mockResolvedValue(signedOut);
    await act(async () => root.render(<CliEngineStatus engine="codex_cli" />));
    await act(async () => button("Connect with ChatGPT").click());
    expect(ipc.cliLogin).toHaveBeenCalledWith("codex_cli");
    expect(host.textContent).toContain("finish signing in");
    vi.mocked(ipc.cliStatus).mockResolvedValue(connected);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(host.textContent).toContain("Model and image access still need a live test");
  });
});
