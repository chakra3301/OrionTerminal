import { describe, expect, it } from "vitest";
import { computeImageHash } from "@open-pencil/scene-graph/images";
import { imageHash } from "./imageHash";

describe("imageHash", () => {
  it("matches OpenPencil's image hash for every length remainder", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 4099, 65536 + 3]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 131 + 7) & 255;
      expect(imageHash(bytes)).toBe(computeImageHash(bytes));
    }
  });
});
