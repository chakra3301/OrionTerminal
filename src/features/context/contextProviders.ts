import Fuse from "fuse.js";
import { ulid } from "ulid";
import { ipc, type TreeNode } from "@/lib/ipc";
import { useNotesStore } from "@/store/notesStore";
import {
  useDiagnosticsStore,
  SEVERITY_ERROR,
  SEVERITY_WARNING,
} from "@/store/diagnosticsStore";
import { getRecentTerminalOutput } from "@/apps/orion/ptyTerminal";

export type ContextItemKind =
  | "file"
  | "folder"
  | "problems"
  | "terminal"
  | "git-diff"
  | "note"
  | "code";

/** What the user attached — light, lives in the composer until send. */
export type ContextChip = {
  id: string;
  kind: ContextItemKind;
  label: string;
  /** file/folder: absolute path · note: note id · others: unused */
  detail?: string;
};

/** A chip with its content resolved at send time. */
export type ResolvedContext = ContextChip & {
  content: string;
  truncated: boolean;
};

/** Persisted on the message — proof of exactly what the AI saw. */
export type ContextPill = {
  kind: ContextItemKind;
  label: string;
  chars: number;
  truncated: boolean;
  preview: string;
};

export type ContextSuggestion = {
  kind: ContextItemKind;
  label: string;
  detail?: string;
  chip: ContextChip;
};

const FILE_CAP = 24_000;
const NOTE_CAP = 8_000;
const PROBLEMS_CAP = 6_000;
const TERMINAL_LINES = 120;
const FOLDER_ENTRY_CAP = 200;
const PREVIEW_CHARS = 400;

// ── Suggestion search ─────────────────────────────────────────────────────

let treeCache: { root: string; at: number; files: TreeNode[]; folders: TreeNode[] } | null = null;

async function projectEntries(root: string) {
  if (treeCache && treeCache.root === root && Date.now() - treeCache.at < 30_000) {
    return treeCache;
  }
  const tree = await ipc.readDirTree(root, 8);
  const files: TreeNode[] = [];
  const folders: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    for (const c of n.children ?? []) {
      if (c.is_dir) {
        folders.push(c);
        walk(c);
      } else {
        files.push(c);
      }
    }
  };
  walk(tree);
  treeCache = { root, at: Date.now(), files, folders };
  return treeCache;
}

function relPath(root: string, abs: string): string {
  return abs.startsWith(root) ? abs.slice(root.length).replace(/^\//, "") : abs;
}

function chip(kind: ContextItemKind, label: string, detail?: string): ContextChip {
  return { id: ulid(), kind, label, detail };
}

const STATIC_PROVIDERS: Array<{ keywords: string; make: () => ContextSuggestion | null }> = [
  {
    keywords: "problems errors warnings diagnostics lint",
    make: () => {
      const s = useDiagnosticsStore.getState();
      if (s.markers.length === 0) return null;
      const label = `Problems (${s.errorCount} errors, ${s.warningCount} warnings)`;
      return { kind: "problems", label, chip: chip("problems", label) };
    },
  },
  {
    keywords: "terminal output shell console log",
    make: () => {
      const label = "Terminal output";
      return { kind: "terminal", label, detail: `last ${TERMINAL_LINES} lines`, chip: chip("terminal", label) };
    },
  },
  {
    keywords: "git diff changes working uncommitted",
    make: () => {
      const label = "Working diff";
      return { kind: "git-diff", label, detail: "git status + diff vs HEAD", chip: chip("git-diff", label) };
    },
  },
];

/** Fuzzy suggestions for the @ picker. Empty query → the static providers
 * plus a few recent-ish files. */
export async function searchContextSuggestions(
  query: string,
  projectRoot: string | null,
): Promise<ContextSuggestion[]> {
  const q = query.trim();
  const out: ContextSuggestion[] = [];

  for (const p of STATIC_PROVIDERS) {
    if (q && !p.keywords.includes(q.toLowerCase())) continue;
    const s = p.make();
    if (s) out.push(s);
  }

  if (projectRoot) {
    try {
      const { files, folders } = await projectEntries(projectRoot);
      if (q) {
        const fileFuse = new Fuse(files, {
          keys: [{ name: "path", getFn: (n: TreeNode) => relPath(projectRoot, n.path) }],
          threshold: 0.4,
        });
        for (const r of fileFuse.search(q).slice(0, 7)) {
          const rel = relPath(projectRoot, r.item.path);
          out.push({ kind: "file", label: rel, chip: chip("file", rel, r.item.path) });
        }
        const folderFuse = new Fuse(folders, {
          keys: [{ name: "path", getFn: (n: TreeNode) => relPath(projectRoot, n.path) }],
          threshold: 0.35,
        });
        for (const r of folderFuse.search(q).slice(0, 3)) {
          const rel = relPath(projectRoot, r.item.path);
          out.push({ kind: "folder", label: `${rel}/`, chip: chip("folder", `${rel}/`, r.item.path) });
        }
      }
    } catch {
      /* tree unavailable — skip file suggestions */
    }
  }

  // Archives notes — the cross-app advantage: code questions with your own
  // research/notes attached.
  const notes = [...useNotesStore.getState().notes.values()].filter(
    (n) => (n.title || n.plaintext).trim().length > 0,
  );
  if (q) {
    const noteFuse = new Fuse(notes, { keys: ["title", "plaintext"], threshold: 0.45 });
    for (const r of noteFuse.search(q).slice(0, 4)) {
      const title = r.item.title || "Untitled note";
      out.push({
        kind: "note",
        label: title,
        detail: "Archives",
        chip: chip("note", title, r.item.id),
      });
    }
  }

  return out.slice(0, 14);
}

// ── Resolution (at send time) ─────────────────────────────────────────────

function cap(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: `${s.slice(0, max)}\n… (truncated)`, truncated: true };
}

