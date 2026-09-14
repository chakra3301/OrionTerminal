# Distribution notices and matching source — 2026-09-13

## Result

**The identified notice/source packaging gaps are closed for the inspected Apple Silicon build.** This is not a legal opinion, reconstruction of every historical port input, or release approval.

Recovery Proof app SHA256: `109ef3b7cf2cc5586d0a78b35f7a1a8cb868794a444624f1173ee2bc993924e4`.

- **213 frontend packages:** 210 in the main graph, with independent worker inventories covering Monaco and Transformers/ONNX. Collected license and supplementary notice texts plus machine-readable manifests ship as readable files in `Contents/Resources/_up_/dist/licenses/`, not merely hidden in compiled assets.
- **342 native packages:** selected `aarch64-apple-darwin` normal/build Cargo graph, conservatively including build-only crates. Version/declaration/notice hashes are in `resources/distribution-license-manifest.json`; texts in `THIRD_PARTY_LICENSES/native/`. Compound AND terms are preserved, not silently treated as OR.
- **Eight matching MPL source archives:** BlockNote core/react/mantine0.39.2; cssparser0.36.0, cssparser-macros0.6.1, dtoa-short0.3.5, option-ext0.2.0, selectors0.36.1. Published archives were checked against locked integrity and installed package files, including preferred source—not just compiled JS. Archives, full MPL text and extraction instructions ship in the app's readable resources. Upstream packages were not modified.
- Added previously missing grants for **RepoLens**, **webgl-noise/Ashima Arts/Stefan Gustavson**, and the scaffold's **shadcn** component. FX shared shader strings and standalone HTML exports retain the complete noise notice; shader math is unchanged.
- Retained both known **img2threejs** grants: historical MIT before Apache relicensing. The 27 corresponding upstream files named by 21 local port headers were inspected at the pinned Apache baseline; no additional file-specific license notices were found. The exact original port commit was **not** recovered.
- Luca explicitly confirmed creation of **`app-icon.png`**; the root NOTICE now includes it and generated icon sizes alongside the previously confirmed character models.
- `.DS_Store` is excluded from generated frontend output and absent from the inspected app; original public inputs are not deleted.

## Ongoing checks

`scripts/frontend-licenses.mjs` inventories emitted modules for main and worker builds separately. Missing texts/declarations, unreviewed frontend license declarations, stale material inputs, changed notice/archive hashes, and new MPL versions without source fail the build. `resources/frontend-license-overrides.json` records exact-version exceptions with source URLs/hashes. `resources/adapted-license-upstreams.json` records reviewed adapted-code notice baselines.

`npm run licenses:prepare` uses Python3.11+, already downloaded locked Cargo packages, and bounded public notice/source downloads. It updates native notices, matching source archives and the distribution manifest. `npm run licenses:check` is offline; normal Vite builds also perform the material checks. After dependency changes, review and prepare matching material before packaging. No new runtime dependencies or application-data migrations were introduced.

These checks establish manifest/material consistency, not an independent legal audit of every transitive source line. A prebundled library can contain material outside its apparent module graph; retained ONNX/PptxGenJS/JSZip and other supplementary notices remain relevant. The proprietary Cursor SDK and later-installed CLI/LSP/model runtimes are not relabeled Apache or represented as bundled software.

## Provenance limits requiring final distribution review

- **Historical adaptations:** inspected notice baselines are not asserted to be the exact original input commits. This applies to img2threejs, RepoLens and generated/adapted shader/component code. Both known img2threejs license eras are retained; no unsupported single-revision provenance claim is made.
- **Incomplete published npm texts:** some grants came from their published npm gitHead. `react-remove-scroll-bar`'s gitHead was unavailable, so its declared MIT license is accompanied by a pinned public upstream MIT notice. Splaytree's complete license was recovered from its published README and matched to the gitHead. ONNX overrides preserve the previously inspected Microsoft grant and supplementary notices without asserting every package shares one revision.
- **Assets/content:** owner-confirmed original models/icon are distinct from user-imported media and third-party content. The upstream scaffold's MIT notice is retained; it does not license sites later reconstructed with it. Generated outputs and downloaded model weights have their own rights constraints. Apple SDK derivation discussions in objc2 notices remain intact; nothing here replaces SDK terms.

The previous broad “inventory missing” task is replaced by this bounded inventory and explicit limitations. Final rights/provenance approval, source review, clean-machine/remote CI and release sign-off remain separate decisions.

## Verification and evidence

Private evidence directory: `/tmp/orion-release-next/licensing/`.

- `materials-sync-final.log`:342 native notices and8 verified source archives. Later addition of adapted-source metadata retains pinned notice hashes; `result.json` verifies the actual bundled manifest and materials.
- `verify.log` / `verify.exit`: full TypeScript,196 frontend files/1243 tests,30 Node tests,240 Rust passed/1 ignored, Vite; exit0.
- `packaging-tests-final.log`:30 Node tests after final resource/checker changes. `fx-notice-export-test-fixed.log`:6 export tests, including the exact escaped full noise grant in generated HTML. Final packaged build also typechecks the final sources.
- `app-build.log`, `app-build-final.exit`, `signature.log`, `mcp.json`: final app build, deep-strict ad-hoc signature and packaged MCP policy smoke pass.
- `result.json`, `packaged-resource-manifest.json`: every packaged notice/source/graph file matches the prepared bytes, all8 archives contain preferred source, no Finder metadata, protected production/Validation binary hashes unchanged. Generated Recovery profile remains quarantined; no UI app launch, credentials copied, paid calls or data-recovery re-test.
- Discovery failures remain in their original logs: missing package texts, unavailable upstream gitHead, a real macOS `/tmp` versus `/private/tmp` canonical-path checker defect (fixed), and an export assertion that incorrectly expected an unbroken line across the upstream notice's newline (replaced with exact full escaped-text comparison). They are not hidden as initially successful runs.

No fresh DMG, notarization, clean-machine result, commit or publication. Earlier native workflow/recovery/account/audit evidence retains its own binary attribution; the newer package does not retroactively revalidate it.
