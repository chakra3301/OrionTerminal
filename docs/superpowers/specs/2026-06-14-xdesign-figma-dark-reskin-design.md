# XDesign → Figma-dark reskin — design spec

**Date:** 2026-06-14
**Status:** approved (user)
**Type:** visual reskin (scoped, no logic changes)

## Problem

XDesign's neon-on-black aesthetic is impractical to work in (see user screenshot):
near-transparent panels (`rgba(0,0,0,0.18)`) let the canvas grid/wallpaper bleed
through so text floats; the global *greenish* low-contrast text tokens are hard
to read; labels are tiny uppercase 0.2em mono; selection is dashed hairlines; the
"magenta" accent was already swapped to a faint gray used at 0.08–0.3 alpha so
nothing reads as active.

## Goal

A clean, practical, **Figma dark-mode**-style UI for XDesign: neutral graphite
surfaces, high-contrast neutral text, one blue accent used sparingly, solid
panels, and solid Figma-style selection. Cohesive with Orion's dark shell.

## Non-goals

- Light mode (rejected — would clash with the dark window chrome/menubar/dock).
- Touching Archives / Orion / shell / dock, or any pure-logic file.
- New font dependency (use `system-ui` → SF Pro on mac; the Figma-on-mac look).
- Restructuring components or behavior. Pure visual.

## Approach — scoped theme

Everything renders under `.xd-shell`, so override a local token set there and
restyle the `.xd-*` rules. Blast radius is contained to XDesign.

### Scoped palette (`.xd-shell`)

```
--xd-bg:      #1e1e1e   canvas base
--xd-panel:   #2c2c2c   tool rail · layers · inspector (OPAQUE)
--xd-raised:  #383838   inputs · raised controls
--xd-hover:   rgba(255,255,255,0.06)
--xd-border:  #454545   dividers
--xd-text:    #e6e6e6   primary
--xd-text-2:  #b3b3b3   labels / secondary
--xd-text-3:  #8a8a8a   tertiary / hover-reveal actions
--xd-accent:  #0d99ff   selection · active · primary
--xd-accent-rgb: 13,153,255
font-family: system-ui, -apple-system, "SF Pro Text", Inter, sans-serif;
```

Inside `.xd-shell`, remap globals so inherited components recolor for free:
`--t-primary/secondary/tertiary/faint` → the `--xd-text*` ramp;
`--neon-magenta[-rgb]` → `--xd-accent[-rgb]` (already the pattern today);
`--shadow-glow-magenta` → a soft blue glow.

## Slices (commit each; green per slice)

1. **Palette + surfaces** — the `.xd-shell` token scope; opaque `--xd-panel`
   rails/layers/inspector with 1px `--xd-border`; `--xd-bg` canvas + faint
   neutral dot grid; section headings → ~11px normal-case medium `--xd-text-2`.
2. **Selection & handles (Canvas.tsx SVG)** — selection bbox dashed → solid 1px
   `#0d99ff`; resize handles → ~7px white-fill squares + 1px blue border;
   marquee → blue line + `#0d99ff14` fill; shape hover → blue outline;
   constraint pin + path-edit overlays recolor to blue.
3. **Controls** — tool rail active = blue icon + blue-tint fill; layer rows
   (~28px, hover fill, selected blue-tint + bright label, hover-reveal actions);
   inspector inputs `--xd-raised` fill + blue focus border; Boolean/Align/
   Constraint rows as solid segmented buttons.
4. **Floating chrome** — AlignBar pill, "Ask Design Partner" FAB, ▶ Present
   launch, canvas HUD → solid-panel + blue-accent language, normal-case text.

## Files

- `src/styles/tokens.css` — `.xd-shell` scope + all `.xd-*` rules (bulk).
- `src/apps/xdesign/Canvas.tsx` — selection / handle / marquee / overlay SVG
  colors + dash removal.

## Testing / verification

- `npx tsc --noEmit`, `npx vitest run` (354), `npx vite build` stay green per
  slice (no logic touched).
- UI is **human-verified** on hot-reload (agent can't run Tauri). Per slice, the
  user eyeballs: panels solid + readable, selection solid blue, controls legible.

## Risks

- A hardcoded neon literal hiding inside an XDesign surface. Mitigated: the audit
  shows they were converted to `--xd-accent-rgb`, so remapping the token
  recolors them; a grep for stray `rgba(57,255` / `#39ff` / `#ff3ea5` inside the
  `.xd-*` block is part of slice 1.
- The Claude rail inherits the remapped tokens → goes neutral-dark (desired).
