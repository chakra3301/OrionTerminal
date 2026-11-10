import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { ColorProfileDialog, type ColorProfileWorkflow } from "./ColorProfileDialog";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoState } from "./types";
const native = vi.hoisted(() => ({ invoke: vi.fn(), enabled: false }));
const picker = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const command = vi.hoisted(() => vi.fn<(id: string, params?: Record<string, unknown>) => Promise<unknown>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.enabled, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: picker }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));
let root: Root, container: HTMLDivElement, doc: PhotoDocument, close: ReturnType<typeof vi.fn<() => void>>, create: ReturnType<typeof vi.fn<() => string>>, revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === name || button.getAttribute("aria-label") === name)!;
const click = (name: string) => act(async () => button(name).click());
const previewBox = () => [...container.querySelectorAll(".xd-ps-dialog-buttons label")].find(label => label.textContent === "Preview")?.querySelector("input")!;
const preview = async () => { if (!previewBox().checked) await act(async () => previewBox().click()); };
const altReset = async () => {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
  await act(async () => { button("Reset").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); });
};
const pick = (name: string, value: string) => act(async () => { const input = container.querySelector<HTMLSelectElement>(`[aria-label="${name}"]`)!; input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
const mount = (kind: ColorProfileWorkflow) => act(async () => root.render(<ColorProfileDialog kind={kind} document={doc} close={close}/>));
const info = { description: "Custom P3", colorSpace: "Rgb", version: "4.3", class: "Display", bytes: 1024, lut: false, intents: ["relative", "perceptual"] };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.enabled = false; native.invoke.mockReset(); native.invoke.mockResolvedValue({ width: 64, height: 48, png: "AA==" }); picker.mockReset(); picker.mockResolvedValue("/picked/Profile.icc"); command.mockReset(); command.mockResolvedValue(undefined);
  close = vi.fn(); create = vi.fn(() => "blob:profile"); revoke = vi.fn(); vi.stubGlobal("URL", class extends URL { static override createObjectURL() { return create(); } static override revokeObjectURL(url: string) { revoke(url); } });
  const id = ulid(), version = ulid(); doc = { id, version, name: "Profile image", width: 64, height: 48, previewWidth: 64, previewHeight: 48, bundlePath: "", previewPath: "/image.png", originalPath: null };
  const state: PhotoState = { name: doc.name, width: 64, height: 48, mode: "RGB", depth: 16, resolution: 72, activeLayer: 1, hasSelection: false, selectionBounds: null, layers: [], canUndo: false, canRedo: false, viewKey: "composite", colorProfile: { description: "sRGB", colorSpace: "Rgb", embedded: false, bytes: 0 } };
  usePhotoWorkspace.setState({ documentId: id, stateVersion: version, state, projectId: ulid(), busy: false, error: null }); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); usePhotoWorkspace.getState().close(); });
