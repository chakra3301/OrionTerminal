import { Menu, Settings as Gear } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../../lib/ipc";
import { MenuButton } from "../EditorMenus";
import type { PhotoAction } from "./controls";
import { ADJUSTMENT_PRESETS, adjustmentDefaults, toneChannels } from "./adjustmentSettings";
import { decodeAdjustmentPreset, encodeAdjustmentPreset, PRESET_FILE_TYPES } from "./adjustmentPresetFiles";
import { deleteUserPreset, saveUserPreset, useUserPresets } from "./adjustmentUserPresets";
import "./adjustmentProperties.css";

type Settings = Record<string, unknown>;
// Levels and Curves keep Photoshop's classic gear; the 2026 dialogs use a list icon.
const CLASSIC = new Set(["levels", "curves"]);

export const stable = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item);
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const base64Of = (bytes: Uint8Array) => { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); };

const attempt = <T,>(work: () => T): T | null => { try { return work(); } catch { return null; } };
const USER = "user:";

export function AdjustmentPresetRow({ action, mode, values, locked, apply, fail }: { action: PhotoAction; mode: string; values: Settings; locked: boolean; apply: (values: Settings) => void; fail: (message: string) => void }) {
  const type = PRESET_FILE_TYPES[action.id], saved = useUserPresets(action.id);
  if (!type) return null;
  const defaults = adjustmentDefaults(action, mode, values), signature = stable(values);
  const presets = (ADJUSTMENT_PRESETS[action.id] ?? []).filter(() => action.id !== "curves" || toneChannels(mode, values)[0] === "red");
  const users = saved.flatMap(preset => { const decoded = attempt(() => decodeAdjustmentPreset(action.id, bytesOf(preset.data), mode)); return decoded ? [{ ...preset, values: decoded }] : []; });
  // A saved preset matches through its file bytes, so the engine's rounding of the committed values still names it.
  const encoded = attempt(() => base64Of(encodeAdjustmentPreset(action.id, values, mode))), user = users.find(preset => preset.data === encoded);
  const named = user ? undefined : [{ name: "Default", values: {} }, ...presets].find(item => stable({ ...defaults, ...item.values }) === signature);
  const choose = (name: string) => {
    const item = name === "Default" ? { values: {} } : name.startsWith(USER) ? users.find(candidate => candidate.name === name.slice(USER.length)) : presets.find(candidate => candidate.name === name);
    if (item && !locked) apply({ ...defaults, ...structuredClone(item.values) });
  };
  const filters = [{ name: type.name, extensions: [type.extension] }];
  const load = async () => {
    const path = await open({ multiple: false, filters });
    if (typeof path === "string") apply({ ...defaults, ...decodeAdjustmentPreset(action.id, bytesOf(await ipc.readFileBase64(path)), mode) });
  };
  const store = async () => {
    const path = await save({ defaultPath: `${user?.name ?? (named && named.name !== "Default" ? named.name : action.label)}.${type.extension}`, filters });
    if (!path) return;
    const data = base64Of(encodeAdjustmentPreset(action.id, values, mode));
    await ipc.writeFileBase64(path, data);
    // Photoshop lists a saved preset in the menu under its file name.
    saveUserPreset(action.id, path.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "") || action.label, data);
  };
  const run = (work: () => Promise<void>) => () => { fail(""); work().catch(error => fail(error instanceof Error ? error.message : String(error))); };
  return <div className="xd-photo-adjustment-preset">
    <label><span>Preset:</span>
      <select aria-label="Preset" disabled={locked} value={user ? USER + user.name : named?.name ?? "Custom"} onChange={event => choose(event.target.value)}>
        <option value="Default">Default</option>{presets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}{users.map(item => <option key={USER + item.name} value={USER + item.name}>{item.name}</option>)}{!named && !user && <option value="Custom">Custom</option>}
      </select>
    </label>
    <MenuButton label="Preset options" icon={CLASSIC.has(action.id) ? Gear : Menu} iconOnly align="end" disabled={locked} items={[
      { label: "Save Preset…", run: run(store) }, { label: "Load Preset…", run: run(load) }, { label: "Delete Current Preset", disabled: locked || !user, run: () => { if (user) deleteUserPreset(action.id, user.name); } },
    ]}/>
  </div>;
}
