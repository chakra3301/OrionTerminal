import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), error: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: mocks.isTauri }));
vi.mock("@/store/toastStore", () => ({ toast: { error: mocks.error } }));
import { useStartupBackupWarning } from "./useStartupBackupWarning";
function Host({ ready = true }: { ready?: boolean }) { useStartupBackupWarning(ready); return null; }
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); mocks.isTauri.mockReturnValue(true); mocks.invoke.mockResolvedValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); });
it("waits for hydration and surfaces the latched native warning without an event race", async () => {
  mocks.invoke.mockResolvedValue("The startup database backup did not complete.");
  await act(async () => root.render(<Host ready={false} />)); expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => root.render(<Host />));
  expect(mocks.invoke).toHaveBeenCalledWith("database_backup_warning");
  expect(mocks.error).toHaveBeenCalledWith("Database backup needs attention", expect.objectContaining({ body: "The startup database backup did not complete.", durationMs: 0, dedupeKey: "startup-database-backup" }));
});
it("does not claim failure for a successful backup or first launch", async () => {
  await act(async () => root.render(<Host />)); expect(mocks.error).not.toHaveBeenCalled();
});
it("reports inability to check instead of silently assuming backup success", async () => {
  mocks.invoke.mockRejectedValue(new Error("IPC unavailable"));
  await act(async () => root.render(<Host />));
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: expect.stringContaining("Do not assume") }));
});
it("ignores a stale response after disposal and skips browser-only sessions", async () => {
  let settle!: (value: string) => void; mocks.invoke.mockReturnValue(new Promise<string>((resolve) => { settle = resolve; }));
  await act(async () => root.render(<Host />)); await act(async () => root.render(null));
  await act(async () => settle("stale warning")); expect(mocks.error).not.toHaveBeenCalled();
  mocks.isTauri.mockReturnValue(false); await act(async () => root.render(<Host />)); expect(mocks.invoke).toHaveBeenCalledOnce();
});
