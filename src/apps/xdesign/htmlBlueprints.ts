// Expert slot-template blueprints (Lever 2).
//
// open-design's second quality lever: a finished page isn't free-architected by
// the model each time — it fills an expert-authored structure (their
// landing.ts encodes a 12-module AIDA/PAS/FAB playbook with a single-source CTA
// and an accent budget). We deliver the same craft as a strict, named-slot
// BLUEPRINT injected into the build prompt: the section order, each section's
// copywriting intent + the content slots that must be filled, and a layout/
// token directive. The model writes the HTML but follows the blueprint exactly,
// so output structure stops being a coin-flip.
//
// Pure data + a compiler. No model calls. The matching token system (Lever 1)
// is injected separately by the brand contract.

export type ArtifactKind = "landing" | "pricing" | "dashboard" | "mobile";

export type BlueprintSection = {
  name: string;
  /** What the section must accomplish + the copywriting framework. */
  intent: string;
  /** Named content slots the model must fill with real, specific copy. */
  slots: string[];
  /** Structural / token / layout directive. */
  layout: string;
};

export type Blueprint = {
  kind: ArtifactKind;
  title: string;
  framework: string;
  sections: BlueprintSection[];
  rules: string[];
};

export const BLUEPRINTS: Record<ArtifactKind, Blueprint> = {
  landing: {
    kind: "landing",
    title: "Marketing landing page",
    framework:
      "Page arc = AIDA. The problem block runs PAS (Problem→Agitate→Solution handing to the value block). Every feature is written FAB (Feature→Advantage→Benefit, landing on the Benefit).",
    sections: [
      { name: "Nav", intent: "Orient instantly; one job.", slots: ["wordmark", "3–4 anchor links", "one accent CTA"], layout: "Sticky, slim, transparent over hero; logo left, links center/right, CTA far right." },
      { name: "Hero", intent: "Communicate the core value in under 5 seconds.", slots: ["formula headline (specific outcome)", "one-sentence subhead", "primary CTA", "ghost secondary CTA", "hero visual ({{IMG: …}} or device mock)", "micro-trust line"], layout: "Two-column on desktop (copy left, visual right) or centered; the loudest accent of the whole page lives on the primary CTA here." },
      { name: "Social proof", intent: "Borrow credibility immediately.", slots: ["logo wall OR star rating OR 1 specific number"], layout: "Quiet strip hugging the hero; muted, single row, small." },
      { name: "Problem (PAS)", intent: "Name the reader's pain in their words, then agitate it.", slots: ["pain headline", "2–3 sentences of agitation"], layout: "Short, calm section on an alternate background; no accent." },
      { name: "Value pillars", intent: "Exactly 3 pillars, each written FAB so the card shows the BENEFIT.", slots: ["3 pillar titles (benefit-led)", "3 supporting lines", "3 inline icons (SVG)"], layout: "3-column card grid; equal heights; inline SVG icons; restrained accent." },
      { name: "How it works", intent: "Remove friction — show it's simple.", slots: ["3 numbered steps with a verb-led title + one line each"], layout: "3 steps drawn with CSS/SVG (numbered chips), no screenshots; connecting line optional." },
      { name: "Feature deep-dive", intent: "2–3 zig-zag rows; title = benefit, body = how.", slots: ["2–3 feature titles", "2–3 paragraphs", "2–3 visuals ({{IMG: …}})"], layout: "Alternating image/copy sides per row; generous vertical spacing." },
      { name: "Proof", intent: "Hard evidence.", slots: ["3–4 big stat numbers + labels", "1–2 named testimonials with a result"], layout: "Stat band (big numerals) then testimonial card(s) with attribution." },
      { name: "FAQ", intent: "Pre-answer the top buying objections.", slots: ["4–6 question/answer pairs"], layout: "Accordion or two-column list; calm, no accent." },
      { name: "Pricing teaser", intent: "Anchor value before the ask.", slots: ["3 tiers (middle highlighted) OR a single value statement + link"], layout: "3-card row, middle tier lifted + badged; or a compact teaser." },
      { name: "Final CTA", intent: "The single strongest ask on the page.", slots: ["punchy CTA headline", "one line", "primary CTA", "risk-reversal microcopy"], layout: "Full-bleed accent band — the page's loudest moment; mirror the hero CTA verb." },
      { name: "Footer", intent: "Restrained close; never competes with the CTA.", slots: ["grouped link columns", "wordmark", "legal line"], layout: "Muted, small, multi-column; lowest contrast on the page." },
    ],
    rules: [
      "One page, one goal: every CTA points at the SAME action; keep the CTA verb identical everywhere.",
      "Accent budget: reserve the loudest accent for the hero CTA and the final CTA; everything else stays neutral.",
      "Alternate section backgrounds between the base and elevated background tokens for rhythm.",
      "A calm inline CTA should recur roughly every ~1.5 screens so the reader never scrolls back for a button.",
    ],
  },
  pricing: {
    kind: "pricing",
    title: "Pricing page",
    framework: "Anchoring + decoy: 3 tiers with the middle one as the visually dominant recommended choice; a generous top tier makes the middle feel reasonable.",
    sections: [
      { name: "Header", intent: "Frame price as value, not cost.", slots: ["value-led headline", "one-line subhead", "monthly/annual toggle with an annual-discount badge"], layout: "Centered; the billing toggle is prominent and functional-looking." },
      { name: "Tier cards", intent: "Exactly 3 tiers; middle = 'Most popular', lifted and accented.", slots: ["3 tier names", "3 prices + period", "3 one-line 'who it's for'", "aligned feature lists", "3 CTAs"], layout: "3-column; middle card scaled up + badge + accent border; feature rows align horizontally across cards; equal CTA treatment." },
      { name: "Comparison table", intent: "Let buyers scan capability vs tier.", slots: ["capability rows", "per-tier check/✕ or values"], layout: "Sticky header row; checkmarks use the success token; aligned columns; hairline rows." },
      { name: "FAQ", intent: "Kill billing objections.", slots: ["5–6 Q/A on billing, seats, cancellation, refunds, upgrades"], layout: "Accordion or two columns." },
      { name: "Guarantee / final CTA", intent: "Reverse the risk.", slots: ["reassurance line (free trial / no card / cancel anytime)", "primary CTA"], layout: "Accent band; the page's strongest ask." },
    ],
    rules: [
      "The middle tier must be visually dominant (size, accent border, badge).",
      "Card heights and CTA buttons are consistent across tiers; prices use the display type token.",
      "Use the success token for included checks and the muted text token for excluded rows.",
    ],
  },
  dashboard: {
    kind: "dashboard",
    title: "Application dashboard",
    framework: "Data-ink first: muted chrome, the data is the hero. Information hierarchy = KPIs → trends → detail.",
    sections: [
      { name: "App shell", intent: "Persistent navigation + global actions.", slots: ["sidebar: logo + grouped nav items (one active)", "top bar: search, page title, primary action, user menu"], layout: "Fixed left sidebar (240–280px) with an active-state treatment + top bar; content area scrolls." },
      { name: "Page header", intent: "Locate the user + offer the page's main action.", slots: ["page title", "breadcrumb or subtitle", "date-range or primary action"], layout: "Title left, actions right; uses the h1/h2 token." },
      { name: "KPI row", intent: "Lead with the 3–4 numbers that matter.", slots: ["3–4 metric cards: big number, label, delta %, tiny sparkline"], layout: "Equal-width card row; the delta is colored with success/error tokens (up/down); consistent card padding from the spacing scale." },
      { name: "Charts", intent: "Show the trend behind the numbers.", slots: ["1 large primary chart (SVG/CSS)", "1 secondary chart"], layout: "2-up grid (primary wider); muted gridlines; the primary accent only on the key series." },
      { name: "Data table", intent: "The detail layer.", slots: ["column headers", "8–12 rows of plausible data", "status pills", "row actions", "pagination"], layout: "Hairline rows (no zebra), status pills use status tokens, sticky header, right-aligned numerics." },
    ],
    rules: [
      "Muted chrome: surfaces use the elevated/raised background tokens, borders are hairlines; the accent appears only on the primary action + key chart series.",
      "Consistent card padding and gaps from the spacing scale; align everything to the grid.",
      "Numbers right-aligned and tabular; labels in the muted text token.",
    ],
  },
  mobile: {
    kind: "mobile",
    title: "Mobile app screen",
    framework: "One screen, one primary action. Thumb-zone ergonomics: the main action sits at the bottom.",
    sections: [
      { name: "Device frame", intent: "Render inside a realistic phone.", slots: ["390×844 frame with status bar + safe areas"], layout: "Centered device frame on a neutral backdrop; rounded screen corners; status bar with time + indicators." },
      { name: "Top bar", intent: "Orient + allow back.", slots: ["screen title or logo", "back/menu affordance", "optional action icon"], layout: "Compact top bar; ≥44px tap targets; title in the h2/h3 token." },
      { name: "Content", intent: "Deliver the screen's job with one clear focus.", slots: ["primary content (cards/list/feed)", "supporting copy"], layout: "Single column, generous vertical rhythm, large readable body; one focal element." },
      { name: "Bottom action", intent: "Make the primary action thumb-reachable.", slots: ["primary CTA OR a tab bar (3–5 items, one active)"], layout: "Anchored to the bottom safe area; full-width primary button or a tab bar with the active item accented." },
    ],
    rules: [
      "Exactly one primary action per screen; everything else is secondary.",
      "Tap targets ≥44px; bottom-anchored primary action within the thumb zone.",
      "390px content width; respect top/bottom safe areas.",
    ],
  },
};

