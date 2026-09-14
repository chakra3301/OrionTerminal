import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: db.get, setAppState: db.set }));
import { BackgroundAiSettings } from "./BackgroundAiSettings";
import { useBackgroundAi } from "@/store/backgroundAiStore";
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.get.mockReset().mockResolvedValue(null); db.set.mockReset().mockResolvedValue(undefined);
  useBackgroundAi.setState({ loaded: true, permissions: { notes: false, assets: false, companion: false } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("shows off-by-default data/billing disclosure and persists explicit media opt-in", async () => {
  await act(async () => root.render(<BackgroundAiSettings />));
  const inputs = [...host.querySelectorAll("input")];
  expect(inputs).toHaveLength(3); expect(inputs.every((i) => !i.checked)).toBe(true);
  expect(host.textContent).toContain("API billing"); expect(host.textContent).toContain("data already sent cannot be recalled");
  await act(async () => inputs[1]!.click());
  expect(db.set).toHaveBeenCalledWith("ai.background", { version: 1, permissions: { assets: true, notes: false, companion: false } });
  expect(inputs[1]!.checked).toBe(true);
});
it("a failed disable stays off and offers retrying that exact save", async () => {
  await useBackgroundAi.getState().setConsent("assets", true);
  await act(async () => root.render(<BackgroundAiSettings />));
  db.set.mockRejectedValueOnce(new Error("disk"));
  await act(async () => host.querySelectorAll("input")[1]!.click());
  expect(host.querySelectorAll("input")[1]!.checked).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not save consent");
  await act(async () => host.querySelector("button")!.click());
  expect(db.set.mock.calls.at(-1)?.[1].permissions.assets).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
