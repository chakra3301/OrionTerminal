import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { PhotoStudio } from "./PhotoStudio";
import type { PhotoDocument, PhotoState } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: vi.fn(async () => undefined) }));
vi.mock("./PhotoTiles", async original => ({ ...await original<typeof import("./PhotoTiles")>(), PhotoTiles: () => <div data-testid="detail-tiles"/> }));

let root: Root, container: HTMLDivElement;
const openMenu = async (...path: string[]) => { for (const [index, label] of path.entries()) await act(async () => [...container.querySelectorAll<HTMLButtonElement>(index ? "[role=menu] > button" : "[role=menubar] > button")].find(el => el.textContent?.startsWith(label))!.click()); };
const closeMenus = async () => { for (let menu = container.querySelector("[role=menu]"); menu; menu = container.querySelector("[role=menu]")) await act(async () => { [...container.querySelectorAll("[role=menu]")].at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); };
const rows = () => [...container.querySelectorAll<HTMLButtonElement>("[role=menu]")].at(-1)!.querySelectorAll<HTMLButtonElement>(":scope > button");
const row = (label: string) => [...rows()].find(el => el.textContent?.replace(/[^\p{L}\p{N}… ]/gu, "").trim().startsWith(label))!;
const dialog = (label: string) => container.querySelector(`[role="dialog"][aria-label="${label}"]`);
const key = (init: KeyboardEventInit) => act(async () => { container.querySelector(".xd-photo-stage")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const state: PhotoState = { name: "Portrait", width: 800, height: 600, mode: "RGB", depth: 8, resolution: 72, activeLayer: 2, hasSelection: false, selectionBounds: null, layers: [
  { id: 1, name: "Background", kind: "Pixel", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false },
  { id: 2, name: "Curves 1", kind: "Adjustment", visible: false, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false }], canUndo: true, canRedo: false, paths: { saved: [], work: false } };
const patch = (next: Partial<PhotoState>) => act(async () => usePhotoWorkspace.setState({ state: { ...usePhotoWorkspace.getState().state!, ...next } }));

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.mocked(runPhotoCommand).mockClear();
  useXDesign.getState().hydrate(null);
  const docId = ulid(), version = ulid();
  const doc: PhotoDocument = { id: docId, version, name: "Portrait", width: 800, height: 600, previewWidth: 800, previewHeight: 600, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null };
  const placement = useXDesign.getState().applyPhotoDocument(doc);
  usePhotoWorkspace.setState({ shapeId: placement, documentId: docId, projectId: ulid(), source: "legacy", state, stateVersion: version, busy: false, error: null, warnings: [] });
  useXDProjects.setState({ activeId: usePhotoWorkspace.getState().projectId, transitioning: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PhotoStudio/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); usePhotoWorkspace.getState().close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("File menu", () => {
  it("lists Automate, Scripts and File Info after Place Linked, like Photoshop", async () => {
    await openMenu("File");
    const labels = [...rows()].map(el => el.textContent!);
    const at = (name: string) => labels.findIndex(text => text.startsWith(name));
    expect([at("Export"), at("Place Embedded…"), at("Place Linked…"), at("Automate"), at("Scripts"), at("File Info…")].every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]!))).toBe(true);
    expect(row("File Info…").dataset.shortcut).toBe("⌥⇧⌘I");
    await closeMenus(); await openMenu("File", "Automate");
    expect([...rows()].map(el => el.textContent)).toEqual(["Crop and Straighten Photos", "Conditional Mode Change…", "Fit Image…"]);
    await closeMenus(); await openMenu("File", "Scripts");
    expect([...rows()].map(el => el.textContent)).toEqual(["Delete All Empty Layers", "Flatten All Layer Effects", "Flatten All Masks"]);
    await closeMenus(); await openMenu("File", "Export");
    expect([...rows()].map(el => el.textContent!.replace(/[^\p{L}\p{N}… ]/gu, "").trim())).toEqual(["Export As…", "Artboards to PDF…", "Layers to Files…", "Color Lookup Tables…", "Paths to Illustrator…"]);
  });

  it("offers Save a Copy… after Save, with Photoshop PDF, and Artboards to PDF… only with artboards", async () => {
    await openMenu("File");
    const labels = [...rows()].map(el => el.textContent!.replace(/[^\p{L}\p{N}… ]/gu, "").trim());
    expect(labels.indexOf("Save a Copy…")).toBe(labels.indexOf("Save") + 1);
    expect(row("Save a Copy…").dataset.shortcut).toBe("⌥⌘S");
    await act(async () => row("Save a Copy…").click());
    const copy = dialog("Save a Copy")!;
    expect([...copy.querySelectorAll("option")].map(option => option.textContent)).toContain("Photoshop PDF");
    expect([...copy.querySelectorAll("button")].map(el => el.textContent)).toContain("Save");
    await act(async () => [...copy.querySelectorAll("button")].find(el => el.textContent === "Cancel")!.click());
    await openMenu("File", "Export");
    expect(row("Artboards to PDF…").disabled).toBe(true);
    await closeMenus();
    const board = { id: 3, name: "Artboard 1", kind: "Group", visible: true, opacity: 1, fill: 1, blend: "Pass Through", clipped: false, hasMask: false, artboard: { rect: [0, 0, 400, 300] as [number, number, number, number], background: "white", preset: null }, children: [] };
    await patch({ layers: [...state.layers, board], activeLayer: 3, selectedLayers: [3] });
    await openMenu("File", "Export");
    await act(async () => row("Artboards to PDF…").click());
    const selected = dialog("Artboards To PDF")!.querySelector<HTMLInputElement>('[aria-label="Export Selected Artboards"]')!;
    expect([selected.disabled, selected.checked]).toEqual([false, false]);
  });

  it("runs the Scripts items with no parameters", async () => {
    for (const [label, command] of [["Delete All Empty Layers", "file.scripts.deleteAllEmptyLayers"], ["Flatten All Layer Effects", "file.scripts.flattenAllLayerEffects"], ["Flatten All Masks", "file.scripts.flattenAllMasks"]]) {
      await openMenu("File", "Scripts");
      await act(async () => row(label!).click());
      expect(runPhotoCommand).toHaveBeenLastCalledWith(command, {});
    }
  });

  it("runs Crop and Straighten Photos with no parameters", async () => {
    await openMenu("File", "Automate");
    await act(async () => row("Crop and Straighten Photos").click());
    expect(runPhotoCommand).toHaveBeenLastCalledWith("file.automate.cropAndStraightenPhotos", {});
  });

  it("enables Color Lookup Tables only with a visible adjustment layer and Paths to Illustrator only with paths", async () => {
    await openMenu("File", "Export");
    expect([row("Color Lookup Tables…").disabled, row("Paths to Illustrator…").disabled]).toEqual([true, true]);
    await closeMenus(); await patch({ layers: state.layers.map(layer => ({ ...layer, visible: true })), paths: { saved: [], work: true } });
    await openMenu("File", "Export");
    expect([row("Color Lookup Tables…").disabled, row("Paths to Illustrator…").disabled]).toEqual([false, false]);
  });

  it("opens the File Info, Automate and Export dialogs", async () => {
    await key({ key: "Î", code: "KeyI", metaKey: true, altKey: true, shiftKey: true });
    expect(dialog("File Info")).not.toBeNull();
    expect(runPhotoCommand).toHaveBeenCalledWith("file.fileInfo", {});
    await act(async () => [...dialog("File Info")!.querySelectorAll("button")].find(el => el.textContent === "Cancel")!.click());
    for (const [path, title] of [[["Automate", "Fit Image…"], "Fit Image"], [["Automate", "Conditional Mode Change…"], "Conditional Mode Change"], [["Export", "Layers to Files…"], "Export Layers To Files"]] as const) {
      await openMenu("File", path[0]);
      await act(async () => row(path[1]).click());
      expect(dialog(title)).not.toBeNull();
      await act(async () => [...dialog(title)!.querySelectorAll("button")].find(el => el.textContent === "Cancel")!.click());
      expect(dialog(title)).toBeNull();
    }
    await openMenu("File", "Automate");
    await act(async () => row("Fit Image…").click());
    expect([...dialog("Fit Image")!.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(["800", "600"]);
  });
});

describe("Image › Duplicate…", () => {
  const field = (label: string) => dialog("Duplicate Image")!.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const openDuplicate = async () => { await openMenu("Image"); await act(async () => row("Duplicate…").click()); };
  const submit = () => act(async () => { dialog("Duplicate Image")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

  it("sits before Apply Image… and names the copy after the image", async () => {
    await openMenu("Image");
    const labels = [...rows()].map(el => el.textContent!.replace(/[^\p{L}\p{N}… ]/gu, "").trim());
    expect(labels.indexOf("Duplicate…")).toBe(labels.indexOf("Apply Image…") - 1);
    await closeMenus(); await openDuplicate();
    expect(dialog("Duplicate Image")!.querySelector(".xd-ps-dialog-text")!.textContent).toBe("Duplicate: Portrait");
    expect([field("As").value, field("Duplicate Merged Layers Only").disabled, field("Duplicate Merged Layers Only").checked]).toEqual(["Portrait copy", false, false]);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field("As"), "Portrait flat"); field("As").dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => field("Duplicate Merged Layers Only").click());
    await submit();
    expect(runPhotoCommand).toHaveBeenLastCalledWith("image.duplicate", { name: "Portrait flat", mergedOnly: true });
    expect(dialog("Duplicate Image")).toBeNull();
  });

  it("offers Duplicate Merged Layers Only only with more than one layer", async () => {
    await patch({ layers: state.layers.slice(0, 1) });
    await openDuplicate();
    expect(field("Duplicate Merged Layers Only").disabled).toBe(true);
    await submit();
    expect(runPhotoCommand).toHaveBeenLastCalledWith("image.duplicate", { name: "Portrait copy", mergedOnly: false });
  });
});
