# Dock redesign: smoked glass, raised icons, Rosie orb, decoded names

Date: 2026-10-29 · Branch: `validation/alpha-2026-09-14` · Status: draft for owner approval

## Intent

The owner wants the dock to feel like one floating object made of frosted glass. The icons stay quiet, part of the glass, until you reach for one. Then it lifts, lights up in its app colour, and its name decodes underneath like code. Rosie is the one living thing on the dock: an animated orb of separate dots that react to the mouse one by one.

The look was settled in a series of browser mockups. The final one is `2026-10-29-dock-redesign-reference/dock-mockup.html` (option A, "Raised"). Every value below comes from it. Where this document is silent on a visual number, the mockup's number is the answer.

## Goals

- The dock surface is smoked frosted glass floating over the wallpaper, with squarer corners.
- At rest, app and utility icons have no colour. They are raised shapes in the glass.
- The lifted icon shows its full-colour Frosted treatment, and its name decodes under it in tiny mono text.
- Rosie's dock entry is the animated dot-by-dot particle orb.
- Dock contents: Archives 47, Orion, XDesign, Incubator, then Rosie, a divider, Spotlight and Control Panel.

## Non-goals

- No rename. "Orion Terminal", the wordmark and the bundle ID stay as they are (the rename is deferred to the end of the alpha).
- No particle-material app icons. They were tried and parked, not rejected.
- No per-skill orb variants and no repeatable icon-generation pipeline. Both are later projects.
- No change to what clicking a dock item does, or to the magnify curve.
- No new dependencies.

## Anti-goals (a failure even if it technically works)

- The orb reacting as one solid ball: spinning up, brightening or pulsing all together when the mouse is near. The owner's words: "every dot is sepereate so my mouse doesnt [make] the whole react in unison".
- Icons in colour at rest.
- A blinking cursor or caret after the name.
- Names above the icon, in a box or chip, or in normal-size text.
- A dock that reads as a solid bar instead of smoked frosted glass.
- Pale, theme-tinted icon colours. The owner approved the neon as it appears in the mockup.

## Owner decisions (verbatim where quoted)

| Topic | Decision |
|---|---|
| Icon treatment | Frosted: shape-only frosted glass in the app colour (the Frosted mockup). |
| Rosie | "a animate orb for rosie... it sits in the middel of the dock slightly higher thaneverything else. then on right side you have search and control panel like its devided now and on the other side you have the apps." Each dot reacts on its own. After review: "leave rosie where she is its good", meaning right after the apps and before the divider, as in the mockup. |
| Colours | "the neon here was tasteful and made sense". The dock keeps the mockup's neon in every theme. |
| Themes | "for now no match the design to each theme but this is the style" |
| Names | "when the icon of an app is lifted type in its name like code almost" |
| Name position | "show up under in space under the icon when it lifts and very small writing" |
| Name style | Decode, "just remove the typing indicator at the end of the text" |
| Dock surface | "a floating frosted glass look" (owner reference: frosted-glass sidebars by `@ui.zared`), "a bit more square too". Smoked over Milky. |
| Icons at rest | "embossed in it until you hover over it". Raised, not pressed in. |
| Open indicator | "the green dot i think is just an indicator of what apps are open" |
| Command Center, Hermes | "remove command center and hermes for now" |
| Incubator | "incubator can be the unused rosie icon from earlier" |

Accepted from the playback (proposed by Claude; the owner said "looks good"):
- Rosie stays lit at rest.
- Every item gets a name, without keyboard shortcuts.
- The corners match the window radius (13.6px, as in the mockup).
- The lift-and-grow effect stays as it is today.
- Light mode uses the Milky glass.
- With reduced motion, the orb moves slower and calmer.

## The design

### 1. Dock surface (dark themes)

For now, this one surface is the dock in every dark theme: Liquid, Minimal, BMW M and custom dark themes. *Claude's reading of the owner* ("for now no match the design to each theme but this is the style"): there are no per-theme dock variants yet. So the per-theme dock rules stop applying to the dock:
- the Liquid material adapter (`src/styles/materials.css:~96-111`);
- the custom-theme surface finish (`src/styles/customThemes.css:1` and `:26`).

Reduced transparency (§10) and border effects (below) still apply.

