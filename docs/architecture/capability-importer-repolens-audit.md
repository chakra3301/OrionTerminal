# Intake: RepoLens / Website Ripper integration audit

Checked: 2026-09-16, approximately 18:20 UTC. Source inspection only; no upstream code executed, packages installed, inference requested, or app launched.

**Implementation follow-up:** [Incubator D1](capability-importer-slice-d.md) extracts the existing framing helper and adds bounded goal/risk/stack-fit advisory analysis for staged skills. Archives' analysis workflow is otherwise unchanged. No new upstream HEAD check, scanner integration or parity claim is implied.

## Is Orion's RepoLens up to date?

**Not at feature parity. Its inspected license baseline is current with upstream HEAD, which is a different claim.**

Live command:

```sh
git ls-remote https://github.com/New1Direction/RepoLens.git HEAD refs/heads/main refs/heads/master
```

Both HEAD and main returned `94816c57d2b7dd6aa87b95e8c416f99fb32fc8d6`. A shallow checkout confirmed commit time `2026-09-04T13:47:45-07:00`, message `fix: limit OpenRouter picker to free models`.

`resources/adapted-license-upstreams.json` already records this exact inspected revision for RepoLens, explicitly with `originalPortRevisionKnown: false`. `THIRD_PARTY_NOTICES.md` also distinguishes notice inspection from original port provenance. The upstream `LICENSE` and local `THIRD_PARTY_LICENSES/RepoLens-MIT.txt` have identical SHA-256:

`41797d46a3e8c02be8920a26d53e81b04f762f3ed4fe323cfd5425b384180a58`

Therefore no license-baseline bump is needed from this check. Do not claim Orion was updated to upstream HEAD: this session changed documentation only. Orion contains modified TS/Rust ports, not an installed RepoLens dependency that can be updated with a version bump. The upstream changelog has old-dated Unreleased headings; use Git SHA/commit time rather than those headings to identify the inspected state.

## Relevant parity and reuse matrix

All upstream paths below refer to the pinned SHA above at https://github.com/New1Direction/RepoLens . This is a targeted feature comparison, not an exhaustive semantic diff or security certification.

| Capability | Orion today | Relevant upstream source | Intake decision |
| --- | --- | --- | --- |
| GitHub/GitLab/npm/PyPI detection and metadata | `detect.ts`, `fetch.ts`, Rust `repolens.rs` | `src/url-detector.js`, `src/fetcher.js` | Reuse detection/normalization where valid; strengthen native acquisition separately |
| Adoption briefing, capabilities, health/red flags | `prompt.ts`, `parser.ts`, `types.ts` | `src/prompt.js`, `src/parser.js` | Existing useful base; selectively refresh structured judgments |
| Structured mental model, risk register, adoption simulation, learning path | Not present in current Orion report schema | `src/prompt.js`, `src/parser.js` | Add versioned optional fields and legacy-report fallbacks when refreshing reports |
| Deep Dive atoms/lineage/assumptions | `lenses.ts`, `useRepoLens.ts` | `src/deepdive.js`, `mcp/deep-dive.js` | Reuse for locating reusable subsystems; preserve uncertainty |
| Concrete goal/constraints evaluation | No equivalent dedicated contract found | `mcp/evaluate-for-goal.js` | Highest-value new planner input: integration costs, blockers, trial plan |
| Fits MY Stack | No equivalent dedicated contract found | `src/fits-stack.js` | Adapt to actual installed/enabled Orion capabilities, not just saved repos |
| Synergies and multi-repo ideas | `connections.ts`, `combinator.ts`, `lenses.ts` | `src/synergies.js`, `src/combinator*.js` | Reuse suggestions; do not auto-install suggested dependencies |
| Multi-repo architecture/adoption ordering | Orion Combinator produces an idea, not a managed install graph | `src/stack-prompt.js` | Later composition-plan advisory; deterministic resolver remains authoritative |
| License compatibility | License label displayed; no dedicated compatibility module found | `src/license-compat.js` | At most preliminary flags; bucket logic is too coarse for legal approval |
| Analysis snapshot differences | No equivalent dedicated implementation found in Orion RepoLens | `src/diff-analysis.js` | Later update explanation only; not a source/artifact/security diff |
| Product-page evidence analysis | Orion Ripper reconstructs pages/extracts design | `mcp/analyze-product.js` | Useful separate read-only analysis; preserve website-only vs verified-code evidence |
| Standalone RepoLens MCP | Not wired as Orion's analysis engine | `mcp/server.js`, `mcp/README.md` | Prefer porting pure logic into Orion's provider-routed service; no second provider/auth stack |

Upstream MCP offers `scan_repo`, `deep_dive`, `blueprint_scene`, `compare_repos`, `evaluate_for_goal`, and `analyze_product`. Its goal evaluation itself uses model calls over a base scan; its recommendation is not independent proof. Port useful prompts/schemas/tests without copying upstream key handling, browser storage, provider defaults, report auto-opening, or permissive parser behavior.

## Important security/evidence limits

### Existing Orion scans

- `repolens.rs::fetch_github` obtains README/metadata/languages and returns an empty GitHub dependency list. Registry dependencies for npm/PyPI are a different path, not a lockfile vulnerability scan.
- `repolens_fetch_source` currently takes a branch-based tree (up to 200 paths) and selected source excerpts (2,500 characters per file). Contents requests are not pinned to a resolved commit. `RepoData`/`RepoSource` do not carry immutable source revision/hash provenance.
- `useRepoLens.ts` invokes `buildAtomsPrompt(..., source, null)`. `lenses.ts::factsBlock` explicitly notes runner facts are always null here.
- Health, red flags, adoption recommendations, and some numerical health components are model-generated judgments, not measured vulnerability/maintenance evidence. Existing metadata does not supply all the measurements requested by the health prompt.
- The core prompt applies README sanitization/delimiting. Not every lens has that same framing; regex redaction is not a security boundary in any event. A planner consuming these outputs must remain tool-less and cannot authorize execution.

