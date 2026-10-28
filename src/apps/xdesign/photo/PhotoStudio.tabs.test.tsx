import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { addPhotoTabs, editImage, usePhotoWorkspace } from "./runtime";
import { PhotoStudio } from "./PhotoStudio";
import type { PhotoDocument, PhotoState } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: vi.fn(async () => undefined), editImage: vi.fn() }));
vi.mock("./PhotoTiles", async original => ({ ...await original<typeof import("./PhotoTiles")>(), PhotoTiles: () => <div data-testid="detail-tiles"/> }));

let root: Root, container: HTMLDivElement, projectId: string, a: string, b: string;
const docs: Record<string, PhotoDocument> = {};
const openMenu = async (...path: string[]) => { for (const [index, label] of path.entries()) await act(async () => [...container.querySelectorAll<HTMLButtonElement>(index ? "[role=menu] > button" : "[role=menubar] > button")].find(el => el.textContent?.startsWith(label))!.click()); };
const closeMenus = async () => { for (let menu = container.querySelector("[role=menu]"); menu; menu = container.querySelector("[role=menu]")) await act(async () => { [...container.querySelectorAll("[role=menu]")].at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); };
const rows = () => [...[...container.querySelectorAll<HTMLButtonElement>("[role=menu]")].at(-1)!.querySelectorAll<HTMLButtonElement>(":scope > button")];
const row = (label: string) => rows().find(el => el.textContent?.replace(/[^\p{L}\p{N}… ]/gu, "").trim().startsWith(label))!;
const key = (init: KeyboardEventInit) => act(async () => { container.querySelector(".xd-photo-stage")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const strip = () => [...container.querySelectorAll<HTMLElement>('[role=tablist][aria-label="Open images"] > [role=tab]')];
const tab = (name: string) => strip().find(el => el.textContent?.startsWith(name))!;
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const tabs = () => usePhotoWorkspace.getState().tabs.map(item => item.placementId);
const active = () => usePhotoWorkspace.getState().shapeId;
const remove = (shapeId: string) => act(async () => useXDesign.setState(store => ({ shapes: store.shapes.filter(shape => shape.id !== shapeId) })));
const state: PhotoState = { name: "Portrait", width: 800, height: 600, mode: "RGB", depth: 8, resolution: 72, activeLayer: 2, hasSelection: false, selectionBounds: null, layers: [
  { id: 1, name: "Background", kind: "Pixel", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false },
  { id: 2, name: "Curves 1", kind: "Adjustment", visible: false, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false }], canUndo: true, canRedo: false, paths: { saved: [], work: false } };
const image = (name: string) => {
  const version = ulid(), doc: PhotoDocument = { id: ulid(), version, name, width: 800, height: 600, previewWidth: 800, previewHeight: 600, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null };
  const placement = useXDesign.getState().applyPhotoDocument(doc); docs[placement] = doc; return placement;
};
const show = (shapeId: string) => { const doc = docs[shapeId]!; usePhotoWorkspace.setState({ shapeId, documentId: doc.id, projectId, source: "legacy", smartTrail: [], state: { ...state, name: doc.name }, stateVersion: doc.version, busy: false, error: null, warnings: [] }); };

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useXDesign.getState().hydrate(null);
  projectId = ulid(); useXDProjects.setState({ activeId: projectId, transitioning: false });
  vi.mocked(editImage).mockReset().mockImplementation(async shapeId => { show(shapeId); });
  a = image("Portrait"); b = image("Second");
  show(a); addPhotoTabs("legacy", [b], projectId);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PhotoStudio/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); usePhotoWorkspace.setState({ busy: false }); usePhotoWorkspace.getState().close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Document tabs", () => {
  it("shows a tab per open image in a tablist, the active one with zoom and detail", () => {
    expect(container.querySelector(".xd-ps-doctabs")!.getAttribute("role")).toBe("tablist");
    expect(strip()).toHaveLength(2);
    expect(strip().map(el => el.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(strip()[0]!.textContent).toMatch(/^Portrait @ \d+% \(Curves 1, RGB\/8\)$/);
    expect(strip()[1]!.textContent).toBe("Second");
  });

  it("clicking a background tab switches to it and its label is kept", async () => {
    const label = tab("Portrait").textContent;
    await act(async () => tab("Second").click());
    expect(editImage).toHaveBeenCalledWith(b);
    expect(active()).toBe(b);
    expect(tab("Second").getAttribute("aria-selected")).toBe("true");
    expect(tab("Portrait").textContent).toBe(label);
  });

  it("each tab closes on its own", async () => {
    await act(async () => button("Close Second").click());
    expect(tabs()).toEqual([a]); expect(editImage).not.toHaveBeenCalled(); expect(strip()).toHaveLength(1);
    await act(async () => button("Close image").click());
    expect(active()).toBeNull(); expect(tabs()).toEqual([]);
  });

  it("keeps zoom per tab and fits a tab seen for the first time", async () => {
    await openMenu("View"); await act(async () => row("200").click());
    expect(tab("Portrait").textContent).toMatch(/^Portrait @ 200% /);
    await act(async () => tab("Second").click());
    expect(tab("Second").textContent).not.toMatch(/@ 200% /);
    await act(async () => tab("Portrait").click());
    expect(tab("Portrait").textContent).toMatch(/^Portrait @ 200% /);
  });

  it("File menu: Close All ⌥⌘W and Close Others ⌥⌘P after Close", async () => {
    await openMenu("File");
    const labels = rows().map(el => el.textContent!.replace(/[^\p{L}\p{N}… ]/gu, "").trim()), at = labels.indexOf("Close");
    expect(labels.slice(at, at + 3)).toEqual(["Close", "Close All", "Close Others"]);
    expect([row("Close All").dataset.shortcut, row("Close Others").dataset.shortcut]).toEqual(["⌥⌘W", "⌥⌘P"]);
    expect(row("Close Others").disabled).toBe(false);
    await closeMenus();
    await key({ key: "π", code: "KeyP", altKey: true, metaKey: true });
    expect(tabs()).toEqual([a]); expect(active()).toBe(a);
    await openMenu("File");
    expect(row("Close Others").disabled).toBe(true);
    await closeMenus();
    useXDesign.setState({ photoResume: { source: "legacy", placementId: a, documentId: docs[a]!.id } });
    await key({ key: "∑", code: "KeyW", altKey: true, metaKey: true });
    expect(active()).toBeNull(); expect(tabs()).toEqual([]); expect(useXDesign.getState().photoResume).toBeNull();
  });

  it("⌃Tab and ⌃⇧Tab move between tabs with wrap", async () => {
    const c = image("Third");
    await act(async () => addPhotoTabs("legacy", [c], projectId));
    await key({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true });
    expect(editImage).toHaveBeenLastCalledWith(c); expect(active()).toBe(c);
    await key({ key: "Tab", code: "Tab", ctrlKey: true });
    expect(editImage).toHaveBeenLastCalledWith(a); expect(active()).toBe(a);
    await key({ key: "Tab", code: "Tab", ctrlKey: true });
    expect(active()).toBe(b);
  });

  it("Window menu lists every open image with a check on the active one", async () => {
    await openMenu("Window");
    const documents = () => rows().filter(el => el.getAttribute("role") === "menuitemradio");
    expect(documents().map(el => [el.textContent, el.getAttribute("aria-checked")])).toEqual([["Portrait", "true"], ["Second", "false"]]);
    await act(async () => documents()[1]!.click());
    expect(editImage).toHaveBeenCalledWith(b); expect(active()).toBe(b);
  });

  it("Back to design keeps the tabs", async () => {
    useXDesign.setState({ photoResume: { source: "legacy", placementId: a, documentId: docs[a]!.id } });
    await act(async () => button("Back to design").click());
    expect(active()).toBeNull(); expect(tabs()).toEqual([a, b]); expect(useXDesign.getState().photoResume).toBeNull();
  });

  it("drops a background tab whose image was deleted", async () => {
    await remove(b);
    expect(strip().map(el => el.getAttribute("aria-selected"))).toEqual(["true"]);
    expect(tabs()).toEqual([a]);
    await openMenu("Window");
    expect(rows().filter(el => el.getAttribute("role") === "menuitemradio").map(el => el.textContent)).toEqual(["Portrait"]);
  });

  it("the active image vanishing hands over to the next tab", async () => {
    await remove(a);
    await vi.waitFor(() => expect(active()).toBe(b));
    expect(editImage).toHaveBeenCalledWith(b); expect(tabs()).toEqual([b]);
  });

  it("tabs are disabled while busy", async () => {
    await act(async () => usePhotoWorkspace.setState({ busy: true, quiet: false }));
    expect(tab("Second").getAttribute("aria-disabled")).toBe("true");
    await act(async () => tab("Second").click());
    expect(editImage).not.toHaveBeenCalled(); expect(active()).toBe(a);
    expect([button("Close image").disabled, button("Close Second").disabled]).toEqual([true, true]);
  });

  it("swallows close shortcuts while busy", async () => {
    await act(async () => usePhotoWorkspace.setState({ busy: true, quiet: false }));
    for (const init of [{ key: "w", code: "KeyW", metaKey: true }, { key: "∑", code: "KeyW", altKey: true, metaKey: true }]) {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      await act(async () => { container.querySelector(".xd-photo-stage")!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    expect(active()).toBe(a); expect(tabs()).toEqual([a, b]);
  });
});
