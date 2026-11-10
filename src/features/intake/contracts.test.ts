import { describe, expect, it } from "vitest";
import { parseCandidate, parseCandidates, parseDiscovery, packagePath, repositoryUrl } from "./contracts";
import { candidateFixture, discoveryFixture } from "./testFixture";
describe("Intake v1 untrusted boundary", () => {
  it.each(["https://github.com/a/b?token=secret", "https://github.com@localhost/a/b", "https://github.com/a/../b", "https://github.com/a/b/tree/main", "https://github.com/a/%2e%2e", "https://gitlab.com/a/b", "file:///tmp/skill", "https://github.com/a/.."])('rejects repository link %s', (url) => expect(() => repositoryUrl(url)).toThrow());
  it("accepts repo roots and validates additive pinned provenance without breaking local snapshots", () => {
    expect(repositoryUrl(" https://github.com/Leonxlnx/taste-skill.git ")).toBe("https://github.com/Leonxlnx/taste-skill.git");
    const repository = { url: "https://github.com/a/b", requestedRef: "HEAD", commit: "a".repeat(40), tree: "b".repeat(40) };
    expect(parseCandidate({ ...candidateFixture, repository }).repository).toEqual(repository);
    expect(parseCandidate(candidateFixture).repository).toBeUndefined();
    expect(() => parseCandidate({ ...candidateFixture, repository: { ...repository, commit: "main" } })).toThrow();
    expect(() => parseCandidate({ ...candidateFixture, repository: { ...repository, approved: true } })).toThrow();
  });
  it("preserves tool requests as text without creating grants", () => {
    const c = parseCandidate(candidateFixture);
    expect(c.metadata.allowedTools).toBe("Bash"); expect(c).not.toHaveProperty("grantedTools");
    expect(parseDiscovery(discoveryFixture)).toEqual(discoveryFixture);
  });
  it.each(["../a", "/etc/passwd", "C:\\secret", "a//b", "a/./b", "a/é", "a\0b", "a/b."])("rejects unsafe path %s", (path) => expect(() => packagePath(path)).toThrow());
  it.each([{ schemaVersion: 2 }, { approved: true }, { grantedTools: ["Bash"] }, { files: [] }, { totalBytes: 1 }, { sourceHash: "not-a-hash" }])("rejects malformed candidate %j", (extra) => expect(() => parseCandidate({ ...candidateFixture, ...extra })).toThrow());
  it("rejects duplicate files and nested authority", () => {
    expect(() => parseCandidate({ ...candidateFixture, files: [candidateFixture.files[0], candidateFixture.files[0]], totalBytes: 24 })).toThrow();
    expect(() => parseCandidate({ ...candidateFixture, metadata: { ...candidateFixture.metadata, verified: true } })).toThrow();
    expect(() => parseCandidates(Array(5).fill(candidateFixture))).toThrow();
  });
});
