import { describe, expect, it } from "vitest";
import { AssistantTextAccumulator, type AssistantTextEvent } from "./assistantText";
const message = (id: string | undefined, text: string, textMode?: AssistantTextEvent["textMode"]): AssistantTextEvent => ({
  type: "assistant", textMode, message: { id, content: [{ type: "text", text }] },
});

describe("assistant text message boundaries", () => {
  it("separates commentary and final messages without losing either", () => {
    const stream = new AssistantTextAccumulator();
    expect(stream.accept(message("item_0", "I’ll inspect the scene.", "snapshot"))).toBe("I’ll inspect the scene.");
    expect(stream.accept(message("item_2", "ORION_OK", "snapshot"))).toBe("I’ll inspect the scene.\n\nORION_OK");
    expect(stream.accept(message("item_2", "ORION_OK", "snapshot"))).toBe("I’ll inspect the scene.\n\nORION_OK");
  });
  it("updates the original message in place rather than duplicating snapshots", () => {
    const stream = new AssistantTextAccumulator();
    stream.accept(message("first", "Checking", "snapshot"));
    stream.accept(message("second", "Done", "snapshot"));
    expect(stream.accept(message("first", "Checked.", "snapshot"))).toBe("Checked.\n\nDone");
  });
  it("preserves repeated explicit deltas and identical distinct messages", () => {
    const stream = new AssistantTextAccumulator();
    stream.accept(message("a", "ha", "delta"));
    expect(stream.accept(message("a", "ha", "delta"))).toBe("haha");
    expect(stream.accept(message("b", "haha", "snapshot"))).toBe("haha\n\nhaha");
  });
  it("keeps legacy chunk/snapshot behavior for unmarked streams", () => {
    const stream = new AssistantTextAccumulator();
    stream.accept(message(undefined, "hel"));
    stream.accept(message(undefined, "hello"));
    expect(stream.accept(message(undefined, " world"))).toBe("hello world");
  });
  it("ignores tool-only messages and non-assistant events", () => {
    const stream = new AssistantTextAccumulator();
    stream.accept(message("a", "Before"));
    expect(stream.accept({ type: "assistant", message: { id: "tool", content: [{ type: "tool_use" }] } })).toBeNull();
    expect(stream.accept({ type: "user", message: { content: [{ type: "text", text: "secret" }] } })).toBeNull();
    expect(stream.accept(message("b", "After"))).toBe("Before\n\nAfter");
  });
  it("fails visibly instead of truncating oversized output or retaining unlimited messages", () => {
    const stream = new AssistantTextAccumulator();
    expect(() => stream.accept(message("a", "x".repeat(128001)))).toThrow(/response limit/);
    for (let i = 0; i < 512; i++) stream.accept(message(String(i), "x"));
    expect(() => stream.accept(message("extra", "x"))).toThrow(/response limit/);
  });
});
