/** Code points a font maps to a glyph, read from its `cmap` table (formats 4 and 12), sorted. */
export function fontCodepoints(bytes: Uint8Array): number[] {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => data.getUint16(at), u32 = (at: number) => data.getUint32(at);
  try {
    let cmap = -1;
    for (let index = 0, tables = u16(4); index < tables; index++) {
      const record = 12 + index * 16;
      if (String.fromCharCode(...bytes.subarray(record, record + 4)) === "cmap") cmap = u32(record + 8);
    }
    if (cmap < 0) return [];
    // Prefer the full-repertoire Unicode subtable, then the BMP one, then a symbol font's.
    let best = -1, rank = 0;
    for (let index = 0, count = u16(cmap + 2); index < count; index++) {
      const record = cmap + 4 + index * 8, platform = u16(record), encoding = u16(record + 2), at = cmap + u32(record + 4), format = u16(at);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      const score = format === 12 && unicode ? 3 : format === 4 && unicode ? 2 : format === 4 && platform === 3 && encoding === 0 ? 1 : 0;
      if (score > rank) { rank = score; best = at; }
    }
    if (best < 0) return [];
    const found = new Set<number>();
    if (u16(best) === 12) {
      for (let group = 0, groups = u32(best + 12); group < groups && found.size < 0x20000; group++) {
        const at = best + 16 + group * 12, start = u32(at), end = Math.min(u32(at + 4), 0x10ffff), glyph = u32(at + 8);
        for (let code = start; code <= end && found.size < 0x20000; code++) if (glyph + code - start) found.add(code);
      }
    } else {
      const segments = u16(best + 6) / 2, ends = best + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment++) {
        const start = u16(starts + segment * 2), end = u16(ends + segment * 2), delta = data.getInt16(deltas + segment * 2), rangeOffset = u16(offsets + segment * 2);
        for (let code = start; code <= end && code !== 0xffff; code++) {
          const glyph = rangeOffset ? u16(offsets + segment * 2 + rangeOffset + (code - start) * 2) : 1;
          if (glyph && (rangeOffset ? glyph + delta : code + delta) & 0xffff) found.add(code);
        }
      }
    }
    return [...found].filter(code => code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && !(code >= 0xd800 && code <= 0xdfff) && (code & 0xfffe) !== 0xfffe).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** The Unicode blocks the Glyphs panel's Show menu offers, in Photoshop's order. */
export const UNICODE_BLOCKS: readonly (readonly [string, number, number])[] = [
  ["Basic Latin", 0x20, 0x7f], ["Latin-1 Supplement", 0xa0, 0xff], ["Latin Extended-A", 0x100, 0x17f], ["Latin Extended-B", 0x180, 0x24f],
  ["IPA Extensions", 0x250, 0x2af], ["Spacing Modifier Letters", 0x2b0, 0x2ff], ["Combining Diacritical Marks", 0x300, 0x36f], ["Greek and Coptic", 0x370, 0x3ff],
  ["Cyrillic", 0x400, 0x4ff], ["Hebrew", 0x590, 0x5ff], ["Arabic", 0x600, 0x6ff], ["Latin Extended Additional", 0x1e00, 0x1eff],
  ["General Punctuation", 0x2000, 0x206f], ["Superscripts and Subscripts", 0x2070, 0x209f], ["Currency Symbols", 0x20a0, 0x20cf], ["Letterlike Symbols", 0x2100, 0x214f],
  ["Number Forms", 0x2150, 0x218f], ["Arrows", 0x2190, 0x21ff], ["Mathematical Operators", 0x2200, 0x22ff], ["Miscellaneous Technical", 0x2300, 0x23ff],
  ["Box Drawing", 0x2500, 0x257f], ["Block Elements", 0x2580, 0x259f], ["Geometric Shapes", 0x25a0, 0x25ff], ["Miscellaneous Symbols", 0x2600, 0x26ff],
  ["Dingbats", 0x2700, 0x27bf], ["CJK Symbols and Punctuation", 0x3000, 0x303f], ["Hiragana", 0x3040, 0x309f], ["Katakana", 0x30a0, 0x30ff],
  ["CJK Unified Ideographs", 0x4e00, 0x9fff], ["Hangul Syllables", 0xac00, 0xd7af], ["Private Use Area", 0xe000, 0xf8ff], ["Alphabetic Presentation Forms", 0xfb00, 0xfb4f],
  ["Halfwidth and Fullwidth Forms", 0xff00, 0xffef], ["Emoji", 0x1f300, 0x1faff],
];
