import { describe, it, expect } from "vitest";
import {
  buildPlanPrompt,
  parsePlan,
  buildBriefingPrompt,
  type CaptainInfo,
} from "./ccPlan";

const captains: CaptainInfo[] = [
  { division: "design", name: "Design Captain", charter: "visuals" },
  { division: "dev", name: "Dev Captain", charter: "code" },
];

describe("ccPlan", () => {
  it("plan prompt lists divisions and the brief", () => {
    const p = buildPlanPrompt("Build a landing page", captains);
    expect(p).toContain('division "design"');
    expect(p).toContain('division "dev"');
    expect(p).toContain("Build a landing page");
    expect(p).toContain('"directives"');
  });

  it("parses a clean plan, keeping known divisions", () => {
    const text =
      '{"directives":[{"division":"design","title":"Hero","instruction":"Design the hero"},{"division":"dev","title":"Build","instruction":"Build it"}]}';
    const out = parsePlan(text, ["design", "dev"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      division: "design",
      title: "Hero",
      instruction: "Design the hero",
    });
  });

  it("extracts JSON from surrounding prose / fences", () => {
    const text =
      'Here is the plan:\n```json\n{"directives":[{"division":"dev","instruction":"ship"}]}\n```\nDone.';
    const out = parsePlan(text, ["dev"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("dev"); // falls back to division when title missing
  });

  it("drops directives for unknown / hallucinated divisions", () => {
    const text =
      '{"directives":[{"division":"legal","instruction":"x"},{"division":"dev","instruction":"y"}]}';
    const out = parsePlan(text, ["design", "dev"]);
    expect(out.map((d) => d.division)).toEqual(["dev"]);
  });

  it("fail-soft: garbage or empty → []", () => {
    expect(parsePlan("not json", ["dev"])).toEqual([]);
    expect(parsePlan('{"directives":"nope"}', ["dev"])).toEqual([]);
    expect(parsePlan('{"directives":[]}', ["dev"])).toEqual([]);
  });

  it("briefing prompt includes each division report", () => {
    const p = buildBriefingPrompt("Landing", "brief", [
      { division: "design", report: "made hero" },
      { division: "dev", report: "shipped" },
    ]);
    expect(p).toContain("Landing");
    expect(p).toContain("made hero");
    expect(p).toContain("shipped");
  });
});
