import { describe, expect, it } from "vitest";
import {
  deriveTokens,
  seedFromDesignSystem,
  tokensToCssVars,
  derivedTokensToPrompt,
  brandTokensPrompt,
  type Seed,
} from "./tokenEngine";
import { BUILTIN_DESIGN_SYSTEMS } from "./designSystem";

const seed: Seed = {
  primary: "#1677ff",
  neutral: "#8c8c8c",
  mode: "light",
  bg: "#ffffff",
  ink: "#111111",
  success: "#52c41a",
  warning: "#faad14",
  error: "#f5222d",
  info: "#1677ff",
  radius: 8,
  spacingUnit: 8,
  fontBase: 16,
  scaleRatio: 1.25,
};

describe("deriveTokens", () => {
  it("produces 10-step ramps and the seed at primary base", () => {
    const t = deriveTokens(seed);
    expect(t.ramps.primary).toHaveLength(10);
    expect(t.ramps.primary[5]).toBe("#1677ff");
    expect(t.semantic.primary).toBe("#1677ff");
  });

  it("derives an 8px spacing grid and a radius scale", () => {
    const t = deriveTokens(seed);
    expect(t.spacing).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
    expect(t.radii).toEqual([4, 8, 12, 16]);
  });

  it("collapses radii to [0] when sharp", () => {
    expect(deriveTokens({ ...seed, radius: 0 }).radii).toEqual([0]);
  });

  it("builds a modular type scale around the body size", () => {
    const t = deriveTokens(seed);
    const body = t.type.find((x) => x.role === "body")!;
    const display = t.type.find((x) => x.role === "display")!;
    expect(body.size).toBe(16);
    expect(display.size).toBeGreaterThan(body.size);
  });

  it("light vs dark mode produce different backgrounds + ramps", () => {
    const light = deriveTokens(seed);
    const dark = deriveTokens({ ...seed, mode: "dark", bg: "#08090a", ink: "#f7f8f8" });
    expect(dark.semantic.bgBase).toBe("#08090a");
    expect(dark.ramps.primary).not.toEqual(light.ramps.primary);
  });

  it("picks readable text-on-primary by contrast", () => {
    expect(deriveTokens({ ...seed, primary: "#faad14" }).semantic.onPrimary).toBe("#0a0a0a");
    expect(deriveTokens({ ...seed, primary: "#001d66" }).semantic.onPrimary).toBe("#ffffff");
  });
});

describe("seedFromDesignSystem", () => {
  it("recovers a dark-mode seed from Neo-Tokyo", () => {
    const ds = BUILTIN_DESIGN_SYSTEMS.find((d) => d.id === "ds-builtin-neo-tokyo")!;
    const s = seedFromDesignSystem(ds);
    expect(s.mode).toBe("dark");
    expect(s.primary).toBe("#00e0ff"); // its accent token
    expect(s.bg).toBe("#03060a");
  });

  it("recovers a light-mode seed from Editorial Light", () => {
    const ds = BUILTIN_DESIGN_SYSTEMS.find((d) => d.id === "ds-builtin-editorial")!;
    const s = seedFromDesignSystem(ds);
    expect(s.mode).toBe("light");
    expect(s.primary).toBe("#c8442b");
  });

  it("every built-in design system yields a usable seed + derivable tokens", () => {
    for (const ds of BUILTIN_DESIGN_SYSTEMS) {
      const t = deriveTokens(seedFromDesignSystem(ds));
      expect(t.ramps.primary).toHaveLength(10);
      expect(t.semantic.bgBase).toMatch(/^#|rgba/);
    }
  });
});

describe("tokensToCssVars / prompts", () => {
  it("emits :root custom properties for ramps + semantic roles", () => {
    const css = tokensToCssVars(deriveTokens(seed));
    expect(css).toContain(":root {");
    expect(css).toContain("--primary-6: #1677ff;");
    expect(css).toContain("--bg-base: #ffffff;");
    expect(css).toContain("--on-primary:");
    expect(css).toContain("--space-2: 8px;");
  });

  it("derivedTokensToPrompt lists ramps + semantic roles + scales", () => {
    const p = derivedTokensToPrompt(deriveTokens(seed));
    expect(p).toContain("Derived token system");
    expect(p).toContain("primary: #e6f4ff");
    expect(p).toContain("Semantic roles");
    expect(p).toContain("Spacing scale");
  });

  it("brandTokensPrompt works straight off a design system", () => {
    const ds = BUILTIN_DESIGN_SYSTEMS[0]!;
    expect(brandTokensPrompt(ds)).toContain("Derived token system");
  });
});
