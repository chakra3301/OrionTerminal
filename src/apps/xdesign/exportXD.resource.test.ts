import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
const m = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), fetch: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: m.invoke, convertFileSrc: (path: string) => `asset://localhost${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: m.save }));
vi.mock("@/lib/ipc", () => ({ ipc: { xdesignSaveBytes: m.write } }));
import { buildExportSVG, exportSVG, renderPngBytes, setExportSvgRef } from "./exportXD";
import { useXDProjects } from "./projectsStore";
import { useXDesign } from "./store";
const bounds = { x: 0, y: 0, w: 420, h: 420 };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("fetch", m.fetch);
  m.save.mockResolvedValue("/synthetic/export.svg"); m.write.mockResolvedValue(undefined);
  m.fetch.mockImplementation(async () => new Response(new Uint8Array([137,80,78,71,13,10,26,10])));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.innerHTML = '<g transform="translate(5,5)"><image href="asset://localhost/test.png" width="420" height="420"/></g><circle data-overlay="true"/>';
  setExportSvgRef(svg);
});
afterEach(() => { setExportSvgRef(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("builds valid export XML without viewport transform or selection overlays", () => {
  const svg = buildExportSVG(bounds)!;
  expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
  expect(svg).not.toContain("translate"); expect(svg).not.toContain("data-overlay");
});
it("uses a native save dialog and writes self-contained image SVG bytes", async () => {
  await exportSVG(bounds, "test.svg");
  expect(m.save).toHaveBeenCalledWith({ defaultPath: "test.svg", filters: [{ name: "SVG", extensions: ["svg"] }] });
  const written = new TextDecoder().decode(new Uint8Array(m.write.mock.calls[0]![1]));
  expect(written).toContain("data:image/png;base64,"); expect(written).not.toContain("asset://");
});
it("does not write when the user cancels saving", async () => {
  m.save.mockResolvedValue(null); await exportSVG(bounds, "test.svg"); expect(m.write).not.toHaveBeenCalled();
});
const photoId = "01ARZ3NDEKTSV4RRFFQ69G5FC0";
function boardWithPhoto() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.innerHTML = `<g transform="translate(0,0)"><image data-photo-document="${photoId}" href="asset://localhost/preview.png" width="420" height="420"/></g>`;
  setExportSvgRef(svg);
  vi.stubGlobal("Image", class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new NodeBlob([new Uint8Array([137, 80, 78, 71])]) as unknown as Blob));
  URL.createObjectURL = vi.fn(() => "blob:board"); URL.revokeObjectURL = vi.fn();
}
const fetched = () => m.fetch.mock.calls.map(([url]) => url);
it("draws a preview from the board's own image, without rendering the photo at full resolution", async () => {
  boardWithPhoto();
  expect(await renderPngBytes(bounds, 640, false)).toEqual([137, 80, 78, 71]);
  expect(m.invoke).not.toHaveBeenCalled();
  expect(fetched()).toEqual(["asset://localhost/preview.png"]);
});
it("still renders photos at full resolution for the Claude vision picture", async () => {
  boardWithPhoto();
  useXDProjects.setState({ activeId: "01ARZ3NDEKTSV4RRFFQ69G5FB0" });
  useXDesign.setState({ photoDocuments: { [photoId]: { version: "v1" } } as never });
  m.invoke.mockResolvedValue("/data/render.png");
  expect(await renderPngBytes(bounds)).toEqual([137, 80, 78, 71]);
  expect(m.invoke).toHaveBeenCalledWith("xdesign_photo_render", { projectId: "01ARZ3NDEKTSV4RRFFQ69G5FB0", photoId, version: "v1" });
  expect(fetched()).toEqual(["asset://localhost/data/render.png"]);
  useXDProjects.setState({ activeId: null }); useXDesign.setState({ photoDocuments: {} });
});