Replace the `.ot-dock` surface in `src/styles/tokens.css:316`:
- Radius: 13.6px, the Phase A window radius (`--r-lg` in `tokens.css`), down from `--r-xl`. *Claude's call:* the radius is fixed in every theme, like the colours. Themes retune `--r-lg` (Liquid 17px, BMW M 3.4px), and the owner approved 13.6px as "a bit more square".
- Backdrop: `blur(26px) saturate(1.25)`, with the `-webkit-` prefix too, since Tauri on macOS is WebKit.
- Background: `linear-gradient(180deg, rgba(40,48,56,.42), rgba(14,18,22,.5))`.
- Border: `1px solid rgba(255,255,255,.14)`.
- Shadow: `inset 0 1px 0 rgba(255,255,255,.18), 0 34px 60px -22px rgba(0,0,0,.85), 0 12px 26px -14px rgba(0,0,0,.7)`. The cyan outer glow goes.
- Sheen: a `::before` overlay, `linear-gradient(118deg, rgba(255,255,255,.16) 0%, transparent 38%, transparent 62%, rgba(255,255,255,.06) 100%)`, at the dock's radius, with pointer-events off.
- Divider: `rgba(255,255,255,.16)`.
- Floating: raise `.ot-dock-wrap` so the dock clears the screen edge visibly. The mockup sits 30px up, today's dock 14px. *Claude's call:* raise `DOCK_CLEARANCE` (`src/shell/store/useShell.ts:64`, now 88) by the same amount the dock rises, so opened and maximised windows still stop above the dock. A window bottom hidden under the dock was flagged as a bug before. Check that the window-reach logic (`DOCK_REACH`) still behaves.
- Theme border effects: *Claude's call:* when the user has a border effect on (`<ThemeBorder />`, `materials.css:109`), the effect still draws the dock's edge as it does today, and the glass keeps its inset top highlight.
- Padding, gap and item size stay as they are: 8px 12px, 10px gap, 48px items.

### 2. Dock surface (light themes)

Ivory Keep and custom light themes use the Milky glass from the earlier mockup:
- Background: `linear-gradient(180deg, rgba(225,232,238,.2), rgba(200,210,218,.11))`.
- Border: `1px solid rgba(255,255,255,.24)`.
- Shadow: `inset 0 1px 0 rgba(255,255,255,.34), inset 0 -1px 0 rgba(255,255,255,.06), 0 34px 60px -22px rgba(0,0,0,.85), 0 12px 26px -14px rgba(0,0,0,.7)`.
- Blur, radius and sheen are the same as dark mode.

These rules currently repaint `.ot-dock`, and they must stop overriding the new surface:
- the light-mode rules in `src/styles/lightThemes.css:44-50`;
- the theme-material adapters in `src/styles/materials.css:~96-111`;
- the custom-surface rules in `src/styles/customThemes.css`. The owner only saw the Milky glass over the dark wallpaper, so check it on the light wallpaper and record what it looks like.

### 3. Items and order

From left to right:
- Archives 47, Orion, XDesign, Incubator (the apps, sorted by `order`).
- Rosie.
- The divider.
- Spotlight, then Control Panel.

Today Rosie sits between Spotlight and Control Panel. She moves to the left of the divider.

Command Center and Hermes no longer appear in the dock. *Claude's call:* they are hidden from the dock only. They stay registered, so Spotlight and their commands still open them, and their plugin enable state is unchanged.

Any other registered app (community plugin apps from `communityRuntime.ts`) still appears among the apps, with the same at-rest and lifted treatment, built from its existing lucide `Icon`. *Claude's call:* an accent of `var(--neon-*)` maps to that colour's fixed neon value from §4. Any other accent is used as given.

### 4. Icon shapes and colours

**The colours are fixed.** The dock uses the mockup's neon values below in every theme. This covers the icons, names, the open dot and Rosie.
- It does not read the live `--neon-*` tokens. Liquid, the default theme, retunes those to pale tints under the 2026-10-12 "No neon" direction (`src/styles/themes.css:24-30`).
- The values are the Phase A base values of those tokens (`design/tokens.json`, `src/styles/tokens.css`).
- Record the dock as a second exception in the "No neon" paragraph of `design/DESIGN.md`, beside the Agent Forge.

Each app gets a glyph mask: a 512×512 RGBA PNG, white or black shape on transparent. Only alpha is used. The masks are in `2026-10-29-dock-redesign-reference/`:
- Archives 47: `glyph-archives.png`, colour `#39ff88`.
- Orion: `glyph-orion.png`, `#00e0ff`.
- XDesign: `glyph-xdesign.png`, `#ff3ea5`.
- Incubator: `glyph-rosie.png` (the orbit atom with a sparkle), `#b14cff`.

