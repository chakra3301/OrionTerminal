// Claude composer — DesignPlan schema + pure transforms.
//
// Claude returns one fenced ```xd-design JSON block describing a full design;
// we parse it, transform the node tree into native XDesign shapes (auto-layout
// frames + color-variable refs), and ingest it as one reversible batch. Pure +
// framework-free so the parsing/transform are cheap to unit-test; id generation
// and store mutation are injected by the caller (see ingestDesignPlan.ts).

import type { Shape } from "./store";

export type PlanLayout = {
  mode?: "vertical" | "horizontal" | "none";
  padding?: number;
  gap?: number;
  primaryAlign?: "min" | "center" | "max" | "space-between";
  counterAlign?: "min" | "center" | "max";
};
export type PlanEffect = {
  kind: "shadow";
  type?: "drop" | "inner";
  offsetX?: number;
  offsetY?: number;
  blur?: number;
  color?: string;
};
export type PlanNode = {
  type: "frame" | "text" | "rect" | "ellipse" | "image";
  name?: string;
  w?: number;
  h?: number;
  sizingH?: "hug" | "fill" | "fixed";
  sizingV?: "hug" | "fill" | "fixed";
  fill?: string;
  radius?: number;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right";
  effects?: PlanEffect[];
  layout?: PlanLayout;
  children?: PlanNode[];
};
export type DesignPlan = {
  tokens: { colors: { name: string; value: string }[] };
  screen: {
    name: string;
    w: number;
    h: number;
    fill?: string;
    layout?: PlanLayout;
    children: PlanNode[];
  };
};

const FENCE = /```xd-design\s*\n([\s\S]*?)```/;
const FENCE_G = /```xd-design\s*\n([\s\S]*?)```/g;

/** Parse one already-extracted JSON string into a DesignPlan. Null on bad
 * JSON or a missing screen. */
function parsePlanJson(jsonText: string): DesignPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText.trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const screen = o.screen as Record<string, unknown> | undefined;
  if (!screen || typeof screen !== "object") return null;
  const tokens = (o.tokens as { colors?: unknown } | undefined) ?? {};
  const colors = Array.isArray(tokens.colors)
    ? (tokens.colors as { name: string; value: string }[])
    : [];
  return {
    tokens: { colors },
    screen: {
      name: typeof screen.name === "string" ? screen.name : "Screen",
      w: typeof screen.w === "number" ? screen.w : 1440,
      h: typeof screen.h === "number" ? screen.h : 1024,
      fill: typeof screen.fill === "string" ? screen.fill : undefined,
      layout: (screen.layout as PlanLayout) ?? undefined,
      children: Array.isArray(screen.children)
        ? (screen.children as PlanNode[])
        : [],
    },
  };
}

/** Extract + parse the FIRST fenced design block. Fails soft (null). */
export function parseDesignPlan(text: string): DesignPlan | null {
  const m = text.match(FENCE);
  if (!m) return null;
  return parsePlanJson(m[1]!);
}

/** Extract + parse ALL fenced design blocks (variations flow). Skips any
 * malformed block; returns [] when none parse. */
export function parseDesignPlans(text: string): DesignPlan[] {
  const out: DesignPlan[] = [];
  let m: RegExpExecArray | null;
  FENCE_G.lastIndex = 0;
  while ((m = FENCE_G.exec(text)) !== null) {
    const plan = parsePlanJson(m[1]!);
    if (plan) out.push(plan);
  }
  return out;
}

/** Remove the fenced design block from a reply for the visible transcript. */
export function stripDesignPlan(text: string): string {
  return text.replace(/```xd-design\s*\n[\s\S]*?```/g, "").trim();
}

const ROOT_X = 120;
const ROOT_Y = 120;

function layoutFields(layout: PlanLayout | undefined) {
  if (!layout) return {};
  const pad = layout.padding ?? 0;
  return {
    layoutMode: layout.mode ?? "none",
    itemSpacing: layout.gap ?? 0,
    paddingTop: pad,
    paddingRight: pad,
    paddingBottom: pad,
    paddingLeft: pad,
    primaryAxisAlign: layout.primaryAlign ?? "min",
    counterAxisAlign: layout.counterAlign ?? "min",
  };
}

function baseFields(node: PlanNode): Record<string, unknown> {
  const f: Record<string, unknown> = {
    fill: node.fill ?? "#d9d9d9",
    stroke: "transparent",
    strokeWidth: 0,
  };
  if (node.sizingH) f.layoutSizingH = node.sizingH;
  if (node.sizingV) f.layoutSizingV = node.sizingV;
  if (node.effects) f.effects = node.effects;
  return f;
}

/** node "image" has no real source in v1 → a filled rect placeholder. */
function kindFor(t: PlanNode["type"]): Shape["kind"] {
  return t === "image" ? "rect" : (t as Shape["kind"]);
}

/** Walk the plan into a flat Shape[] (+ color seeds). ids are injected so the
 * transform stays pure/deterministic. Children of auto-layout frames get
 * placeholder x/y — computeAutoLayout positions them at render. */
export function planToShapes(
  plan: DesignPlan,
  newId: () => string,
  origin?: { x: number; y: number },
): { shapes: Shape[]; variables: { name: string; value: string }[] } {
  const shapes: Shape[] = [];
  const ox = origin?.x ?? ROOT_X;
  const oy = origin?.y ?? ROOT_Y;

  const rootId = newId();
  shapes.push({
    id: rootId,
    name: plan.screen.name,
    kind: "frame",
    x: ox,
    y: oy,
    w: plan.screen.w,
    h: plan.screen.h,
    radius: 0,
    fill: plan.screen.fill ?? "#ffffff",
    stroke: "transparent",
    strokeWidth: 0,
    parentId: null,
    ...layoutFields(plan.screen.layout),
  } as Shape);

  const walk = (node: PlanNode, parentId: string) => {
    const id = newId();
    const kind = kindFor(node.type);
    const shape: Record<string, unknown> = {
      id,
      name: node.name ?? kind,
      kind,
      x: ox,
      y: oy,
      w: node.w ?? 100,
      h: node.h ?? 40,
      parentId,
      ...baseFields(node),
    };
    if (kind === "frame" || kind === "rect") shape.radius = node.radius ?? 0;
    if (kind === "frame") Object.assign(shape, layoutFields(node.layout));
    if (kind === "text") {
      shape.text = node.text ?? "";
      shape.fontSize = node.fontSize ?? 16;
      if (node.fontWeight) shape.fontWeight = node.fontWeight;
      if (node.lineHeight) shape.lineHeight = node.lineHeight;
      if (node.textAlign) shape.textAlign = node.textAlign;
    }
    shapes.push(shape as Shape);
    for (const c of node.children ?? []) walk(c, id);
  };

  for (const c of plan.screen.children) walk(c, rootId);
  return { shapes, variables: plan.tokens.colors };
}

/** Rewrite fills of the form "color/<name>" to "var:<id>" via a name→id map.
 * Literal fills are left untouched. Returns a new array. */
export function resolveColorRefs(
  shapes: Shape[],
  nameToId: Map<string, string>,
): Shape[] {
  return shapes.map((s) => {
    if (typeof s.fill === "string" && s.fill.startsWith("color/")) {
      const id = nameToId.get(s.fill.slice("color/".length));
      if (id) return { ...s, fill: `var:${id}` } as Shape;
    }
    return s;
  });
}
