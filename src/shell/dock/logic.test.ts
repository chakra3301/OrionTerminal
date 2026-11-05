import { describe, expect, it } from "vitest";
import { decodeName, dockApps, dockLabel, fixedDockAccent, magnifyScale, pickLifted } from "./logic";

describe("dock names", () => {
  it("keeps spaces and settles each slot at 90ms + i × 30ms", () => {
    const random = () => 0;
    expect(decodeName("Hi X", 89, false, random)).toBe("AA A");
    expect(decodeName("Hi X", 90, false, random)).toBe("HA A");
    expect(decodeName("Hi X", 120, false, random)).toBe("Hi A");
    expect(decodeName("Hi X", 180, false, random)).toBe("Hi X");
  });
  it("rerolls unsettled slots and skips decoding for reduced motion", () => {
    expect(decodeName("Orion", 0, false, () => 0)).not.toBe(decodeName("Orion", 0, false, () => 0.5));
    expect(decodeName("R.O.S.I.E", 0, true)).toBe("R.O.S.I.E");
    expect(decodeName("Orion", 1000)).toBe("Orion");
  });
  it("preserves utility shortcuts only in accessible names", () => {
    expect(dockLabel("Archives 47")).toBe("Archives 47");
    expect(dockLabel("Spotlight", "⌘K")).toBe("Spotlight (⌘K)");
    expect(dockLabel("R.O.S.I.E", "⌘L")).toBe("R.O.S.I.E (⌘L)");
    expect(dockLabel("Control Panel", "⌘,")).toBe("Control Panel (⌘,)");
  });
});

describe("dock reach", () => {
  const items = [{ id: "a", center: 24, width: 48 }, { id: "b", center: 82, width: 48 }];
  it("picks just the closest item within half its width plus 5px", () => {
    expect(pickLifted(items, 24)).toBe("a");
    expect(pickLifted(items, 54)).toBe("b");
    expect(pickLifted(items, -5)).toBeNull();
    expect(pickLifted(items, -4.9)).toBe("a");
    expect(pickLifted(items, 200)).toBeNull();
    expect(pickLifted(items, null)).toBeNull();
  });
  it("preserves the cosine magnify curve, with a separate orb peak", () => {
    expect(magnifyScale(0)).toBe(1.55);
    expect(magnifyScale(55)).toBeCloseTo(1.275);
    expect(magnifyScale(110)).toBe(1);
    expect(magnifyScale(0, 1.2)).toBe(1.2);
  });
});

it("filters only explicit dock hiding and maps theme neon to the approved fixed colours", () => {
  expect(dockApps([{ dock: {} }, { dock: { hidden: true } }, { dock: { hidden: false } }])).toHaveLength(2);
  expect(fixedDockAccent("var(--neon-violet)")).toBe("var(--dock-violet)");
  expect(fixedDockAccent("#123456")).toBe("#123456");
});
