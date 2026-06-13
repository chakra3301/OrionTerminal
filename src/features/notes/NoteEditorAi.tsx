import { useState } from "react";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { Sparkles, Wand2, PenLine, FileText } from "lucide-react";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { toast } from "@/store/toastStore";
import { useNotesStore } from "@/store/notesStore";
import { formatOrionUri } from "@/lib/orionProtocol";
import {
  buildSelectionPrompt,
  buildContinuePrompt,
  buildSummarizeNotePrompt,
  runOneshot,
  parseBullets,
  SELECTION_ACTION_LABELS,
  type SelectionAction,
} from "@/features/notes/noteInlineAi";
import { log } from "@/lib/log";

// BlockNote's editor is heavily generic; we only call a handful of methods.
type Editor = BlockNoteEditor<any, any, any>;

const ACTIONS: SelectionAction[] = ["improve", "fix", "shorter", "longer", "summarize"];

/** "✨ AI" button injected into the formatting toolbar — rewrites the current
 * selection in place using the subscription CLI. A plain styled button (the
 * toolbar accepts arbitrary children) to stay version-agnostic. */
function AiToolbarButton({ editor }: { editor: Editor }) {
  const { openFromButton, menu } = useContextMenu();
  const [busy, setBusy] = useState(false);

  const runAction = async (action: SelectionAction) => {
    const text = editor.getSelectedText();
    if (!text?.trim()) return;
    setBusy(true);
    try {
      const result = await runOneshot(buildSelectionPrompt(action, text));
      if (result) {
        // insertInlineContent replaces the active selection.
        editor.insertInlineContent([{ type: "text", text: result, styles: {} }]);
      }
    } catch (e) {
      log.error("inline ai failed", e);
      toast.error("AI edit failed", {
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    const items: MenuItem[] = ACTIONS.map((a) => ({
      label: SELECTION_ACTION_LABELS[a],
      icon: <Wand2 size={13} />,
      onClick: () => void runAction(a),
    }));
    openFromButton(e.currentTarget, items);
  };

  return (
    <>
      <button
        type="button"
        className="bn-ai-btn"
        title={busy ? "Working…" : "AI actions"}
        onClick={onClick}
      >
        <Sparkles size={15} />
        <span>AI</span>
      </button>
      {menu}
    </>
  );
}

/** Slash-menu AI items: continue writing, summarize note. */
function aiSlashItems(editor: Editor): DefaultReactSuggestionItem[] {
  return [
    {
      title: "Continue writing",
      subtext: "Let AI extend from here",
      aliases: ["ai", "continue", "write"],
      group: "AI",
      icon: <PenLine size={16} />,
      onItemClick: () => {
        void (async () => {
          try {
            const preceding = editor.document
              .map((b: { content?: unknown }) =>
                Array.isArray(b.content)
                  ? b.content
                      .map((c: { text?: string }) => c.text ?? "")
                      .join("")
                  : "",
              )
              .join("\n");
            const result = await runOneshot(buildContinuePrompt(preceding));
            if (result) {
              editor.insertInlineContent([
                { type: "text", text: ` ${result}`, styles: {} },
              ]);
            }
          } catch (e) {
            log.error("continue writing failed", e);
            toast.error("AI continue failed");
          }
        })();
      },
    },
    {
      title: "Summarize note",
      subtext: "Insert a bullet summary",
      aliases: ["ai", "summary", "tldr"],
      group: "AI",
      icon: <Sparkles size={16} />,
      onItemClick: () => {
        void (async () => {
          try {
            const text = editor.document
              .map((b: { content?: unknown }) =>
                Array.isArray(b.content)
                  ? b.content.map((c: { text?: string }) => c.text ?? "").join("")
                  : "",
              )
              .join("\n");
            const reply = await runOneshot(buildSummarizeNotePrompt(text));
            const bullets = parseBullets(reply);
            if (bullets.length === 0) return;
            const pos = editor.getTextCursorPosition();
            editor.insertBlocks(
              bullets.map((b) => ({
                type: "bulletListItem",
                content: [{ type: "text", text: b, styles: {} }],
              })),
              pos.block.id,
              "after",
            );
          } catch (e) {
            log.error("summarize note failed", e);
            toast.error("AI summarize failed");
          }
        })();
      },
    },
  ];
}

/** `[[` wiki-link items — type `[[query` to link another note. BlockNote
 * removes the trigger `[` + query on select, so the second `[` (part of the
 * query) is stripped here and removed by the menu. */
function wikiLinkItems(editor: Editor, query: string, excludeId: string): DefaultReactSuggestionItem[] {
  const q = query.replace(/^\[/, "").trim().toLowerCase();
  const notes = [...useNotesStore.getState().notes.values()]
    .filter((n) => n.id !== excludeId && (n.title || n.plaintext).trim())
    .map((n) => ({ id: n.id, title: n.title || "Untitled" }))
    .filter((n) => (q ? n.title.toLowerCase().includes(q) : true))
    .slice(0, 12);
  return notes.map((n) => ({
    title: n.title,
    group: "Link a note",
    icon: <FileText size={16} />,
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: "link",
          href: formatOrionUri({ kind: "note", id: n.id }),
          content: [{ type: "text", text: n.title, styles: {} }],
        },
        { type: "text", text: " ", styles: {} },
      ]);
    },
  }));
}

/** Drop-in controllers that add AI + wiki-linking to a BlockNoteView. Render
 * as children of <BlockNoteView formattingToolbar={false} slashMenu={false}>. */
export function NoteAiControllers({ editor, noteId }: { editor: Editor; noteId: string }) {
  return (
    <>
      <FormattingToolbarController
        formattingToolbar={() => (
          <FormattingToolbar>
            {...getFormattingToolbarItems()}
            <AiToolbarButton key="ai" editor={editor} />
          </FormattingToolbar>
        )}
      />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query: string) => {
          const def = getDefaultReactSlashMenuItems(editor);
          const ai = aiSlashItems(editor);
          const all = [...ai, ...def];
          const q = query.toLowerCase();
          return q
            ? all.filter(
                (i) =>
                  i.title.toLowerCase().includes(q) ||
                  i.aliases?.some((a) => a.toLowerCase().includes(q)),
              )
            : all;
        }}
      />
      <SuggestionMenuController
        triggerCharacter="["
        getItems={async (query: string) => wikiLinkItems(editor, query, noteId)}
      />
    </>
  );
}
