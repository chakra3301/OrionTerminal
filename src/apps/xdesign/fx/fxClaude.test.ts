import { describe, it, expect } from "vitest";
import { extractGlslBody } from "./fxClaude";

describe("extractGlslBody", () => {
  it("pulls a fenced glsl block", () => {
    const reply = "Here you go:\n```glsl\nvec4 fxMain(vec2 uv) { return vec4(1.0); }\n```\nEnjoy!";
    expect(extractGlslBody(reply)).toBe("vec4 fxMain(vec2 uv) { return vec4(1.0); }");
  });

  it("uses the LAST fence when several exist", () => {
    const reply =
      "```glsl\nvec4 fxMain(vec2 uv) { return vec4(0.0); }\n```\nrevised:\n```glsl\nvec4 fxMain(vec2 uv) { return vec4(1.0); }\n```";
    expect(extractGlslBody(reply)).toContain("vec4(1.0)");
  });

  it("accepts unfenced replies that define fxMain", () => {
    const reply = "vec4 fxMain(vec2 uv) { return texture(uTex, uv); }";
    expect(extractGlslBody(reply)).toBe(reply);
  });

  it("rejects replies without fxMain", () => {
    expect(extractGlslBody("sorry, I can't")).toBeNull();
    expect(extractGlslBody("```glsl\nfloat foo() { return 1.0; }\n```")).toBeNull();
  });
});
