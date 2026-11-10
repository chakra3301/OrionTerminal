// @vitest-environment node
// Archives 47 is built from Orion Studio's source tree. This test walks the
// standalone entry's static imports and fails if it reaches any Orion-only
// surface (editor, XDesign app, Command Center, Hermes, Incubator, companions,
// the desktop shell). Small pure helpers it legitimately shares are listed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHIVES_ALIASES } from "./aliases";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const ENTRY = path.join(SRC, "standalone/archives/main.tsx");

const FORBIDDEN = [
  "apps/orion/",
  "apps/xdesign/",
  "apps/command/",
  "apps/hermes/",
  "apps/incubator/",
  "features/rosie/",
  "features/intake/",
  "features/lsp/",
  "features/onboarding/",
  "features/auth/",
  "features/characters/",
  "shell/",
  "plugins/builtinApps",
  "store/pluginManagerStore",
  "store/commandStore",
  "store/hermesStore",
  "store/projectStore",
  "store/terminalStore",
  "store/wallpaperStore",
  "components/workspace/",
  "commands/builtins",
  "vendor/",
  "lib/voice",
  "lib/wakeWord",
];

/** Pure, UI-free helpers shared with Orion code paths Archives also uses. */
const ALLOWED = new Set([
  "apps/xdesign/imageGen.ts", // provider image-capability checks in AI settings (types + string helpers)
  "apps/xdesign/imageProviderRuntime.ts", // codex image-status cache used by provider toggles
  "features/intake/contracts.ts", // skill package parsers (skills store)
  "features/intake/installedApi.ts", // read-only installed-skill listing
  "features/intake/skillActivation.ts", // send-path skill checks (no-op without imported skills)
  "features/intake/skillRuns.ts", // in-memory run bookkeeping
  "shell/WindowTitleStatusContext.ts", // a React context
  "shell/useDraggable.ts", // drag hook for the Learn scratchpad
]);

const STATEMENT = /^\s*(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
// A runtime dynamic import; `import("x").Type` in a type position is erased by TypeScript.
const DYNAMIC = /import\(\s*['"]([^'"]+)['"]\s*\)(?!\s*\.\s*[A-Z])/g;
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx", ""];

function resolve(spec: string, from: string): string | null {
  const alias = ARCHIVES_ALIASES[spec];
  let base: string;
  if (alias) base = path.join(SRC, alias);
  else if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  base = base.split("?")[0]!;
  for (const ext of EXTS) {
    const file = base + ext;
    if (existsSync(file) && /\.(tsx?|js|mjs)$/.test(file)) return file;
  }
  return null;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const specs: string[] = [];
  for (const m of text.matchAll(STATEMENT)) {
    if (m[4]) { specs.push(m[4]); continue; }
    if (m[1]) continue; // import type
    const clause = (m[2] ?? "").trim();
    if (clause.startsWith("{") && clause.endsWith("}")) {
      const names = clause.slice(1, -1).split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith("type "))) continue;
    }
    specs.push(m[3]!);
  }
  for (const m of text.matchAll(DYNAMIC)) specs.push(m[1]!);
  return specs;
}

function walk(): Map<string, string | null> {
  const parent = new Map<string, string | null>([[ENTRY, null]]);
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.pop()!;
    for (const spec of importsOf(file)) {
      const target = resolve(spec, file);
      if (!target || parent.has(target)) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  return parent;
}

const rel = (f: string) => path.relative(SRC, f);

describe("Archives 47 import boundary", () => {
  const graph = walk();

  it("reaches Archives itself", () => {
    expect(graph.has(path.join(SRC, "apps/archives/ArchivesApp.tsx"))).toBe(true);
    expect(graph.size).toBeGreaterThan(150);
  });

  it("never reaches an Orion-only surface", () => {
    const leaks: string[] = [];
    for (const file of graph.keys()) {
      const r = rel(file);
      if (ALLOWED.has(r) || !FORBIDDEN.some((f) => r.startsWith(f))) continue;
      const chain: string[] = [];
      for (let f: string | null | undefined = file; f; f = graph.get(f)) chain.unshift(rel(f));
      leaks.push(chain.join(" -> "));
    }
    expect(leaks).toEqual([]);
  });

  it("swaps the multi-app assistant defaults for Archives-only ones", () => {
    expect(graph.has(path.join(SRC, "standalone/archives/appDefaults.ts"))).toBe(true);
    expect(graph.has(path.join(SRC, "store/appDefaults.ts"))).toBe(false);
  });

  it("opens the same library file the native side migrates", () => {
    const db = readFileSync(path.join(SRC, "lib/db.ts"), "utf8");
    const profile = readFileSync(path.join(ROOT, "src-tauri/src/app_profile.rs"), "utf8");
    expect(db).toContain('"sqlite:archives.db"');
    expect(db).toContain('"sqlite:orion.db"');
    expect(profile).toMatch(/fn archives[\s\S]*?db_file: "archives\.db"/);
  });
});