/** Semantic top-k over the project index, resolved to fresh file slices.
 * Auto-attached by the Orion rail when the user didn't pin code context
 * explicitly — the pill makes every auto-attachment visible. */
export async function autoCodebaseContext(
  query: string,
  projectId: string,
  projectRoot: string,
  k = 3,
): Promise<ResolvedContext[]> {
  if (query.trim().length < 12) return [];
  const { searchCodebase } = await import("./codebaseIndexer");
  const hits = (await searchCodebase(query, projectId, k)).filter(
    (h) => h.score >= 0.32,
  );
  const out: ResolvedContext[] = [];
  for (const h of hits) {
    try {
      const content = await ipc.readFile(`${projectRoot}/${h.path}`);
      const slice = content
        .split("\n")
        .slice(h.startLine - 1, h.endLine)
        .join("\n");
      out.push({
        id: ulid(),
        kind: "code",
        label: `${h.path}:${h.startLine}-${h.endLine}`,
        detail: `${projectRoot}/${h.path}`,
        content: slice,
        truncated: false,
      });
    } catch {
      /* file vanished since indexing — skip */
    }
  }
  return out;
}

async function resolveOne(c: ContextChip, projectRoot: string | null): Promise<ResolvedContext> {
  try {
    switch (c.kind) {
      case "code":
      case "file": {
        const raw = await ipc.readFile(c.detail ?? c.label);
        const { text, truncated } = cap(raw, FILE_CAP);
        return { ...c, content: text, truncated };
      }
      case "folder": {
        if (!c.detail) throw new Error("no folder path");
        const tree = await ipc.readDirTree(c.detail, 4);
        const entries: string[] = [];
        const walk = (n: TreeNode, prefix: string) => {
          for (const child of n.children ?? []) {
            if (entries.length >= FOLDER_ENTRY_CAP) return;
            entries.push(`${prefix}${child.name}${child.is_dir ? "/" : ""}`);
            if (child.is_dir) walk(child, `${prefix}${child.name}/`);
          }
        };
        walk(tree, "");
        const truncated = entries.length >= FOLDER_ENTRY_CAP;
        return {
          ...c,
          content: entries.join("\n") + (truncated ? "\n… (listing truncated)" : ""),
          truncated,
        };
      }
      case "problems": {
        const { markers } = useDiagnosticsStore.getState();
        const lines = markers.map((m) => {
          const sev =
            m.severity === SEVERITY_ERROR
              ? "error"
              : m.severity === SEVERITY_WARNING
                ? "warning"
                : "info";
          return `${m.path}:${m.startLineNumber}:${m.startColumn} [${sev}] ${m.message}`;
        });
        const { text, truncated } = cap(lines.join("\n"), PROBLEMS_CAP);
        return { ...c, content: text || "(no problems)", truncated };
      }
      case "terminal": {
        const out = getRecentTerminalOutput(TERMINAL_LINES);
        return { ...c, content: out ?? "(no terminal open)", truncated: false };
      }
      case "git-diff": {
        if (!projectRoot) throw new Error("no project open");
        const diff = await ipc.gitWorkingDiff(projectRoot);
        return { ...c, content: diff, truncated: diff.endsWith("(diff truncated)") };
      }
      case "note": {
        const note = c.detail ? useNotesStore.getState().notes.get(c.detail) : undefined;
        if (!note) throw new Error("note not found");
        const body = `# ${note.title || "Untitled"}\n\n${note.plaintext}`;
        const { text, truncated } = cap(body, NOTE_CAP);
        return { ...c, content: text, truncated };
      }
    }
  } catch (e) {
    return {
      ...c,
      content: `(could not attach: ${e instanceof Error ? e.message : String(e)})`,
      truncated: false,
    };
  }
}

export async function resolveContextChips(
  chips: ContextChip[],
  projectRoot: string | null,
): Promise<ResolvedContext[]> {
  return Promise.all(chips.map((c) => resolveOne(c, projectRoot)));
}

/** The exact block prepended to the prompt. */
export function buildContextBlock(items: ResolvedContext[]): string {
  if (items.length === 0) return "";
  const parts = items.map(
    (r) => `<item kind="${r.kind}" name="${r.label.replace(/"/g, "'")}">\n${r.content}\n</item>`,
  );
  return `<attached-context>\n${parts.join("\n")}\n</attached-context>`;
}

export function toPill(r: ResolvedContext): ContextPill {
  return {
    kind: r.kind,
    label: r.label,
    chars: r.content.length,
    truncated: r.truncated,
    preview: r.content.slice(0, PREVIEW_CHARS),
  };
}
