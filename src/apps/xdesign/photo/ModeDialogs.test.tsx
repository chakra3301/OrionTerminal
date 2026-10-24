import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCommandDialog } from "./ImageDialogs";
import { ColorTableDialog, DuotoneDialog } from "./ModeDialogs";
import { ARTBOARD_FROM_GROUP, BITMAP, FLAME, INDEXED_COLOR, NEW_ARTBOARD, TRAP } from "./imageCommands";
import { usePhotoWorkspace } from "./runtime";

const native = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("../../../lib/ipc", () => ({ ipc: { saveFileAtomic: vi.fn(), readFile: vi.fn() } }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({});
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: null });
  container = document.createElement("div"); container.className = "xd-photo"; document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const field = <T extends Element = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const select = (label: string, value: string) => act(async () => { const element = field<HTMLSelectElement>(label); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

describe("Mode dialogs built on the command spec", () => {
  it("disables Indexed Color options the chosen palette does not use", async () => {
    await act(async () => root.render(<ImageCommandDialog command={INDEXED_COLOR} close={vi.fn()}/>));
    expect(field("Colors").disabled).toBe(false); expect(field<HTMLSelectElement>("Forced").disabled).toBe(false); expect(field("Amount").disabled).toBe(false);
    await select("Palette", "web");
    expect(field("Colors").disabled).toBe(true); expect(field<HTMLSelectElement>("Forced").disabled).toBe(true);
    await select("Palette", "exact");
    expect(field<HTMLSelectElement>("Dither").disabled).toBe(true); expect(field("Amount").disabled).toBe(true);
    await select("Palette", "perceptual"); await select("Dither", "noise");
    expect(field("Amount").disabled).toBe(true);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.mode.indexedColor", { palette: "perceptual", colors: 256, forced: "blackWhite", transparency: true, dither: "noise", amount: 75 });
  });
  it("offers the Halftone Screen options only for the halftone method", async () => {
    await act(async () => root.render(<ImageCommandDialog command={BITMAP} close={vi.fn()}/>));
    expect(field("Frequency").disabled).toBe(true); expect(field<HTMLSelectElement>("Shape").disabled).toBe(true);
    await select("Use", "halftone");
    expect(field("Frequency").disabled).toBe(false); expect(field<HTMLSelectElement>("Shape").disabled).toBe(false);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.mode.bitmap", { method: "halftone", frequency: 53, angle: 45, shape: "round" });
  });
  it("sends the artboard colour only for a custom background", async () => {
    await act(async () => root.render(<ImageCommandDialog command={NEW_ARTBOARD} initial={{ width: 400, height: 300 }} close={vi.fn()}/>));
    expect(field("Color").disabled).toBe(true);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.new.artboard", { name: "Artboard", width: 400, height: 300, background: "white" });
    await act(async () => root.render(<ImageCommandDialog key="group" command={ARTBOARD_FROM_GROUP} close={vi.fn()}/>));
    await select("Background Contents", "custom"); expect(field("Color").disabled).toBe(false);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.new.artboardFromGroup", { background: "custom", color: "#ffffff" });
  });
  it("runs Trap and enables Flame's colour only with Use Custom Color", async () => {
    await act(async () => root.render(<ImageCommandDialog command={TRAP} close={vi.fn()}/>));
    await submit(); expect(native.run).toHaveBeenLastCalledWith("image.trap", { width: 1 });
    await act(async () => root.render(<ImageCommandDialog key="flame" command={FLAME} close={vi.fn()}/>));
    expect(field("Color").disabled).toBe(true);
    await click(field("Use Custom Color")); expect(field("Color").disabled).toBe(false);
  });
});

describe("Duotone", () => {
  it("shows one ink row per type and sends names and colours", async () => {
    await act(async () => root.render(<DuotoneDialog close={vi.fn()}/>));
    expect(container.querySelectorAll(".xd-ps-dialog-ink")).toHaveLength(2);
    await select("Type", "tritone"); expect(container.querySelectorAll(".xd-ps-dialog-ink")).toHaveLength(3);
    await select("Type", "monotone"); expect(container.querySelectorAll(".xd-ps-dialog-ink")).toHaveLength(1);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.mode.duotone", { type: "monotone", inks: [{ name: "Black", color: "#000000" }] });
  });
});

describe("Color Table", () => {
  it("reads the table, applies an edited entry and the transparent index", async () => {
    native.run.mockResolvedValueOnce({ colors: ["#000000", "#ff0000", "#00ff00"], transparent: null });
    await act(async () => root.render(<ColorTableDialog close={vi.fn()}/>));
    expect(native.run).toHaveBeenCalledWith("image.mode.colorTable", {});
    expect(container.querySelectorAll(".xd-ps-swatches button")).toHaveLength(3);
    await click(container.querySelectorAll(".xd-ps-swatches button")[1]!);
    await act(async () => { const element = field("Selected color"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, "#0000ff"); element.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(field("Transparent")); await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.mode.colorTable", { table: "custom", entries: { 1: "#0000ff" }, transparent: 1 });
  });
  it("reports a missing table instead of an empty grid", async () => {
    native.run.mockRejectedValueOnce(new Error("the document has no color table"));
    await act(async () => root.render(<ColorTableDialog close={vi.fn()}/>));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("no color table");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});
