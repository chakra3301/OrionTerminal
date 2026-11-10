import { intake } from "./api";
import { parseDiscovery, parseRepositoryReview, type IntakeDiscovery } from "./contracts";
import { assertShareable, sanitizeReadme, sha256 } from "@/features/repoAnalysis/sourceText";
import { parseAnalysisSource, type AnalysisSource } from "@/features/repoAnalysis/contracts";
import { inspectDeclarations, parseDeclarations } from "@/features/repoAnalysis/declarations";

export function selectRepositoryDocuments(value: AnalysisSource, paths: string[]): AnalysisSource {
  const source = parseAnalysisSource(value);
  if (source.scope !== "repository-documents" || !paths.length || paths.length > 4 || new Set(paths).size !== paths.length || paths.some((p) => !source.excerpts.some((f) => f.path === p))) throw new Error("Select available repository documents");
  return { ...source, excerpts: source.excerpts.filter((f) => paths.includes(f.path)), ...(source.declarations ? { declarations: source.declarations.filter((f) => paths.includes(f.path)) } : {}) };
}
export async function acquireRepositoryAnalysis(discovery: IntakeDiscovery, selected: string[], jobId: string): Promise<AnalysisSource> {
  const source = parseDiscovery(structuredClone(discovery)), paths = [...selected];
  if (!source.repository || !paths.length || paths.length > 4 || new Set(paths).size !== paths.length || paths.some((p) => !source.reviewFiles?.some((f) => f.path === p))) throw new Error("Select one to four offered repository documents.");
  const packet = parseRepositoryReview(await intake.reviewRepo(source.id, paths, jobId));
  if (JSON.stringify(packet.repository) !== JSON.stringify(source.repository) || packet.label !== source.label || packet.files.length !== paths.length || packet.files.some((f) => !paths.includes(f.path) || !source.reviewFiles?.some((expected) => expected.path === f.path && expected.bytes === f.bytes))) throw new Error("Repository review identity changed; inspect again.");
  const excerpts: AnalysisSource["excerpts"] = [];
  for (const file of packet.files) {
    if (await sha256(file.text) !== file.sha256) throw new Error("Repository document hash mismatch.");
    assertShareable(file.text);
    const text = sanitizeReadme(file.text.slice(0, 8000).replace(/[\uD800-\uDBFF]$/, ""));
    excerpts.push({ path: file.path, sha256: file.sha256, originalBytes: file.bytes, text, excerptHash: await sha256(text), truncated: file.text.length > 8000 });
  }
  const inventory = packet.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256, kind: "text" })).sort((a, b) => a.path.localeCompare(b.path));
  const hash = await sha256(JSON.stringify({ scope: "repository-documents", origin: packet.repository, inventory }));
  const declarations = parseDeclarations(packet.files.map(inspectDeclarations));
  return { declarations, scope: "repository-documents", id: packet.id, label: packet.label, origin: `${packet.repository.url}@${packet.repository.commit}`, sourceHash: hash, artifactHash: hash, inventory, excerpts };
}
