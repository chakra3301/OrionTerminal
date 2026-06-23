import { describe, it, expect } from "vitest";
import {
  DESIGN_SKILLS,
  composeCraftBrief,
  lensesForBrief,
} from "./designKnowledge";

describe("designKnowledge", () => {
  it("has unique skill ids", () => {
    const ids = new Set(DESIGN_SKILLS.map((s) => s.id));
    expect(ids.size).toBe(DESIGN_SKILLS.length);
  });

  it("composeCraftBrief includes all core skills by default", () => {
    const brief = composeCraftBrief();
    const core = DESIGN_SKILLS.filter((s) => s.core);
    expect(brief).toContain("DESIGN CRAFT");
    for (const s of core) expect(brief).toContain(s.title);
    // Non-core lenses are not injected unless requested.
    expect(brief).not.toContain("Landing page anatomy");
  });

  it("composeCraftBrief appends requested lenses, ignores unknown/core ids", () => {
    const brief = composeCraftBrief(["lens-pricing", "hierarchy", "nope"]);
    expect(brief).toContain("Pricing page");
    // 'hierarchy' is core (already in) and not double-handled as an extra
    const occurrences = brief.split("Visual hierarchy").length - 1;
    expect(occurrences).toBe(1);
  });

  it("lensesForBrief picks structure by keywords, defaults to landing", () => {
    expect(lensesForBrief("a pricing page for a dev tool")).toContain("lens-pricing");
    expect(lensesForBrief("an analytics dashboard")).toContain("lens-dashboard");
    expect(lensesForBrief("a mobile app onboarding screen")).toContain("lens-mobile");
    expect(lensesForBrief("something vague")).toEqual(["lens-landing"]);
  });
});
