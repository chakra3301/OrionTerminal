/**
 * Pinned Brain positions (owner, 2026-11-07: "when i drag a node i want it to
 * stay wherever i put it"). A dragged note keeps its place in the layout and
 * across launches; Option-click releases it back to the simulation.
 * Stored in app_state as { [noteId]: [x, y, z] } in layout space.
 */
import { getAppState, setAppState } from "@/lib/db";
import { log } from "@/lib/log";

export type Pins = Map<string, [number, number, number]>;

const KEY = "archives.brainPins" as const;

export function parsePins(raw: unknown): Pins {
  const pins: Pins = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return pins;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      pins.set(id, [v[0], v[1], v[2]]);
    }
  }
  return pins;
}

export function serializePins(pins: Pins): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const [id, p] of pins) out[id] = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10];
  return out;
}

export async function loadPins(): Promise<Pins> {
  return parsePins(await getAppState<unknown>(KEY).catch(() => null));
}

export function savePins(pins: Pins): void {
  void setAppState(KEY, serializePins(pins)).catch((e) => log.warn("brain pins save failed", e));
}
