import type { Shape, FrameShape, TextShape, Variable } from "@/apps/xdesign/store";

/** Design→code generator (Phase 3.1, the wedge): turn an XDesign frame tree
 * into a real React component using inline styles + Orion's CSS-variable
 * design tokens. Pure (no store/DOM) so it's unit-testable. Figma's own MCP
 * docs admit their output is "not production-ready"; this writes a clean,
 * self-contained .tsx into the repo next door. */

/** Orion core palette → token name. When a design color matches a token
 * value exactly we emit `var(--token)` so exported code shares Orion's
 * tokens (the "shared design tokens" promise). */
const TOKEN_BY_HEX: Record<string, string> = {
  "#39ff88": "--neon-green",
  "#00e0ff": "--neon-cyan",
  "#e6ff3a": "--neon-yellow",
  "#ff3ea5": "--neon-magenta",
  "#b14cff": "--neon-violet",
  "#03060a": "--bg-0",
  "#060a0f": "--bg-1",
  "#0a1015": "--bg-2",
  "#10171d": "--bg-3",
  "#e6f4ec": "--t-primary",
  "#9ab0a8": "--t-secondary",
  "#5a706a": "--t-tertiary",
  "#324036": "--t-faint",
};

function kebab(s: string): string {
  return s
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

export function pascalCase(s: string): string {
  const parts = s.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/);
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : `Component${name}`;
}

/** Resolve a color value to CSS, mapping XDesign variable refs and known
 * Orion tokens to `var(--…)`. */
export function colorToCss(value: string | undefined, variables: Variable[]): string {
  if (!value) return "transparent";
  if (value.startsWith("var:")) {
    const id = value.slice(4);
    const v = variables.find((x) => x.id === id);
    return v ? `var(--${kebab(v.name)})` : "transparent";
  }
  const hex = value.toLowerCase();
  if (TOKEN_BY_HEX[hex]) return `var(${TOKEN_BY_HEX[hex]})`;
  return value;
}

type Style = Record<string, string | number>;

function radiusCss(s: { radius?: number; radii?: [number, number, number, number] }): string | number | undefined {
  if (s.radii) return s.radii.map((r) => `${r}px`).join(" ");
  if (s.radius) return s.radius;
  return undefined;
}

/** Build the inline style for a shape, given whether its parent auto-lays-out
 * it (flow) or it's absolutely positioned. */