describe("native color profile workflows", () => {
  it("hydrates saved 8-bit conversion options and uses the same dither choice for preview and Apply", async () => {
    usePhotoWorkspace.setState(current => ({ state: { ...current.state!, depth: 8, colorSettings: { revision: "default", settings: { workingRgb: "srgb", workingCmyk: "coated-cmyk", workingGray: "sgray", policyRgb: "preserve", policyCmyk: "preserve", policyGray: "preserve", askOnMismatch: true, askOnPaste: true, askOnMissing: false, intent: "absolute", bpc: false, dither: false, blendTextGamma: 1.45, monitorProfile: "srgb" }, working: { workingRgb: { description: "sRGB", colorSpace: "Rgb", custom: false, source: null }, workingCmyk: { description: "CMYK", colorSpace: "Cmyk", custom: false, source: null }, workingGray: { description: "Gray", colorSpace: "Gray", custom: false, source: null } } } } }));
    await mount("convert");
    const toggle = container.querySelector<HTMLInputElement>('[aria-label="Dither profile conversion"]')!;
    expect(toggle.checked).toBe(false); expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click()); await pick("Color profile", "display-p3"); await preview();
    const params = { profile: "display-p3", intent: "absolute", bpc: false, dither: true };
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "edit.convertToProfile", params }));
    await click("OK"); expect(command).toHaveBeenLastCalledWith("edit.convertToProfile", params);
  });
  it("disables conversion dithering above 8-bit and leaves proof/assignment controls separate", async () => {
    await mount("convert");
    const toggle = container.querySelector<HTMLInputElement>('[aria-label="Dither profile conversion"]')!;
    expect(toggle.disabled).toBe(true); expect(toggle.checked).toBe(false);
    await click("OK"); expect(command).toHaveBeenLastCalledWith("edit.convertToProfile", { profile: "working", intent: "relative", bpc: true, dither: false });
    await act(async () => root.unmount()); root = createRoot(container); await mount("proof");
    expect(container.querySelector('[aria-label="Dither profile conversion"]')).toBeNull();
  });
  it("sends proof simulations, paper, gamut and precise threshold together", async () => {
    await mount("proof"); await pick("Color profile", "coated-cmyk"); await pick("Proof simulation", "colorBlindnessProtanopia");
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Simulate paper color"]')!.click());
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Gamut Warning"]')!.click());
    await pick("Profile rendering intent", "absolute"); await preview();
    const params = { profile: "coated-cmyk", kind: "colorBlindnessProtanopia", intent: "absolute", bpc: true, simulatePaper: true, on: true, gamutWarning: true, threshold: 0 };
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "view.proofSetup", params, viewKey: "composite" }));
    await click("OK"); expect(command).toHaveBeenLastCalledWith("view.proofSetup", params); expect(close).toHaveBeenCalledOnce();
  });
  it("hydrates retained proof settings and keeps its custom profile without reimport", async () => {
    usePhotoWorkspace.setState(current => ({ state: { ...current.state!, colorView: { profile: "current", description: "Saved custom proof", kind: "profile", intent: "perceptual", bpc: false, simulatePaper: true, on: false, gamutWarning: true, threshold: 0.125, hdr: { highlightCompression: false, exposure: 0, gamma: 1 }, active: true } } }));
    await mount("proof"); expect(container.textContent).toContain("Saved custom proof"); expect(button("Read profile details").disabled).toBe(true); await click("OK");
    expect(command).toHaveBeenLastCalledWith("view.proofSetup", { profile: "current", kind: "profile", intent: "perceptual", bpc: false, simulatePaper: true, on: false, gamutWarning: true, threshold: 0.125 }); expect(picker).not.toHaveBeenCalled();
  });
  it("retains chosen custom proof bytes for the native compound command", async () => {
    command.mockResolvedValueOnce({ profile: info, profileSource: "/picked/Profile.icc", profileData: "AA==" }); await mount("proof"); await click("Choose ICC profile…"); await click("OK"); expect(command).toHaveBeenLastCalledWith("view.proofSetup", expect.objectContaining({ profile: "/picked/Profile.icc", profileData: "AA==", kind: "profile", on: true }));
  });
  it("admits HDR only on 32-bit images and sends native viewing values", async () => {
    await mount("hdr"); expect(button("OK").disabled).toBe(true); expect(container.textContent).toContain("need a 32-bit image");
    await act(async () => root.unmount()); root = createRoot(container); usePhotoWorkspace.setState(current => ({ state: { ...current.state!, depth: 32, colorView: { profile: "coated-cmyk", description: "CMYK", kind: "profile", intent: "relative", bpc: true, simulatePaper: false, on: false, gamutWarning: false, threshold: 0, hdr: { highlightCompression: false, exposure: -1.25, gamma: 2.2 }, active: true } } }));
    await mount("hdr"); expect(container.querySelector('[aria-label="Color profile"]')).toBeNull(); await click("OK"); expect(command).toHaveBeenLastCalledWith("view.thirtyTwoBitPreviewOptions", { method: "exposureGamma", exposure: -1.25, gamma: 2.2 });
  });
  it("exposes the native highlight preview and disables its unused numeric controls", async () => {
    usePhotoWorkspace.setState(current => ({ state: { ...current.state!, depth: 32 } })); await mount("hdr"); await pick("32-bit preview method", "highlightCompression"); expect(container.querySelector<HTMLInputElement>('[aria-label="Preview exposure"]')!.disabled).toBe(true); expect(container.querySelector<HTMLInputElement>('[aria-label="Preview gamma"]')!.disabled).toBe(true); expect(container.textContent).toContain("stored 0–1 range"); await click("OK"); expect(command).toHaveBeenLastCalledWith("view.thirtyTwoBitPreviewOptions", { method: "highlightCompression", exposure: 0, gamma: 1 });
  });
  it("assigns/removes profiles with compatible built-ins and no conversion fields", async () => {
    await mount("assign"); expect(container.textContent).toContain("sRGB · Assumed · Rgb"); expect(container.querySelector('[aria-label="Profile rendering intent"]')).toBeNull();
    expect([...container.querySelectorAll<HTMLOptionElement>('[aria-label="Color profile"] option')].map(value => value.value)).not.toContain("coated-cmyk");
    await pick("Color profile", "display-p3"); await click("OK"); expect(command).toHaveBeenLastCalledWith("edit.assignProfile", { profile: "display-p3" });
    await pick("Color profile", "none"); expect(button("Read profile details").disabled).toBe(true); await click("OK"); expect(command).toHaveBeenLastCalledWith("edit.assignProfile", { profile: "none" });
  });
  it("offers cross-mode destinations and sends the chosen native intent/bpc", async () => {
    await mount("convert"); const values = [...container.querySelectorAll<HTMLOptionElement>('[aria-label="Color profile"] option')].map(value => value.value); expect(values).toContain("coated-cmyk"); expect(values).toContain("lab-d50"); expect(values).toContain("sgray");
    await pick("Color profile", "coated-cmyk"); await pick("Profile rendering intent", "absolute"); await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Profile black point compensation"]')!.click()); await click("OK"); expect(command).toHaveBeenCalledWith("edit.convertToProfile", { profile: "coated-cmyk", intent: "absolute", bpc: false, dither: false });
  });
  it("restores the opening values on Alt-Reset", async () => {
    await mount("convert"); await pick("Color profile", "display-p3"); await pick("Profile rendering intent", "absolute"); await altReset();
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Color profile"]')!.value).toBe("working"); expect(container.querySelector<HTMLSelectElement>('[aria-label="Profile rendering intent"]')!.value).toBe("relative"); expect(close).not.toHaveBeenCalled();
  });
  it("shows OK alone on the information dialog, like Photoshop's information dialogs", async () => {
    await mount("info"); expect([...container.querySelectorAll(".xd-ps-dialog-buttons button")].map(item => item.textContent)).toEqual(["OK"]);
    await mount("convert"); expect([...container.querySelectorAll(".xd-ps-dialog-buttons button")].map(item => item.textContent)).toContain("Cancel");
  });
  it("reads native profile information without an Apply action", async () => {
    command.mockResolvedValue({ profile: { ...info, embedded: true }, builtins: [] }); await mount("info"); expect(previewBox()).toBeUndefined(); await click("Read profile details"); expect(command).toHaveBeenCalledWith("edit.profileInfo", {});
    expect(container.querySelector('[aria-label="ICC profile information"]')!.textContent).toContain("Custom P3"); expect(container.textContent).toContain("4.3"); expect(container.textContent).toContain("relative, perceptual"); expect(close).not.toHaveBeenCalled(); await click("OK"); expect(close).toHaveBeenCalledOnce();
  });
  it("retains custom bytes through preview/apply and after picker cancellation", async () => {
    command.mockResolvedValueOnce({ profile: info, profileSource: "/picked/Profile.icc", profileData: "AA==" }); await mount("convert"); await click("Choose ICC profile…"); expect(picker).toHaveBeenCalledWith({ multiple: false, filters: [{ name: "ICC color profile", extensions: ["icc", "icm"] }] }); expect(command).toHaveBeenCalledWith("edit.profileInfo", { profile: "/picked/Profile.icc", includeData: true });
    await preview(); expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "edit.convertToProfile", params: { profile: "/picked/Profile.icc", profileData: "AA==", intent: "relative", bpc: true, dither: false }, viewKey: "composite" }));
    picker.mockResolvedValueOnce(null); await click("Choose ICC profile…"); await click("OK"); expect(command).toHaveBeenLastCalledWith("edit.convertToProfile", { profile: "/picked/Profile.icc", profileData: "AA==", intent: "relative", bpc: true, dither: false }); expect(command.mock.lastCall![1]).not.toHaveProperty("includeData");
  });
  it("blocks incompatible custom assignment profiles and retains failed import choices", async () => {
    command.mockResolvedValueOnce({ profile: { ...info, colorSpace: "Cmyk" }, profileSource: "/picked/Profile.icc", profileData: "AA==" }); await mount("assign"); await click("Choose ICC profile…"); expect(button("OK").disabled).toBe(true); expect(container.textContent).toContain("needs a Rgb profile");
    await pick("Color profile", "display-p3"); command.mockRejectedValueOnce(new Error("ICC file is malformed")); await click("Choose ICC profile…"); expect(container.querySelector<HTMLSelectElement>('[aria-label="Color profile"]')!.value).toBe("display-p3"); expect(container.textContent).toContain("ICC file is malformed"); expect(close).not.toHaveBeenCalled();
  });
  it("retains failed apply choices and blocks edits/cancel while applying", async () => {
    await mount("convert"); await pick("Color profile", "display-p3"); command.mockRejectedValueOnce(new Error("Conversion failed")); await click("OK"); expect(close).not.toHaveBeenCalled(); expect(container.textContent).toContain("Conversion failed");
    let finish!: () => void; command.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); })); await click("OK"); expect(button("Cancel").disabled).toBe(true); expect(container.querySelector<HTMLSelectElement>('[aria-label="Color profile"]')!.disabled).toBe(true); await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))); expect(close).not.toHaveBeenCalled(); await act(async () => finish()); expect(close).toHaveBeenCalledOnce();
  });
  it.each(["project", "document", "version", "view"])("dismisses stale %s profile workflows without applying", async boundary => {
    await mount("assign"); await act(async () => usePhotoWorkspace.setState(current => boundary === "project" ? { projectId: ulid() } : boundary === "document" ? { documentId: ulid() } : boundary === "version" ? { stateVersion: ulid() } : { state: { ...current.state!, viewKey: "alpha" } })); expect(close).toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
  });
  it("does not import into a changed source after a file picker", async () => {
    let finish!: (path: string) => void; picker.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); await mount("assign"); await click("Choose ICC profile…"); expect(button("Cancel").disabled).toBe(true); await act(async () => usePhotoWorkspace.setState({ projectId: ulid() })); await act(async () => finish("/late/Profile.icc")); expect(command).not.toHaveBeenCalled();
  });
  it("refuses malformed snapshots and discards a late import after closure", async () => {
    command.mockResolvedValueOnce({ profile: info, profileSource: "/wrong.icc", profileData: "AA==" }); await mount("assign"); await click("Choose ICC profile…"); expect(container.textContent).toContain("invalid data"); expect(container.querySelector<HTMLSelectElement>('[aria-label="Color profile"]')!.value).toBe("working");
    let finish!: (value: unknown) => void; command.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); await click("Choose ICC profile…"); await act(async () => root.unmount()); root = createRoot(container); await act(async () => finish({ profile: info, profileSource: "/picked/Profile.icc", profileData: "AA==" })); expect(native.invoke).not.toHaveBeenCalled();
  });
  it("admits Apply independently of the temporary-preview limit", async () => {
    doc = { ...doc, width: 4097, height: 4096 }; await mount("assign"); expect(previewBox().disabled).toBe(true); expect(container.textContent).toContain("16 megapixels"); await click("OK"); expect(command).toHaveBeenCalledWith("edit.assignProfile", { profile: "working" });
  });
  it.each([{ intents: "relative" }, { bytes: -1 }, { class: 42 }])("retains the source after malformed native profile details %j", async fields => {
    command.mockResolvedValueOnce({ profile: { ...info, ...fields }, profileSource: "/picked/Profile.icc", profileData: "AA==" }); await mount("assign"); await click("Choose ICC profile…"); expect(container.textContent).toContain("invalid data"); expect(container.querySelector<HTMLSelectElement>('[aria-label="Color profile"]')!.value).toBe("working"); expect(close).not.toHaveBeenCalled();
  });
});
