// Output quality guards for HTML artifacts (Lever 3, inspired by open-design's
// stub-guard / publication-guard).
//
// Before a generated page is shown/exported, inspect it for the failure modes
// that make AI output look unfinished: a refine that collapsed into a tiny
// stub, leftover placeholder/lorem copy, external image URLs that 404 in the
// sandbox, and missing document scaffolding. Pure + unit-tested; the rail runs
// one silent auto-repair turn when issues are found, else renders + warns.

export type ArtifactIssue =
  | { code: "stub"; detail: string }
  | { code: "placeholder"; detail: string }
  | { code: "external-image"; detail: string }
  | { code: "malformed"; detail: string };

export type InspectOptions = {
  /** The artifact body being refined (so a collapse can be detected). */
  prior?: string | null;
  /** Only apply the stub check on refine turns — a fresh build has no
   * meaningful prior to compare against. */
  isRefine?: boolean;
};

// A refine that returns < half the document it was refining is almost always a
// fragment/placeholder rather than the full page.
const STUB_RATIO = 0.5;
const STUB_MIN_PRIOR = 2000;

// Curated placeholder markers. Deliberately excludes the bare word
// "placeholder" so the legitimate <input placeholder="…"> attribute never
// trips the guard.
const PLACEHOLDER_RULES: { re: RegExp; label: string }[] = [
  { re: /lorem ipsum/i, label: "lorem ipsum" },
  { re: /\{\{[^}]+\}\}/, label: "unresolved {{token}}" },
  { re: /\[(?:insert|your|placeholder|todo)\b[^\]]*\]/i, label: "[INSERT …]" },
  { re: /\bTODO\b/, label: "TODO marker" },
  { re: /\$X\.XM\b/, label: "$X.XM" },
  {
    re: /\b(?:replace|insert)\s+(?:this|the|your)\s+(?:panel|text|content|copy|placeholder|image|headline)\b/i,
    label: "replace-this instruction",
  },
  { re: /\byour\s+(?:headline|text|content|name|logo|copy)\s+here\b/i, label: "your … here" },
];

/** External http(s) image references — img src + CSS background url(). These
 * 404 inside the sandboxed srcdoc iframe. Google Fonts <link> etc. are not
 * matched (only image-bearing spots). */
export function externalImageRefs(html: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const imgRe = /<img\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  while ((m = imgRe.exec(html)) !== null) out.push(m[1]!);
  const bgRe = /background(?:-image)?\s*:[^;{}]*url\(\s*["']?(https?:\/\/[^"')]+)/gi;
  while ((m = bgRe.exec(html)) !== null) out.push(m[1]!);
  return out;
}

export function inspectArtifact(html: string, opts: InspectOptions = {}): ArtifactIssue[] {
  const issues: ArtifactIssue[] = [];
  const lower = html.toLowerCase();

  const missing: string[] = [];
  if (!lower.includes("<!doctype html")) missing.push("<!doctype html>");
  if (!/<title[\s>]/i.test(html)) missing.push("<title>");
  if (!/name=["']viewport["']/i.test(html)) missing.push("viewport meta");
  if (missing.length > 0) {
    issues.push({ code: "malformed", detail: `missing ${missing.join(", ")}` });
  }

  for (const { re, label } of PLACEHOLDER_RULES) {
    if (re.test(html)) issues.push({ code: "placeholder", detail: label });
  }

  const ext = externalImageRefs(html);
  if (ext.length > 0) {
    issues.push({ code: "external-image", detail: ext.slice(0, 2).join(", ") });
  }

  if (opts.isRefine && opts.prior && opts.prior.length >= STUB_MIN_PRIOR) {
    if (html.length < opts.prior.length * STUB_RATIO) {
      issues.push({
        code: "stub",
        detail: `${html.length}B vs prior ${opts.prior.length}B`,
      });
    }
  }
  return issues;
}

export function isShippable(html: string, opts: InspectOptions = {}): boolean {
  return inspectArtifact(html, opts).length === 0;
}

export function summarizeIssues(issues: ArtifactIssue[]): string {
  return issues.map((i) => `${i.code} (${i.detail})`).join("; ");
}

/** A corrective instruction for one auto-repair turn — lists the issues and
 * demands the COMPLETE fixed document back. */
export function buildRepairPrompt(issues: ArtifactIssue[], currentHtml: string): string {
  const lines = issues.map((i) => {
    switch (i.code) {
      case "stub":
        return "- You returned a tiny fragment instead of the full page. Return the COMPLETE document.";
      case "placeholder":
        return `- Remove placeholder/template content (${i.detail}) and write real, specific copy.`;
      case "external-image":
        return `- Replace external image URL(s) (${i.detail}) — they 404 in the sandbox. Use a {{IMG: description}} token, inline SVG, or a CSS gradient instead.`;
      case "malformed":
        return `- Fix the document scaffolding (${i.detail}).`;
    }
  });
  return `The page you produced has issues that must be fixed before it ships:
${lines.join("\n")}

Return the COMPLETE corrected single-file HTML document in exactly one \`\`\`html block, and nothing after it.

CURRENT DOCUMENT:
\`\`\`html
${currentHtml}
\`\`\``;
}
