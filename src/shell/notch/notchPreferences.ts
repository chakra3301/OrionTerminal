export const METRICS = ["cpu", "memory", "claude"] as const;
export type Metric = typeof METRICS[number] | `provider:${string}` | `quota:${string}`;
export const providerMetricId = (id: string): Metric => `provider:${encodeURIComponent(id)}`;
export const DEFAULT_AI_METRICS = ["builtin:codex-cli", "builtin:gemini-cli", "builtin:cursor-sdk"].map(providerMetricId);
function isMetric(value: unknown): value is Metric {
  if (typeof value !== "string") return false;
  if ((METRICS as readonly string[]).includes(value)) return true;
  if (!value.startsWith("provider:") || value.length > 1600) return false;
  try { const id = decodeURIComponent(value.slice(9)); return id.length > 0 && id.length <= 512 && providerMetricId(id) === value; }
  catch { return false; }
}
export type NotchPreferences = {
  version: 3;
  edge: "left" | "right";
  mode: "hover" | "always";
  scale: number;
  position: number;
  surface: "solid" | "glass";
  color: "usage" | "app" | "mono";
  labels: boolean;
  animate: boolean;
  closeDelay: number;
  metrics: Metric[];
  [key: string]: unknown;
};
export const DEFAULT_NOTCH: NotchPreferences = {
  version: 3, edge: "right", mode: "hover", scale: 1, position: .5,
  surface: "solid", color: "usage", labels: false, animate: true,
  closeDelay: 450, metrics: [...METRICS, ...DEFAULT_AI_METRICS],
};
const bounded = (v: unknown, min: number, max: number, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export function normalizeNotch(value: unknown): NotchPreferences {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const metrics = Array.isArray(v.metrics) ? [...new Set(v.metrics.filter(isMetric))] : [...DEFAULT_NOTCH.metrics];
  if (v.version === 2) for (const id of DEFAULT_AI_METRICS) if (!metrics.includes(id)) metrics.push(id);
  return {
    ...v, version: 3, edge: v.edge === "left" ? "left" : "right", mode: v.mode === "always" ? "always" : "hover",
    scale: bounded(v.scale, .8, 1.3, 1), position: bounded(v.position, 0, 1, .5),
    surface: v.surface === "glass" ? "glass" : "solid",
    color: v.color === "app" || v.color === "mono" ? v.color : "usage",
    labels: v.labels === true, animate: v.animate !== false,
    closeDelay: bounded(v.closeDelay, 200, 1200, 450), metrics: metrics.length ? metrics : [...DEFAULT_NOTCH.metrics],
  };
}
