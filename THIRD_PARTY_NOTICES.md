# Third-party notices

## LobeHub provider marks

The notch uses bundled LobeHub provider SVGs (MIT © 2023 LobeHub), sourced from
the pinned Codenotch reference and `@lobehub/icons-static-svg` 1.95.0.
Full grant: `THIRD_PARTY_LICENSES/LobeIcons-MIT.txt`; per-file provenance:
`src/shell/notch/logos/NOTICE.md` and `sources.json`. Marks identify their
respective products; trademark rights remain with their owners.

## Codenotch side-notch design implementation

Orion's monitor adapts Codenotch's measured geometry, ring proportions, spring
parameters and hover behavior into React/CSS/SVG, plus Claude/Codex read-only
subscription quota protocols and scoped credential lookup into Rust. Upstream:
https://github.com/vinzdg/codenotch, revision
`9156c615bcd75eb50683f047d733bc39738dd7c3`, copyright (c) 2026 Vinz, MIT.
The complete grant is retained in `THIRD_PARTY_LICENSES/Codenotch-MIT.txt`;
port scope is documented in `src/shell/notch/NOTICE.md`. No upstream credentials
or account data are included. Provider marks have separate provenance above.

## Libraries.dev border effects

`border-beam` 1.3.0 and `metal-fx` 2.0.10 by Jakub Antalik are used as
unmodified npm packages for optional theme borders. Both package grants are
MIT, copyright (c) 2026 Jakub Antalik; copies are retained in
`THIRD_PARTY_LICENSES/border-beam-MIT.txt` and `metal-fx-MIT.txt`.

Metal v2 also bundles Paper Shaders code, copyright (c) Paper Design, Inc.,
under Apache-2.0. The package's exact upstream notice is retained in
`THIRD_PARTY_LICENSES/metal-fx-NOTICE.txt`, with the full Apache-2.0 grant in
`Paper-Shaders-Apache-2.0.txt`. Emitted frontend notices include the package
LICENSE/NOTICE and this additional Apache grant. The metadata's MIT declaration
does not remove the bundled shaders' Apache obligations.

https://github.com/Jakubantalik/border-beam · https://github.com/Jakubantalik/metal-fx

## Libraries.dev thinking orbs

AI activity indicators use the unmodified `thinking-orbs` 0.3.1 npm package
by Jakub Antalik, MIT, copyright (c) 2026 Jakub Antalik. The grant is retained
in `THIRD_PARTY_LICENSES/thinking-orbs-MIT.txt` and collected in emitted
frontend notices. This replaces Orion's earlier custom orb design.

https://github.com/Jakubantalik/thinking-orbs

## OpenAI OAuth

Orion Terminal's native ChatGPT subscription transport was informed by the
OpenAI OAuth project.

Copyright 2026 Evan Zhou and OpenAI OAuth contributors  
https://github.com/EvanZhouDev/openai-oauth

Licensed under the Apache License, Version 2.0. A copy is included at
`THIRD_PARTY_LICENSES/openai-oauth-Apache-2.0.txt`.

OpenAI OAuth and Orion Terminal's subscription bridge are unofficial community
integrations and are not affiliated with, endorsed by, or sponsored by OpenAI.

## img2threejs

The reconstruction subsystem in `src/apps/xdesign/model3d/` contains adaptations
of img2threejs by hoainho, including TypeScript ports of Python validation,
review, and orchestration logic. These are modified implementations integrated
with Orion's React/Three.js stores, capture pipeline, and agent transport, not
verbatim upstream programs. Individual source headers identify many of the
corresponding upstream files; see the subsystem's `NOTICE.md`.

Copyright 2026 hoainho  
https://github.com/hoainho/img2threejs

Licensed under the Apache License, Version 2.0. A copy is included at
`THIRD_PARTY_LICENSES/img2threejs-Apache-2.0.txt`.

License evidence checked on 2026-09-11 at upstream revision
`6e60b5e22419464b4853e01ddb6c0e6f6659a733`; this identifies the inspected license,
not the exact revision used by the earlier port. No root NOTICE file was listed
at that inspected revision. Upstream license history shows MIT at revision
`a27272dfcaa15ce874f29d3a32742b1e7c88fb03`, then Apache-2.0 relicensing in
`7b1c62ccf34957ac5d68b7863718af9eab777c7e`. The historical MIT grant (copyright
2026 hoainho) is also retained in `THIRD_PARTY_LICENSES/img2threejs-historical-MIT.txt`;
this does not assert that either inspected revision was the original port input.
The 27 corresponding upstream files named by 21 local port headers were reviewed
at the Apache baseline; no additional file-specific license notices were found.
The original port commit remains undocumented, rather than reconstructed by inference.

## RepoLens adaptations

The repository analysis modules under `src/apps/archives/repolens/` include
modified TypeScript ports of New1Direction's RepoLens extension (URL detection,
ranking, prompts, verdicts, lenses and graph/layout logic). Copyright (c) 2026
New1Direction, MIT. The full grant is retained in
`THIRD_PARTY_LICENSES/RepoLens-MIT.txt`, inspected at upstream commit
`94816c57d2b7dd6aa87b95e8c416f99fb32fc8d6`:
https://github.com/New1Direction/repolens . This is the inspected notice baseline,
not an assertion that every port used that exact commit.

## Shader noise

The modified simplex-noise code in `src/shell/Splash/snoise.ts` and
`src/apps/xdesign/fx/fxModel.ts` derives from webgl-noise. Copyright (C) 2011
Ashima Arts; copyright (C) 2011–2016 Stefan Gustavson. MIT permission and warranty
text is retained at `THIRD_PARTY_LICENSES/webgl-noise-MIT.txt`, inspected at
`ashima/webgl-noise` commit `6abed1e77ed1e18b181627c35f688eb30c9fe75e`.
The shared FX shader string also carries that notice so standalone shader/HTML
exports retain it.

