# Orion Intake — capability importer scope

Status: finalized planning baseline, 2026-09-16. Owner endorsed the direction and requested RepoLens/Website Ripper reuse plus a fresh-session handoff. Local staging, Incubator/public GitHub acquisition, bounded Skill Codex installation/Orion foreground text activation, D1/D2 reviewed analysis, D3 local declarations, review plans, skill version comparisons and disabled local SDK intake, reviewed manager updates and bounded package recovery/rollback and reviewed journaled removal are implemented; [latest receipt and pending acceptance](capability-importer-package-removal.md). Plans are not adapters/executable recipes; the full ranked platform below remains incomplete. Owner asked to continue features before UI polish. Further per-slice plans, runtime/dependency choices and privileged operations still require their normal approvals.

Start here next session: [implementation handoff](capability-importer-handoff.md). Supporting evidence: [RepoLens/upstream/Ripper audit](capability-importer-repolens-audit.md). Bounded Phase 0 continuation: [taste fixture checks and first-slice plan](capability-importer-phase0.md). Slices A/B, bounded C and D1–D3 are implemented. [Isolated native SDK lifecycle](capability-importer-native-lifecycle.md) now covers sample-derived install/enable/function/denial/update/rollback/restart/removal; broader skills/provider/permission/fault acceptance and full neutral repository analysis/upstream parity remain pending.

**V1 boundary (2026-10-02):** [bounded supported closeout](capability-importer-v1-closeout.md) defines the agreed skills/review/SDK/known2048 scope, now complete within its acceptance. [Native continuation](capability-importer-v1-native-acceptance.md) passed generated-app UI/game/lifecycle/appearance; separately approved [actual-source live plain-model/Forge tests](capability-importer-v1-live-acceptance.md) passed full public text through private ChatGPT/Terra with zero grants/calls/Action/fallback. Fixtures removed, proof closed, two-turn consent exhausted. Broader ranked platform/security/fault/provider work is not reopened or completed; no further upload/dependency/runtime/release authority is implied.

## Product contract

Drop a GitHub URL, skill directory, tool configuration, or supported local package into Orion. Inspect it without execution, explain what it provides and requires, propose an integration, build/test in staging where supported, and install only after approval. The result is a managed capability: a skill, AI tool, app, app extension, or a combination.

“Anything in, useful compatibility answer out” is achievable. “Every repository becomes a working native plugin automatically” is not a supportable guarantee. Report unsupported dependencies and partial compatibility rather than installing a placeholder. Installing upstream, adapting upstream, and rebuilding a capability are separate, explicit choices.

Owner-selected app/plugin name: **Incubator**, the home for everything brought into Orion Terminal. The shared Intake workflow also remains directly accessible in Settings; existing Skill Codex/Plugin Manager retain installed-capability lifecycle authority. **Orion Intake** is the prior working name/internal workflow label, distinct from Agent Forge.

## Existing foundation (source audit)

- `src/plugins/`, `src/store/communityPluginStore.ts`, and `src-tauri/src/plugin_runtime.rs`: inspected local directory installation, review-bound fingerprints, opaque-origin sandbox frames, apps/commands, owner-scoped cleanup, quarantine, safe mode, namespaced storage, and user-granted workspace handles.
- `src/plugins/manifest.ts`: nonempty public views/settings/status/file-handler/AI-tool contributions currently rejected. Native broker currently permits storage, notifications, and bounded workspace access, not general network/process/AI capabilities.
- `docs/plugin-sdk/getting-started.md`: current UI entrypoint is self-contained HTML; package ceiling 25 MiB. This is not a runtime for arbitrary React source trees, Python servers, or model weights.
- `src/store/skillsStore.ts`, `src/features/agents/agentTypes.ts`, `composeAgent.ts`: saved instruction skills and Agent Forge attachment exist. Imported resource directories, provenance, lazy resource loading, and lifecycle/versioning do not exist in the current Skill record.
- `resolveSend.ts`: plain model selection does not compose skills. `textCall.ts` has explicitly zero-tool surfaces. Universal skill invocation needs shared context composition without expanding those surfaces' authority.
- `src/store/mcpServersStore.ts`: manual stdio/HTTP MCP configuration exists. It is not a safe automatic repository installation boundary or a universal provider adapter.
- `src/apps/archives/repolens/` and `src-tauri/src/repolens.rs`: existing repo detection, adoption reports, capability tags, Deep Dive, synergies and Combinator should supply analysis, not be duplicated. Current model red flags are not a verified security scan; source snapshots and measured coverage must be added.
- `src-tauri/src/repolens_website.rs` plus RepoLens website/design stores: existing browser-assisted reconstruction and design Markdown can supply explicit rebuild/reference candidates. Their host-side npm setup and auto-start dev-server path must not be used as an automatic plugin installer.

