import { describe, expect, it } from "vitest";
import { matchTrigger } from "@/lib/wakePhrase";

describe("matchTrigger", () => {
  it("matches a bare trigger with empty remainder", () => {
    expect(matchTrigger("rosie")).toEqual({ remainder: "" });
    expect(matchTrigger("jarvis")).toEqual({ remainder: "" });
  });

  it("extracts the command after the trigger", () => {
    expect(matchTrigger("rosie open archives")).toEqual({
      remainder: "open archives",
    });
    // Remainder is lowercased — the real flow lowercases the transcript
    // before matching, and command case doesn't matter to the agent.
    expect(matchTrigger("hey rosie what notes do I have")).toEqual({
      remainder: "what notes do i have",
    });
  });

  it("is case-insensitive", () => {
    expect(matchTrigger("ROSIE open the terminal")).toEqual({
      remainder: "open the terminal",
    });
  });

  it("tolerates leading non-letters + punctuation after the trigger", () => {
    expect(matchTrigger("…rosie, open archives")).toEqual({
      remainder: "open archives",
    });
    expect(matchTrigger("Rosie. make a note")).toEqual({
      remainder: "make a note",
    });
  });

  it("accepts phonetic spellings Whisper emits", () => {
    expect(matchTrigger("rosy open it")).toEqual({ remainder: "open it" });
    expect(matchTrigger("rosey hello")).toEqual({ remainder: "hello" });
  });

  it("returns null when there is no trigger", () => {
    expect(matchTrigger("open archives")).toBeNull();
    expect(matchTrigger("the rose is red")).toBeNull(); // 'rose' ≠ a trigger
    expect(matchTrigger("")).toBeNull();
  });

  it("does not match a trigger that appears mid-sentence", () => {
    // Only opening-position triggers count — ambient chatter that merely
    // mentions the name shouldn't fire.
    expect(matchTrigger("tell rosie hello")).toBeNull();
  });
});
