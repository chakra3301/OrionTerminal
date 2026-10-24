import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCropDialog, cropDimensions, validCropQuad, PERSPECTIVE_CROP_COMMAND } from "./PerspectiveCropDialog";
import { usePhotoWorkspace } from "./runtime";
import { xdesignActivityReason } from "../runtimeActivity";
import type { PhotoDocument, PhotoState } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const doc: PhotoDocument = { id: "crop", version: "v1", name: "Page", width: 100, height: 80, previewWidth: 100, previewHeight: 80, bundlePath: "", previewPath: "page.png", originalPath: null };
let root: Root, container: HTMLDivElement, close: ReturnType<typeof vi.fn<() => void>>, create: ReturnType<typeof vi.fn<(object: Blob | MediaSource) => string>>, revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!;
const input = async (label: string, value: string) => act(async () => { const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
const render = async (version = "v1") => act(async () => root.render(<PerspectiveCropDialog document={{ ...doc, version }} close={close} />));
const submit = async () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset(); close = vi.fn<() => void>(); create = vi.fn((_object: Blob | MediaSource) => "blob:crop"); revoke = vi.fn((_url: string) => {});
  const createURL = create, revokeURL = revoke;
  vi.stubGlobal("URL", class extends URL { static override createObjectURL(object: Blob | MediaSource) { return createURL(object); } static override revokeObjectURL(url: string) { revokeURL(url); } });
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: { features: { perspectiveCrop: true }, viewKey: "color" } as PhotoState });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("document perspective crop", () => {
  it("sizes opposing edges and rejects crossing, reversed, short, outside and nonfinite corners", () => {
    const quad: [[number, number], [number, number], [number, number], [number, number]] = [[10, 10], [90, 10], [90, 70], [10, 70]];
    expect(cropDimensions(quad)).toEqual([80, 60]); expect(validCropQuad(quad, 100, 80)).toBe(true);
    expect(validCropQuad([quad[0], quad[2], quad[1], quad[3]], 100, 80)).toBe(false);
    expect(validCropQuad([quad[0], quad[3], quad[2], quad[1]], 100, 80)).toBe(false);
    expect(validCropQuad([[10,10],[10.1,10],[90,70],[10,70]],100,80)).toBe(false);
    expect(validCropQuad([[NaN,10],quad[1],quad[2],quad[3]],100,80)).toBe(false);
    expect(validCropQuad([[-1,10],quad[1],quad[2],quad[3]],100,80)).toBe(false);
  });
  it("applies clockwise document corners, explicit sizing and interpolation without a layer target", async () => {
    await render(); expect(xdesignActivityReason()).toContain("perspective crop");
    await act(async () => container.querySelector('[aria-label="Top left crop corner"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Crop automatic size"]')!.click());
    await input("Crop output width", "70"); await input("Crop output height", "60");
    await act(async () => { const field = container.querySelector<HTMLSelectElement>('[aria-label="Crop interpolation"]')!; field.value = "nearest"; field.dispatchEvent(new Event("change", { bubbles: true })); });
    await submit(); expect(native.run).toHaveBeenCalledWith(PERSPECTIVE_CROP_COMMAND, { quad: [[10,0],[100,0],[100,80],[0,80]], width:70, height:60, interpolation:"nearest" }); expect(close).toHaveBeenCalledOnce();
  });
  it("rejects invalid corners and fractional sizes, and restores the full crop on Reset", async () => {
    await render(); await input("Top right X", "0"); expect(button("Apply").disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
    await act(async () => button("Reset crop").click()); expect(button("Apply").disabled).toBe(false);
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Crop automatic size"]')!.click()); await input("Crop output width", "7.5"); expect(button("Apply").disabled).toBe(true);
    await input("Crop output width", ""); expect(container.querySelectorAll('circle[aria-label]').length).toBe(4); expect(button("Apply").disabled).toBe(true);
  });
  it("captures complete endpoints and restores draft corners on pointer cancellation and Escape", async () => {
    await render(); const stage = container.querySelector<SVGSVGElement>("svg")!;
    vi.spyOn(stage,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:100,height:80} as DOMRect); stage.setPointerCapture=vi.fn(); stage.hasPointerCapture=()=>false;
    const pointer = (type:string,x:number,y:number) => { const event = new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y}); Object.defineProperty(event,"pointerId",{value:7}); return event; };
    await act(async()=>container.querySelector('[aria-label="Top left crop corner"]')!.dispatchEvent(pointer("pointerdown",0,0)));
    expect(button("Apply").disabled).toBe(true); await act(async()=>stage.dispatchEvent(pointer("pointermove",15,10))); await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    expect(close).not.toHaveBeenCalled(); expect(container.querySelector<HTMLInputElement>('[aria-label="Top left X"]')!.value).toBe("0");
    await act(async()=>container.querySelector('[aria-label="Top left crop corner"]')!.dispatchEvent(pointer("pointerdown",0,0))); await act(async()=>stage.dispatchEvent(pointer("pointermove",10,5))); await act(async()=>stage.dispatchEvent(pointer("pointercancel",10,5)));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Top left X"]')!.value).toBe("0");
    await act(async()=>container.querySelector('[aria-label="Top left crop corner"]')!.dispatchEvent(pointer("pointerdown",0,0))); await act(async()=>stage.dispatchEvent(pointer("pointerup",20,10))); await submit();
    expect(native.run.mock.lastCall![1].quad[0]).toEqual([20,10]);
  });
  it("disables unsupported native binaries and guards busy, stale, double submission and native failures", async () => {
    await act(async()=>usePhotoWorkspace.setState({state:{features:{},viewKey:"color"} as PhotoState})); await render(); expect(button("Apply").disabled).toBe(true); expect(button("Preview crop").disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
    await act(async()=>usePhotoWorkspace.setState({state:{features:{perspectiveCrop:true},viewKey:"color"} as PhotoState,busy:true})); expect(button("Cancel").disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
    await act(async()=>usePhotoWorkspace.setState({busy:false})); native.run.mockRejectedValueOnce(new Error("Unsupported path")); await submit(); expect(close).not.toHaveBeenCalled(); expect(button("Apply").disabled).toBe(false);
    let finish!:()=>void; native.run.mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve)); await submit(); await submit(); expect(native.run).toHaveBeenCalledTimes(2); await act(async()=>finish()); expect(close).toHaveBeenCalledOnce();
    close.mockClear(); await render("v2"); expect(close).toHaveBeenCalledOnce(); expect(button("Apply").disabled).toBe(true);
  });
  it("pins corrected previews to the image version and corner draft, rejects stale replies and revokes URLs", async () => {
    let finish!:(value:unknown)=>void; native.invoke.mockReturnValueOnce(new Promise(resolve=>finish=resolve)).mockResolvedValue({width:100,height:80,png:"AA=="}); await render();
    await act(async()=>button("Preview crop").click()); expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_command_preview",expect.objectContaining({photoId:"crop",version:"v1",viewKey:"color",command:PERSPECTIVE_CROP_COMMAND}));
    await input("Top left X","10"); await act(async()=>finish({width:100,height:80,png:"AA=="})); expect(create).not.toHaveBeenCalled();
    await act(async()=>button("Preview crop").click()); expect(create).toHaveBeenCalledOnce(); expect(container.querySelector('img[alt="Unapplied corrected crop"]')).not.toBeNull(); expect(native.run).not.toHaveBeenCalled();
    await input("Top left X","15"); expect(revoke).toHaveBeenCalledWith("blob:crop"); expect(container.querySelector('img[alt="Unapplied corrected crop"]')).toBeNull();
  });
});
