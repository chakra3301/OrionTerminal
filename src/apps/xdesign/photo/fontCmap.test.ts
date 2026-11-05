import { describe, expect, it } from "vitest";
import { fontCodepoints } from "./fontCmap";

/** A font with only a table directory and a cmap holding `subtables` ([platform, encoding, bytes]). */
function syntheticFont(subtables: [number, number, number[]][]): Uint8Array {
  const header = 4 + subtables.length * 8, cmap: number[] = [0, 0, 0, subtables.length];
  let offset = header;
  for (const [platform, encoding, body] of subtables) { cmap.push(0, platform, 0, encoding, offset >>> 24, (offset >>> 16) & 255, (offset >>> 8) & 255, offset & 255); offset += body.length; }
  for (const [, , body] of subtables) cmap.push(...body);
  return new Uint8Array([0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0, ..."cmap".split("").map(c => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0, cmap.length, ...cmap]);
}
const be16 = (value: number) => [(value >>> 8) & 255, value & 255], be32 = (value: number) => [...be16(value >>> 16), ...be16(value & 0xffff)];
/** Format 4 with direct-delta segments. */
const format4 = (segments: [number, number, number][]) => {
  const all = [...segments, [0xffff, 0xffff, 1] as [number, number, number]], count = all.length;
  return [...be16(4), ...be16(16 + count * 8), 0, 0, ...be16(count * 2), 0, 0, 0, 0, 0, 0, ...all.flatMap(([, end]) => be16(end)), 0, 0, ...all.flatMap(([start]) => be16(start)), ...all.flatMap(([, , delta]) => be16(delta & 0xffff)), ...all.flatMap(() => be16(0))];
};
const format12 = (groups: [number, number, number][]) => [...be16(12), 0, 0, ...be32(16 + groups.length * 12), ...be32(0), ...be32(groups.length), ...groups.flatMap(([start, end, glyph]) => [...be32(start), ...be32(end), ...be32(glyph)])];

describe("fontCodepoints", () => {
  it("reads a BMP format 4 cmap, leaving out control characters and unmapped codes", () => {
    expect(fontCodepoints(syntheticFont([[3, 1, format4([[0x10, 0x12, 1], [0x41, 0x43, -0x40], [0xe9, 0xe9, -0xe0]])]]))).toEqual([0x41, 0x42, 0x43, 0xe9]);
  });

  it("prefers the full-repertoire format 12 subtable for emoji and other astral glyphs", () => {
    const font = syntheticFont([[3, 1, format4([[0x41, 0x41, -0x40]])], [3, 10, format12([[0x41, 0x42, 1], [0x1f600, 0x1f601, 3]])]]);
    expect(fontCodepoints(font)).toEqual([0x41, 0x42, 0x1f600, 0x1f601]);
  });

  it("returns nothing for bytes that are not a font", () => {
    expect(fontCodepoints(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(fontCodepoints(new Uint8Array(0))).toEqual([]);
  });
});
