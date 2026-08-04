import {
  PLUGIN_API_VERSION,
  PLUGIN_PERMISSIONS,
  assertContributionId,
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
  "apps",
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
const APP_KEYS = new Set(["id", "name", "description", "accent", "window"]);
const APP_WINDOW_KEYS = new Set(["title", "subtitle", "width", "height"]);
const COMMAND_KEYS = new Set(["id", "title", "app", "keywords"]);
const APP_ACCENTS = new Set(["cyan", "green", "magenta", "yellow", "violet"]);

export type PluginAppContributionV1 = {
  id: string;
  name: string;
  description?: string;
  accent?: "cyan" | "green" | "magenta" | "yellow" | "violet";
  window?: {
    title?: string;
    subtitle?: string;
    width?: number;
    height?: number;
  };
};

export type PluginCommandContributionV1 = {
  id: string;
  title: string;
  app: string;
  keywords?: string[];
};

export type PluginContributionsV1 = {
  apps?: PluginAppContributionV1[];
  commands?: PluginCommandContributionV1[];
  views?: unknown[];
  settings?: unknown[];
  statusItems?: unknown[];
  fileHandlers?: unknown[];
  aiTools?: unknown[];
};

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
  contributes?: PluginContributionsV1;
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

function contributionId(value: unknown, path: string, issues: string[]): value is string {
  if (!nonEmptyString(value, path, issues, 128)) return false;
  try {
    assertContributionId(value);
    return true;
  } catch {
    issues.push(`${path} is not a valid contribution id`);
    return false;
  }
}

function validateAppContribution(
  value: unknown,
  index: number,
  appIds: Set<string>,
  issues: string[],
): void {
  const path = `manifest.contributes.apps[${index}]`;
  const app = record(value);
  if (!app) {
    issues.push(`${path} must be an object`);
    return;
  }
  unknownKeys(app, APP_KEYS, path, issues);
  if (contributionId(app.id, `${path}.id`, issues)) {
    if (appIds.has(app.id)) issues.push(`${path}.id is duplicated`);
    appIds.add(app.id);
  }
  nonEmptyString(app.name, `${path}.name`, issues, 120);
  if (app.description !== undefined) nonEmptyString(app.description, `${path}.description`, issues, 240);
  if (app.accent !== undefined && (typeof app.accent !== "string" || !APP_ACCENTS.has(app.accent))) {
    issues.push(`${path}.accent is not supported`);
  }
  if (app.window !== undefined) {
    const window = record(app.window);
    if (!window) {
      issues.push(`${path}.window must be an object`);
    } else {
      unknownKeys(window, APP_WINDOW_KEYS, `${path}.window`, issues);
      if (window.title !== undefined) nonEmptyString(window.title, `${path}.window.title`, issues, 80);
      if (window.subtitle !== undefined && (typeof window.subtitle !== "string" || window.subtitle.length > 80)) {
        issues.push(`${path}.window.subtitle must be a string of at most 80 characters`);
      }
      for (const key of ["width", "height"] as const) {
        if (window[key] !== undefined && (
          typeof window[key] !== "number" ||
          !Number.isInteger(window[key]) ||
          window[key] < 320 ||
          window[key] > 2400
        )) {
          issues.push(`${path}.window.${key} must be an integer between 320 and 2400`);
        }
      }
    }
  }
}

function validateCommandContribution(
  value: unknown,
  index: number,
  appIds: ReadonlySet<string>,
  issues: string[],
): void {
  const path = `manifest.contributes.commands[${index}]`;
  const command = record(value);
  if (!command) {
    issues.push(`${path} must be an object`);
    return;
  }
  unknownKeys(command, COMMAND_KEYS, path, issues);
  contributionId(command.id, `${path}.id`, issues);
  nonEmptyString(command.title, `${path}.title`, issues, 120);
  if (!contributionId(command.app, `${path}.app`, issues) || !appIds.has(command.app)) {
    issues.push(`${path}.app must reference a contributed app`);
  }
  if (command.keywords !== undefined && (
    !Array.isArray(command.keywords) ||
    command.keywords.length > 20 ||
    command.keywords.some((keyword) => typeof keyword !== "string" || !keyword || keyword.length > 40)
  )) {
    issues.push(`${path}.keywords must contain at most 20 short strings`);
  }
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
      const appIds = new Set<string>();
      if (Array.isArray(contributes.apps)) {
        if (contributes.apps.length > 8) issues.push("manifest.contributes.apps exceeds 8 entries");
        contributes.apps.forEach((app, index) => validateAppContribution(app, index, appIds, issues));
      }
      if (Array.isArray(contributes.commands)) {
        if (contributes.commands.length > 64) issues.push("manifest.contributes.commands exceeds 64 entries");
        const commandIds = new Set<string>();
        contributes.commands.forEach((command, index) => {
          validateCommandContribution(command, index, appIds, issues);
          const id = record(command)?.id;
          if (typeof id === "string") {
            if (commandIds.has(id)) issues.push(`manifest.contributes.commands[${index}].id is duplicated`);
            commandIds.add(id);
          }
        });
      }
      for (const key of ["views", "settings", "statusItems", "fileHandlers", "aiTools"] as const) {
        if (Array.isArray(contributes[key]) && contributes[key].length > 0) {
          issues.push(`manifest.contributes.${key} is not available in this host build`);
        }
      }
      if (
        appIds.size > 0 &&
        (!record(root.entrypoints) || typeof record(root.entrypoints)?.ui !== "string")
      ) {
        issues.push("manifest.contributes.apps requires manifest.entrypoints.ui");
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
