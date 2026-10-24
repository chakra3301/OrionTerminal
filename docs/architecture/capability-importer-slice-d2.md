# Incubator D2 — public repository document review

2026-09-16. Bounded continuation of [D1](capability-importer-slice-d.md); features before UI polish. **Implemented and focused-tested, not packaged/live-provider acceptance or general app/tool installation.**

## Delivered boundary

- Public GitHub discovery now succeeds without `SKILL.md`. Both Intake entry points offer a separate **Repository documents · analysis only** flow; existing skill import remains separate.
- Metadata-only discovery offers regular, non-executable root README/license/notice files and selected manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`, `setup.cfg`, Dockerfile/Compose). Case-ambiguous names, symlinks, submodules, empty/oversized documents and other/nested paths are excluded. An excluded root document does not block a valid unrelated skill subtree.
- Explicit selection fetches one to four documents through new `intake_github_review`, pinned to the discovered commit. Existing public-GitHub-only URL rules, fixed HTTPS hosts, no redirects/auth/proxy inheritance, bounded streaming, two-job limit, cancellation/tombstones and 90-second deadline are reused. Discovery still rejects truncated/over-4,096-entry trees. Each document is at most 256 KiB; no clone, dependency resolution, package scripts, imports, linked resources or external assets are executed/fetched.
- Native bytes must match declared sizes, decode as UTF-8, and pass the existing limited credential/LFS/NUL/shebang checks. Frontend revalidates provenance, exact selected paths/counts/sizes, SHA-256 and credential hints before excerpting. At most 8,000 UTF-16 units/file without splitting a surrogate pair; sanitized excerpts and truncation are shown locally. These checks are not comprehensive secret/security scanning or independent Git blob/signature verification.
- Acquired bytes produce an in-view document snapshot, **not a staged skill or installed artifact**. The document packet is never inserted into native package/staging storage. Changing selection, closing the view or cancelling suppresses late publication and disposes the analysis UI. Complete downloaded bodies are not retained separately after excerpt preparation.
- The shared analyzer now fingerprints `repository-documents` scope under `intake-advisory-v2`. Inventory means only downloaded documents—not a whole repository tree. A repository report must use installation strategy `unsupported`; the parser rejects an attempted `direct-skill` result. Possible future wrap/adapt approaches are human-review text only, not executable integration plans.
- D1's separate provider/model choice, exact app-owned payload/system preview, explicit upload/capacity confirmation, zero tools, bounded lifecycle, native HTTP recipient binding and explicit local assessment save still apply. Fetching documents never invokes AI. No Archives enablement/store/job is required.
- Saved v1 assessments remain readable without hydration writes or relabeling. New scope is retained in the existing bounded history; legacy records cannot be relabeled as repository-document evidence. No new migration or competing capability registry.

## Verification

- `npx tsc --noEmit` passed.
- **66 frontend tests / 8 files**: acquisition contract, immutable inputs, provenance/hash/path/secret/Unicode limits, escaped previews, no inference on fetch, cancellation/unmount/selection changes, no-skill UI path, scope-bound outcomes, mixed v1/v2 history and existing skill/analysis regressions.
- **41 native Intake tests passed / 3 opt-in tests excluded**: root document eligibility/decoding and unrelated-skill preservation plus prior GitHub bounds/cancellation and staging/install lifecycle regressions. Synthetic/local fixtures only; no live acquisition test was run.
- Logs: `/tmp/incubator-d2-frontend.log`, `/tmp/incubator-d2-native.log`; dirty baseline `/tmp/incubator-d2-before.json`.

No new dependencies, repository/provider requests, third-party code execution, production data/app access, release build, commit or release. No new native UI, live model-quality, clean-install or packaged restart acceptance.

**Follow-up:** [D3](capability-importer-slice-d3.md) now provides bounded local declaration extraction for canonical package.json/requirements.txt, not dependency resolution or compatibility verification.

## Remaining (at D2 completion)

- Updated non-production binary with `intake_github_review` and D1's reviewed runtime command; owner smoke of no-skill repository discovery → explicit fetch → preview → approved analysis → explicit save/reopen, cancellation and unchanged skill install consent. Old binaries have no fallback acquisition path.
- Generic local non-skill directories, nested/arbitrary source files, complete repository snapshots, deterministic dependency/runtime compatibility facts, richer host profiles and executable integration plans remain future work. Archives RepoLens itself is not brought to upstream parity here.
- Owner-selected stock/tool/image-to-3D repositories and a Ripper output are still needed for family-specific adapters. Remote connectors precede local engines; runtime/isolation/dependency/provider approvals remain separate. UI polish stays deferred.
