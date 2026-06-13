import type { OnMount } from "@monaco-editor/react";
import type {
  editor,
  Position,
  IRange,
  languages,
} from "monaco-editor";
import { lspRequest, pathToUri } from "./lspManager";
import { applyWorkspaceEdit, type LspWorkspaceEdit } from "./lspWorkspaceEdit";
import { fromLspRange, type LspRange } from "./lspProtocol";

type MonacoNs = Parameters<OnMount>[1];

const LANGS = ["typescript", "javascript", "python", "rust"];

function pos(position: Position) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

// ── Completion ──────────────────────────────────────────────────────────────

type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number; // 2 = snippet
  sortText?: string;
  filterText?: string;
  textEdit?: { range: LspRange; newText: string };
  additionalTextEdits?: Array<{ range: LspRange; newText: string }>;
};

function completionKind(
  monaco: MonacoNs,
  lspKind: number | undefined,
): languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  // LSP CompletionItemKind (1..25) -> Monaco.
  const map: Record<number, languages.CompletionItemKind> = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field,
    6: K.Variable, 7: K.Class, 8: K.Interface, 9: K.Module, 10: K.Property,
    11: K.Unit, 12: K.Value, 13: K.Enum, 14: K.Keyword, 15: K.Snippet,
    16: K.Color, 17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember,
    21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator, 25: K.TypeParameter,
  };
  return map[lspKind ?? 0] ?? K.Text;
}

function registerCompletion(monaco: MonacoNs, lang: string): void {
  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: [".", '"', "'", "/", "@", "<", ":", " "],
    provideCompletionItems: async (model: editor.ITextModel, position: Position) => {
      const res = await lspRequest<
        LspCompletionItem[] | { items: LspCompletionItem[] } | null
      >(model.uri.path, "textDocument/completion", { position: pos(position) });
      if (!res) return { suggestions: [] };
      const items = Array.isArray(res) ? res : res.items;
      if (!items?.length) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const defaultRange: IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };

      const suggestions: languages.CompletionItem[] = items.slice(0, 300).map((it) => {
        const isSnippet = it.insertTextFormat === 2;
        const range: IRange = it.textEdit
          ? fromLspRange(it.textEdit.range)
          : defaultRange;
        const insertText = it.textEdit?.newText ?? it.insertText ?? it.label;
        const extra = it.additionalTextEdits?.length
          ? it.additionalTextEdits.map((e) => ({
              range: monaco.Range.lift(fromLspRange(e.range)),
              text: e.newText,
            }))
          : undefined;
        return {
          label: it.label,
          kind: completionKind(monaco, it.kind),
          insertText,
          insertTextRules: isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          range,
          detail: it.detail,
          documentation:
            typeof it.documentation === "string"
              ? it.documentation
              : it.documentation?.value,
          sortText: it.sortText,
          filterText: it.filterText,
          additionalTextEdits: extra,
        };
      });
      return { suggestions };
    },
  });
}

// ── Signature help ──────────────────────────────────────────────────────────

