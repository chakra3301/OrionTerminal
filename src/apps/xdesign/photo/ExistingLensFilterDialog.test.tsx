import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExistingLensFilterDialog } from "./ExistingLensFilterDialog";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";
const native = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));

function png(width: number, height: number, blue: boolean) {
  const chunk = (name: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const byte of typed) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    const frame = Buffer.alloc(data.length + 12); frame.writeUInt32BE(data.length); typed.copy(frame, 4); frame.writeUInt32BE((crc ^ 0xffffffff) >>> 0, frame.length - 4); return frame;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const offset = y * (width * 4 + 1) + 1 + x * 4; pixels[offset + (blue ? 2 : 0)] = 255; pixels[offset + 3] = 255; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const documentFixture: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 200, height: 100, previewWidth: 200, previewHeight: 100, bundlePath: "", previewPath: "already-corrected.png", originalPath: null };
const inputPNG = png(200, 100, true), outputPNG = png(200, 100, false);
const reply = () => ({ width: 200, height: 100, png: outputPNG, result: { lensEdit: { input: { png: inputPNG, width: 200, height: 100, pixelWidth: 200, pixelHeight: 100 }, resolved: { angle: 5, scale: 175.125 }, curves: [[[20,30],[100,25],[180,60]]], stackEnabled: true, filterVisible: true } } });
function fixture(wide = false) {
  const params = wide ? { model: "perspective", focalLength: 24, cropFactor: 1, scale: 100, interpolation: "bicubic", constraints: [{ a: [20,30], b: [180,60], orientation: "horizontal", vendor: { keep: 1 } }], vendor: { keep: [1,2] } } : { angle: 5, scale: 100, profile: "none", autoScale: false, straighten: null, vendor: { keep: [1,2] } };
  const command = wide ? "filter.adaptiveWideAngle" : "filter.lensCorrection";
  const layer: PhotoLayer = { id: 1, name: "Smart", kind: "smart", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false, smartObject: { source: "embedded", name: "source.pcraft", hasFilterMask: true }, smartFilters: [{ command: "filter.other.custom", params: { offset: 17 }, visible: true, opacity: 1, blend: "Normal" }, { command, params, visible: false, opacity: .75, blend: "Multiply" }] };
  return { layer, existing: { index: 1, command, params: structuredClone(params) }, close: vi.fn() };
}
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset().mockResolvedValue(reply()); usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null }); vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:full-image"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {}); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
const input = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const number = (label: string, value: string) => act(async () => { const element = input(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
async function mount(wide = false, document = documentFixture) { const props = fixture(wide); await act(async () => root.render(<ExistingLensFilterDialog document={document} {...props}/>)); if (previewBox().checked) await act(async () => previewBox().click()); return props; }
const previewBox = () => [...host.querySelectorAll('.xd-ps-dialog-buttons label')].find(label => label.textContent === 'Preview')!.querySelector('input')!;
const preview = async () => { if (previewBox().checked) await act(async () => previewBox().click()); await act(async () => previewBox().click()); };
const altReset = async () => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true })); }); await act(async () => { button('Reset').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })); }); await act(async () => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' })); }); };
const pointer = (target: Element, type: string, x: number, y: number, pointerId = 1) => act(async () => { target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }), { pointerId })); });

it.each([false,true])("edits existing lens wide=%s with the real input image and identical Preview/Apply envelope once", async wide => {
  const props = await mount(wide), before = structuredClone(props.layer); expect(host.querySelector("svg")).toBeNull(); await preview();
  expect(host.querySelector("svg image")!.getAttribute("href")).toBe(`data:image/png;base64,${inputPNG}`); expect(host.querySelector("svg image")!.getAttribute("href")).not.toContain(documentFixture.previewPath);
  await number(wide ? "Focal length (mm)" : "Angle", wide ? "35" : "15"); await preview();
  const latest = native.invoke.mock.calls.filter(([id]) => id === "xdesign_photo_command_preview").at(-1)![1] as { command: string; params: unknown };
  expect(latest.command).toBe("layer.smartFilter.setParams"); expect(latest.params).toEqual({ layer: 1, index: 1, params: { ...props.existing.params, [wide ? "focalLength" : "angle"]: wide ? 35 : 15 } });
  let complete!: (value: unknown) => void; native.run.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => { const form = host.querySelector("form")!; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(native.run).toHaveBeenCalledOnce(); expect(native.run).toHaveBeenCalledWith("layer.smartFilter.setParams", latest.params); expect(previewBox().disabled).toBe(true); expect(props.layer).toEqual(before);
  await act(async () => complete({})); expect(props.close).toHaveBeenCalledOnce();
});

it("pins the pre-filter input through continuous endpoint moves and a deferred stale preview", async () => {
  await mount(true); await preview(); const svg = host.querySelector("svg")!;
  svg.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 } as DOMRect);
  const capture = new Set<number>(); svg.setPointerCapture = vi.fn(id => { capture.add(id); }); svg.hasPointerCapture = vi.fn(id => capture.has(id)); svg.releasePointerCapture = vi.fn(id => { capture.delete(id); });
  await pointer(host.querySelector('[aria-label="Constraint 1 start"]')!, "pointerdown", 30, 50); await pointer(svg, "pointermove", 50, 60);
  expect(host.querySelector("svg")).toBe(svg); expect(svg.releasePointerCapture).not.toHaveBeenCalled(); expect(svg.querySelector("polyline")).toBeNull();
  let finish!: (value: unknown) => void; native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await preview();
  await pointer(svg, "pointermove", 70, 70); await pointer(svg, "pointermove", 90, 80); await pointer(svg, "pointerup", 90, 80);
  expect(host.querySelector("svg")).toBe(svg); expect(svg.releasePointerCapture).toHaveBeenCalledTimes(1); expect(svg.querySelector('[aria-label="Constraint 1 start"]')!.getAttribute("cx")).toBe("80");
  await act(async () => finish(reply())); expect(svg.querySelector("image")!.getAttribute("href")).toBe(`data:image/png;base64,${inputPNG}`);
  await act(async () => button("OK").click()); expect(native.run).toHaveBeenCalledWith("layer.smartFilter.setParams", expect.objectContaining({ params: expect.objectContaining({ constraints: [{ a: [80,60], b: [180,60], orientation: "horizontal", vendor: { keep: 1 } }] }) }));
});

