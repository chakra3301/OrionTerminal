import { sha256 } from "@/features/repoAnalysis/sourceText";
import type { IntakeCandidate, IntakeDiscovery, RepositoryReview } from "./contracts";
export const candidateFixture: IntakeCandidate = {
  schemaVersion: 1, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", sourceLabel: "fixture", entrypoint: "SKILL.md",
  sourceHash: "a".repeat(64), artifactHash: "b".repeat(64),
  metadata: { name: "example", description: "Local test skill", license: null, compatibility: null, allowedTools: "Bash", metadata: {} },
  files: [{ path: "example/SKILL.md", sourcePath: "SKILL.md", bytes: 12, sha256: "c".repeat(64), sourceMode: 0o100644, kind: "text" }, { path: "example/DESIGN.md", sourcePath: "DESIGN.md", bytes: 8, sha256: "d".repeat(64), sourceMode: 0o100644, kind: "text" }],
  totalBytes: 20, createdAt: 1, warnings: ["Scripts are inactive; no tools granted."],
};
export const discoveryFixture: IntakeDiscovery = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", label: "fixture", entries: [{ path: "SKILL.md" }], attributionFiles: ["LICENSE"] };
export async function repositoryFixture(body = "A data tool requiring a separately approved runtime."): Promise<{ discovery: IntakeDiscovery; packet: RepositoryReview }> {
  const repository = { url: "https://github.com/owner/repo", requestedRef: "HEAD", commit: "a".repeat(40), tree: "b".repeat(40) };
  const file = { path: "README.md", bytes: new TextEncoder().encode(body).length, sha256: await sha256(body), text: body };
  return {
    discovery: { ...discoveryFixture, entries: [], attributionFiles: [], repository, reviewFiles: [{ path: file.path, bytes: file.bytes }] },
    packet: { schemaVersion: 1, id: candidateFixture.id, label: discoveryFixture.label, repository, files: [file] },
  };
}
