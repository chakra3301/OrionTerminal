// Synthesizes a one-glance "verdict" from an analysis. Pure + deterministic so
// the fit chip works on every analyzed repo with no AI call. Ported from verdict.js.

/** The first sentence of a blob (for the one-line "what it is"); '' when empty. */
export function firstSentence(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

export type Fit = { level: "strong" | "solid" | "care" | "risky"; label: string; why: string };

/**
 * Derive a fit verdict from health score, red-flag count, and pros/cons balance.
 */
export function deriveFit(d: any): Fit {
  const score = Number(d && d.health && d.health.score);
  const hasScore = Number.isFinite(score) && score > 0;
  const warns = ((d && d.red_flags) || []).filter((f: any) => f && f.severity !== "ok").length;
  const pros = ((d && d.pros) || []).length;
  const cons = ((d && d.cons) || []).length;

  let level: Fit["level"];
  if (hasScore) {
    if (score >= 85 && warns === 0) level = "strong";
    else if (score >= 70 && warns <= 1) level = "solid";
    else if (score >= 50 && warns <= 3) level = "care";
    else level = "risky";
  } else if (warns === 0 && pros >= cons) {
    level = "solid";
  } else if (warns <= 2) {
    level = "care";
  } else {
    level = "risky";
  }

  const label = { strong: "Strong fit", solid: "Solid", care: "Use with care", risky: "Risky" }[level];
  const bits: string[] = [];
  if (hasScore) bits.push(`Health ${score}`);
  bits.push(`${warns} flag${warns === 1 ? "" : "s"}`);
  if (pros || cons) bits.push(`${pros} pros / ${cons} cons`);
  return { level, label, why: bits.join(" · ") };
}

/** A plain-text verdict summary for the clipboard. */
export function verdictCopyText(d: any): string {
  const fit = deriveFit(d);
  const what = (d && d.description) || firstSentence(d && d.eli5) || "";
  const lines = [`${(d && d.repoId) || (d && d.name) || "Repository"} — ${fit.label}`];
  if (what) lines.push(what);
  if (d && d.bottom_line) lines.push("", d.bottom_line);
  lines.push("", `Fit: ${fit.label} (${fit.why})`);
  const warns = ((d && d.red_flags) || []).filter((f: any) => f && f.severity !== "ok").slice(0, 3);
  if (warns.length) {
    lines.push("", "Flags:", ...warns.map((f: any) => `- ${f.title}: ${f.text}`));
  }
  return lines.join("\n").trim();
}
