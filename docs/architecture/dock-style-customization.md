# Selectable Dock styles — owner brief / ranked plan

2026-10-04 · **Owner approved the interactive study; it is now implemented locally. Product integration/persistence has not begun.** Owner wants a customization layer with the first dot-dither Dock as default, the latest cyber/armour version as an option, and a bottom hover-revealed Dock analogous to the existing side notch.

## Requested styles

| Style | Direction |
| --- | --- |
| **Signal · default** | First [Signal Rail](dock-signal-rail.md): original dot-dither app symbols, clear glass, restrained equipment-menu detail and steady neighbours. |
| **Cyber** | Same known icons/actions, [study05 machined-metal rim and armour end pieces](dock-signal-rail.md#current-armoured-variant--study05), transparent centre. |
| **Notch** | **Owner correction:** invisible bottom-centre trigger at rest; expanded appearance/motion must match the existing side usage notch, not the mechanical control-tray reference. |

The typographic/orb/hybrid branches remain rejected, not alternative selectable modes. The new reference is local `/Users/lucaorion/Downloads/c6a68902-1528-496c-a67b-1804c7dbebcf.png`, SHA256 `861ac00e8cdcc358ea82e1fdd4ec98e49901324cf22065394c63f83ffa432be2`. It shows an expanded industrial control tray, **not** a supplied collapsed/hover implementation. Do not copy its VOL.03/01—L-RG/plus/home/folder/status placeholders into product commands or claim exact dynamic behavior. No remote fetch/upload/provider operation.

## Audit findings

- Actual `src/shell/Dock.tsx` is still the old Dock. `useAppDescriptors` supplies enabled apps/order/glyphs; visible focused-app click minimizes, otherwise `openApp`; utilities invoke Spotlight/R.O.S.I.E/Control Panel. Coach IDs must survive. Mousemove→React cursor state/per-tile magnification remains in actual code, not a measured performance defect.
- `src/shell/notch/MonitorNotch.tsx` provides separate hover/focus/pin/click/Escape/close-delay/inert patterns. Its geometry/preferences are **side-specific**, and it is wired to system/AI usage cells through `MonitorWidget.tsx`. Borrow interaction principles, not rotate/reuse that provider-connected component or move its existing settings/state.
- Appearance entry: `ControlPanel.tsx` → `ThemeSection` in `features/settings/SettingsPanel.tsx`. Proposed Dock selector belongs here, separate from colour theme/finish choices.
- Existing `app_state` has generic get/set helpers; a new typed key can store Dock preferences without editing any historical SQL migration. Persistence design/strict hydration and failure handling must be implemented and tested, not inferred from that capacity.
- Metal decoration must remain inert/aria-hidden with pointer-events:none on descendants. No MetalFX/shared GL/LiquidLens activation; prevent decorative mask fallback from filling the clear centre.

## Proposed behavior / architecture

These are implementation proposals, not completed or accepted tests:

- One Dock action registry/component path with three visual/reveal modes, not three competing instances or duplicated app state. Cache dot artwork once; retain clean glyph fallback and dynamic enabled-app/order handling.
- **Control Panel → Appearance → Dock style** with three explicit choices and honest mini previews. Dock style independent of Liquid/Minimal/BMW M/Ivory/custom themes; use active theme/reduction material adapters and preserve finishes/renderers.
- Persist selected style through a small versioned Dock preference store/new `app_state` key. Missing choice defaults to Signal. No startup normalization writes; failed/unknown-version load blocks writes and exposes recovery; failed saves retain retry state. No transient hover/focus state persistence.
- Notch opens on hover **and keyboard focus / click / touch**. Keep open while moving from handle into tray or focus is inside; small leave grace, scoped timers cleaned on mode change/unmount. Escape closes and returns focus safely without immediately reopening. Closed content inert/hidden, no keyboard trap or dead invisible blocker. No new fake '+' or global shortcut.
- Respect OS/explicit reductions with instant/static reveal fallback; preserve sidebar notch position/preferences/telemetry. Same app focus/minimize and utility actions in every style. No app/window close semantics or other lifecycle/provider changes.

## Placement / usage follow-up

Owner accepted the corrected Notch (“looks good”) and approved the next isolated [Dock placement / usage carousel study](dock-placement-study.md): allthree Dock styles Bottom/Left/Right, separate usage’s matching placement choices or optional reference-led Dock card, reserved expanded zones and pausable top-down carousel. Current preview: `dock-placement-20261004-192314/Dock Placements.html`; real product/preferences/telemetry untouched. Owner review pending; source-matched accepted study below preserved.

## Accepted correction — actual side-notch presentation

Owner rejected the visible mechanical Notch: resting trigger must be invisible and expanded styling **exactly like the existing side usage notch**. Current local preview:

```sh
open "$HOME/.local/share/orion-proof/skills-20260928/dock-side-notch-20261004-111246/Dock Styles.html"
```

- Removed visible Dock tab/disclosure/metal/crest/wells from Notch only. Resting92×34px activation area has no background/border/shadow/glyph/text; expanded wake disappears. Keyboard/touch remain available; closed cells inert/hidden, no full-width blocker.
- Copied current **`monitorNotch.css` byte-exact** and pure `notchGeometry.ts` into the local study; geometry/motion adapter strips TS types without altering source measurements. Use `notchPath` contour with a quarter-turn of **geometry coordinates**, not rotation/reuse of the provider-connected MonitorNotch component. Solid#000, curled ends, source44px rings/5.83track/3.01accent,17.3px1.7stroke icons, grey8px labels and hover-revealed accessory pin. No photo/mechanical imitation.
- Source spring parameters and600ms unfold/500ms content/45ms bounded stagger,450ms default grace; OS/explicit reductions. Notch keeps actual side-notch black styling in Ivory too (intentional owner-requested exception, not theme mattification). Ring accents indicate simulated selected app, **not** quota/usage/progress/busy state. Signal/Cyber retain their original clear/dot treatment.
- Keep one simulated app action path; invisible wake focus/tap reveal, pin accessory, Escape restore without reopening, scoped mode/timers. Long menu uses horizontal clipping/scrolling with the source curled edge margins; existing side monitor/preferences/telemetry untouched. Copied NOTICE + Codenotch MIT grant and a UI-only adaptation notice retained, no provider marks/protocols/credentials copied.

`verification-4/` has nine final states,38 synthetic interactions +4 settled timers and bounded style/layout/source checks; `notch-detail.png` finalopen crop. Initial adapter missed two `index:number` annotations (syntax error/readiness timeout); failure/source retained, corrected and Node checked. New frame/scroller test queries initially matched miniatures: main scope fixed. Hidden WK transitions retained previous opacity; final capture freezes main preview transitions **only in the test harness**, not shipped page or real-motion acceptance. Actual owner browser/UI/source palette remains uninspected. Exact source code values do not certify native compositor/motion parity; visual/real input/VoiceOver/contrast/performance acceptance pending.

Only private study/doc changes. Product Dock/Appearance persistence, monitor/provider behavior, binaries/profiles untouched; no build/dependencies/send/install/owner screen/browser operation/production/commit/release. Prior selector preview remains byte-exact. Correction supersedes mechanical Notch below; owner accepted visual direction. Placement/usage follow-up now precedes integration.

## Earlier approved study — mechanical Notch (superseded)

```sh
open "$HOME/.local/share/orion-proof/skills-20260928/dock-styles-20261004-103243/Dock Styles.html"
```

- Signal is default on every load; Cyber and Notch are selectable through an accessible three-choice radio group (arrow/Home/End navigation). Choice independent of appearance; local only, **nothing saved**.
- All three share one real prototype Dock/action path and the original first-concept dot generator byte-exact. Miniatures clone the actual rendered tray/glyphs, strip duplicate IDs and convert child buttons to inert spans—no nested controls or fake action previews. Cycles preserve simulated app/utility state.
- Notch: bottom-centre tab, raised-centre control tray with functional round glass wells and a disclosure control (not reference '+'). Hover and keyboard focus reveal; click/tap pins; second pinned click or Escape folds. Keep open while entering tray/focus inside;350ms leave grace, mode-generation guards and timer cleanup. Escape restores tab focus without reopening; closed tray inert/aria-hidden/visibility-hidden with pointer passthrough, not a dead full-width layer. No real provider/system-notch calls.
- Explicit/positive OS reduced-motion/transparency fallbacks; neutral Ivory adapter. Static bevel/metal/lighting illustration, not PBR or live refraction. Existing local fonts/wallpaper/Lucide notices and network-blocking CSP retained.

Evidence: `verification-3/` has nine final states (Signal/Cyber/Notch closed/open/Ivory/reduced/390px-nine slots/actual-size open/actual-size closed),33 synthetic interaction assertions and4 settled timer regressions (leave closes, focus holds, pinned holds, stale fold cannot close switched style), plus bounded layout/material assertions. Actual-size/detail/Ivory/narrow snapshots inspected. `notch-detail.png` crops final open fixture.

Initial harness query selected inert miniatures instead of main Dock, failing “focused click simulates minimize”; scoped action/layout queries to `#rail`, preserving failure/source. Initial miniature wrapper was inline; changed to block so the actual preview stays in its reserved area, retained prior source/captures. Final DOM/cache checks do not prove owner recognition, real native keyboard/pointer/touch/VoiceOver, compositor contrast or motion/GPU performance. No product/DB/style-store implementation, binary build/launch, owner browser/screen/profile operation, provider, dependency, install, production/commit/release. First/Cyber preview files remain exact.

**Owner visual/reveal review next**, then shared real Dock and saved Appearance preference implementation. Planning approvals are not acceptance of the new shape/behavior. The mechanical Notch was subsequently rejected and superseded by the source-matched correction above.

## Ranked green slices — first study complete; product review next

1. **Interactive visual study:** complete within local simulated-only checks above; owner reviews shape/reveal before integration.
2. **Shared product Dock:** first Signal as default + Cyber skin, descriptor/coach/action preservation, cached dot glyph/fallback, steady hover, accessible keyboard/overflow behavior. Focused component regressions, no broad unrelated rewrite.
3. **Preferences / Notch:** real Appearance selector + strict persisted choice and safe reveal controller; focused save/hydration/restart/error/keyboard/leave/mode-switch tests.
4. **Bounded native acceptance:** separate private preview, Liquid/Ivory/reductions/narrow + app actions/notch coexistence/restart. Not onscreen/VoiceOver/performance accepted by offscreen mocks. No production replacement/commit/release without separate approval.

Fresh planning baseline at `~/.local/share/orion-proof/skills-20260928/dock-customization-plan-20261004-101234`; preservation endpoint records current dirty work/source/protected artifacts/HEAD. Initial planning changed only docs/log. The approved study now adds local proof files under `dock-styles-20261004-103243`; product repository changes remain documentation only, no real UI/persistence or packaged build/launch/browser/screen/profile operation. Previous previews remain unchanged.
