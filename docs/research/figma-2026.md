# Figma research — June 2026 (Phase 3 ground truth)

Condensed from two web passes (features + sentiment) + a code audit of XDesign.

## Strategic thesis: design→code is THE wedge
Figma's four most-cited 2026 weaknesses map 1:1 onto XDesign's structural advantages:
| Figma weakness (sourced, 2026) | XDesign's answer |
|---|---|
| **Code output officially "NOT production-ready"** (Figma's own MCP docs) — emulates CSS in WebGL, ships absolute-positioned inline-style React | Generate **real React + Orion's own design tokens** as a **reviewable staged edit into the actual repo** (reuse the P2a/P2b pending-edit + DiffReview infra) |
| MCP = context for an **external** agent that doesn't know your codebase | Embedded Claude lives **in** the repo, editor next door, shared tokens |
| Figma Make AI is "gimmicky AND destructive" — mutates unrelated pages, degrades per prompt | AI edits **local, scoped, Accept/Reject-reviewable** (trust by reversibility) |
| No offline / cloud-only / seat-pricing backlash | **Local-first, single-player**, no cloud, no seat tax |

The ONE Figma strength we don't contest is real-time multiplayer — and single-player users explicitly don't need it (it's what Sketch/Penpot defectors happily trade away). Build-first AI tools (Cursor/v0/Claude) are narrowing Figma to "exploration only" — XDesign sits between: build-first speed WITHOUT abandoning a real canvas, local-first like Sketch/Penpot.

## Figma daily 80% (what to match)
- **Canvas feel**: smart guides + **alt-hover measurement** (signature), snap-to-pixel, rulers/guides, layout grids. Selection: single=top parent, **double-click/Enter drills in**, **⌘-click deep-select to leaf**, Tab cycles siblings, ⌘A select-all, marquee. Space-drag pan, ⌘/pinch zoom-to-cursor, Shift+0/1/2 fit. GPU canvas (WebGPU since 2025) — glassy until files get huge; big files still lag ("death banner").
- **Vector**: vector networks (branching paths), pen (click=corner, drag=bezier), **boolean ops union/subtract/intersect/exclude (non-destructive)**, Shape Builder, stroke align/caps/joins/dashes, per-corner radius + smoothing (squircles).
- **Layout**: auto-layout (H/V/**Grid**, gap incl. space-between, padding, 9-pt align, **wrap**, **Fill/Hug/Fixed + min/max**, "ignore auto layout" absolute children) + **constraints** (pin/center/scale on resize).
- **Components/variables**: components+instances+**overrides that survive updates**, **variants (component sets w/ properties: boolean/text/instance-swap/variant)**, variables (color/number/string/bool, **modes**, aliasing, scoping), styles, libraries.
- **Prototyping**: hotspots/connections, triggers (click/hover/drag/delay), **Smart Animate**, overlays, variables+conditionals+expressions, present mode.
- **AI/design→code**: First Draft (prompt→screen), rename layers, remove-bg, Dev Mode (CSS/iOS/Android), **Dev Mode MCP server** (structured design tree→agent), Code Connect (map node→real component), Figma Make (prompt→app, much-criticized).
- **Top daily workflows**: nudge+align w/ smart guides · frame+auto-layout a card · create/swap instances+variants · text+type ramp · apply tokens · switch variable mode · responsive resize · build component w/ variants · prototype click-through · pen/boolean an icon · export asset · rename/reparent layers · place+treat images · layout grid+measure · **hand off to code (Dev Mode/MCP/Make)**.

## XDesign audit verdict (current code)
| Area | Verdict |
|---|---|
| Canvas/rendering | PARTIAL — SVG, NO virtualization → ~few-hundred-node ceiling |
| Shape model/properties | STRONG — gradients(+angular)/per-corner radii/stroke-align/stacked effects/flip/lock (no line/polygon/blend-modes) |
| Selection/interaction | STRONG — click/shift/marquee/8-resize/rotate/**snapping+smart guides**/nudge/space-pan/zoom shortcuts; **MISSING double-click-into-frame/deep-select/select-all/alt-measure** |
| Vector/pen | PARTIAL — pen DRAWS beziers; **NO path-editing after commit, NO booleans** |
| Layout/hierarchy | PARTIAL — groups + **real auto-layout STRONG**; **constraints MISSING** |
| Components/variables | PARTIAL — instances+color/number vars+modes+ColorField picker work; **variants MISSING; instance-sync lossy (no override tracking)** |
| Inspector | STRONG single-select; **multi-select READ-ONLY** |
| Export | PARTIAL — PNG/SVG yes; **design→code ENTIRELY ABSENT (the wedge)** |
| AI/Claude rail | STRONG + differentiator — ~30-op command DSL via MCP, vision loop, generative; only gap = screenshot→editable-layers |
| Stores/undo/pages | STRONG — snapshot undo (per-page, agent-coalesced), multi-page |

Strengths to PRESERVE: the AI command DSL + vision agent (Figma's stock product can't match it), per-turn-coalesced undo.

## Ranked plan (impact-ordered — wedge first)
1. **Design→code (the wedge)** — export any frame/selection → real React + Orion design tokens, written into the file tree as a **reviewable staged edit** (reuse pendingEditsStore + DiffReview); + screenshot→editable-layers (vision reconstruction). Highest integration leverage + strategic centerpiece.
2. **Canvas feel + interaction** — double-click-into-frame / ⌘-click deep-select / select-all / alt-hover measurement / multi-select inspector batch-edit / viewport culling for 500+ nodes.
3. **Vector depth** — boolean ops (union/subtract/intersect/exclude; approved geometry dep) + post-hoc path/anchor editing.
4. **Layout systems** — constraints (pin/center/scale on resize) + component variants (sets w/ properties) + non-lossy instance overrides.
5. **Prototyping lite** — hotspot links between frames, present mode, simple transitions.

CUT (explicit): vector networks (branching) · Figma Draw brush/illustration · real-time multiplayer · variable scoping/aliasing depth · full WebGL/WebGPU renderer rewrite (do culling, not a renderer swap) · Code-Connect-style component mapping (later).
