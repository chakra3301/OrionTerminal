import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoWorkspace } from "./runtime";
import { BrushSettingsPanel } from "./BrushPanel";
import type { PhotoState } from "./types";

const command = vi.hoisted(() => vi.fn(async (_id: string, _params: Record<string, unknown> = {}): Promise<unknown> => undefined));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));
vi.mock("./PresetPreview", () => ({ PresetPreview: ({ preset }: { preset: string }) => <span>{preset}</span> }));

let root: Root, container: HTMLDivElement;
const changed = vi.fn();
const state = (brush: Record<string, unknown> = {}, sampledTexture = false) => ({
  brush: { revision: 3, sampledTip: false, sampledTexture, presets: [{ name: "Hard Round", group: "General Brushes", builtin: true, size: 30, hardness: 1 }, { name: "Chalk", group: "Dry Media", builtin: true, size: 60, hardness: .5 }],
    settings: { size: 30, texture: { enabled: true, scale: 1, brightness: 0, contrast: 0 }, dualBrush: { enabled: true, mode: "multiply", size: 20, spacing: .25 }, ...brush } },
  presets: { patterns: [{ name: "Basics", presets: [{ id: "p-dots", name: "Dots", width: 8, height: 8 }, { id: "p-canvas", name: "Canvas", width: 16, height: 16 }] }] },
}) as unknown as PhotoState;
const render = (value: PhotoState) => act(async () => { usePhotoWorkspace.setState({ state: value }); root.render(<BrushSettingsPanel state={value} changed={changed} />); });
const group = (label: string) => container.querySelector<HTMLElement>(`[role=group][aria-label="${label}"]`);
const tip = (label: string, name: string) => group(label)!.querySelector<HTMLButtonElement>(`button[aria-label="${label}: ${name}"]`)!;
const texture = () => container.querySelector<HTMLSelectElement>('select[aria-label="Texture pattern"]');
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); command.mockReset(); changed.mockReset();
  usePhotoWorkspace.setState({ busy: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Brush Settings tip shapes, Dual Brush tip and Texture pattern", () => {
  it("sets the brush tip from a preset by name, with its size, in one brush change and resyncs the bar", async () => {
    await render(state());
    await act(async () => tip("Brush Tip Shape", "Chalk").click());
    expect(command.mock.calls).toEqual([["tools.setBrush", { tipPreset: "Chalk", size: 60 }]]);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("chooses the Dual Brush's second tip without touching the main tip", async () => {
    await render(state());
    await act(async () => tip("Dual Brush tip", "Hard Round").click());
    expect(command.mock.calls).toEqual([["tools.setBrush", { dualBrush: { tipPreset: "Hard Round", size: 30 } }]]);
  });
  it("changes nothing when the host refuses the tip", async () => {
    await render(state());
    command.mockImplementation(async () => { throw new Error("tools.setBrush: tipPreset \"Chalk\" is not a brush preset"); });
    await act(async () => tip("Brush Tip Shape", "Chalk").click());
    expect(command.mock.calls.map(([id]) => id)).toEqual(["tools.setBrush"]);
    expect(changed).not.toHaveBeenCalled();
  });
  it("marks the preset whose tip the brush and the Dual Brush carry, and a round tip on the cell picked for it", async () => {
    const pressed = (label: string) => [...group(label)!.querySelectorAll("button[aria-pressed=true]")].map(button => button.getAttribute("aria-label"));
    const tips = (tip: unknown, dualTip: unknown) => { const value = state(); return { ...value, brush: { ...value.brush, tip, dualTip } } as unknown as PhotoState; };
    await render(tips({ id: "sampled:00ff00ff00ff00ff", preset: "Chalk" }, { id: "round", preset: null }));
    expect(pressed("Brush Tip Shape")).toEqual(["Brush Tip Shape: Chalk"]); expect(pressed("Dual Brush tip")).toEqual([]);
    expect(tip("Brush Tip Shape", "Hard Round").getAttribute("aria-pressed")).toBe("false");
    await act(async () => tip("Dual Brush tip", "Hard Round").click());
    expect(pressed("Dual Brush tip")).toEqual(["Dual Brush tip: Hard Round"]);
    await render(tips({ id: "round", preset: null }, { id: "sampled:00ff00ff00ff00ff", preset: "Chalk" }));
    expect(pressed("Brush Tip Shape")).toEqual([]); expect(pressed("Dual Brush tip")).toEqual(["Dual Brush tip: Chalk"]);
    await render(state());
    expect(pressed("Brush Tip Shape")).toEqual([]);
  });
  it("picks the Texture pattern from the pattern library in one command", async () => {
    await render(state());
    const select = texture()!;
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([["", "Procedural texture"], ["p-dots", "Dots · Basics"], ["p-canvas", "Canvas · Basics"]]);
    await act(async () => { select.value = "p-canvas"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(command.mock.calls).toEqual([["brush.texturePattern", { pattern: "p-canvas" }]]);
    await render(state({}, true));
    expect(texture()!.value).toBe("");
    expect(texture()!.options[0]!.textContent).toBe("Library pattern");
  });
  it("shows the library pattern the brush texture is, without a raw id field", async () => {
    await render(state({ texture: { enabled: true, scale: 1, brightness: 0, contrast: 0, patternId: "p-canvas" } }));
    expect(texture()!.value).toBe("p-canvas");
    expect(container.querySelector('input[aria-label*="Pattern"]')).toBeNull();
    await render(state({ texture: { enabled: true, scale: 1, brightness: 0, contrast: 0, patternId: null } }, true));
    expect(texture()!.value).toBe(""); expect(container.textContent).toContain("Imported texture retained.");
  });
  it("shows the Dual Brush tips and Texture pattern only while their section is on, and nothing works while busy", async () => {
    await render(state({ texture: { enabled: false }, dualBrush: { enabled: false } }));
    expect(group("Dual Brush tip")).toBeNull(); expect(texture()).toBeNull(); expect(group("Brush Tip Shape")).not.toBeNull();
    await act(async () => usePhotoWorkspace.setState({ busy: true }));
    await render(state());
    expect(tip("Brush Tip Shape", "Chalk").disabled).toBe(true); expect(tip("Dual Brush tip", "Chalk").disabled).toBe(true); expect(texture()!.disabled).toBe(true);
  });
  it("disables the Texture pattern when the library has no patterns", async () => {
    await render({ ...state(), presets: { patterns: [] } } as unknown as PhotoState);
    expect(texture()!.disabled).toBe(true);
  });
});
