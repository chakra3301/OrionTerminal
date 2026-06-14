# XDesign — Claude as Composer (v1) — design spec

**Date:** 2026-06-14
**Status:** approved (user)
**Track:** XDesign north star — "Figma + Claude design": Claude composes
*native, editable* designs at frontend-design quality; the user holds every
tool to edit + iterate. This is **Layer 1 (the composer)** — the headline gap.

## Problem

Today Claude builds on the XDesign canvas through a raw-primitive command DSL
(`orion_xdesign_apply` → array of `rect/ellipse/text/frame/path/update/group`).
It can place shapes but has no auto-layout, components, styles, design-system, or
images to compose with — so it can't produce a structured, on-brand, *editable*
design the way "Claude design" produces a polished prototype. Result is absolute-
positioned primitives, not something you can iterate on.

## Goal

Claude takes a brief and emits a **complete, structured design** composed of
native XDesign objects — auto-layout frames, a color-variable design system,
real text/shape nodes — at `frontend-design`-skill quality, ingested as **one
reversible batch**. Every node is selectable and editable with existing tools;
changing a color variable re-themes the whole design.

## Non-goals (v1 — deferred to later slices)

- Components/instances expressed in the plan (Layer C).
- Named text styles as first-class entities (Layer 2) — v1 applies typography
  inline (fontSize/weight/lineHeight on text nodes).
- Multi-screen flows (v1 = one screen/artboard).
- Real image generation/editing (Layer B — Adobe connector).
- No Rust change; no new migration. Frontend-only → hot-reloads.

## Approach — DesignPlan + ingester over Phase-3 machinery

Claude emits **one fenced ` ```xd-design ` JSON block** in its rail reply (mirrors
today's fenced canvas-command parsing — no Rust change). A pure parser extracts
it; a pure transform turns it into the native object graph; a thin store glue
ingests it as one undo step.

### Schema (`DesignPlan`)

```
{
  tokens: { colors: [{ name: string, value: "#rrggbb" }, …] },
  screen: {
    name: string, w: number, h: number,
    fill?: string,                         // literal or "color/<token>"
    layout?: { mode: "vertical"|"horizontal"|"none", padding?, gap?,
               primaryAlign?, counterAlign? },
    children: Node[]
  }
}
Node = {
  type: "frame"|"text"|"rect"|"ellipse"|"image",
  name?: string,
  w?: number, h?: number,
  sizingH?: "hug"|"fill"|"fixed", sizingV?: …,
  fill?: string,                            // literal or "color/<token>"
  radius?: number,
  text?: string, fontSize?, fontWeight?, lineHeight?, textAlign?,
  effects?: Effect[],                       // shadow only in v1
  layout?: { … },                           // for frames
  children?: Node[]
}
```

Color refs are `"color/<tokenName>"` → resolved to `var:<variableId>` so the
result is restyleable through the existing variables/modes system.

### Components / modules

1. **`designPlan.ts` (pure, unit-tested) — the heart.**
   - `parseDesignPlan(text): DesignPlan | null` — extract the fenced block,
     `JSON.parse`, validate + coerce (defaults for missing fields; reject if no
     `screen`).
   - `planToShapes(plan, ids): { shapes: Shape[]; variables: VarSeed[] }` — walk
     the tree → flat `Shape[]` with `parentId`, auto-layout fields
     (`layoutMode`/padding/`itemSpacing`/`layoutSizingH/V`/`primaryAxisAlign`/
     `counterAxisAlign`), resolved fills (literal or `var:` ref), text props.
     Pure: ids injected by the caller (no `ulid()` inside) so it's deterministic
     and testable. Coordinates: children of auto-layout frames get placeholder
     x/y (the layout engine positions them at render); the root screen frame is
     placed at a sensible canvas spot.

2. **`ingestDesignPlan(plan)` (store glue).**
   - `beginHistoryCoalesce()` → for each token color `addVariable` (dedupe by
     name; reuse existing var if present) → build id map → `planToShapes` →
     splice shapes into the store → select + zoom-to the root →
     `endHistoryCoalesce()`. One undo step. Toast: "Design generated · ⌘Z to
     undo".

3. **Rail integration (`claudeCommands.ts` / `XDesignClaudeRail`).**
   - System-prompt section teaching Claude the schema + `frontend-design`
     principles (distinctive type, deliberate color system, spacing rhythm,
     hierarchy) and "emit ONE ` ```xd-design ` block".
   - On reply: if a `xd-design` block is present, `parseDesignPlan` →
     `ingestDesignPlan`; strip the block from the visible message (like
     `stripCanvasCommands`).
   - A "✦ Generate design" affordance in the rail that seeds the prompt.

## Reversibility

Ingest is wrapped in the existing history-coalesce so the whole generation is a
single undo. "Reject" = ⌘Z. (A richer staged Accept/Reject preview is a later
enhancement; one-undo is sufficient and already-built.)

## Files

- NEW `src/apps/xdesign/designPlan.ts` (+ `designPlan.test.ts`).
- `src/apps/xdesign/claudeCommands.ts` — detect + ingest path (mirror the
  existing canvas-command parse/strip).
- `src/apps/xdesign/XDesignClaudeRail.tsx` — "✦ Generate" affordance + wire
  detection into the reply handler.
- System-prompt text (where the XDesign rail prompt lives).

## Testing / verification

- `designPlan.ts` pure tests: parse (valid / fenced / malformed / missing
  screen), `planToShapes` (auto-layout fields set, parentId wiring, color-token
  → `var:` resolution, literal fills, text props, nesting, id injection).
- `npx tsc --noEmit`, `npx vitest run` (extend the 354), `npx vite build` green.
- UI human-verified on hot-reload (agent can't run Tauri): generate a design →
  it appears as auto-layout frames + variables; select/edit nodes; change the
  `brand` color var and watch it re-theme; ⌘Z removes the whole thing.

## Risks

- Claude emitting invalid/oversized JSON → `parseDesignPlan` validates + coerces
  and fails soft (toast "couldn't read the design plan"), never throws into the
  rail.
- Auto-layout sizing edge cases (hug/fill) producing collapsed frames → planner
  sets sensible fixed fallbacks; the user can adjust (it's editable — that's the
  point).
- Token efficiency: one JSON payload per generation (cheaper than 50 tool
  calls); large designs may hit reply limits → v1 targets one screen.
