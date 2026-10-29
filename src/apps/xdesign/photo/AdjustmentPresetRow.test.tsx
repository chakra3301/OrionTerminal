import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustmentPresetRow } from "./AdjustmentPresetRow";
import { encodeAdjustmentPreset } from "./adjustmentPresetFiles";
import { adjustmentDefaults } from "./adjustmentSettings";
import { ADJUSTMENTS } from "./controls";

const native = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: native.save }));
vi.mock("../../../lib/ipc", () => ({ ipc: { readFileBase64: native.read, writeFileBase64: native.write } }));
const levels = ADJUSTMENTS.find(action => action.id === "levels")!;
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); Object.values(native).forEach(mock => mock.mockReset()); localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = (values: Record<string, unknown>, apply = vi.fn(), fail = vi.fn()) => act(async () => root.render(<AdjustmentPresetRow action={levels} mode="RGB" values={values} locked={false} apply={apply} fail={fail}/>));
const relaunch = async (values: Record<string, unknown>, apply = vi.fn()) => { await act(async () => root.unmount()); root = createRoot(container); await render(values, apply); };
const item = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find(entry => entry.textContent?.includes(label))!;
const menu = async (label: string) => {
  await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Preset options']")!.click());
  await act(async () => item(label).click());
};
const options = () => [...container.querySelectorAll("option")].map(option => option.textContent);
const selected = () => container.querySelector("select")!;
const choose = (value: string) => act(async () => { selected().value = value; selected().dispatchEvent(new Event("change", { bubbles: true })); });
const STORE = "orion.xdesign.adjustment-presets.v1";

describe("adjustment preset row", () => {
  it("names a shipped preset and shows Custom otherwise", async () => {
    const defaults = adjustmentDefaults(levels, "RGB");
    await render({ ...defaults, inBlack: 20, inWhite: 235 });
    expect(container.querySelector("select")!.value).toBe("Increase Contrast 2");
    await render({ ...defaults, inBlack: 21 });
    expect(container.querySelector("select")!.value).toBe("Custom");
  });

  it("loads a Photoshop .alv file over the defaults", async () => {
    const apply = vi.fn(), defaults = adjustmentDefaults(levels, "RGB");
    native.open.mockResolvedValue("/tmp/contrast.alv");
    native.read.mockResolvedValue(base64(encodeAdjustmentPreset("levels", { ...defaults, inBlack: 30, inWhite: 225 }, "RGB")));
    await render(defaults, apply); await menu("Load Preset…");
    expect(native.open).toHaveBeenCalledWith({ multiple: false, filters: [{ name: "Levels Presets", extensions: ["alv"] }] });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ inBlack: 30, inWhite: 225, gamma: 1 }));
  });

  it("saves the current values in Photoshop's format", async () => {
    const values = { ...adjustmentDefaults(levels, "RGB"), gamma: 1.6 };
    native.save.mockResolvedValue("/tmp/Lighten Shadows.alv");
    await render(values); await menu("Save Preset…");
    expect(native.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "Lighten Shadows.alv" }));
    expect(native.write).toHaveBeenCalledWith("/tmp/Lighten Shadows.alv", base64(encodeAdjustmentPreset("levels", values, "RGB")));
  });

  it("lists a saved preset under its file name after the shipped ones, keeps it after a relaunch and deletes it", async () => {
    const defaults = adjustmentDefaults(levels, "RGB"), values = { ...defaults, gamma: 1.4 }, apply = vi.fn();
    native.save.mockResolvedValue("/Users/me/Presets/My Levels.alv");
    await render(values, apply); await menu("Save Preset…");
    expect(options().at(-1)).toBe("My Levels"); expect(selected().selectedOptions[0]!.textContent).toBe("My Levels");
    await relaunch(defaults, apply);
    expect(options()).toContain("My Levels"); expect(selected().value).toBe("Default");
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Preset options']")!.click());
    expect(item("Delete Current Preset").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Preset options']")!.click());
    await choose("user:My Levels"); expect(apply).toHaveBeenLastCalledWith({ ...defaults, gamma: 1.4 });
    await render(values, apply); await menu("Delete Current Preset");
    expect(options()).not.toContain("My Levels"); expect(selected().value).toBe("Custom");
    expect(JSON.parse(localStorage.getItem(STORE)!)).toEqual({ levels: [] });
  });

  it("replaces a saved preset of the same name and keeps each adjustment's presets apart", async () => {
    const defaults = adjustmentDefaults(levels, "RGB");
    native.save.mockResolvedValue("/Users/me/Mine.alv");
    await render({ ...defaults, gamma: 1.6 }); await menu("Save Preset…");
    await render({ ...defaults, gamma: .7 }); await menu("Save Preset…");
    expect(options().filter(name => name === "Mine")).toHaveLength(1); expect(selected().value).toBe("user:Mine");
    const curves = ADJUSTMENTS.find(action => action.id === "curves")!;
    await act(async () => root.render(<AdjustmentPresetRow action={curves} mode="RGB" values={adjustmentDefaults(curves, "RGB")} locked={false} apply={vi.fn()} fail={vi.fn()}/>));
    expect(options()).not.toContain("Mine");
  });

  it("drops stored presets that are malformed or not presets of their kind, and survives unreadable storage", async () => {
    const defaults = adjustmentDefaults(levels, "RGB"), good = base64(encodeAdjustmentPreset("levels", { ...defaults, inBlack: 12 }, "RGB"));
    await render(defaults); const shipped = options();
    localStorage.setItem(STORE, JSON.stringify({ levels: [{ name: "Good", data: good }, { name: "", data: good }, { name: "Junk", data: btoa("nope") }, { name: "Bad base64", data: "%%%" }, 5, null, { name: "Good", data: good }], bogus: [{ name: "Other", data: good }], curves: "x" }));
    await relaunch(defaults);
    expect(options()).toEqual([...shipped, "Good"]);
    localStorage.setItem(STORE, "{not json");
    await relaunch(defaults);
    expect(options()).toEqual(shipped);
  });

  it("reports a file that is not a preset", async () => {
    const fail = vi.fn(), apply = vi.fn();
    native.open.mockResolvedValue("/tmp/bad.alv"); native.read.mockResolvedValue(btoa("nope"));
    await render(adjustmentDefaults(levels, "RGB"), apply, fail); await menu("Load Preset…");
    expect(apply).not.toHaveBeenCalled(); expect(fail).toHaveBeenLastCalledWith("This is not a Levels preset file.");
  });
});
