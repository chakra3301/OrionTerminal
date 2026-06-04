import { describe, expect, it } from "vitest";
import { safeMcpName } from "@/lib/mcpName";

describe("safeMcpName", () => {
  it("lowercases", () => {
    expect(safeMcpName("Linear")).toBe("linear");
  });

  it("collapses non-alphanumerics to single underscores", () => {
    expect(safeMcpName("my server!!")).toBe("my_server");
    expect(safeMcpName("git hub  api")).toBe("git_hub_api");
  });

  it("trims leading/trailing underscores", () => {
    expect(safeMcpName("  @scope/server  ")).toBe("scope_server");
    expect(safeMcpName("---x---")).toBe("x");
  });

  it("preserves existing underscores + digits", () => {
    expect(safeMcpName("server_2")).toBe("server_2");
  });

  it("caps length at 40", () => {
    expect(safeMcpName("a".repeat(80)).length).toBe(40);
  });

  it("returns empty string for all-symbol input (caller falls back)", () => {
    expect(safeMcpName("!!!")).toBe("");
    expect(safeMcpName("")).toBe("");
  });
});
