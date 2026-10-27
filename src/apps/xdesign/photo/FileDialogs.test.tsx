import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtboardsToPdfDialog, ColorLookupDialog, ConditionalModeDialog, FileInfoDialog, FitImageDialog, LayersToFilesDialog, PathsToIllustratorDialog } from "./FileDialogs";
import { usePhotoWorkspace } from "./runtime";

const native = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: native.save }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of [native.run, native.save, native.open]) mock.mockReset().mockResolvedValue(undefined);
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null, state: null });
  container = document.createElement("div"); container.className = "xd-photo"; document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const field = <T extends Element = HTMLInputElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const button = (label: string) => [...container.querySelectorAll("button")].find(element => element.textContent === label)!;
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const type = (label: string, value: string) => act(async () => { const input = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const choose = (label: string, value: string) => act(async () => { const element = field<HTMLSelectElement>(label); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const title = () => container.querySelector("h3")!.textContent;
const options = (label: string) => [...field<HTMLSelectElement>(label).options].map(option => [option.value, option.textContent]);

describe("File menu dialogs", () => {
  it("reads File Info when it opens and writes only the fields that changed", async () => {
    native.run.mockResolvedValueOnce({ title: "Old", author: "Ann; Bo", authorTitle: "", description: "Coast", keywords: ["sea", "sky"], copyright: "", copyrightStatus: "unknown", copyrightUrl: "" });
    const close = vi.fn();
    await act(async () => root.render(<FileInfoDialog close={close}/>));
    expect(native.run).toHaveBeenCalledWith("file.fileInfo", {});
    expect(title()).toBe("File Info");
    expect(["Document Title", "Author", "Author Title", "Keywords", "Copyright Notice", "Copyright Info URL"].map(label => field(label).value)).toEqual(["Old", "Ann; Bo", "", "sea; sky", "", ""]);
    expect(field<HTMLTextAreaElement>("Description").value).toBe("Coast");
    expect(options("Copyright Status")).toEqual([["unknown", "Unknown"], ["copyrighted", "Copyrighted"], ["publicDomain", "Public Domain"]]);
    await type("Document Title", "New"); await type("Keywords", "sea, sky, sun"); await choose("Copyright Status", "copyrighted");
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.fileInfo", { title: "New", keywords: "sea, sky, sun", copyrightStatus: "copyrighted" });
    expect(close).toHaveBeenCalled();
  });

  it("closes File Info without a history step when nothing changed", async () => {
    native.run.mockResolvedValueOnce({ title: "Old", author: "", authorTitle: "", description: "", keywords: [], copyright: "", copyrightStatus: "unknown", copyrightUrl: "" });
    const close = vi.fn();
    await act(async () => root.render(<FileInfoDialog close={close}/>));
    await submit();
    expect(native.run).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  it("fits the image within a box through Image Size, keeping its proportions", async () => {
    const close = vi.fn();
    await act(async () => root.render(<FitImageDialog width={800} height={600} close={close}/>));
    expect(title()).toBe("Fit Image");
    expect([field("Width").value, field("Height").value, field("Don't Enlarge").checked]).toEqual(["800", "600", false]);
    await type("Width", "400"); await type("Height", "400");
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.imageSize", { width: 400, height: 300, resample: "bicubic" });
    expect(close).toHaveBeenCalled();
  });

  it("enlarges to fit unless Don't Enlarge is on", async () => {
    const close = vi.fn();
    await act(async () => root.render(<FitImageDialog width={800} height={600} close={close}/>));
    await type("Width", "1600"); await type("Height", "1600");
    await click(field("Don't Enlarge"));
    await submit();
    expect(native.run).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<FitImageDialog key="again" width={800} height={600} close={close}/>));
    await type("Width", "1600"); await type("Height", "1600");
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.imageSize", { width: 1600, height: 1200, resample: "bicubic" });
  });

  it("changes the mode only when the image is in a checked source mode", async () => {
    const close = vi.fn();
    await act(async () => root.render(<ConditionalModeDialog mode="RGB" close={close}/>));
    expect(title()).toBe("Conditional Mode Change");
    expect(["Bitmap", "Grayscale", "Duotone", "Indexed Color", "RGB Color", "CMYK Color", "Lab Color", "Multichannel"].map(label => field(label).checked)).toEqual(Array(8).fill(false));
    expect(options("Mode")).toEqual([["grayscale", "Grayscale"], ["rgb", "RGB Color"], ["cmyk", "CMYK Color"], ["lab", "Lab Color"]]);
    await click(field("Grayscale")); await choose("Mode", "cmyk");
    await submit();
    expect(native.run).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<ConditionalModeDialog key="all" mode="RGB" close={close}/>));
    await click(button("All"));
    expect(field("Multichannel").checked).toBe(true);
    await submit();
    expect(native.run).not.toHaveBeenCalled();
    await act(async () => root.render(<ConditionalModeDialog key="lab" mode="RGB" close={close}/>));
    await click(button("All")); await click(button("None")); await click(field("RGB Color")); await choose("Mode", "lab");
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("image.mode.lab", {});
  });

  it("exports a Color Lookup Table through the save dialog", async () => {
    native.save.mockResolvedValueOnce(null).mockResolvedValueOnce("/out/Look.cube");
    native.run.mockResolvedValue({ path: "/out/Look.cube", size: 64 });
    const close = vi.fn();
    await act(async () => root.render(<ColorLookupDialog name="Portrait.psd" close={close}/>));
    expect(title()).toBe("Export Color Lookup Tables");
    expect([field("Description").value, field("Grid Points").value]).toEqual(["Portrait", "32"]);
    await type("Description", "Warm"); await type("Grid Points", "64");
    await submit();
    expect(native.save).toHaveBeenCalledWith({ defaultPath: "Portrait.cube", filters: [{ name: "CUBE", extensions: ["cube"] }] });
    expect(native.run).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.export.colorLookupTables", { size: 64, title: "Warm", path: "/out/Look.cube" });
    expect(close).toHaveBeenCalled();
  });

  it("keeps Grid Points within Photoshop's range", async () => {
    await act(async () => root.render(<ColorLookupDialog name="Portrait" close={vi.fn()}/>));
    await type("Grid Points", "300");
    expect(button("OK").disabled).toBe(true);
    await type("Grid Points", "6");
    expect(button("OK").disabled).toBe(true);
  });

  it("exports the chosen paths to Illustrator through the save dialog", async () => {
    native.save.mockResolvedValue("/out/Portrait.ai");
    native.run.mockResolvedValue({ path: "/out/Portrait.ai", paths: 1 });
    const close = vi.fn();
    await act(async () => root.render(<PathsToIllustratorDialog name="Portrait.psd" paths={{ saved: ["Outline"], work: true }} close={close}/>));
    expect(title()).toBe("Export Paths to Illustrator");
    expect(options("Write")).toEqual([["all", "All Paths"], ["work", "Work Path"], ["Outline", "Outline"]]);
    await choose("Write", "Outline");
    await submit();
    expect(native.save).toHaveBeenCalledWith({ defaultPath: "Portrait.ai", filters: [{ name: "Adobe Illustrator", extensions: ["ai"] }] });
    expect(native.run).toHaveBeenLastCalledWith("file.export.pathsToIllustrator", { paths: "Outline", path: "/out/Portrait.ai" });
    expect(close).toHaveBeenCalled();
  });

  it("leaves out Work Path when there is none", async () => {
    await act(async () => root.render(<PathsToIllustratorDialog name="Portrait" paths={{ saved: ["Outline"], work: false }} close={vi.fn()}/>));
    expect(options("Write")).toEqual([["all", "All Paths"], ["Outline", "Outline"]]);
  });

  it("exports all or the selected artboards to one PDF through the save dialog", async () => {
    native.save.mockResolvedValue("/out/Portrait.pdf");
    native.run.mockResolvedValue({ path: "/out/Portrait.pdf", pages: 1 });
    const close = vi.fn();
    await act(async () => root.render(<ArtboardsToPdfDialog name="Portrait.psd" selected={[3]} close={close}/>));
    expect(title()).toBe("Artboards To PDF");
    expect([field("Export Selected Artboards").checked, field("Quality").value]).toEqual([false, "10"]);
    await type("Quality", "13");
    expect(button("Run").disabled).toBe(true);
    await type("Quality", "6"); await click(field("Export Selected Artboards"));
    await submit();
    expect(native.save).toHaveBeenCalledWith({ defaultPath: "Portrait.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    expect(native.run).toHaveBeenLastCalledWith("file.export.artboardsToPdf", { quality: 6, artboards: [3], path: "/out/Portrait.pdf" });
    expect(close).toHaveBeenCalled();
    await act(async () => root.render(<ArtboardsToPdfDialog key="none" name="Portrait" selected={[]} close={vi.fn()}/>));
    expect(field("Export Selected Artboards").disabled).toBe(true);
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.export.artboardsToPdf", { quality: 10, path: "/out/Portrait.pdf" });
  });

  it("exports layers to files in the chosen folder", async () => {
    native.open.mockResolvedValue("/out/layers");
    native.run.mockResolvedValue({ files: ["/out/layers/Portrait_0000_Shape 1.jpg"] });
    const close = vi.fn();
    await act(async () => root.render(<LayersToFilesDialog name="Portrait.psd" close={close}/>));
    expect(title()).toBe("Export Layers To Files");
    expect([field("Destination").value, field("File Name Prefix").value, field("Visible Layers Only").checked, field<HTMLSelectElement>("File Type").value]).toEqual(["", "Portrait", true, "psd"]);
    expect(options("File Type")).toEqual([["bmp", "BMP"], ["jpg", "JPEG"], ["psd", "PSD"], ["tga", "Targa"], ["tif", "TIFF"], ["png", "PNG-24"]]);
    expect(field("Quality")).toBeNull();
    expect(button("Run").disabled).toBe(true);
    await click(button("Browse…"));
    expect(native.open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(field("Destination").value).toBe("/out/layers");
    await choose("File Type", "jpg");
    expect(field("Quality").value).toBe("8");
    await type("Quality", "10"); await click(field("Visible Layers Only"));
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.export.layersToFiles", { dir: "/out/layers", prefix: "Portrait", visibleOnly: false, format: "jpg", quality: 10 });
    expect(close).toHaveBeenCalled();
  });

  it("sends no quality for formats without one", async () => {
    await act(async () => root.render(<LayersToFilesDialog name="Portrait" close={vi.fn()}/>));
    await type("Destination", "/out");
    await submit();
    expect(native.run).toHaveBeenLastCalledWith("file.export.layersToFiles", { dir: "/out", prefix: "Portrait", visibleOnly: true, format: "psd" });
  });
});
