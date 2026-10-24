# Incubator — shared app/Settings home and public repository intake

2026-09-16. Owner requested **Incubator** as the app/plugin home for everything brought into Orion Terminal, while retaining Settings access, and requested repository-link paste/drop instead of folder-only input. **Implemented; native UI/owner acceptance pending.** This extends [Slice A](capability-importer-slice-a.md), not installed-skill activation.

## Entry points and ownership

- First-party **`@orion/incubator`**, app ID `incubator`: registered through `builtinApps.ts`, with Dock/Spotlight/open command, normal in-canvas window and Plugin Manager enable/disable. No new shell renderer or parallel lifecycle registry.
- `src/apps/incubator/IncubatorApp.tsx`: dedicated intake workspace with a shortcut to Skill Library in Settings.
- **Control Panel → Skill Library / Skill Codex → Skill intake** remains directly available. Both mount the same `SkillIntakePanel` and read/write the same serialized `collectionStore` over the existing native staged-candidate tables. Staging/discard in one view updates the other; each view retains its own in-progress selection/preview.
- Incubator is the optional app presentation; Settings and the native intake broker remain host-owned. Disabling Incubator removes its app/window/command and unmounts its request owner, but does not delete staged data or disable the Settings route. Closing an intake view cancels its network jobs and releases its handles; a previously authorized atomic stage may finish and be reconciled from shared storage.
- Existing saved plugin preferences remain untouched. Fresh profiles still enable only the three core apps; Incubator can be enabled in Plugins. Existing profiles pick up the new built-in through normal plugin defaults.

## Repo-link workflow

Paste a public GitHub link and choose **Inspect repository** (or press Enter), or drop a single link onto the intake area. Merely editing/pasting the input does not make a request; an accepted link drop is the explicit inspection action. Local folder selection remains alongside it, including the existing native folder-drop orchestrator.

Supported URLs: `https://github.com/owner/repo`, optional `.git` / trailing slash, or `/tree/<full lowercase 40-character commit SHA>`. Branch/subdirectory links ask for the repository root. Private repos, GitLab/general websites, SSH/git URLs, credentials, query strings, fragments, alternate ports/hosts and encoded traversal are not supported. Browser URI-list/plain-text drops are handled without interpreting HTML; native WebKit/Safari drag delivery remains to be smoke-tested. Paste + Inspect is the explicit fallback, not a requirement to clone a folder.

1. Fetch bounded commit-list metadata (`per_page=1`, optional exact SHA), then a recursive tree **pinned to that commit's tree hash**. The list endpoint deliberately avoids the file patches included in GitHub's single-commit endpoint.
2. Show the resolved commit and enumerate skill entrypoints. A repo with no `SKILL.md` reports **unsupported app/tool adaptation**, not a fake installed capability.
3. Choose one skill and explicit root attribution; **Inspect selected skill** downloads only that subtree and attribution, from raw URLs containing the resolved commit—not a moving branch.
4. Reuse Slice A's validation, source/candidate manifest hashing, name adapter, escaped resource preview and transactional staging. No repo script, package manager, hook, submodule, dev server, external skill link or AI request is invoked.

Incubator is intended as the future home for other imported capabilities too. This increment supports **skill packages**, not automatic conversion of arbitrary apps, remote tools, stock terminals or image-to-3D engines. Those retain the existing capability-plan/runtime approval gates.

## Native acquisition boundary

`src-tauri/src/intake/github.rs` adds three native commands: `intake_github_discover`, `intake_github_inspect`, `intake_github_cancel`.

- New native reqwest client, fixed `api.github.com` / `raw.githubusercontent.com` HTTPS destinations, no redirects, no inherited proxy, authentication, browser cookies or provider credentials. Fail explicitly on inaccessible/private repositories, redirects, rate limits or malformed responses; never silently authenticate.
- Connect timeout 10s, request timeout 20s, total job deadline 90s. Actual streamed bytes are bounded regardless of Content-Length. Commit metadata ≤512 KiB, tree response ≤4 MiB / 4,096 entries. Truncated/duplicate trees fail closed.
- Existing selected-package bounds retained: ≤128 regular files / 8 MiB, ≤256 selected tree entries, depth 8; SKILL.md ≤128 KiB, other resources ≤1 MiB. Traversal, unsupported paths, case collisions, symlinks/submodules, malformed modes/identities and Git LFS pointers fail before a candidate can be staged. Executable source modes remain recorded but inactive.
- Public-source identity is based on GitHub's pinned HTTPS metadata/raw responses, expected lengths and host-computed file/manifest SHA-256. **This does not independently verify Git SHA-1 object hashes or commit signatures**, and is not publisher authentication or security clearance. The live fixture additionally checked its already-known resource SHA-256.
- Two active network jobs, four cached remote discoveries, existing four preview limit, 15-minute handle expiry. Cancellation IDs are reserved before work and retain bounded tombstones so cancel-before-start and ID reuse cannot launch late requests. Dropping a cancelled future stops its in-flight native HTTP work; late UI results are ignored/released, never staged.
- Secret-risk checks remain the deliberately limited Slice A rules; unsupported/obfuscated/binary risks, vulnerabilities, rights and behavior remain unknown. There is no AI analyzer or permission-grant expansion here.

The shared native assembler now takes either local bytes or downloaded bytes. A validated optional `repository` record (`url`, requested ref, commit, tree) is persisted inside the existing v1 candidate JSON. Older local snapshots without it still load. No migration was edited, no new migration was needed, and no installed capability registry was added.

## Verification and limits

- **74 focused frontend tests passed**, plus TypeScript: Intake contracts/UI, shared two-view staging/discard and distinct accessible IDs, paste/drop consent, cancellation/unmount, plugin lifecycle, and unchanged minimal first-launch defaults.
- **29 ordinary native Intake tests passed**; two explicit fixture tests remain ignored in that ordinary run. Added URL/destination restrictions, tree completeness, selected-subtree/attribution safety, stream byte limits, provenance/legacy parsing and cancellation races.
- Separately opted into the **live native public-GitHub test**: resolve pinned `Leonxlnx/taste-skill` revision `e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58`, enumerate 13 skills, download Stitch SKILL.md + DESIGN.md + LICENSE, check DESIGN.md SHA-256 `0ab6740c4ebb1966dbceddb823a66d4bf027e960efbd73faca56cbf8370ae2ad`, and stage/read back exact bytes in an in-memory test DB. No third-party code execution, install or production DB access.
- No full build/release/commit, new dependencies, broad suite, app/account replacement, AI provider request or packaged/native UI acceptance. The app descriptor, controls and native commands need an updated test binary; no running production app was replaced.

## Next acceptance / implementation gate

On an updated non-production binary/profile: open Incubator from Dock/Spotlight (enable it in Plugins if needed), paste the supplied taste repo, choose a skill + LICENSE, inspect/stage and open its resources. Open Settings simultaneously and confirm the same staged rows; discard in one and confirm both update. Test real URL drag/drop, Stop during download, app/plugin closure, restart/provenance preservation and native theme/focus behavior. Public HEAD resolution and GitHub failure states still need broader live acceptance beyond the pinned fixture.

**Follow-up delivered:** owner requested continued features, deferring UI polish. [Slice C](capability-importer-slice-c.md) now supplies explicit Skill Codex install/update/rollback/disable/remove and bounded Orion foreground text activation with Agent Forge or a plain model. This document remains the acquisition receipt; its earlier no-install scope is historical. Native UI/live-provider acceptance is still pending. Next planned code feature is D, not automatic activation or a generic local runtime.
