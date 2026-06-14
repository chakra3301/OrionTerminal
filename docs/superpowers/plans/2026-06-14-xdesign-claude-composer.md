# XDesign Claude Composer (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude compose a complete, structured, editable design from a brief — emitted as one fenced `xd-design` JSON block, ingested into native auto-layout frames + color variables as a single reversible batch.

**Architecture:** Claude returns one ` ```xd-design ` JSON block in its rail reply (same pattern as today's fenced canvas-commands). A pure module (`designPlan.ts`) parses it and transforms the node tree → flat `Shape[]` (+ color-variable seeds) using the Phase-3 auto-layout fields. A thin store glue (`ingestDesignPlan`) creates the variables, resolves `color/<token>` refs to `var:<id>`, and appends the shapes via a new `addShapesBatch` action (one undo step). The rail detects the block on reply and ingests; a "✦ Generate" button seeds the composer prompt.

**Tech Stack:** React 19 + TS, Zustand store (`useXDesign`), vitest. Frontend-only — no Rust, no migration, hot-reloads.

---

## File Structure

- Create `src/apps/xdesign/designPlan.ts` — pure: schema types, `parseDesignPlan`, `planToShapes`, `resolveColorRefs`.
- Create `src/apps/xdesign/designPlan.test.ts` — unit tests for the above.
- Modify `src/apps/xdesign/store.ts` — add `addShapesBatch(shapes, selectId?)`.
- Create `src/apps/xdesign/ingestDesignPlan.ts` — store glue (create vars → resolve refs → batch-add → select).
- Modify `src/apps/xdesign/claude.ts` — export `COMPOSER_PROMPT`.
- Modify `src/apps/xdesign/XDesignClaudeRail.tsx` — detect+ingest on reply, strip from visible text, "✦ Generate" button.

---

## Task 1: DesignPlan types + `parseDesignPlan`

**Files:**
- Create: `src/apps/xdesign/designPlan.ts`
- Test: `src/apps/xdesign/designPlan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseDesignPlan } from "./designPlan";

const block = (json: string) => "Here is a landing page.\n\n```xd-design\n" + json + "\n```";

