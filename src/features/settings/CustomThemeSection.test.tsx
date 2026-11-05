// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn(), run: vi.fn(), save: vi.fn(), drop: null as null | ((event: { type: "drop"; paths: string[] }) => void) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@/lib/ipc", () => ({ ipc: { themeReadMarkdown: mocks.read } }));
vi.mock("@/lib/db", () => ({ setAppState: mocks.save }));
vi.mock("@/features/agents/textCall", () => ({ runSurfaceAnalysis: mocks.run }));
vi.mock("@/lib/fileDrop", () => ({ useFileDropZone: (_ref: unknown, _name: string, handler: typeof mocks.drop) => { mocks.drop = handler; } }));
vi.mock("@/components/ModelSelect", () => ({ ModelSelect: () => <select aria-label="Theme model"><option>Test model</option></select> }));
vi.mock("./ThemeSphere", () => ({ ThemeSphere: () => <span /> }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: vi.fn(async () => true) }));
import { CustomThemeSection } from "./CustomThemeSection";
import { themeFixture } from "./__tests__/themeFixture";
import { useThemeStore } from "@/store/themeStore";
let host: HTMLDivElement, root: Root;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const button = (text: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes(text))!;
const click = async (text: string) => act(async () => { button(text).click(); await tick(); });
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.open.mockResolvedValue("/design.md"); mocks.read.mockResolvedValue("# Carbon\nUse graphite and blue."); mocks.save.mockResolvedValue(undefined); mocks.run.mockResolvedValue(JSON.stringify(themeFixture));
  useThemeStore.getState().hydrate("liquid"); useThemeStore.getState().hydrateCustom(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<CustomThemeSection />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("imports locally, generates only on explicit action, previews, and saves the theme", async () => {
  await click("Drop a design");
  expect(mocks.read).toHaveBeenCalledWith("/design.md");
  expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  await click("Generate theme");
  expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining("# Carbon"), "theme", { signal: expect.any(AbortSignal) });
  expect(host.textContent).toContain("Carbon");
  await click("Try on desktop");
  expect(useThemeStore.getState().previewTheme?.name).toBe("Carbon");
  expect(mocks.save).not.toHaveBeenCalled();
  await click("Save and use");
  expect(useThemeStore.getState().customThemes).toHaveLength(1);
  expect(useThemeStore.getState().theme).toBe(useThemeStore.getState().customThemes[0]?.id);
  expect(mocks.save.mock.calls.find(([key]) => key === "custom_themes")?.[1]).not.toHaveProperty("source");
});
it("does not replace a newer explicit selection when saving finishes", async () => {
  await click("Drop a design"); await click("Generate theme");
  let release!: () => void;
  mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  await click("Save and use");
  await act(async () => { useThemeStore.getState().set("liquid"); release(); await tick(); });
  expect(useThemeStore.getState().customThemes).toHaveLength(1);
  expect(useThemeStore.getState().theme).toBe("liquid");
});
it("automatically reverts the desktop preview after thirty seconds", async () => {
  await click("Drop a design"); await click("Generate theme");
  const timer = vi.spyOn(globalThis, "setTimeout");
  try {
    await click("Try on desktop");
    const callback = timer.mock.calls.find(([, delay]) => delay === 30_000)?.[0] as (() => void) | undefined;
    expect(callback).toBeDefined();
    await act(async () => callback!());
    expect(useThemeStore.getState().theme).toBe("liquid");
  } finally { timer.mockRestore(); }
});
it("accepts native single-file drop and rejects multiple files without an AI call", async () => {
  await act(async () => { mocks.drop?.({ type: "drop", paths: ["/a.md", "/b.md"] }); await tick(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Drop one");
  expect(mocks.read).not.toHaveBeenCalled();
  await act(async () => { mocks.drop?.({ type: "drop", paths: ["/a.md"] }); await tick(); });
  expect(mocks.read).toHaveBeenCalledWith("/a.md"); expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects stale results after cancellation and cancels work on leaving Appearance", async () => {
  let resolve!: (value: string) => void;
  mocks.run.mockImplementation(() => new Promise<string>(r => { resolve = r; }));
  await click("Drop a design"); await click("Generate theme");
  const signal = mocks.run.mock.calls[0]![2].signal as AbortSignal;
  await click("Cancel generation"); expect(signal.aborted).toBe(true);
  await act(async () => { resolve(JSON.stringify(themeFixture)); await tick(); });
  expect(useThemeStore.getState().customThemes).toEqual([]);
  expect(button("Try on desktop")).toBeUndefined();
  await click("Generate theme");
  const nextSignal = mocks.run.mock.calls[1]![2].signal as AbortSignal;
  await act(async () => root.render(<div />)); expect(nextSignal.aborted).toBe(true);
});
it("restores an unsaved preview on unmount and retains failed saves for retry", async () => {
  await click("Drop a design"); await click("Generate theme"); await click("Try on desktop");
  mocks.save.mockRejectedValueOnce(new Error("Disk unavailable"));
  await click("Save and use");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Disk unavailable");
  expect(useThemeStore.getState().customThemes).toEqual([]);
  expect(button("Save and use")).toBeDefined();
  await act(async () => root.render(<div />));
  expect(useThemeStore.getState().theme).toBe("liquid");
});