Reuse these systems; do not build a competing plugin manager or agent stack. No implementation changes or validation runs were made for this scope.

## User journey

1. Paste a URL or drop a supported file/folder into Intake (also reachable from Plugins and Spotlight), or choose **Prepare integration** from a RepoLens report / **Prepare as Orion app** from a completed website reconstruction. These latter entry points arrive with their corresponding package/rebuild phases, not as nonfunctional first-release buttons.
2. Fetch into quarantine. Resolve and record source revision and hashes. Nothing executes.
3. Inspect structure, manifests, documentation, license, dependencies, platform support, and resource requirements. Enumerate multiple capabilities in monorepos instead of silently choosing one.
4. Present a plan: detected type, install/adapt/rebuild strategy, suggested destination, required permissions/services, download/disk/RAM requirements, AI budget, external data transmission, and unsupported parts. User can change placement.
5. Approve any source upload to the selected AI provider and approve build-time capabilities before a build. Dependency installation itself can execute code.
6. Build and test in staging using supported recipes, with bounded logs, timeouts, cancellation, and repair attempts. Never modify Orion's application source as the installation mechanism.
7. Review the exact candidate, capability grants, and test evidence; approve activation.
8. Register contributions and retain a receipt. Disable, update, rollback, and remove through the existing manager.

States: inspecting → needs decision → approved build → building → testing → ready for review → activating → active. Also blocked, failed, cancelled, disabled, and quarantined. Recover interrupted jobs without auto-resuming privileged execution.

## Compatibility strategies

| Strategy | When used | Important limit |
| --- | --- | --- |
| Direct import | Agent Skills, Orion packages, supported declarative content | Validate format and permissions; preserve referenced resources |
| Connect/wrap | Compatible remote API/MCP, approved local tool, browser app | Protocol support does not grant process or network isolation |
| Adapt | Reusable upstream engine/UI needs Orion host interfaces | Generate a separate adapter/package; show divergence from upstream |
| Rebuild | User explicitly wants a new implementation of the capability | Separate project with its own acceptance tests, budget and license review; no parity promise |
| Unsupported | Wrong architecture, unavailable CUDA/runtime/service, unclear rights, incompatible host features | Explain blockers; do not substitute a mock result |

Prefer reuse before recreation. A URL pointing to a hosted product is not necessarily installable source; authentication, CSP/frame restrictions, and terms can preclude embedding. Initial URL ingestion should target GitHub and direct supported content, not arbitrary authenticated websites.

## Example outcomes

### Taste skill

Import `SKILL.md` plus references/assets, preserving original content and attribution. Translate necessary provider-specific instructions only in a visible adapter overlay. Add to Skill Codex and allow permanent Agent Forge attachment or explicit per-turn skill selection with any supported model route.

Load metadata for discovery; inject only selected instructions and necessary resources. Treat bundled scripts as inactive executable dependencies until separately authorized and supported. A skill's `allowed-tools` metadata is a request, never a user grant. Missing tools produce a compatibility warning. Zero-tool/background surfaces stay zero-tool and do not auto-run imported skills.

### Image-to-3D repository

Inspect actual inference engine, supported hardware, model-weight license, weights size, RAM, Python/native dependencies, and possible remote services. CUDA-only is not Apple Silicon-compatible by implication. Prefer a proven local engine or an explicitly approved remote connector.

A later XDesign extension contract provides an image handle in, a cancellable progress-reporting job, and a validated model asset out. Generate/place/export are explicit actions. Keep weights outside the plugin package in quota-managed storage. Native GPU access is a separate risk boundary; do not weaken isolation silently to make a demo work.

### Stock terminal repository

A browser-compatible UI can become a standalone shell app with Dock/Spotlight entries. Network calls require brokered approved origins; credentials use keychain-backed references, not plugin-readable shared secrets. Data subscriptions and broker accounts remain external prerequisites. First supported finance slice is read-only prices, watchlists, and charts. Order placement, account writes, and autonomous trading are out of initial scope.

## RepoLens and Website Ripper integration

**RepoLens understands and evaluates; Website Ripper reconstructs; Intake plans, validates and manages installation.** Keep their existing independent workflows. Reuse shared services and typed source/artifact references, not direct access to private app stores.

