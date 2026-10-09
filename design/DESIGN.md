# Orion Terminal — Design

Moved verbatim from the "Design tokens" section of the old CLAUDE.md (2026-10-09). Values are mirrored in [tokens.json](tokens.json); the implementation is `src/styles/tokens.css`.

References: [design handoff](../design_handoff_orion_terminal/README.md) · [BMW M theme analysis](../DESIGN.md) · `src/styles/tokens.css`.

## Design tokens (Phase A canon)

```
--bg-0  #03060a   deepest
--bg-1  #060a0f   card / section
--bg-2  #0a1015   raised
--bg-3  #10171d   hover / focused

--neon-green   #39ff88   Archives accent, primary CTA, success, Claude online
--neon-cyan    #00e0ff   Orion accent, info, git markers
--neon-yellow  #e6ff3a   warnings, unsaved-changes dot
--neon-magenta #ff3ea5   XDesign accent, errors, selection handles
--neon-violet  #b14cff   aurora layer, syntax keywords

--t-primary    #e6f4ec
--t-secondary  #9ab0a8
--t-tertiary   #5a706a
--t-faint      #324036

--r-sm 5.1px   --r-md 8.5px   --r-lg 13.6px (windows)   --r-xl 18.7px (dock)   --r-pill 999px

--shadow-window:       0 30px 80px -20px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(0,0,0,0.5)
--shadow-glow-green:   0 0 24px -4px rgba(57, 255, 136, 0.5)
--shadow-glow-cyan:    0 0 24px -4px rgba(0, 224, 255, 0.5)
--shadow-glow-magenta: 0 0 24px -4px rgba(255, 62, 165, 0.5)
```

**2026-09-15 corrected visual preference:** keep soft, rounded chrome—only **15% less radius than the original**, not the rejected angular 2/4/6/8px pass. Preserve each theme's original corner proportions (Liquid windows 20→17px, medium controls 14→11.9px); circles and functional pills stay round. Filled controls use opaque `--t-on-accent`, never translucent glass `--bg-*` for text. Theme choices use material spheres; wallpaper previews share the real overlay renderers.

**Built-in theme lineup (user-pruned 2026-09-16):** **Ivory Keep** only in light; **Liquid, Minimal, BMW M** only in dark. Retired themes' palettes and sphere materials removed; saved retired light choices map to Ivory, retired/unknown dark choices to Liquid (new default), without hydration writes or deleting saved finish metadata. Ivory retains restrained Space Grotesk, a material sphere, strong ink, 22% shell tint/58% menus/34% controls and 6px frost with bounded backdrop brightness (raw alpha is not perceived transparency). Glass uses positive capability + positive OS reduced-transparency override; never negated preference queries (both failed in native WebKit). Explicit Reduce transparency remains. Quiet rims exclude genuine effects; welcome hides behind Settings to avoid stacked glass. Renderer palette tokens stay solid and editor/terminal/effect instances update in place. 24 focused theme/finish/border tests and tsc pass; retained-theme native visual acceptance pending.

**Frontend direction (refined 2026-09-16):** extend the modern Control Panel's restrained look across app chrome. `styles/workstation.css` + `workstationApps.css` own shared typography, controls and surfaces; second pass uses compact Orion recent-project rows, quieter XDesign start options, explicit theme selection and mode-aware menu shadows. Preserve theme identity, soft radii, semantic colors and independent document/canvas/code styling. Code-only; no new UI/native acceptance.

**Custom themes (2026-09-16):** Appearance accepts a design Markdown (64 KiB), explicitly generates through the selected `theme` AI surface with zero tools, validates token data (never executable CSS), offers a 30s reversible desktop preview, then saves up to 24 custom themes. Strict `custom_themes` hydration precedes active theme; failed/unknown-version loads block registry writes. Saved PBR spheres, per-theme finishes and live Monaco/PTY updates supported. New native `theme_read_markdown` requires an updated binary. 57 focused frontend tests + bounded native importer test + tsc pass; live-provider/native visual acceptance pending. [Guide](docs/custom-themes.md).

Spacing scale: 4 / 8 / 12 / 14 / 18 / 28 / 44. Window padding 14–18px; section padding 28–44px.

**The previously-deprecated `--signal / --void / --obsidian / --graphite / --steel / --ash / --bone / --ember` tokens do not exist in the actual codebase — they were named in the brief but never present.** The existing palette was the Tailwind theme keys (`bg`, `bg-panel`, `accent`, etc.). The migration plan: introduce the new `--*` tokens at the CSS level, then remap the Tailwind theme to point at them so all existing Tailwind classes pick up the new colors. No mass find-replace needed for Tailwind class usage.
