import { describe, it, expect } from "vitest";
import {
  type CCProfile,
  type CCChannel,
  RANK_ORDER,
  DIVISIONS,
  sortByRank,
  buildOrgTree,
  visibleChannels,
} from "./ccTypes";

function prof(p: Partial<CCProfile>): CCProfile {
  return {
    id: p.id ?? "x",
    name: p.name ?? "X",
    rank: p.rank ?? "captain",
    division: p.division ?? "",
    accent: "#fff",
    brainModel: "",
    skillIds: [],
    wikiRoot: "",
    charter: "",
    autonomyLevel: 1,
    position: p.position ?? 0,
    createdAt: 0,
    updatedAt: 0,
    avatarPath: "",
    ...p,
  };
}

function chan(p: Partial<CCChannel>): CCChannel {
  return {
    id: p.id ?? "c",
    kind: p.kind ?? "division",
    division: p.division ?? "",
    name: p.name ?? "n",
    position: p.position ?? 0,
    createdAt: 0,
  };
}

describe("ccTypes", () => {
  it("ranks order commander < general < captain", () => {
    expect(RANK_ORDER.commander).toBeLessThan(RANK_ORDER.general);
    expect(RANK_ORDER.general).toBeLessThan(RANK_ORDER.captain);
  });

  it("ships four starting divisions with distinct accents", () => {
    expect(DIVISIONS).toHaveLength(4);
    const accents = new Set(DIVISIONS.map((d) => d.accent));
    expect(accents.size).toBe(4);
  });

  it("sortByRank orders by rank then position", () => {
    const out = sortByRank([
      prof({ id: "cap2", rank: "captain", position: 1 }),
      prof({ id: "cmd", rank: "commander" }),
      prof({ id: "cap1", rank: "captain", position: 0 }),
      prof({ id: "gen", rank: "general" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["cmd", "gen", "cap1", "cap2"]);
  });

  it("buildOrgTree splits the three tiers", () => {
    const tree = buildOrgTree([
      prof({ id: "cmd", rank: "commander" }),
      prof({ id: "gen", rank: "general" }),
      prof({ id: "d", rank: "captain", division: "design" }),
      prof({ id: "m", rank: "captain", division: "marketing", position: 1 }),
    ]);
    expect(tree.commander?.id).toBe("cmd");
    expect(tree.general?.id).toBe("gen");
    expect(tree.captains.map((c) => c.id)).toEqual(["d", "m"]);
  });

  it("buildOrgTree tolerates missing ranks", () => {
    const tree = buildOrgTree([prof({ id: "d", rank: "captain" })]);
    expect(tree.commander).toBeNull();
    expect(tree.general).toBeNull();
    expect(tree.captains).toHaveLength(1);
  });

  it("a captain only sees command/cross + its own division", () => {
    const channels = [
      chan({ id: "cmd", kind: "command" }),
      chan({ id: "cross", kind: "cross" }),
      chan({ id: "design", kind: "division", division: "design" }),
      chan({ id: "dev", kind: "division", division: "dev" }),
    ];
    const out = visibleChannels(
      prof({ rank: "captain", division: "design" }),
      channels,
    );
    expect(out.map((c) => c.id).sort()).toEqual(["cmd", "cross", "design"]);
  });

  it("commander and general see every channel", () => {
    const channels = [
      chan({ id: "design", kind: "division", division: "design" }),
      chan({ id: "dev", kind: "division", division: "dev" }),
    ];
    expect(visibleChannels(prof({ rank: "commander" }), channels)).toHaveLength(2);
    expect(visibleChannels(prof({ rank: "general" }), channels)).toHaveLength(2);
  });
});
