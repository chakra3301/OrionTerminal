import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerCompDialogs, LayerCompsPanel, layerCompsPanelMenu, useLayerComps } from "./LayerCompsPanel";
import { DataPointsDialog, MeasurementLogPanel, measurementLogPanelMenu, useMeasurementLog } from "./MeasurementLogPanel";
import { TypeStyleDialogs, TypeStylesPanel, typeStylesPanelMenu, useTypeStyles } from "./TypeStylesPanel";
import { usePhotoWorkspace } from "./runtime";
import type { MenuItem } from "../menuModel";
import type { PhotoPanels } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async () => []), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save, open: vi.fn() }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.save.mockReset();
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const by = <T extends Element = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const click = (label: string, init: MouseEventInit = {}) => act(async () => { by(label).dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })); });
const dblclick = (label: string) => act(async () => { by(label).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
const type = (label: string, value: string) => act(async () => { const input = by<HTMLInputElement>(label); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const pick = (label: string, value: string) => act(async () => { const s = by<HTMLSelectElement>(label); s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });
const submit = () => act(async () => { container.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!.click(); });
const menuItem = (items: ReturnType<typeof layerCompsPanelMenu>, label: string) => items.find((item): item is MenuItem => item !== "-" && item.label === label)!;
const labels = (items: ReturnType<typeof layerCompsPanelMenu>) => items.map(item => item === "-" ? "-" : item.label);

const comps: PhotoPanels["layerComps"] = { comps: [
  { id: 1, name: "Layer Comp 1", comment: "", visibility: true, position: true, appearance: true, missingLayers: 0 },
  { id: 2, name: "Hero", comment: "Blue sky", visibility: true, position: false, appearance: true, missingLayers: 2 },
], lastApplied: 1, hasLastDocumentState: true };

describe("Layer Comps panel", () => {
  beforeEach(() => useLayerComps.setState({ selected: null, dialog: null }));
  it("applies, toggles, updates and steps through comps like Photoshop's panel", async () => {
    await act(async () => root.render(<><LayerCompsPanel comps={comps}/><LayerCompDialogs comps={comps}/></>));
    expect(by("Apply Layer Comp 1").getAttribute("aria-pressed")).toBe("true"); expect(by("Apply Hero").getAttribute("aria-pressed")).toBe("false");
    expect(by("Hero cannot be fully restored")).not.toBeNull(); expect(by("Layer Comp 1 cannot be fully restored")).toBeNull();
    await click("Apply Hero"); expect(native.run).toHaveBeenLastCalledWith("layerComp.apply", { comp: 2 });
    await click("Position of Hero"); expect(native.run).toHaveBeenLastCalledWith("layerComp.setOptions", { comp: 2, position: true });
    await click("Hero"); await click("Update Visibility"); expect(native.run).toHaveBeenLastCalledWith("layerComp.update", { comp: 2, what: "visibility" });
    await click("Update Position"); expect(native.run).toHaveBeenLastCalledWith("layerComp.update", { comp: 2, what: "position" });
    await click("Update Appearance"); expect(native.run).toHaveBeenLastCalledWith("layerComp.update", { comp: 2, what: "appearance" });
    await click("Update Layer Comp"); expect(native.run).toHaveBeenLastCalledWith("layerComp.update", { comp: 2, what: "all" });
    await click("Apply Previous Selected Layer Comp"); expect(native.run).toHaveBeenLastCalledWith("layerComp.previous", {});
    await click("Apply Next Selected Layer Comp"); expect(native.run).toHaveBeenLastCalledWith("layerComp.next", {});
    await click("Apply Last Document State"); expect(native.run).toHaveBeenLastCalledWith("layerComp.restoreLastDocumentState", {});
    await click("Show comment for Hero"); expect(container.textContent).toContain("Blue sky");
    await click("Delete Layer Comp"); expect(native.run).toHaveBeenLastCalledWith("layerComp.delete", { comp: 2 });
  });
  it("creates comps and edits their options in Photoshop's dialog", async () => {
    await act(async () => root.render(<><LayerCompsPanel comps={comps}/><LayerCompDialogs comps={comps}/></>));
    await click("Create New Layer Comp"); expect(by('New Layer Comp')).not.toBeNull(); expect(by<HTMLInputElement>("Layer comp name").value).toBe("Layer Comp 3");
    await click("Apply position"); await type("Layer comp comment", "note"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layerComp.new", { name: "Layer Comp 3", visibility: true, position: false, appearance: true, comment: "note" });
    await dblclick("Hero"); expect(by("Layer Comp Options")).not.toBeNull(); expect(by<HTMLInputElement>("Apply position").checked).toBe(false);
    await type("Layer comp name", "Hero 2"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layerComp.setOptions", { comp: 2, name: "Hero 2", visibility: true, position: false, appearance: true, comment: "Blue sky" });
  });
  it("offers Photoshop's panel menu", async () => {
    await act(async () => root.render(<><LayerCompsPanel comps={comps}/><LayerCompDialogs comps={comps}/></>)); await click("Hero");
    const items = layerCompsPanelMenu(comps, false);
    expect(labels(items)).toEqual(["New Layer Comp…", "Duplicate Layer Comp", "Delete Layer Comp", "Update Layer Comp", "Apply Layer Comp", "Next Layer Comp", "Previous Layer Comp", "Restore Last Document State", "-", "Layer Comp Options…", "Clear All Layer Comp Warnings"]);
    await act(async () => menuItem(items, "Duplicate Layer Comp").run?.()); expect(native.run).toHaveBeenLastCalledWith("layerComp.duplicate", { comp: 2 });
    await act(async () => menuItem(items, "Clear All Layer Comp Warnings").run?.()); expect(native.run).toHaveBeenLastCalledWith("layerComp.updateWarnings", { clear: true });
    expect(menuItem(layerCompsPanelMenu({ ...comps, comps: [] }, false), "Update Layer Comp").disabled).toBe(true);
  });
});

const log: PhotoPanels["measurementLog"] = {
  rows: [{ id: 1, values: { label: "Measurement 1", source: "Ruler Tool", length: 50, angle: 53.13 } }, { id: 2, values: { label: "Measurement 2", source: "Count Tool", count: 3 } }],
  columns: [{ key: "label", name: "Label" }, { key: "source", name: "Source" }, { key: "count", name: "Count" }, { key: "length", name: "Length" }, { key: "angle", name: "Angle" }],
  dataPoints: { selection: ["label", "source", "area"], ruler: ["label", "source", "length", "angle"], count: ["label", "source", "count"] },
  available: {
    selection: [{ key: "label", name: "Label" }, { key: "source", name: "Source" }, { key: "area", name: "Area" }],
    ruler: [{ key: "label", name: "Label" }, { key: "source", name: "Source" }, { key: "length", name: "Length" }, { key: "angle", name: "Angle" }],
    count: [{ key: "label", name: "Label" }, { key: "source", name: "Source" }, { key: "count", name: "Count" }],
  },
};

describe("Measurement Log", () => {
  it("records, lists, deletes and exports measurements", async () => {
    useMeasurementLog.setState({ selected: [], dialog: false });
    await act(async () => root.render(<MeasurementLogPanel log={log}/>));
    expect([...container.querySelectorAll("th")].map(th => th.textContent)).toEqual(["Label", "Source", "Count", "Length", "Angle"]);
    expect(container.querySelector("tbody tr")!.textContent).toContain("53.13");
    await click("Record Measurements"); expect(native.run).toHaveBeenLastCalledWith("image.analysis.recordMeasurements", { source: "auto" });
    expect(by<HTMLButtonElement>("Delete selected measurements").disabled).toBe(true);
    await click("Measurement 1"); await click("Delete selected measurements"); expect(native.run).toHaveBeenLastCalledWith("measurementLog.delete", { rows: [1] });
    await click("Select All"); native.save.mockResolvedValueOnce("/tmp/log.csv"); await click("Export selected measurements");
    expect(native.save).toHaveBeenCalledWith({ defaultPath: "Measurements.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    expect(native.run).toHaveBeenLastCalledWith("measurementLog.export", { path: "/tmp/log.csv", rows: [1, 2] });
    await click("Deselect All"); expect(by<HTMLButtonElement>("Export selected measurements").disabled).toBe(true);
    await click("Measurement 2"); await click("Measurement 1", { shiftKey: true }); expect(useMeasurementLog.getState().selected).toEqual([2, 1]);
    expect(labels(measurementLogPanelMenu(log, false))).toEqual(["Select All", "Deselect All", "Export Selected…", "Delete Selected"]);
  });
  it("chooses data points per source like Select Data Points › Custom…", async () => {
    useMeasurementLog.setState({ dialog: true });
    await act(async () => root.render(<DataPointsDialog log={log}/>));
    expect(by<HTMLInputElement>("Data point Label").checked).toBe(true); expect(by<HTMLInputElement>("Ruler Tool Angle").checked).toBe(true);
    await click("Ruler Tool Angle"); await click("Data point Source"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.analysis.selectDataPoints", { selection: ["label", "area"], ruler: ["label", "length"], count: ["label", "count"] });
  });
});

const char = (patch: Record<string, unknown> = {}) => ({ font_family: "Inter", font_style: "", weight: 400, italic: false, size_pt: 12, color: { mode: "Rgb", c: [1, 0, 0, 0], alpha: 1 }, tracking: 0, leading_pt: null, baseline_shift_pt: 0, horizontal_scale: 1, vertical_scale: 1, underline: false, strikethrough: false, faux_bold: false, faux_italic: false, kerning: "Metrics", caps: "Normal", ...patch });
const para = (patch: Record<string, unknown> = {}) => ({ align: "Left", first_line_indent_pt: 0, start_indent_pt: 0, end_indent_pt: 0, space_before_pt: 0, space_after_pt: 0, auto_leading: 1.2, direction: "Auto", hyphenate: false, ...patch });
const styles: PhotoPanels["textStyles"] = {
  character: [{ id: 0, name: "None", attrs: {}, resolved: char() }, { id: 1, name: "Title", attrs: { size_pt: 30 }, resolved: char({ size_pt: 30 }) }],
  paragraph: [{ id: 0, name: "Basic Paragraph", paragraphAttrs: {}, characterAttrs: {}, resolved: { paragraph: para(), character: char() } }, { id: 2, name: "Body", paragraphAttrs: { align: "Center" }, characterAttrs: {}, resolved: { paragraph: para({ align: "Center" }), character: char() } }],
  current: { character: 1, characterOverride: true, paragraph: 0, paragraphOverride: false },
};

describe("Character and Paragraph Styles panels", () => {
  beforeEach(() => useTypeStyles.setState({ selected: { character: null, paragraph: null }, dialog: null }));
  it("applies character styles to the selected type, Alt-click clearing overrides", async () => {
    await act(async () => root.render(<><TypeStylesPanel kind="character" styles={styles}/><TypeStyleDialogs styles={styles}/></>));
    expect(by("Title").textContent).toBe("Title+"); expect(by("Title").getAttribute("aria-current")).toBe("true");
    await click("None"); expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.apply", { id: 0 });
    await click("Title", { altKey: true }); expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.apply", { id: 1, clearOverrides: true });
    await click("Clear Override"); expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.clearOverride", {});
    await click("Redefine Character Style by Merging Overrides"); expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.redefine", { id: 1 });
    await click("Create New Character Style"); expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.new", {});
    await click("Delete Character Style"); expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.delete", { id: 1 });
    await act(async () => root.render(<TypeStylesPanel kind="character" styles={{ ...styles, current: null }}/>)); native.run.mockClear();
    await click("None"); expect(native.run).not.toHaveBeenCalled(); expect(by<HTMLButtonElement>("Delete Character Style").disabled).toBe(true);
    expect(by<HTMLButtonElement>("Clear Override").disabled).toBe(true);
  });
  it("edits only the changed character attributes in Character Style Options", async () => {
    await act(async () => root.render(<><TypeStylesPanel kind="character" styles={styles}/><TypeStyleDialogs styles={styles}/></>));
    await dblclick("Title"); expect(by("Character Style Options")).not.toBeNull();
    expect(by<HTMLInputElement>("Style name").value).toBe("Title"); expect(by<HTMLInputElement>("Size").value).toBe("30"); expect(by<HTMLInputElement>("Color").value).toBe("#ff0000");
    await type("Size", "36"); await click("Underline"); await click("Advanced Character Formats"); await type("Horizontal scale", "90"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("type.characterStyle.set", { id: 1, attrs: { size: 36, underline: true, horizontalScale: 90 } });
    expect(labels(typeStylesPanelMenu("character", styles, false))).toEqual(["New Character Style…", "Duplicate Style", "Delete Style", "Redefine Style", "Style Options…", "Clear Override"]);
  });
  it("applies and edits paragraph styles", async () => {
    await act(async () => root.render(<><TypeStylesPanel kind="paragraph" styles={styles}/><TypeStyleDialogs styles={styles}/></>));
    expect(by("Basic Paragraph").getAttribute("aria-current")).toBe("true"); expect(by<HTMLButtonElement>("Delete Paragraph Style").disabled).toBe(true);
    await click("Body"); expect(native.run).toHaveBeenLastCalledWith("type.paragraphStyle.apply", { id: 2 });
    await dblclick("Body"); expect(by("Paragraph Style Options")).not.toBeNull(); await click("Indents and Spacing");
    expect(by<HTMLSelectElement>("Alignment").value).toBe("center"); await pick("Alignment", "justifyAll"); await type("Left indent", "10");
    await click("Hyphenation"); await click("Hyphenate"); await type("Style name", "Body Copy"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("type.paragraphStyle.set", { id: 2, name: "Body Copy", attrs: { align: "justifyAll", startIndent: 10, hyphenate: true } });
    const items = typeStylesPanelMenu("paragraph", styles, false); expect(menuItem(items, "New Paragraph Style…")).toBeTruthy();
    await act(async () => menuItem(items, "Duplicate Style").run?.()); expect(native.run).toHaveBeenLastCalledWith("type.paragraphStyle.duplicate", { id: 2 });
  });
});
