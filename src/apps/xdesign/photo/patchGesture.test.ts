import { describe, expect, it } from "vitest";
import { patchOffset, patchOffsetFitsCanvas, patchPreviewScale, patchTarget } from "./patchGesture";

describe("Patch gesture", () => {
  it("rounds image-coordinate deltas and ignores a zero-offset drag", () => {
    expect(patchOffset([10.25, 8.5], [3.75, 20.49])).toEqual([-7, 12]);
    expect(patchOffset([0,0],[0.5,-0.5])).toEqual([1,-1]);
    expect(patchOffset([0,0],[0,0.5])).toEqual([0,1]);
    expect(patchOffset([10, 8], [10.4, 7.6])).toBeNull();
    expect(patchOffset([2,2],[2,2])).toBeNull();
  });

  it("rejects translated selections that leave the canvas", () => {
    expect(patchOffsetFitsCanvas([-8, 3], [10, 12, 20, 16], 64, 48)).toBe(true);
    expect(patchOffsetFitsCanvas([-11, 0], [10, 12, 20, 16], 64, 48)).toBe(false);
    expect(patchOffsetFitsCanvas([0, 0], [10, 12, 20, 16], 64, 48)).toBe(false);
    expect(patchOffsetFitsCanvas([10, 0], null, 64, 48)).toBe(false);
    expect(patchOffsetFitsCanvas([Number.NaN, 0], [10, 12, 20, 16], 64, 48)).toBe(false);
    expect(patchOffsetFitsCanvas([10_000_000, 0], [10, 12, 20, 16], 64, 48)).toBe(false);
    expect(patchOffsetFitsCanvas([10, 0], [10, 12, -1, 16], 64, 48)).toBe(false);
  });

  it("bounds Patch feedback by raising display scale without omitting visible tiles",()=>{
    expect(patchPreviewScale(0,0,1600,1200,1)).toBe(2);
    expect(patchPreviewScale(0,0,1200,900,1)).toBe(1);
    expect(patchPreviewScale(511,511,1200,900,1)).toBe(2);
    expect(patchPreviewScale(0,0,300_000,300_000,1)).toBeNull();
    expect(patchPreviewScale(0,0,1200,900,3)).toBeNull();
    expect(patchOffset([0,0],[10_000_000,0])).toBeNull();
  });

  it("routes the selected layer, its mask, alpha channels, and Quick Mask", () => {
    expect(patchTarget({ layer: 7, mask: false, quickMask: false })).toEqual({ layer: 7, target: "pixels" });
    expect(patchTarget({ layer: 7, mask: true, quickMask: false })).toEqual({ layer: 7, target: "mask" });
    expect(patchTarget({ layer: 7, mask: false, quickMask: true })).toEqual({ target: "quickMask" });
    expect(patchTarget({ layer: 7, mask: false, quickMask: false, channel: { kind: "alpha", index: 2 } })).toEqual({ target: { channel: 2 } });
  });
});
