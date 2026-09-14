# Public CI candidate — 2026-09-14

## Authorization and boundary

Luca explicitly approved reviewing, committing and pushing the candidate to a **separate public validation branch**. This does not authorize merging `main`, creating a release tag, uploading release assets, replacing production or declaring release acceptance.

Branch: `validation/alpha-2026-09-14`. Before this work, local `main` was `7a04960`, **25 commits ahead and zero behind** freshly fetched `origin/main`. Those commits contain Brain/visualizer, characters, Cursor integration and plugin lifecycle/sandbox work; the validation branch retains that history rather than rewriting or silently omitting it. Local and remote `main` are not moved by this operation.

## Focused publication review

This is a source/publication review using the existing per-slice verification, not a new blanket security or legal audit.

- Inventoried726 modified/new candidate files before this publication note and cache-ignore change:362 notice files,8 matching source archives plus their README, and application/build/test/documentation changes. The only excluded generated file was `scripts/__pycache__/rehearse-profile-recovery.cpython-313.pyc`; it remains on disk and is now ignored.
- Reviewed the25 unpublished commits'177 changed paths. Their large additions are the seven owner-confirmed optimized character GLBs. No profile, credential-store or database paths were identified for addition. Temporary native/browser fixtures, screenshots and raw operational evidence remain outside the repository.
- Rechecked entrypoint/migration wiring, release-versus-development configuration, provider identity/tool execution boundaries, saved-session ownership, atomic project/file-save acknowledgment, modal request settlement and renamed-path safety. Compared accumulated changes with the documented native/deterministic evidence. No migration SQL changed relative to the remote base.
- Reviewed remaining early WIP including packaged terminal PATH, subscription-image plumbing, FX file/raster loading and provider catalog changes rather than silently dropping them. These retain the documented experimental/live-acceptance limits.
- Fresh known-pattern scan: **0 findings across3397 text versions**, including2057 referenced historical blobs;136 binary/large entries skipped. This is not comprehensive secret clearance. The eight new binary archives are the already hash-verified public upstream MPL source packages, not user data.
- Fresh offline material check: **342 native notice entries and8 source archives pass**. Prior emitted main/worker and packaged-resource verification remains applicable; no dependency or application-code change was made in this publication step. Historical input-revision/notice-baseline limits remain recorded in [distribution licensing](2026-09-13-distribution-licenses.md); public CI is not final legal or binary-distribution approval.
- Full staged whitespace checking flags preserved upstream notice whitespace and intentional Markdown hard breaks in third-party notices. Those bytes remain unchanged to preserve verified hashes; the check excluding only those notice paths passes. Fresh30 Node bridge/packaging contracts pass.
- GitHub access verified for `chakra3301/OrionTerminal` (public); Actions enabled. The verification workflow has read-only contents permissions and does not persist checkout credentials. It runs on branch pushes. The release workflow requires a `v*` tag or explicit tagged dispatch; neither is part of this authorization.

Local application evidence remains **198 frontend files/1254 tests,30 Node,240 Rust passed/1 ignored**, plus the specifically attributed [native dialog checks](2026-09-13-modal-accessibility.md), earlier core workflow/recovery proofs and license packaging. These are not automatically new native acceptance for a future CI build.

Private review evidence: `/tmp/orion-release-next/public-candidate-review/` (inventory/hashes, unpublished-history paths, bounded credential-pattern scan, staged manifest and push/CI results). Remote CI must be evaluated against its exact commit and run URL; a branch existing on GitHub is not a passing result.

## First remote run and clean-build correction

[Run34890638947](https://github.com/chakra3301/OrionTerminal/actions/runs/34890638947), commit `7a815e5c3b82fcdd1e8bb40f995890942f5e124a`: fresh dependency install, TypeScript,198 frontend files/1254 tests and30 Node tests passed. Native compilation then failed with **`resource path ../dist/licenses doesn't exist`**. The runner is confirmed `aarch64-apple-darwin` (Rust1.98.1).

Cause: `verify` compiled Rust before running Vite; Tauri now requires emitted license resources at compile time. Existing local `dist` output concealed this ordering dependency. Corrected `verify` to build the frontend before native tests and made release preflight use the same command. A regression fails on the original order, then passes with the correction; no empty placeholder resource, license bypass or skipped test was added. Standalone Cargo/native-test commands on fresh checkouts require a prior frontend build. The failed run remains evidence, not CI acceptance.

[Run34891224808](https://github.com/chakra3301/OrionTerminal/actions/runs/34891224808), commit `bbee4d14c53fb62da2d287d23a5b3fe974b6cc0f`:198 frontend/1254 tests and31 Node contracts passed; Vite then exhausted Node22's approximately2 GiB heap during transformation (`Reached heap limit`, exit134). Both verification and release jobs now set `NODE_OPTIONS=--max-old-space-size=4096`, a bounded4 GiB old-space budget, leaving headroom on the runner. This affects build-time Node only, not desktop runtime memory or test coverage; Node's [documented setting](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib) is not a total-process-memory cap. This second failed run is also retained.

[Run34891822689](https://github.com/chakra3301/OrionTerminal/actions/runs/34891822689), commit `2ca291826bbaf19983b8cd33ae5905ffd728d6d7`: full verification (198 frontend/1254 tests,31 Node,240 Rust passed/1 ignored), generated recovery rehearsal and both production npm audits passed. The final native audit correctly blocked **RUSTSEC-2026-0285**, published2026-09-14, affecting locked rustls0.23.44. [RustSec's authoritative record](https://raw.githubusercontent.com/RustSec/advisory-db/main/crates/rustls/RUSTSEC-2026-0285.md) identifies0.23.45 as patched: TLS1.3 handshake messages must not cross key changes at the wrong encryption level. Transcript authentication still prevents an on-path attacker from altering/completing the handshake; this is not described as a total TLS authentication bypass.

Updated **only rustls0.23.44→0.23.45** in the application lockfile, with no additional dependency changes. Inspected the upstream alignment fix and key-material zeroization changes; regenerated the matching notice/manifest, retaining other material hashes. Local native240/1ignored,31 Node contracts, material checks and refreshed target audit pass (zero blocking, the same five UNIC maintenance findings). No advisory suppression. Earlier packaged executables still contain their original dependency versions; a future release bundle must be rebuilt from the patched commit. The failed run is not overall CI acceptance.

## Remaining release decisions

Clean-Mac installation/upgrade/core recovery, disclosed accessibility coverage, final provenance/risk acceptance and user approval of the actual release candidate remain open. The selected-target UNIC maintenance risks and experimental provider/specialist boundaries are not waived. No release is signed off by this review.
