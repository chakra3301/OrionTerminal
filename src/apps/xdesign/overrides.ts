// Non-lossy instance overrides.
//
// When a user edits a descendant of a component instance, we record the change
// on the instance ROOT, keyed by the corresponding MAIN-descendant id (stable
// across re-clones — every clone stamps `linkedNodeId` with its source main id).
// `syncFromMain` then re-applies these patches after re-cloning, so local edits
// survive a sync.
//
// Two storage conventions:
//   - Visual / size / text props are stored as ABSOLUTE values, diffed against
//     the main node (resetting a value to match main clears the override).
//   - Position (x/y) is stored as an OFFSET FROM THE INSTANCE ROOT, so it
//     follows the instance and is unaffected by the main moving. Position is
//     never captured on the root itself (the root's position IS the instance's
//     placement, preserved by sync).
//
// Pure + framework-free for cheap unit testing.

import type { Shape } from "./store";

export type OverridePatch = { [key: string]: unknown };
export type OverrideMap = { [mainNodeId: string]: OverridePatch };

/** Props a user may override on an instance descendant. Absolute-valued (NOT
 * x/y — those are handled as root-relative offsets) and never structural. */
const OVERRIDABLE_KEYS = new Set<string>([
  "name",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeDash",
  "strokeCap",
  "strokeJoin",
  "strokeAlign",
  "fillGradient",
  "fillImage",
  "opacity",
  "rotation",
  "flipX",
  "flipY",
  "hidden",
  "radius",
  "radii",
  "w",
  "h",
  "effects",
  // text
  "text",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textCase",
  "textDecoration",
]);

/** Walk up the parent chain while the ancestor belongs to the same instance
 * (same `linkedMainId`). The topmost such shape is the instance root. */
export function findInstanceRoot(shapes: Shape[], id: string): Shape | null {
  const byId = new Map<string, Shape>(shapes.map((s) => [s.id, s]));
  let node: Shape | undefined = byId.get(id);
  if (!node || !node.linkedMainId) return null;
  const mainId = node.linkedMainId;
  while (node) {
    const parent: Shape | undefined = node.parentId
      ? byId.get(node.parentId)
      : undefined;
    if (!parent || parent.linkedMainId !== mainId) break;
    node = parent;
  }
  return node ?? null;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Given a user edit (`patch`) to shape `targetId`, return the updated override
 * map for the instance root — or null if the target isn't an instance node or
 * the patch records nothing. */
export function captureOverride(
  shapes: Shape[],
  targetId: string,
  patch: OverridePatch,
): { rootId: string; overrides: OverrideMap } | null {
  const target = shapes.find((s) => s.id === targetId);
  if (!target || !target.linkedMainId || !target.linkedNodeId) return null;
  const root = findInstanceRoot(shapes, targetId);
  if (!root) return null;
  const mainNode = shapes.find((s) => s.id === target.linkedNodeId);
  if (!mainNode) return null;
  const isRoot = target.id === root.id;

  const key = target.linkedNodeId;
  const existing = { ...(root.overrides?.[key] ?? {}) };
  let changed = false;

  for (const [k, v] of Object.entries(patch)) {
    if (k === "x" || k === "y") {
      // Position: root-relative offset. Never recorded on the root.
      if (isRoot) continue;
      const offset = (v as number) - (k === "x" ? root.x : root.y);
      if (existing[k] !== offset) {
        existing[k] = offset;
        changed = true;
      }
      continue;
    }
    if (!OVERRIDABLE_KEYS.has(k)) continue;
    if (eq(v, (mainNode as unknown as OverridePatch)[k])) {
      // Reset to match main → drop the override for this prop.
      if (k in existing) {
        delete existing[k];
        changed = true;
      }
    } else if (!eq(existing[k], v)) {
      existing[k] = v;
      changed = true;
    }
  }

  if (!changed) return null;

  const overrides: OverrideMap = { ...(root.overrides ?? {}) };
  if (Object.keys(existing).length === 0) delete overrides[key];
  else overrides[key] = existing;
  return { rootId: root.id, overrides };
}

/** Merge the override entry for `mainNodeId` onto a freshly-cloned node.
 * Position offsets are re-anchored to the (preserved) instance root position. */
export function applyOverrides<T extends { id: string; x: number; y: number }>(
  node: T,
  mainNodeId: string,
  rootPos: { x: number; y: number },
  overrides: OverrideMap | undefined,
): T {
  const entry = overrides?.[mainNodeId];
  if (!entry) return node;
  const out: T = { ...node };
  for (const [k, v] of Object.entries(entry)) {
    if (k === "x") (out as { x: number }).x = rootPos.x + (v as number);
    else if (k === "y") (out as { y: number }).y = rootPos.y + (v as number);
    else (out as unknown as OverridePatch)[k] = v;
  }
  return out;
}
