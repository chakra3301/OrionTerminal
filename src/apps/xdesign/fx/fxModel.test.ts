import { describe, it, expect } from "vitest";
import {
  buildFragment,
  defaultParams,
  hexToVec3,
  uniformName,
  emptyScene,
  resolveDpi,
  isUniformParam,
  blendIndex,
  fnv1a,
  FX_BLEND_MODES,
} from "./fxModel";
import { FX_EFFECTS, fxEffect } from "./fxRegistry";

describe("hexToVec3", () => {
  it("parses 6-digit hex", () => {
    expect(hexToVec3("#ff0000")).toEqual([1, 0, 0]);
    expect(hexToVec3("#00ff00")).toEqual([0, 1, 0]);
    const [r, g, b] = hexToVec3("#336699");
    expect(r).toBeCloseTo(0x33 / 255);
    expect(g).toBeCloseTo(0x66 / 255);
    expect(b).toBeCloseTo(0x99 / 255);
  });

  it("parses 3-digit hex", () => {
    expect(hexToVec3("#fff")).toEqual([1, 1, 1]);
    expect(hexToVec3("#f00")).toEqual([1, 0, 0]);
  });

  it("falls back to black on malformed input", () => {
    expect(hexToVec3("")).toEqual([0, 0, 0]);
    expect(hexToVec3("red")).toEqual([0, 0, 0]);
    expect(hexToVec3("#12345")).toEqual([0, 0, 0]);
  });
});

describe("registry", () => {
  it("has unique effect ids", () => {
    const ids = FX_EFFECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique param keys per effect", () => {
    for (const spec of FX_EFFECTS) {
      const keys = spec.params.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("every frag body defines fxMain", () => {
    for (const spec of FX_EFFECTS) {
      expect(spec.frag).toContain("vec4 fxMain(vec2 uv)");
    }
  });

  it("every u_ reference in a frag body has a matching param", () => {
    for (const spec of FX_EFFECTS) {
      const declared = new Set(
        spec.params.filter(isUniformParam).map((p) => uniformName(p.key)),
      );
      const used = new Set(spec.frag.match(/u_[A-Za-z0-9]+/g) ?? []);
      for (const u of used) {
        expect(declared, `${spec.id} references undeclared ${u}`).toContain(u);
      }
    }
  });

  it("frag bodies have balanced braces", () => {
    for (const spec of FX_EFFECTS) {
      const opens = (spec.frag.match(/\{/g) ?? []).length;
      const closes = (spec.frag.match(/\}/g) ?? []).length;
      expect(opens, spec.id).toBe(closes);
    }
  });

  it("fxEffect resolves by id and misses unknowns", () => {
    expect(fxEffect("gradient")?.label).toBe("Gradient");
    expect(fxEffect("nope")).toBeUndefined();
  });
});

describe("buildFragment", () => {
  it("declares one uniform per uniform-param with the right type", () => {
    for (const spec of FX_EFFECTS) {
      const src = buildFragment(spec);
      for (const p of spec.params) {
        if (!isUniformParam(p)) {
          expect(src).not.toContain(uniformName(p.key));
          continue;
        }
        const type = p.type === "color" ? "vec3" : "float";
        expect(src).toContain(`uniform ${type} ${uniformName(p.key)};`);
      }
    }
  });

  it("declares uSrc only for source specs", () => {
    for (const spec of FX_EFFECTS) {
      const src = buildFragment(spec);
      if (spec.source) expect(src).toContain("uniform sampler2D uSrc;");
      else expect(src).not.toContain("uniform sampler2D uSrc;");
    }
  });

  it("includes shared uniforms, lib, body, and blend/opacity compositing", () => {
    const src = buildFragment(FX_EFFECTS[0]!);
    expect(src).toContain("#version 300 es");
    expect(src).toContain("uniform sampler2D uTex;");
    expect(src).toContain("uniform float uOpacity;");
    expect(src).toContain("uniform float uBlend;");
    expect(src).toContain("uniform float uMouseSpeed;");
    expect(src).toContain("uniform float uAudio;");
    expect(src).toContain("float fxFbm(vec2 p)");
    expect(src).toContain("fxBlend(below.rgb");
  });

  it("blendIndex maps modes to stable uniform values", () => {
    expect(blendIndex(undefined)).toBe(0);
    expect(blendIndex("normal")).toBe(0);
    expect(blendIndex("add")).toBe(1);
    expect(blendIndex("darken")).toBe(FX_BLEND_MODES.length - 1);
  });
});

describe("custom shader plumbing", () => {
  it("buildFragment body override replaces the spec frag", () => {
    const spec = fxEffect("custom")!;
    const body = "vec4 fxMain(vec2 uv) { return vec4(0.123); }";
    const src = buildFragment(spec, body);
    expect(src).toContain("vec4(0.123)");
    expect(src).not.toContain("Your shader");
  });

  it("override without fxMain falls back to the spec frag", () => {
    const spec = fxEffect("custom")!;
    const src = buildFragment(spec, "garbage");
    expect(src).toContain("fxMain");
    expect(src).not.toContain("garbage");
  });

  it("fnv1a is stable and collision-distinct for edits", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });
});

describe("defaults", () => {
  it("defaultParams covers every param key", () => {
    for (const spec of FX_EFFECTS) {
      const params = defaultParams(spec);
      expect(Object.keys(params).sort()).toEqual(
        spec.params.map((p) => p.key).sort(),
      );
    }
  });

  it("emptyScene is sane", () => {
    const s = emptyScene();
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
    expect(s.layers).toEqual([]);
    expect(hexToVec3(s.background)).not.toEqual([0, 0, 0]);
  });

  it("resolveDpi maps fixed values through and clamps auto", () => {
    expect(resolveDpi(1)).toBe(1);
    expect(resolveDpi(0.5)).toBe(0.5);
    expect(resolveDpi(2)).toBe(2);
    const auto = resolveDpi("auto");
    expect(auto).toBeGreaterThanOrEqual(0.5);
    expect(auto).toBeLessThanOrEqual(2);
  });
});