Move them into the app's assets.

Spotlight and Control Panel use the lucide `Search` and `SlidersHorizontal` paths as masks. Colour: `#cdd6de`, fixed like the rest.

Apps without a glyph (community apps) use their lucide `Icon`, rasterised into a mask the same way. Spotlight and Control Panel are drawn the same way.

Glyph sizing: an app glyph's longer side fills 0.8 of the 48px item; a utility glyph's fills 0.44. Each is centred.

### 5. At rest: raised in the glass

The mockup's `emboss()` function, "raised" branch, is the reference. The light comes from the top. Each icon is drawn from its mask in five layers:
1. A soft black shadow (blur ≈ 0.04 × icon size, alpha .45), offset down by 1.5d. The shape's own area is cut out of it.
2. A white fill inside the shape at alpha .07.
3. A top inner rim: the part of the shape left after removing the shape shifted down by d, drawn white at .55.
4. A bottom inner rim: the same with the shape shifted up by d, drawn black at .45.
5. d is 1.1 CSS px for app glyphs and 0.6 CSS px for line icons, scaled by the canvas pixel ratio.

There is no colour at rest. The open-app dot is the only colour on the dock besides Rosie.

### 6. Lifted: colour reveal

- **Which item is lifted:** the one nearest the cursor, within half its width plus 5px, while the cursor is inside the dock's reach. The Frosted colour version and the name follow that item, not raw pointer hover. One item is lifted at a time.
- **Fading:** the colour fades in over the raised version with a per-frame lerp of 0.16 toward 1, and fades back the same way when the item stops being lifted. That is about 150ms at 60fps.
- **The Frosted colour treatment:** the mockup's `prep()` and `draw()` are the reference. It is a white vertical gradient body (.72 to .3) with the app colour at .64 over it, fine noise at .12, a white inner rim fading from top to bottom, a black drop shadow at .55, and a colour bloom drawn with lighter compositing.
- **Hover-only extras:** the pointer-follow tilt (up to 7°) and the diagonal sheen that only run while hovered stay as in the mockup.
- **Lift and scale:** unchanged from today (`INFLUENCE` 110, `MAX_SCALE` 1.55, `HOVER_LIFT` 12). The orb's slot uses a peak scale of 1.2.

### 7. Names

- **Text:** the app's `name` (Archives 47, Orion, XDesign, Incubator), then `R.O.S.I.E`, `Spotlight` and `Control Panel`. No shortcuts.
- **Style:** JetBrains Mono 500 (already bundled), 8px, line height 1, letter-spacing .06em. The colour is the item's colour, with `text-shadow: 0 0 6px` that colour at .45. There is no box, chip or background.
- **Position:**
  - Horizontally centred under the lifted item, with its top 1px below the item's transformed bottom edge, so it rides the lift.
  - For Rosie, it sits 2px below the orb's drawn bottom edge: the slot centre plus 15px times the slot scale.
  - It is clamped to stay 10px inside the dock's left and right edges.
- **Decode:**
  - Every character slot shows a random character from `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=/<>{}[]_` and re-rolls every frame.
  - Spaces stay spaces.
  - Slot i settles to its real character at 90ms + i × 30ms after the item becomes lifted.
  - Switching items restarts the decode.
  - There is no caret.
- **Fade:** in and out with a 120ms opacity transition.
- **Open dot:** while an open app's name shows, its dot fades out (120ms) and comes back when the name goes.
- **Accessibility:** the names replace the native `title` tooltips visually. Each button keeps an accessible name (the same text plus the shortcut, e.g. "Spotlight (⌘K)") via `aria-label`. *Claude's call:* keyboard focus (`:focus-visible`) lifts and reveals the item and shows its name, the same as hover.

### 8. Open-app indicator

It is unchanged in meaning: a 4px dot under every app with a visible, non-minimised window (`activeIds` in `Dock.tsx`). It is `#39ff88` in every theme, whatever the app colour. Today it follows `--neon-green`, which Liquid turns pale. *Claude's call*, following the fixed colours. It fades only while that app's name is showing.

### 9. Rosie orb

The mockup's `orbModel()` and `drawOrb()` are the reference. Port them faithfully, including the per-dot randomness, since that randomness is what makes the dots feel separate.
- **Model (seed 47):**
  - The shell is a 2600-point Fibonacci sphere. A point is kept if it lies near one of 18 random patch centres (dot > .94), plus 5% of the rest at random.
  - 70 node points, linked where dot > .85.
  - 46 spikes.
  - 320 gaussian core points (σ .45).
  - Each dot gets its own phase, shimmer frequency (.6 to 2.2), sensitivity (.3 to 1.7) and spring (.025 to .085).
