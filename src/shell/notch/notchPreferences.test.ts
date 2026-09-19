import { describe, expect, it } from "vitest";
import { DEFAULT_AI_METRICS, DEFAULT_NOTCH, normalizeNotch, providerMetricId } from "./notchPreferences";
import { NOTCH, notchLayout, notchPath, springEasing } from "./notchGeometry";

describe("notch preferences", () => {
  it("retains legacy fields without turning a collapsed widget into a disabled notch", () => {
    const pos = { x: 100, y: 70 };
    expect(normalizeNotch({ pos, collapsed: true })).toMatchObject({ version: 3, mode: "hover", pos, collapsed: true });
  });
  it("preserves explicit customization", () => {
    expect(normalizeNotch({ edge: "left", mode: "always", metrics: ["claude", "cpu"], scale: 1.2, labels: true })).toMatchObject({ edge: "left", mode: "always", metrics: ["claude", "cpu"], scale: 1.2, labels: true });
  });
  it("clamps malformed settings and preserves a reachable indicator", () => {
    expect(normalizeNotch({ metrics: [], scale: 99, position: -2, closeDelay: Infinity, surface: "bogus" })).toMatchObject({ metrics: DEFAULT_NOTCH.metrics, scale: 1.3, position: 0, closeDelay: 450, surface: "solid" });
  });
  it("introduces AI trackers once without resetting customized CPU order", () => {
    const next = normalizeNotch({ version: 2, metrics: ["memory", "cpu"], scale: 1.2 });
    expect(next.metrics).toEqual(["memory", "cpu", ...DEFAULT_AI_METRICS]);
    expect(normalizeNotch({ ...next, metrics: ["cpu"] }).metrics).toEqual(["cpu"]);
  });
  it("retains encoded custom provider identities and rejects malformed IDs", () => {
    const id = providerMetricId('tenant/one"two');
    expect(normalizeNotch({ version: 3, metrics: [id, "provider:%zz", id, "provider:", "cpu"] }).metrics).toEqual([id, "cpu"]);
  });
  it("deduplicates and filters without losing user order", () => {
    expect(normalizeNotch({ metrics: ["memory", "garbage", "memory", "cpu"] }).metrics).toEqual(["memory", "cpu"]);
  });
  it("does not share the mutable default indicator array", () => {
    const result = normalizeNotch(null);
    result.metrics.reverse();
    expect(DEFAULT_NOTCH.metrics).toEqual(["cpu", "memory", "claude", ...DEFAULT_AI_METRICS]);
  });
});

describe("Codenotch geometry and motion", () => {
  it("uses the reference's 44px ring as its scale anchor", () => {
    expect(NOTCH.ring).toBe(44);
    expect(notchLayout(3, 1, false).width).toBeCloseTo(186 * 44 / 117);
  });
  it("scales the entire shape and cell positions together", () => {
    const base = notchLayout(3, 1, false), large = notchLayout(3, 1.3, false);
    expect(large.height).toBeCloseTo(base.height * 1.3);
    expect(large.ringCenter(2)).toBeCloseTo(base.ringCenter(2) * 1.3);
  });
  it("reserves space for optional labels", () => {
    expect(notchLayout(3, 1, true).height - notchLayout(3, 1, false).height).toBeCloseTo(39);
  });
  it("keeps the same path commands for continuous pill-to-notch interpolation", () => {
    const full = notchLayout(3, 1, false);
    const pill = notchPath(NOTCH.pillWidth, NOTCH.pillHeight);
    const open = notchPath(full.width, full.height);
    expect(pill.match(/[A-Z]/g)).toEqual(open.match(/[A-Z]/g));
    expect(pill + open).not.toMatch(/NaN|Infinity/);
  });
  it("gives the spring a soft overshoot and a settled endpoint", () => {
    const values = springEasing(.42, .78, .6).slice(7, -1).split(",").map(Number);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.max(...values)).toBeLessThan(1.05);
  });
});
