# Orion Intake — bounded Phase 0 / skills-first slice

2026-09-16 planning record. **Phase 0 is not fully closed.** Owner subsequently approved Slice A; [implementation receipt](capability-importer-slice-a.md) records code completion, focused checks and pending native UI/owner acceptance. The proposals below describe the plan, not blanket implementation or permission to execute later slices.

Continues [handoff](capability-importer-handoff.md), [scope](capability-importer-scope.md), and [RepoLens audit](capability-importer-repolens-audit.md). No change to the endorsed product direction.

## 1. Checked fixture and measured limits

Owner supplied `https://github.com/Leonxlnx/taste-skill.git`.

- Resolved HEAD: **`e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58`**, commit time `2026-09-16T15:01:43Z`, “Show Kimi and Vercel as open source supporters”.
- Commit tree: `cf2fe7019288b74f6c0d78feee6b61a188159793`. GitHub reports the commit unsigned; content pinning is not publisher authentication.
- Complete API tree: 91 entries / 65 blobs / 3,118,209 declared blob bytes; all blobs mode `100644`, no tree-reported symlinks/submodules. This is not a local-filesystem traversal test.
- Fetched **37 selected text/source files, 380,947 bytes**. Checked each byte length and Git blob hash against the tree; computed SHA-256. Remaining 28 files were not downloaded. Metadata/source only, no archive extraction, image decoding, repository code execution or external links followed.
- Permanent [inspection receipt](capability-importer-taste-inspection.json) includes hashes and excluded paths. It is **not** a complete installable snapshot, signed attestation, full semantic review or security scan. Selected contents were read/queried for package structure, metadata, resources and execution hints; not every fetched instruction was semantically audited.
- Root `LICENSE`: MIT, copyright 2026 Leonxlnx. SHA-256 `4575a543ab88dad12ccea7d97e563d0bce5b448b06072e65d3264497dad326df`. Preserve its bytes in each selected candidate's attribution. Sponsor logos/site assets are unnecessary for skill import; their separate rights were not cleared.

### This is a multi-skill repository

There are **13** `skills/*/SKILL.md` entrypoints: brandkit, brutalist-skill, gpt-tasteskill, image-to-code-skill, imagegen-frontend-mobile, imagegen-frontend-web, minimalist-skill, output-skill, redesign-skill, soft-skill, stitch-skill, taste-skill-v1 and taste-skill. Intake must enumerate them rather than silently installing all.

| Proposed first fixtures | Actual contents / outcome |
| --- | --- |
| `skills/taste-skill/` | Main/current taste skill, frontmatter name `design-taste-frontend`; **87,253 bytes / 1,206 newline-counted lines**, only `SKILL.md` in this subtree. Text import is feasible subject to adapter/context review. Not a resource-loading proof. |
| `skills/stitch-skill/` | Frontmatter name `stitch-design-taste`; `SKILL.md` 11,851 bytes plus sibling **`DESIGN.md` 12,053 bytes**. Proposed real resource-preservation fixture from the same owner-supplied repo. The sibling is a design-system example; the skill's mentions of `DESIGN.md` also describe an output, so do not assume every mention means “read this input”. Explicit resource attachment/read proves the round trip. |
| `skills/taste-skill-v1/` | Separate legacy entrypoint, not a silent fallback for the oversized current skill. |

