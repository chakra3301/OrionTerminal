import { describe, it, expect } from "vitest";
import { detectPlatform } from "./detect";

describe("detectPlatform", () => {
  it("github url", () => {
    expect(detectPlatform("https://github.com/facebook/react")).toEqual({
      platform: "github",
      repoId: "facebook/react",
    });
  });
  it("github url with extra path", () => {
    expect(detectPlatform("https://github.com/facebook/react/tree/main/packages")).toEqual({
      platform: "github",
      repoId: "facebook/react",
    });
  });
  it("bare owner/repo assumed github", () => {
    expect(detectPlatform("facebook/react")).toEqual({ platform: "github", repoId: "facebook/react" });
  });
  it("strips a trailing .git from clone URLs and bare ids", () => {
    expect(detectPlatform("https://github.com/addyosmani/agent-skills.git")).toEqual({
      platform: "github",
      repoId: "addyosmani/agent-skills",
    });
    expect(detectPlatform("addyosmani/agent-skills.git")).toEqual({
      platform: "github",
      repoId: "addyosmani/agent-skills",
    });
  });
  it("npm package", () => {
    expect(detectPlatform("https://www.npmjs.com/package/zustand")).toEqual({
      platform: "npm",
      repoId: "zustand",
    });
  });
  it("pypi project", () => {
    expect(detectPlatform("https://pypi.org/project/requests/")).toEqual({
      platform: "pypi",
      repoId: "requests",
    });
  });
  it("gitlab project", () => {
    expect(detectPlatform("https://gitlab.com/gitlab-org/gitlab")).toEqual({
      platform: "gitlab",
      repoId: "gitlab-org/gitlab",
    });
  });
  it("junk returns null", () => {
    expect(detectPlatform("not a url")).toBeNull();
    expect(detectPlatform("https://example.com/x")).toBeNull();
  });
});
