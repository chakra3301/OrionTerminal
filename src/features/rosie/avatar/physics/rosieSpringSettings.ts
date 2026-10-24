export type RosieRegion = "chest" | "glute" | "thigh";
export type RosieSpringSettings = {
  enabled: boolean;
  strength: number;
  chest: number;
  glute: number;
  thigh: number;
};

/** 25% more response than the baseline; displacement caps are independent. */
export const DEFAULT_ROSIE_SPRINGS: Readonly<RosieSpringSettings> = Object.freeze({
  enabled: true, strength: 1.25, chest: 1, glute: 1, thigh: 1,
});

const bounded = (value: unknown, fallback: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(max, value)) : fallback;

export function sanitizeRosieSprings(value?: Partial<RosieSpringSettings> | null): RosieSpringSettings {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_ROSIE_SPRINGS.enabled,
    strength: bounded(value?.strength, DEFAULT_ROSIE_SPRINGS.strength, 1.6),
    chest: bounded(value?.chest, 1, 1.5),
    glute: bounded(value?.glute, 1, 1.5),
    thigh: bounded(value?.thigh, 1, 1.5),
  };
}