The [Agent Skills specification](https://agentskills.io/specification), inspected this session, requires `name` to match the parent directory. Both proposed fixtures differ. **Strict direct import must report this mismatch**, not call them spec-valid. Proposed visible packaging adapter: retain source bytes and source subpath, map the candidate root to its declared name, copy LICENSE into a host-owned attribution slot, and disclose the path mapping. No instruction rewrite. Arbitrary external paths are not made accessible by this adapter.

The specification's <5,000-token / <500-line guidance is a recommendation, not a format rejection. A generic 64 KiB importer would reject the actual current taste skill. Proposed SKILL byte ceiling is 128 KiB; inference budget is a separate gate. Show measured bytes and a clearly labeled token estimate, never silently truncate or summarize. If the selected route cannot fit the complete instructions plus reserved conversation/output, block that activation and offer a different route or explicitly reviewed adapter.

No `allowed-tools` field occurs in the inspected skills' frontmatter. Still test hostile fixtures that declare it. Main taste instructions contain npm/npx installation examples and external asset URLs. Root `skill.sh` is a shell registry; four root `scripts/*.mjs` import `sharp` and manipulate README assets. No package manifest/lockfile appears in the complete tree. **Neither scripts nor suggested dependencies are needed to store these two skill directories.** Do not source `skill.sh`, install sharp, run npx, load README tracking images or configure Google Stitch. Stitch text/design drafting can be supported; actual Stitch service/MCP behavior is unverified and separately gated.

### Remaining Phase 0 fixture matrix

| Family | Current result |
| --- | --- |
| Taste + resource-backed skill | Source-inspected above; propose both fixtures for approval. No install/inference/restart acceptance. |
| Self-contained app | Existing `examples/plugins/hello-orion.orion-plugin` manifest inspected as a possible local control (self-contained `ui.html`, storage + notifications). Not newly installed/tested; owner external app example pending. |
| Remote tool / read-only stock app | Exact owner example and service/auth/data terms pending. No compatibility claim. |
| Node/Python project / image-to-3D | Exact owner URLs pending. Hardware/weights/licenses/runtime isolation unknown; blocked from automatic execution. |
| Existing Ripper output | No owner-selected output inspected. Do not search production project DBs to choose one. Handoff remains metadata/artifact-only, without `openInOrion`. |

These missing examples do not block local contracts/skill staging. No full-platform schedule estimate until those gates are resolved.

## 2. Relevant local source findings

Baseline HEAD remains `fc6743027df617900679bfde91eae07e37187394`. Many unrelated changes are present. This task edits documentation only; no reset/stash/format/commit, app launch, account or DB access.

- `agentTypes.ts::Skill` has instruction text/tools only; no resources, immutable versions, enabled state or provenance. `parseSkill` tolerates arbitrary object-shaped tool entries; do not feed untrusted frontmatter into it as validation.
- `skillsStore.ts::save/remove` publish in-memory changes **before** awaited DB writes. `load` catches errors and sets `loaded: true`. New imported installs must not inherit phantom-install or failed-hydration overwrite behavior. Existing optimistic hand-authored writes need focused durable-before-visible handling too.
- `agentsDb.ts` saves one `skills` row; `0026_control_panel.sql` has no package metadata. Existing agent IDs/skill IDs must survive. Latest registered migration is currently 0029: append the next unused number at implementation time, never edit 0026.
- `composeAgent.ts` concatenates instructions, unions stored grants and silently skips missing skills. `resolveSend.ts` returns no skill context for a plain model. Preserve legacy behavior/tests, but make missing/disabled **imported** attachments explicit and block the send until the owner detaches/replaces or explicitly continues without them.
- `dispatchSend.ts::mergeExtra` unions host/agent tool extras. Imported tool requests must never enter this as granted extras. `runtimeTools.ts` rejects unsupported mappings/external MCP on the generic runtime. `null` is not zero authority; analysis must send `[]` explicitly.
- `textCall.ts::runSurfaceAnalysis` uses the selected provider, bounded lifecycle and zero tools. It currently includes selected-agent instructions in the prompt. `runTextModel` still uses the special RepoLens Claude IPC route for Claude. Neither should be blindly reused for consent-bound Intake analysis without a neutral explicit-model boundary.
- Archives `pluginContributions.ts` owns RepoLens store busy subscriptions and disable blockers. Extract pure logic/analysis without importing `useRepoLens` into Intake or transferring Archives-owned jobs to a hidden global store.
- Native `plugin_runtime.rs` already has bounded package scanning/fingerprints, but is a community-HTML package installer, not a skill installer. Reuse audited path/hash ideas, not its manifest/authority or lifecycle registry. Native `xdesign_state.rs` is an existing `rusqlite` transaction pattern, not a general-purpose DB-write API to extend.

## 3. Proposed v1 contracts (not existing APIs)

Use strict TS/Rust boundary parsers, discriminated schema version **1**, bounded strings/arrays, and rejection of unsupported versions/authority-bearing fields. Types below are field contracts, not permission-bearing model output. IDs are opaque host-generated IDs; SHA-256 values are lowercase 64-hex. Source files never supply receipts or trusted identity.

| Contract | Required fields and invariants |
| --- | --- |
| **SourceSnapshotV1** | `schemaVersion`, `id`, `createdAt`, `origin` (`local` opaque selection handle, or public `github` normalized owner/repo + requested ref + resolved commit/tree), `scope` (selected subtree + explicit attribution inclusions), `files[]` (`relativePath`, original source path, byte count, SHA-256, regular-file mode, opaque content ref), `manifestHash`, coverage (`complete`, `partial`, `failed` + omissions/reasons). A local source has no invented Git revision. Display labels are not readable filesystem grants. Only complete selected-scope snapshots can become install candidates; repository-wide coverage may remain partial. |
| **AnalysisEvidenceV1** | `id`, `snapshotId`, `manifestHash`, `kind` (`measured`, `static-rule`, `ai-assessment`, `functional-test`), analyzer/rule/schema version, host timestamp, `status` (`completed`, `not-run`, `unsupported`, `failed`, `cancelled`, `stale`), scope/counts/limits, findings with path/hash/optional line or dependency coordinates, limitations, optional model/provider + consent receipt ref. Coverage and result are separate: zero findings is not “safe”. Host verifies file citations exist; unverifiable model claims remain assessments. |
| **IntegrationPlanV1** | `id`, source hash, evidence refs, host-capability/policy/context version, selected entrypoints, strategy (`direct`, `wrap`, `adapt`, `rebuild`, `unsupported`), proposed destination, requirements, blockers/unknowns, requested build/runtime/data-sharing authority, budget estimates, proposed steps, expiry/review status. AI can suggest only an advisory subset; it cannot set policy results, receipts, grants, approved state, executable commands or `verified`. A deterministic host assembler produces the review plan. |
| **ArtifactCandidateV1** | `id`, `planId`, snapshot hash, artifact manifest/hash, capability kind, source/generated provenance, adapter version + exact path/content diff, preserved license refs, validation evidence refs, requested authority, host-issued review receipt ref or null. Generated candidates additionally record generator/model/scaffold versions and input hashes; a Ripper path alone is not provenance. Immutable candidate bytes; change anything and issue a new candidate/review. |

**Canonical manifest hashing:** sort normalized relative paths by UTF-8 bytes, then SHA-256 over a versioned domain prefix and unambiguous length-prefixed path + fixed-width byte count + file hash + mode records. Keep this algorithm versioned/test-vector-backed. Reject normalization/case-fold collisions rather than silently overwriting on macOS. Git SHA-1 identifies upstream Git objects; it is not the artifact SHA-256 or publisher signature.

**Host-only ConsentReceiptV1:** bind operation (`upload`, `stage`, `install`, `activate-turn`, later `execute`), exact source/candidate hash, selected entrypoints, provider/model and payload hash for upload, exact grants, policy version, timestamp, expiry and revocation/generation. Installation does not imply provider upload, activation, process execution or remote asset retrieval. Source/model JSON containing approval/grant fields is rejected. Consent must be rechecked immediately before dispatch/promotion, not just when the preview opened.

**Authority rule:** imported skill requests add **zero** grants. Any supported invocation uses only the intersection of explicit host/user grants, surface policy, provider support and enabled host capabilities; exact native checks still run per call. No model-written permission or prefix match expands it. Plain-model skill selection preserves the route's existing host authority, never expands it; an agent equipped only with instruction skills remains tool-less unless the owner has independently granted tools. Package scripts remain inactive in all v1 paths.

## 4. Proposed deterministic inspection baseline

No new runtime/scanner/YAML dependency requested. Existing Rust std/serde/sha2/rusqlite are sufficient for this bounded subset; a full YAML parser or advisory scanner is a separate approval if later needed.

- Proposed local package bounds: 128 files, depth 8, 8 MiB total, 1 MiB per opaque resource, 128 KiB SKILL.md, 16 KiB frontmatter, 256 KiB per text-resource read. Up to four staged packages / 32 MiB staged bytes and 128 MiB retained skill-package bytes; enforce totals in transactions, do not silently evict installed versions.
- Require UTF-8/non-NUL instruction text; reject symlinks in every path component, special files, hardlinked file inputs, absolute/drive/UNC paths, traversal, control characters and normalized/case-insensitive collisions. Descriptor-based no-follow traversal/read and bounded actual byte reads must survive source swaps, not just a `canonicalize` prefix check. Test root/intermediate-component swaps. No raw absolute paths in model context.
- Copy only an explicitly selected skill subtree plus explicitly selected parent LICENSE/NOTICE bytes. Do not resolve arbitrary `../`, remote URLs or Markdown links during inspection. A local directory-only import without parent attribution asks for that file separately; it cannot rummage through parent directories.
- First parser is a documented **restricted frontmatter subset**: known scalar string fields and bounded string-to-string `metadata`, plain/quoted strings. Reject duplicates, nested authority, aliases/tags/merge keys and unsupported multiline/complex YAML with an actionable “unsupported syntax”, rather than guessing. Preserve original bytes. The observed two fixtures need only plain `name`/`description`. Do not advertise full Agent Skills YAML compatibility.
- Inventory manifests/lockfiles, script/shebang/executable hints, explicit allowed-tools, links and resource references. Scripts are inert stored bytes, not safe code. Package preview is escaped text/tree only: no raw HTML, SVG execution, remote image fetches or clickable command execution.
- Baseline secret-risk rules: bounded credential-file/key/private-key/token-pattern checks; report rule + file + line, never matched secret. Unknown encodings/binaries/obfuscation and unsupported files remain unscanned. Suspected secrets block provider upload and normal promotion until an explicitly reviewed exclusion/redacted candidate with a new hash exists. Original acquisition bytes remain private/temporary, never in logs or ordinary receipts.
- No vulnerability advisories, malware engine, transitive dependency resolution, license clearance, binary analysis, remote behavior or functional test is implied. Dependency absence does not make instruction-driven npm examples authorized. Optional advisory integration stays deferred.

The bounds/rules above are **proposed implementation policy**, not scans run on this fixture. This session checked tree modes, selected hashes/frontmatter/resource structure and execution hints; secret/vulnerability/functional status is **not run**.

## 5. Persistence and skill lifecycle design

Recommended for the first bounded skill slice: **SQLite-owned immutable package bytes**, avoiding a filesystem-publish + SQL-commit split. Native staging reads bounded files, then stores candidate metadata/file BLOBs in one transaction. Intermediate acquisition directories are private temporary state, never installed authority. No dependency installation.

Append a migration for package/version/file records keyed to existing `skills.id`, plus candidate state and an optional installed-version pointer/enabled state for imported skills. Exact table names are chosen during implementation. This is backing storage for Skill Codex, **not another installed-capability registry**. Original author-created skills remain text rows with no package pointer; existing agents continue to reference the same skill IDs.

- Stage writes immutable metadata/resources without creating a `skills` row; preview is readable only through an opaque candidate ID. Restart lists interrupted/staged candidates as needs-review, never auto-installs or uploads.
- Promote using one native transaction: validate review/hash/current generation, insert/update the ordinary skill row with imported `tools: []`, point to the complete package version, retain previous version, consume review. New IDs are host-generated; an upstream name cannot overwrite a hand-authored/builtin skill. Update requires explicit existing imported identity + expected version compare-and-swap.
- Publish the Zustand view **after commit acknowledgement**, serialize writes and reject stale load/save callbacks. On ambiguous commit response, reload by idempotent operation ID; retry must not create a second install. Failed hydration blocks writes until retry, not empty-registry replacement/reseeding.
- Failed staging/promotion/update leaves existing skill/version unchanged. Candidate expiry/removal and cleanup are explicit/owner-scoped. With package BLOBs in the same SQLite DB, normal SQLite backups include resources; broader restore/UI acceptance is still required.
- Imported originals are immutable. “Edit” creates a named local fork or a separately versioned, reviewable overlay; never edits bytes under an existing source hash. Update/rollback swaps an installed-version pointer transactionally; no automatic updates.
- Disable removes imported instructions/resources from future contexts; revoke outstanding resource handles and cancel affected turns where possible. Already transmitted provider context cannot be retracted; start a fresh session after removal/disable so old instructions do not linger through resume.
- Remove warns about attached agents, then removes the skill/package authority transactionally. Keep missing attachment IDs visible for repair rather than silently mutating unrelated agents. Legacy missing-skill behavior stays backward compatible. Define retained-version cleanup separately from ordinary disable.
- Resources resolve by installed skill/version + package-relative path, never a raw repo path. Initially offer explicit host-side text-resource selection/attachment, with byte/budget checks and a visible per-turn list. This works without new model tools; lazy model-initiated resource tools require a later exact-grant broker slice. Binary resources are preserved but not implicitly decoded/sent/executed.

## 6. Neutral RepoLens service seam (following staging, not a prerequisite)

Proposed `src/features/repoAnalysis/` exposes a headless function accepting immutable snapshot excerpts, goal, frozen enabled-host capabilities, an explicit provider-qualified model, verified upload receipt and AbortSignal. It returns a strictly parsed advisory result wrapped in **host-created** AnalysisEvidence; no stores, app activation, acquisition, grants, file writes, tools or job auto-resume inside the analyzer.

1. Incrementally move reusable pure prompt/taxonomy/types helpers behind compatibility exports so Archives readers remain intact. Keep its permissive legacy `parser.ts` for historical reports; add a strict v1 Intake parser rather than converting legacy data into current evidence.
2. Factor a neutral explicit-model zero-tool runner from `textCall.ts`'s streamed lifecycle. Do not auto-compose saved-agent/imported skills for structured repository analysis; resolve the selected underlying model visibly. Use existing provider routing, empty grants, cancellation/response bounds and isolated analysis workspace, not `runTextModel`'s special Claude branch. No new auth stack.
3. Selectively adapt pinned RepoLens structured risks/mental-model then `evaluate_for_goal` prompts/schema/tests; later Fits-Stack only against a host-supplied enabled capability snapshot. Recheck attribution before copying helpers. No upstream runtime/browser/runner import and no parity claim.
4. Archives retains its own job cancellation/disable semantics; Intake owns only its jobs. Cache by source/excerpt hash + analyzer/schema + goal/host-policy context + selected model. Missing/disabled analyzer is unavailable, not an implicit Archives enable. Legacy reports lacking source identity are context-only.

Provider/surface contract for the first release:

| Surface/route | Planned policy; no new live acceptance |
| --- | --- |
| Foreground text chat: Claude CLI, Codex CLI, Gemini CLI, Cursor SDK, configured text API/runtime | Same explicit selected instruction/resource context, provider-qualified route, per-route budget/support checks. Real quality/tool behavior must be smoke-tested per claimed route. |
| Agent Forge on those routes | Reuse existing attachments; host-resolved imported text only, missing/disabled compatibility warning/block. No implicit external MCP support. |
| Plain model text chat | New explicit per-turn selection; no global auto-injection; chosen resources shown before send. |
| Repo analysis and other zero-tool/background calls | No automatic imported skill activation; structured analyzer uses explicit model and `[]` grants. Existing selected-agent behavior elsewhere must not change accidentally. |
| Theme/shader/image/3D and strict-schema specialist paths | Not part of universal skill activation v1. Dedicated contracts/acceptance required; do not route Stitch into theme generation automatically. |

## 7. Ranked approval request

**A — first green implementation slice: local inspect → validate → stage → preview, persistence foundation.**

- New narrowly scoped native skill-package module and pure versioned contracts/parser/tests; append-only staging/package schema using existing dependencies.
- Local folder picker, multiple-entrypoint selection, exact source/adapter/resource/attribution preview inside **Skill Codex**, no separate lifecycle manager. Use applicable design skill when building this UI; retain modern Control Panel/theme chrome rather than applying imported taste rules to Orion itself.
- Persist staged candidates/resources and prove restart/failed-write recovery. Harden skill-store durable-before-visible writes. No installed imported row, provider call or runnable resource in this slice.
- Focused checks: schema versions/unknown authority/malformed YAML/name mismatch/87 KB input; hashes/collisions/path swaps/symlinks/hardlinks/limits; no AI/network/execute-on-selection; aborted scan/stale picker callback/unmount; staged restart, failed/ambiguous commit and retry; legacy hand-authored skills preserved. Native temporary/in-memory DBs only; UI owner smoke test for preview before acceptance.

**B — pinned public GitHub acquisition.** Fixed GitHub/raw API endpoints, no credential/session inheritance, redirects denied or strictly revalidated, commit/tree pinning, bounded streamed bodies/timeouts/cancellation/rate-limit errors, tree truncation fails closed, no archive/hook/submodule/LFS execution. Enumerate selection first, fetch exact subtree + reviewed license. Reuse A's snapshots/preview; not RepoLens's current branch excerpts. Private repos and general archive ingestion deferred.

**C — explicit install + useful activation.** Transactional promotion/update/rollback/remove in existing Skill Codex; Agent Forge and one foreground plain-model text rail with explicit resource attachment, context budgets and stale/disabled checks. Stage A/B are not the complete milestone until this real taste + DESIGN.md round trip survives restart and native/provider smoke acceptance. No bundled script execution or new tool grants.

**D — neutral analyzer / selective upstream refresh.** [D1 implemented](capability-importer-slice-d.md): reviewed staged-skill excerpts, neutral explicit-model runner, advisory citation/schema validation, native HTTP recipient binding and local historical evidence. Broader repository snapshots, other families and full selective refresh remain later work; do not claim upstream parity.

**Approval received:** Slice A, main taste + sibling Stitch fixture/path adapter, and the bounded SQLite/frontmatter approach. Owner subsequently requested Incubator/public GitHub intake and continued feature implementation before UI polish. B and bounded C are now implemented; see the [Slice C receipt](capability-importer-slice-c.md) for actual lifecycle/foreground text scope, tests and pending acceptance. Further runtime/grant/provider operations retain their normal approvals. Still request real stock/remote-tool and image-to-3D URLs, plus an owner-selected Ripper output before assessing those families. Runtime decision for skills: **none needed**. General Node/Python/GPU runtime isolation remains an independent later design gate; existing subprocess/private-directory/localhost paths are not a sandbox.

## Verification limits

Documentation/source inspection only. Selected download size/blob/SHA checks, receipt consistency, local document links and diff-whitespace checks performed. No new frontend/native test run, broad suite, build, browser automation, AI provider request, downloaded script execution, dependency change, install, production data access, commit or release. No live RepoLens re-freshness/parity claim beyond the existing audit. Temporary fetched source is disposable; permanent receipt pins upstream bytes without vendoring them into Orion.
