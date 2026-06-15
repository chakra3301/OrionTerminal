import { describe, it, expect } from "vitest";
import { parseDesignSpec, designSpecToMarkdown } from "./designSpec";

const sample = JSON.stringify({
  title: "Acme",
  aesthetic: "dark, neon-accented",
  designLanguage: "Bold brutalist grid with neon highlights.",
  colors: [
    { name: "Primary", role: "brand accent", hex: "#39ff88", ramp: ["#eafff3", "#39ff88", "#0a3d22"] },
    { name: "Surface", role: "card background", hex: "#0a1015" },
  ],
  typography: [
    { role: "Display", family: "Space Grotesk", fallback: "sans-serif", sizePx: 48, weight: 700, sample: "Aa", usage: "hero" },
  ],
  spacing: { scale: [4, 8, 12, 16, 24, 40], notes: "container 1200px" },
  components: [
    { name: "Primary Button", description: "Solid neon fill, pill radius.", preview: { kind: "button", fillHex: "#39ff88", textHex: "#03060a", radiusPx: 999 } },
  ],
  motion: "Subtle fade-ins on scroll.",
  responsive: "Single breakpoint at 768px.",
  imagery: "High-contrast product shots.",
  voice: "Confident, terse.",
  rebuildNotes: "Lead with the neon accent on a near-black base.",
});

describe("parseDesignSpec", () => {
  it("parses clean JSON", () => {
    const s = parseDesignSpec(sample);
    expect(s.title).toBe("Acme");
    expect(s.colors).toHaveLength(2);
    expect(s.colors[0]!.hex).toBe("#39ff88");
    expect(s.colors[0]!.ramp).toEqual(["#eafff3", "#39ff88", "#0a3d22"]);
    expect(s.typography[0]!.family).toBe("Space Grotesk");
    expect(s.spacing.scale).toEqual([4, 8, 12, 16, 24, 40]);
    expect(s.components[0]!.preview?.kind).toBe("button");
  });

  it("salvages fenced + prose-wrapped JSON", () => {
    const s = parseDesignSpec("Here you go:\n```json\n" + sample + "\n```\nDone");
    expect(s.title).toBe("Acme");
    expect(s.colors).toHaveLength(2);
  });

  it("coerces missing/junk array fields to []", () => {
    const s = parseDesignSpec(JSON.stringify({ title: "X", colors: "nope", components: 5 }));
    expect(s.title).toBe("X");
    expect(s.colors).toEqual([]);
    expect(s.typography).toEqual([]);
    expect(s.components).toEqual([]);
    expect(s.spacing.scale).toEqual([]);
  });

  it("defaults prose fields to empty strings when absent", () => {
    const s = parseDesignSpec(JSON.stringify({ colors: [] }));
    expect(s.title).toBe("");
    expect(s.aesthetic).toBe("");
    expect(s.designLanguage).toBe("");
    expect(s.motion).toBe("");
    expect(s.rebuildNotes).toBe("");
  });

  it("throws on input with no JSON object", () => {
    expect(() => parseDesignSpec("no json at all")).toThrow();
  });
});

describe("designSpecToMarkdown", () => {
  it("includes the title as an H1 and every color hex", () => {
    const md = designSpecToMarkdown(parseDesignSpec(sample));
    expect(md).toContain("# Acme");
    expect(md).toContain("#39ff88");
    expect(md).toContain("#0a1015");
  });

  it("renders typography families and component names", () => {
    const md = designSpecToMarkdown(parseDesignSpec(sample));
    expect(md).toContain("Space Grotesk");
    expect(md).toContain("Primary Button");
  });

  it("renders the spacing scale and narrative sections", () => {
    const md = designSpecToMarkdown(parseDesignSpec(sample));
    expect(md).toContain("4, 8, 12, 16, 24, 40");
    expect(md).toContain("## Design Language");
    expect(md).toContain("## Rebuild Notes");
  });

  it("does not throw on an empty/partial spec", () => {
    const md = designSpecToMarkdown(parseDesignSpec(JSON.stringify({ title: "Bare" })));
    expect(md).toContain("# Bare");
  });
});