function styleFor(shape: Shape, parent: FrameShape | null, variables: Variable[]): Style {
  const flow = !!parent && parent.layoutMode && parent.layoutMode !== "none" && shape.layoutPositioning !== "absolute";
  const style: Style = {};

  if (!parent) {
    style.position = "relative";
  } else if (flow) {
    // flex child — size by layout sizing
    if (shape.layoutSizingH === "fill") style.alignSelf = "stretch";
  } else {
    style.position = "absolute";
    style.left = Math.round(shape.x - parent.x);
    style.top = Math.round(shape.y - parent.y);
  }

  if (!flow || shape.layoutSizingH === "fixed" || shape.kind !== "frame") {
    style.width = Math.round(shape.w);
  }
  if (!flow || shape.layoutSizingV === "fixed" || shape.kind !== "frame") {
    style.height = Math.round(shape.h);
  }
  if (flow && shape.layoutSizingH === "fill") { style.flex = "1 1 0%"; delete style.width; }

  // fill
  if (shape.fillGradient) {
    const g = shape.fillGradient;
    const stops = g.stops
      .map((st) => `${colorToCss(st.color, variables)} ${Math.round(st.offset * 100)}%`)
      .join(", ");
    const angle = "angle" in g ? g.angle : 90;
    style.background =
      g.kind === "radial"
        ? `radial-gradient(${stops})`
        : `linear-gradient(${angle}deg, ${stops})`;
  } else if (shape.kind !== "text") {
    const c = colorToCss(shape.fill, variables);
    if (c !== "transparent") style.background = c;
  }

  // stroke → border
  if (shape.strokeWidth > 0 && shape.stroke) {
    style.border = `${shape.strokeWidth}px solid ${colorToCss(shape.stroke, variables)}`;
  }

  const r = radiusCss(shape as FrameShape);
  if (r !== undefined) style.borderRadius = r;
  if (shape.kind === "ellipse") style.borderRadius = "50%";
  if (typeof shape.opacity === "number" && shape.opacity < 1) style.opacity = shape.opacity;
  if (shape.rotation) style.transform = `rotate(${shape.rotation}deg)`;
  if (shape.kind === "frame" && (shape as FrameShape).clipContent) style.overflow = "hidden";

  // auto-layout container
  if (shape.kind === "frame") {
    const f = shape as FrameShape;
    if (f.layoutMode && f.layoutMode !== "none") {
      style.display = "flex";
      style.flexDirection = f.layoutMode === "horizontal" ? "row" : "column";
      if (f.itemSpacing) style.gap = f.itemSpacing;
      const pt = f.paddingTop ?? 0, pr = f.paddingRight ?? 0, pb = f.paddingBottom ?? 0, pl = f.paddingLeft ?? 0;
      if (pt || pr || pb || pl) style.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
      const align = { min: "flex-start", center: "center", max: "flex-end", "space-between": "space-between" } as const;
      style.justifyContent = align[f.primaryAxisAlign ?? "min"];
      style.alignItems = ({ min: "flex-start", center: "center", max: "flex-end" } as const)[f.counterAxisAlign ?? "min"];
    }
  }

  // text styling
  if (shape.kind === "text") {
    const t = shape as TextShape;
    style.color = colorToCss(t.fill, variables);
    style.fontSize = t.fontSize;
    if (t.fontFamily) style.fontFamily = t.fontFamily;
    if (t.fontWeight) style.fontWeight = t.fontWeight;
    if (t.lineHeight) style.lineHeight = t.lineHeight;
    if (t.letterSpacing) style.letterSpacing = `${t.letterSpacing}px`;
    if (t.textAlign) style.textAlign = t.textAlign;
    if (t.textCase === "upper") style.textTransform = "uppercase";
    else if (t.textCase === "lower") style.textTransform = "lowercase";
    else if (t.textCase === "title") style.textTransform = "capitalize";
    if (t.textDecoration === "underline") style.textDecoration = "underline";
    else if (t.textDecoration === "strikethrough") style.textDecoration = "line-through";
  }

  return style;
}

function serializeStyle(style: Style): string {
  const entries = Object.entries(style).map(([k, v]) =>
    typeof v === "number" ? `${k}: ${v}` : `${k}: ${JSON.stringify(v)}`,
  );
  return `{ ${entries.join(", ")} }`;
}

function escapeJsxText(s: string): string {
  return s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`);
}

function renderShape(
  shape: Shape,
  parent: FrameShape | null,
  childrenOf: Map<string, Shape[]>,
  variables: Variable[],
  depth: number,
): string {
  if (shape.hidden) return "";
  const indent = "  ".repeat(depth);
  const style = serializeStyle(styleFor(shape, parent, variables));
  const kids = childrenOf.get(shape.id) ?? [];

  if (shape.kind === "text") {
    return `${indent}<div style={${style}}>${escapeJsxText((shape as TextShape).text || "")}</div>`;
  }
  if (shape.kind === "image") {
    return `${indent}<div style={${style}} />`;
  }
  if (kids.length === 0) {
    return `${indent}<div style={${style}} />`;
  }
  const inner = kids
    .map((k) => renderShape(k, shape.kind === "frame" ? (shape as FrameShape) : null, childrenOf, variables, depth + 1))
    .filter(Boolean)
    .join("\n");
  return `${indent}<div style={${style}}>\n${inner}\n${indent}</div>`;
}

/** Generate a complete .tsx component string from a root shape (usually a
 * frame) and the full shape list. */
export function generateComponent(
  rootId: string,
  shapes: Shape[],
  variables: Variable[],
): { componentName: string; code: string } | null {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const root = byId.get(rootId);
  if (!root) return null;

  const childrenOf = new Map<string, Shape[]>();
  for (const s of shapes) {
    if (s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s);
      childrenOf.set(s.parentId, arr);
    }
  }
  // Render order = array order (bottom→top), already correct.

  const componentName = pascalCase(root.name || "ExportedComponent");
  const body = renderShape(root, null, childrenOf, variables, 2);
  const code = `export function ${componentName}() {
  return (
${body}
  );
}
`;
  return { componentName, code };
}
