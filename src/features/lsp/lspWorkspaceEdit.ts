import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { ipc } from "@/lib/ipc";
import { useTabsStore } from "@/store/tabsStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useGit } from "@/store/gitStore";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";
import { uriToPath, fromLspRange, type LspRange } from "./lspProtocol";

type MonacoNs = Parameters<OnMount>[1];

type LspTextEdit = { range: LspRange; newText: string };

/** An LSP WorkspaceEdit in either shape: `changes` (uri -> edits) or the
 * versioned `documentChanges` array. */
export type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{
    textDocument?: { uri: string };
    edits?: LspTextEdit[];
  }>;
};

function collectByFile(edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> {
  const out = new Map<string, LspTextEdit[]>();
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      out.set(uriToPath(uri), edits);
    }
  }
  for (const dc of edit.documentChanges ?? []) {
    const uri = dc.textDocument?.uri;
    if (uri && dc.edits) {
      const path = uriToPath(uri);
      out.set(path, [...(out.get(path) ?? []), ...dc.edits]);
    }
  }
  return out;
}

/** Apply edits to one file's text. Edits are applied bottom-up so earlier
 * offsets stay valid; pure string surgery, no Monaco needed for closed
 * files. Exported for tests. */
export function applyEditsToText(text: string, edits: LspTextEdit[]): string {
  const lines = text.split("\n");
  // Convert each edit to absolute [start,end) offsets, then splice high->low.
  const offsetAt = (line: number, char: number): number => {
    let o = 0;
    for (let i = 0; i < line; i++) o += (lines[i]?.length ?? 0) + 1;
    return o + char;
  };
  const ranged = edits
    .map((e) => ({
      start: offsetAt(e.range.start.line, e.range.start.character),
      end: offsetAt(e.range.end.line, e.range.end.character),
      newText: e.newText,
    }))
    .sort((a, b) => b.start - a.start);
  let result = text;
  for (const e of ranged) {
    result = result.slice(0, e.start) + e.newText + result.slice(e.end);
  }
  return result;
}

/**
 * Apply an LSP WorkspaceEdit across the project. Open files update through
 * Monaco (single undo step, stays editable); closed files are read, edited
 * on disk, and written atomically. Returns the number of files changed.
 */
export async function applyWorkspaceEdit(
  monaco: MonacoNs,
  edit: LspWorkspaceEdit,
): Promise<number> {
  const byFile = collectByFile(edit);
  if (byFile.size === 0) return 0;
  let changed = 0;

  for (const [path, edits] of byFile) {
    if (edits.length === 0) continue;
    const model = (monaco.editor.getModels() as editor.ITextModel[]).find(
      (m) => m.uri.path === path,
    );
    try {
      if (model) {
        // In-editor: one undoable operation, cursor preserved by Monaco.
        model.pushEditOperations(
          [],
          edits.map((e) => ({
            range: monaco.Range.lift(fromLspRange(e.range)),
            text: e.newText,
          })),
          () => null,
        );
        // Persist immediately so on-disk matches (rename is a commit-grade
        // action) and mark the tab clean.
        await ipc.saveFileAtomic(path, model.getValue());
        useTabsStore.getState().markSaved?.(path);
      } else {
        const original = await ipc.readFile(path);
        const updated = applyEditsToText(original, edits);
        await ipc.saveFileAtomic(path, updated);
        useTabsStore.getState().markLoaded(path, updated);
      }
      changed++;
    } catch (e) {
      log.error("workspace edit failed for", path, e);
      toast.error(`Edit failed for ${path.split("/").pop()}`, {
        body: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (changed > 0) {
    useFileTreeRefresh.getState().bump();
    useGit.getState().refresh();
  }
  return changed;
}
