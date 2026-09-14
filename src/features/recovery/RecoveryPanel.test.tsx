import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save, confirm: mocks.confirm }));
vi.mock("@/lib/db", () => ({ insertNote: vi.fn() }));
vi.mock("@/store/notesStore", () => ({ useNotesStore: { getState: () => ({ load: vi.fn() }) } }));
import { RecoveryPanel } from "./RecoveryPanel";
import { useRecovery } from "./recoveryStore";
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  useRecovery.setState({ open: true, error: null, listError: null, pending: false, refresh: vi.fn(async () => {}), sessions: [{ session: "session", revision: 1, updated: 1, error: null, items: ["File · fixture"] }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mocks.invoke.mockResolvedValue({ kind: "file", path: "/fixture", contents: "draft" });
  await act(async () => root.render(<RecoveryPanel />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
it("shows export errors inside the dialog and replaces them with confirmed success", async () => {
  await click("File · fixture"); mocks.save.mockResolvedValue("/new-file");
  mocks.invoke.mockRejectedValueOnce(new Error("destination exists"));
  await click("Save a new file copy");
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain("could not be confirmed");
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain("unused filename");
  mocks.invoke.mockResolvedValueOnce(undefined); await click("Save a new file copy");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector(".recovery-feedback")?.textContent).toContain("exported to a new file");
});
it("does not assert the source is retained when discard acknowledgment fails", async () => {
  mocks.confirm.mockResolvedValue(true); mocks.invoke.mockRejectedValueOnce(new Error("lost reply"));
  await click("Discard this session’s copies");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Reload the list");
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("still retained");
});
it("keeps cancellation silent and reports an acknowledged discard in the dialog", async () => {
  mocks.confirm.mockResolvedValueOnce(false); await click("Discard this session’s copies");
  expect(mocks.invoke).not.toHaveBeenCalled(); expect(host.querySelector(".recovery-feedback")).toBeNull();
  mocks.confirm.mockResolvedValueOnce(true); mocks.invoke.mockResolvedValueOnce(undefined);
  await click("Discard this session’s copies");
  expect(host.querySelector(".recovery-feedback")?.textContent).toContain("Selected session discarded");
});
