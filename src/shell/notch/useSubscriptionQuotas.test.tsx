import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Provider } from "@/features/agents/agentTypes";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ipc", () => ({ ipc: { subscriptionQuota: read } }));
import { useSubscriptionQuotas } from "./useSubscriptionQuotas";
const p: Provider = { id: "claude", kind: "anthropic", name: "Claude", enabled: true, builtin: true, keyRef: "", baseUrl: "", models: [] };
const response = { status: "keychain_access", windows: [], plan: null, profile: null, resetCredits: null, fetchedAt: 1, retryAt: null, message: "Permission required" };
let root: Root, host: HTMLDivElement;
let current: ReturnType<typeof useSubscriptionQuotas>;
function Probe({ providers, expanded }: { providers: Provider[]; expanded: boolean }) { current = useSubscriptionQuotas(providers, expanded); return null; }
const render = (expanded: boolean, providers = [p]) => act(async () => root.render(<Probe providers={providers} expanded={expanded} />));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); read.mockReset().mockResolvedValue(response);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("polls only while open and requests keychain interaction only on explicit action", async () => {
  await render(false); expect(read).not.toHaveBeenCalled();
  await render(true); expect(read).toHaveBeenLastCalledWith("claude", false);
  await act(async () => current.allowKeychain("claude"));
  expect(read).toHaveBeenLastCalledWith("claude", true);
  const calls = read.mock.calls.length;
  await render(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(read).toHaveBeenCalledTimes(calls);
});
it("drops late results when the provider is disconnected", async () => {
  let resolve!: (v: unknown) => void;
  read.mockReturnValue(new Promise(r => { resolve = r; }));
  await render(true); await render(true, [{ ...p, enabled: false }]);
  await act(async () => { resolve(response); });
  expect(current.readings).toEqual({});
});
it("does not carry a previous configuration's quota into a new connection", async () => {
  await render(true); expect(current.readings.claude?.value?.status).toBe("keychain_access");
  let resolve!: (v: unknown) => void;
  read.mockReturnValue(new Promise(r => { resolve = r; }));
  await render(true, [{ ...p, keyRef: "different-connection" }]);
  expect(current.readings.claude?.value).toBeNull();
  await act(async () => { resolve(response); });
});
it("pauses polling while the document is hidden", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await render(true); expect(read).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(read).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(true);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(120000); });
  expect(read).toHaveBeenCalledTimes(1);
});
