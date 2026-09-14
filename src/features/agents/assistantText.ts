export type AssistantTextEvent = {
  type: string;
  textMode?: "snapshot" | "delta";
  message?: { id?: string; content?: Array<{ type?: string; text?: string }> };
};

export function assistantTextFromEvent(event: AssistantTextEvent): string {
  if (event.type !== "assistant" || !Array.isArray(event.message?.content)) return "";
  return event.message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

// Legacy connectors without an explicit text mode may emit either chunks or snapshots.
export function mergeAssistantText(previous: string, next: string): string {
  if (!next) return previous;
  if (!previous || next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;
  return previous + next;
}

export class AssistantTextAccumulator {
  private parts = new Map<string, string>();
  private length = 0;

  accept(event: AssistantTextEvent): string | null {
    const text = assistantTextFromEvent(event);
    if (!text) return null;
    const id = typeof event.message?.id === "string" ? event.message.id : "";
    if (id.length > 512) throw new Error("Assistant message identity exceeded the response limit.");
    const previous = this.parts.get(id) ?? "";
    const next = event.textMode === "snapshot" ? text
      : event.textMode === "delta" ? previous + text
      : mergeAssistantText(previous, text);
    const length = this.length - previous.length + next.length;
    const count = this.parts.size + (this.parts.has(id) ? 0 : 1);
    if (length + Math.max(0, count - 1) * 2 > 128_000 || count > 512) {
      throw new Error("Assistant output exceeded the response limit.");
    }
    this.length = length;
    this.parts.set(id, next);
    return [...this.parts.values()].join("\n\n");
  }
}
