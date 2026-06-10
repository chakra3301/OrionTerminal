import { useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import type { PartialBlock } from "@blocknote/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useNotesStore } from "@/store/notesStore";
import { useAssetsStore, type Asset } from "@/store/assetsStore";
import { handleOrionUri, isOrionUri } from "@/lib/orionProtocol";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import { useFileDropZone } from "@/lib/fileDrop";
import {
  registerNoteEditor,
  unregisterNoteEditor,
} from "@/features/notes/editorBridge";
import { log } from "@/lib/log";

/** A stored asset → the BlockNote block to insert for it. */
function blockForAsset(asset: Asset): PartialBlock {
  const url = convertFileSrc(asset.filePath);
  if (asset.kind === "image") {
    return {
      type: "image",
      props: { url, caption: asset.title || "" },
    } as PartialBlock;
  }
  const text = asset.title || asset.filePath.split(/[\\/]/).pop() || asset.filePath;
  return {
    type: "paragraph",
    content: [
      { type: "link", href: url, content: [{ type: "text", text, styles: {} }] },
    ],
  } as PartialBlock;
}

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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dropping, setDropping] = useState(false);
  // Unique zone name per mount so two views of the same note route correctly.
  const dropZone = useMemo(() => `note-drop-${ulid()}`, []);

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

  // Insert blocks for already-stored assets after the cursor block.
  const insertAssetBlocks = (assets: Asset[]) => {
    if (assets.length === 0) return;
    const blocks = assets.map(blockForAsset);
    const cursor = editor.getTextCursorPosition();
    const targetId =
      cursor?.block?.id ?? editor.document[editor.document.length - 1]?.id;
    if (!targetId) return;
    editor.insertBlocks(blocks, targetId, "after");
  };

  // In-app asset drag (drag an Archives image/asset onto the body via DOM
  // drag). Images become image blocks; other kinds a clickable asset link.
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    const path = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!path) return;
    const asset = Array.from(useAssetsStore.getState().assets.values()).find(
      (a) => a.filePath === path,
    );
    if (asset) insertAssetBlocks([asset]);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  // Native Finder drop: Tauri intercepts OS file drags before DOM events, so
  // they arrive through the drop orchestrator. This zone sits inside the
  // app-wide "archives" zone and wins for drops on the editor — ingest each
  // file as an asset, then drop it in as a block where the cursor is.
  useFileDropZone(bodyRef, dropZone, (ev) => {
    if (ev.type === "enter") setDropping(true);
    else if (ev.type === "leave") setDropping(false);
    else {
      setDropping(false);
      if (ev.paths.length === 0) return;
      void (async () => {
        try {
          const created = await useAssetsStore.getState().ingestPaths(ev.paths);
          editor.focus();
          insertAssetBlocks(created);
        } catch (err) {
          log.error("note image drop failed", err);
        }
      })();
    }
  });

  return (
    <div
      ref={bodyRef}
      className={`note-editor-body${dropping ? " dropping" : ""}`}
      onClickCapture={onClickCapture}
      onKeyDownCapture={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <BlockNoteView editor={editor} theme="dark" />
      {dropping && (
        <div className="note-drop-overlay">Drop to add to this note</div>
      )}
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
