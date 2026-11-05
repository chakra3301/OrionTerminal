# Incubator — isolated ChatGPT preflight

Historical preflight-only receipt. [Subsequent bounded native ChatGPT acceptance](capability-importer-chatgpt-native-acceptance.md) verified routing and synthetic turns/early local Stop; the no-Send/unlaunched statements below describe the earlier preflight, not current status.

2026-09-29. **Owner-selected ChatGPT sign-in verified; private reviewed CLI installed. No provider inference or native UI routing acceptance yet.** This follows [local Forge/selection acceptance](capability-importer-forge-selection-acceptance.md); it does not replace live skill/analysis/cancellation/lease checks.

## Approved scope and login

The owner selected ChatGPT and approved only a synthetic skill/test prompt, no personal files or tool grants. Reopened owner-interactive `codex login` in Terminal with explicit `CODEX_HOME=~/.local/share/orion-proof/skills-20260928/empty-codex`, clearing Node and API/access-token overrides. Owner reported completion. Explicit-profile `codex login status` exited0 with `Logged in using ChatGPT`. No credential contents were read/copied; login status does not establish model entitlement or live transport. Durable metadata: `chatgpt-connection-scope.json`, `chatgpt-auth-preflight.json`.

The installed global Codex is now0.155.1, outside Orion's reviewed restricted-turn family0.154.x. The existing native version gate remains unchanged; no bypass or model request was used.

## Private CLI pin and routing repair

With separate owner approval installed `@openai/codex@0.154.0` under the durable proof root's `codex-0.154.0/` using npm `--ignore-scripts --no-audit --no-fund --save-exact`. npm added2 packages; no lifecycle scripts or repository dependencies were installed. Version probe reports `codex-cli 0.154.0`; its explicit-profile login-status probe also succeeds. Global Codex stays0.155.1, with its executable target/hash unchanged. No vulnerability scan or comprehensive package-security claim.

Found a real routing defect in `src-tauri/src/claude_cli.rs::augmented_path`: hardcoded Homebrew paths preceded the supplied launch PATH, contradicting the intended user-managed precedence. It now keeps nonempty launch entries first and appends existing fallback directories. Empty entries are excluded so augmentation does not introduce implicit current-directory executable lookup. The private `control.py` prepends only the pinned npm bin directory. No production special-case path, CLI gate relaxation, credentials copy or global installation change.

Three focused native tests passed: explicit launch precedence, stripped-path fallbacks/empty entries, and actual child lookup between private/shared synthetic executable candidates. Command: offline/locked release-profile `cargo test --lib claude_cli::augmented_path_tests:: -- --test-threads=1`, using the private target directory. Log: `codex-path-tests.log`. No broad suite/tsc/frontend rebuild rerun.

## Updated private proof bundle

One justified offline native rebuild uses unchanged private frontend output and the same separate identifier/profile `com.lucaorion.orion-terminal.skill-proof`. Ad-hoc signing and strict/deep signature verification passed; not notarized or a normal release. Log: `codex-pin-native.log`.

- Original accepted proof is retained as durable-root `before-path-fix.app`, executable SHA-256 `b0af66e21b06fe552454531759105640fbc66f824d7ff41951f41b5fd5578204`. Historical local lifecycle/Forge receipts still refer to this binary.
- Updated `target/release/bundle/macos/Orion Terminal Skill Proof.app` executable SHA-256: `372813aa37f3a7b56a6678279e49e3cd57abe7fad91f79d9927230ad16b9d88f`.
- New package-lock SHA-256: `e743fd4ba91ac217fb4402b2256b69fd869802e54333bebbef9d7690889607bb`.
- Before documentation all133 pre-existing dirty/untracked file hashes matched. Production/debug/release protected executables and global Codex target/hash remained unchanged. Metadata: `codex-pin-baseline.json`, `codex-pin-preservation-before-docs.json`.

The updated app has not been launched/used to verify visible connector routing. No synthetic skill is currently installed and no provider Send occurred. Resume with stable/exclusive desktop focus; verify new executable/identifier and actual selected connector/model before freshly inspecting/installing/reviewing synthetic content. Complete live context/freshness/zero-grant/budget/draft/cancel/lease checks separately; successful login/version/unit tests are not those acceptance results. See [handoff](capability-importer-handoff.md).
