import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { PhotoStudio } from "./PhotoStudio";
import type { PhotoDocument, PhotoLayer, PhotoSlice, PhotoState } from "./types";
import { DEFAULT_FLAGS, useViewAids } from "./viewGuides";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: vi.fn(async () => undefined) }));
vi.mock("./PhotoTiles", async original => ({ ...await original<typeof import("./PhotoTiles")>(), PhotoTiles: () => <div data-testid="detail-tiles"/> }));

let root: Root, container: HTMLDivElement, docId: string;
const openMenu = async (...path: string[]) => { for (const [index, label] of path.entries()) await act(async () => [...container.querySelectorAll<HTMLButtonElement>(index ? "[role=menu] > button" : "[role=menubar] > button")].find(el => el.textContent?.startsWith(label))!.click()); };
const rows = () => [...container.querySelectorAll<HTMLButtonElement>("[role=menu]")].at(-1)!.querySelectorAll<HTMLButtonElement>(":scope > button");
const row = (label: string) => [...rows()].find(el => el.textContent?.replace(/[^\p{L}\p{N}… ]/gu, "").trim().startsWith(label))!;
const key = (init: KeyboardEventInit) => act(async () => { container.querySelector(".xd-photo-stage")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useViewAids.setState({ flags: DEFAULT_FLAGS, documents: {}, dialog: null, next: 1 });
  useXDesign.getState().hydrate(null);
  docId = ulid(); const version = ulid();
  const doc: PhotoDocument = { id: docId, version, name: "Portrait", width: 800, height: 600, previewWidth: 800, previewHeight: 600, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null };
  const placement = useXDesign.getState().applyPhotoDocument(doc);
  const state: PhotoState = { name: "Portrait", width: 800, height: 600, mode: "RGB", depth: 8, resolution: 72, activeLayer: 2, hasSelection: false, selectionBounds: null, layers: [
    { id: 1, name: "Background", kind: "Raster", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false },
    { id: 2, name: "Shape 1", kind: "Shape", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false, bounds: [10, 20, 30, 40] }], canUndo: true, canRedo: false };
  usePhotoWorkspace.setState({ shapeId: placement, documentId: docId, projectId: ulid(), source: "legacy", state, stateVersion: version, busy: false, error: null, warnings: [] });
  useXDProjects.setState({ activeId: usePhotoWorkspace.getState().projectId, transitioning: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PhotoStudio/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); usePhotoWorkspace.getState().close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("View aids in the View menu", () => {
  it("lists Photoshop's items after Screen Mode, with checkmarks for toggles", async () => {
    await openMenu("View");
    const labels = [...rows()].map(el => el.textContent!);
    const at = (name: string) => labels.findIndex(text => text.startsWith(name));
    expect([at("Screen Mode"), at("Extras"), at("Show"), at("Rulers"), at("Snap"), at("Snap To"), at("Guides"), at("Lock Slices")].every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]!))).toBe(true);
    const glyphs = (label: string) => row(label).dataset.shortcut;
    expect([glyphs("Extras"), glyphs("Rulers"), glyphs("Snap")]).toEqual(["⌘H", "⌘R", "⇧⌘;"]);
    await act(async () => row("Guides").click());
    expect(row("Lock Guides").dataset.shortcut).toBe("⌥⌘;");
  });
  it("toggles Rulers from the menu", async () => {
    await openMenu("View");
    await act(async () => row("Rulers").click());
    expect(useViewAids.getState().flags.rulers).toBe(true);
    expect(container.querySelector(".xd-view-ruler.is-top")).not.toBeNull();
  });
  it("binds Show > Grid and Guides, Extras, Rulers and Snap to their shortcuts", async () => {
    await key({ key: "r", code: "KeyR", metaKey: true });
    expect(useViewAids.getState().flags.rulers).toBe(true);
    await key({ key: "'", code: "Quote", metaKey: true });
    expect(useViewAids.getState().flags.grid).toBe(true);
    await key({ key: ";", code: "Semicolon", metaKey: true });
    expect(useViewAids.getState().flags.guides).toBe(false);
    await key({ key: "h", code: "KeyH", metaKey: true });
    expect(useViewAids.getState().flags.extras).toBe(false);
    await key({ key: ":", code: "Semicolon", metaKey: true, shiftKey: true });
    expect(useViewAids.getState().flags.snap).toBe(false);
    await key({ key: "…", code: "Semicolon", metaKey: true, altKey: true });
    expect(useViewAids.getState().flags.lockGuides).toBe(true);
  });
  it("sets Snap To targets with All and None", async () => {
    await openMenu("View", "Snap To");
    await act(async () => row("None").click());
    expect(useViewAids.getState().flags.snapTo).toEqual({ guides: false, grid: false, layers: false, bounds: false });
    await openMenu("View", "Snap To");
    await act(async () => row("Grid").click());
    expect(useViewAids.getState().flags.snapTo.grid).toBe(true);
    await openMenu("View", "Snap To");
    await act(async () => row("All").click());
    expect(useViewAids.getState().flags.snapTo).toEqual({ guides: true, grid: true, layers: true, bounds: true });
  });
  it("opens New Guide, clears guides and adds guides from the active shape layer", async () => {
    await openMenu("View", "Guides");
    await act(async () => row("New Guide…").click());
    expect(container.querySelector('[role="dialog"][aria-label="New Guide"]')).not.toBeNull();
    await act(async () => useViewAids.getState().setDialog(null));
    await openMenu("View", "Guides");
    await act(async () => row("New Guides From Shape").click());
    expect(useViewAids.getState().documents[docId]!.map(g => [g.axis, g.pos])).toEqual([["v", 10], ["v", 40], ["h", 20], ["h", 60]]);
    await openMenu("View", "Guides");
    await act(async () => row("Clear Guides").click());
    expect(useViewAids.getState().documents[docId]).toEqual([]);
  });
  it("lists the Guides submenu in Photoshop's order, before the slice items", async () => {
    await openMenu("View");
    const labels = [...rows()].map(el => el.textContent!);
    expect(labels.findIndex(text => text.startsWith("Guides"))).toBeLessThan(labels.findIndex(text => text.startsWith("Lock Slices")));
    await act(async () => row("Guides").click());
    expect([...rows()].map(el => [el.textContent!.replace(/[^\p{L}\p{N}… ]/gu, "").trim(), el.disabled])).toEqual([["Edit Selected Guides", true], ["Lock Guides", false], ["Clear Guides", true], ["Clear Selected Guides", true], ["Clear Selected Artboard Guides", true], ["Clear Canvas Guides", true], ["New Guide…", false], ["New Guide Layout…", false], ["New Guides From Shape", false]]);
  });
  it("clears the active artboard's guides or the canvas guides, per axis, strictly inside the artboard", async () => {
    const layer = (id: number, name: string): PhotoLayer => ({ id, name, kind: "Group", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false });
    await act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, activeLayer: 4, layers: [...s.state!.layers,
      { ...layer(3, "Artboard 1"), artboard: { rect: [100, 100, 200, 200], background: "white", preset: null }, children: [{ ...layer(4, "Layer 1"), kind: "Raster" }] },
      { ...layer(5, "Artboard 2"), artboard: { rect: [500, 0, 100, 100], background: "white", preset: null }, children: [] }] } })));
    const guides = () => { useViewAids.getState().addGuides(docId, [{ axis: "v", pos: 150 }, { axis: "v", pos: 100 }, { axis: "v", pos: 550 }, { axis: "v", pos: 400 }, { axis: "h", pos: 250 }, { axis: "h", pos: 50 }, { axis: "h", pos: 350 }], true); };
    const left = () => useViewAids.getState().documents[docId]!.map(g => [g.axis, g.pos]);
    guides();
    await openMenu("View", "Guides");
    await act(async () => row("Clear Selected Artboard Guides").click());
    expect(left()).toEqual([["v", 100], ["v", 550], ["v", 400], ["h", 50], ["h", 350]]);
    await openMenu("View", "Guides");
    expect(["Clear Guides", "Clear Selected Artboard Guides", "Clear Canvas Guides"].map(label => row(label).disabled)).toEqual([false, true, false]);
    await act(async () => guides());
    await act(async () => row("Clear Canvas Guides").click());
    expect(left()).toEqual([["v", 150], ["v", 550], ["h", 250], ["h", 50]]);
    await openMenu("View", "Guides");
    expect(["Clear Guides", "Clear Selected Artboard Guides", "Clear Canvas Guides"].map(label => row(label).disabled)).toEqual([false, false, true]);
  });
  it("treats every guide as a canvas guide when there are no artboards", async () => {
    useViewAids.getState().addGuides(docId, [{ axis: "v", pos: 150 }, { axis: "h", pos: 50 }]);
    await openMenu("View", "Guides");
    await act(async () => row("Clear Canvas Guides").click());
    expect(useViewAids.getState().documents[docId]).toEqual([]);
  });
  it("locks slices and clears user slices through the engine", async () => {
    const slice = (id: number | null): PhotoSlice => ({ number: 1, id, origin: id === null ? "auto" : "user", name: "Portrait_01", rect: [0, 0, 800, 600], kind: "image", layer: null, url: "", target: "", message: "", alt: "", cellText: "", background: null });
    const analyse = (slices: PhotoSlice[], slicesLocked: boolean) => act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, analysis: { ruler: null, count: { total: 0, activeGroup: 0, groups: [] }, notes: [], slices, slicesLocked } } })));
    await analyse([slice(null)], false);
    await openMenu("View");
    expect(row("Lock Slices").getAttribute("aria-checked")).toBe("false");
    expect(row("Clear Slices").disabled).toBe(true);
    await act(async () => row("Lock Slices").click());
    expect(runPhotoCommand).toHaveBeenLastCalledWith("view.lockSlices", { on: true });
    await analyse([slice(3)], false);
    await openMenu("View");
    await act(async () => row("Clear Slices").click());
    expect(runPhotoCommand).toHaveBeenLastCalledWith("view.clearSlices", {});
    await analyse([slice(3)], true);
    await openMenu("View");
    expect(row("Lock Slices").getAttribute("aria-checked")).toBe("true");
    expect(row("Clear Slices").disabled).toBe(true);
    await act(async () => row("Lock Slices").click());
    expect(runPhotoCommand).toHaveBeenLastCalledWith("view.lockSlices", { on: false });
  });
  it("dims New Guides From Shape when the active layer has no shape bounds", async () => {
    await act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, activeLayer: 1 } })));
    await openMenu("View", "Guides");
    expect(row("New Guides From Shape").disabled).toBe(true);
  });
});
