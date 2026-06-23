// Design-knowledge skill library — distilled senior-design-engineer craft that
// gets injected into the composer/variations prompts so generated UI clears a
// higher quality bar. Inspired by Open Design's "skills" filesystem: a set of
// named, composable craft modules rather than one monolithic instruction.
//
// Pure data + a composer. No model calls here.

export type DesignSkill = {
  id: string;
  title: string;
  /** Whether this skill is part of the always-on craft brief. */
  core: boolean;
  body: string;
};

export const DESIGN_SKILLS: DesignSkill[] = [
  {
    id: "hierarchy",
    title: "Visual hierarchy",
    core: true,
    body: "Establish one clear focal point per section. Use dramatic size/weight/color contrast between the primary message and everything else — timid 1.2× steps read as flat. The eye should land, then flow in a deliberate Z or F path.",
  },
  {
    id: "type-scale",
    title: "Typographic scale & rhythm",
    core: true,
    body: "Use a real modular scale (≈1.25–1.5 ratio), not arbitrary sizes. Big confident display, restrained body (15–18px), clear caption. Tighten tracking on large headings (negative), open line-height on body (1.5–1.7). Limit to 2 families.",
  },
  {
    id: "spacing",
    title: "Spacing & grid rhythm",
    core: true,
    body: "Commit to an 8px spacing system; spacing communicates grouping. Be generous — whitespace is not wasted space. Align everything to a grid; consistent gutters and section padding create calm. Related items close, unrelated items far.",
  },
  {
    id: "color",
    title: "Color discipline",
    core: true,
    body: "One dominant color, sharp intentional accents, lots of neutral. Avoid muddy mid-tones and equal-weight palettes. Ensure text/background contrast meets WCAG AA (≥4.5:1 body). Use color to signal, not decorate.",
  },
  {
    id: "depth",
    title: "Depth & elevation",
    core: true,
    body: "Layer with intent: soft shadows and subtle borders to separate surfaces, not heavy chrome. Light comes from above — shadows fall down. Keep elevation steps few and consistent. On dark UIs, lift surfaces with lighter fills, not big shadows.",
  },
  {
    id: "polish",
    title: "Finishing polish",
    core: true,
    body: "What separates pro from AI-slop: optical alignment over mathematical, consistent corner radii, real product copy (never lorem), balanced negative space, and considered empty/edge states. Sweat the small alignments.",
  },
  // Optional artifact lenses (not core; selected by id when relevant).
  {
    id: "lens-landing",
    title: "Landing page anatomy",
    core: false,
    body: "Nav → hero (one sharp value prop + primary CTA + supporting visual) → social proof → 3–4 feature blocks with real benefit copy → secondary CTA → pricing teaser → footer. Hero must communicate value in <5 seconds.",
  },
  {
    id: "lens-pricing",
    title: "Pricing page",
    core: false,
    body: "3 tiers, middle one highlighted as recommended. Align feature rows for scannability. Clear price, billing toggle, per-tier CTA, FAQ below. Anchor with a generous top tier.",
  },
  {
    id: "lens-dashboard",
    title: "Dashboard / app UI",
    core: false,
    body: "Sidebar nav + top bar + content grid. Lead with the most important metric cards, then charts, then tables. Dense but breathable; consistent card padding; muted chrome so data is the hero.",
  },
  {
    id: "lens-mobile",
    title: "Mobile screen",
    core: false,
    body: "375–430px wide. Thumb-reachable primary actions at the bottom. Large tap targets (≥44px). One primary action per screen, generous vertical spacing, a clear top title/back affordance.",
  },
];

/** The always-on craft brief: the core skills compiled into a compact block.
 * Pass extra non-core skill ids (lenses) to append artifact-specific guidance. */
export function composeCraftBrief(extraIds: string[] = []): string {
  const core = DESIGN_SKILLS.filter((s) => s.core);
  const extras = extraIds
    .map((id) => DESIGN_SKILLS.find((s) => s.id === id && !s.core))
    .filter((s): s is DesignSkill => !!s);
  const lines: string[] = ["# DESIGN CRAFT (honor these)"];
  for (const s of [...core, ...extras]) lines.push(`- ${s.title}: ${s.body}`);
  return lines.join("\n");
}

/** Heuristic: pick relevant artifact lens ids from a free-text brief so the
 * composer gets structure guidance without the user choosing manually. */
export function lensesForBrief(brief: string): string[] {
  const b = brief.toLowerCase();
  const out: string[] = [];
  if (/\b(pricing|plans?|tiers?|subscription)\b/.test(b)) out.push("lens-pricing");
  if (/\b(dashboard|admin|analytics|console|app ui|panel)\b/.test(b)) out.push("lens-dashboard");
  if (/\b(mobile|ios|android|phone|app screen)\b/.test(b)) out.push("lens-mobile");
  if (/\b(landing|marketing|home ?page|hero|website|site)\b/.test(b)) out.push("lens-landing");
  // Default to landing-page structure when nothing matched (most common brief).
  if (out.length === 0) out.push("lens-landing");
  return out;
}