### Upstream measured-facts runner

Upstream README describes an optional Rust daemon on localhost:9191 for static facts including a secret scan. `src/runner.js` is a best-effort client that resolves unavailable/failed scans to `null`. The inspected Git tree contains no `runner/` directory, Cargo manifest, or Rust source, so its implementation/security properties were **not verified**. Do not assume a scanner binary is available or that the feature is integrated into Orion. Any retrieval of a separate runner requires its own source/license/security review and approval.

### Intake evidence policy

Separate **AI assessment**, **measured source facts**, **scanner findings**, and **functional test results**. Each record identifies source revision/hash, analyzer/version, timestamp, coverage and limitations. Missing, stale, unsupported, truncated, or errored scans are `unknown`/`not run`, never clean. Findings should reference files/dependency versions; secrets must be redacted before storage/display/provider transmission. Choose bounded static rules and advisory-source integration in Phase 0; new scanner dependencies require approval. No AI green badge can override deterministic package/grant checks or a known policy blocker.

Upstream `license-compat.js` uses broad SPDX buckets and sometimes overgeneralized messages; do not copy its green results into an authorization gate. Actual code/weight/asset licenses, SPDX expressions, exceptions, modification/distribution context, and obligations require independent handling. Likewise `diff-analysis.js` compares report fields, not executable changes.

## Website Ripper: what can be linked

This is an Orion-specific subsystem using a **different upstream**: `JCodesMore/ai-website-cloner-template`, pinned by `resources/website-cloner-scaffold/VENDOR.md` to `8dd9cb47dde0d49fec06ee1d69bedd04840f3c95`. Checking RepoLens HEAD does not check scaffold currency; no scaffold-update claim is made here.

Reusable pieces:

- `src-tauri/src/repolens_website.rs`: Claude/Codex job dispatch, browser-assisted recon, project generation, phase/log events, screenshots, cancellation/continuation, restart reconciliation, design extraction.
- `useRepoLensWebsites.ts` and `repolensWebsitesDb.ts`: durable project/job records and existing editor navigation.
- `designSpec.ts` / `RepoLensDesignMDs.tsx`: structured colors/type/spacing/components/motion and Markdown export.
- Existing source project and screenshot references can seed Intake's explicit rebuild preview. Exported design Markdown can be passed by user action to the existing validated custom-theme flow or a later XDesign design-system importer; it must not execute as CSS.

**Not reusable as an automatic safe installer:**

- Native `setup_and_run` invokes `run_setup_commands`, including `npm install`, git commands, and a Playwright browser install in a host process before the agent runs.
- `openInOrion` automatically starts `npm run dev` in a terminal and points the live preview at it. Opening a candidate in Intake must not implicitly call this path.
- A clone project is not a self-contained community package. Server rendering, backend routes, browser automation and external services need explicit runtime support or a supported static adaptation.
- A screenshot and frontend reconstruction do not reproduce a site's backend, data rights, login service, or product functionality. Copying a site's code/assets requires suitable rights; do not bypass access controls or reuse browser sessions implicitly.

Add an explicit **Prepare as Orion app** action that snapshots the generated candidate without executing it. It enters the normal Intake compatibility/permissions/build/test pipeline. A separate **Use design reference** action transfers design data only. Existing Ripper behavior is preserved; these actions must not silently start a new rip, inference job, install or dev server.

## Recommended architecture seam

```text
RepoLens Analyze / Evaluate ──┐
                             ├─ immutable evidence/candidate refs ─> Intake plan/review
Ripper Project / Design MD ───┘                                      │
                                                                     v
                                              host-controlled build/validate/activate
                                                                     │
                                                                     v
                                                existing Plugin Manager / Skill Codex
```

A shared headless analysis service should consume immutable source snapshots and use Orion's existing selected-provider text routing. Archives remains a client, not the service's lifecycle owner. Extract this incrementally; do not import `useRepoLens` directly into Intake or secretly enable Archives to analyze a package. If a not-yet-extracted optional analyzer is disabled/unavailable, show that state explicitly. Repository analysis remains zero-tool.

Cache reusable analyses by source hash + schema/analyzer version + relevant goal/constraints/policy version, not just repo name. Legacy saved reports are useful context but unverified for the candidate revision. Website candidates have their own file hashes, source URL, generator/model/scaffold provenance, permissions and evidence type; a project filesystem path is not a capability grant.

## Follow-up order

1. Define snapshot/evidence and analysis-service boundaries; choose static-scan coverage and actual fixtures.
2. Selectively adapt structured risk/mental-model and `evaluate_for_goal` helpers with strict validation, provenance, unknown states and backward-compatible saved-report handling. Add Fits-Stack against registered host capabilities when needed. Keep historical RepoLens UI/report behavior working.
3. Ship the skill-first Intake slice; no need to port upstream's entire UI/canvas/learning ecosystem first.
4. Add RepoLens **Prepare integration** and Ripper **Prepare as Orion app / Use design reference** handoffs when the corresponding candidate flow exists. Gate every unsupported output honestly.
5. Later: stack composition, update re-analysis, and Ripper-backed rebuilds under the approved execution boundary.

Documentation is finalized for handoff; feature parity updates and integrations above are **planned, not implemented**.
