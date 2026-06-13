import { describe, expect, it } from "vitest";
import { expandVars, TEMPLATES } from "./templates";

const ref = new Date(2026, 5, 13, 14, 5); // Sat Jun 13 2026, 14:05

describe("expandVars", () => {
  it("substitutes date and year", () => {
    const out = expandVars("Day: {{date}} ({{year}})", ref);
    expect(out).toContain("2026");
    expect(out).toContain("June");
    expect(out).toContain("(2026)");
  });

  it("substitutes weekday and month", () => {
    expect(expandVars("{{weekday}}", ref)).toContain("Saturday");
    expect(expandVars("{{month}}", ref)).toBe("June");
  });

  it("tolerates whitespace inside braces", () => {
    expect(expandVars("{{  year  }}", ref)).toBe("2026");
  });

  it("leaves unknown tokens untouched (not silently eaten)", () => {
    expect(expandVars("{{nope}}", ref)).toBe("{{nope}}");
  });

  it("handles text with no variables", () => {
    expect(expandVars("plain", ref)).toBe("plain");
  });
});

describe("TEMPLATES", () => {
  it("every template builds a non-empty title and blocks with expanded vars", () => {
    for (const tpl of TEMPLATES) {
      const { title, blocks } = tpl.build(ref);
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toMatch(/\{\{/); // no leftover variables
      expect(blocks.length).toBeGreaterThan(0);
    }
  });

  it("covers all three note kinds", () => {
    const kinds = new Set(TEMPLATES.map((t) => t.kind));
    expect(kinds).toContain("note");
    expect(kinds).toContain("journal");
    expect(kinds).toContain("project");
  });
});