const LENS_TO_KIND: Record<string, ArtifactKind> = {
  "lens-landing": "landing",
  "lens-pricing": "pricing",
  "lens-dashboard": "dashboard",
  "lens-mobile": "mobile",
};

/** Map a lens id (from designKnowledge.lensesForBrief) to a blueprint. */
export function blueprintForLens(lensId: string): Blueprint | null {
  const kind = LENS_TO_KIND[lensId];
  return kind ? BLUEPRINTS[kind] : null;
}

/** Pick the most specific blueprint for a list of detected lenses (the lens
 * heuristic orders specific → landing-default), falling back to landing. */
export function blueprintForLenses(lensIds: string[]): Blueprint {
  for (const id of lensIds) {
    const bp = blueprintForLens(id);
    if (bp && bp.kind !== "landing") return bp;
  }
  for (const id of lensIds) {
    const bp = blueprintForLens(id);
    if (bp) return bp;
  }
  return BLUEPRINTS.landing;
}

/** Compile a blueprint into a strict, section-by-section spec the model fills. */
export function buildBlueprintPrompt(bp: Blueprint): string {
  const lines: string[] = [];
  lines.push(`# PAGE BLUEPRINT — ${bp.title} (follow this structure EXACTLY, in order)`);
  lines.push(`Framework: ${bp.framework}`);
  lines.push(`\nSection order:`);
  bp.sections.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name} — ${s.intent}`);
    lines.push(`   slots: ${s.slots.join("; ")}`);
    lines.push(`   layout: ${s.layout}`);
  });
  lines.push(`\nBlueprint rules:`);
  for (const r of bp.rules) lines.push(`- ${r}`);
  lines.push(
    `\nFill EVERY slot with real, specific, on-brand copy — never lorem ipsum, never a bare placeholder label. Build all ${bp.sections.length} sections in this order; do not add or drop sections. Map every color, space, radius, and type size to the derived token system in the brand contract above.`,
  );
  return lines.join("\n");
}