## Website cloner scaffold

The vendored scaffold in `resources/website-cloner-scaffold/` is provided under
the MIT License, copyright (c) 2025 JCodesMore. Its full license is retained at
`resources/website-cloner-scaffold/LICENSE` and included with the bundled scaffold.
The scaffold includes a shadcn-style UI button; the additional MIT notice,
copyright (c) 2023 shadcn, is retained at `THIRD_PARTY_LICENSES/shadcn-ui-MIT.txt`.
Scaffold dependencies installed later retain their own terms; the scaffold's MIT
license is not a blanket license for third-party sites reconstructed by users.

## Editable PowerPoint export

PptxGenJS 4.0.1 by Brent Ely is MIT-licensed. Orion uses that release's official
browser-only build in `src/vendor/pptxgenjs/`, with an ES-module import/export
adapter and the source-map directive removed; upstream implementation is unchanged.
The corresponding license is retained there and in
`THIRD_PARTY_LICENSES/PptxGenJS-MIT.txt`. Published-tarball integrity and per-file
checksums are recorded in `src/vendor/pptxgenjs/upstream.json`.

JSZip 3.10.1 remains a normal application dependency, not a hidden vendored bundle.
It retains its upstream MIT/GPL dual-license terms (used here under MIT).

## Monaco and frontend license inventory

Monaco Editor 0.56.0 is bundled locally, including its worker entry points; it
is no longer loaded from a CDN. Its MIT license and upstream supplementary
notices are retained at `THIRD_PARTY_LICENSES/monaco-editor-MIT.txt` and
`THIRD_PARTY_LICENSES/monaco-editor-ThirdPartyNotices.txt`.

Vite's `THIRD_PARTY_FRONTEND_LICENSES.md` is supplemented by collected
root license/notice texts in the built frontend's `licenses/main-*.md` and
`licenses/worker-*.md`, with corresponding JSON inventories. Main and worker
graphs are collected independently; missing texts/declarations fail the build.
Readable copies also ship at `Contents/Resources/_up_/dist/licenses/` inside the
macOS app, accessible through Finder → Show Package Contents.
Exact-version overrides retain missing published texts with hashes and source
provenance in `resources/frontend-license-overrides.json`. Prebundled runtimes
also retain their separately listed supplementary notices below.

## MPL source availability and native package inventory

BlockNote core/react/mantine 0.39.2 are MPL-2.0, not relicensed by Orion's Apache
license. Their matching published source archives are included in
`THIRD_PARTY_SOURCES/`, together with selected native MPL crates cssparser,
cssparser-macros, dtoa-short, option-ext and selectors. See that directory's
README for extraction/location details and `THIRD_PARTY_LICENSES/MPL-2.0.txt`.
The archives were integrity-checked against package locks and compared with
installed package files; the upstream packages are unmodified.

`THIRD_PARTY_LICENSES/native/` contains notices for the selected Apple Silicon
normal/build Cargo graph (including build-only crates conservatively).
`resources/distribution-license-manifest.json` records versions, declarations,
checksums, source archives and notice hashes. Native compound AND terms are not
collapsed into OR choices. Where OR offers MIT, Orion uses MIT; otherwise
Apache-2.0 when offered, or the remaining declared grant. Upstream objc2 notices
retain their Apple SDK derivation discussion; this inventory does not override
Xcode/SDK terms. Unicode/CDLA and nested third-party notices remain included.

## Local inference runtime

Hugging Face Transformers.js 4.2.0 and Hugging Face Tokenizers are licensed under
Apache-2.0. Their license texts are retained as
`THIRD_PARTY_LICENSES/transformers-Apache-2.0.txt` and
`THIRD_PARTY_LICENSES/tokenizers-Apache-2.0.txt`.

The browser runtime ships matching ONNX Runtime JavaScript/WASM assets from
`onnxruntime-web` version `1.26.0-dev.20260416-b7804b056c`, as pinned by
Transformers.js. Its MIT license and upstream third-party notices, retrieved
from Microsoft/onnxruntime revision `b7804b056c`, are retained as
`THIRD_PARTY_LICENSES/onnxruntime-MIT.txt` and
`THIRD_PARTY_LICENSES/onnxruntime-ThirdPartyNotices.txt`.

Model weights (`Xenova/all-MiniLM-L6-v2`, `Xenova/whisper-tiny.en`) download from
Hugging Face on first use and retain their respective upstream terms; they are
not relicensed by Orion's root license or bundled in the application.

## Scope and provenance limits

The included manifests cover the selected native graph and main/worker frontend
graphs; the notices above cover identified adapted source and built-in assets.
They document package declarations, retained grants and source availability, not
a comprehensive source-level legal opinion. Historical port commits are not all
reconstructed; inspected upstream baselines must not be confused with exact
original inputs. Cursor SDK is governed by Cursor's own terms and is installed separately by the user into
the managed runtime directory; the SDK package is not bundled in the app.
A successful installation does not establish blanket redistribution rights.
The project owner confirmed creation and redistribution rights for the GLBs in
`public/characters/` and `public/companion/` on 2026-09-11. Those creator-owned
assets and original Orion code are covered by the root Apache-2.0 `LICENSE` and
`NOTICE`. The owner also confirmed creation of `app-icon.png` on 2026-09-13;
that icon and its generated `src-tauri/icons/` variants are covered likewise.
User-imported and third-party content are not relicensed.
Final distribution approval must review these recorded limits and the exact
artifact. Neither automated checks nor experimental feature labels establish
rights to arbitrary imported, generated, or reconstructed third-party content.
