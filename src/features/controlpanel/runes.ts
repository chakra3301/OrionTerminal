// A library of runic / alchemical glyph paths (line art, stroked not filled),
// drawn in a 24×24 box centered on (12,12). Picked deterministically per skill
// so each enchantment carries a distinct, stable sigil.

export const RUNES: string[] = [
  // circle + center dot (sol)
  "M4,12 a8,8 0 1 0 16,0 a8,8 0 1 0 -16,0 M10.6,12 a1.4,1.4 0 1 0 2.8,0 a1.4,1.4 0 1 0 -2.8,0",
  // circle + cross
  "M4,12 a8,8 0 1 0 16,0 a8,8 0 1 0 -16,0 M12,4 v16 M4,12 h16",
  // upward triangle + dot
  "M12,3 L20,19 L4,19 Z M10.7,14 a1.3,1.3 0 1 0 2.6,0 a1.3,1.3 0 1 0 -2.6,0",
  // inverted triangle + bar (air)
  "M4,6 L20,6 L12,20 Z M8,11 h8",
  // vertical + two crossbars
  "M12,3 v18 M7,8 h10 M7,15 h10",
  // diamond + inner cross
  "M12,3 L21,12 L12,21 L3,12 Z M12,7 v10 M7,12 h10",
  // crescent + stem
  "M9,4 a8,8 0 1 0 0,16 a5.5,5.5 0 1 1 0,-16 M16,4 v16",
  // up-arrow + crossbar (mars)
  "M12,20 v-16 M8,8 l4,-4 l4,4 M7,13 h10",
  // twin crescents + bar (pisces)
  "M7,4 a8,8 0 0 1 0,16 M17,4 a8,8 0 0 0 0,16 M4,12 h16",
  // z-rune
  "M7,5 h10 L7,19 h10",
  // trident
  "M12,5 v15 M6,9 V5 M18,9 V5 M6,9 a6,6 0 0 0 12,0",
  // square + center dot
  "M5,5 h14 v14 h-14 Z M10.6,12 a1.4,1.4 0 1 0 2.8,0 a1.4,1.4 0 1 0 -2.8,0",
  // six-spoke asterisk
  "M12,3 v18 M4.2,7.5 L19.8,16.5 M19.8,7.5 L4.2,16.5",
  // double wave (aquarius)
  "M4,9 q3,-3 6,0 t6,0 M4,15 q3,-3 6,0 t6,0",
  // eye
  "M3,12 q9,-8 18,0 q-9,8 -18,0 M9.4,12 a2.6,2.6 0 1 0 5.2,0 a2.6,2.6 0 1 0 -5.2,0",
  // branched stem (tree)
  "M12,4 v16 M12,20 l-4,-4 M12,20 l4,-4 M12,13 l-4,-4 M12,13 l4,-4",
  // ankh
  "M9,11 a3,3 0 1 0 6,0 a3,3 0 1 0 -6,0 M12,14 v7 M8,17 h8",
  // hexagram
  "M12,3 L19,16 L5,16 Z M12,21 L5,8 L19,8 Z",
];

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic runic glyph path for a seed. */
export function pickRune(seed: string): string {
  return RUNES[hashStr(seed || "x") % RUNES.length]!;
}
