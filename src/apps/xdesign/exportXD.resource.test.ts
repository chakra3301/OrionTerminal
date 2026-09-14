import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
const m = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: m.save }));
vi.mock("@/lib/ipc", () => ({ ipc: { xdesignSaveBytes: m.write } }));
import { buildExportSVG, exportSVG, setExportSvgRef } from "./exportXD";
const bounds = { x: 0, y: 0, w: 420, h: 420 };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("fetch", m.fetch);
  m.save.mockResolvedValue("/synthetic/export.svg"); m.write.mockResolvedValue(undefined);
  m.fetch.mockImplementation(async () => new Response(new Uint8Array([137,80,78,71,13,10,26,10])));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.innerHTML = '<g transform="translate(5,5)"><image href="asset://localhost/test.png" width="420" height="420"/></g><circle data-overlay="true"/>';
  setExportSvgRef(svg);
});
afterEach(() => { setExportSvgRef(null); vi.unstubAllGlobals(); });
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
