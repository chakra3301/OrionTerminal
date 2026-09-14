import { describe, expect, it } from "vitest";
import { makeCharacterComponentTree, scaffoldCharacterSpec, CHARACTER_MATERIALS } from "./characterTemplate";
import { validateStructure } from "./validateSculptSpec";

describe("makeCharacterComponentTree", () => {
  it("builds a root plus the core bust parts, all parented to root (flattened world space)", () => {
    const tree = makeCharacterComponentTree();
    expect(tree[0]!.id).toBe("root");
    expect(tree[0]!.parent).toBeNull();
    for (const part of tree.slice(1)) expect(part.parent).toBe("root");
    expect(tree.some((c) => c.id === "torso")).toBe(true);
    expect(tree.some((c) => c.id === "head")).toBe(true);
  });

  it("adds accessories only when requested", () => {
    const bare = makeCharacterComponentTree();
    expect(bare.some((c) => c.id === "glasses-frame-l")).toBe(false);
    const withGlasses = makeCharacterComponentTree({ hasGlasses: true, hasHeadphones: true });
    expect(withGlasses.some((c) => c.id === "glasses-frame-l")).toBe(true);
    expect(withGlasses.some((c) => c.id === "hp-band")).toBe(true);
  });

  it("scales part offsets with the given head-unit", () => {
    const small = makeCharacterComponentTree({ headUnit: 0.1 });
    const large = makeCharacterComponentTree({ headUnit: 0.5 });
    const headSmall = small.find((c) => c.id === "head")!;
    const headLarge = large.find((c) => c.id === "head")!;
    expect(headLarge.transform.position[1]).toBeGreaterThan(headSmall.transform.position[1]);
  });
});

describe("scaffoldCharacterSpec", () => {
  it("produces a structurally valid spec (materials resolve, no dangling parents)", () => {
    const spec = scaffoldCharacterSpec("Hero", "ref.png", { hasGlasses: true });
    expect(spec.preSpecAssessment.objectClass.primaryDomain).toBe("character");
    expect(spec.materials.map((m) => m.id)).toEqual(CHARACTER_MATERIALS.map((m) => m.id));
    const result = validateStructure(spec);
    expect(result.filter((i) => i.level === "error")).toHaveLength(0);
  });
});
