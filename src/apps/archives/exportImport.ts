import { save, open } from "@tauri-apps/plugin-dialog";
import { ipc } from "@/lib/ipc";
import { useNotesStore, type Note, type NoteKind } from "@/store/notesStore";
import { log } from "@/lib/log";

// ── BlockNote document → Markdown ──────────────────────────────────────
// Lightweight, dependency-free serializer. Covers the common block types;
// anything exotic degrades to its plain text on its own line.

type Block = {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
};

function inlineText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content) {
    if (node == null) continue;
    if (typeof node === "string") {
      out += node;
      continue;
    }
    if (typeof node !== "object") continue;
    const n = node as { type?: string; text?: string; content?: unknown };
    if (n.type === "hardBreak" || n.type === "lineBreak") out += "\n";
    else if (typeof n.text === "string") out += n.text;
    else if (n.content !== undefined) out += inlineText(n.content);
  }
  return out;
}

function blockToMarkdown(block: Block, depth: number): string[] {
  if (!block || typeof block !== "object") return [];
  const indent = "  ".repeat(depth);
  const text = inlineText(block.content);
  const lines: string[] = [];
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1)));
      lines.push(`${"#".repeat(level)} ${text}`);
      break;
    }
    case "bulletListItem":
      lines.push(`${indent}- ${text}`);
      break;
    case "numberedListItem":
      lines.push(`${indent}1. ${text}`);
      break;
    case "checkListItem": {
      const done = block.props?.checked ? "x" : " ";
      lines.push(`${indent}- [${done}] ${text}`);
      break;
    }
    case "quote":
      lines.push(`> ${text}`);
      break;
    case "codeBlock":
      lines.push("```", text, "```");
      break;
    default:
      if (text) lines.push(`${indent}${text}`);
      else lines.push("");
      break;
  }
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      lines.push(...blockToMarkdown(child as Block, depth + 1));
    }
  }
  return lines;
}

export function noteToMarkdown(note: Note): string {
  const lines: string[] = [];
  if (note.title.trim()) lines.push(`# ${note.title.trim()}`, "");
  if (Array.isArray(note.blocks)) {
    for (const block of note.blocks) {
      lines.push(...blockToMarkdown(block as Block, 0));
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function safeFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\/\\:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "Untitled"
  );
}

// ── Export ─────────────────────────────────────────────────────────────

/** Save a single note as a `.md` file (native save dialog). */
export async function exportNoteAsMarkdown(note: Note): Promise<void> {
  const path = await save({
    title: "Export note as Markdown",
    defaultPath: `${safeFileName(note.title || "Untitled")}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return;
  await ipc.saveFileAtomic(path, noteToMarkdown(note));
}

/** Save a full JSON backup of every note in the archive. */
export async function exportArchiveBackup(notes: Note[]): Promise<void> {
  const path = await save({
    title: "Export Archives backup",
    defaultPath: `archives-backup-${dateStamp()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      kind: n.kind,
      blocks: n.blocks,
      plaintext: n.plaintext,
      location: n.location,
      tags: n.tags,
      favorite: n.favorite,
      parentId: n.parentId,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  };
  await ipc.saveFileAtomic(path, JSON.stringify(payload, null, 2));
}

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Import ─────────────────────────────────────────────────────────────

/**
 * Import one or more `.md` / `.txt` files as new notes. Each file's first `#`
 * heading (or its filename) becomes the title; the rest becomes the body as
 * paragraph blocks split on blank lines. Returns the ids of created notes.
 */
export async function importMarkdownFiles(
  kind: NoteKind = "note",
): Promise<string[]> {
  const selection = await open({
    title: "Import notes",
    multiple: true,
    filters: [{ name: "Text", extensions: ["md", "markdown", "txt"] }],
  });
  if (!selection) return [];
  const paths = Array.isArray(selection) ? selection : [selection];
  const store = useNotesStore.getState();
  const created: string[] = [];
  for (const path of paths) {
    try {
      const raw = await ipc.readFile(path);
      const { title, body } = parseMarkdown(raw, basename(path));
      const note = await store.create(null, kind);
      if (title) await store.saveTitle(note.id, title);
      await store.saveBlocks(note.id, body);
      created.push(note.id);
    } catch (e) {
      log.error("import failed", path, e);
    }
  }
  return created;
}

function basename(path: string): string {
  const seg = path.split(/[\/\\]/).pop() ?? path;
  return seg.replace(/\.(md|markdown|txt)$/i, "");
}

function parseMarkdown(
  raw: string,
  fallbackTitle: string,
): { title: string; body: unknown[] } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let title = fallbackTitle;
  let start = 0;
  // A leading "# Heading" becomes the title.
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmpty >= 0) {
    const h = lines[firstNonEmpty]!.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      title = h[1]!.trim();
      start = firstNonEmpty + 1;
    }
  }
  const rest = lines.slice(start).join("\n").trim();
  const paragraphs = rest.length > 0 ? rest.split(/\n{2,}/) : [];
  const blocks = paragraphs.map((p) => textToParagraphBlock(p.trim()));
  if (blocks.length === 0) blocks.push(textToParagraphBlock(""));
  return { title, body: blocks };
}

let blockSeq = 0;
function textToParagraphBlock(text: string): unknown {
  blockSeq += 1;
  return {
    id: `imp-${Date.now().toString(36)}-${blockSeq}`,
    type: "paragraph",
    props: {},
    content: text ? [{ type: "text", text, styles: {} }] : [],
    children: [],
  };
}
