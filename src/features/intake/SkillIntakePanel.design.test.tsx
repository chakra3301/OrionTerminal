// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ open: vi.fn(), discover: vi.fn(), inspect: vi.fn(), list: vi.fn(), release: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.open }));
vi.mock("./api", () => ({ intake: m }));
import { SkillIntakePanel } from "./SkillIntakePanel";
import { candidateFixture, discoveryFixture } from "./testFixture";
import { useIntakeCollection } from "./collectionStore";
import { useSkillsStore } from "@/store/skillsStore";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const click = (label: string) => act(async () => {
  const target = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(label));
  expect(target).toBeDefined(); target!.click();
});
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  useIntakeCollection.setState({ items: [], loaded: false, error: null });
  useSkillsStore.setState({ packages: new Map(), loaded: true, error: null, mutating: false });
  m.list.mockResolvedValue([]); m.open.mockResolvedValue("/fixture"); m.discover.mockResolvedValue(discoveryFixture); m.inspect.mockResolvedValue(candidateFixture); m.read.mockResolvedValue("<script>inert source</script>"); m.release.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<SkillIntakePanel presentation="workspace" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("separates workspace navigation, source choices and an honest empty queue without acquiring anything", () => {
  expect(host.querySelector('[data-presentation="workspace"]')).not.toBeNull();
  expect(host.querySelectorAll(".skill-intake-source-option")).toHaveLength(2);
  expect(host.querySelector<HTMLDetailsElement>(".skill-intake-boundary")!.open).toBe(false);
  expect(host.querySelector(".skill-intake-boundary summary")!.textContent).toContain("no AI, installation or execution");
  expect(host.textContent).toContain("Nothing installs automatically");
  expect(m.open).not.toHaveBeenCalled(); expect(m.discover).not.toHaveBeenCalled();
});
it("offers a working return from an empty library without acquisition or unmount", async () => {
  await click("Installed skills"); await click("Inspect a source");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("Skills & repositories");
  expect(document.activeElement).toBe(host.querySelector('[role="tab"][aria-selected="true"]'));
  expect(m.open).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
});
it("exposes preserved checks on demand and selects inert resources with an accessible state", async () => {
  await click("Choose folder"); await click("Inspect selected skill");
  expect(host.querySelector<HTMLDetailsElement>(".skill-intake-provenance")!.open).toBe(false);
  expect(host.querySelector(".skill-intake-provenance")!.textContent).toContain(candidateFixture.artifactHash);
  await click("example/DESIGN.md");
  expect(host.querySelector('[aria-pressed="true"]')!.textContent).toContain("example/DESIGN.md");
  expect(host.querySelector('[aria-label="Resource text"]')!.textContent).toBe("<script>inert source</script>");
  expect(host.querySelector("script")).toBeNull();
  const pane = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!; pane.scrollTop = 300;
  await click("Back to sources"); expect(pane.scrollTop).toBe(0); expect(document.activeElement).toBe(pane);
  expect(m.inspect).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
});
it("supports up/down navigation for the desktop rail without invoking an operation", async () => {
  await act(async () => host.querySelector('[role="tab"][aria-selected="true"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement?.textContent).toBe("Apps");
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  expect(document.activeElement?.textContent).toBe("Skills & repositories");
  expect(m.open).not.toHaveBeenCalled();
});
