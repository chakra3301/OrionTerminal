import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import type { PartialBlock } from "@blocknote/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useNotesStore } from "@/store/notesStore";
import { useAssetsStore } from "@/store/assetsStore";
import { handleOrionUri, isOrionUri } from "@/lib/orionProtocol";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import {
  registerNoteEditor,
  unregisterNoteEditor,
} from "@/features/notes/editorBridge";
import { log } from "@/lib/log";

const AUTOSAVE_MS = 500;

function TitleInput({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder="Untitled"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="note-editor-title"
      data-orion-note-title
    />
  );
}

function EditorBody({
  noteId,
  initialBlocks,
  onFirstBackspace,
}: {
  noteId: string;
  initialBlocks: unknown[];
  onFirstBackspace: () => void;
}) {
  const saveBlocks = useNotesStore((s) => s.saveBlocks);

  const initialContent = useMemo(() => {
    if (Array.isArray(initialBlocks) && initialBlocks.length > 0) {
      return initialBlocks as PartialBlock[];
    }
    return undefined;
  }, [initialBlocks]);

  const editor = useCreateBlockNote({ initialContent });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = editor.onChange(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveBlocks(noteId, editor.document as unknown[]);
      }, AUTOSAVE_MS);
    });
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Flush pending edits on unmount so switching notes never drops keystrokes.
      void saveBlocks(noteId, editor.document as unknown[]);
      off?.();
    };
  }, [editor, noteId, saveBlocks]);

  useEffect(() => {
    registerNoteEditor(noteId, {
      insertLink: (href, text) => {
        editor.focus();
        editor.insertInlineContent([
          { type: "link", href, content: [{ type: "text", text, styles: {} }] },
        ]);
      },
      focus: () => editor.focus(),
    });
    return () => unregisterNoteEditor(noteId);
  }, [editor, noteId]);

  // Capture clicks on links rendered by the editor; route orion:// through
  // the in-app handler instead of letting them open externally.
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (isOrionUri(href)) {
      e.preventDefault();
      e.stopPropagation();
      const ok = handleOrionUri(href);
      if (!ok) log.warn("orion:// URI not handled:", href);
    }
  };

  // Backspace at document start → bubble up to title input. ProseMirror
  // swallows the event when content is non-empty, so this only fires at
  // column 0 of the first block when the doc is otherwise empty.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Backspace") return;
    const sel = editor.getTextCursorPosition();
    const first = editor.document[0];
    if (!first || sel.block.id !== first.id) return;
    // Only fire backspace-bubble if first block is empty
    const isEmpty = !first.content || (Array.isArray(first.content) && first.content.length === 0);
    if (isEmpty) {
      e.preventDefault();
      onFirstBackspace();
    }
  };

  // Asset drop: drag an Archives image/asset onto the body → insert as a
  // block at the cursor. Images become inline image blocks; other kinds
  // become a paragraph with an asset:// link so the filename is clickable.
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    const path = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!path) return;
    // Look up the asset by path so we know its kind + title.
    const asset = Array.from(useAssetsStore.getState().assets.values()).find(
      (a) => a.filePath === path,
    );
    const url = convertFileSrc(path);
    const cursor = editor.getTextCursorPosition();
    const targetId = cursor.block.id;
    if (asset?.kind === "image") {
      editor.insertBlocks(
        [
          {
            type: "image",
            props: { url, caption: asset.title || "" },
          } as PartialBlock,
        ],
        targetId,
        "after",
      );
    } else {
      const text = asset?.title || path.split(/[\\/]/).pop() || path;
      editor.insertBlocks(
        [
          {
            type: "paragraph",
            content: [
              { type: "link", href: url, content: [{ type: "text", text, styles: {} }] },
            ],
          } as PartialBlock,
        ],
        targetId,
        "after",
      );
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div
      className="note-editor-body"
      onClickCapture={onClickCapture}
      onKeyDownCapture={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <BlockNoteView editor={editor} theme="dark" />
    </div>
  );
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const note = useNotesStore((s) => s.notes.get(noteId));
  const saveTitle = useNotesStore((s) => s.saveTitle);
  const [titleDraft, setTitleDraft] = useState<string>(note?.title ?? "");
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(note?.title ?? "");
  }, [noteId, note?.title]);

  const onTitleChange = (v: string) => {
    setTitleDraft(v);
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => {
      void saveTitle(noteId, v);
    }, AUTOSAVE_MS);
  };

  const focusEditor = () => {
    const root = editorContainerRef.current;
    if (!root) return;
    const editable = root.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    );
    editable?.focus();
  };

  const focusTitle = () => {
    const input = document.querySelector<HTMLInputElement>(
      "input[data-orion-note-title]",
    );
    input?.focus();
  };

  if (!note) {
    return (
      <div className="note-editor-loading">Loading note…</div>
    );
  }

  return (
    <div className="note-editor-root">
      <TitleInput
        value={titleDraft}
        onChange={onTitleChange}
        onEnter={focusEditor}
      />
      <div ref={editorContainerRef} className="note-editor-container">
        <EditorBody
          noteId={note.id}
          initialBlocks={note.blocks}
          onFirstBackspace={focusTitle}
        />
      </div>
    </div>
  );
}
