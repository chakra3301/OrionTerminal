import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADJUSTMENTS, BASIC_FILTERS, FILTERS, FILTER_PRESETS, REPEAT_FILTER } from "./controls";
import { adjustmentCommand, adjustmentDefaults, toneChannels } from "./adjustmentSettings";
import { forgetRememberedValues, PhotoActionDialog } from "./PhotoActionDialog";
import { bakeGradient, gradientMapParams } from "./gradientMethod";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer, PhotoState } from "./types";

const native = vi.hoisted(() => ({ enabled: false, run: vi.fn(), invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "original.png", originalPath: null };
const layer: PhotoLayer = { id: 7, name: "Adjustment", kind: "Adjustment", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false };
let root: Root, container: HTMLDivElement, canvas: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.enabled = false; native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset(); native.open.mockReset(); forgetRememberedValues();
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: null });
  container = document.createElement("div"); canvas = document.createElement("div"); document.body.append(container, canvas); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); canvas.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = (id: string, adjustment = true, existing?: PhotoLayer, close = vi.fn()) => act(async () => root.render(<PhotoActionDialog key={id} action={[...ADJUSTMENTS, ...FILTERS].find(action => action.id === id)!} adjustment={adjustment} layer={existing} document={photo} canvas={canvas} onClose={close}/>));
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
const click = (text: string) => act(async () => button(text).click());
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const input = (label: string, value: string) => act(async () => { const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
const select = (label: string, value: string) => act(async () => { const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const radio = (label: string, value: string) => act(async () => container.querySelector<HTMLInputElement>(`[role="radiogroup"][aria-label="${label}"] input[value="${value}"]`)!.click());
const swatch = (group: string, name: string) => act(async () => container.querySelector<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] button[aria-label="${name}"]`)!.click());
const toggle = (label: string) => act(async () => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!.click());
const previewBox = () => [...container.querySelectorAll(".xd-ps-dialog-buttons label")].find(label => label.textContent === "Preview")!.querySelector("input")!;
const preview = async () => { if (!vi.isFakeTimers()) vi.useFakeTimers(); if (!previewBox().checked) await act(async () => previewBox().click()); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); };
const shown = () => canvas.querySelector("img.xd-photo-canvas-preview")?.getAttribute("src") ?? null;
const altReset = async () => {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
  await act(async () => { button("Reset").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); });
};

describe("complete native adjustment controls", () => {
  it("previews adjustment pixels of the isolated channel on the canvas and hides them with Preview off",async()=>{
    native.enabled=true;vi.useFakeTimers();let sequence=0;vi.spyOn(URL,"createObjectURL").mockImplementation(()=>`blob:view-${++sequence}`);vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    native.invoke.mockResolvedValue({width:100,height:100,png:"AA=="});
    usePhotoWorkspace.setState({state:{name:"Image",width:100,height:100,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],channels:{colors:[{name:"Red",visible:false}],alpha:[{index:0,name:"Cutout",spot:null,visible:true}],target:{kind:"alpha",index:0}},canUndo:false,canRedo:false,viewKey:"alpha"}});
    await render("exposure",false);expect(previewBox().checked).toBe(true);expect(shown()).toBeNull();await preview();expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview",expect.objectContaining({viewKey:"alpha",command:"image.adjustments.exposure"}));expect(native.invoke).not.toHaveBeenCalledWith("xdesign_photo_view_preview",expect.anything());expect(shown()).toBe("blob:view-1");await act(async()=>previewBox().click());expect(shown()).toBeNull();expect(native.run).not.toHaveBeenCalled();
  });
  it("keeps live preview for adjustments on images above 16 megapixels but not for filters",async()=>{
    native.enabled=true;const large={...photo,width:6000,height:4000};
    const open=(id:string)=>act(async()=>root.render(<PhotoActionDialog key={id} action={[...ADJUSTMENTS,...FILTERS].find(action=>action.id===id)!} adjustment={false} document={large} canvas={canvas} onClose={vi.fn()}/>));
    const note=()=>container.textContent!.includes("Apply renders this large image at full resolution.");
    await open("curves");expect(previewBox().checked).toBe(true);expect(previewBox().disabled).toBe(false);expect(note()).toBe(false);
    await open("filter.blur.gaussianBlur");expect(previewBox().checked).toBe(false);expect(previewBox().disabled).toBe(true);expect(note()).toBe(true);
  });
  it.each(ADJUSTMENTS)("creates one $label adjustment with neutral complete parameters", async action => {
    const close = vi.fn(); await render(action.id, true, undefined, close); await submit();
    expect(native.run).toHaveBeenCalledOnce(); expect(native.run).toHaveBeenCalledWith(`layer.newAdjustmentLayer.${action.id}`, action.id === "gradientMap" ? gradientMapParams(adjustmentDefaults(action, "RGB")) : adjustmentDefaults(action, "RGB")); expect(close).toHaveBeenCalledOnce();
  });
  it("keeps independently edited tone ranges and their imported values", async () => {
    await render("colorBalance", true, { ...layer, adjustmentParams: { shadows: [11, 12, 13], midtones: [21, 22, 23], highlights: [31, 32, 33], preserveLuminosity: false } });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Adjustment Cyan / Red"]')!.value).toBe("21");
    await input("Adjustment Cyan / Red", "50"); await radio("Adjustment Tone range", "highlights"); await input("Adjustment Yellow / Blue", "-40"); await radio("Adjustment Tone range", "shadows");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Adjustment Cyan / Red"]')!.value).toBe("11"); await submit();
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", { layer: 7, shadows: [11, 12, 13], midtones: [50, 22, 23], highlights: [31, 32, -40], preserveLuminosity: false });
  });
  it("edits every mixer output and keeps monochrome values from overriding color outputs", async () => {
    await render("channelMixer"); await swatch("Adjustment Output channel", "Blue"); await input("Adjustment Red", "20");
    await toggle("Adjustment Monochrome"); await input("Adjustment Red", "60"); await toggle("Adjustment Monochrome");
    await swatch("Adjustment Output channel", "Red"); await input("Adjustment Red", "90"); await submit();
    expect(native.run).toHaveBeenCalledWith("layer.newAdjustmentLayer.channelMixer", { red: [90, 0, 0, 0], green: [0, 100, 0, 0], blue: [20, 0, 100, 0], monochrome: false });
  });
  it("retains unedited selective ranges and supports absolute calculations", async () => {
    await render("selectiveColor", true, { ...layer, adjustmentParams: { method: "absolute", reds: [1, 2, 3, 4], blues: [5, 6, 7, 8], blacks: [9, 10, 11, 12] } });
    await swatch("Adjustment Color range", "Blues"); expect(container.querySelector<HTMLInputElement>('[aria-label="Adjustment Cyan"]')!.value).toBe("5"); await input("Adjustment Black", "-40"); await submit();
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ layer: 7, method: "absolute", reds: [1, 2, 3, 4], blues: [5, 6, 7, -40], blacks: [9, 10, 11, 12] }));
  });
  it("edits color-range falloff and colorizes without losing range settings", async () => {
    await render("hueSaturation"); await swatch("Adjustment Color range", "Blues"); await input("Adjustment Hue", "-35"); await input("Adjustment Fade in", "180"); await toggle("Adjustment Colorize"); await input("Adjustment Hue", "300"); await submit();
    expect(native.run).toHaveBeenCalledWith("layer.newAdjustmentLayer.hueSaturation", expect.objectContaining({ colorize: true, hue: 300, blues: { hue: -35, saturation: 0, lightness: 0, range: [180, 225, 255, 285] } }));
  });
  it("preserves CMYK curve channels and offers keyboard and numeric point editing in ink percentages", async () => {
    await render("curves", true, { ...layer, adjustmentParams: { points: [[0, 0], [255, 255]], cyan: [[0, 0], [128, 160], [255, 255]], magenta: [[0, 5], [255, 245]], yellow: [[0, 0], [255, 255]], black: [[0, 20], [255, 255]] } });
    await select("Adjustment Channel", "cyan"); await act(async () => container.querySelector('[aria-label="Curve point 2"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Curve output"]')!.value).toBe("37"); await input("Curve output", "30");
    // Up is more ink, so less light.
    await act(async () => container.querySelector('[aria-label="Curve point 2"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })));
    await submit(); expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ cyan: [[0, 0], [128, 168.5], [255, 255]], magenta: [[0, 5], [255, 245]], black: [[0, 20], [255, 255]] }));
  });
  it("edits Lab output levels without changing other channel records", async () => {
    const identity = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    await render("levels", true, { ...layer, adjustmentParams: { ...identity, lightness: { ...identity, gamma: 1.2 }, a: identity, b: { ...identity, outWhite: 230 } } });
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Adjustment Channel"]')!.value).toBe("lightness"); await select("Adjustment Channel", "a"); await input("Adjustment Output black", "20"); await submit();
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", expect.objectContaining({ lightness: { ...identity, gamma: 1.2 }, a: { ...identity, outBlack: 20 }, b: { ...identity, outWhite: 230 } }));
  });
  it("edits multistop gradients without replacing imported middle colors", async () => {
    await render("gradientMap", true, { ...layer, adjustmentParams: { stops: [[0, "#001122"], [.4, "#aa5500"], [1, "#ffeecc"]], reverse: true, dither: true } });
    container.classList.add("xd-photo");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Edit gradient"]')!.click());
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Color stop 2"]')!.click()); await input("Color stop location", "60");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Gradient Editor"] button[type=submit]')!.click());
    expect(native.run).not.toHaveBeenCalled(); expect(container.querySelector('[aria-label="Gradient Editor"]')).toBeNull();
    await submit();
    expect(native.run).toHaveBeenCalledWith("layer.setAdjustment", { layer: 7, stops: [[0, "#001122"], [.6, "#aa5500"], [1, "#ffeecc"]], reverse: true, dither: true });
  });
  it("keeps imported LUT data until explicit replacement and supports bounded native file loading", async () => {
    await render("colorLookup", true, { ...layer, adjustment: { ColorLookup: { name: "Film LUT", size: 33 } }, adjustmentParams: { interpolation: "tetrahedral", dither: true } });
    expect(container.textContent).toContain("Current embedded look · Film LUT"); await toggle("Adjustment Dither"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.setAdjustment", { layer: 7, interpolation: "tetrahedral", dither: false });
    native.open.mockResolvedValue("/fixtures/grade.cube"); await select("Adjustment Look", "load"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.setAdjustment", { layer: 7, interpolation: "tetrahedral", dither: false, file: "/fixtures/grade.cube" });
    await altReset(); await submit(); expect(native.run).toHaveBeenLastCalledWith("layer.setAdjustment", { layer: 7, interpolation: "tetrahedral", dither: true });
  });
  it("previews the actual destructive command, compares with the original and cancels without committing", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:adjustment"), revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    native.invoke.mockResolvedValue({ width: 100, height: 100, png: "AA==" }); const close = vi.fn();
    await render("exposure", false, undefined, close); await input("Adjustment Exposure", "-1.5"); await preview();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "image.adjustments.exposure", version: "v1", params: { exposure: -1.5, offset: 0, gamma: 1 } })); expect(shown()).toBe("blob:adjustment");
    await act(async () => previewBox().click()); expect(shown()).toBeNull(); await click("Cancel"); expect(close).toHaveBeenCalledOnce(); expect(native.run).not.toHaveBeenCalled();
    act(() => root.unmount()); root = createRoot(container); expect(revoke).toHaveBeenCalledWith("blob:adjustment"); create.mockRestore();
  });
  it("keeps the previewed result on the canvas after OK until the applied image is shown", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:applied"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    native.invoke.mockResolvedValue({ width: 100, height: 100, png: "AA==" }); const close = vi.fn();
    let finish!: () => void, display!: () => void;
    native.run.mockImplementation(() => { usePhotoWorkspace.setState({ busy: true }); return new Promise(resolve => { finish = () => { usePhotoWorkspace.setState({ busy: false }); resolve({}); }; }); });
    const untilShown = vi.fn((work: Promise<unknown>) => work.then(() => new Promise<void>(resolve => { display = resolve; })));
    await act(async () => root.render(<PhotoActionDialog action={ADJUSTMENTS.find(action => action.id === "exposure")!} adjustment={false} document={photo} canvas={canvas} onClose={close} untilShown={untilShown}/>));
    await input("Adjustment Exposure", "-1.5"); await preview(); expect(shown()).toBe("blob:applied");
    await submit(); expect(native.run).toHaveBeenCalledOnce(); expect(shown()).toBe("blob:applied");
    await act(async () => finish()); expect(untilShown).toHaveBeenCalledOnce(); expect(shown()).toBe("blob:applied"); expect(close).not.toHaveBeenCalled();
    await act(async () => display()); expect(close).toHaveBeenCalledOnce();
  });
  it("rejects invalid fields and failed edits while retaining the dialog for correction", async () => {
    await render("exposure", false); await input("Adjustment Gamma", ""); await submit(); expect(native.run).not.toHaveBeenCalled(); expect(button("OK").disabled).toBe(true);
    await input("Adjustment Gamma", "-1"); await submit(); expect(native.run).not.toHaveBeenCalled();
    await input("Adjustment Gamma", "1"); native.run.mockRejectedValue(new Error("Image changed")); await submit(); expect(container.textContent).toContain("Image changed");
  });
  it.each(FILTERS.filter(action => !action.direct && !action.file))("applies pinned defaults for $id", async action => {
    await render(action.id, false); await submit();
    expect(native.run).toHaveBeenCalledOnce();
    expect(native.run).toHaveBeenCalledWith(action.id, adjustmentDefaults(action, "RGB"));
  });
  it("previews and applies typed source constraints and restores defaults without mutating geometry", async () => {
    await render("filter.adaptiveWideAngle", false);
    await click("Add constraint");
    await input("Start Y (px)", "20.25"); await select("Constraint orientation", "horizontal");
    await select("Filter Lens model", "fisheye"); await select("Filter Interpolation", "nearest");
    await preview();
    const params = { model: "fisheye", focalLength: 0, cropFactor: 1, scale: 100, interpolation: "nearest", constraints: [{ a: [10, 20.25], b: [90, 50], orientation: "horizontal" }] };
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "filter.adaptiveWideAngle", params }));
    await submit(); expect(native.run).toHaveBeenLastCalledWith("filter.adaptiveWideAngle", params);
    await altReset(); expect(container.querySelectorAll("circle")).toHaveLength(0);
    await input("Filter Scale (%)", "80"); await submit(); expect(native.run).toHaveBeenLastCalledWith("filter.adaptiveWideAngle", expect.objectContaining({ constraints: [], scale: 80 }));
  });
  it("rejects degenerate lines and offers bicubic interpolation for nested Smart Object targets", async () => {
    usePhotoWorkspace.setState({ state: { activeLayer: 7, layers: [{ ...layer, children: [{ ...layer, id: 7, smartObject: { source: "embedded", name: "Image", hasFilterMask: false } }], id: 8 }] } as unknown as import("./types").PhotoState });
    await render("filter.adaptiveWideAngle", false);
    expect([...container.querySelector<HTMLSelectElement>('[aria-label="Filter Interpolation"]')!.options].map(option => option.value)).toEqual(["bicubic"]);
    await click("Add constraint"); await input("End X (px)", "10");
    expect(button("OK").disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
    await input("End X (px)", "90"); await submit(); expect(native.run).toHaveBeenCalledWith("filter.adaptiveWideAngle", expect.objectContaining({ interpolation: "bicubic" }));
    native.run.mockClear(); await render("filter.lensCorrection", false); await click("Add straightening line"); await input("End Y (px)", "60"); await submit();
    expect(native.run).toHaveBeenCalledWith("filter.lensCorrection", expect.objectContaining({ straighten: [[10, 50], [90, 60]], angle: 0 }));
    await click("Remove straightening line"); await submit(); expect(native.run.mock.calls.at(-1)![1]).not.toHaveProperty("straighten");
  });
  it("requires a chosen displacement map and sends its owned path with filter options", async () => {
    await render("filter.distort.displace", false);
    expect(button("OK").disabled).toBe(true);
    await submit(); expect(native.run).not.toHaveBeenCalled();
    native.open.mockResolvedValue("/fixtures/map.psd");
    await click("Choose displacement map…"); await submit();
    expect(native.run).toHaveBeenCalledWith("filter.distort.displace", { horizontal: 10, vertical: 10, fit: "stretch", undefinedAreas: "repeat", mapPath: "/fixtures/map.psd" });
  });
  it("accepts its deferred displacement picker result while loading and then applies the exact selected path", async () => {
    let finish!: (value: string) => void; native.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render("filter.distort.displace", false); await click("Choose displacement map…"); expect(button("OK").disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
    await act(async () => finish("/fixtures/deferred-map.psd")); expect(button("OK").disabled).toBe(false); await input("Filter Horizontal scale", "12"); await submit(); expect(native.run).toHaveBeenCalledWith("filter.distort.displace", { horizontal: 12, vertical: 10, fit: "stretch", undefinedAreas: "repeat", mapPath: "/fixtures/deferred-map.psd" });
  });
  it.each(["context", "unmount"] as const)("discards an owned displacement picker result after %s replacement", async change => {
    let finish!: (value: string) => void; native.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render("filter.distort.displace", false); await click("Choose displacement map…");
    if (change === "context") await act(async () => usePhotoWorkspace.setState({ projectId: "other" })); else await act(async () => root.render(null)); await act(async () => finish("/fixtures/old-context.psd")); expect(native.run).not.toHaveBeenCalled();
    if (change === "context") { expect(button("OK").disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled(); native.open.mockResolvedValueOnce("/fixtures/current-context.psd"); await click("Choose displacement map…"); await submit(); expect(native.run).toHaveBeenCalledWith("filter.distort.displace", expect.objectContaining({ mapPath: "/fixtures/current-context.psd" })); }
  });
  it("keeps current native foreground and background colours in gallery and render filters", async () => {
    usePhotoWorkspace.setState({ state: { tools: { foreground: [0.123456,0.4,0.7,0.8], background: [0.9,0.6,0.2,0.5] } } as unknown as import("./types").PhotoState });
    await render("filter.render.fibers", false); await submit();
    expect(native.run).toHaveBeenCalledWith("filter.render.fibers", expect.objectContaining({ foreground: [0.123456,0.4,0.7,0.8], background: [0.9,0.6,0.2,0.5] }));
    native.run.mockClear(); await render("filter.filterGallery", false);
    await toggle("Gallery effect 1 visible"); expect(button("OK").disabled).toBe(true);
    await submit(); expect(native.run).not.toHaveBeenCalled();
  });
  it("previews the same changed Box Blur command and parameters it applies", async () => {
    native.enabled = true; vi.useFakeTimers();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:box-blur"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    native.invoke.mockResolvedValue({ width: 100, height: 100, png: "AA==" });
    await render("filter.blur.boxBlur", false); await input("Filter Radius", "8"); await preview();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview", expect.objectContaining({ command: "filter.blur.boxBlur", params: { radius: 8 } }));
    await submit(); expect(native.run).toHaveBeenCalledWith("filter.blur.boxBlur", { radius: 8 });
    create.mockRestore();
  });
  it("rejects out-of-range filter values, keeps a failed apply editable, and cancels without applying", async () => {
    const close = vi.fn(); await render("filter.blur.boxBlur", false, undefined, close);
    await input("Filter Radius", "0"); await submit(); expect(native.run).not.toHaveBeenCalled();
    await input("Filter Radius", "6"); await altReset();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Filter Radius"]')!.value).toBe("1");
    await input("Filter Radius", "6"); native.run.mockRejectedValueOnce(new Error("Image changed")); await submit();
    expect(container.textContent).toContain("Image changed"); expect(close).not.toHaveBeenCalled();
    await click("Cancel"); expect(close).toHaveBeenCalledOnce();
  });
  it("uses the pinned configurable catalog size and selected defaults", () => {
    expect(BASIC_FILTERS).toHaveLength(24);
    expect(adjustmentDefaults(BASIC_FILTERS[0]!, "RGB")).toEqual({ radius: 1 });
    expect(adjustmentDefaults(BASIC_FILTERS.find(action => action.id === "filter.blur.radialBlur")!, "RGB")).toEqual({ amount: 10, centerX: 0.5, centerY: 0.5, method: "spin" });
    expect(adjustmentDefaults(BASIC_FILTERS.find(action => action.id === "filter.other.offset")!, "RGB")).toEqual({ horizontal: 0, vertical: 0, undefinedAreas: "wrap" });
  });
  it("publishes enum, boolean, seed, wave boundary and offset parameters unchanged", async () => {
    await render("filter.noise.addNoise", false);
    await radio("Filter Distribution", "gaussian"); await toggle("Filter Monochromatic"); await input("Filter Seed", "1234"); await submit();
    expect(native.run).toHaveBeenCalledWith("filter.noise.addNoise", { amount: 12.5, seed: 1234, distribution: "gaussian", monochromatic: true });

    native.run.mockClear(); await render("filter.distort.wave", false);
    await radio("Filter Wave type", "triangle"); await radio("Filter Edge behavior", "repeat"); await input("Filter Seed", "9"); await submit();
    expect(native.run).toHaveBeenCalledWith("filter.distort.wave", { generators: 5, wavelengthMin: 10, wavelengthMax: 120, amplitudeMin: 5, amplitudeMax: 35, seed: 9, type: "triangle", undefinedAreas: "repeat" });

    native.run.mockClear(); await render("filter.other.offset", false);
    await input("Filter Horizontal", "23"); await input("Filter Vertical", "-17"); await radio("Filter Undefined areas", "transparent"); await submit();
    expect(native.run).toHaveBeenCalledWith("filter.other.offset", { horizontal: 23, vertical: -17, undefinedAreas: "transparent" });
  });
  it("shows Photoshop wording: unit suffixes, option labels and radios", async () => {
    await render("filter.blur.gaussianBlur", false);
    const row = container.querySelector<HTMLInputElement>('[aria-label="Filter Radius"]')!.closest("label")!;
    expect(row.textContent).toBe("Radius:Pixels"); expect(container.querySelector(".xd-ps-dialog-grid.has-sliders")).not.toBeNull();
    await render("filter.distort.spherize", false);
    expect([...container.querySelectorAll<HTMLOptionElement>('[aria-label="Filter Mode"] option')].map(option => option.text)).toEqual(["Normal", "Horizontal only", "Vertical only"]);
    await render("filter.noise.addNoise", false);
    const group = container.querySelector('[role="radiogroup"][aria-label="Filter Distribution"]')!;
    expect([...group.querySelectorAll("label")].map(label => label.textContent)).toEqual(["Uniform", "Gaussian"]);
    expect(container.querySelector('[aria-label="Filter Amount"]')!.closest("label")!.textContent).toBe("Amount:%");
    await render("filter.distort.polarCoordinates", false);
    expect([...container.querySelectorAll('[aria-label="Filter Mode"] label')].map(label => label.textContent)).toEqual(["Rectangular to Polar", "Polar to Rectangular"]);
    expect([...container.querySelectorAll("option,legend,label")].filter(element => /[a-z][A-Z]/.test(element.textContent!))).toEqual([]);
  });
  it("reopens with the last confirmed values per command, while Alt-Reset restores the opening values", async () => {
    await render("filter.blur.boxBlur", false); await input("Filter Radius", "9"); await submit();
    await act(async () => root.render(<></>)); await render("filter.blur.boxBlur", false);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Filter Radius"]')!.value).toBe("9");
    await input("Filter Radius", "4"); await altReset();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Filter Radius"]')!.value).toBe("9");
    await render("filter.blur.gaussianBlur", false);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Filter Radius"]')!.value).toBe("1");
    await render("brightnessContrast", false); await input("Adjustment Brightness", "30"); await submit();
    await act(async () => root.render(<></>)); await render("brightnessContrast", false);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Adjustment Brightness"]')!.value).toBe("30");
    await act(async () => root.render(<></>)); await render("brightnessContrast", true);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Adjustment Brightness"]')!.value).toBe("0");
    await act(async () => root.render(<></>)); await render("brightnessContrast", true, { ...layer, adjustmentParams: { brightness: 5, contrast: 0, legacy: false } });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Adjustment Brightness"]')!.value).toBe("5");
  });
  it("previews repeat-last without applying and keeps Apply available after unavailable history", async () => {
    native.invoke.mockRejectedValue(new Error("No previous filter is available for preview"));
    await render("filter.lastFilter",false);await preview();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview",expect.objectContaining({command:"filter.lastFilter",params:{},version:"v1"}));
    expect(container.textContent).toContain("No previous filter");expect(native.run).not.toHaveBeenCalled();expect(button("OK").disabled).toBe(false);
    await submit();expect(native.run).toHaveBeenCalledWith("filter.lastFilter",{});
  });
  it("keeps fixed presets direct and opens repeat-last for preview", () => {
    expect(FILTER_PRESETS).toHaveLength(6); expect(FILTER_PRESETS.every(action => action.direct)).toBe(true);
    expect(REPEAT_FILTER.id).toBe("filter.lastFilter"); expect(REPEAT_FILTER.direct).not.toBe(true);
  });
  it("routes destructive adjustments and filters separately and retains imported tone space", () => {
    expect(adjustmentCommand(ADJUSTMENTS[0]!, false)).toBe("image.adjustments.brightnessContrast"); expect(adjustmentCommand(FILTERS[0]!, false)).toBe("filter.blur.gaussianBlur");
    expect(toneChannels("RGB", { cyan: [] })).toEqual(["cyan", "magenta", "yellow", "black"]); expect(toneChannels("CMYK", { red: [] })).toEqual(["red", "green", "blue"]);
  });
});

it('permits every wide-angle interpolation on a selected Smart Object raster mask while retaining pixel Smart Filter limits', async () => {
  const source: PhotoState = { name: 'Image', width: 100, height: 100, mode: 'RGB', depth: 16, resolution: 72, activeLayer: 7, hasSelection: false, selectionBounds: null, layers: [{ ...layer, hasMask: true, smartObject: { source: 'embedded', name: 'Image', hasFilterMask: false } }], layerMaskView: { layer: 7, mode: 'gray' }, channels: { alpha: [], target: { kind: 'composite' } }, canUndo: false, canRedo: false };
  usePhotoWorkspace.setState({ state: source }); await render('filter.adaptiveWideAngle', false);
  const choices = () => [...container.querySelector<HTMLSelectElement>('[aria-label="Filter Interpolation"]')!.options].map(option => option.value);
  expect(choices()).toEqual(['nearest', 'bilinear', 'bicubic']);
  await select('Filter Interpolation', 'nearest'); await submit();
  expect(native.run).toHaveBeenLastCalledWith('filter.adaptiveWideAngle', expect.objectContaining({ interpolation: 'nearest' }));
  await act(async () => usePhotoWorkspace.setState({ state: { ...source, layerMaskView: null } }));
  expect(choices()).toEqual(['bicubic']); expect(button('OK').disabled).toBe(true);
  await submit(); expect(native.run).toHaveBeenCalledOnce();
});

it.each(["alpha", "quickMask"] as const)("permits native wide-angle interpolation for a Smart Object's %s target", async target => {
  const source: PhotoState = { name: "Image", width: 100, height: 100, mode: "RGB", depth: 16, resolution: 72, activeLayer: 7, hasSelection: false, selectionBounds: null, layers: [{ ...layer, smartObject: { source: "embedded", name: "Image", hasFilterMask: false } }], channels: { alpha: [{ index: 0, name: "Alpha", spot: null, visible: true }], target: target === "alpha" ? { kind: "alpha", index: 0 } : { kind: "composite" } }, quickMask: target === "quickMask", canUndo: false, canRedo: false };
  usePhotoWorkspace.setState({ state: source }); await render("filter.adaptiveWideAngle", false);
  expect([...container.querySelector<HTMLSelectElement>('[aria-label="Filter Interpolation"]')!.options].map(option => option.value)).toEqual(["nearest", "bilinear", "bicubic"]);
  await select("Filter Interpolation", "bilinear"); await submit(); expect(native.run).toHaveBeenLastCalledWith("filter.adaptiveWideAngle", expect.objectContaining({ interpolation: "bilinear" }));
});

it("uses native preview cancellation only when the image session advertises it", async () => {
  const state: PhotoState = { name: "Image", width: 100, height: 100, mode: "RGB", depth: 8, resolution: 72, activeLayer: 7, hasSelection: false, selectionBounds: null, layers: [{ ...layer, kind: "Pixel", hasPixels: true }], canUndo: false, canRedo: false, canCancelPreview: true };
  usePhotoWorkspace.setState({ state });
  native.invoke.mockImplementation((_name: string, args: Record<string, unknown>) => args.cancel ? Promise.resolve({}) : new Promise(() => {}));
  await render("brightnessContrast");
  await preview();
  const request = native.invoke.mock.calls[0]![1];
  expect(request.requestId).toEqual(expect.any(String));
  act(() => root.render(null));
  expect(native.invoke.mock.calls[1]![1]).toMatchObject({ requestId: request.requestId, cancel: true, params: {} });

});

it("uses Photoshop's wording for Wave, Offset, Levels and Lens Correction", async () => {
  await render("filter.distort.wave", false);
  expect([...container.querySelectorAll(".xd-ps-dialog-subhead")].map(item => item.textContent)).toEqual(["Wavelength", "Amplitude"]);
  expect(container.textContent).toContain("Number of Generators:");
  await render("filter.other.offset", false);
  expect([...container.querySelectorAll('[role="radiogroup"][aria-label="Filter Undefined areas"] label')].map(item => item.textContent)).toEqual(["Set to Background", "Repeat Edge Pixels", "Wrap Around"]);
  await render("levels");
  expect([...container.querySelectorAll(".xd-ps-dialog-subhead")].map(item => item.textContent)).toEqual(["Input Levels:", "Output Levels:"]);
  expect([...container.querySelectorAll(".xd-photo-levels input[type=number]")].map(item => item.getAttribute("aria-label"))).toEqual(["Adjustment Input black", "Adjustment Gamma", "Adjustment Input white", "Adjustment Output black", "Adjustment Output white"]);
});

describe("Photoshop 2026 adjustment layout", () => {
  const field = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const drag = (label: string, value: string) => act(async () => { const element = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
  const darkBins = Array.from({ length: 256 }, (_, level) => level >= 20 && level <= 100 ? 10 : 0);
  const stage = () => { const frame = document.createElement("div"); frame.className = "xd-photo-stage"; document.body.append(frame); frame.append(canvas); frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect); canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect); return frame; };
  const press = (x: number, y: number) => act(async () => { canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })); });
  const respond = (sample: number[] | null) => native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_sample" ? sample : [darkBins]);

  it("lays Brightness/Contrast out with the label bare, a round-thumb slider and Contrast centred on 0", async () => {
    await render("brightnessContrast");
    const slider = field("Adjustment Contrast slider");
    expect(slider.classList.contains("is-ps")).toBe(true);
    expect(container.querySelector(".xd-ps-dialog-field span")!.textContent).toBe("Brightness");
    expect(slider.value).toBe("0"); expect(slider.min).toBe("-1000"); expect(slider.max).toBe("1000");
    await drag("Adjustment Contrast slider", "500"); expect(field("Adjustment Contrast").value).toBe("50");
    await drag("Adjustment Contrast slider", "-500"); expect(field("Adjustment Contrast").value).toBe("-25");
    expect(slider.style.getPropertyValue("--xd-ps-from")).toBe("25%"); expect(slider.style.getPropertyValue("--xd-ps-to")).toBe("50%");
  });

  it("clamps Contrast to the legacy range when Use Legacy changes", async () => {
    await render("brightnessContrast"); await input("Adjustment Contrast", "-40"); await toggle("Adjustment Use legacy"); await input("Adjustment Contrast", "-90");
    await toggle("Adjustment Use legacy"); expect(field("Adjustment Contrast").value).toBe("-50");
    await toggle("Adjustment Use legacy"); await input("Adjustment Contrast", "100"); await toggle("Adjustment Use legacy"); expect(field("Adjustment Contrast").value).toBe("100");
    await toggle("Adjustment Use legacy"); expect(field("Adjustment Contrast").max).toBe("100");
  });

  it("solves Auto for Brightness/Contrast from the luminosity histogram", async () => {
    native.enabled = true; respond(null); vi.useFakeTimers();
    await render("brightnessContrast"); await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await click("Auto");
    expect(Number(field("Adjustment Brightness").value)).toBeGreaterThan(20); expect(Number(field("Adjustment Contrast").value)).toBeGreaterThan(20);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_histogram", expect.objectContaining({ space: "luminosity" }));
  });

  it("puts Exposure Gamma on a log slider with 1.00 in the middle", async () => {
    await render("exposure");
    const slider = field("Adjustment Gamma slider");
    expect(slider.value).toBe("0");
    await drag("Adjustment Gamma slider", "1000"); expect(field("Adjustment Gamma").value).toBe("9.99");
    await drag("Adjustment Gamma slider", "-1000"); expect(field("Adjustment Gamma").value).toBe("0.01");
    await drag("Adjustment Gamma slider", "500"); expect(Number(field("Adjustment Gamma").value)).toBeCloseTo(3.16, 1);
    expect(field("Adjustment Offset").step).toBe("0.0001"); expect(field("Adjustment Exposure").step).toBe("0.01");
  });

  it("sets Exposure Offset, Exposure and the gray point from the eyedroppers", async () => {
    native.enabled = true; stage(); respond([128, 128, 128]);
    await render("exposure");
    const dropper = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    await act(async () => dropper("Set white point (Exposure)").click()); await press(50, 50);
    expect(Number(field("Adjustment Exposure").value)).toBeCloseTo(2.19, 2);
    await act(async () => dropper("Set black point (Offset)").click()); await press(50, 50);
    expect(Number(field("Adjustment Offset").value)).toBeLessThan(-.3);
    await act(async () => dropper("Set gray point (Exposure)").click()); await press(50, 50);
    expect(Number(field("Adjustment Exposure").value)).toBeCloseTo(1.71, 1);
    expect(native.invoke.mock.calls.filter(([command]) => command === "xdesign_photo_sample")).toHaveLength(3);
  });

  it.each([["alpha", { channel: 0 }], ["mask", "mask"], ["quickMask", "quickMask"]] as const)("reads a %s target's own grey pixels for the histogram, Auto and the black and white eyedroppers", async (kind, target) => {
    native.enabled = true; stage(); native.invoke.mockImplementation(async (command: string) => command === "xdesign_photo_sample" ? [40] : [darkBins]);
    const state: PhotoState = { name: "Image", width: 100, height: 100, mode: "RGB", depth: 8, resolution: 72, activeLayer: 7, hasSelection: false, selectionBounds: null, layers: [{ ...layer, kind: "Pixel", hasMask: kind === "mask" }], quickMask: kind === "quickMask", layerMaskView: kind === "mask" ? { layer: 7, mode: "gray" } : null, channels: { alpha: [{ index: 0, name: "Alpha", spot: null, visible: true }], target: kind === "alpha" ? { kind: "alpha", index: 0 } : { kind: "composite" } }, canUndo: false, canRedo: false };
    const tools = () => ["Sample in image to set black point", "Sample in image to set gray point", "Sample in image to set white point"].map(name => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.disabled).concat(button("Auto").disabled);
    usePhotoWorkspace.setState({ state }); await render("levels", false); await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_histogram", expect.objectContaining({ target, ...kind === "mask" ? { layer: 7 } : {} }));
    expect([...container.querySelector<HTMLSelectElement>('select[aria-label="Adjustment Channel"]')!.options].map(option => option.textContent)).toEqual(["Gray"]);
    expect(tools()).toEqual([false, true, false, false]);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Sample in image to set black point"]')!.click()); await press(50, 50);
    const sample = native.invoke.mock.calls.find(([command]) => command === "xdesign_photo_sample")![1];
    expect(sample).toMatchObject({ target, x: 50, y: 50 }); expect(sample).not.toHaveProperty("space");
    expect(field("Adjustment Input black").value).toBe("40");
    await submit(); expect(native.run).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ inBlack: 40 }));
  });

  it("draws Threshold's histogram from the Quick Mask it edits", async () => {
    native.enabled = true; native.invoke.mockResolvedValue([darkBins]);
    usePhotoWorkspace.setState({ state: { name: "Image", width: 100, height: 100, mode: "RGB", depth: 8, resolution: 72, activeLayer: 7, hasSelection: false, selectionBounds: null, layers: [{ ...layer, kind: "Pixel" }], quickMask: true, channels: { alpha: [], target: { kind: "composite" } }, canUndo: false, canRedo: false } });
    await render("threshold", false); await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_histogram", expect.objectContaining({ target: "quickMask" }));
    expect(container.querySelector(".xd-photo-histogram path")).not.toBeNull();
  });

  it("chooses the Channel Mixer output with coloured circles instead of a dropdown", async () => {
    await render("channelMixer");
    expect(container.querySelector('select[aria-label="Adjustment Output channel"]')).toBeNull();
    const circles = [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Adjustment Output channel"] button')];
    expect(circles.map(item => item.getAttribute("aria-label"))).toEqual(["Red", "Green", "Blue"]);
    expect(circles[0]!.getAttribute("aria-checked")).toBe("true");
    await swatch("Adjustment Output channel", "Green"); expect(circles[1]!.getAttribute("aria-checked")).toBe("true");
    expect(field("Adjustment Green").value).toBe("100");
    expect(field("Adjustment Red slider").classList.contains("has-track")).toBe(true);
  });

  it("chooses the Selective Color range from nine swatches", async () => {
    await render("selectiveColor");
    expect(container.querySelector('select[aria-label="Adjustment Color range"]')).toBeNull();
    const names = [...container.querySelectorAll('[role="radiogroup"][aria-label="Adjustment Color range"] button')].map(item => item.getAttribute("aria-label"));
    expect(names).toEqual(["Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas", "Whites", "Neutrals", "Blacks"]);
    await input("Adjustment Cyan", "30"); await swatch("Adjustment Color range", "Neutrals"); expect(field("Adjustment Cyan").value).toBe("0");
    await swatch("Adjustment Color range", "Reds"); expect(field("Adjustment Cyan").value).toBe("30");
  });

  it("offers the Gradient tool's presets in Gradient Map, starting from foreground to background", async () => {
    const preset = (name: string, stops: [number, string][]) => ({ name, stops, transparency: [] as [number, number][] });
    usePhotoWorkspace.setState({ state: { tools: { foreground: [1, 0, 0, 1], background: [0, 0, 1, 1] }, presets: { gradient: preset("Foreground to Background", [[0, "foreground"], [1, "background"]]), gradients: [{ name: "Basics", presets: [preset("Foreground to Background", [[0, "foreground"], [1, "background"]]), preset("Mono", [[0, "#102030"], [1, "#f0e0d0"]])] }], styles: [] } } as unknown as PhotoState });
    container.classList.add("xd-photo"); await render("gradientMap"); expect(container.querySelector<HTMLSelectElement>('[aria-label="Adjustment Method"]')!.value).toBe("perceptual"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.newAdjustmentLayer.gradientMap", { stops: bakeGradient([[0, "#ff0000"], [1, "#0000ff"]], "perceptual"), reverse: false, dither: false });
    expect([...container.querySelectorAll(".xd-ps-dialog-group > legend")].map(legend => legend.textContent)).toEqual(["Gradient Used for Grayscale Mapping", "Gradient Options"]);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Gradient presets"]')!.click());
    await click("Basics"); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Mono"]')!.click());
    await select("Adjustment Method", "classic"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.newAdjustmentLayer.gradientMap", { stops: [[0, "#102030"], [1, "#f0e0d0"]], reverse: false, dither: false });
  });

  it("lays Color Lookup out as 3DLUT File, Abstract and Device Link with Dither on", async () => {
    await render("colorLookup");
    const types = [...container.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-label="Lookup type"] input[type=radio]')];
    expect(types.map(item => item.getAttribute("aria-label"))).toEqual(["3DLUT File", "Abstract", "Device Link"]);
    expect(types.map(item => item.checked)).toEqual([true, false, false]); expect(types.slice(1).every(item => item.disabled)).toBe(true);
    expect(button("Load lookup table…")).toBeUndefined();
    expect(field("Adjustment Dither").checked).toBe(true);
    native.open.mockResolvedValue("/fixtures/grade.cube"); await select("Adjustment Look", "load"); await submit();
    expect(native.run).toHaveBeenLastCalledWith("layer.newAdjustmentLayer.colorLookup", expect.objectContaining({ file: "/fixtures/grade.cube", dither: true }));
  });

  it("turns Motion Blur's angle with a dial", async () => {
    await render("filter.blur.motionBlur", false);
    const dial = container.querySelector<SVGSVGElement>(".xd-ls-dial")!;
    dial.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20 } as DOMRect);
    expect(dial.closest(".xd-ps-dialog-row")!.contains(field("Filter Angle"))).toBe(true); expect(container.querySelector('[aria-label="Filter Angle slider"]')).toBeNull();
    await act(async () => { dial.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 0 })); });
    expect(field("Filter Angle").value).toBe("90");
    await act(async () => { dial.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 10 })); });
    expect(field("Filter Angle").value).toBe("180");
  });
});
