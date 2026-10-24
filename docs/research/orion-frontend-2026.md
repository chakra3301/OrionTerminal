# Orion Terminal frontend: Apple-tier research and proposal

2026-10-03 · Research completed; first material implementation was approved, but owner rejected the result as too matte. **Preserve the original see-through Liquid; refine the chrome, not its material identity.** [Corrected clear-glass preview](../architecture/frontend-liquid-refinement.md) is available; visual acceptance pending. Later slices remain proposals; the darker reading-sheet proposal below is not the active direction.

The owner accepted the Incubator redesign direction (“looks good”) and asked to raise the entire workstation's frontend quality: exceptional glassmorphism and user experience. This document treats Apple as a quality/reference standard, not a claim that Orion matches or exceeds it.

## Recommendation

**Evolve Liquid into a disciplined material system, not a more transparent version of every panel.** Expressive glass belongs to the shell and functional navigation layer. Reading, editing and artwork need stable, quieter surfaces. Consistent geometry, controls, focus, feedback and task continuity make that material feel like a product rather than an effect.

Keep Orion's identity: Space Grotesk, JetBrains Mono, theme-specific soft corners, app accents, real brand marks and optional effects. Retain Liquid/Minimal/BMW M/Ivory Keep, saved custom themes and per-theme finishes. Do not replace the Tauri/React stack, import Apple's fonts/artwork, add libraries, or silently change stored preferences.

The proposed north star is **clear smoked glass, precise light at the edges, calm interiors, unmistakable actions**. Not milky white slabs, excessive neon bloom, floating cards everywhere or a macOS screenshot recreation.

## 1. What the authoritative references actually say

### Material is hierarchy, not decoration

Apple's [Materials HIG][materials] explicitly says: **“Don’t use Liquid Glass in the content layer.”** Liquid Glass forms a distinct functional layer for navigation and controls. Standard materials distinguish content within the content layer. Applying the most expressive effect to every card makes content compete with navigation.

[Meet Liquid Glass][meet] also says **“always avoid glass on glass.”** Controls within a glass surface should share its material, with simple fills/selection treatments, rather than receive independent glass layers. Apple's regular variant prioritizes text legibility; clear glass is specifically for controls over visually rich media. These are principles to translate, not SwiftUI APIs available inside a WKWebView.

**Orion implication:** one material owner per visual group; quiet child controls; regular/readable menus and sidebars; clearer glass reserved for low-text shell/media controls. A transparent parent plus many separately blurred children is not the target.

### Geometry and grouping do the work

[Get to know the new design system][system] explains concentric shapes: inner radii relate to parent radius and inset. It explicitly retains rounded rectangles for dense macOS controls; capsules suit standout actions, not every inspector field. Hierarchy should come from layout and grouping, not additional borders around every item.

**Orion implication:** preserve the owner's 15%-radius reduction and theme proportions. Check nested corner relationships and optical alignment. Group toolbar actions by task. Do not force a single radius or pill style onto all themes and controls.

### Desktop quality is behavioral

[Designing for macOS][macos] emphasizes comfortable information density, movable/resizable windows, fewer nested levels/modal steps, keyboard shortcuts and personalization. [Windows][windows] describes distinct active/inactive window appearances; [Toolbars][toolbars] calls for logical command groups. [Sidebars][sidebars] provides the navigation reference.

**Orion implication:** global shell navigation, app navigation and document actions must be visibly different levels. Familiar-looking window controls must have understandable semantics. Resizing must continue the same task, not reset drafts or selection.

### Feedback and accessibility are part of the finish

[Feedback][feedback] distinguishes passive status from interruptions needed to prevent data loss. [Motion][motion] calls for brief, precise, purposeful feedback and optional motion. [Accessibility][accessibility] recommends text enlargement, contrast checks and reduced automatic/zooming motion.

For the web UI, [WCAG target-size guidance][targets] uses 24×24 **CSS pixels**, with stated exceptions; 44px touch-style buttons are not a universal desktop requirement. [Focus Not Obscured][focus] addresses components hidden by author-created overlays, with user-movable/opened-content qualifications. [WAI-ARIA combobox guidance][combobox] supplies an actual semantic keyboard-selection pattern.

