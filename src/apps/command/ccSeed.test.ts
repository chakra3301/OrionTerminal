import { describe, it, expect } from "vitest";
import { defaultSeed } from "./ccSeed";
import { buildOrgTree, DIVISIONS } from "./ccTypes";

describe("ccSeed", () => {
  const seed = defaultSeed({ wikiBase: "/vault/command-center/", now: 100 });

  it("seeds a commander, a general, and one captain per division", () => {
    const tree = buildOrgTree(seed.profiles);
    expect(tree.commander?.name).toBe("Commander");
    expect(tree.general?.name).toBe("General");
    expect(tree.captains).toHaveLength(DIVISIONS.length);
  });

  it("gives each captain its own division vault under the base", () => {
    const dev = seed.profiles.find((p) => p.id === "cc-prof-cap-dev");
    expect(dev?.wikiRoot).toBe("/vault/command-center/divisions/dev/wiki");
    expect(seed.profiles.find((p) => p.rank === "general")?.wikiRoot).toBe(
      "/vault/command-center/org/wiki",
    );
  });

  it("provisions the Design division as the PI Designer workspace", () => {
    const design = seed.profiles.find((p) => p.id === "cc-prof-cap-design");
    expect(design?.name).toBe("PI Designer");
    // runs at the division root (its workspace), not a /wiki subdir
    expect(design?.wikiRoot).toBe("/vault/command-center/divisions/design");
    expect(design?.skillIds).toContain("threejs-webgl");
    expect(design?.skillIds).toContain("design-taste-frontend");
    expect(design?.skillIds.length).toBeGreaterThan(15);
  });

  it("the commander has no model and no vault (it's you)", () => {
    const cmd = seed.profiles.find((p) => p.rank === "commander");
    expect(cmd?.brainModel).toBe("");
    expect(cmd?.wikiRoot).toBe("");
    expect(cmd?.autonomyLevel).toBe(0);
  });

  it("seeds command + cross + one channel per division", () => {
    const kinds = seed.channels.map((c) => c.kind);
    expect(kinds.filter((k) => k === "command")).toHaveLength(1);
    expect(kinds.filter((k) => k === "cross")).toHaveLength(1);
    expect(kinds.filter((k) => k === "division")).toHaveLength(DIVISIONS.length);
  });

  it("is deterministic with stable ids (idempotent re-seed)", () => {
    const a = defaultSeed({ wikiBase: "/vault/command-center", now: 1 });
    const b = defaultSeed({ wikiBase: "/vault/command-center", now: 2 });
    expect(a.profiles.map((p) => p.id)).toEqual(b.profiles.map((p) => p.id));
    expect(a.channels.map((c) => c.id)).toEqual(b.channels.map((c) => c.id));
  });

  it("captains default to autonomy level 1 (approve-each)", () => {
    for (const cap of seed.profiles.filter((p) => p.rank === "captain")) {
      expect(cap.autonomyLevel).toBe(1);
    }
  });
});
