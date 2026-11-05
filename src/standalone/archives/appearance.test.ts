import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme: () => Promise.resolve() }) }));
vi.mock("@/lib/db", () => ({ getAppState: vi.fn(), setAppState: vi.fn(() => Promise.resolve()) }));

import { appearanceVariables, DEFAULT_APPEARANCE, normalizeAppearance } from "./appearance";

describe("Archives 47 appearance", () => {
  it("defaults to neon green on a dark frosted window", () => {
    expect(normalizeAppearance(undefined)).toEqual({ accent: "#39ff88", background: "#0a1015", frosted: true });
    expect(normalizeAppearance({ accent: "nope", background: 4, frosted: "yes" })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ accent: "#E8173F", background: "#FFFFFF", frosted: false })).toEqual({
      accent: "#e8173f",
      background: "#ffffff",
      frosted: false,
    });
  });

  it("uses one accent for every app hue", () => {
    const v = appearanceVariables({ ...DEFAULT_APPEARANCE, accent: "#e8173f" });
    expect(v["--neon-green"]).toBe("#e8173f");
    expect(v["--neon-cyan"]).toBe("#e8173f");
    expect(v["--neon-green-rgb"]).toBe("232, 23, 63");
    expect(v["--t-on-accent"]).toBe("#ffffff");
    expect(appearanceVariables(DEFAULT_APPEARANCE)["--t-on-accent"]).toBe("#06090c");
  });

  it("switches the ink with the background's tone, as EMP does", () => {
    expect(appearanceVariables(DEFAULT_APPEARANCE)["--t-primary"]).toBe("rgba(242, 245, 243, 0.94)");
    expect(appearanceVariables({ ...DEFAULT_APPEARANCE, background: "#ffffff" })["--t-primary"]).toBe("rgba(31, 35, 40, 0.94)");
  });

  it("makes surfaces translucent only when frosted, and keeps menus opaque", () => {
    const frosted = appearanceVariables(DEFAULT_APPEARANCE);
    const solid = appearanceVariables({ ...DEFAULT_APPEARANCE, frosted: false });
    expect(frosted["--a47-surface"]).toContain("transparent");
    expect(solid["--a47-surface"]).not.toContain("transparent");
    expect(frosted["--bg-2"]).not.toContain("transparent");
  });
});