**Orion implication:** stable text contrast over real wallpaper, comfortable desktop hit areas, explicit labels, visible selection/focus, restrained status announcements, keyboard completion and reduced-motion/transparency alternatives. CSS pixel targets and Apple's point-based typography recommendations are not interchangeable measurements.

### Effects have rendering costs and platform limits

[WebKit's backdrop-filter explanation][webkit] notes hardware acceleration **and additional rendering passes**. It is a foundational 2015 article, not a current Orion benchmark.

Orion's prior native findings established that SVG displacement via `backdrop-filter: url(...)` was a no-op in tested WKWebView. WebGL can refract an owned scene/wallpaper, not arbitrary live DOM pixels. Native Apple Liquid Glass is not a drop-in CSS effect.

**Orion implication:** CSS frost/specular treatment first, narrowly scoped. No DOM screenshotting, general-purpose shader overlay or per-control WebGL canvases. Any future optical enhancement needs a bounded owned-renderer use case, static fallback, accessibility gating and measured benefit.

## 2. Current-source audit

This is a representative architecture/code audit, not a fresh whole-product visual or VoiceOver acceptance run. Existing screenshots are historical, including the current Incubator source screen; they do not establish how all present surfaces look. Effective appearance depends on the complete cascade and native compositing. No owner screen/profile was inspected or operated for this research.

| Finding | Source evidence | Interpretation / priority |
| --- | --- | --- |
| Liquid treats many structural/content surfaces as transparent | `src/styles/themes.css`: translucent `--bg-*`; wildcard `-pane/-canvas/-view` backgrounds cleared with `!important`; note/card blur and broad input rules | **High:** material roles are mixed. Replace broad selectors only after explicit app adapters preserve intended backgrounds. Do not describe every affected surface as broken without computed/native checks. |
| New shared chrome has a calmer, different material model | `src/styles/workstation.css`: opaque `--work-panel/--work-raised` aliases; `workstationApps.css`: explicitly scoped chrome, independent document/canvas styling | **High:** retain this good boundary, reconcile it with Liquid's older “glass everywhere” layer instead of adding another override stack. |
| Ivory has its own positive-capability, bounded-backdrop model | `src/styles/lightThemes.css`: 22% shell tint, 58% popovers, 34% controls, 6px frost; positive reduced-transparency override | **Preserve:** raw alpha is not perceived opacity. Do not resurrect historical milky settings or negated preference queries. Validate the shared roles in Ivory, not just dark Liquid. |
| Settings already has grouped navigation and focus/motion rules, but multiple styling generations remain | `ControlPanel.tsx`, `controlpanel.css`, `settingsExperience.css`; token styling overlays legacy custom dark/neon rules | **Medium:** consolidate through shared contracts, not a wholesale Settings rewrite. Some legacy rules are overridden; code presence alone does not prove visible leakage. |
| Window buttons communicate different actions but share behavior | `src/shell/WindowFrame.tsx`: Close and Minimize both call `minimizeWindow`; green maximizes; titlebar double-click enters fullscreen | **High UX:** agree on close/minimize/maximize/fullscreen semantics, titles and keyboard behavior. Do not simply wire red to destructive teardown. |
| Window lifecycle complicates a cosmetic control fix | `src/shell/store/useShell.ts`: distinct close/remove and minimize state; `Shell.tsx`: minimized frames aren't rendered | **High safety:** audit draft, editor, PTY, chat and plugin lifetimes before changing controls or mounting. Store survival is not proof every view-local draft survives. |
| Spotlight has useful cross-app search and key handling, but incomplete result semantics | `src/shell/Spotlight.tsx`: focused input, arrow/Enter handling; result rows are clickable divs, selected via CSS; no combobox/listbox/active-descendant association or explicit input label in this component | **High:** semantic selection, focus return, IME-safe confirmation, empty/loading/error behavior and top-layer ownership need focused tests/native checks. Do not conflate visual keyboard selection with accessible selection. |
| Dock magnification has no reduced-motion gate in its JS path | `src/shell/Dock.tsx`: mouse state → tile effects → bounds reads/state → inline transforms (scale up to 1.55); CSS reduced-motion comment claims auto-disable | **High accessibility / measure performance:** comments don't implement gating. Profile actual pointer updates before claiming jank; disable nonessential scale/lift when reduced motion is requested. |
| An existing wallpaper-refraction implementation is dormant | `src/shell/glass/LiquidLens.tsx` has no TSX consumer/import in current `src`; Shell does not mount it | **Important limit:** do not attribute current GPU load or true refraction to this component. Its “mounted by Shell” comments are stale. Re-enabling it is not a free polish change. |
| Small text and targets deserve an explicit density policy | shared chrome uses many 11–12px labels; Settings includes 10px metadata; base traffic lights are 12px circles | **Medium/high:** distinguish secondary metadata from essential instructions. Inspect actual hit areas/spacing and final CSS before a compliance claim. Add scalable UI text without scaling code/artwork indiscriminately. |
| Good UX foundations already exist | Orion recent-project rows and clear Open folder action; XDesign loading error/retry; Archives collapsible persisted panels/current-page state; shared chat named Send/Stop, restored failed drafts and non-forced output following; native dialog-based confirmations | **Preserve and standardize:** this is not a rebuild from zero. Share patterns while retaining save, review, consent, busy and cancellation guarantees. |
| Desktop companion can overlap task chrome | current Design Proof's retained `04-source.png` shows companion over part of Incubator's right edge | **Investigate:** safe placement/quiet mode and keyboard reachability are worth checking across surfaces. This one screenshot is not proof of every obstruction or a WCAG failure. |

Files were read across shell, Settings, Orion home, Archives layout, XDesign home, shared chat and confirmations. Editor/canvas/export/provider implementations were not exhaustively audited; no new performance, contrast, full theme or accessibility measurements were taken.

## 3. Proposed Orion material and interaction contract

### Four material roles — derived from the existing theme

These are proposed semantic roles, not a new custom-theme schema or four new theme choices.

| Role | Where | Appearance and behavior |
| --- | --- | --- |
| **Shell glass** | Dock, menubar, floating window rim/header | Clearest appropriate glass; restrained edge highlight and depth shadow. Little text. Focus/active-window distinction, no constant shine animation. |
| **Navigation material** | app sidebar, grouped toolbar, inspector chrome | Readable regular frost/tint. Shared backdrop for children. Selected items use a simple fill plus explicit state, not extra blur. |
| **Reading / work surface** | note/chat text, settings forms, tables | Quiet standard surface with measured contrast. Controlled tint/translucency where safe; stable reading areas where wallpaper would interfere. No lens warp under text. Monaco/terminal renderer colors remain opaque. |
| **Transient surface** | menu, popover, Spotlight, confirmation | Stronger separation/readability, bounded size/scrolling, clear focus ownership and dismissal. Simple rows inside one material. Destructive/review authority stays explicit. |

Use deterministic recipes derived from existing palette/finish/depth/radius authority. Start with explicit role selectors or components, not universal CSS injection. Preserve validated token-only custom themes, saved finish metadata, selection revisions and failed-hydration write blocks. Do not mutate stored themes to introduce these roles.

**Initial rule:** one backdrop-filter owner per nested visual group. Independently floating overlays may need their own material; their contrast/depth must be judged over the parent, not solved by more overlapping blur. This is a design/performance budget, not a claimed GPU guarantee.

### Visual language

- Keep Space Grotesk for UI and JetBrains Mono for code/technical values. Use a clear reading hierarchy; essential UI text gets more room than metadata. A proposed default is 13px primary UI/14px reading text, subject to native testing—not Apple's point scale copied into CSS.
- Apply the existing spacing scale and theme radii consistently. Keep functional pills/circles round. Verify concentricity at real insets instead of mechanically subtracting padding from every component.
- One primary action per task region; secondary/tertiary actions quieter. Dense toolbars keep compact rounded rectangles. Filled controls use opaque `--t-on-accent` with measured contrast.
- Keep app/semantic colors. Accent belongs to active state, important action and meaningful status; it should not tint every separator or shadow. Preserve exact approved copy/marks.
- Top light, restrained rim, soft grounded shadow. No separate glow/gradient/animated border on every interior card. Existing genuine border/effect choices remain opt-in and identifiable.
- Use a deterministic contrast floor for reading surfaces; do not pretend fixed alpha or opaque swatch checks certify glass. Prefer known material adjustments over continuous pixel sampling of user content.

### UX language

- **Shell:** app launching/switching/search. **App rail:** destinations. **Toolbar:** actions on the current document/view. **Content:** actual task and feedback. Never make these look like four competing navigation systems.
- Shared controls need default, hover, pressed, selected, focus-visible, disabled, busy and error states. Busy is not disabled-with-no-explanation. Errors preserve input and show a real next action.
- Reuse the Incubator principles: plain next-step copy, honest empty/unloaded states, visible authority boundaries, technical detail on demand, retained state and a way back. Do not turn every app into Incubator's exact layout.
- Reduce normal save feedback to quiet nearby status; escalate failed save/data-loss risk. Announce useful state changes, not every streamed token. Never fabricate progress or claim an issued save can be cancelled.
- Preserve chat drafts, exact context/recipient disclosures, model selection and Stop semantics. Improve visual grouping without changing consent, grants, uploads, provider fallback or run ownership.
- A task continues across app resizing/panel toggling. Essential content/actions remain reachable; narrow layouts should collapse secondary chrome, not shrink everything to tiny text.

### Motion and rendering

Proposed starting timings: 120–160ms control feedback, 180–240ms panel/menu transitions. These are Orion tuning hypotheses, not HIG mandates. Never delay the actual action for animation. Avoid heavy springs, animated blur, decorative zoom and intercepted inertial scrolling.

Honor reduced motion in JavaScript as well as CSS. Keep reduced transparency explicit, with positive capability/OS override behavior already proven in native WebKit. No backwards compatibility loss for unsupported preference queries. Hidden/inactive decorative work should sleep without cancelling user jobs or unmounting drafts.

Do not activate the dormant LiquidLens in the first slice. Bound effect area/count, avoid full-screen filter animation and profile combined windows, streaming, editor and wallpaper workloads. CSS fallback must remain legible without WebGL or backdrop filtering.

## 4. Ranked delivery plan — proposed, not authorized implementation

| Order | Slice | Scope / acceptance |
| --- | --- | --- |
| **1 — foundation + visual showcase** | Material roles, Liquid shell, shared controls | Inventory effective cascade; introduce explicit role recipes; reconcile old broad Liquid overrides with shared chrome. Apply connected shell/Settings/core-app chrome together in a private preview. Preserve reading/code/canvas/domain colors, custom themes and saved finishes. Review Liquid with dark/bright/busy wallpaper plus Ivory and no-glass fallback. |
| **2 — desktop interaction quality** | Windows, Dock, Spotlight, menus | Decide safe window semantics first; add labels/hit areas, meaningful active/inactive state, accessible search selection/focus/IME behavior, real reduced-motion magnification gate. Test draft/busy/PTY/plugin lifetimes before any close/minimize change. |
| **3 — app-wide task cohesion** | Orion, Archives, XDesign, shared assistant, Incubator/Settings | Normalize typography/actions/navigation, collapsible secondary rails, density and loading/empty/error/retry patterns. Keep document/code/artwork independent; preserve current gates and functionality. Prioritize actual frequent tasks over showcasing all features. |
| **4 — acceptance and optimization** | Contrast, accessibility, motion, performance | Native WKWebView matrix, keyboard/VoiceOver, resize/zoom, effect fallback and measured frame/idle behavior. Owner surface-by-surface smoke test and explicit remaining-issue list. Further optical experiments only after the baseline wins. |

Build reviewable green slices behind a separate private preview; **do not leave a half-old/half-new active product for days**. Cut over coherent connected chrome only after the material contract and core adapters are ready. No production replacement/commit/release implied. A commit per approved slice still needs separate commit authority.

### Recommended first approval

Approve **Slice 1: the material foundation and Liquid shell showcase**. It should include all connected chrome adapters required to judge the system, rather than a Dock-only mockup. It should not change lifecycle semantics, provider paths, installed-app behavior or stored theme data.

Deliverables: a bounded static material contract, shared control states, coherent Liquid shell + representative Settings/core-app chrome, explicit document/canvas exclusions, focused regressions and a separate reversible preview. Owner decides whether the material quality/direction is right before expanding into behavioral changes. No new dependencies or AI requests required.

## 5. How we will know it is better

**Measurement plan, not results:**

- Five tasks: open/reopen a coding project; create/edit/save/reopen a note; create/open a design and find an inspector action; change appearance and return; inspect a local skill without fetching/sending/installing. Compare completion friction and confusion to the baseline, not a subjective “Apple score.”
- Test Liquid/Ivory/Minimal/BMW M, one existing custom solid/glass theme, and explicit/OS reduced transparency and motion. Exercise dark, bright, busy and custom wallpaper; active/inactive and overlapping windows; compact/wide layouts.
- Contrast: WCAG AA normal text target 4.5:1, large text 3:1; [relevant non-text controls/focus][nontext] target 3:1, using the applicable definitions/exceptions. Evaluate final composited glass and all interaction states, not just palette hex values. No conformance claim from this research.
- Keyboard/VoiceOver: reach every important action; announce Spotlight selection; preserve typing/IME; cancel/dismiss predictably; return focus sensibly; keep focused content visible around menus, companion, toast and titlebars. Destructive Cancel stays safe.
- Enlarge UI text to 200% where applicable, without clipping essential controls or scaling document artwork. Preserve specialist canvas/editor navigation; do not impose mobile-page layout on the workstation.
- Existing quality targets remain: window drag at 60fps and Spotlight under 50ms perceived. Instrument frame times and dropped frames on declared hardware/window/wallpaper workloads; 16.7ms is a 60Hz frame budget, not a measured result or a universal device guarantee.
- Compare idle/background CPU/GPU, pointer tracking, scroll and streaming before/after. Record effect ownership/count and suspend unnecessary decoration. Do not measure a dormant shader as current load.
- Verify draft retention, exact saves, retry and busy/consent boundaries alongside visual changes. A beautiful screenshot with lost work fails the quality bar.

## 6. Scope, evidence and limits

Research namespace: `~/.local/share/orion-proof/skills-20260928/frontend-research-20261003-175638`. Fresh baseline enumerates 215 dirty/untracked files, 20 initial audited source files, 14 named protected artifacts and HEAD `5abece23642b731410a815563ed12525bdbcc013`. Subsequent read-only theme/cascade files are noted in the source audit; this enumeration is not a whole-repository certification.

An initial comparison to the previous research-independent proof baseline found the repository's debug executable already had a different digest (`445ae4b0…` rather than historical `1a65a047…`). The failed attempt is retained in `frontend-research-20261003-175554/baseline-initial-failure.json`. No attribution, restoration or old-baseline continuity claim; the fresh digest is preserved for this task.

This turn creates research/docs and records owner feedback only. No product implementation, build, suite replay, app activation/input/capture, credential access, provider send, source upload, dependency installation, production promotion, commit or release. Existing Design/UI/Appearance previews and owner profiles are untouched. Pending native Incubator checks remain pending despite positive owner direction feedback.

## References

Public references retrieved 2026-10-03. Apple HIG pages were read through their public `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json` endpoints because the HTML shell is JavaScript-rendered. WWDC references were read as page transcripts, not newly executed native demos. Apple's native implementation behavior is not evidence that CSS reproduces it.

[materials]: https://developer.apple.com/design/human-interface-guidelines/materials
[meet]: https://developer.apple.com/videos/play/wwdc2025/219/
[system]: https://developer.apple.com/videos/play/wwdc2025/356/
[macos]: https://developer.apple.com/design/human-interface-guidelines/designing-for-macos
[windows]: https://developer.apple.com/design/human-interface-guidelines/windows
[toolbars]: https://developer.apple.com/design/human-interface-guidelines/toolbars
[sidebars]: https://developer.apple.com/design/human-interface-guidelines/sidebars
[feedback]: https://developer.apple.com/design/human-interface-guidelines/feedback
[motion]: https://developer.apple.com/design/human-interface-guidelines/motion
[accessibility]: https://developer.apple.com/design/human-interface-guidelines/accessibility
[targets]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[focus]: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
[combobox]: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
[nontext]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
[webkit]: https://webkit.org/blog/3632/introducing-backdrop-filters/
