# Dock concept — Signal rail

2026-10-03 · Owner asked specifically for a Dock redesign: glass + dot dither + game-interface character, **still minimal and professional**, including better icons/movement. This narrows the next work to the Dock, not Spotlight or new window semantics. Corrected see-through Liquid direction was accepted (“okay thats better”); do not mattify it again.

**Latest: owner rejected the orb/hybrid branches and requested returning to this first concept, with a metal/gear/armour treatment. Actual Dock/app styles and behavior remain unchanged.**

## Current armoured variant — study05

```sh
open "$HOME/.local/share/orion-proof/skills-20260928/dock-armour-20261003-235558/Armoured Rail.html"
```

Exact first icon generation, layout, indices, hover/focus labels, 2px target-only lift and simulated callbacks: **entire inline script byte-exact** versus retained first Signal Rail. No orb/letter-core/persistent-name additions. Added original illustrative CSS satin-metal perimeter, bevel/catch lights, chamfered side plates, tiny recessed fastener marks; the centre keeps original clear glass. Separate neutral light-metal treatment in Ivory. Unsupported mask composition falls back to a plain metal border, never an opaque central fill. No MetalFX/GL dependency, shader or runtime activated.

Decorative layer and all descendants force pointer-events:none; inert and aria-hidden. This applies the historical metal overlay interception lesson without touching ThemeBorder.19 synthetic offscreen interaction checks include original glyph counts210/116/198, no orb additions, inert subtree, descendant styles and button edge/centre hit testing. Final six states in `verification-2/`; computed checks include visible hit-target portions, frame bounds, no page overflow, original lift/reductions. Initial hit metric included clipped/offscreen narrow slots; refined its scope, retained original evidence. Crop helper initially referenced old snapshot subdirectory; failure/source retained, corrected helper emits `armour-final.png` from final hover fixture.

Source/first/hybrid preview/audited/protected/HEAD fresh-baseline preservation in namespace. No owner browser/profile/screen operation or product app build/launch, provider, install, dependency, production/commit/release. Static material illustration only; human direction/onscreen/VoiceOver/contrast/timing/performance acceptance remains pending. Below preserves original concept evidence.

## Design / source audit

Current `src/shell/Dock.tsx`: small dark Lucide marks inside coloured gradient icon beds and bordered tiles. Global mousemove feeds React cursor state; per-tile bounds feed a cosine magnification of up to 1.55×. The JS path has no reduced-motion gate. These are source findings, not measured jank/frame-time results. Current app descriptors, order, launch/focus/minimize toggle and Spotlight/R.O.S.I.E/Settings callbacks remain the future integration authority.

Concept: one clear-glass equipment rail, no nested icon boxes, no fisheye wave. Existing app glyph silhouettes are sampled into a **19×19 dot grid**, varying dot radius by source alpha coverage; this is actual point-rendered icon artwork, not a generic dotted background overlay. No invented brand marks, photographic dithering, new dependencies or image-generation request. Known Lucide Archive/Code2/Palette/Radar/Workflow/FlaskConical sources; utility icons remain clean-line Search/Orbit/SlidersHorizontal. Six glyphs are generated once, no pointer-driven canvas/render loop.

- Quiet neutral marks; app accent on selected/focused slot only. Small slot indices and state pips give equipment-menu character, not arcade decoration. Pips mean simulated visible/focused app state, never provider status.
- 2px icon-only hover lift, steady neighbours, short restrained feedback. No bobbing, magnetic cursor, continuous glow or animated blur. Explicit and positive OS reduced-motion/transparency fallbacks.
- Labels on hover/focus, roving toolbar Tab stop, arrows/Home/End, Escape label dismissal; native buttons handle activation. Local simulated focus/minimize and utility selection only.
- Detail/desktop view, Liquid/Ivory **concept** palette, extra apps and reduction controls; horizontal slot scrolling at narrow widths, labels outside the scroll container. No stored preference or app registry changes.
- Retained Space Grotesk/JetBrains Mono, soft theme geometry and creator-owned stock wallpaper. Lucide licence copied beside the concept; font notices retained as local assets. This is not a new production icon/appearance policy.

## Try it

```sh
open "$HOME/.local/share/orion-proof/skills-20260928/dock-concept-20261003-194339/Signal Rail.html"
```

Standalone local interactive file with local fonts/wallpaper, a network-blocking CSP, no provider/native bridge, localStorage, fetch, import, install or product command. Clicking is explicitly simulated. Owner opens it in their own browser; agent did not activate or operate the owner screen/browser. It is not the native app and does not test window lifetimes.

- Namespace: `~/.local/share/orion-proof/skills-20260928/dock-concept-20261003-194339`.
- Final snapshots: `verification-2/01-dark-detail.png`, `02-hover.png`, `03-ivory.png`, `04-reduced.png`, `05-narrow.png`, `06-desktop.png`.
- `dock-detail.png` is a crop of final `02-hover.png`, not another capture.
- `icon-sources.json`, `concept-template.html`, `Signal Rail.html`, local assets and attribution are retained.

## Focused fixture checks / limits

Offscreen native nonpersistent WKWebView, prohibited activation, never-presented window, local HTML/CSP only. **14 synthetic interaction assertions and 23 computed state/layout assertions pass**: dots, labels, one toolbar Tab stop, arrow/Home/End focus, Escape, simulated minimize/reopen/utility refusal to run anything real, no keyboard trap outside the toolbar; six states, fonts loaded, no page-width overflow, rail bounds, selected-only lift with unchanged rail width, reduction fallbacks and nine-slot narrow layout. These are DOM-dispatched actions, not real native pointer/keyboard/VoiceOver or product workflow acceptance.

Initial pictures exposed an avoidable page scrollbar from first-child margin collapse; `display: flow-root` corrected the fixture. Initial source, six images and receipts retained. Final checks use a fresh `verification-2` output, not overwritten/replayed evidence.

Snapshots inspected for hover, narrow and cropped detail. No onscreen compositor contrast, all-theme/custom-theme acceptance, animation-timing/performance, arbitrary imported icon handling or real app/lifetime integration is claimed. Offscreen images do not reproduce all onscreen backdrop effects. No broad test suite/build/new packaged app was needed because app code is unchanged.

## Next, only after direction approval

Integrate a reviewed Dock component/style slice: preserve descriptors/order/enabled-app filtering/coach IDs/callbacks, keep opaque code/artwork palettes and custom/solid theme recipes, cache/precompute glyphs with clean-line fallback, remove global pointer-driven React magnification, implement scoped keyboard/focus/overflow/reduced-motion behavior and prove existing app toggle/utility semantics with focused tests and a separate native preview. No close/minimize lifecycle rewrite, provider action, installed-package behavior, production replacement, commit or release implied.

Fresh source/audited/protected/HEAD baseline and preservation endpoint in the namespace. Accumulated dirty work, corrected Liquid and earlier proof/production binaries remain preserved. Owner direction review pending.
