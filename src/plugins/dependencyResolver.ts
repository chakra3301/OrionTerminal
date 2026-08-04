import { BUILTIN_APP_PLUGIN_CATALOG } from "@/plugins/builtinApps";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";

export const ORION_HOST_VERSION = "0.1.0";

type Version = [number, number, number];

function parseVersion(value: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(left: Version, right: Version): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function comparator(version: Version, expression: string): boolean {
  if (expression === "*" || expression.toLowerCase() === "latest") return true;
  const match = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(expression);
  if (!match) return false;
  const target = parseVersion(match[2]!);
  if (!target) return false;
  const relation = compare(version, target);
  switch (match[1] ?? "=") {
    case ">=": return relation >= 0;
    case "<=": return relation <= 0;
    case ">": return relation > 0;
    case "<": return relation < 0;
    case "^": {
      const upper: Version = target[0] > 0
        ? [target[0] + 1, 0, 0]
        : target[1] > 0
          ? [0, target[1] + 1, 0]
          : [0, 0, target[2] + 1];
      return relation >= 0 && compare(version, upper) < 0;
    }
    case "~":
      return relation >= 0 && compare(version, [target[0], target[1] + 1, 0]) < 0;
    default: return relation === 0;
  }
}

export function satisfiesVersion(versionText: string, rangeText: string): boolean {
  const version = parseVersion(versionText);
  if (!version) return false;
  return rangeText
    .split("||")
    .map((branch) => branch.trim())
    .filter(Boolean)
    .some((branch) => branch.split(/\s+/).every((part) => comparator(version, part)));
}

export type CommunityResolution = {
  activationOrder: InstalledCommunityPlugin[];
  issues: Record<string, string>;
};

export function resolveCommunityPlugins(
  installed: readonly InstalledCommunityPlugin[],
  enabledBuiltinIds: ReadonlySet<string>,
): CommunityResolution {
  const candidates = new Map(
    installed
      .filter((plugin) => plugin.enabled && !plugin.quarantined)
      .map((plugin) => [plugin.manifest.id, plugin]),
  );
  const versions = new Map<string, string>();
  for (const builtin of BUILTIN_APP_PLUGIN_CATALOG) {
    if (enabledBuiltinIds.has(builtin.pluginId)) versions.set(builtin.pluginId, builtin.version);
  }
  for (const plugin of candidates.values()) versions.set(plugin.manifest.id, plugin.manifest.version);

  const issues: Record<string, string> = {};
  for (const plugin of candidates.values()) {
    if (!satisfiesVersion(ORION_HOST_VERSION, plugin.manifest.engines.orion)) {
      issues[plugin.manifest.id] =
        `Requires Orion ${plugin.manifest.engines.orion}; this host is ${ORION_HOST_VERSION}.`;
      continue;
    }
    for (const [dependencyId, range] of Object.entries(plugin.manifest.dependencies ?? {})) {
      const version = versions.get(dependencyId);
      if (!version) {
        issues[plugin.manifest.id] = `Required dependency ${dependencyId} is missing or disabled.`;
        break;
      }
      if (!satisfiesVersion(version, range)) {
        issues[plugin.manifest.id] =
          `Required dependency ${dependencyId} ${range} is incompatible with ${version}.`;
        break;
      }
    }
  }

  const activationOrder: InstalledCommunityPlugin[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (plugin: InstalledCommunityPlugin, stack: string[]): boolean => {
    const id = plugin.manifest.id;
    if (issues[id]) return false;
    if (visited.has(id)) return true;
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(Math.max(0, cycleStart)), id];
      for (const member of cycle) issues[member] = `Dependency cycle: ${cycle.join(" → ")}.`;
      return false;
    }
    visiting.add(id);
    let valid = true;
    for (const dependencyId of Object.keys(plugin.manifest.dependencies ?? {})) {
      const dependency = candidates.get(dependencyId);
      if (dependency && !visit(dependency, [...stack, id])) valid = false;
    }
    visiting.delete(id);
    if (!valid || issues[id]) return false;
    visited.add(id);
    activationOrder.push(plugin);
    return true;
  };
  for (const plugin of candidates.values()) visit(plugin, []);
  return { activationOrder, issues };
}
