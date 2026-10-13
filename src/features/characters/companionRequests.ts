import type { RosieMessage } from "@/features/rosie/rosieStore";

export type CompanionRequestState = {
  threadId: string;
  running: boolean;
  error: string | null;
  messages: RosieMessage[];
};

function textOf(message: RosieMessage | undefined) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  // Earlier tool-loop text may describe an error that the final response has already resolved.
  return message.content.flatMap((block) => block.type === "text" && "text" in block && typeof block.text === "string" ? [block.text] : []).at(-1)?.trim() ?? "";
}

export class CompanionRequestReactions {
  private thread: string;
  private running: boolean;
  private error: string | null;
  constructor(state: CompanionRequestState) {
    this.thread = state.threadId;
    this.running = state.running;
    this.error = state.error;
  }

  observe(state: CompanionRequestState) {
    const reactions: string[] = [];
    if (state.threadId === this.thread) {
      if (state.running && !this.running) reactions.push("Kneeling Pointing");
      if (state.error && state.error !== this.error) reactions.push("Angry", "Rejected");
      if (this.running && !state.running && !state.error) {
        const message = [...state.messages].reverse().find((message) => message.role === "assistant");
        const text = textOf(message);
        // Cancellation leaves the message pending; loading an old thread is not a new completion.
        if (message && !message.pending && text) {
          if (/\b(?:permission|request|access|approval) (?:was |is )?denied\b|\bi (?:can't|cannot|won't|will not) (?:help with|assist with|fulfill|comply with|do that)\b/i.test(text)) reactions.push("Rejected");
          else if (/\?\s*$|\b(?:please (?:confirm|choose|provide|select)|(?:need|waiting for) your (?:input|confirmation|approval))\b/i.test(text)) reactions.push("Surprised");
          else reactions.push("Clapping");
        }
      }
    }
    this.thread = state.threadId;
    this.running = state.running;
    this.error = state.error;
    return reactions;
  }
}
