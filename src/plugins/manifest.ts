import {
  PLUGIN_API_VERSION,
  PLUGIN_PERMISSIONS,
  assertPluginId,
  type PluginPermission,
} from "@/plugins/contracts";

const TOP_LEVEL_KEYS = new Set([
  "id",
  "name",
  "version",
  "apiVersion",
  "engines",
  "publisher",
  "entrypoints",
  "activationEvents",
  "dependencies",
  "contributes",
  "permissions",
]);
const ENGINE_KEYS = new Set(["orion"]);
const ENTRYPOINT_KEYS = new Set(["background", "ui"]);
const CONTRIBUTION_KEYS = new Set([
  "commands",
  "views",
  "settings",
  "statusItems",
  "fileHandlers",
  "aiTools",
]);
const STATIC_PERMISSIONS = new Set<string>(PLUGIN_PERMISSIONS);
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ACTIVATION = /^(?:onStartup|onApp:[A-Za-z0-9._:-]+|onCommand:[A-Za-z0-9._:-]+)$/;

export type PluginManifestV1 = {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  engines: { orion: string };
  publisher: string;
  entrypoints?: { background?: string; ui?: string };
  activationEvents?: string[];
  dependencies?: Record<string, string>;
  contributes?: Partial<Record<(typeof CONTRIBUTION_KEYS extends Set<infer K> ? K : never) & string, unknown[]>>;
  permissions: PluginPermission[];
};

export type ManifestValidation =
  | { ok: true; manifest: PluginManifestV1 }
  | { ok: false; issues: string[] };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, issues: string[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not supported`);
  }
}

function nonEmptyString(value: unknown, path: string, issues: string[], max = 200): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    issues.push(`${path} must be a non-empty string of at most ${max} characters`);
    return false;
  }
  return true;
}

function safeEntrypoint(value: unknown, path: string, issues: string[]): value is string {
  if (!nonEmptyString(value, path, issues, 512)) return false;
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
  ) {
    issues.push(`${path} must be a package-relative path without traversal or a URL`);
    return false;
  }
  return true;
}

function validPermission(value: unknown): value is PluginPermission {
  if (typeof value !== "string") return false;
  if (STATIC_PERMISSIONS.has(value)) return true;
  if (!value.startsWith("network:")) return false;
  const raw = value.slice("network:".length);
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === raw &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function validatePluginManifest(input: unknown): ManifestValidation {
  const issues: string[] = [];
  const root = record(input);
  if (!root) return { ok: false, issues: ["manifest must be an object"] };
  unknownKeys(root, TOP_LEVEL_KEYS, "manifest", issues);

  if (nonEmptyString(root.id, "manifest.id", issues)) {
    try {
      assertPluginId(root.id);
    } catch {
      issues.push("manifest.id is not a valid plugin id");
    }
  }
  nonEmptyString(root.name, "manifest.name", issues, 120);
  if (nonEmptyString(root.version, "manifest.version", issues, 64) && !VERSION.test(root.version)) {
    issues.push("manifest.version must be a semantic version");
  }
  if (root.apiVersion !== PLUGIN_API_VERSION) {
    issues.push(`manifest.apiVersion must be ${PLUGIN_API_VERSION}`);
  }
  nonEmptyString(root.publisher, "manifest.publisher", issues, 120);

  const engines = record(root.engines);
  if (!engines) {
    issues.push("manifest.engines must be an object");
  } else {
    unknownKeys(engines, ENGINE_KEYS, "manifest.engines", issues);
    nonEmptyString(engines.orion, "manifest.engines.orion", issues, 120);
  }

  if (root.entrypoints !== undefined) {
    const entrypoints = record(root.entrypoints);
    if (!entrypoints) {
      issues.push("manifest.entrypoints must be an object");
    } else {
      unknownKeys(entrypoints, ENTRYPOINT_KEYS, "manifest.entrypoints", issues);
      if (entrypoints.background !== undefined) safeEntrypoint(entrypoints.background, "manifest.entrypoints.background", issues);
      if (entrypoints.ui !== undefined) safeEntrypoint(entrypoints.ui, "manifest.entrypoints.ui", issues);
      if (entrypoints.background === undefined && entrypoints.ui === undefined) {
        issues.push("manifest.entrypoints must declare background or ui");
      }
    }
  }

  if (root.activationEvents !== undefined) {
    if (!Array.isArray(root.activationEvents)) {
      issues.push("manifest.activationEvents must be an array");
    } else {
      root.activationEvents.forEach((event, index) => {
        if (typeof event !== "string" || !ACTIVATION.test(event)) {
          issues.push(`manifest.activationEvents[${index}] is not supported`);
        }
      });
    }
  }

  if (root.dependencies !== undefined) {
    const dependencies = record(root.dependencies);
    if (!dependencies) {
      issues.push("manifest.dependencies must be an object");
    } else {
      for (const [id, range] of Object.entries(dependencies)) {
        try {
          assertPluginId(id);
        } catch {
          issues.push(`manifest.dependencies.${id} is not a valid plugin id`);
        }
        nonEmptyString(range, `manifest.dependencies.${id}`, issues, 120);
      }
    }
  }

  if (root.contributes !== undefined) {
    const contributes = record(root.contributes);
    if (!contributes) {
      issues.push("manifest.contributes must be an object");
    } else {
      unknownKeys(contributes, CONTRIBUTION_KEYS, "manifest.contributes", issues);
      for (const [key, value] of Object.entries(contributes)) {
        if (!Array.isArray(value)) issues.push(`manifest.contributes.${key} must be an array`);
      }
    }
  }

  if (!Array.isArray(root.permissions)) {
    issues.push("manifest.permissions must be an array");
  } else {
    const seen = new Set<string>();
    root.permissions.forEach((permission, index) => {
      if (!validPermission(permission)) {
        issues.push(`manifest.permissions[${index}] is unknown or invalid`);
      } else if (seen.has(permission)) {
        issues.push(`manifest.permissions[${index}] is duplicated`);
      } else {
        seen.add(permission);
      }
    });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, manifest: root as PluginManifestV1 };
}
