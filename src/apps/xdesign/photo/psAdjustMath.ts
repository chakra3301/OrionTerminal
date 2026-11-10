import { autoLevels } from "./toneControls";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, decimals: number) => Number(value.toFixed(decimals));
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Brightness/Contrast Auto. The engine has no automatic B/C (image.autoTone and friends only apply a fixed correction), so
 * the mean pulls to mid-gray and the 0.1%-clipped range stretches to the full scale, solved against the engine's own curves.
 */
export function autoBrightnessContrast(bins: number[], legacy: boolean): { brightness: number; contrast: number } | null {
  const total = bins.reduce((sum, count) => sum + count, 0), range = autoLevels(bins);
  if (!total || !range) return null;
  const mean = bins.reduce((sum, count, level) => sum + count * level, 0) / total;
  if (legacy) {
    const stretch = 255 / Math.max(range[1] - range[0], 1), moved = ((mean / 255 - .5) * stretch + .5) * 255;
    return { brightness: clamp(Math.round(127.5 - moved), -150, 150), contrast: clamp(Math.round(100 * (1 - 1 / stretch)), 0, 99) };
  }
  // Modern brightness is a line of slope 1.375^(b/50) from black.
  const slope = 127.5 / Math.max(mean, 1), brightness = clamp(Math.round(50 * Math.log(slope) / Math.log(1.375)), -150, 150), lifted = 1.375 ** (brightness / 50);
  const stretch = 255 / Math.max(Math.min(255, range[1] * lifted) - Math.min(254, range[0] * lifted), 1);
  // The modern contrast curve has centre slope 1 + c/128.
  return { brightness, contrast: clamp(Math.round(128 * (stretch - 1)), 0, 100) };
}

/** Exposure linearises through a pure 2.2 power for RGB and the dot-gain gamma for gray documents (photocraft compose/adjust.rs). */
const transferGamma = (mode: string) => ["grayscale", "duotone", "bitmap"].includes(mode.toLowerCase()) ? 1.732 : 2.2;
export type ExposureTone = "black" | "gray" | "white";

/**
 * What an Exposure eyedropper click sets, from the engine's formula out = (lin·2^exposure + offset)^(1/gamma):
 * black solves offset so the sample reaches 0, white solves exposure so it reaches 1, gray solves exposure so it lands on
 * 50% display gray. An unreachable target leaves the values alone.
 */
export function exposureSamplePatch(tone: ExposureTone, sample: [number, number, number], values: Record<string, unknown>, mode: string): Record<string, number> {
  const g = transferGamma(mode), [r, gr, b] = sample.map(channel => (clamp(channel, 0, 255) / 255) ** g) as [number, number, number];
  const lin = .2126 * r + .7152 * gr + .0722 * b, multiplier = 2 ** num(values.exposure, 0), offset = num(values.offset, 0), gamma = Math.max(num(values.gamma, 1), .01);
  if (tone === "black") return { offset: round(clamp(-lin * multiplier, -.5, .5), 4) };
  if (lin < 1e-4) return {};
  const target = tone === "white" ? 1 : .5 ** (g * gamma), needed = (target - offset) / lin;
  return needed > 0 ? { exposure: round(clamp(Math.log2(needed), -20, 20), 2) } : {};
}

export const BLACK_WHITE_KEYS = ["reds", "yellows", "greens", "cyans", "blues", "magentas"];
const BLACK_WHITE_DEFAULTS = [40, 60, 40, 60, 20, 80];

/** The engine's Black & White split of a pixel (compose/adjust.rs black_white_gray): its gray part, then its secondary and primary parts with their slider indices. */
function blackWhiteParts(r: number, g: number, b: number): [number, number, number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), mid = r + g + b - max - min;
  const primary = r >= g && r >= b ? 0 : g >= b ? 2 : 4, secondary = b <= r && b <= g ? 1 : r <= g ? 3 : 5;
  return [min, mid - min, secondary, max - mid, primary];
}

/**
 * Black & White Auto. Photoshop says it maximises the spread of gray values and the engine has no Auto, so this
 * climbs each slider in turn toward the most even 64-bin gray histogram over at most `limit` sampled pixels.
 */
export function autoBlackWhite(rgba: Uint8Array, limit = 4096): number[] {
  const stride = Math.max(1, Math.floor(rgba.length / 4 / limit)), parts: ReturnType<typeof blackWhiteParts>[] = [];
  for (let at = 0; at < rgba.length; at += stride * 4) if (rgba[at + 3]) parts.push(blackWhiteParts(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!));
  const weights = [...BLACK_WHITE_DEFAULTS];
  if (!parts.some(([, secondary, , primary]) => secondary || primary)) return weights;
  const entropy = (w: number[]) => {
    const bins = new Array<number>(64).fill(0);
    for (const [gray, secondary, s, primary, p] of parts) bins[Math.min(63, Math.max(0, Math.floor((gray + secondary * w[s]! / 100 + primary * w[p]! / 100) / 4)))]!++;
    return bins.reduce((sum, count) => count ? sum - count / parts.length * Math.log2(count / parts.length) : sum, 0);
  };
  let best = entropy(weights);
  for (const step of [80, 40, 20, 10, 5]) for (let moved = true, rounds = 0; moved && rounds < 8; rounds++) {
    moved = false;
    for (let i = 0; i < 6; i++) for (const next of [weights[i]! - step, weights[i]! + step]) {
      if (next < -200 || next > 300) continue;
      const tried = weights.map((value, at) => at === i ? next : value), score = entropy(tried);
      if (score > best + 1e-9) { best = score; weights[i] = next; moved = true; }
    }
  }
  return weights;
}
