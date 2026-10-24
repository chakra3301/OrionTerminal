# Liquid refinement — restore the original see-through character

2026-10-03 · Owner rejected the first material preview: **“i like the old one this is too matte i like how see through it was i just wanted to refine the look.”** This supersedes the smoked/matte direction in the [first slice](frontend-materials.md). Refinement means preserve Liquid's transparency, not redesign its material identity.

## Correction

- Restored the original pale icy glass fills: shell 2.5%, reading/card 2%, input 7%, with `blur(11px) saturate(1.5) brightness(1.04)` instead of the 18px blur/darkening/contrast curve. Navigation gets a thin 12% tint; no 42% rail or 82% reading sheets.
- Existing typography, spacing, soft geometry, control/focus states, quiet rims and shared parent frost remain. Explicit structural Orion panels and XDesign root are clear; actual Monaco/terminal/canvas/artwork keep their independently owned colors. No universal name-pattern injection or dormant shader activation.
- Palette/renderer twins remain opaque. Capability fallback and explicit/positive OS reduced-transparency recipes remain opaque; OS override also restores control/chrome fills and generic glass tokens. No stored preferences, theme schema, provider, lifecycle, grants or behavioral changes.
- Liquid description now says **“See-through icy glass, soft highlights and refined controls.”**

42 focused tests/five files, TypeScript, private Vite/offline COW native build and strict/deep ad-hoc signature pass. A fresh offscreen nonpersistent/no-presented-window WebKit fixture checks Liquid, Liquid reduced transparency and Ivory against actual compiled CSS. Receipts/snapshots are fixture evidence, not packaged workflow/compositor/font/VoiceOver/performance acceptance. Clear white-ink glass cannot guarantee contrast over arbitrary bright wallpaper; the bright fixture exposes that limit. The opaque accessibility option remains available. No blanket contrast claim or extra darkening was reintroduced.

## Corrected separate owner preview

Namespace: `~/.local/share/orion-proof/skills-20260928/frontend-clear-20261003-184800`.

Bundle: `<namespace>/target/release/bundle/macos/Orion Terminal Liquid Refinement Proof.app`; ID `com.lucaorion.orion-terminal.liquid-refinement-proof-20261003`; executable SHA `6e3303ddbbb06506d92b8e531d1f45d8ffb73d19015c2ed2f0fb14394d205b28`. Ad-hoc signed, not notarized or shipped; agent did not launch it or create an app profile.

When ready:

```sh
open "$HOME/.local/share/orion-proof/skills-20260928/frontend-clear-20261003-184800/Open Liquid Refinement.command"
```

One-use owner launcher checks identity/signature, strips credential-related environment, sets new empty CLI homes and denied provider guards. Not a credential/network sandbox. **Skip sign-in; no AI, fetch or import is needed.** Review see-through Liquid with the existing chrome refinements, particularly labels over your wallpaper. This is not a request for another broad acceptance run. Close the private app normally after review.

Prior matte Material Proof is retained byte-exact, not silently replaced; original production and other previews remain separate. Fresh baseline/preservation endpoint enumerates existing dirty work, intended edits, protected artifacts and unchanged HEAD. No screen takeover, owner profile inspection, model send, credential inspection, dependencies, production promotion, commit or release. Owner visual acceptance remains pending.
