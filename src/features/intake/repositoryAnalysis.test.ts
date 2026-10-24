import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reviewRepo: vi.fn() }));
vi.mock("./api", () => ({ intake: m }));
import { acquireRepositoryAnalysis, selectRepositoryDocuments } from "./repositoryAnalysis";
import { repositoryFixture, discoveryFixture } from "./testFixture";
import { parseDiscovery, parseRepositoryReview, parseCandidate } from "./contracts";
import { sha256 } from "@/features/repoAnalysis/sourceText";
beforeEach(() => vi.resetAllMocks());
it("accepts pinned document-only discovery, never as a skill candidate", async () => {
  const { discovery, packet } = await repositoryFixture(); m.reviewRepo.mockResolvedValue(packet);
  expect(parseDiscovery(discovery).entries).toEqual([]);
  expect(() => parseDiscovery({ ...discoveryFixture, entries: [] })).toThrow();
  expect(() => parseCandidate(packet)).toThrow();
  const source = await acquireRepositoryAnalysis(discovery, ["README.md"], "job");
  expect(source.scope).toBe("repository-documents"); expect(source.origin).toContain(discovery.repository!.commit);
  expect(source.excerpts[0]!.text).toBe(packet.files[0]!.text); expect(source.inventory).toHaveLength(1);
});
it("rejects unlisted/private paths and extra authority fields before acquisition", async () => {
  const { discovery, packet } = await repositoryFixture();
  await expect(acquireRepositoryAnalysis(discovery, [".env"], "job")).rejects.toThrow("offered");
  await expect(acquireRepositoryAnalysis(discovery, ["README.md", "README.md"], "job")).rejects.toThrow();
  expect(m.reviewRepo).not.toHaveBeenCalled();
  expect(() => parseDiscovery({ ...discovery, reviewFiles: [{ path: "../README.md", bytes: 2 }] })).toThrow();
  expect(() => parseRepositoryReview({ ...packet, installable: true })).toThrow();
});
it("rejects changed provenance, returned paths, counts and content hashes", async () => {
  const { discovery, packet } = await repositoryFixture();
  for (const returned of [
    { ...packet, repository: { ...packet.repository, commit: "c".repeat(40) } },
    { ...packet, files: [{ ...packet.files[0], path: "package.json" }] },
    { ...packet, files: [{ ...packet.files[0], bytes: 1 }] },
    { ...packet, files: [{ ...packet.files[0], sha256: "f".repeat(64) }] },
  ]) { m.reviewRepo.mockResolvedValueOnce(returned); await expect(acquireRepositoryAnalysis(discovery, ["README.md"], "job")).rejects.toThrow(); }
});
it("screens complete documents before truncation and preserves Unicode boundaries", async () => {
  const secret = await repositoryFixture(`${"x".repeat(8100)} sk-${"a".repeat(32)}`); m.reviewRepo.mockResolvedValueOnce(secret.packet);
  await expect(acquireRepositoryAnalysis(secret.discovery, ["README.md"], "job")).rejects.toThrow("credential");
  const unicode = await repositoryFixture(`${"x".repeat(7999)}🎯tail`); m.reviewRepo.mockResolvedValueOnce(unicode.packet);
  const source = await acquireRepositoryAnalysis(unicode.discovery, ["README.md"], "next");
  expect(source.excerpts[0]!.truncated).toBe(true); expect(source.excerpts[0]!.text).toHaveLength(7999);
});
it("extracts full-file declarations but excludes them when a document is deselected", async () => {
  const { discovery, packet } = await repositoryFixture();
  const text = JSON.stringify({ description: "x".repeat(9000), engines: { node: "PRIVATE-RUNTIME-MARKER" } });
  const file = { path: "package.json", bytes: text.length, sha256: await sha256(text), text };
  discovery.reviewFiles!.push({ path: file.path, bytes: file.bytes }); packet.files.push(file);
  m.reviewRepo.mockResolvedValue(packet);
  const source = await acquireRepositoryAnalysis(discovery, ["README.md", "package.json"], "job");
  expect(source.excerpts.find((f) => f.path === "package.json")!.text).not.toContain("PRIVATE-RUNTIME-MARKER");
  expect(source.declarations!.find((f) => f.path === "package.json")!.declarations[0]!.value).toBe("PRIVATE-RUNTIME-MARKER");
  const selected = selectRepositoryDocuments(source, ["README.md"]);
  expect(JSON.stringify(selected)).not.toContain("PRIVATE-RUNTIME-MARKER"); expect(selected.declarations).toHaveLength(1);
  expect(() => selectRepositoryDocuments(source, ["missing"])).toThrow();
});
it("captures the reviewed discovery before asynchronous acquisition", async () => {
  const { discovery, packet } = await repositoryFixture();
  m.reviewRepo.mockImplementation(async () => { discovery.repository = { ...discovery.repository!, commit: "e".repeat(40) }; return packet; });
  const source = await acquireRepositoryAnalysis(discovery, ["README.md"], "job");
  expect(source.origin).toContain(packet.repository.commit);
});
