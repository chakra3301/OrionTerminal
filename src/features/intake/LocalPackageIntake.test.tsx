// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ pick: vi.fn(), inspect: vi.fn(), install: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.pick }));
vi.mock("@/lib/ipc", () => ({ ipc: { pluginInspectIntakeDirectory: m.inspect } }));
import { LocalPackageIntake, parsePackageInspection } from "./LocalPackageIntake";
import { useCommunityPlugins } from "@/store/communityPluginStore";
const inspection = { manifest: { id: "dev.test.app", name: "<script>App</script>", version: "1.0.0", apiVersion: "1", engines: { orion: "*" }, publisher: "test", entrypoints: { ui: "ui.html" }, contributes: { apps: [{ id: "app", name: "App" }] }, permissions: ["storage.plugin"] }, fingerprint: "a".repeat(64), fileCount: 2, totalBytes: 200 };
let root: Root, host: HTMLDivElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
const button = (s: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(s))!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); m.pick.mockResolvedValue("/fixture"); m.inspect.mockResolvedValue(inspection); m.install.mockResolvedValue(true);
  useCommunityPlugins.setState({ installed: [], hydrated: true, recoveryBlocked: false, busyIds: [], error: null, install: m.install });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async () => { await act(async () => root.render(<LocalPackageIntake />)); };
const inspect = async () => { await act(async () => { button("Choose package").click(); await tick(); }); };
it("requires explicit picker, escaped review and approval before disabled installation", async () => {
  await mount(); expect(m.pick).not.toHaveBeenCalled(); expect(m.inspect).not.toHaveBeenCalled();
  await inspect(); expect(m.install).not.toHaveBeenCalled(); expect(host.querySelector("script")).toBeNull();
  expect(button("Install disabled").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => { button("Install disabled").click(); await tick(); });
  expect(m.install).toHaveBeenCalledWith("/fixture", inspection, "intake-disabled", true, undefined, expect.any(Function));
  expect(host.textContent).toContain("Installed disabled. Enable explicitly");
});
it("picker cancellation and discarded review cause no installation", async () => {
  await mount(); m.pick.mockResolvedValueOnce(null); await inspect(); expect(m.inspect).not.toHaveBeenCalled();
  await inspect(); await act(async () => button("Discard package review").click()); expect(host.querySelector("input")).toBeNull(); expect(m.install).not.toHaveBeenCalled();
});
it("dismissal and unmount suppress late inspection and picker results", async () => {
  await mount(); let finish!: (v: unknown) => void;
  m.inspect.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await inspect(); await act(async () => button("Dismiss inspection").click());
  await act(async () => { finish(inspection); await tick(); }); expect(host.querySelector("input")).toBeNull();
  m.pick.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await inspect();
  await act(async () => root.render(null)); await act(async () => { finish("/later"); await tick(); }); expect(m.inspect).toHaveBeenCalledOnce(); expect(m.install).not.toHaveBeenCalled();
});
it("native failure retains review, revokes acknowledgement and does not report installation", async () => {
  await mount(); await inspect();
  useCommunityPlugins.setState({ error: "Package changed after review" }); m.install.mockResolvedValueOnce(false);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => { button("Install disabled").click(); await tick(); });
  expect(host.textContent).toContain("Package changed after review"); expect(button("Install disabled").disabled).toBe(true); expect(host.textContent).not.toContain("Installed disabled.");
});
it("choosing another source clears acknowledgement and snapshots native data", async () => {
  await mount(); await inspect(); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await inspect(); expect(button("Install disabled").disabled).toBe(true);
  const parsed = parsePackageInspection(inspection); expect(parsed.manifest).not.toBe(inspection.manifest);
});
it("Manager hydration/recovery blocks approval and installation", async () => {
  await mount(); await inspect(); await act(async () => useCommunityPlugins.setState({ hydrated: false }));
  expect(button("Install disabled").disabled).toBe(true); expect(host.textContent).toContain("Reload Plugin Manager"); expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true); expect(m.install).not.toHaveBeenCalled();
});
it("publication lease expires on unmount but a late committed receipt cannot produce a UI success", async () => {
  await mount(); await inspect(); let finish!: (ok: boolean) => void; m.install.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await act(async () => { button("Install disabled").click(); await tick(); });
  const lease = m.install.mock.calls[0]![5]; expect(lease()).toBe(true); await act(async () => root.render(null)); expect(lease()).toBe(false);
  await act(async () => { finish(true); await tick(); }); expect(host.textContent).toBe(""); expect(m.install).toHaveBeenCalledOnce();
});
it("invalid native envelopes and authority fields fail closed", () => {
  for (const patch of [{ approved: true }, { fingerprint: "bad" }, { fileCount: 513 }, { totalBytes: 26 * 1024 * 1024 }, { manifest: { ...inspection.manifest, tools: ["shell"] } }]) expect(() => parsePackageInspection({ ...inspection, ...patch })).toThrow();
});