- **Motion:**
  - Rotation is `0.3 rad/s` about the vertical axis, with a fixed 0.38 rad tilt.
  - The core breathes: `0.5 - 0.5cos(1.1t)` drives its spread, `.16 + .5 × breath`.
- **Pointer:**
  - Each dot within `0.7R` of the cursor is pushed away with force `(1 - d/0.7R)² × sensitivity`, plus a share of the cursor's velocity (×.3, capped at .15R per frame).
  - Each dot then springs home with its own spring and damping .88.
  - Nothing global changes on hover.
- **Size:** a 96px canvas drawn at 1.25× device pixel ratio, with orb radius R = 25px. It is raised 14px above its 64px-wide slot, which has 4px side margins.
- **Colours:** dots `#00e0ff`, core `#9ff6ff`, drawn with additive compositing. Both are fixed in every theme.
- **Reduced motion:** when `prefers-reduced-motion: reduce` is on, *Claude's call*:
  - Rotation runs at a quarter speed.
  - The core breathing stops at mid-breath.
  - The shimmer runs at a quarter speed.
  - The per-dot cursor push stays, because it is direct feedback.
  - Name decode is skipped: the name appears whole.
  - The colour reveal becomes a plain 120ms fade.
- **When hidden:** the orb stops drawing when the window or tab is hidden; `requestAnimationFrame` already does this.

### 10. Reduced transparency

When `.ot-reduce-glass` or `prefers-reduced-transparency: reduce` is active, the dock drops the blur and the sheen and uses an opaque fill. *Claude's call:* the fill is today's `rgba(8,14,18,.88)` in dark mode and `var(--bg-2)` in light mode. Icons and names are unchanged.

## Constraints

- **Stack:** the stack is locked (CLAUDE.md). This is Canvas 2D in React, with no new dependencies. `three` is available but not needed.
- **Tokens:** never invent tokens. The new glass colours, the utility icon colour and the orb core colour have no tokens yet. *Claude's call:*
  - Define them once as dock-scoped CSS custom properties beside `.ot-dock`, since the owner approved these exact values.
  - Log each one in the `PROGRESS.md` open questions so Hermes can promote it into `design/tokens.json`.
  - The fixed neon colours come from the Phase A token values (see §4), not from the live tokens.
  - The radius is the Phase A `--r-lg` value, 13.6px (see §1).
- **Performance:** window drag must hold 60fps with the dock idle. An icon canvas redraws only while its reveal, tilt or hover values are moving. The orb is the only canvas that draws every frame.
- **Tests:** keep them focused (vitest), no broad suites. Logic worth unit tests:
  - The decode text at given elapsed times.
  - Which item counts as lifted for a cursor x.
  - Command Center and Hermes being absent from the dock list.
  - Accessible labels.
  - Visuals are checked by browser screenshot against the mockup.
- **Repo rules:**
  - Preserve the existing uncommitted work: the logo swap and the `PROGRESS.md` edits.
  - Never use `OrionTerminal` as a component name.
  - Comments only for a non-obvious why.
  - No commits without the owner's authorisation.

## Left to the builder

- **Code structure:** how the canvas code is split into modules and components, and whether icons share one canvas or use one each.
- **Rasterising:** how lucide icons are turned into masks.
- **Glyph location:** where the glyph PNGs live and how they are imported.
- **Effect wiring:** how hover, focus and the rAF loop connect to the existing `cursorX` state in `Dock.tsx`.
- **Canvas limits:** the exact pixel ratio cap. The mockup uses `min(devicePixelRatio, 2)`.
- **The Control Panel plugin list:** `PluginManagerPanel.tsx:288` also renders `dock.Icon`. Leave it unchanged.

## Reference files

`docs/superpowers/specs/2026-10-29-dock-redesign-reference/`:
- `dock-mockup.html`: the approved mockup. Option A, "Raised", is the approved one; ignore option B, "Pressed". It reads glyph pixels, so serve the folder over HTTP instead of opening it as a `file://` page, e.g. `python3 -m http.server 1532 --bind 127.0.0.1` from inside it. `jbm-500.woff2` and `wp-stock.jpg` are its font and wallpaper.
- `glyph-archives.png`, `glyph-orion.png`, `glyph-xdesign.png`, `glyph-rosie.png`: the glyph masks.