- Extract a headless, provider-routed analysis boundary from RepoLens incrementally. Intake must work without enabling Archives; until an optional analyzer is available, report its absence rather than bypassing plugin lifecycle.
- Selectively refresh upstream structured mental models/risk registers and goal evaluation. Ground placement and stack-fit in actual host capabilities and installed/enabled plugins. Synergies/Combinator suggest multi-tool opportunities but do not install dependencies or establish compatibility.
- Distinguish AI assessment, measured facts, scanner findings and test evidence. Missing scanner coverage is unknown, not safe. Attach revision/hash, analyzer version, timestamp, coverage, uncertainty, and file/dependency references to evidence. Redact detected secrets; never treat an AI report as authorization.
- Use immutable source snapshots shared across inspection and planning. Cache by source hash and analysis context/version; legacy RepoLens reports without source identity cannot approve current installs.
- Website reconstruction outputs enter Intake as immutable generated candidates, carrying source URL, hashes, generator/scaffold provenance and rights/limitations. **Use design reference** transfers design data only. Do not call the existing editor-open handler during candidate review: it auto-starts a dev server.
- Preserve the distinction between observed website visuals and verified software behavior. A recreated frontend cannot promise a stock service's backend or an image model's inference capability.

Live upstream check: RepoLens HEAD/main at `94816c57d2b7dd6aa87b95e8c416f99fb32fc8d6` matches Orion's existing license-inspection baseline, **not feature parity**. The source-audited gaps and selective-port order are recorded in [the audit](capability-importer-repolens-audit.md). Do not vendor the full extension, duplicate provider authentication, or assume its optional Rust scanner is available.

## Architecture additions

### 1. Intake controller and source inspection

Optional user-facing feature with a narrowly scoped, kernel-owned acquisition/install broker. The importer itself must not become an all-powerful community plugin. Deterministic detectors first; selected AI for ambiguity, adapter generation, and explanation. Repository text, tool descriptions, and generated code are all untrusted.

Safe acquisition needs bounded redirects/downloads/decompression/file counts, traversal/symlink protection, SSRF controls, revision pinning, and explicit private-repository authentication. No hooks, submodules, package scripts, or downloaded executables run during inspection. Private GitHub sources can follow public-source support.

### 2. Shared capability record

Proposed identity/provenance record links existing plugin, skill, and tool stores rather than replacing them:

- Source URL/path, revision, content hash, upstream identity/version/license.
- Installed artifact hash, generated adapter version, build recipe/runtime versions.
- Capability kinds, app placements, dependencies, required provider/tool compatibility.
- Requested versus granted build/runtime permissions, data-sharing consent.
- Validation evidence, warnings, update channel, rollback target, lifecycle status.

Use append-only SQLite migrations. Publish artifact and metadata with crash-safe transaction/recovery semantics. Namespaced plugin data must not be erased by ordinary uninstall.

### 3. Skill package and shared context resolver

Support the Agent Skills directory format, provenance, linked resources, explicit activation, token budgets, Agent Forge attachment, and manual per-turn selection independent of selecting a saved agent. Maintain provider/surface capability checks. Start with text reasoning/chat surfaces; non-text or strict-schema generation surfaces need deliberate compatibility contracts, not blind Markdown injection.

### 4. Public extension contracts

Add versioned, owner-disposable AI-tool registrations and XDesign jobs/panels/assets contracts. Other app slots follow actual integrations rather than exposing private stores. Schema-validate inputs/outputs and recheck grants on every invocation. The host owns layout and cross-app placement.

### 5. Execution and build boundary

Remote connectors and browser-only packages first. Managed local Node/Python/service support requires a separately approved runtime design for both build and execution: filesystem/network/process restrictions, secret isolation, dependency caching, resource limits, process-tree termination, crash recovery, and denied-by-default external access.

A subprocess, private directory, Python virtualenv, or authenticated localhost endpoint is not an OS security sandbox. Existing unrestricted CLI/MCP launch paths must not be relabeled safe automatic installation. A VM/container approach or a constrained native runner needs a feasibility decision; no new dependency/runtime is approved by this scope.

### 6. Validation and lifecycle

Deterministic compatibility/security checks plus functional smoke tests. AI-generated tests are useful but not independent evidence of safety. Preview exact artifacts; fingerprint all executable inputs between review and activation. Build/test failures must not affect existing installs. Updates stage separately with source/artifact/permission diffs and retain the last known-good version. Data migrations require rollback compatibility or a restorable snapshot; code rollback alone is insufficient.

