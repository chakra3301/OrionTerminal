# Incubator — review plans and skill version comparison

2026-09-16. Continuation after [D3](capability-importer-slice-d3.md). **This closes a review workflow, not the full capability-importer platform.** No new runtime, adapter, connector or executable package generation is delivered here. UI polish remains deferred.

## Review plans

Validated current or historical assessments now offer a local plan composer in both Incubator and Settings:

1. Explicit target: instruction skill, app, tool or XDesign extension. Repository documents have no automatically selected target.
2. Owner chooses reuse / wrap / adapt / rebuild and records up to 2,000 characters of constraints. Selection records planning intent, not rebuild or execution authorization.
3. Build a host-authored review checklist without another model call. Model next-step prose is retained as historical evidence, never promoted into executable actions or trusted planner steps.
4. Inspect source identity, goal, captured enabled-core-app profile, checklist and current handoff status. Select/copy the text manually for human review; source/owner strings are JSON-framed as untrusted data, not interpreted. Framing is not a general prompt-injection defense or authority for another agent.
5. Explicitly save locally; reopen through Saved integration plans; confirmed removal affects only the plan and its captured assessment copy.

`integrationPlan.ts` defines `intake-review-plan-v1`: exact schema, no extra authority fields, bounded values, eight records, 40 KiB maximum per record. Existing v1/v2/v3 assessment schemas retain their original versions. Plans contain a self-contained historical assessment copy: quoted source/declaration evidence and owner goals/constraints may be sensitive. They can outlive deletion of the standalone assessment; the removal copy now discloses this. Backups may retain deleted records. No full source/prompt bodies or provider credentials are newly saved.

`integrationPlansStore.ts` writes `app_state/intake.plans` in an ordered durable-before-visible queue. Inputs are snapshotted, conflicting IDs rejected, repeated identical saves idempotent, and quota never silently evicts. Failed/unknown-version hydration retains the previous view and blocks writes; ambiguous writes require reload before retry. Drafts survive errors within the mounted composer; unsaved drafts are not a crash journal. Saves already submitted are durable operations, not cancellable UI jobs. No new migration or parallel installed-capability registry.

### Handoff status is not installation readiness

- A direct skill reuse plan must match a currently loaded staged snapshot's ID, artifact hash and source hash. An exact active installed version is labeled already installed, not newly approved.
- Missing snapshots or changed enabled core apps block the handoff. Stale opinions from a different assessment-time app profile are explicitly disclosed.
- Repository documents, wrapping/adaptation/rebuild, apps, tools and XDesign extensions remain blocked pending a separately implemented and validated artifact/contract. Changing target does not convert documents into a package.
- Status uses trusted frontend store snapshots, **not a new native preflight, filesystem/runtime probe or publisher authentication check**. Native source/version/rights validation still runs independently at installation.
- Only navigation to existing Skill Library / Plugin Manager is offered. No plan calls their install APIs, enables apps, changes grants, launches processes or contacts a provider.
- Host facts remain the bounded enabled-core-app profile, not an installed-runtime/GPU/capability inventory. Checklist guidance is grounded in existing Skill Codex and the local directory Plugin SDK developer preview; it does not claim remote/tool/XDesign contracts are implemented.

## Skill update and rollback review

`skillDiff.ts` compares immutable manifests: additions/removals, SHA/size/mode/kind/source-path changes, stable metadata comparison, tool-request changes, pinned revision changes and attribution flags. Renames appear as remove/add; this is not a line-level semantic diff or security/license clearance. No file bodies or network data are fetched to compute it.

Update destinations now mirror native same-source rules (declared name + entrypoint + repository URL, or local source label); same-name unrelated repositories are not offered. Matching labels do not authenticate a publisher. Source/version changes invalidate acknowledgement, and vanished/incompatible targets reset rather than silently install elsewhere. Updates retain explicit source/rights acknowledgement.

Rollback opens a manifest comparison first. Cancel does nothing; Apply reviewed rollback uses the existing expected-active-version lifecycle path and foreground lease guards. Changed declarations never grant tools. Existing resource preview and native validation remain authoritative. No lifecycle schema or Rust change.

## Verification and limits

- TypeScript clean; **102 focused frontend tests / 13 files**. New coverage: plan targets/approaches, strict schema, unknown versions/authority, legacy assessment retention, exact snapshot matching, host changes, repository scope denial, durable ordering, ambiguous write recovery, idempotence/conflicts, quota, escaped UI, separate build/save, failed draft retry, removal confirmation/unmount; manifest/mode/metadata/source identity, update acknowledgement and rollback review/cancel/apply. Existing analysis, acquisition, Skill Codex and zero-tool routing regressions included.
- Logs: `/tmp/incubator-completion-{tsc,tests}.log`; dirty baseline: `/tmp/incubator-completion-before.json`.
- Original persistence reloading above is mocked store/UI evidence. [Later native synthetic acceptance](capability-importer-analysis-native-acceptance.md) passed one reviewed Terra assessment, explicit local skill/reuse plan save, real restart and shared Settings reopening with identical handoff text. Its later local follow-up confirms standalone assessment removal leaves the plan's exact historical copy across restart, source discard blocks handoff, and plan Cancel/confirmed removal/clean restart. No crash/fault/Settings-removal or other-target acceptance implied.
- No Rust changes or native rerun. D2's earlier 41 native tests remain historical evidence only.
- No new repository/provider request, dependency installation, third-party execution, production app/database access, release build, commit or release.

**Follow-up:** [Local SDK package intake](capability-importer-local-packages.md) now supports actual disabled installation of prepared directories/new identities; it does not convert repository documents or plans into packages.

## Still required to finish the platform (at review-plan completion)

1. Updated non-production native/live-provider acceptance for the existing acquisition → install → activate and document → analyze → plan paths, both entry points, failures/restart and exact permission denial. Existing D1/D2 native commands and C migrations require an updated binary.
2. Owner-selected static-app, read-only remote-tool and image-to-3D fixtures, plus an existing Ripper output, for actual family adapters and functional acceptance. Their absence is not evidence of compatibility.
3. Real managed-package/remote-connector integration and validation, using existing Plugin Manager lifecycle rather than treating plans as artifacts.
4. A separately approved local execution/isolation and dependency design before Node/Python/GPU installation, builds, process supervision or model downloads.
5. Bounded adaptation/build/preview/promotion against actual fixtures, then human UI/functional acceptance. No generic GitHub conversion or upstream parity claim.

The complete ranked program remains in [scope](capability-importer-scope.md). These are real open gates, not features completed by generating a checklist.
