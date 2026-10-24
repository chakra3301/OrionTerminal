import { intake } from "./api";
import { parseCandidate, type IntakeCandidate } from "./contracts";
import { assertShareable, sanitizeReadme, sha256 } from "@/features/repoAnalysis/sourceText";
import type { AnalysisSource } from "@/features/repoAnalysis/contracts";

export async function readAnalysisSource(candidate: IntakeCandidate, paths: string[], signal: AbortSignal): Promise<AnalysisSource> {
  const source = parseCandidate(structuredClone(candidate));
  const selected = [...paths];
  if (!selected.length || selected.length > 4 || new Set(selected).size !== selected.length) throw new Error("Choose one to four source files for analysis.");
  const excerpts: AnalysisSource["excerpts"] = [];
  for (const path of selected) {
    if (signal.aborted) throw new Error("Analysis preparation cancelled.");
    const file = source.files.find((f) => f.path === path);
    if (!file || file.kind === "opaque" || file.bytes > 256 * 1024) throw new Error("Choose declared UTF-8 files within the 256 KiB preview limit.");
    const original = await intake.read(source.id, path);
    if (new TextEncoder().encode(original).length !== file.bytes || await sha256(original) !== file.sha256) throw new Error("Source bytes changed; inspect again before analysis.");
    assertShareable(original);
    const text = sanitizeReadme(original.slice(0, 8000).replace(/[\uD800-\uDBFF]$/, ""));
    excerpts.push({ path, sha256: file.sha256, originalBytes: file.bytes, text, excerptHash: await sha256(text), truncated: original.length > 8000 });
  }
  if (signal.aborted) throw new Error("Analysis preparation cancelled.");
  return { id: source.id, artifactHash: source.artifactHash, sourceHash: source.sourceHash, label: source.sourceLabel, origin: source.repository ? `${source.repository.url}@${source.repository.commit}` : "Local snapshot; no authenticated publisher", inventory: source.files.map(({ path, bytes, kind, sha256 }) => ({ path, bytes, kind, sha256 })), excerpts };
}
