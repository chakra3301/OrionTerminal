import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { embedRasterResources } from "./rasterResources";
const fetchMock = vi.fn();
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const svg = (href: string) => `<svg xmlns="http://www.w3.org/2000/svg"><image href="${href}"/></svg>`;
beforeEach(() => { fetchMock.mockReset().mockImplementation(async () => new Response(png)); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
it("embeds and deduplicates local raster sources for standalone SVG image rendering", async () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg"><image href="asset://localhost/test.png"/><image href="asset://localhost/test.png"/></svg>`;
  const output = await embedRasterResources(input);
  expect(output).not.toContain("asset://"); expect(output.match(/data:image\/png;base64,/g)).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock.mock.calls[0]?.[1].redirect).toBe("error");
});
it("does not fetch a remote, credential-bearing or executable SVG reference", async () => {
  for (const href of ["https://example.com/pixel.png", "http://asset.localhost.evil/a", "asset://user:secret@localhost/a", "data:image/svg+xml;base64,PHN2Zz4="]) {
    await expect(embedRasterResources(svg(href))).rejects.toThrow("Unsupported image reference");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects oversized declared resources before reading them", async () => {
  fetchMock.mockResolvedValue(new Response(png, { headers: { "Content-Length": String(21 * 1024 * 1024) } }));
  await expect(embedRasterResources(svg("asset://localhost/test.png"))).rejects.toThrow("20MB");
});
it("bounds streaming bodies even without a declared size", async () => {
  fetchMock.mockResolvedValue(new Response(new Uint8Array(20 * 1024 * 1024 + 1)));
  await expect(embedRasterResources(svg("asset://localhost/test.png"))).rejects.toThrow("20MB");
});
it("reports invalid image bytes instead of exporting an invisible missing image", async () => {
  fetchMock.mockResolvedValue(new Response("not a raster"));
  await expect(embedRasterResources(svg("asset://localhost/test.png"))).rejects.toThrow("supports PNG");
});
it("rejects malformed export XML", async () => {
  await expect(embedRasterResources("<svg><broken")).rejects.toThrow("Invalid export SVG");
  expect(fetchMock).not.toHaveBeenCalled();
});
