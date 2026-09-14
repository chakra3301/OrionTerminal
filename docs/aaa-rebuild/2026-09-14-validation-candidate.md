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

## Remaining release decisions

Clean-Mac installation/upgrade/core recovery, disclosed accessibility coverage, final provenance/risk acceptance and user approval of the actual release candidate remain open. The selected-target UNIC maintenance risks and experimental provider/specialist boundaries are not waived. No release is signed off by this review.
