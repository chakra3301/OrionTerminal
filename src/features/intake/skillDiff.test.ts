import { expect, it } from "vitest";
import { sameSkillSource, skillDiff } from "./skillDiff";
import { candidateFixture as c } from "./testFixture";
it("diffs additions, removals, bytes, modes, kinds and attribution without reading contents", () => {
  const after = structuredClone(c);
  after.files[0]!.sha256 = "f".repeat(64); after.files.pop();
  after.files.push({ ...c.files[0]!, path: "example/LICENSE", kind: "attribution" });
  const diff = skillDiff(c, after);
  expect(diff.changes.map((f) => [f.path, f.change])).toEqual([["example/DESIGN.md", "removed"], ["example/LICENSE", "added"], ["example/SKILL.md", "changed"]]);
  expect(diff.changes[1]!.attribution).toBe(true);
  for (const patch of [{ sourceMode: 0o100755 }, { kind: "opaque" as const }, { sourcePath: "other.md" }, { bytes: 999 }]) expect(skillDiff(c, { ...c, files: [{ ...c.files[0]!, ...patch }, c.files[1]!] }).changes).toHaveLength(1);
});
it("detects metadata and tool request changes even with identical file inventories", () => {
  expect(skillDiff(c, c).changes).toEqual([]);
  expect(skillDiff(c, { ...c, metadata: { ...c.metadata, metadata: { b: "2", a: "1" } } }).metadataChanged).toBe(true);
  expect(skillDiff({ ...c, metadata: { ...c.metadata, metadata: { a: "1", b: "2" } } }, { ...c, metadata: { ...c.metadata, metadata: { b: "2", a: "1" } } }).metadataChanged).toBe(false);
  const diff = skillDiff(c, { ...c, metadata: { ...c.metadata, allowedTools: "Different request" } });
  expect(diff.toolRequestsChanged).toBe(true); expect(diff.metadataChanged).toBe(true);
});
it("source matching follows native rules, not just a declared skill name", () => {
  expect(sameSkillSource(c, c)).toBe(true);
  expect(sameSkillSource(c, { ...c, sourceLabel: "different" })).toBe(false);
  expect(sameSkillSource(c, { ...c, entrypoint: "other/SKILL.md" })).toBe(false);
  const repo = { url: "https://github.com/a/b", owner: "a", name: "b", requestedRef: "HEAD", commit: "a".repeat(40), tree: "b".repeat(40) };
  const a = { ...c, repository: repo };
  expect(sameSkillSource(a, { ...a, repository: { ...repo, commit: "c".repeat(40) } })).toBe(true);
  expect(sameSkillSource(a, { ...a, repository: { ...repo, url: "https://github.com/a/c" } })).toBe(false);
  expect(sameSkillSource(c, a)).toBe(false);
});
