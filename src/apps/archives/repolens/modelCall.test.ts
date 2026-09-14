import { describe, expect, it } from "vitest";
import { assistantTextFromEvent, mergeAssistantText } from "./modelCall";

describe("RepoLens provider event text", () => {
  it("extracts text blocks from the shared Claude event contract", () => {
    expect(
      assistantTextFromEvent({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "first" },
            { type: "tool_use" },
            { type: "text", text: " second" },
          ],
        },
      }),
    ).toBe("first second");
  });

  it("handles both accumulated snapshots and streamed chunks", () => {
    expect(mergeAssistantText("hel", "hello")).toBe("hello");
    expect(mergeAssistantText("hello", " world")).toBe("hello world");
  });
});
