import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { PAINT_TOOL_FIELDS, sanitizePaintOptions, type PaintOptions } from "./PaintToolOptions";

export const PAINT_TOOL_PREFERENCES_KEY = "orion.xdesign.image-tools.v1";
const MAX_BYTES = 100 * 1024;
type Options = Record<string, PaintOptions>;
type Preferences = { options: Options; writable: boolean; notice: string | null };

export function sanitizePaintToolPreferences(value: unknown): Options {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(PAINT_TOOL_FIELDS).filter(tool => Object.hasOwn(value, tool)).map(tool => [tool, sanitizePaintOptions(tool, (value as Record<string, unknown>)[tool])]));
}
export function readPaintToolPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PAINT_TOOL_PREFERENCES_KEY);
    if (raw === null) return { options: {}, writable: true, notice: null };
    if (raw.length * 2 > MAX_BYTES) throw new Error("Image tool preferences exceed the limit");
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || (saved as Record<string, unknown>).schemaVersion !== 1 || !(saved as Record<string, unknown>).options || typeof (saved as Record<string, unknown>).options !== "object" || Array.isArray((saved as Record<string, unknown>).options)) throw new Error("Unsupported image tool preferences");
    return { options: sanitizePaintToolPreferences((saved as Record<string, unknown>).options), writable: true, notice: null };
  } catch {
    return { options: {}, writable: false, notice: "Saved image tool settings could not be read. Current settings apply to this session." };
  }
}
export function usePaintToolPreferences() {
  const [initial] = useState(readPaintToolPreferences);
  const [current, setCurrent] = useState({ options: initial.options, revision: 0 });
  const [notice, setNotice] = useState(initial.notice);
  useEffect(() => {
    if (!current.revision || !initial.writable) return;
    try {
      const raw = JSON.stringify({ schemaVersion: 1, options: current.options });
      if (raw.length * 2 > MAX_BYTES) throw new Error("Image tool preferences exceed the limit");
      localStorage.setItem(PAINT_TOOL_PREFERENCES_KEY, raw);
      setNotice(null);
    } catch {
      setNotice("Image tool settings could not be saved. Current settings apply to this session.");
    }
  }, [current, initial.writable]);
  const setOptions = useCallback((value: SetStateAction<Options>) => setCurrent(previous => ({ options: sanitizePaintToolPreferences(typeof value === "function" ? value(previous.options) : value), revision: previous.revision + 1 })), []);
  return { options: current.options, setOptions, notice };
}
