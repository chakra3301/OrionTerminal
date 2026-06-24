import { describe, it, expect } from "vitest";
import {
  extractHtmlArtifact,
  hasHtmlArtifact,
  stripHtmlArtifact,
  buildWebpagePrompt,
  buildDeckPrompt,
  buildRefinePrompt,
} from "./htmlArtifact";
import { BUILTIN_DESIGN_SYSTEMS } from "./designSystem";

const doc = "<!doctype html><html><head><title>X</title></head><body>Hi</body></html>";

describe("extractHtmlArtifact", () => {
  it("extracts a fenced html block", () => {
    const reply = "Here is the page.\n\n```html\n" + doc + "\n```";
    expect(extractHtmlArtifact(reply)).toBe(doc);
  });

  it("takes the LAST fenced block (refinement supersedes draft)", () => {
    const reply = "```html\n<html>OLD</html>\n```\nthen\n```html\n<html>NEW</html>\n```";
    expect(extractHtmlArtifact(reply)).toBe("<html>NEW</html>");
  });

  it("falls back to a bare document", () => {
    expect(extractHtmlArtifact("prose " + doc + " more")).toContain("<title>X</title>");
  });

  it("returns null when no html", () => {
    expect(extractHtmlArtifact("just prose")).toBeNull();
  });
});

describe("hasHtmlArtifact / strip", () => {
  it("detects and strips fenced html", () => {
    const reply = "Built it.\n\n```html\n" + doc + "\n```";
    expect(hasHtmlArtifact(reply)).toBe(true);
    expect(stripHtmlArtifact(reply)).toBe("Built it.");
  });
});

describe("prompts", () => {
  it("webpage prompt folds in brand + craft + brief", () => {
    const p = buildWebpagePrompt("a pricing page", BUILTIN_DESIGN_SYSTEMS[0]!, "# DESIGN CRAFT\n- x");
    expect(p).toContain("BRAND CONTRACT");
    expect(p).toContain("DESIGN CRAFT");
    expect(p).toContain("a pricing page");
    expect(p).toContain("self-contained single-file HTML");
  });

  it("deck prompt asks for slides + nav + print CSS", () => {
    const p = buildDeckPrompt("a seed pitch deck", BUILTIN_DESIGN_SYSTEMS[0]!, "# PAGE BLUEPRINT", true);
    expect(p).toContain("slide deck");
    expect(p).toContain('class="slide"');
    expect(p).toContain("break-after: page");
    expect(p).toContain("{{IMG");
    expect(p).toContain("a seed pitch deck");
    expect(p).toContain("BRAND CONTRACT");
  });

  it("refine prompt embeds current html and the instruction", () => {
    const p = buildRefinePrompt("<html>OLD</html>", "make the hero bigger", null);
    expect(p).toContain("<html>OLD</html>");
    expect(p).toContain("make the hero bigger");
    expect(p).toContain("COMPLETE updated document");
  });
});
