import type { OnMount } from "@monaco-editor/react";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useEditorNavStore } from "@/store/editorNavStore";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

type MonacoEditor = Parameters<OnMount>[0];

/** Project-wide go-to-definition (⌘F12) — the cross-file gap until real
 * LSP lands (1.6). Two strategies, in order:
 *   1. cursor on an import specifier → resolve the relative path and open it
 *   2. identifier → native literal search for declaration patterns, best
 *      hit wins (export-prefixed preferred, current location excluded)
 * Monaco's own F12 still handles same-file/open-model definitions. */
export async function gotoProjectDefinition(
  editor: MonacoEditor,
  currentPath: string,
): Promise<void> {
  const model = editor.getModel();
  const pos = editor.getPosition();
  const project = useProjectStore.getState().active;
  if (!model || !pos || !project) return;

  const line = model.getLineContent(pos.lineNumber);

  // Strategy 1: import path under cursor.
  const importMatch =
    line.match(/from\s+["']([^"']+)["']/) ?? line.match(/require\(\s*["']([^"']+)["']\s*\)/);
  if (importMatch && importMatch.index !== undefined) {
    const spec = importMatch[1]!;
    const start = line.indexOf(spec, importMatch.index);
    const within = pos.column - 1 >= start && pos.column - 1 <= start + spec.length;
    if (within && (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@/"))) {
      const base = spec.startsWith("@/")
        ? `${project.root_path}/src/${spec.slice(2)}`
        : resolveRelative(currentPath, spec);
      const candidates = [
        base,
        `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.rs`, `${base}.py`,
        `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`,
      ];
      for (const c of candidates) {
        try {
          if (await ipc.pathExists(c)) {
            openAt(c, 1, 1);
            return;
          }
        } catch {
          /* keep trying */
        }
      }
    }
  }

  // Strategy 2: declaration search for the identifier under the cursor.
  const word = model.getWordAtPosition(pos)?.word;
  if (!word || word.length < 2) return;

  const patterns = [
    `export function ${word}`, `export async function ${word}`, `function ${word}`,
    `export const ${word}`, `const ${word} =`,
    `export class ${word}`, `class ${word}`,
    `export type ${word}`, `export interface ${word}`, `interface ${word}`,
    `export enum ${word}`,
    `pub fn ${word}`, `fn ${word}`, `pub struct ${word}`, `struct ${word}`,
    `def ${word}(`,
  ];

  try {
    for (const q of patterns) {
      const groups = await ipc.searchInFiles(project.root_path, q, true);
      for (const g of groups) {
        for (const m of g.matches) {
          if (g.path === currentPath && m.line === pos.lineNumber) continue;
          openAt(g.path, m.line, m.column);
          return;
        }
      }
    }
  } catch (e) {
    log.warn("project goto-def search failed", e);
  }
  toast.info(`No project definition found for "${word}"`, {
    dedupeKey: "goto-def-miss",
  });
}

function resolveRelative(fromFile: string, spec: string): string {
  const dir = fromFile.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") dir.pop();
    else dir.push(part);
  }
  return dir.join("/");
}

function openAt(path: string, line: number, column: number): void {
  const base = path.split("/").pop() || path;
  useWorkspace
    .getState()
    .openTab({ kind: "file", path }, { label: base, preferRole: "editor" });
  useEditorNavStore.getState().reveal(path, line, column);
}
