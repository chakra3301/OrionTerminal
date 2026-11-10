type Color = [number, number, number, number];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i;
function component(value: string, scale: number): number | undefined {
  if (!number.test(value)) return;
  const result = Number.parseFloat(value) / (value.endsWith('%') ? 100 : scale);
  return Number.isFinite(result) ? clamp(result) : undefined;
}
function parseColor(value: string): Color | undefined {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  if (/^#[\da-f]{3,4}$|^#[\da-f]{6}(?:[\da-f]{2})?$/.test(text)) {
    const hex = text.slice(1), full = hex.length <= 4 ? [...hex].map(value => value + value).join('') : hex;
    return [0, 2, 4, 6].map((start, index) => index === 3 && full.length === 6 ? 1 : Number.parseInt(full.slice(start, start + 2), 16) / 255) as Color;
  }
  const rgb = /^rgba?\(([^()]*)\)$/.exec(text), srgb = /^color\(srgb\s+([^()]*)\)$/.exec(text);
  const body = rgb?.[1] ?? srgb?.[1]; if (!body) return;
  const comma = body.includes(','), slash = body.split('/');
  if (slash.length > 2 || comma && (srgb || slash.length !== 1)) return;
  const values = comma ? body.split(',').map(value => value.trim()) : slash[0]!.trim().split(/\s+/);
  if (comma ? ![3, 4].includes(values.length) : values.length !== 3) return;
  const alpha = comma ? values[3] : slash[1]?.trim();
  const result = values.slice(0, 3).map(value => component(value, srgb ? 1 : 255)); result.push(alpha === undefined ? 1 : component(alpha, 1));
  return result.every((value): value is number => value !== undefined) ? result as Color : undefined;
}

export function smartRgbaAt(a: Color, b: Color, progress: number): Color {
  if (!Number.isFinite(progress)) throw new Error('Choose a finite Smart Animate paint position.');
  if (progress === 0) return [...a]; if (progress === 1) return [...b];
  const alpha = a[3] + (b[3] - a[3]) * progress;
  const channels = a.slice(0, 3).map((value, index) => alpha > 0 ? clamp((value * a[3] + (b[index]! * b[3] - value * a[3]) * progress) / alpha) : 0);
  return [...channels, clamp(alpha)] as Color;
}
export function smartColorTween(from: string, to: string): ((progress: number) => string) | undefined {
  const a = parseColor(from), b = parseColor(to); if (!a || !b) return;
  return progress => {
    if (!Number.isFinite(progress)) throw new Error('Choose a finite Smart Animate paint position.');
    if (progress === 0) return from; if (progress === 1) return to;
    // Premultiply before interpolation so transparent endpoints do not darken the visible color.
    const rgba = smartRgbaAt(a, b, progress);
    return `rgba(${rgba.slice(0, 3).map(value => Number((value * 255).toFixed(6))).join(',')},${Number(rgba[3].toFixed(6))})`;
  };
}
