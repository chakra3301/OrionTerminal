import { expect, it } from "vitest";
import { PRESETS } from "metal-fx";
import { metalMaterial } from "./metalMaterials";

it("keeps Silver and Gold out of the RGB-split neon palette", () => {
  for (const preset of ["silver", "gold"] as const) {
    const tuned = metalMaterial(preset);
    expect(tuned.shiftRed).toBe(0); expect(tuned.shiftBlue).toBe(0);
    expect(tuned.colorTint).toBe(PRESETS[preset].modes.dark.colorTint);
  }
});
it("retains restrained chromatic dispersion without mutating upstream presets", () => {
  const before = JSON.stringify(PRESETS);
  const tuned = metalMaterial("chromatic");
  expect(tuned.shiftRed).toBeGreaterThan(0);
  expect(tuned.shiftRed).toBeLessThan(PRESETS.chromatic.modes.dark.shiftRed);
  expect(tuned.softness).toBe(.12); expect(tuned.speed).toBe(.45);
  expect(JSON.stringify(PRESETS)).toBe(before);
});
