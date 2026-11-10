import type { IntakeCandidate, IntakeFile } from "./contracts";
export function sameSkillSource(a: IntakeCandidate, b: IntakeCandidate): boolean {
  return a.metadata.name === b.metadata.name && a.entrypoint === b.entrypoint &&
    (a.repository && b.repository ? a.repository.url === b.repository.url : !a.repository && !b.repository && a.sourceLabel === b.sourceLabel);
}
export type SkillFileChange = { path: string; change: "added" | "removed" | "changed"; before?: IntakeFile; after?: IntakeFile; attribution: boolean };
export function skillDiff(before: IntakeCandidate, after: IntakeCandidate) {
  const old = new Map(before.files.map((f) => [f.path, f])), next = new Map(after.files.map((f) => [f.path, f]));
  const changes: SkillFileChange[] = [];
  let unchanged = 0;
  for (const path of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const a = old.get(path), b = next.get(path);
    if (a && b && a.sha256 === b.sha256 && a.bytes === b.bytes && a.kind === b.kind && a.sourceMode === b.sourceMode && a.sourcePath === b.sourcePath) { ++unchanged; continue; }
    changes.push({ path, change: !a ? "added" : !b ? "removed" : "changed", before: a, after: b, attribution: a?.kind === "attribution" || b?.kind === "attribution" || /(?:^|\/)(?:LICENSE|NOTICE)(?:\.md|\.txt)?$/i.test(path) });
  }
  const metadata = (c: IntakeCandidate) => JSON.stringify([c.metadata.name, c.metadata.description, c.metadata.license, c.metadata.compatibility, c.metadata.allowedTools, Object.entries(c.metadata.metadata).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
  return { sameSource: sameSkillSource(before, after), changes, unchanged, metadataChanged: metadata(before) !== metadata(after), toolRequestsChanged: before.metadata.allowedTools !== after.metadata.allowedTools, revisionChanged: before.repository?.commit !== after.repository?.commit };
}
