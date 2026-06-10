import { describe, expect, it } from "vitest";
import { detectAtToken } from "./ClaudeChat";

describe("detectAtToken", () => {
  it("finds a bare @ at the start", () => {
    expect(detectAtToken("@", 1)).toEqual({ at: 0, query: "" });
  });

  it("captures the query up to the caret", () => {
    expect(detectAtToken("fix @main.ts please", 8)).toEqual({ at: 4, query: "mai" });
  });

  it("requires whitespace or opener before @", () => {
    expect(detectAtToken("luca@mail", 9)).toBeNull();
    expect(detectAtToken("(@notes", 7)).toEqual({ at: 1, query: "notes" });
  });

  it("ends the token at whitespace", () => {
    expect(detectAtToken("@file done", 10)).toBeNull();
  });

  it("ignores an @ after the caret", () => {
    expect(detectAtToken("hello @x", 5)).toBeNull();
  });
});
