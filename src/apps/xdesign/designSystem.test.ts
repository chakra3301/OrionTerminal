import { describe, it, expect } from "vitest";
import {
  parseDesignSystem,
  designSystemToPrompt,
  parseDesignSystemReply,
  stripDesignSystemReply,
  BUILTIN_DESIGN_SYSTEMS,
  type DesignSystem,
} from "./designSystem";

describe("parseDesignSystem", () => {
  it("returns null without a name", () => {
    expect(parseDesignSystem({ colors: [] })).toBeNull();
    expect(parseDesignSystem(null)).toBeNull();
    expect(parseDesignSystem("nope")).toBeNull();
  });

  it("parses a full blob and drops malformed entries", () => {
    const ds = parseDesignSystem({
      name: "Test",
      aesthetic: "bold",
      colors: [
        { name: "brand", value: "#fff", role: "Primary" },
        { name: "", value: "#000" }, // dropped — no name
        { value: "#111" }, // dropped — no name
        "junk",
      ],
      typography: [{ role: "display", size: 64, weight: 700 }, { size: 10 }],
      fonts: { display: "Space Grotesk", body: "" },
      spacing: [4, 8, "x"],
      radii: [2, 4],
      principles: ["a", "", 3],
      voice: "calm",
    });
    expect(ds).not.toBeNull();
    expect(ds!.name).toBe("Test");
    expect(ds!.colors).toHaveLength(1);
    expect(ds!.typography).toHaveLength(1);
    expect(ds!.fonts).toEqual({ display: "Space Grotesk" });
    expect(ds!.spacing).toEqual([4, 8]);
    expect(ds!.principles).toEqual(["a"]);
  });

  it("uses fallbackId when id missing", () => {
    const ds = parseDesignSystem({ name: "X" }, "fid");
    expect(ds!.id).toBe("fid");
  });
});

describe("designSystemToPrompt", () => {
  it("emits a brand contract with tokens and principles", () => {
    const ds = BUILTIN_DESIGN_SYSTEMS[0]!;
    const p = designSystemToPrompt(ds);
    expect(p).toContain("BRAND CONTRACT");
    expect(p).toContain(ds.name);
    expect(p).toContain("color/accent");
    expect(p).toContain("Type scale");
    // principles surfaced
    expect(p).toContain("Principles");
  });

  it("omits empty sections", () => {
    const ds: DesignSystem = {
      id: "x",
      name: "Bare",
      builtin: false,
      colors: [],
      typography: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const p = designSystemToPrompt(ds);
    expect(p).toContain("Bare");
    expect(p).not.toContain("Color tokens");
    expect(p).not.toContain("Type scale");
  });
});

describe("parseDesignSystemReply / strip", () => {
  const reply = `Here is the system.

\`\`\`xd-designsystem
{ "name": "Captured", "colors": [{ "name": "brand", "value": "#abc" }] }
\`\`\``;

  it("extracts the fenced block", () => {
    const ds = parseDesignSystemReply(reply, "id1");
    expect(ds!.name).toBe("Captured");
    expect(ds!.id).toBe("id1");
  });

  it("returns null without a block", () => {
    expect(parseDesignSystemReply("no block here")).toBeNull();
  });

  it("strips the block from the transcript", () => {
    expect(stripDesignSystemReply(reply)).toBe("Here is the system.");
  });
});

describe("BUILTIN_DESIGN_SYSTEMS", () => {
  it("all parse and have stable unique ids", () => {
    const ids = new Set<string>();
    for (const ds of BUILTIN_DESIGN_SYSTEMS) {
      expect(ds.builtin).toBe(true);
      expect(parseDesignSystem(ds)).not.toBeNull();
      expect(ids.has(ds.id)).toBe(false);
      ids.add(ds.id);
    }
    expect(ids.size).toBe(BUILTIN_DESIGN_SYSTEMS.length);
  });
});
