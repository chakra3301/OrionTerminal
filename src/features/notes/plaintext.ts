// Walk a BlockNote document JSON and concatenate visible text.
// The output is what feeds the FTS5 `body` column for notes — must run on
// every save before the row hits the DB. Never call from a SQLite trigger.

type InlineNode = {
  type?: string;
  text?: string;
  content?: unknown;
};

type Block = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
};

export type BlockNoteDocument = Block[];

export function walkBlocksToPlaintext(doc: unknown): string {
  if (!Array.isArray(doc)) return "";
  const lines: string[] = [];
  for (const block of doc) {
    walkBlock(block as Block, lines);
  }
  return lines
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n");
}

function walkBlock(block: Block, lines: string[]): void {
  if (!block || typeof block !== "object") return;
  const text = inlineToText(block.content);
  if (text) lines.push(text);
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      walkBlock(child as Block, lines);
    }
  }
}

function inlineToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content) {
    out += inlineNodeText(node);
  }
  return out;
}

function inlineNodeText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const n = node as InlineNode;
  if (n.type === "hardBreak" || n.type === "lineBreak") return "\n";
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (n.type === "link") return inlineToText(n.content);
  if (typeof n.text === "string") return n.text;
  if (n.content !== undefined) return inlineToText(n.content);
  return "";
}
