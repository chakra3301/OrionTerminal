import type { PhotoRGBA } from "./types";

export function nativePaintColor(value: unknown): PhotoRGBA | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(v => typeof v === "number" && Number.isFinite(v))) return null;
  return [...value] as PhotoRGBA;
}
export function paintColorHex(value: unknown, fallback: string): string {
  const color = nativePaintColor(value);
  return color ? "#" + color.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("") : fallback;
}
export function paintColorRGBA(value: string): PhotoRGBA {
  return [...value.slice(1).match(/.{2}/g)!.map(v => parseInt(v, 16) / 255), 1] as PhotoRGBA;
}
