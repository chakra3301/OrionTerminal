import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergeToHdrDialog, PhotomergeDialog } from "./MergeDialogs";
import { usePhotoWorkspace } from "./runtime";

const native = vi.hoisted(() => ({ run: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: vi.fn() }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of [native.run, native.open]) mock.mockReset().mockResolvedValue(undefined);
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: null });
  container = document.createElement("div"); container.className = "xd-photo"; document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const field = <T extends Element = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`);
const button = (label: string) => [...container.querySelectorAll("button")].find(element => element.textContent === label)!;
const ok = () => container.querySelector<HTMLButtonElement>("button[type=submit]")!;
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const type = (label: string, value: string) => act(async () => { const input = field(label)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const choose = (label: string, value: string) => act(async () => { const element = field<HTMLSelectElement>(label)!; element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const listed = () => [...field<HTMLSelectElement>("Source files")!.options].map(option => option.textContent);
const pick = (name: string) => act(async () => { const list = field<HTMLSelectElement>("Source files")!; for (const option of list.options) option.selected = option.textContent === name; list.dispatchEvent(new Event("change", { bubbles: true })); });

describe("Photomerge", () => {
  it("needs two sources and sends the chosen files, layout and options", async () => {
    const close = vi.fn();
    await act(async () => root.render(<PhotomergeDialog current="beach.psd" close={close}/>));
    expect(container.querySelector("h3")!.textContent).toBe("Photomerge");
    expect([...container.querySelectorAll<HTMLInputElement>("input[type=radio]")].map(radio => [radio.getAttribute("aria-label"), radio.checked])).toEqual([["Auto", true], ["Perspective", false], ["Cylindrical", false], ["Spherical", false], ["Collage", false], ["Reposition", false]]);
    expect(ok().disabled).toBe(true);
    await click(button("Add Open Files"));
    expect(listed()).toEqual(["beach.psd"]);
    expect(button("Add Open Files").disabled).toBe(true);
    expect(ok().disabled).toBe(true);
    native.open.mockResolvedValueOnce(["/shots/left.jpg", "/shots/right.jpg"]);
    await click(button("Browse…"));
    expect(native.open).toHaveBeenCalledWith({ multiple: true, filters: [{ name: "Images", extensions: expect.arrayContaining(["jpg", "tif", "psd", "dng"]) }] });
    expect(listed()).toEqual(["beach.psd", "left.jpg", "right.jpg"]);
    expect(ok().disabled).toBe(false);
    expect(button("Remove").disabled).toBe(true);
    await pick("left.jpg"); await click(button("Remove"));
    expect(listed()).toEqual(["beach.psd", "right.jpg"]);
    await click(field("Cylindrical")!); await click(field("Blend Images Together")!); await click(field("Content Aware Fill Transparent Areas")!);
    await submit();
    expect(native.run).toHaveBeenCalledWith("file.automate.photomerge", { paths: ["/shots/right.jpg"], useOpenDocuments: true, layout: "cylindrical", blend: false, vignetteRemoval: false, geometricCorrection: false, contentAwareFill: true });
    expect(close).toHaveBeenCalled();
  });
});

describe("Merge to HDR Pro", () => {
  const sources = async () => {
    native.open.mockResolvedValueOnce(["/hdr/-2.tif", "/hdr/0.tif", "/hdr/+2.tif"]);
    await click(button("Browse…"));
  };

  it("chooses sources first, then sends the tone-mapping options", async () => {
    const close = vi.fn();
    await act(async () => root.render(<MergeToHdrDialog current="room.jpg" close={close}/>));
    expect(field("Attempt to Automatically Align Source Images")!.checked).toBe(true);
    expect(ok().disabled).toBe(true);
    await sources(); await click(button("Add Open Files")); await click(field("Attempt to Automatically Align Source Images")!);
    await submit();
    expect(native.run).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(field("Source files")).toBeNull();
    expect([field<HTMLSelectElement>("Mode")!.value, field<HTMLSelectElement>("Method")!.value]).toEqual(["16", "localAdaptation"]);
    expect([...container.querySelectorAll("legend")].map(legend => legend.textContent)).toEqual(["Edge Glow", "Tone and Detail", "Advanced"]);
    expect(["Radius", "Strength", "Gamma", "Exposure", "Detail", "Shadow", "Highlight", "Vibrance", "Saturation"].map(label => field(label)!.value)).toEqual(["7", "0.52", "1", "0", "30", "0", "0", "0", "20"]);
    await type("Radius", "600");
    expect(ok().disabled).toBe(true);
    expect(field<HTMLSelectElement>("Base Image")!.disabled).toBe(true);
    await type("Radius", "40"); await click(field("Remove ghosts")!);
    expect([...field<HTMLSelectElement>("Base Image")!.options].map(option => option.textContent)).toEqual(["Automatic", "room.jpg", "-2.tif", "0.tif", "+2.tif"]);
    await choose("Base Image", "2");
    await submit();
    expect(native.run).toHaveBeenCalledWith("file.automate.mergeToHdrPro", { paths: ["/hdr/-2.tif", "/hdr/0.tif", "/hdr/+2.tif"], useOpenDocuments: true, align: false, removeGhosts: true, ghostBase: 2, mode: "16", method: "localAdaptation", radius: 40, strength: .52, gamma: 1, exposure: 0, detail: 30, shadow: 0, highlight: 0, vibrance: 0, saturation: 20 });
    expect(close).toHaveBeenCalled();
  });

  it("sends only what the method reads, and keeps the dialog open on an engine refusal", async () => {
    await act(async () => root.render(<MergeToHdrDialog current="room.jpg" close={vi.fn()}/>));
    await sources(); await submit();
    await choose("Method", "exposureGamma");
    expect(field("Radius")).toBeNull();
    expect(["Exposure", "Gamma"].every(label => field(label))).toBe(true);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.automate.mergeToHdrPro", expect.objectContaining({ mode: "16", method: "exposureGamma", exposure: 0, gamma: 1 }));
    expect(native.run.mock.lastCall![1]).not.toHaveProperty("detail");
    await choose("Mode", "32");
    expect(field("Method")).toBeNull();
    native.run.mockRejectedValueOnce(new Error("the exposures must have the same pixel dimensions"));
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.automate.mergeToHdrPro", { paths: ["/hdr/-2.tif", "/hdr/0.tif", "/hdr/+2.tif"], useOpenDocuments: false, align: true, removeGhosts: false, mode: "32" });
    expect(container.querySelector("[role=alert]")!.textContent).toBe("the exposures must have the same pixel dimensions");
  });
});
