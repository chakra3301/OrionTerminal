import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), confirm: vi.fn(async () => false), off: vi.fn(), risks: vi.fn(() => ["unsaved note"]) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mocks.confirm, message: vi.fn(async () => {}) }));
vi.mock("./quitRisks", () => ({ quitRisks: mocks.risks }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn() } }));
import { useQuitGuard } from "./useQuitGuard";
function Host() { useQuitGuard(true); return null; }
it("listens before recovering an early native request, cancels and restores input", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const order: string[] = []; const id = "01M2BEKZ9HN58B3845N5FDJWS5";
  mocks.listen.mockImplementation(async () => { order.push("listen"); return mocks.off; });
  mocks.invoke.mockImplementation(async (cmd: string) => { order.push(cmd); return cmd === "app_quit_pending" ? id : undefined; });
  const host = document.createElement("div"), root = createRoot(host); document.body.inert = false;
  await act(async () => root.render(<Host />));
  expect(order).toEqual(["listen", "app_quit_pending", "app_quit_decide"]);
  expect(mocks.invoke).toHaveBeenLastCalledWith("app_quit_decide", { requestId: id, allow: false });
  expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining("Memory-only drafts will be lost"), expect.objectContaining({ cancelLabel: "Keep working" }));
  expect(document.body.inert).toBe(false);
  await act(async () => root.unmount()); expect(mocks.off).toHaveBeenCalledOnce();
});
