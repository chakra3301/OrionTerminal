import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import "./note-page.css";
import { noteSchema } from "./noteSchema";

// --- plaintext walker: a 1:1 port of the desktop src/features/notes/plaintext.ts
// so the FTS `body`/`plaintext` produced on the phone matches the desktop exactly.
function inlineNodeText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  if (node.type === "hardBreak" || node.type === "lineBreak") return "\n";
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (node.type === "link") return inlineToText(node.content);
  if (typeof node.text === "string") return node.text;
  if (node.content !== undefined) return inlineToText(node.content);
  return "";
}
function inlineToText(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(inlineNodeText).join("");
}
function walkBlock(block: any, lines: string[]): void {
  if (!block || typeof block !== "object") return;
  const text = inlineToText(block.content);
  if (text) lines.push(text);
  if (Array.isArray(block.children)) for (const c of block.children) walkBlock(c, lines);
}
function walkBlocksToPlaintext(doc: any): string {
  if (!Array.isArray(doc)) return "";
  const lines: string[] = [];
  for (const b of doc) walkBlock(b, lines);
  return lines.map((s) => s.trim()).filter((s) => s.length > 0).join("\n");
}

function postNative(msg: unknown) {
  try {
    (window as any).webkit?.messageHandlers?.archives?.postMessage(msg);
  } catch {
    /* not running inside the app */
  }
}

function Editor() {
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState("");
  const editor = useCreateBlockNote({ schema: noteSchema });
  const loaded = useRef(false);
  const previous = useRef("");

  // Native injects the initial document once the editor signals it's ready.
  useEffect(() => {
    (window as any).archivesLoad = (json: string, ed: boolean) => {
      loaded.current = false;
      setEditable(false);
      try {
        const blocks = JSON.parse(json);
        const valid = (rows: any[]): boolean => Array.isArray(rows) && rows.every((block) =>
          block && typeof block === "object" && block.type in noteSchema.blockSchema &&
          (block.children === undefined || valid(block.children)));
        if (!valid(blocks)) throw new Error("This note contains blocks this mobile version cannot edit. Open it in Orion Terminal; the original is preserved.");
        editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph", content: [] }]);
        previous.current = JSON.stringify(editor.document);
        loaded.current = true;
        setEditable(!!ed);
        setError("");
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Couldn't safely load this note. Original content is preserved.";
        setError(message);
        postNative({ type: "error", message });
      }
    };
    postNative({ type: "ready" });
    return () => {
      delete (window as any).archivesLoad;
    };
  }, [editor]);

  useEffect(() => {
    const off = editor.onChange(() => {
      if (!loaded.current) return;
      const blocks = JSON.stringify(editor.document);
      if (blocks === previous.current) return;
      previous.current = blocks;
      // No trailing debounce: navigating away must not discard the last keystrokes.
      postNative({ type: "change", blocks, plaintext: walkBlocksToPlaintext(editor.document) });
    });
    return () => { if (typeof off === "function") off(); };
  }, [editor]);

  return error ? <div role="alert" style={{ padding: 24, color: "#ff3ea5" }}>{error}</div>
    : <BlockNoteView editor={editor} editable={editable} theme="dark" />;
}

createRoot(document.getElementById("root")!).render(<Editor />);
