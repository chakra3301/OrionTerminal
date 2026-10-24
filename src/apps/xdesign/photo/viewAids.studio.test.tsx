import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePhotoWorkspace } from "./runtime";
import { PhotoStudio } from "./PhotoStudio";
import type { PhotoDocument, PhotoState } from "./types";
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
    expect([at("Screen Mode"), at("Extras"), at("Show"), at("Rulers"), at("Snap"), at("Snap To"), at("Lock Guides"), at("Clear Guides"), at("New Guide…"), at("New Guide Layout…"), at("New Guides From Shape")].every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]!))).toBe(true);
    const glyphs = (label: string) => row(label).dataset.shortcut;
    expect([glyphs("Extras"), glyphs("Rulers"), glyphs("Snap"), glyphs("Lock Guides")]).toEqual(["⌘H", "⌘R", "⇧⌘;", "⌥⌘;"]);
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
    expect(useViewAids.getState().flags.snapTo).toEqual({ guides: false, grid: false, bounds: false });
    await openMenu("View", "Snap To");
    await act(async () => row("Grid").click());
    expect(useViewAids.getState().flags.snapTo.grid).toBe(true);
    await openMenu("View", "Snap To");
    await act(async () => row("All").click());
    expect(useViewAids.getState().flags.snapTo).toEqual({ guides: true, grid: true, bounds: true });
  });
  it("opens New Guide, clears guides and adds guides from the active shape layer", async () => {
    await openMenu("View");
    await act(async () => row("New Guide…").click());
    expect(container.querySelector('[role="dialog"][aria-label="New Guide"]')).not.toBeNull();
    await act(async () => useViewAids.getState().setDialog(null));
    await openMenu("View");
    await act(async () => row("New Guides From Shape").click());
    expect(useViewAids.getState().documents[docId]!.map(g => [g.axis, g.pos])).toEqual([["v", 10], ["v", 40], ["h", 20], ["h", 60]]);
    await openMenu("View");
    await act(async () => row("Clear Guides").click());
    expect(useViewAids.getState().documents[docId]).toEqual([]);
  });
  it("leaves New Guides From Shape out when the active layer has no shape bounds", async () => {
    await act(async () => usePhotoWorkspace.setState(s => ({ state: { ...s.state!, activeLayer: 1 } })));
    await openMenu("View");
    expect([...rows()].some(el => el.textContent!.startsWith("New Guides From Shape"))).toBe(false);
  });
});
