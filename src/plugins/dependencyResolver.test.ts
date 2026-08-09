import { describe, expect, it } from "vitest";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";
import { resolveCommunityPlugins, satisfiesVersion } from "@/plugins/dependencyResolver";

function plugin(id: string, dependencies: Record<string, string> = {}): InstalledCommunityPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      apiVersion: "1",
      engines: { orion: "*" },
      publisher: "test",
      dependencies,
      permissions: [],
    },
    enabled: true,
    grantedPermissions: [],
    fingerprint: "a".repeat(64),
    installedAt: 1,
    quarantined: false,
    quarantineReason: null,
    workspaceHandles: [],
  };
}

describe("community plugin dependency resolver", () => {
  it("supports exact, comparator, caret, tilde, and disjunction ranges", () => {
    expect(satisfiesVersion("1.4.2", "1.4.2")).toBe(true);
    expect(satisfiesVersion("1.4.2", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesVersion("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfiesVersion("1.4.2", "~1.4.0")).toBe(true);
    expect(satisfiesVersion("1.4.2", "^2.0.0 || ~1.4.0")).toBe(true);
    expect(satisfiesVersion("2.0.0", "^1.2.0")).toBe(false);
  });

  it("orders dependencies before dependants", () => {
    const dependency = plugin("dev.plugin.base");
    const dependant = plugin("dev.plugin.feature", { "dev.plugin.base": "^1.0.0" });
    const result = resolveCommunityPlugins([dependant, dependency], new Set());
    expect(result.issues).toEqual({});
    expect(result.activationOrder.map((item) => item.manifest.id)).toEqual([
      "dev.plugin.base",
      "dev.plugin.feature",
    ]);
  });

  it("fails closed for missing, disabled, incompatible, and cyclic dependencies", () => {
    const missing = resolveCommunityPlugins(
      [plugin("dev.plugin.feature", { "dev.plugin.base": "^1.0.0" })],
      new Set(),
    );
    expect(missing.issues["dev.plugin.feature"]).toContain("missing or disabled");

    const incompatible = resolveCommunityPlugins(
      [plugin("dev.plugin.feature", { "@orion/editor": ">=2.0.0" })],
      new Set(["@orion/editor"]),
    );
    expect(incompatible.issues["dev.plugin.feature"]).toContain("incompatible");

    const left = plugin("dev.plugin.left", { "dev.plugin.right": "*" });
    const right = plugin("dev.plugin.right", { "dev.plugin.left": "*" });
    const cycle = resolveCommunityPlugins([left, right], new Set());
    expect(cycle.activationOrder).toEqual([]);
    expect(cycle.issues["dev.plugin.left"]).toContain("Dependency cycle");
    expect(cycle.issues["dev.plugin.right"]).toContain("Dependency cycle");
  });
});
