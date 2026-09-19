import { PRESETS, type MetalFxPreset, type PresetMode } from "metal-fx";

export function metalMaterial(preset: MetalFxPreset, mode: "dark" | "light" = "dark"): PresetMode {
  const original = PRESETS[preset].modes[mode];
  // RGB dispersion reads like a neon beam on long workstation edges. Retain
  // a restrained iridescence only for Chromatic; Silver/Gold stay neutral/warm.
  return { ...original,
    shiftRed: preset === "chromatic" ? .08 : 0,
    shiftBlue: preset === "chromatic" ? .12 : 0,
    softness: .12,
    speed: .45,
  };
}
