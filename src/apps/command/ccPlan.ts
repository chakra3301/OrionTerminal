// Pure delegation-protocol logic: build the General's planning + briefing
// prompts and parse the plan it returns. No IO. Fail-soft parsing.

export type CCDirective = {
  division: string;
  title: string;
  instruction: string;
};

export type CaptainInfo = {
  division: string;
  name: string;
  charter: string;
};

export type CCReport = {
  division: string;
  report: string;
};

/** Prompt the General to decompose a mission into per-division directives.
 * Ends with a strict JSON contract matching `parsePlan`. */
export function buildPlanPrompt(
  brief: string,
  captains: CaptainInfo[],
): string {
  const roster = captains
    .map((c) => `- division "${c.division}" (${c.name}): ${c.charter}`)
    .join("\n");
  return [
    "You are the General — pure coordinator of an AI org. Decompose the Commander's mission into directives, one per division that should act. Only involve divisions whose skills fit. Each directive is a concrete, self-contained instruction that Captain can execute alone.",
    "",
    "Available divisions:",
    roster,
    "",
    "Mission brief:",
    brief,
    "",
    'Respond with ONLY a JSON object, no prose, in this exact shape:',
    '{"directives":[{"division":"<one of the division keys above>","title":"<short title>","instruction":"<full instruction for that Captain>"}]}',
    "Include only divisions that should act. If none fit, return {\"directives\":[]}.",
  ].join("\n");
}

/** Extract the first JSON object from arbitrary model text. Tolerates code
 * fences / surrounding prose. */
function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Fail-soft: returns directives for known divisions only; [] on any problem.
 * `knownDivisions` guards against hallucinated divisions. */
export function parsePlan(
  text: string,
  knownDivisions: string[],
): CCDirective[] {
  const obj = extractJson(text) as { directives?: unknown } | null;
  if (!obj || !Array.isArray(obj.directives)) return [];
  const known = new Set(knownDivisions);
  const out: CCDirective[] = [];
  for (const d of obj.directives) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    const division = typeof r.division === "string" ? r.division : "";
    const instruction =
      typeof r.instruction === "string" ? r.instruction : "";
    if (!division || !instruction || !known.has(division)) continue;
    out.push({
      division,
      title: typeof r.title === "string" && r.title ? r.title : division,
      instruction,
    });
  }
  return out;
}

/** Prompt the General to aggregate division reports into one briefing. */
export function buildBriefingPrompt(
  title: string,
  brief: string,
  reports: CCReport[],
): string {
  const body = reports
    .map((r) => `### ${r.division}\n${r.report}`)
    .join("\n\n");
  return [
    `You are the General. The mission "${title}" is complete. Write a concise briefing for the Commander: what was accomplished across divisions, key outcomes, and anything that needs the Commander's attention. Be direct; no preamble.`,
    "",
    `Original brief: ${brief}`,
    "",
    "Division reports:",
    body || "(no reports)",
  ].join("\n");
}
