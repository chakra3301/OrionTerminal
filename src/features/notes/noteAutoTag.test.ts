import { describe, expect, it } from "vitest";
import { parseTags } from "./noteAutoTag";

describe("parseTags", () => {
  it("splits a comma list and lowercases", () => {
    expect(parseTags("Design, Research, AI")).toEqual(["design", "research", "ai"]);
  });

  it("strips a leading 'Tags:' label and #", () => {
    expect(parseTags("Tags: #work, #planning")).toEqual(["work", "planning"]);
  });

  it("handles newline-separated output", () => {
    expect(parseTags("alpha\nbeta\ngamma")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("caps at five tags", () => {
    expect(parseTags("a,b,c,d,e,f,g")).toHaveLength(5);
  });

  it("drops empty + over-long + multi-space junk", () => {
    expect(parseTags("ok, , this is a really long phrase that should be dropped because length")).toEqual(["ok"]);
  });

  it("trims trailing punctuation", () => {
    expect(parseTags("design., research;")).toEqual(["design", "research"]);
  });
});
