# Workstation polish audit — 2026-09-11

## Scope and verdict

User requested comprehensive polish/setup and equal treatment of supported AIs. This is **targeted implementation plus automated verification, not whole-product sign-off**. All pre-existing uncommitted work was preserved; changes were not reset, stashed, or indiscriminately committed. Existing plugin/image/model work is not attributed to this audit.

Baseline: 152 frontend test files / 1,015 tests; Rust 168 pass / 1 ignored; TypeScript + Vite build green. The initial file inventory counted 625 frontend / 47 backend files, not a claim that every behavior was manually reviewed. Local evidence is under `/tmp/orion-polish-audit/`.

## Implemented slices

- [x] **Shared routing:** provider-qualified model identity, disabled/deleted/ambiguous-model errors, no silent Claude fallback, actual-connector cancellation, context-enriched HTTP history, cross-connector session reset in the live routing map, two-pass startup failure cleanup.
- [x] **Selection:** global Default AI plus per-surface inheritance; qualified shared picker and Agent Forge; failed agent saves retain the draft; unavailable selection stays visible; selectors disabled during runs. XDesign respects the selected model rather than upgrading to Claude.
- [x] **Learn / RepoLens text:** shared text calls, Tutor streaming/cancellation/errors, listener readiness, validated grading that does not penalize malformed model output. Web-link lookup remains explicitly Claude-only.
- [x] **img2model:** listeners now register *before* blocking native send; cancellation cannot start another autonomous round; nonzero exits surface; Claude/Codex selection with real Codex image attachment. Unique PNG snapshot paths prevent comparison renders overwriting references. Reference metadata persists with model documents; model autosave added.
- [x] **FX:** removed the API-only assistant loop; shared routing and model selector, Stop, cleanup, 10 MCP/UI-bridge tools, HTTP tool mapping, generated-schema parity test. One-shot shader generation uses the selected text model. Cursor SDK now receives Orion MCP configuration and maps tool families.
- [x] **XDesign persistence:** serialized project transitions, document saves, and registry writes; concurrent `ensureActive` coalesces; missing documents fail instead of silently becoming blank; transitions blocked during assistants/generation/import; editor inert during transition; project changes clear assistant transcripts. Autosave ignores purely transient canvas state and surfaces failures. Material cleanup includes all texture channels.
- [x] **Connector setup:** bounded probes; Claude OAuth status/login; safer provider form/poll lifecycle; core Codex connector uses real auth home plus `--ignore-user-config`; Gemini settings use `tools.exclude`, not ignored root `excludeTools`; no shared persona file race; removed blanket Claude bypass/Gemini yolo. Native permission behavior still needs live testing.
- [x] **File/process safety:** unique create-new atomic-save temps with permission preservation/cleanup; bounded regular-file imports; real ULIDs; Unicode-safe truncation; cancellation notifications retain an early signal. LSP executables installed and detected; Python probe uses `pyright --version`, not unsupported `pyright-langserver --version`.
- [x] **Setup/release tooling:** Node 22.13+ requirement (Cursor SDK's minimum), credential-safe doctor, combined verification, Node bridge/dependency contracts, verification CI, release tests and critical-production-advisory gate. Debug-only devtools command replaces the nonexistent legacy invoke; release devtools feature removed.
- [x] **Copy:** core prompts/placeholders describe the selected AI, not an assumed Claude identity. Removed fabricated note/file observations from empty-state greetings and obsolete Command “engine lands later” copy.

## Automated evidence

- `verify-complete.log`: TypeScript green; **157 frontend files / 1,044 tests passed**; **4 Node bridge/dependency tests passed**; Vite production build green.
- `native-final.log`: **172 Rust tests passed / 1 ignored** after removing the unused Codex TOML writer and its two obsolete tests. No native compiler warnings in the final package build.
- `package-clean.log`: **packaged `.app` build exit 0**, at `src-tauri/target/release/bundle/macos/Orion Terminal.app`. `codesign --verify --deep --strict` passed (ad-hoc signing, not notarization). No fresh DMG was built.
- Packaged binary smoke test, using only a scratch SQLite database: MCP initialization works; enabled catalog contains **66 tools, including all 10 FX tools**; disabling XDesign removes design/FX/model tools. A missing app_state table correctly exposes only the 3 shell tools (fail-closed). Both Cursor bridge resource files exist. **The GUI was not launched**; Cursor SDK dependencies remain external.
- `projectsStore.test.ts`: overlapping saves, coalesced creation, model reference round-trip, generation guard, missing-document protection.
- `modelAssist.lifecycle.test.ts`, `agentTurn.test.ts`: listener-before-send, failure propagation, cancellation, history and cleanup.
- `dispatchSend.polish.test.ts`: account-qualified routing, actual-route cancel, image support and session switching.
- `fxTools.contract.test.ts`: generated Rust MCP schemas match frontend tools; exact MCP grants map into HTTP runtime tools.
- Native tests cover unique validated snapshots, save concurrency/permissions, import limits, auth classification, and SDK Node minimum.
- JS DOM tests intentionally report existing canvas `getContext` limitations; those are not real WebGL/visual tests. Vite still reports large-chunk/mixed-import warnings.

## Dependency review

Total npm findings fell **45 → 7**. The final **production-only** audit also reports **7: 1 critical, 6 high**. These counts include affected ancestor packages, not seven independent exploits.

Reviewed, scoped compatibility overrides (not `audit fix --force`):

| Chain | Change | Evidence |
| --- | --- | --- |
| Monaco → DOMPurify | 3.4.15 | Existing major retained; app tests/build |
| BlockNote core → uuid | 11.1.1 | Installed BlockNote sources import only `v4`; callable API/UUID-shape contract plus app tests/build |
| Cursor → Connect Node → Undici | 6.28.1 | Installed adapter imports `Headers`; Headers/SDK-load contract; Node 22.13+; live SDK requests still unverified |
| rusqlite / SQLx SQLite | rusqlite 0.32; SQLx 0.8.6 | Shared `libsqlite3-sys` compatibility; native tests/build |

Remaining npm chains:

- **Transformers 2 → ONNX runtime/proto → protobufjs 6.11.6:** critical/high findings. Generated/static/minimal-runtime reachability needs a dedicated review; do not infer remote code execution in this app solely from a package-level report, or waive it solely because schemas appear static. A maintained embedding-runtime migration is not done.
- **Transformers 2 → sharp 0.32.6:** native image-library findings. Desktop embeddings use the browser path; Node tooling/distribution exposure still needs review. The glTF tooling's separate sharp 0.35.4 is updated.
- **PPTXGenJS → image-size 1.2.1:** parser DoS findings. npm's suggested “fix” downgrades PPTXGenJS to 1.1.5; rejected. Even the current image-size 2.0.2 is flagged. Review reachable parsing and upstream fixes instead of forcing an incompatible downgrade.

Cargo audit still reports **RUSTSEC-2023-0071 / rsa 0.9.10** in the lockfile. `cargo tree -i rsa --target aarch64-apple-darwin` returns no selected dependency path: it is not in this target's active graph. This is a scoped reachability observation, not a blanket ignore. Also present: proc-macro-error and UNIC maintenance advisories, plus glib 0.18.5 unsoundness for platform-specific review. Raw results: `cargo-audit-final.json` and npm `*-reviewed.json` / `*-production.json` in the evidence directory.

**Release CI intentionally blocks the remaining critical production npm advisory.** No advisory has been silently accepted or ignored.

## Outstanding gates — do not mark complete

### Routing and capability work

- [ ] Hermes remains Claude-native; Command uses pi's separate auth/model namespace; inline edit/Tab completion remain Anthropic API.
- [ ] RepoLens website reconstruction still has legacy model routing and copied Codex auth isolation; migrate it separately. Remaining non-shared pickers need qualified identities.
- [ ] Persisted/restored conversation sessions need durable connector ownership, not only the current in-memory route map.
- [ ] Exact per-tool restrictions are not uniformly enforced across connectors. Cursor grants MCP as a family; Codex/Gemini native permissions require review. Prompt instructions are not a sandbox.
- [ ] Cursor standalone packaging cannot rely on the development checkout. Its license says use is subject to Cursor terms; bundling/distribution or a supported installation flow needs review.

### Product and security verification

- [ ] Claude and Gemini user login; Cursor/API/local/Nous credential and live model/tool checks. Codex status reports ChatGPT login, but no new paid live request was made.
- [ ] Packaged app launch and all-app/theme/keyboard/window smoke tests. No existing app was restarted during this pass.
- [ ] Full notes/database/Brain/RepoLens/editor/Git/terminal/export/FX/model visual and persistence matrix; tests do not establish this.
- [ ] Credential-origin binding, untrusted HTML/assets/previews, IPC authority, permission profiles, and packaged CSP checks from `docs/security/2026-08-plugin-transition-audit.md`.
- [ ] Snapshot retention/cleanup; comprehensive filesystem symlink/TOCTOU threat review; persistence-failure recovery beyond serialized writes and visible errors.
- [ ] Remaining dependency migration/reachability review, DMG validation, signing/notarization policy (personal ad-hoc build remains intentional).

Detailed commands and the human checklist: [setup-and-verification.md](../setup-and-verification.md).