Global stop/disable, per-job budget, bounded repair loop (proposed two automatic repairs), startup quarantine, logs, provenance, and no silent privilege escalation. Revocation removes tools from future calls and cancels/rejects applicable outstanding work.

## Ranked delivery plan

### 0 — Compatibility and threat-model spike

Choose real owner-approved fixtures: one resource-backed skill, one static app, one remote tool, one Node/Python project, and one image-to-3D repo; assess one existing Ripper output without running it. Produce supported/blocked results, a provider/surface matrix, immutable snapshot/evidence contracts, static-security coverage/unknown rules, RepoLens headless-service seam, extension contracts, and a local-runtime feasibility decision. Estimate delivery after this spike. Selectively refresh relevant RepoLens analysis helpers in bounded slices, not a wholesale upstream parity project.

### 1 — Skill import: first useful release

Public GitHub/local `SKILL.md` import; preserve resources/license/provenance; immutable source revision; preview and save; Agent Forge attachment; explicit chat skill activation; disabled-by-default scripts; version/removal semantics.

Acceptance: import an actual taste skill, invoke it through both an agent and plain model selection, resolve its resources, reopen successfully, and verify it cannot self-grant tools. Failed persistence cannot leave a phantom installed skill.

### 2 — Managed package intake

Unify inspection/history/review; reuse existing directory-package installer; add carefully bounded source/archive handling where needed; support direct self-contained app packages. Crash-safe staging and last-known-good rollback must be proven before automatically generated packages are activated.

Acceptance: install/open/persist/disable/remove a real app; denied permissions remain denied; failed or malicious packages leave the previous app working.

### 3 — Useful connected tools and app extensions

Brokered network/credential references, host-routed AI tools, and initial XDesign asset/job slots. Start with remote services and read-only stock data. Verify supported provider routes rather than assuming every provider consumes arbitrary MCP servers identically.

Acceptance: a real read-only stock app retrieves approved data; an approved tool is callable only in the allowed scope; an XDesign connector returns a real validated asset; cancellation/revocation/disable work.

### 4 — Managed local execution

Only after an approved execution boundary: pinned Node/Python recipes, service supervision, installation/build containment, model storage, hardware preflight, progress/cancellation, and cleanup. No arbitrary native binary or unrestricted shell installation promise.

Acceptance: a selected compatible local image-to-3D engine produces a real reusable asset, survives restart, and fully stops on cancellation/disable without exposing unrelated files or credentials.

### 5 — AI adaptation and opt-in rebuild

Bounded planner → adapter builder → deterministic validator → preview → explicit promotion. Begin with known project families/recipes, not all GitHub. Rebuilds require their own fidelity and functional acceptance; retain separate identity from upstream.

Acceptance: adapt an unmodified supported upstream sample without editing Orion core; show source-to-adapter changes, real functional evidence, rollback, and an honest blocker on an unsupported sample.

## Scope boundaries and decisions

Not initial scope: marketplace, arbitrary native plugins, global package installs, automatic sudo/Homebrew changes, universal backend conversion, autonomous trading, silent background updates, or a claim of vulnerability-free third-party code. Public source is not automatically licensed for copying/redistribution; unclear licenses block adaptation/redistribution pending review. Code, weights, assets, and service terms may differ.

Recommended first milestone is the real taste-skill round trip, not the image-to-3D runtime. The full feature is a platform program across importer UX, shared AI context, public plugin APIs, secure execution, and lifecycle/recovery—not one drop-zone widget.

Planning defaults: skills first; public GitHub/local skill inputs first; explicit per-turn selection before optional auto-suggestion; remote connectors before arbitrary managed local engines; selective RepoLens reuse before new analysis machinery. Owner has endorsed the direction, not authorized global installs or a new VM/container/scanner dependency. Confirm exact public fixture URLs (especially which taste skill), approve each bounded implementation slice, and decide the local execution boundary separately. Existing stack, per-phase acceptance and dependency-approval rules remain in force.

## Reference material

- Existing platform contract: `docs/architecture/plugin-platform.md`.
- Existing local SDK: `docs/plugin-sdk/getting-started.md`.
- Agent Skills format and progressive disclosure: https://agentskills.io/specification
- MCP local-server installation security proposal (proposal, not an isolation implementation): https://modelcontextprotocol.io/seps/1024-mcp-client-security-requirements-for-local-server-
