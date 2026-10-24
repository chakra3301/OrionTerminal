import { validatePluginManifest } from "./manifest";
import type { CommunityPluginInspection, InstalledCommunityPlugin } from "./communityTypes";

export function parsePackageInspection(value: unknown): CommunityPluginInspection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid package inspection");
  const r = value as Record<string, unknown>;
  const keys = ["manifest", "fingerprint", "fileCount", "totalBytes"];
  if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.hasOwn(r, k)) || typeof r.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(r.fingerprint)
    || !Number.isSafeInteger(r.fileCount) || (r.fileCount as number) < 1 || (r.fileCount as number) > 512
    || !Number.isSafeInteger(r.totalBytes) || (r.totalBytes as number) < 1 || (r.totalBytes as number) > 25 * 1024 * 1024) throw new Error("Invalid package inspection fields or limits");
  const result = validatePluginManifest(r.manifest);
  if (!result.ok) throw new Error(result.issues.join("\n"));
  return structuredClone({ manifest: result.manifest, fingerprint: r.fingerprint, fileCount: r.fileCount as number, totalBytes: r.totalBytes as number });
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function parseDisabledInstallReceipt(value: unknown, inspection: CommunityPluginInspection): InstalledCommunityPlugin {
  const failure = "Disabled installation receipt couldn't be confirmed. Reload Plugin Manager before retrying.";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(failure);
  const r = value as Record<string, unknown>, keys = ["manifest", "enabled", "grantedPermissions", "fingerprint", "installedAt", "quarantined", "quarantineReason", "workspaceHandles"];
  const checked = validatePluginManifest(r.manifest);
  if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.hasOwn(r, k)) || !checked.ok
    || JSON.stringify(canonical(checked.manifest)) !== JSON.stringify(canonical(inspection.manifest)) || r.fingerprint !== inspection.fingerprint
    || r.enabled !== false || r.quarantined !== false || r.quarantineReason !== null
    || !Array.isArray(r.grantedPermissions) || r.grantedPermissions.length !== inspection.manifest.permissions.length
    || !r.grantedPermissions.every((p) => typeof p === "string") || JSON.stringify([...r.grantedPermissions].sort()) !== JSON.stringify([...inspection.manifest.permissions].sort())
    || !Array.isArray(r.workspaceHandles) || r.workspaceHandles.length !== 0 || !Number.isSafeInteger(r.installedAt) || (r.installedAt as number) <= 0) throw new Error(failure);
  return structuredClone(value) as InstalledCommunityPlugin;
}
