import { expect, it } from "vitest";
import { docTabDetail } from "./docTab";
import type { PhotoLayer, PhotoState } from "./types";
const layer = (id: number, name: string) => ({ id, name }) as PhotoLayer;
const state = (over: Partial<PhotoState> = {}) => ({ mode: "Rgb", depth: 8, layers: [layer(1, "Background")], ...over }) as PhotoState;
it("drops the layer name for a lone Background and uppercases the mode", () => {
  expect(docTabDetail(state(), layer(1, "Background"))).toBe("RGB/8");
});
it("names the active layer once the document has more than the Background", () => {
  const layers = [layer(1, "Background"), layer(2, "Layer 1")];
  expect(docTabDetail(state({ layers }), layer(2, "Layer 1"))).toBe("Layer 1, RGB/8");
  expect(docTabDetail(state({ layers }), layer(1, "Background"))).toBe("Background, RGB/8");
});
it("uses Photoshop's mode names", () => {
  expect(docTabDetail(state({ mode: "Cmyk", depth: 16 }), undefined)).toBe("CMYK/16");
  expect(docTabDetail(state({ mode: "Lab" }), undefined)).toBe("Lab/8");
  expect(docTabDetail(state({ mode: "Grayscale", depth: 32 }), undefined)).toBe("Gray/32");
});
it("appends # only when the profile is known to be untagged", () => {
  expect(docTabDetail(state({ colorProfile: { description: "sRGB", colorSpace: "Rgb", embedded: false, bytes: 0 } }), undefined)).toBe("RGB/8#");
  expect(docTabDetail(state({ colorProfile: { description: "sRGB", colorSpace: "Rgb", embedded: true, bytes: 3 } }), undefined)).toBe("RGB/8");
  expect(docTabDetail(state(), undefined)).toBe("RGB/8");
});
it("names a targeted colour channel in place of the mode", () => {
  const layers = [layer(1, "Background"), layer(2, "Layer 1")];
  const channels = { alpha: [], colors: [{ name: "Red" }, { name: "Green" }, { name: "Blue" }], target: { kind: "color", index: 0 } } as unknown as PhotoState["channels"];
  expect(docTabDetail(state({ layers, channels }), layer(2, "Layer 1"))).toBe("Layer 1, Red/8");
  expect(docTabDetail(state({ channels: { ...channels!, target: { kind: "composite" } } }), layer(1, "Background"))).toBe("RGB/8");
});
