import { Fragment } from "react";
import type { DeclarationEvidence } from "@/features/repoAnalysis/declarations";

export function DeclarationEvidenceView({ items }: { items: DeclarationEvidence[] }) {
  return <section aria-label="Declared dependencies and runtimes">
    <h4>Manifest declarations · local extraction</h4>
    <p>Read from complete selected files, not inferred by AI. Values are untrusted declarations—not installed runtimes, resolved versions, compatibility or security verification. No scripts or include/index URLs are executed or followed.</p>
    <p>Coverage: package.json packageManager/engines/os/cpu/libc/scripts and direct dependency groups; simple requirements.txt lines only. Implicit hooks, workspaces, transitive dependencies and other formats are not inspected.</p>
    {items.map((item) => <details key={item.path}>
      <summary>{item.path} · {item.status} · {item.declarations.length} shown · {item.omitted} omitted</summary>
      <p>{item.parser} · source SHA-256 <code>{item.sha256}</code></p>
      {item.issues.length > 0 && <p>Coverage limits: {item.issues.join(", ")}</p>}
      {!item.declarations.length && <p>No declarations recorded for supported fields. This does not establish an absence of dependencies or execution requirements.</p>}
      <dl>{item.declarations.map((d, i) => <Fragment key={i}><dt>{d.category} · {d.name}</dt><dd><code>{d.value}</code></dd></Fragment>)}</dl>
    </details>)}
  </section>;
}
