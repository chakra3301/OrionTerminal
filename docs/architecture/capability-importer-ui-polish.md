# Incubator UI polish — owner smoke-test handoff

Updated 2026-10-03. **Implementation and bounded agent checks complete; owner visual/interaction acceptance pending.** Supported v1's earlier [native](capability-importer-v1-native-acceptance.md) and [live-provider](capability-importer-v1-live-acceptance.md) gates remain separate. Nothing committed, released or promoted to production.

## Authority and scope

Owner: “okay then keep going til i need to smoke test it,” following the proposed Incubator/shared Settings workflow and Control Panel-style polish. Screen permission remained available. This did not renew any exhausted provider consent or authorize new adapter/runtime/dependency work.

Changes are frontend-only: Incubator header/disclosure, shared intake navigation and typography, wrapping, control surfaces, review/library/planning busy annotations and focused UI regressions. Existing theme authority, Space Grotesk/JetBrains Mono, soft radii, semantic/source colors, escaped source previews, rights/upload/install gates and Manager/Codex ownership remain. No native command, recipe, source adapter, CSP, grant or installation contract changes.

## Implemented

- Four named workflows: **Skills & repositories**, **Apps**, **Installed skills**, **Saved reviews**. Skills and repository inspection share acquisition; prepared apps are distinct from executable repository conversion.
- Roving focus: arrows, Home/End, selected-state and tab/panel associations. Native WebKit exposes tabs as AXRadioButton.
- Inactive panels remain mounted but `hidden` and `inert`, preserving selected bytes, drafts and review leases. Navigation is not cancellation. Parent and annotated nested busy operations prevent switching and explain why; existing Stop/recovery semantics remain.
- Drops outside source inspection refuse locally. Known 2048 repository navigation opens Apps without acquisition or preparation.
- Capability explanations collapse by default; smaller controls, bounded prose, wrapping consent/metadata/resource lists and responsive two-column navigation reduce the previous continuous wall of panels. Shared overrides live in `workstationApps.css`, not a competing palette.

## Private proof and evidence

Create-new namespace: `~/.local/share/orion-proof/skills-20260928/incubator-polish-20261003-100554`; pointer `incubator-polish-namespace` beside it. Fresh baseline covers 211 dirty/untracked files, one separately captured clean intended stylesheet and 12 protected artifacts/HEAD. Mutable owner Appearance profile excluded and uninspected.

App: `<namespace>/target/release/bundle/macos/Orion Terminal Incubator UI Proof.app`.

- Identifier: `com.lucaorion.orion-terminal.incubator-ui-proof-20261003`.
- Corrected executable SHA-256: `0803703fe7115fcf5542e38f3a6583adbf5141f8e13fcbb731d779b53b0e85f1`; identity in `width-fix-identity.json`.
- Separate fresh profile, stripped credential-related launch environment and empty CLI homes; Claude/Codex/Gemini/Cursor guards deny execution. This is not a universal credential/network sandbox: do not use AI, sign-in or generation flows during this visual test.
- Offline private COW target/frontend build and ad-hoc strict/deep signature verification passed. Not notarized/distributed. Production and prior proof executables unchanged.
- Final **71 tests across eight UI files**, `tsc --noEmit`, license/notices and diff checks passed. No unnecessary broad Rust/provider acceptance replay.

Native agent checks: corrected full-width layout; guarded ArrowRight selected Apps; all four workspaces; local fixture inspection and DESIGN preview retained byte-for-byte with the same candidate hash across navigation; distinct staging; shared Settings reopening with installation and upload gates still unchecked/disabled; Liquid and Ivory Keep; narrow resize with two navigation rows and stacked repository controls. Screenshots/AX dumps and `native-navigation-receipt.json` retain evidence. No repository acquisition, package installation, imported execution or provider send.

The `interface-smoke` fixture lives at `<namespace>/ui-smoke-skill`: SKILL.md 383 bytes, DESIGN.md 207 bytes and the project's full LICENSE 11,358 bytes. Exactly one 11,948-byte/three-file staged snapshot is retained for owner inspection, not installed guidance. The proof app is left open on Liquid with Incubator maximized inside the canvas; toggling Maximize returns to the checked narrow size.

### Corrections and retained non-successes

Initial container containment collapsed the flex child's width in native WebKit. `.incubator-app` now has definite `flex: 1; width: 100%; min-width: 0`; the failed build remains in `before-width-fix.app`. Native corrected screenshots, a focused stylesheet regression and the separate corrected build govern acceptance.

The first final test run exposed Vite's non-file `import.meta.url` in a filesystem stylesheet test; changed the test to the existing project-relative path convention. Failure retained in `ui-tests-final.log`; passing rerun in `ui-tests-final-2.log`. Product bytes unchanged by that test-only correction.

An ambiguous Incubator AX target refused without input. A reverse resize delivered input but did not restore width (`20-handoff.png`); not counted as restoration. The separate semantic Maximize action produced the wide handoff (`21-handoff-wide.png`). Input delivery never substitutes for observed effect.

## Owner smoke test — stop here for feedback

Use the **already-open separate UI Proof app**, not `/Applications/Orion Terminal.app` or the owner's Appearance Proof.

1. Click all four workflow tabs; Tab into navigation and try arrows/Home/End. Is each destination clear, and are focus/labels readable?
2. Under Skills & repositories, open staged **interface-smoke**, select DESIGN.md, visit Apps, then return. The review/resource should remain selected without a new fetch.
3. Scroll the source/review and Apps screens. Check long paths, disclosures and unchecked installation/fetch consent. **Do not install, fetch, analyze, generate, connect or send** for this polish test.
4. Toggle Incubator Maximize to the narrow size, then resize. Check navigation wrapping, inputs, buttons and scrolling; no clipped content or horizontal page overflow.
5. Try Liquid and Ivory Keep via Settings → Appearance. Open Skill Library and Plugin Manager from Incubator; inspect the shared workflow styling. These checks are about appearance/navigation, not another lifecycle test.

Report anything confusing, cramped or visually wrong. Agent checks are not owner aesthetic sign-off, exhaustive accessibility/layout/font/theme/operation coverage, broad security/fault/legal clearance or publication approval. After feedback, review the accumulated diff and decide separately whether to commit; XDesign/Website Ripper adapter work still requires a later chosen real output and scope.
