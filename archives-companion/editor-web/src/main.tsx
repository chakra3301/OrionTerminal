import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import "./note-page.css";

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
  const [editable, setEditable] = useState(true);
  const editor = useCreateBlockNote();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Native injects the initial document once the editor signals it's ready.
  useEffect(() => {
    (window as any).archivesLoad = (json: string, ed: boolean) => {
      setEditable(!!ed);
      try {
        const blocks = JSON.parse(json);
        if (Array.isArray(blocks) && blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch {
        /* leave the empty default doc */
      }
    };
    postNative({ type: "ready" });
    return () => {
      delete (window as any).archivesLoad;
    };
  }, [editor]);

  // Debounced change → native (blocks JSON + derived plaintext).
  useEffect(() => {
    const off = editor.onChange(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const blocks = editor.document;
        postNative({
          type: "change",
          blocks: JSON.stringify(blocks),
          plaintext: walkBlocksToPlaintext(blocks),
        });
      }, 400);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (typeof off === "function") off();
    };
  }, [editor]);

  return <BlockNoteView editor={editor} editable={editable} theme="dark" />;
}

createRoot(document.getElementById("root")!).render(<Editor />);
