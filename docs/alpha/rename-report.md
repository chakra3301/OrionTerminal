# Orion Studio completion — 2026-11-10

The owner authorized all six remaining rebrand items: boot/welcome wording, standalone Archives parent branding, native installation, source publication, a new download, and the approved Rosie v24 teaser on the live site.

## Completed source and validation

- Boot/welcome: the new title spells STUDIO, with centered six-letter sound spacing. Focused boot tests: 37 passed in nine files; TypeScript passed; fixed-time browser title inspected. Branding-only commit `7c11c44` is pushed on `alpha/boot-experience`. The pre-existing unaccepted boot feature remains uncommitted and separate from the Studio installer.
- Standalone Archives: current parent branding now says Studio; Archives 47 retains its own name, bundle ID and Alchemy storage. Bundle version advances to 0.1.1 for the new download. TypeScript and 270 frontend tests passed; final production frontend build passed after refreshing installed dependencies.
- Studio: complete frontend run, 6,067 passed / three skipped tests (614 passed / three skipped files). The later concurrent rerun suffered timing failures under memory pressure and was stopped; it is not recorded as passing. Final TypeScript and production bundle passed. All 263 bridge tests pass.
- Native: full suite against the updated SQLite dependency passed 1,556 tests, zero failed, 20 ignored. Final API-adapter checks passed all 14 backup tests and six Cursor tests. The healing performance check passes without changing its algorithm or threshold.
- Both production npm audits are clear; the selected Apple Silicon Cargo graph has no blocking known vulnerabilities or unsound advisories. Six maintenance notices and nine non-selected-platform findings remain visible in the audit output. No advisory suppression was added.
- Release dependencies were refreshed. Tauri 2 still requires SQLx 0.8, so the official sqlx-sqlite 0.8.6 crate is vendored with only its SQLite FFI requirement changed to 0.39.1. The driver and rusqlite use SQLite 3.54.1 together, with no schema migration. Source hash, provenance, notices and license checks are retained. Cursor SDK 1.1.0 preserves the bridge APIs and parses nonempty streamed event maps; existing users must update the optional SDK in Providers.
- All four website spec sheets now identify alpha 2 at 840×1520. The new teaser 02 derivative is 1600×900, 30 fps, 1,014 frames / 33.8 seconds, under 20 MB, with decoded audio identical to the approved v24 master. Its mint Rosie action and Studio title were inspected.
- A private SQLite backup of the existing Studio profile was created and passed integrity_check before native installation. User data, the original Rosie dock orb, domain and X handle are preserved.

## Publication status

Native bundles, installed-app checks, release URLs and live-site receipts are being completed. This section will be replaced with final receipts before handoff.

## Earlier rebrand handoff (historical)

The following records the state before the completion work above. Its pending-release and test-failure notes are superseded by the current results and final receipts.

# Orion Studio rebrand — 2026-11-10

Orion Studio is now the current product name in the application source, marketing sites, web demo and refreshed branded artwork. The three sites are live. The existing domain and X handle stay as requested.

## Live sites and assets

- Main: https://orionterminal.app/
- EMP: https://emp.orionterminal.app/
- Archives 47: https://archives.orionterminal.app/

All three production pages returned HTTP 200, contained the Studio name and retained the existing X links. Their versioned `assets/og-studio.png` share cards returned 200. Main-site desktop and phone views were checked in the browser; the 390×844 phone view had no horizontal overflow or broken images. Evidence: `/Users/lucaorion/Studio/orion-site/design/refs/orion-studio-live-verification.json`.

The main site's four published teasers (01, 02, 03, 05), poster, app screenshots and spec sheets were regenerated. Companion tall cards and the two selector cards that contained the full old name now use Studio; prompts and source mapping are retained in `design/refs/companions/cards-studio/generation.json`. Originals remain available. The logo geometry, original Rosie dock orb, and accepted icon/skill-orb renderers were preserved.

