import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { contrast } from "@/features/settings/themeDesign";

const materialText = readFileSync("src/styles/materials.css", "utf8");
const materials = postcss.parse(materialText);
const themeText = readFileSync("src/styles/themes.css", "utf8");
const themes = postcss.parse(themeText);
const entry = readFileSync("src/styles.css", "utf8");
const declarations = (rule: Rule) => Object.fromEntries(
  (rule.nodes ?? []).filter(node => node.type === "decl").map(node => [node.prop, node.value]),
);
function ruleFor(selector: string, sheet = materials): Rule {
  let found: Rule | undefined;
  sheet.walkRules(rule => { if (!found && rule.selector === selector) found = rule; });
  expect(found, selector).toBeDefined();
  return found!;
}
const palette = declarations(ruleFor('[data-theme="liquid"]', themes));
const glass = declarations(ruleFor(':root[data-theme="liquid"]:not(.ot-reduce-glass)'));

describe("shared material contract", () => {
  it("loads after retained light/custom appearance adapters", () => {
    expect(entry.indexOf('"./styles/materials.css"')).toBeGreaterThan(entry.indexOf('"./styles/customThemes.css"'));
    expect(entry.indexOf('"./styles/customThemes.css"')).toBeGreaterThan(entry.indexOf('"./styles/lightThemes.css"'));
  });

  it("keeps the Liquid palette opaque and its renderer twins identical", () => {
    for (let i = 0; i < 4; i++) {
      expect(palette[`--bg-${i}`]).toMatch(/^#[\da-f]{6}$/i);
      expect(palette[`--bg-${i}-solid`]).toBe(palette[`--bg-${i}`]);
      expect(contrast(palette["--t-primary"]!, palette[`--bg-${i}`]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette["--t-secondary"]!, palette[`--bg-${i}`]!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("retains theme-specific radii rather than forcing all controls into pills", () => {
    expect(["sm", "md", "lg", "xl"].map(key => palette[`--r-${key}`])).toEqual(["6.8px", "11.9px", "17px", "22.1px"]);
    expect(materialText).not.toContain("--r-");
    for (const theme of ["minimal", "bmw-m"]) expect(ruleFor(`[data-theme="${theme}"]`, themes)).toBeDefined();
  });

  it("defaults to opaque material aliases without backdrop support", () => {
    const values = declarations(ruleFor(":root"));
    for (const role of ["shell", "navigation", "reading"]) expect(values[`--material-${role}`]).toBe("var(--work-panel)");
    expect(values["--material-transient"]).toBe("var(--work-raised)");
    expect(values["--material-backdrop"]).toBe("none");
    expect(values["--material-popup-backdrop"]).toBe("none");
  });

  it("uses a positive capability gate, not a negated optional preference query", () => {
    const glassRule = ruleFor(':root[data-theme="liquid"]:not(.ot-reduce-glass)');
    expect(glassRule.parent?.type).toBe("atrule");
    if (glassRule.parent?.type === "atrule") {
      expect(glassRule.parent.name).toBe("supports");
      expect(glassRule.parent.params).toContain("-webkit-backdrop-filter");
    }
    materials.walkAtRules("media", rule => expect(rule.params).not.toMatch(/^not.*prefers-reduced-transparency/));
  });

  it("makes explicit reduced transparency restore opaque role fills", () => {
    const values = declarations(ruleFor(":root.ot-reduce-glass"));
    for (const role of ["shell", "navigation", "reading"]) expect(values[`--material-${role}`]).toBe("var(--work-panel)");
    expect(values["--material-backdrop"]).toBe("none");
    expect(values["--material-popup-backdrop"]).toBe("none");
  });

  it("uses a same-specificity positive OS override for Liquid", () => {
    let found = false;
    materials.walkAtRules("media", media => {
      if (media.params !== "(prefers-reduced-transparency: reduce)") return;
      media.walkRules(rule => {
        if (rule.selector !== ':root[data-theme="liquid"]:not(.ot-reduce-glass)') return;
        found = true;
        const values = declarations(rule);
        expect(values["--material-shell"]).toBe("var(--work-panel)");
        expect(values["--material-reading"]).toBe("var(--work-panel)");
        expect(values["--material-transient"]).toBe("var(--work-raised)");
        expect(values["--material-backdrop"]).toBe("none");
      });
    });
    expect(found).toBe(true);
  });

  it("leaves content, renderer and artwork scopes out of global glass injection", () => {
    expect(themeText).not.toMatch(/\[class\*=/);
    expect(materialText).not.toMatch(/\[class\*=/);
    materials.walkRules(rule => {
      expect(rule.selector).not.toMatch(/\.xd-canvas|\.monaco|\.xterm|\.ProseMirror|\biframe\b/);
      rule.walkDecls(decl => {
        expect(decl.prop).not.toMatch(/^--xd-bg$|^--bg-\d/);
        expect(decl.important).not.toBeTruthy();
      });
    });
    expect(themeText).not.toContain('html[data-theme="liquid"] .xd-root');
  });

  it("shares parent frost rather than separately blurring navigation and reading sheets", () => {
    let reading = false, navigation = false;
    materials.walkRules(rule => {
      if (!rule.selector.includes("body")) return;
      const values = declarations(rule);
      if (values.background === "var(--material-reading)") {
        reading = true;
        expect(values["backdrop-filter"]).toBe("none");
        expect(values["-webkit-backdrop-filter"]).toBe("none");
      }
      if (values.background === "var(--material-navigation)" && rule.selector.includes(".ar-sidebar")) {
        navigation = true;
        expect(values["backdrop-filter"]).toBe("none");
      }
    });
    expect(reading && navigation).toBe(true);
  });

  it("keeps real shader rims exclusive and never dims the whole inactive document", () => {
    expect(materialText).toContain(":not(:has(> .ot-themed-border))");
    const inactive = declarations(ruleFor(':root[data-theme="liquid"] body .ot-window.unfocused'));
    expect(inactive.opacity).toBe("1");
    expect(inactive.filter).toBe("none");
  });

  it("derives custom/light finishes without persistence or new executable style data", () => {
    expect(materialText).toContain("var(--light-glass-surface, var(--bg-1))");
    expect(materialText).toContain("var(--custom-glass-fill, var(--bg-1))");
    expect(materialText).not.toMatch(/url\(|@import|@font-face/);
    const entryPoint = readFileSync("src/shell/Shell.tsx", "utf8");
    expect(entryPoint).not.toContain("LiquidLens");
  });

  it("preserves the owner-preferred original clear Liquid recipe without matte darkening", () => {
    expect(glass["--glass-bg"]).toBe("rgba(120, 180, 230, 0.015)");
    expect(glass["--glass-bg-strong"]).toBe("rgba(90, 155, 210, 0.025)");
    expect(glass["--material-shell"]).toBe("var(--glass-bg-strong)");
    expect(glass["--material-reading"]).toBe("rgba(120, 180, 230, 0.02)");
    expect(glass["--material-control"]).toBe("rgba(140, 195, 235, 0.07)");
    expect(glass["--material-navigation"]).toBe("rgba(0, 0, 0, 0.12)");
    expect(glass["--material-backdrop"]).toBe("blur(11px) saturate(1.5) brightness(1.04)");
    expect(glass["--material-backdrop"]).not.toContain("contrast(");
  });

  it("keeps structural app interiors clear without recoloring code or artwork", () => {
    let clear = false;
    materials.walkRules(rule => {
      if (!rule.selector.includes(".or-app")) return;
      clear = true;
      expect(rule.selector).toContain(".ot-panel");
      expect(rule.selector).toContain(".xd-root");
      expect(declarations(rule).background).toBe("transparent");
      expect(rule.selector).not.toMatch(/\.xd-canvas|\.monaco|\.xterm/);
    });
    expect(clear).toBe(true);
  });
});
