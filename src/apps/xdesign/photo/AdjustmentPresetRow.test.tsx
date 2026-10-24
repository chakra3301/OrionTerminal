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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); Object.values(native).forEach(mock => mock.mockReset());
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = (values: Record<string, unknown>, apply = vi.fn(), fail = vi.fn()) => act(async () => root.render(<AdjustmentPresetRow action={levels} mode="RGB" values={values} locked={false} apply={apply} fail={fail}/>));
const menu = async (label: string) => {
  await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Preset options']")!.click());
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find(item => item.textContent?.includes(label))!.click());
};

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

  it("reports a file that is not a preset", async () => {
    const fail = vi.fn(), apply = vi.fn();
    native.open.mockResolvedValue("/tmp/bad.alv"); native.read.mockResolvedValue(btoa("nope"));
    await render(adjustmentDefaults(levels, "RGB"), apply, fail); await menu("Load Preset…");
    expect(apply).not.toHaveBeenCalled(); expect(fail).toHaveBeenLastCalledWith("This is not a Levels preset file.");
  });
});
