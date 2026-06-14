// Component variants — a variant SET is a container frame (`isVariantSet`)
// whose child main components each carry `variantProps` (e.g. {State:"hover"}).
// An instance of the set holds a `variantSelection`; resolving it picks the
// member main to mirror. Property names + values are derived from the members.
//
// Pure + framework-free for cheap unit testing.

export type VariantMember = {
  id: string;
  variantProps?: Record<string, string>;
};

/** prop name → ordered, de-duplicated list of values seen across members. */
export function variantProperties(
  members: VariantMember[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of members) {
    for (const [k, v] of Object.entries(m.variantProps ?? {})) {
      const arr = out[k] ?? (out[k] = []);
      if (!arr.includes(v)) arr.push(v);
    }
  }
  return out;
}

/** Find the member that best matches `selection`. Exact match on all selected
 * keys wins (first in document order); otherwise the member matching the most
 * selected props; otherwise the first member. Null only for an empty set. */
export function resolveVariant(
  members: VariantMember[],
  selection: Record<string, string>,
): string | null {
  if (members.length === 0) return null;
  let best: VariantMember | null = null;
  let bestScore = -1;
  for (const m of members) {
    const props = m.variantProps ?? {};
    let score = 0;
    let mismatch = false;
    for (const [k, v] of Object.entries(selection)) {
      if (props[k] === v) score++;
      else mismatch = true;
    }
    if (!mismatch) return m.id; // every selected key matches → exact
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return (best ?? members[0]!).id;
}

/** The selection an instance starts from — the first member's props. */
export function defaultSelection(
  members: VariantMember[],
): Record<string, string> {
  return { ...(members[0]?.variantProps ?? {}) };
}
