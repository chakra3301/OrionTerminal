import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoAlignDialog, AutoBlendDialog, CheckSpellingDialog, FindReplaceTextDialog, PresetManagerDialog, PresetNameDialog, PurgeDialog } from "./EditDialogs";
import { usePhotoWorkspace } from "./runtime";

const native = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({});
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: null });
  container = document.createElement("div"); container.className = "xd-photo"; document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const field = <T extends Element = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const button = (label: string) => [...container.querySelectorAll("button")].find(element => element.textContent === label)!;
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const type = (label: string, value: string) => act(async () => { const input = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const choose = (label: string, value: string) => act(async () => { const element = field<HTMLSelectElement>(label); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const submit = (form = container.querySelector("form")!) => act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("Edit menu dialogs", () => {
  it("asks before purging, like Photoshop, then runs the purge", async () => {
    const close = vi.fn();
    await act(async () => root.render(<PurgeDialog command="edit.purge.histories" close={close}/>));
    expect(container.textContent).toContain("This cannot be undone. Continue?");
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("edit.purge.histories", {});
    expect(close).toHaveBeenCalled();
  });

  it("names a preset in Photoshop's Brush, Pattern and Shape Name dialogs", async () => {
    const apply = vi.fn().mockResolvedValue({}), close = vi.fn();
    await act(async () => root.render(<PresetNameDialog kind="patterns" name="Untitled-1" apply={apply} close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Pattern Name");
    expect(field("Name").value).toBe("Untitled-1");
    await type("Name", "  ");
    expect(button("OK").disabled).toBe(true);
    await type("Name", " Tile ");
    await submit();
    expect(apply).toHaveBeenCalledWith("Tile");
    expect(close).toHaveBeenCalled();
    await act(async () => root.render(<PresetNameDialog kind="brushes" name="Dot" apply={apply} close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Brush Name");
    await act(async () => root.render(<PresetNameDialog kind="customShapes" name="Shape 2" apply={apply} close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Shape Name");
  });

  it("finds and replaces text with Photoshop's buttons and options", async () => {
    native.run.mockResolvedValueOnce({ count: 2, layers: 1 }).mockResolvedValueOnce({ found: null, changed: null });
    const close = vi.fn();
    await act(async () => root.render(<FindReplaceTextDialog close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Find and Replace Text");
    expect(["Done", "Find Next", "Change", "Change All", "Change/Find"].map(label => button(label).disabled)).toEqual([false, true, true, true, true]);
    await type("Find What", "teh"); await type("Change To", "the");
    await click(field("Case Sensitive"));
    await click(button("Change All"));
    expect(native.run).toHaveBeenLastCalledWith("edit.findAndReplaceText", { find: "teh", replace: "the", action: "changeAll", allLayers: true, forward: true, caseSensitive: true, wholeWord: false });
    expect(container.textContent).toContain("2 replacements made.");
    await click(field("Search All Layers"));
    await click(button("Find Next"));
    expect(native.run).toHaveBeenLastCalledWith("edit.findAndReplaceText", { find: "teh", replace: "the", action: "find", allLayers: false, forward: true, caseSensitive: true, wholeWord: false });
    expect(container.textContent).toContain("No more matches.");
    await click(button("Change/Find"));
    expect(native.run).toHaveBeenLastCalledWith("edit.findAndReplaceText", expect.objectContaining({ action: "changeFind" }));
    await click(button("Done"));
    expect(close).toHaveBeenCalled();
  });

  it("checks spelling word by word with Ignore, Ignore All, Change, Change All and Add", async () => {
    const teh = { layer: 3, start: 0, end: 3, word: "Teh", suggestions: ["The", "Tea"] };
    const brwon = { layer: 3, start: 10, end: 15, word: "brwon", suggestions: ["brown"] };
    const fxo = { layer: 5, start: 4, end: 7, word: "fxo", suggestions: ["fox"] };
    const lists = [[teh, brwon, fxo], [brwon, fxo], []];
    native.run.mockImplementation(async (_command: string, params: { action?: string }) => params.action ? {} : { misspellings: lists.shift() ?? [], count: 0 });
    await act(async () => root.render(<CheckSpellingDialog close={vi.fn()}/>));
    expect(native.run).toHaveBeenLastCalledWith("edit.checkSpelling", { allLayers: true, ignore: [] });
    expect(field("Not in Dictionary").value).toBe("Teh");
    expect(field("Change To").value).toBe("The");
    expect([...field<HTMLSelectElement>("Suggestions").options].map(option => option.value)).toEqual(["The", "Tea"]);
    await choose("Suggestions", "Tea");
    expect(field("Change To").value).toBe("Tea");
    await click(button("Change"));
    expect(native.run).toHaveBeenCalledWith("edit.checkSpelling", { action: "change", layer: 3, start: 0, end: 3, word: "Teh", replace: "Tea" });
    expect(field("Not in Dictionary").value).toBe("brwon");
    await click(button("Ignore"));
    expect(field("Not in Dictionary").value).toBe("fxo");
    await click(button("Ignore All"));
    expect(native.run).toHaveBeenLastCalledWith("edit.checkSpelling", { allLayers: true, ignore: ["fxo"] });
    expect(container.textContent).toContain("Spell check complete.");
    expect(button("Change").disabled).toBe(true);
  });

  it("changes every occurrence and adds words to the dictionary", async () => {
    const brwon = { layer: 3, start: 10, end: 15, word: "brwon", suggestions: ["brown"] };
    const orion = { layer: 3, start: 20, end: 25, word: "Orion", suggestions: [] };
    const lists = [[brwon, orion], [orion], []];
    native.run.mockImplementation(async (_command: string, params: { action?: string }) => params.action ? {} : { misspellings: lists.shift() ?? [], count: 0 });
    await act(async () => root.render(<CheckSpellingDialog close={vi.fn()}/>));
    await click(button("Change All"));
    expect(native.run).toHaveBeenCalledWith("edit.checkSpelling", { action: "changeAll", word: "brwon", replace: "brown", allLayers: true });
    expect(field("Change To").value).toBe("Orion");
    await click(button("Add"));
    expect(native.run).toHaveBeenCalledWith("edit.checkSpelling", { action: "addToDictionary", word: "Orion" });
    expect(container.textContent).toContain("Spell check complete.");
  });

  it("manages brush, pattern and custom shape presets by type", async () => {
    native.run.mockImplementation(async (_command: string, params: { kind: string; action?: string; newName?: string }) =>
      params.kind === "patterns" ? { patterns: ["Tile"] } : params.action === "rename" ? { brushes: ["Soft Round", params.newName] } : params.action === "delete" ? { brushes: ["Soft Round"] } : { brushes: ["Soft Round", "Dot"] });
    await act(async () => root.render(<PresetManagerDialog close={vi.fn()}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Preset Manager");
    expect(native.run).toHaveBeenLastCalledWith("edit.presets.presetManager", { kind: "brushes" });
    expect([...field<HTMLSelectElement>("Preset Type").options].map(option => option.textContent)).toEqual(["Brushes", "Patterns", "Custom Shapes"]);
    const presets = () => [...field<HTMLSelectElement>("Presets").options].map(option => option.textContent);
    expect(presets()).toEqual(["Soft Round", "Dot"]);
    expect(button("Rename…").disabled).toBe(true);
    await choose("Presets", "1");
    await click(button("Rename…"));
    const nameForm = [...container.querySelectorAll("form")].at(-1)!;
    expect(nameForm.querySelector("h3")!.textContent).toBe("Brush Name");
    await type("Name", "Spot");
    await submit(nameForm);
    expect(native.run).toHaveBeenLastCalledWith("edit.presets.presetManager", { action: "rename", kind: "brushes", index: 1, newName: "Spot" });
    expect(presets()).toEqual(["Soft Round", "Spot"]);
    await choose("Presets", "1");
    await click(button("Delete"));
    expect(native.run).toHaveBeenLastCalledWith("edit.presets.presetManager", { action: "delete", kind: "brushes", index: 1 });
    expect(presets()).toEqual(["Soft Round"]);
    await choose("Preset Type", "patterns");
    expect(native.run).toHaveBeenLastCalledWith("edit.presets.presetManager", { kind: "patterns" });
    expect(presets()).toEqual(["Tile"]);
  });

  it("auto-aligns with Photoshop's projections, their descriptions and Geometric Distortion", async () => {
    const close = vi.fn();
    await act(async () => root.render(<AutoAlignDialog close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Auto-Align Layers");
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Projection", "Lens Correction"]);
    const radios = [...container.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-label="Projection"] input')];
    expect(radios.map(radio => radio.closest("label")!.textContent)).toEqual(["Auto", "Perspective", "Collage", "Cylindrical", "Spherical", "Reposition"]);
    expect(radios[0]!.checked).toBe(true);
    expect(container.textContent).toContain("Determine the best projection automatically.");
    await click(radios[3]!);
    expect(container.textContent).toContain("Only allow cylindrical image transform.");
    expect(field("Geometric Distortion").checked).toBe(false);
    await click(field("Geometric Distortion"));
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("edit.autoAlignLayers", { projection: "cylindrical", geometricCorrection: true });
    expect(close).toHaveBeenCalled();
  });

  it("auto-blends as a panorama or stacked images with Seamless Tones and Colors", async () => {
    const close = vi.fn();
    await act(async () => root.render(<AutoBlendDialog close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Auto-Blend Layers");
    const radios = [...container.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-label="Blend Method"] input')];
    expect(radios.map(radio => radio.closest("label")!.textContent)).toEqual(["Panorama", "Stack Images"]);
    expect(radios[0]!.checked).toBe(true);
    expect(field("Seamless Tones and Colors").checked).toBe(true);
    await click(radios[1]!); await click(field("Seamless Tones and Colors"));
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("edit.autoBlendLayers", { method: "stack", seamlessTones: false });
    expect(close).toHaveBeenCalled();
  });
});