The web demo was rebuilt from this checkout. Its bridge now opens the current dock buttons by `data-dock-id`; the previous title lookup left Control Panel blank after the icon work. Capture now requires the panel/window to exist before accepting a screenshot. The four demo captures were refreshed and checked.

## Application changes

- Tauri product name and window title; browser title; About/settings/auth/splash/welcome/error/recovery/help/notification text; relevant assistant prompts and own license headers.
- Current README, beta guidance, SDK/product documentation, design metadata and landing pages; social art and its preparation scripts.
- Archives phone sync helper and editor branding; rebuilt its embedded editor HTML. Archives 47 remains its own app name.
- Future release workflow expects `Orion Studio.app` and produces `Orion-Studio_aarch64.dmg`. This is source configuration for the next release, not a release performed today.

Main branch: `validation/alpha-2026-09-14`, based on `45f1b14`. Application and media-studio edits remain uncommitted. Website local commits: main `019efb2`, EMP `07fac5c`, Archives `715097b`, following their session instructions. No source remote pushes were performed. Production sites were deployed as built static files.

## Deliberately retained

[rename-kept.json](rename-kept.json) inventories remaining tracked-source matches with a reason for every line. No matches remain classified as unresolved review items.

- `orionterminal.app` and its subdomains; `@Orion_terminal`; current GitHub repository and already published release URLs/filenames.
- Bundle identifier `com.lucaorion.orion-terminal`, binary/package names, environment/IPC identifiers, data directories, namespaces and stable network User-Agent. No database migration or user-data move.
- Historical logs, release evidence, original briefs/reference material, old exported media and repository folder names.
- The actual terminal feature in the Orion editor, and the component-name prohibition in AGENTS.md.

The already published alpha still downloads under its former name. BETA.md explains the transition. Updating its filename without shipping a replacement would break the download.

## Validation and limits

Passed: production frontend build; TypeScript; 260 bridge tests; 10 consumer-site tests, including the final social-path change; license check (444 native notices, eight source archives); 30 Archives Swift tests; mobile editor build; all three site builds; whitespace checks.

The full frontend suite initially reported six failing files (608 passed, three skipped). After refreshing the license manifest and focused reruns, five of those files passed together (378 tests passed, one intake timing failure); the final intake file then passed all five tests in isolation. That same file also passed against the pre-rebrand icon/orb checkout. All initially failing files have passing focused reruns, but a fresh all-green full suite is **not** claimed.

Native gate: `cargo test --locked --lib` reported 1,555 passed, one failed and 20 ignored. The unchanged healing performance check `diffusion_seven_on_a_large_brush_smooths_in_linear_time` exceeded its three-second budget: 10.44 seconds in the busy full run and 4.62 seconds in isolation. Its source was not edited, but a pre-change baseline failure was not established. This gate remains unresolved.

No macOS app bundle was packaged, installed or released. The displayed bundle name is configured, not verified in a freshly packaged app. The bundle identifier remains stable; signing is still the project's existing ad-hoc configuration. Packaging, permission behavior and native launch smoke checks belong to the next app release.

## Media handoff

Canonical studio: `/Users/lucaorion/Desktop/video gen/docs/orion-studio-rebrand.md`. It includes source hashes, final master paths, reproduction helpers and caveats. The seven new finished web/master outputs preserve their original decoded audio, frame count and frame rate. Originals under Movies were untouched.

The older teaser 02 package lacks its original 3D plates. Its finished web film was retained, with only a small wordmark correction derived from paired native renders, then newly encoded. The partial source renders are clearly marked as intermediates. Newer v21 renders normally. Teaser 06's regenerated cached passes live in the isolated worktree; the handoff explains how to avoid reusing old lettering from the canonical cache.

## Next release steps

Package and smoke-test Orion Studio, resolve the native performance gate, and then publish a renamed app download when the owner requests a release. Domain and X handle changes are deferred to the owner; no account or DNS changes were made.