describe("parseDesignPlan", () => {
  it("extracts and parses a fenced xd-design block", () => {
    const p = parseDesignPlan(block('{"tokens":{"colors":[{"name":"brand","value":"#0d99ff"}]},"screen":{"name":"L","w":1440,"h":1024,"children":[]}}'));
    expect(p?.screen.name).toBe("L");
    expect(p?.tokens.colors[0]).toEqual({ name: "brand", value: "#0d99ff" });
  });
  it("returns null when there is no block", () => {
    expect(parseDesignPlan("just some prose")).toBeNull();
  });
  it("returns null on malformed JSON (fails soft)", () => {
    expect(parseDesignPlan(block("{ not json"))).toBeNull();
  });
  it("returns null when screen is missing", () => {
    expect(parseDesignPlan(block('{"tokens":{"colors":[]}}'))).toBeNull();
  });
  it("defaults missing tokens/children to empty", () => {
    const p = parseDesignPlan(block('{"screen":{"name":"L","w":100,"h":100}}'));
    expect(p?.tokens.colors).toEqual([]);
    expect(p?.screen.children).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/xdesign/designPlan.test.ts`
Expected: FAIL — cannot find module `./designPlan`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/apps/xdesign/designPlan.ts
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

export function parseDesignPlan(text: string): DesignPlan | null {
  const m = text.match(FENCE);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!.trim());
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/xdesign/designPlan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/xdesign/designPlan.ts src/apps/xdesign/designPlan.test.ts
git commit -m "feat(xdesign): DesignPlan schema + parseDesignPlan (composer 1)"
```

---

## Task 2: `planToShapes` + `resolveColorRefs`

**Files:**
- Modify: `src/apps/xdesign/designPlan.ts`
- Test: `src/apps/xdesign/designPlan.test.ts`

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { planToShapes, resolveColorRefs } from "./designPlan";

describe("planToShapes", () => {
  const plan = parseDesignPlan(
    "x\n```xd-design\n" +
      JSON.stringify({
        tokens: { colors: [{ name: "brand", value: "#0d99ff" }] },
        screen: {
          name: "Landing", w: 1440, h: 1024, fill: "color/brand",
          layout: { mode: "vertical", padding: 64, gap: 48, counterAlign: "center" },
          children: [
            { type: "text", text: "Hi", fontSize: 56, fontWeight: 700, fill: "#ffffff" },
            { type: "frame", name: "Row", layout: { mode: "horizontal", gap: 24 },
              children: [{ type: "rect", w: 100, h: 100, fill: "color/brand", radius: 8 }] },
          ],
        },
      }) +
      "\n```",
  )!;

  it("creates a root frame with auto-layout fields from the screen", () => {
    let n = 0;
    const { shapes } = planToShapes(plan, () => `id${n++}`);
    const root = shapes[0]!;
    expect(root.kind).toBe("frame");
    expect((root as { layoutMode?: string }).layoutMode).toBe("vertical");
    expect((root as { paddingTop?: number }).paddingTop).toBe(64);
    expect((root as { itemSpacing?: number }).itemSpacing).toBe(48);
    expect((root as { counterAxisAlign?: string }).counterAxisAlign).toBe("center");
    expect(root.parentId ?? null).toBeNull();
  });

  it("wires children to their parent and keeps color refs as color/<name>", () => {
    let n = 0;
    const { shapes } = planToShapes(plan, () => `id${n++}`);
    const root = shapes[0]!;
    const text = shapes.find((s) => s.kind === "text")!;
    expect(text.parentId).toBe(root.id);
    expect((text as { text: string }).text).toBe("Hi");
    expect((text as { fontSize?: number }).fontSize).toBe(56);
    expect(text.fill).toBe("#ffffff");
    const rect = shapes.find((s) => s.kind === "rect")!;
    const row = shapes.find((s) => s.name === "Row")!;
    expect(rect.parentId).toBe(row.id);
    expect(rect.fill).toBe("color/brand"); // ref preserved; resolved later
  });

  it("emits the color seeds", () => {
    let n = 0;
    const { variables } = planToShapes(plan, () => `id${n++}`);
    expect(variables).toEqual([{ name: "brand", value: "#0d99ff" }]);
  });
});

describe("resolveColorRefs", () => {
  it("rewrites color/<name> fills to var:<id> using the name→id map", () => {
    const shapes = [
      { id: "a", kind: "rect", name: "a", x: 0, y: 0, w: 1, h: 1, fill: "color/brand", stroke: "transparent", strokeWidth: 0 },
      { id: "b", kind: "rect", name: "b", x: 0, y: 0, w: 1, h: 1, fill: "#fff", stroke: "transparent", strokeWidth: 0 },
    ] as never[];
    const out = resolveColorRefs(shapes, new Map([["brand", "VAR1"]]));
    expect(out[0]!.fill).toBe("var:VAR1");
    expect(out[1]!.fill).toBe("#fff"); // literal untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/xdesign/designPlan.test.ts`
Expected: FAIL — `planToShapes`/`resolveColorRefs` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `designPlan.ts`)

```ts
import type { Shape } from "./store";

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

function baseFields(node: PlanNode) {
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

/** node "image" has no real source in v1 → render as a filled rect placeholder. */
function kindFor(t: PlanNode["type"]): Shape["kind"] {
  return t === "image" ? "rect" : (t as Shape["kind"]);
}

/** Walk the plan into a flat Shape[] (+ color seeds). ids are injected so the
 * transform stays pure/deterministic. Children of auto-layout frames get
 * placeholder x/y — computeAutoLayout positions them at render. */
export function planToShapes(
  plan: DesignPlan,
  newId: () => string,
): { shapes: Shape[]; variables: { name: string; value: string }[] } {
  const shapes: Shape[] = [];

  const rootId = newId();
  shapes.push({
    id: rootId,
    name: plan.screen.name,
    kind: "frame",
    x: ROOT_X,
    y: ROOT_Y,
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
      x: ROOT_X,
      y: ROOT_Y,
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

/** Rewrite fills of the form "color/<name>" to "var:<id>" using a name→id map.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/xdesign/designPlan.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/apps/xdesign/designPlan.ts src/apps/xdesign/designPlan.test.ts
git commit -m "feat(xdesign): planToShapes + resolveColorRefs (composer 2)"
```

---

## Task 3: `addShapesBatch` store action

**Files:**
- Modify: `src/apps/xdesign/store.ts` (type decl in `XDesignState`; impl in the store object)
- Test: `src/apps/xdesign/composerStore.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// src/apps/xdesign/composerStore.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useXDesign, type Shape } from "./store";

const rect = (id: string, parentId: string | null = null): Shape =>
  ({ id, name: id, kind: "rect", x: 0, y: 0, w: 10, h: 10, radius: 0,
     fill: "#fff", stroke: "transparent", strokeWidth: 0, parentId }) as Shape;

describe("addShapesBatch", () => {
  beforeEach(() => useXDesign.setState({ shapes: [], selection: new Set(), past: [], future: [] }));

  it("appends all shapes in one history step and selects the root", () => {
    useXDesign.getState().addShapesBatch([rect("root"), rect("child", "root")], "root");
    const s = useXDesign.getState();
    expect(s.shapes.map((x) => x.id)).toEqual(["root", "child"]);
    expect(s.past).toHaveLength(1); // one undo step
    expect([...s.selection]).toEqual(["root"]);
  });

  it("undo removes the whole batch", () => {
    useXDesign.getState().addShapesBatch([rect("a"), rect("b")]);
    useXDesign.getState().undo();
    expect(useXDesign.getState().shapes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/xdesign/composerStore.test.ts`
Expected: FAIL — `addShapesBatch` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `src/apps/xdesign/store.ts`, add to the `XDesignState` type (near `patchMany`):

```ts
  /** Append a pre-built batch of shapes in a single undo step (used by the
   * Claude composer). Optionally selects `selectId`. */
  addShapesBatch: (shapes: Shape[], selectId?: string) => void;
```

And add the implementation to the store object (near `patchMany`):

```ts
  addShapesBatch: (shapes, selectId) => {
    if (shapes.length === 0) return;
    get().pushHistory();
    set((s) => ({
      shapes: [...s.shapes, ...shapes],
      selection: selectId ? new Set([selectId]) : s.selection,
    }));
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/xdesign/composerStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/xdesign/store.ts src/apps/xdesign/composerStore.test.ts
git commit -m "feat(xdesign): addShapesBatch store action (composer 3)"
```

---

## Task 4: `ingestDesignPlan` glue

**Files:**
- Create: `src/apps/xdesign/ingestDesignPlan.ts`
- Test: `src/apps/xdesign/composerStore.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append)

```ts
import { ingestDesignPlan } from "./ingestDesignPlan";
import { parseDesignPlan } from "./designPlan";

describe("ingestDesignPlan", () => {
  beforeEach(() =>
    useXDesign.setState({ shapes: [], selection: new Set(), past: [], future: [], variables: [], modes: [{ id: "m", name: "Default" }], activeModeId: "m" }),
  );

  it("creates color variables, resolves refs, and adds the shape graph", () => {
    const plan = parseDesignPlan(
      "x\n```xd-design\n" +
        JSON.stringify({
          tokens: { colors: [{ name: "brand", value: "#0d99ff" }] },
          screen: { name: "L", w: 200, h: 200, fill: "color/brand",
            layout: { mode: "vertical" }, children: [{ type: "rect", fill: "color/brand" }] },
        }) +
        "\n```",
    )!;
    ingestDesignPlan(plan);
    const s = useXDesign.getState();
    expect(s.variables).toHaveLength(1);
    const varId = s.variables[0]!.id;
    const root = s.shapes[0]!;
    expect(root.fill).toBe(`var:${varId}`);
    const rect = s.shapes.find((x) => x.kind === "rect")!;
    expect(rect.fill).toBe(`var:${varId}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/xdesign/composerStore.test.ts`
Expected: FAIL — cannot find module `./ingestDesignPlan`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/apps/xdesign/ingestDesignPlan.ts
import { ulid } from "ulid";
import { useXDesign } from "./store";
import { planToShapes, resolveColorRefs, type DesignPlan } from "./designPlan";
import { toast } from "@/store/toastStore";

/** Build a DesignPlan into the live document as one undo step: create (or
 * reuse) the color variables, resolve color/<name> refs to var ids, then
 * append the auto-layout shape graph and select the root. */
export function ingestDesignPlan(plan: DesignPlan): void {
  const store = useXDesign.getState();

  // Create or reuse color variables by name; build name→id map.
  const nameToId = new Map<string, string>();
  for (const v of store.variables) nameToId.set(v.name, v.id);
  for (const c of plan.tokens.colors) {
    const existing = nameToId.get(c.name);
    if (existing) {
      store.setVariableValue(existing, store.activeModeId, c.value);
    } else {
      const id = store.addVariable(c.name, c.value, "color");
      nameToId.set(c.name, id);
    }
  }

  const { shapes } = planToShapes(plan, () => ulid());
  const resolved = resolveColorRefs(shapes, nameToId);
  if (resolved.length === 0) return;
  useXDesign.getState().addShapesBatch(resolved, resolved[0]!.id);
  toast.success("Design generated", { body: "⌘Z to undo" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/xdesign/composerStore.test.ts`
Expected: PASS. (Toast is a no-op in the test env; if it throws, the test will surface it.)

- [ ] **Step 5: Commit**

```bash
git add src/apps/xdesign/ingestDesignPlan.ts src/apps/xdesign/composerStore.test.ts
git commit -m "feat(xdesign): ingestDesignPlan glue — vars + refs + batch (composer 4)"
```

---

## Task 5: Rail integration — detect, ingest, strip, Generate button

**Files:**
- Modify: `src/apps/xdesign/claude.ts` (add `COMPOSER_PROMPT`)
- Modify: `src/apps/xdesign/XDesignClaudeRail.tsx`

> No automated test (UI + live Claude). Verified manually on hot-reload.

- [ ] **Step 1: Add the composer prompt constant**

In `src/apps/xdesign/claude.ts`, export:

```ts
export const COMPOSER_PROMPT = `You are an elite product designer with sharp, distinctive taste — the kind of work that tops the Figma community and feels handcrafted by a senior design engineer. You compose complete, polished, on-brand UI. You do not produce AI slop: no timid evenly-spread palettes, no predictable centered-hero-plus-three-cards, no Inter-on-everything. Commit to a clear aesthetic point of view and execute it with conviction.

First, choose a direction and commit: refined/minimal, bold/editorial, brutalist, retro-futuristic, warm/organic, high-contrast/technical — pick one and let it dictate every decision. Then build a small design system before drawing anything:

Define named color tokens with concrete hex values — at minimum brand, surface, surface-2, ink, ink-muted, accent, line. Give the design ONE dominant color and sharp, intentional accents; avoid muddy mid-tones and equal-weight palettes. Reference every color as "color/<tokenName>" everywhere — never repeat raw hex literals in nodes — so the whole design is restyleable from the token set.

Build a deliberate type scale: a display size, headings, body, and caption, each with intentional fontSize / fontWeight / lineHeight set inline on text nodes. Establish real hierarchy — large confident display type, restrained body, clear contrast in weight and size.

Compose ONE desktop screen, 1440 wide, using AUTO-LAYOUT frames — vertical/horizontal stacks with padding, gap, and alignment — never absolute positioning. Nest frames for each section (nav, hero, feature grid, CTA, footer, etc.). Every region that stacks content is a frame with its own layout. Use real-world sizing and spacing, generous and intentional. Prefer 5–9 top-level sections. Use "image" nodes filled with a token color as placeholders for imagery — never real URLs. Write realistic copy with a real product voice — never lorem ipsum.

Output contract — return EXACTLY one fenced code block tagged xd-design containing valid JSON matching this schema (no comments, no trailing commas, no extra keys):

\`\`\`xd-design
{ "tokens": { "colors": [ { "name": "brand", "value": "#0d99ff" } ] },
  "screen": { "name": "Landing", "w": 1440, "h": 1024, "fill": "color/surface",
    "layout": { "mode": "vertical", "padding": 64, "gap": 48, "primaryAlign": "min", "counterAlign": "center" },
    "children": [ <Node> ] } }
\`\`\`

Node = { "type": "frame"|"text"|"rect"|"ellipse"|"image", "name"?, "w"?, "h"?,
  "sizingH"?: "hug"|"fill"|"fixed", "sizingV"?: "hug"|"fill"|"fixed",
  "fill"?: "color/<token>" or "#hex", "radius"?,
  "text"?, "fontSize"?, "fontWeight"?, "lineHeight"?, "textAlign"?: "left"|"center"|"right",
  "effects"?: [ { "kind":"shadow", "type":"drop", "offsetX","offsetY","blur","color" } ],
  "layout"?: { same shape as screen.layout }, "children"?: [ Node ] }

Write ONE sentence describing the design before the code block, and nothing after it. Output valid JSON only inside the block.`;
```

- [ ] **Step 2: Wire detection + ingest into the reply handler**

In `XDesignClaudeRail.tsx`, add imports:

```ts
import { parseDesignPlan } from "@/apps/xdesign/designPlan";
import { ingestDesignPlan } from "@/apps/xdesign/ingestDesignPlan";
import { COMPOSER_PROMPT } from "@/apps/xdesign/claude";
```

In the effect that currently runs (around L106-114):

```ts
    const cmds = parseCanvasCommands(last.content);
    // ...existing
    const { applied } = runCanvasCommands(cmds);
```

add, before/after the canvas-command run:

```ts
    const plan = parseDesignPlan(last.content);
    if (plan) ingestDesignPlan(plan);
```

(A reply is either a design plan or canvas commands; running both is harmless since `parseCanvasCommands` won't match the `xd-design` block.)

- [ ] **Step 3: Strip the block from the visible transcript**

At the message-mapping line (around L260) that does `stripCanvasCommands(m.content)`, also strip the design block. Add a tiny helper in `designPlan.ts`:

```ts
export function stripDesignPlan(text: string): string {
  return text.replace(/```xd-design\s*\n[\s\S]*?```/g, "").trim();
}
```

import it and compose:

```ts
m.role === "assistant" ? stripDesignPlan(stripCanvasCommands(m.content)) : m.content,
```

- [ ] **Step 4: Add the "✦ Generate design" button**

In the rail panel header (near the existing close button), add a button that prefixes the composer prompt onto the user's next send. Minimal approach — a button that, when the input has text, sends it as a brief; otherwise focuses the input:

```tsx
<button
  type="button"
  className="xd-mini-btn"
  style={{ width: "auto", padding: "0 8px" }}
  title="Generate a full design from a brief"
  onClick={() => handleSend(`${COMPOSER_PROMPT}\n\n---\n\nBRIEF: ${draftRef.current || "a clean modern landing page"}`)}
>
  ✦ Generate
</button>
```

If `handleSend` reads from the ClaudeChat input rather than an arg, instead expose the composer intent by prepending `COMPOSER_PROMPT` in `handleSend` when a `composeNext` ref is set; set that ref when the button is clicked, then trigger send. (Match the rail's actual send signature — read `handleSend` at L232 first and adapt; the contract is: the message Claude receives must start with `COMPOSER_PROMPT`.)

- [ ] **Step 5: Verify build + manual smoke**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all green.

Manual (user, hot-reload): open XDesign → Claude rail → ✦ Generate (or type "a pricing page for a dev tool, dark, bold" and Generate) → a full auto-layout design appears as editable frames; the Variables panel shows the color tokens; select nodes and edit; change the `brand` variable → design re-themes; ⌘Z removes the whole generation.

- [ ] **Step 6: Commit**

```bash
git add src/apps/xdesign/claude.ts src/apps/xdesign/XDesignClaudeRail.tsx src/apps/xdesign/designPlan.ts
git commit -m "feat(xdesign): Claude composer rail integration + Generate (composer 5)"
```

---

## Self-Review notes

- **Spec coverage:** schema (T1), planToShapes+auto-layout+var refs (T2), one-undo batch (T3), ingest=vars+resolve+add (T4), rail detect/ingest/strip + Generate + frontend-design prompt (T5). Reversibility = `addShapesBatch` single history step (T3 test asserts undo). Fail-soft parse (T1 malformed→null). All covered.
- **Deferred (documented in spec):** components/text-styles/multi-screen/real-images — not in any task by design.
- **Type consistency:** `DesignPlan`/`PlanNode`/`planToShapes`/`resolveColorRefs`/`addShapesBatch`/`ingestDesignPlan`/`COMPOSER_PROMPT`/`stripDesignPlan` names are used identically across tasks.
- **Known caveat:** variables are not in the shape-history stack, so ⌘Z removes the shapes but leaves the (additive, dedup-by-name) color variables — harmless; re-generating reuses them. Noted in spec risks.
