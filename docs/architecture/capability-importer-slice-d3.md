# Incubator D3 — local dependency/runtime declarations

2026-09-16. Bounded continuation of [D2 repository documents](capability-importer-slice-d2.md), not execution, dependency resolution or compatibility verification. Features before UI polish.

## Delivered

- `features/repoAnalysis/declarations.ts` extracts **declared strings** locally from complete, already hash-checked selected documents. No AI, subprocess, package manager, network resolver, include-file reads or new dependencies.
- Canonical `package.json`: packageManager, engines, os/cpu/libc, scripts and dependencies/optionalDependencies/peerDependencies/devDependencies. Exact strings remain inert; no semver/platform evaluation or claim that a named package/runtime exists. Invalid shapes yield partial coverage, not a clean result. Invalid/duplicate-key JSON (including escaped duplicate names) and excessive nesting yield no declarations.
- Canonical `requirements.txt`: simple name/optional single-version-comparison lines are recorded. Complex requirements, markers, extras, includes, index flags and URLs remain explicitly unparsed text; nothing is evaluated or followed. Comments/blank lines are skipped. Other formats, including TOML/Compose/Dockerfile and noncanonical filename casing, remain unsupported for deterministic extraction.
- Coverage states are observed/partial/invalid/unsupported with issue codes and omitted counts. These describe the extractor, not software safety or usability. Maximum 12 declarations and 2,500 encoded declaration bytes per file; overlong/overflow values are omitted with visible limits, never silently truncated. Four source records/16 KiB total serialized evidence limit. Unknown fields, invalid hashes, forged authority and inconsistent scope/version/source references are rejected.
- Local previews show declarations separately from AI opinions and explicitly exclude implicit hooks, workspace behavior, transitive dependencies, resolved versions, installed runtimes and compatibility/security claims. Commands/HTML remain escaped text without run actions.
- **Upload boundary:** declarations can contain values outside the 8,000-character excerpt because extraction examines complete selected manifests. The exact upload preview and copy disclose this; deselecting a file removes both its excerpt and derived declarations. Source path/SHA ties evidence to selected coverage. No inference on acquisition/extraction.
- Analyzer v3 fingerprints the parser-tagged declaration evidence and copies host-produced evidence—not model-authored substitutes—into explicitly saved assessments. Saved v1/v2 reports remain readable without relabeling/hydration writes; old versions cannot acquire declaration fields. Existing input/output/history bounds, zero grants, native reviewed HTTP routing, explicit save and repository installation strategy `unsupported` remain unchanged. Nothing changes Skill Codex/Plugin Manager authority.

## Verification

- TypeScript clean; **73 focused frontend tests in 8 files**. Covers fields/limits/Unicode, duplicate keys/nesting/prototype-shaped data, inert scripts/URLs, unsupported formats, source hash mismatch, declaration extraction beyond excerpts, deselection privacy, fingerprints, mixed historical versions, escaped UI and existing intake/consent/history behavior.
- Log `/tmp/incubator-d3-frontend.log`; dirty baseline `/tmp/incubator-d3-before.json`.
- No Rust changes or native test/build rerun. D2's earlier 41 native Intake tests remain separate evidence, not new D3 native acceptance.

No new GitHub/provider request, dependency, third-party code execution, production access, release build, commit or release. Packaged/native UI and live-model acceptance remain pending; no installed runtime or source compatibility has been verified.

**Follow-up:** [Review plans and skill version comparison](capability-importer-review-plans.md) now implement local saved checklists and update/rollback manifest review, not executable recipes or generated adapters.

## Next boundary (at D3 completion)

Reviewable integration plans and richer host capability evidence, grounded in these bounded declarations and owner-selected fixtures. No automatic adaptation, executable build plan, runtime installation, scanner/parity promise or inferred GPU support. Other manifest grammars/resolution need separate bounded implementation; general runtime isolation remains a later approval gate. Updated non-production smoke still needs the D1/D2 native commands. UI polish remains deferred.
