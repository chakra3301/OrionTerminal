import type { IntakeCandidate } from "./contracts";
import { skillDiff } from "./skillDiff";
export function SkillDiffReview({ before, after }: { before: IntakeCandidate; after: IntakeCandidate }) {
  const diff = skillDiff(before, after);
  return <section aria-label="Skill version changes">
    <h4>Version changes · manifest comparison</h4>
    <p><code>{before.artifactHash}</code> → <code>{after.artifactHash}</code></p>
    <p>{diff.changes.length} changed paths · {diff.unchanged} unchanged. {diff.metadataChanged ? "Metadata changed." : "Metadata unchanged."} {diff.revisionChanged && "Pinned revision changed."}</p>
    {!diff.sameSource && <p role="alert">Different source identity: install separately. Local source labels do not authenticate a publisher.</p>}
    {diff.toolRequestsChanged && <p>Declared tool requests changed: {before.metadata.allowedTools || "none"} → {after.metadata.allowedTools || "none"}. Grants remain zero.</p>}
    {diff.changes.some((c) => c.attribution) && <p>Attribution bytes or paths changed. Re-read the included LICENSE/NOTICE before approving.</p>}
    <ul>{diff.changes.map((c) => <li key={c.path}><code>{c.path}</code> · {c.change}{c.attribution ? " · attribution" : ""}
      <details><summary>File identity</summary><p>Before: {c.before ? `${c.before.bytes} bytes · ${c.before.kind} · mode ${c.before.sourceMode.toString(8)} · ${c.before.sha256}` : "absent"}</p><p>After: {c.after ? `${c.after.bytes} bytes · ${c.after.kind} · mode ${c.after.sourceMode.toString(8)} · ${c.after.sha256}` : "absent"}</p></details>
    </li>)}</ul>
    <p>Hashes identify byte changes, not semantic compatibility or security. Matching source labels do not authenticate a publisher. Review resource previews; scripts remain inactive. This does not approve the update.</p>
  </section>;
}
