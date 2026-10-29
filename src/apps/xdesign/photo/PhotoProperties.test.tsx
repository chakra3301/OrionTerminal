import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentProperties } from "./DocumentProperties";
import { MaskSection } from "./LayerProperties";
import type { PhotoLayer, PhotoState } from "./types";

const command = vi.hoisted(() => vi.fn());
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); command.mockReset().mockResolvedValue({}); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = (label: string) => act(async () => byLabel(label).click());
const text = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
const enter = (label: string, value: string) => act(async () => {
  const input = byLabel(label) as HTMLInputElement;
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});

const state = { width: 800, height: 600, mode: "RGB", depth: 8, resolution: 72, colorProfile: { description: "sRGB IEC61966-2.1", colorSpace: "RGB", embedded: true, bytes: 3144 } } as PhotoState;
const layer = (hasMask: boolean) => ({ id: 7, name: "Layer 7", kind: "Pixel", hasMask } as PhotoLayer);

describe("Document properties (nothing selected)", () => {
  const render = (props: Partial<Parameters<typeof DocumentProperties>[0]> = {}) => act(async () => root.render(<DocumentProperties state={state} disabled={false} display="both" setDisplay={() => {}} imageSize={() => {}} addText={() => {}} profileInfo={() => {}} {...props}/>));

  it("reads the canvas size, resolution, mode and profile", async () => {
    await render();
    expect((byLabel("Canvas width") as HTMLInputElement).value).toBe("800");
    expect((byLabel("Canvas height") as HTMLInputElement).value).toBe("600");
    expect((byLabel("Resolution") as HTMLInputElement).value).toBe("72");
    expect(container.textContent).toContain("Mode: RGB Color · 8-bit · sRGB IEC61966-2.1 (Embedded)");
  });

  it("resizes the canvas about the centre, keeping the aspect while linked", async () => {
    await render();
    await enter("Canvas width", "400");
    expect(command).toHaveBeenCalledWith("image.canvasSize", { width: 400, height: 300, anchor: "center", extensionColor: "background" });
    await click("Link canvas width and height");
    await enter("Canvas height", "500");
    expect(command).toHaveBeenLastCalledWith("image.canvasSize", { width: 800, height: 500, anchor: "center", extensionColor: "background" });
  });

  it("changes resolution without resampling and runs the quick actions", async () => {
    const imageSize = vi.fn();
    await render({ imageSize });
    await enter("Resolution", "300");
    expect(command).toHaveBeenCalledWith("image.imageSize", { width: 800, height: 600, resolution: 300, resample: "none" });
    await act(async () => text("Image Size…").click()); expect(imageSize).toHaveBeenCalled();
    await act(async () => text("Trim").click()); expect(command).toHaveBeenLastCalledWith("image.trim", {});
    const trim = vi.fn(); command.mockClear(); await render({ trim });
    await act(async () => text("Trim…").click()); expect(trim).toHaveBeenCalledOnce(); expect(command).not.toHaveBeenCalled();
    await act(async () => text("Rotate 90°").click()); expect(command).toHaveBeenLastCalledWith("image.imageRotation.90cw", {});
  });

  it("disables every control while busy", async () => {
    await render({ disabled: true });
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
    expect((byLabel("Canvas width") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("Layer mask properties", () => {
  const render = (hasMask: boolean, props: Partial<Parameters<typeof MaskSection>[0]> = {}) => act(async () => root.render(<MaskSection layer={layer(hasMask)} view="off" hasSelection={true} disabled={false} refine={() => {}} colorRange={() => {}} {...props}/>));

  it("offers the add-mask buttons while the layer has none", async () => {
    await render(false);
    await click("Add pixel mask"); expect(command).toHaveBeenLastCalledWith("layer.layerMask.revealAll", {});
    await click("Hide all (add black mask)"); expect(command).toHaveBeenLastCalledWith("layer.layerMask.hideAll", {});
    await click("Mask selection"); expect(command).toHaveBeenLastCalledWith("layer.layerMask.revealSelection", {});
    expect(container.querySelector('[aria-label="Delete Mask"]')).toBeNull();
  });

  it("dispatches the footer icon buttons", async () => {
    await render(true);
    await click("Load Selection from Mask"); expect(command).toHaveBeenLastCalledWith("select.loadSelection", { channel: "mask", layer: 7 });
    await click("Apply Mask"); expect(command).toHaveBeenLastCalledWith("layer.layerMask.apply", {});
    await click("Disable/Enable Mask"); expect(command).toHaveBeenLastCalledWith("layer.layerMask.enabled", { layer: 7 });
    await click("Delete Mask"); expect(command).toHaveBeenLastCalledWith("layer.layerMask.delete", {});
  });

  it("switches the mask view and opens the refine dialogs", async () => {
    const refine = vi.fn(), colorRange = vi.fn();
    await render(true, { refine, colorRange });
    await act(async () => { const select = byLabel("Layer mask view") as HTMLSelectElement; select.value = "gray"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(command).toHaveBeenLastCalledWith("view.layerMask", { layer: 7, mode: "gray" });
    await act(async () => text("Select and Mask…").click()); await act(async () => text("Color Range…").click());
    expect(refine).toHaveBeenCalled(); expect(colorRange).toHaveBeenCalled();
  });

  it("opens Select and Mask without a selection, like Photoshop, and is inert while busy", async () => {
    await render(true, { hasSelection: false });
    expect(text("Select and Mask…").disabled).toBe(false);
    await render(true, { disabled: true });
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
  });
});