it.each([false,true])("Alt-Reset restores the opening lens settings wide=%s while keeping unrelated imported JSON", async wide => {
  const props = await mount(wide); await preview(); await number("Scale (%)", "120"); await altReset(); await act(async () => button("OK").click());
  const params = native.run.mock.lastCall![1] as { params: Record<string, unknown> }; expect(params.params).toEqual(props.existing.params);
  expect(props.layer.smartFilters![0]!.params).toEqual({ offset: 17 });
});

it("keeps automatic scale read-only and describes hidden input without changing actual visibility", async () => {
  const result = reply(); result.result.lensEdit.stackEnabled = false; result.result.lensEdit.filterVisible = false; native.invoke.mockResolvedValue(result);
  await mount(); await act(async () => input("Auto scale to fit").click()); await preview();
  expect(input("Scale (%)").disabled).toBe(true); expect(host.querySelector('[aria-label="Automatic scale"]')!.textContent).toBe("175.125%"); expect(host.textContent).toContain("full image preview keeps its current visibility");
  await act(async () => input("Auto scale to fit").click()); expect(input("Scale (%)").disabled).toBe(false); expect(input("Scale (%)").value).toBe("100");
});

it.each(["project","document","version","layer","index","command","params"] as const)("abandons pinned input and refuses late edits after captured %s changes", async change => {
  const props = await mount(true); await preview(); const next = structuredClone(props.layer); let document = documentFixture, existing = props.existing;
  if (change === "project") await act(async () => usePhotoWorkspace.setState({ projectId: "other" }));
  if (change === "document") document = { ...document, id: "other" };
  if (change === "version") document = { ...document, version: "v2" };
  if (change === "layer") next.id = 2;
  if (change === "index") existing = { ...existing, index: 0 };
  if (change === "command") next.smartFilters![1]!.command = "filter.lensCorrection";
  if (change === "params") next.smartFilters![1]!.params = { ...next.smartFilters![1]!.params, vendor: { keep: 2 } };
  await act(async () => root.render(<ExistingLensFilterDialog document={document} layer={next} existing={existing} close={props.close}/>)); expect(props.close).toHaveBeenCalled(); expect(host.querySelector("svg")).toBeNull(); expect(previewBox().disabled).toBe(true);
  await act(async () => previewBox().click()); await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); expect(native.run).not.toHaveBeenCalled(); expect(native.invoke).toHaveBeenCalledTimes(1);
});

it.each(["png","canvasSize","pixelSize"] as const)("does not expose invalid %s input metadata as a geometry image", async kind => {
  const response = reply(); if (kind === "png") response.result.lensEdit.input.png = "AA=="; if (kind === "canvasSize") response.result.lensEdit.input.width = 201; if (kind === "pixelSize") response.result.lensEdit.input.pixelWidth = 199;
  native.invoke.mockResolvedValue(response); await mount(); await preview(); expect(host.querySelector("svg")).toBeNull(); expect(host.textContent).toContain("Preview the filter input");
});

it("keeps numeric Apply available above the preview limit without using corrected pixels for geometry", async () => {
  await mount(false, { ...documentFixture, width: 5000, height: 4000 }); expect(previewBox().disabled).toBe(true); expect(host.querySelector("svg")).toBeNull(); expect(host.textContent).toContain("Numeric filter settings remain editable");
  await number("Angle", "12"); await act(async () => button("OK").click()); expect(native.run).toHaveBeenCalledWith("layer.smartFilter.setParams", expect.objectContaining({ params: expect.objectContaining({ angle: 12 }) })); expect(native.invoke).not.toHaveBeenCalled();
});

it("retries a refused source preview and Cancel preserves source drafts and URL ownership", async () => {
  native.invoke.mockRejectedValueOnce(new Error("source unavailable")); const props = await mount(), source = structuredClone(props.layer);
  await preview(); expect(host.textContent).toContain("source unavailable"); expect(host.querySelector("svg")).toBeNull(); await preview(); expect(host.querySelector("svg image")).not.toBeNull();
  await number("Angle", "20"); await act(async () => button("Cancel").click()); expect(props.close).toHaveBeenCalledOnce(); expect(native.run).not.toHaveBeenCalled(); expect(props.layer).toEqual(source);
  await act(async () => root.render(null)); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:full-image");
});
