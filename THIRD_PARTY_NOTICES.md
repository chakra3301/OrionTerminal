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

The repository analysis modules under `src/apps/archives/repolens/` and the
shared source-framing helper `src/features/repoAnalysis/sourceText.ts` include
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

## Pinned 2048 preparation recipe

`src/features/staticApps/` contains an owned deterministic preparation layer and an inert base64 golden fixture from gabrielecirulli/2048 at `478b6ec346e3787f589e4af751378d06ded4cbbc`. Upstream engine bytes are never evaluated by preparation tests. The core MIT grant is retained in `THIRD_PARTY_LICENSES/2048-MIT.txt`; generated candidates carry exact source and attribution.

The test fixture's unchanged Clear Sans WOFF bytes originate from that pinned 2048 source. Full Intel Apache-2.0 notice and README at `1993725b24a36af21e7ebaa8977103983b608572` are retained in the fixture; license copy: `THIRD_PARTY_LICENSES/ClearSans-Apache-2.0.txt`. Font conversion/metadata identity remains uncertified. These fixture fonts are not imported into the host UI.

Sassy Math readme/helper at observed `60d130108bcd20c5cd5aa50b52505afab9a40519` retain MIT2012 Sam Richard, Mario Valencia and Scott Kellum attribution in `THIRD_PARTY_LICENSES/SassyMath-MIT.txt`. Original copied-helper revision is not known. Preparation supplies these notices to candidates; matching hashes are not legal/security clearance or permission to execute/install.

## XDesign design and image engines

XDesign uses OpenPencil 0.15.1 under MIT, including locally adapted component slot
semantics, Figma slot protocol, interactive behavior contracts/binding helpers and
pattern tile rendering and fractional sibling ordering. Adaptations from the inspected repository revision are
recorded in `resources/adapted-license-upstreams.json`. The complete grant is retained in
`THIRD_PARTY_LICENSES/OpenPencil-MIT.txt`; bundled Inter retains its OFL grant.
PhotoCraft native crates are pinned to
`47f9306fd06d5dee11acb84b108606f4c867222a` and retain their MIT/Apache grants
and identified dependency notices under `THIRD_PARTY_LICENSES/native/`.
The acceptance checksum manifest comes from that PhotoCraft revision.
The continuous retouch adapters in `src-tauri/src/xdesign_photo_retouch.rs`
and `src-tauri/src/xdesign_photo_retouch_dabs.rs` adapt native coverage, clone
sampling, healing/inpainting and tone/focus formulas from that revision's
`crates/engine/src/retouch_cmds.rs`; mixer/replacement paint from
`crates/paint/src/mixer.rs` and `replace.rs`; and nonseparable color helpers
from `crates/color/src/blend.rs`. Copyright (c) 2026 ArtCraft Team and the
PhotoCraft contributors; MIT OR Apache-2.0. Full grants and NOTICE are retained
in `THIRD_PARTY_LICENSES/native/photocraft-engine-0.3.0.md`; scope/provenance is
in `resources/adapted-license-upstreams.json`.
`src-tauri/src/xdesign_photo_retouch_admission.rs` adds Orion-owned dab/geometry
admission before native allocations. Retouch cancellation uses the pinned public
raster Interrupt and inpaint/Poisson APIs; interruptible seamless cloning retains
native boundary data and final mixing without an engine fork.
`src-tauri/src/xdesign_photo_retouch_sparse.rs` uses the pinned public native
coverage lookup and tail-preview APIs for Clone/History Brush feedback, retaining
native sampling/blending with Orion-owned dirty patch restoration.
`src-tauri/src/xdesign_photo_retouch_working.rs` provides Orion-owned float tile
working/source caches and native dab/halo neighborhoods; sequential publication
retains the pinned tone/focus/mixer/replacement formulas and exact float carry.
`src-tauri/src/xdesign_photo_smudge.rs` uses the same revision's public Smudge
API and retains native source/composite sampling and final stroke mixing,
with Orion-owned boundary dependencies and float tile checkpoints.
History Brush coverage and source-target lookup in the retouch/history adapters
follow the pinned native formulas; snapshot identity and retention validation
use an Orion-owned weak registry over public history APIs.
Prepared retouch completion uses the public native jobs API and retained native
edit/history, clone-result and final mixer-carry semantics, with an Orion-owned
guarded transfer/coalescing adapter and terminal-event cleanup.

`src-tauri/src/xdesign_photo_healing_publish.rs` uses the public native coverage
application API in bounded patches, with Orion-owned coverage staging and channel
restoration. `src-tauri/src/xdesign_photo_spot_inpaint.rs` adapts deterministic
proximity search, texture synthesis, SplitMix64 and hole/integral geometry from
that revision's `crates/algo/src/inpaint.rs`, adding cooperative cancellation
without changing search order, float math or the complete solve domain. The
empty-source fallback uses the public interruptible Poisson API. The same
PhotoCraft copyright and full MIT/Apache-2.0 grants above apply.

`src-tauri/src/xdesign_photo_healing_solve.rs` retains the pinned healing
mask-bounds, clamp and public Poisson semantics with Orion-owned strided staging
and borrowed/lazy paint publication. It removes full destination and cropped
input copies while retaining the complete solve region and native float output.
The same PhotoCraft copyright and retained grants above apply.

`src-tauri/src/xdesign_photo_healing_sources.rs` retains native current/below/all
source visibility and complete composition/source regions. Bounded reads,
conversion and affine batches use public native APIs with Orion-owned staging
and cancellation; source interpolation and premultiplied-alpha math are unchanged.
The same PhotoCraft copyright and retained grants above apply.

`src-tauri/src/xdesign_photo_brush_feedback.rs` uses the pinned public native
LiveStroke API for Brush/Pencil/Eraser previews and prepared completion. Implicit
mask/channel/Quick Mask routing and single-color-channel restoration follow
`crates/engine/src/channel_cmds.rs`, with bounded restoration patches and
Orion-owned source/tool/target/symmetry guards. Native paint math is unchanged.
The same PhotoCraft copyright and retained grants above apply.

Image storage compaction in `src-tauri/src/xdesign_photo_bundle_compaction.rs`
and `src-tauri/src/xdesign_photo_maintenance.rs` uses the same public format
ZIP/directory APIs. Byte-preserving conversion, recovery intents, equal-object
sharing, startup scheduling and reporting are Orion-owned; version and source
identities are retained without modifying the native engine.

`src-tauri/src/xdesign_photo_history_persistence.rs` uses pinned public native
History, format and raster tile APIs. Snapshot references, weak source identities,
native history reconstruction and exact-byte tile re-sharing are Orion-owned
adapters. Native labels, layer targets, past/redo and source pixels are retained.
The same PhotoCraft copyright and retained grants above apply.

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
