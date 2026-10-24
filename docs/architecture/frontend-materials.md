# Shared frontend materials — first slice

2026-10-03 · Owner approved implementation, then **rejected this preview as too matte**: preserve the original see-through Liquid and refine it, not redesign the material. [Corrected clear-glass implementation and preview](frontend-liquid-refinement.md) supersede this direction. Below is the historical first-slice evidence; its tests are not visual approval. No production promotion, commit or release.

## What changed

- `src/styles/materials.css` defines shell, navigation, reading/work and transient roles, resolving aliases at the theme root before app-local document palettes.
- Liquid keeps its palette and renderer twins opaque. Explicit chrome adapters now supply the glass: restrained smoked tint, bounded backdrop brightness, soft grounded shadows and a quiet specular edge. Removed older wildcard `-canvas/-view/-pane` transparency rules, broad input flooding, extra sidebar/toolbar/card blur and the Liquid override of XDesign's canvas background.
- Window, Dock, menubar, Settings and welcome own shell material. Their navigation/toolbars share the parent frost, without independent blur. Notes, cards, Settings forms and the assistant get calmer reading surfaces. Menus/Spotlight/prompts get a distinct readable transient material.
- Connected adapters cover Orion home/file rail, Archives, XDesign chrome, shared assistant, Control Panel and Incubator. IDE/document/terminal/artwork styling remains independently owned; no selector injection into iframe, Monaco, xterm or canvas pixels.
- Default/no-capability and explicit reduced-transparency fills are opaque. The OS override is positive and same-specificity for Liquid. Ivory reuses its established tint/filter variables; custom solid/glass themes use their existing validated recipes. Minimal/BMW M palette/radius identity remains.
- Shared essential chrome/control text is 13px, assistant reading text 14px, with quieter metadata preserved. Primary task controls have 36px minimum height, visible pressed/focus states; fonts remain Space Grotesk/JetBrains Mono and existing theme radii are untouched.
- Inactive Liquid windows no longer apply opacity/filter to the entire document. Actual optional shader borders own their rim; quiet borders do not stack over them.

Static CSS and one Liquid description string only: no theme schema/hydration/persistence changes, effect activation, new dependencies, native commands, lifecycle remounting, window-control behavior, provider transport, grants, consent or imported appearance-bridge changes. The dormant LiquidLens stays unmounted. Accessibility/behavioral gaps identified in research remain the next slice, not implied fixes here.

## Focused checks

**74 tests / seven files**, TypeScript, private frontend build, license/notices and ad-hoc strict/deep bundle verification passed. New 13-test material contract covers opaque renderer palettes, retained radii, bounded selectors, positive capability/OS overrides, reading/navigation blur ownership, real rim exclusion, existing custom/light recipes and analytical neutral-backdrop endpoints. These source/math checks are not compositor contrast certification.

The first run had one test-harness failure: PostCSS represents absent `important` as undefined rather than false. Assertion corrected to reject truthy `important`; initial failure retained in `material-tests-1.log`. No product rollback or repeated broad suite.

### Native WebKit without screen takeover

A separate offscreen `WKWebView` uses a nonpersistent data store, prohibited app activation policy, a never-presented window, local actual compiled CSS and a CSP that blocks network loads. Its markup is clearly labelled **synthetic CSS-only fixture, not the packaged app**. No owner app/profile/screen/input or UI process was inspected.

Nine cases: Liquid, Liquid reduced transparency, Ivory Keep, Ivory reduced transparency, Minimal, BMW M, synthetic custom solid, synthetic custom glass and synthetic custom light. **41 bounded computed-style assertions passed:** parent material, no nested navigation/header blur, reading material, explicit opaque/no-blur fallback, existing custom recipe, undimmed inactive Liquid content, real-effect rim exclusion and unchanged authored fixture canvas backgrounds. OS preferences were observed but not changed; actual OS reduced-motion/transparency toggles were not tested.

Computed values and snapshots are retained in `webkit-computed.json`, `webkit-checks.json`, `css-probe-*.png`. Offscreen snapshots need not reproduce onscreen backdrop compositing; they do not certify pixel contrast, font loading, live editor behavior, app workflows, VoiceOver or performance. Liquid/Ivory fixture images were inspected. The fixture's transient menu animation was not visibly completed; its computed material is evidence, not visible popup acceptance.

The probe HTML was generated after app packaging and verified absent from the app bundle. Do not replay or use this evidence namespace as a future build target.

## Separate owner preview

Namespace: `~/.local/share/orion-proof/skills-20260928/frontend-materials-20261003-180819`.

- Bundle: `<namespace>/target/release/bundle/macos/Orion Terminal Material Proof.app`.
- Identifier: `com.lucaorion.orion-terminal.material-proof-20261003`.
- Native title: **Orion Terminal — Material Proof**.
- Executable SHA-256: `993f23ec45fe0f7749cb1d0bea63e0da8aac5bdfb17134073d8265c25cf17918`.
- Separate COW target; ad-hoc signed, not notarized/distributed. Agent did not launch it; no app profile/startup acceptance claim.

When ready, run this **one-use owner launcher**, rather than the raw app:

```sh
open "$HOME/.local/share/orion-proof/skills-20260928/frontend-materials-20261003-180819/Open Material Proof.command"
```

It checks the exact bundle/executable/signature, strips credential-related environment, uses new empty CLI homes and denied provider guards. It is not a credential/network sandbox. No credentials are copied, and the launcher does not authorize provider use. **Skip sign-in; keep the review visual-only.** No AI sends, imports, installs or fetches are needed. Earlier Incubator/Appearance previews are distinct and untouched.

Judge Liquid shell/window edges, Control Panel's rail/forms, Orion and XDesign home, Archives reading surfaces and assistant. Compare Ivory, explicit Reduce transparency and existing dark alternatives. Look for overly dark reading sheets, muddy glass, difficult labels, clipped controls, double rims and unexpected content colors. Close the private app normally afterward. Further full native checks and revisions should use fresh evidence, not replay this launcher.

## Preservation / limits

Fresh baseline: 216 enumerated dirty/untracked files, nine intended paths, 14 protected artifacts and unchanged HEAD `5abece23642b731410a815563ed12525bdbcc013`; prior protected digests matched at entry. Baseline and intended source copies live in the namespace; endpoint receipt enumerates actual edits/new files. Existing production/debug/release/proof bundles, unrelated dirty work, profiles and provider approvals are not replaced or transferred.

This is first-slice code/fixture acceptance, not full-product visual/accessibility/theme/contrast/font/input/performance or specialist acceptance. No production launch/replacement, owner screen takeover, model send, credential inspection, dependency install, commit or release. Real owner visual review and packaged startup/workflow checks remain pending.
