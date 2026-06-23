import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  blueprintForLens,
  blueprintForLenses,
  buildBlueprintPrompt,
  type ArtifactKind,
} from "./htmlBlueprints";
import { lensesForBrief } from "./designKnowledge";

describe("BLUEPRINTS", () => {
  it("covers all four kinds with non-empty sections + rules", () => {
    const kinds: ArtifactKind[] = ["landing", "pricing", "dashboard", "mobile"];
    for (const k of kinds) {
      const bp = BLUEPRINTS[k];
      expect(bp.kind).toBe(k);
      expect(bp.sections.length).toBeGreaterThan(2);
      expect(bp.rules.length).toBeGreaterThan(0);
      for (const s of bp.sections) expect(s.slots.length).toBeGreaterThan(0);
    }
  });
});

describe("blueprintForLens / blueprintForLenses", () => {
  it("maps lens ids to blueprints", () => {
    expect(blueprintForLens("lens-pricing")!.kind).toBe("pricing");
    expect(blueprintForLens("lens-dashboard")!.kind).toBe("dashboard");
    expect(blueprintForLens("unknown")).toBeNull();
  });

  it("prefers the most specific lens over landing-default", () => {
    expect(blueprintForLenses(["lens-pricing", "lens-landing"]).kind).toBe("pricing");
    expect(blueprintForLenses(["lens-landing"]).kind).toBe("landing");
    expect(blueprintForLenses([]).kind).toBe("landing");
  });

  it("end-to-end: a pricing brief selects the pricing blueprint", () => {
    expect(blueprintForLenses(lensesForBrief("a pricing page for a SaaS")).kind).toBe("pricing");
    expect(blueprintForLenses(lensesForBrief("an analytics dashboard")).kind).toBe("dashboard");
    expect(blueprintForLenses(lensesForBrief("an iOS app screen")).kind).toBe("mobile");
    expect(blueprintForLenses(lensesForBrief("a clean homepage")).kind).toBe("landing");
  });
});

describe("buildBlueprintPrompt", () => {
  it("emits an ordered, slotted spec with rules and the no-lorem mandate", () => {
    const p = buildBlueprintPrompt(BLUEPRINTS.landing);
    expect(p).toContain("PAGE BLUEPRINT");
    expect(p).toContain("Framework:");
    expect(p).toContain("1. Nav");
    expect(p).toContain("slots:");
    expect(p).toContain("Blueprint rules:");
    expect(p).toContain("never lorem ipsum");
    // sections are numbered in order
    expect(p.indexOf("1. Nav")).toBeLessThan(p.indexOf("2. Hero"));
  });
});
