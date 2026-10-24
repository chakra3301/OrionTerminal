# Incubator frontend redesign

Updated 2026-10-03. Owner explicitly requested a good-looking, user-friendly frontend after the [initial organizational polish](capability-importer-ui-polish.md). This version supersedes that UI preview, not the supported-v1 contract. **Owner accepted the design direction (“looks good”); remaining native visual checks are pending.** No commit, release or production promotion.

## Direction and implementation

A restrained Orion workstation app, not a long engineering form or a marketing page. Existing theme tokens/materials, Space Grotesk/JetBrains Mono and soft radii remain authoritative; icons use the already-installed Lucide family.

- Compact branded app header with manager destinations and an Import guide. Escape closes the guide and returns focus to its summary.
- Persistent desktop workflow rail; responsive compact navigation for narrow app windows. Settings retains the embedded presentation. Left/right/Home/End still work; up/down also navigate the rail.
- Separate GitHub and local skill-folder entry surfaces. Initial copy explains the next action rather than leading with hashes and implementation caveats. The visible inspection boundary still says no AI, installation or execution; its disclosure retains the full acquisition explanation.
- Honest empty review queue and imported-skill library, with an explicit return to source inspection. Reload remains available even after failed hydration; stale records are not presented as a loaded queue.
- File-browser-style review: identity/status header, original resource list, selected resource state and escaped text preview. Full hashes, declared requests and inspection warnings remain available in a provenance disclosure. Rights/installation gates stay visible and unchecked.
- Explicit inspection brings the new review into view without stealing focus; Back to sources scrolls and focuses the owning panel. Workspace switching retains mounted hidden/inert panels and review leases. Installation precedes the optional AI assessment in the page order; neither happens automatically.
- App preparation uses distinct pinned-2048 and prepared-SDK surfaces. No additional recipe, repository conversion, dependency or runtime capability.

No native command, grants, CSP, provider transport, immutable package/recipe bytes or lifecycle authority changed. Existing cancellation, recovery, unknown-result and approval behavior remains. No fetch, provider upload, imported installation or execution during this redesign.

## Checks and private preview

Fresh namespace: `~/.local/share/orion-proof/skills-20260928/incubator-design-20261003-154404`; pointer `incubator-design-namespace`. Baseline: 213 enumerated dirty/untracked files, HEAD and 13 protected artifacts, including the preceding UI Proof executable. Owner mutable Appearance and prior UI Proof profiles uninspected; no profile copy or production replacement.

**75 UI tests across nine files**, TypeScript, diff and license/notices checks passed. Existing hydration-retry test caught a real regression when moving Reload under a loaded-only queue; corrected by keeping the heading/reload available independently of loaded records. Failure retained in `ui-initial.log`. New tests cover workspace presentation, no automatic acquisition, empty-library return, escaped selected resources, provenance disclosure, Back focus and up/down navigation.

One private frontend/offline COW native build and ad-hoc strict/deep signature verification passed:

- App: `<namespace>/target/release/bundle/macos/Orion Terminal Incubator Design Proof.app`.
- Identifier: `com.lucaorion.orion-terminal.incubator-design-proof-20261003`.
- Executable SHA-256: `487b4a48962b95db416663f769bd1e636c418f051945322a83ab8fee8ce17c77`.
- Native title: **Orion Terminal — Incubator Design Proof**, distinguishable from the previous preview.
- Separate profile, empty CLI homes, stripped credential-related environment and denied CLI guards; not a general credential/network sandbox.

Native startup, explicit built-in Incubator enablement and actual empty source layout were checked (`04-source.png/json`); full-width containment and two source surfaces render correctly. The existing desktop companion partly overlaps the right edge of that screenshot. A subsequent Hide action and one activation attempt were refused by foreground guards while Chrome was frontmost: **no input delivered and no workaround/repeated activation**. Identity-only refusal metadata is retained in `foreground-refusal.json`; no Chrome content inspected. Additional native Apps/library/guide/narrow/theme/review checks were not completed and earlier-version acceptance is not transferred.

The Design Proof is left open in the background, with no staged or installed fixture. Generated fixture files in the private namespace were not inspected, uploaded or installed. Old UI Proof and owner Appearance artifacts remain untouched.

## Owner review

Owner subsequently said the redesign “looks good” and requested [whole-product frontend research](../research/orion-frontend-2026.md). This accepts the direction, not the unperformed native checks. When convenient, bring the **Design Proof** to the front—not the earlier UI Proof or production app—to check Apps/library, Import guide, window resizing and Liquid/Ivory. Keep this visual-only: no provider sign-in/send, repository fetch or installation is needed. Report confusing controls, visual imbalance, clipping or difficult navigation. Further agent native input can resume only with owned foreground; additional provider work still needs separate exact consent.

Bounded checks are not exhaustive accessibility/theme/font/layout/lifecycle/security/fault/legal acceptance. The prior [supported-v1 closeout](capability-importer-v1-closeout.md) remains separately scoped; XDesign/Website Ripper work is not started.
