import { useEffect, useState } from "react";
import { PRESET_FILE_TYPES } from "./adjustmentPresetFiles";

export const ADJUSTMENT_PRESETS_KEY = "orion.xdesign.adjustment-presets.v1";
const ADJUSTMENT_PRESETS_CHANGED = "orion:adjustment-presets";
/** A saved preset keeps the Photoshop file bytes, base64, so it reads back through the same decoder as Load Preset…. */
export type UserPreset = { name: string; data: string };
type Store = Record<string, UserPreset[]>;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const valid = (item: unknown): item is UserPreset => !!item && typeof item === "object" && typeof (item as UserPreset).name === "string" && !!(item as UserPreset).name.trim()
  && typeof (item as UserPreset).data === "string" && !!(item as UserPreset).data && BASE64.test((item as UserPreset).data);

function loadStore(): Store {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(ADJUSTMENT_PRESETS_KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([kind, list]) => Object.hasOwn(PRESET_FILE_TYPES, kind) && Array.isArray(list)).map(([kind, list]) => {
      const kept: UserPreset[] = [];
      for (const item of list as unknown[]) if (valid(item) && !kept.some(other => other.name === item.name)) kept.push({ name: item.name, data: item.data });
      return [kind, kept];
    }));
  } catch { return {}; }
}
function storePresets(kind: string, next: UserPreset[]) {
  const store = { ...loadStore(), [kind]: next };
  try { localStorage.setItem(ADJUSTMENT_PRESETS_KEY, JSON.stringify(store)); } catch { /* Presets stay for this session when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(ADJUSTMENT_PRESETS_CHANGED, { detail: store }));
}
// Photoshop replaces a preset saved under a name already in the list.
export function saveUserPreset(kind: string, name: string, data: string) {
  const presets = loadStore()[kind] ?? [], preset = { name, data }, index = presets.findIndex(item => item.name === name);
  storePresets(kind, index === -1 ? [...presets, preset] : presets.map((item, at) => at === index ? preset : item));
}
export function deleteUserPreset(kind: string, name: string) { storePresets(kind, (loadStore()[kind] ?? []).filter(item => item.name !== name)); }

export function useUserPresets(kind: string): UserPreset[] {
  const [store, setStore] = useState(loadStore);
  useEffect(() => { const sync = (event: Event) => setStore((event as CustomEvent<Store>).detail); window.addEventListener(ADJUSTMENT_PRESETS_CHANGED, sync); return () => window.removeEventListener(ADJUSTMENT_PRESETS_CHANGED, sync); }, []);
  return store[kind] ?? [];
}