type LspSignatureHelp = {
  signatures: Array<{
    label: string;
    documentation?: string | { value: string };
    parameters?: Array<{ label: string | [number, number]; documentation?: string }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
};

function registerSignatureHelp(monaco: MonacoNs, lang: string): void {
  monaco.languages.registerSignatureHelpProvider(lang, {
    signatureHelpTriggerCharacters: ["(", ","],
    provideSignatureHelp: async (model: editor.ITextModel, position: Position) => {
      const res = await lspRequest<LspSignatureHelp | null>(
        model.uri.path,
        "textDocument/signatureHelp",
        { position: pos(position) },
      );
      if (!res?.signatures?.length) return null;
      const value: languages.SignatureHelp = {
        signatures: res.signatures.map((s) => ({
          label: s.label,
          documentation:
            typeof s.documentation === "string" ? s.documentation : s.documentation?.value,
          parameters: (s.parameters ?? []).map((p) => ({
            label: p.label,
            documentation: p.documentation,
          })),
        })),
        activeSignature: res.activeSignature ?? 0,
        activeParameter: res.activeParameter ?? 0,
      };
      return { value, dispose: () => {} };
    },
  });
}

// ── Rename (F2) ─────────────────────────────────────────────────────────────

function registerRename(monaco: MonacoNs, lang: string): void {
  monaco.languages.registerRenameProvider(lang, {
    provideRenameEdits: async (
      model: editor.ITextModel,
      position: Position,
      newName: string,
    ) => {
      const edit = await lspRequest<LspWorkspaceEdit | null>(
        model.uri.path,
        "textDocument/rename",
        { position: pos(position), newName },
      );
      // Apply across the project ourselves (Monaco's bulk edit can't write
      // closed files); hand Monaco an empty edit so it double-applies nothing.
      if (edit) {
        const n = await applyWorkspaceEdit(monaco, edit);
        const { toast } = await import("@/store/toastStore");
        if (n > 0) toast.success(`Renamed across ${n} file${n === 1 ? "" : "s"}`);
      }
      return { edits: [] };
    },
  });
}

// ── Code actions / quick fixes ──────────────────────────────────────────────

type LspCommand = { title: string; command: string; arguments?: unknown[] };
type LspCodeAction = {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: LspWorkspaceEdit;
  command?: LspCommand | string;
};

function registerCodeActions(monaco: MonacoNs, lang: string): void {
  monaco.languages.registerCodeActionProvider(lang, {
    provideCodeActions: async (
      model: editor.ITextModel,
      range: IRange,
      context: languages.CodeActionContext,
    ) => {
      const lspDiags = (context.markers ?? []).map((m) => ({
        range: {
          start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
          end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
        },
        message: m.message,
        severity: m.severity === 8 ? 1 : m.severity === 4 ? 2 : 3,
      }));
      const res = await lspRequest<Array<LspCodeAction | LspCommand> | null>(
        model.uri.path,
        "textDocument/codeAction",
        {
          range: {
            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
          },
          context: { diagnostics: lspDiags },
        },
      );
      if (!res?.length) return { actions: [], dispose: () => {} };

      const path = model.uri.path;
      const actions: languages.CodeAction[] = res.map((a) => {
        const ca = a as LspCodeAction;
        return {
          title: ca.title,
          kind: ca.kind ?? "quickfix",
          isPreferred: ca.isPreferred,
          // The work is funnelled through one Monaco command so closed-file
          // edits + executeCommand both route through our applier.
          command: {
            id: "lsp.runCodeAction",
            title: ca.title,
            arguments: [path, a],
          },
        };
      });
      return { actions, dispose: () => {} };
    },
  });
}

let codeActionCmdRegistered = false;
function registerCodeActionCommand(monaco: MonacoNs): void {
  if (codeActionCmdRegistered) return;
  codeActionCmdRegistered = true;
  monaco.editor.addCommand({
    id: "lsp.runCodeAction",
    run: (_accessor: unknown, path: string, action: LspCodeAction | LspCommand) => {
      void (async () => {
        const ca = action as LspCodeAction;
        if (ca.edit) {
          await applyWorkspaceEdit(monaco, ca.edit);
        }
        const cmd = ca.command ?? (action as LspCommand);
        if (cmd && typeof cmd !== "string" && "command" in cmd) {
          await lspRequest(path, "workspace/executeCommand", {
            command: cmd.command,
            arguments: cmd.arguments ?? [],
          });
        }
      })();
    },
  });
}

/** Organize imports = a well-known source code action; expose it as an
 * editor command so it can be a palette entry + shortcut. */
export async function lspOrganizeImports(path: string): Promise<void> {
  const all = await lspRequest<Array<LspCodeAction> | null>(
    path,
    "textDocument/codeAction",
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      context: { diagnostics: [], only: ["source.organizeImports"] },
    },
  );
  const action = all?.find((a) => a.kind === "source.organizeImports");
  if (!action) return;
  const monaco = (await import("./lspManager")).getMonaco();
  if (!monaco) return;
  if (action.edit) await applyWorkspaceEdit(monaco, action.edit);
  const cmd = action.command;
  if (cmd && typeof cmd !== "string") {
    await lspRequest(path, "workspace/executeCommand", {
      command: cmd.command,
      arguments: cmd.arguments ?? [],
    });
  }
}

export function registerLspFeatures(monaco: MonacoNs): void {
  registerCodeActionCommand(monaco);
  for (const lang of LANGS) {
    registerCompletion(monaco, lang);
    registerSignatureHelp(monaco, lang);
    registerRename(monaco, lang);
    registerCodeActions(monaco, lang);
  }
  void pathToUri; // kept for symmetry with other call sites
}
