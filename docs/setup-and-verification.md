# Setup and verification

## Development setup

macOS Apple Silicon is the verified build target. Install Node **22.13+**, stable Rust, Xcode command-line tools, and Tauri 2 prerequisites.

```sh
npm ci
npm run doctor
npm run verify
npm run tauri dev
```

Orion language servers:

```sh
npm i -g typescript-language-server typescript@5 pyright
rustup component add rust-analyzer
```

`doctor` checks executables and limited login status without making AI requests or printing credential contents. `node scripts/doctor.mjs --json` produces machine-readable output; `--strict` fails for missing mandatory build prerequisites, not optional providers.

## Distribution license materials

Normal builds check frozen license inventories and source/notice hashes offline. After dependency changes, review and run `npm run licenses:prepare` (Python3.11+, locked Cargo packages downloaded; bounded public notice/source downloads), then `npm run licenses:check`. Commit the reviewed generated materials with their lock changes before expecting CI to pass. Main and worker notices plus matching MPL source archives are bundled readably; see the [inventory and provenance limits](aaa-rebuild/2026-09-13-distribution-licenses.md).

## Connect your AI

Open **Control Panel → Providers**. Install the desired provider's CLI using its official instructions, then use the card's connection flow. Choose **Default AI**; individual model selectors can inherit it or override it. Provider-qualified selections distinguish duplicate model IDs and configured HTTP credential slots. CLI connectors still use their CLI-managed account; separate provider entries are not separate CLI accounts. Disabled/deleted/ambiguous selections fail visibly instead of falling back to Claude.

- **Claude:** Claude Code CLI + OAuth login (`claude auth login`), not an Anthropic API key.
- **ChatGPT/Codex:** Codex CLI + ChatGPT login. Shared chat uses the real Codex auth home with isolated per-run configuration, not a copied rotating credential file. Subscription image generation uses native Rust.
- **Gemini:** Gemini CLI + Google login. The CLI uses its native permission flow; unattended operations may need approval.
- **Cursor:** Use **Install SDK** to install the pinned optional SDK into the app's own runtime directory, then enter a Cursor SDK API key. Requires Node 22.13+ and model access. Standalone installation and offline import passed without checkout resolution. The proprietary SDK is user-installed, not redistributed in the app; its terms are separate from Apache-2.0. Currently one built-in Cursor account is supported. Setup/key presence is not live-model acceptance.
- **HTTP/local/Nous:** configure the provider endpoint/model and its required credentials. Tool calls require a tool-capable model and compatible endpoint. Native HTTP runtimes receive enriched app context and Orion tool schemas.

Restricted tool runs currently require reviewed Codex **0.154.x** or Gemini **0.47.x**. Unsupported versions fail before model launch. Earlier inspection (2026-09-11) found Codex ChatGPT login, no Claude OAuth login, and no Gemini OAuth file. The user's private Validation ChatGPT account subsequently passed bounded Terra chat/read/write/review, Stop/retry, and native subscription image-backend tests. Other models, providers, and specialist workflows remain unverified. See [the dated live evidence](aaa-rebuild/2026-09-12-subscription-live.md).

## Disconnect and account switching

Every provider has **Disconnect from Orion** / **Enable provider**. This persists the provider's enabled flag, removes it from shared model selection and automatic image-provider selection, and keeps chats/settings/credentials. Existing requests may finish; separate specialist CLI tools retain their own auth. It is not global account revocation.

Claude and ChatGPT cards separately offer **Sign out** once a session is detected. Confirmation shows the credential profile and warns that other tools sharing it are affected. Managed Claude/Codex/Gemini requests and Codex image requests cannot overlap a managed sign-out for that account. External CLI/browser flows and other app processes are not covered by that in-process lock. Gemini sign-out uses its official interactive `/auth signout` command; the panel explains this rather than deleting credential files itself.

Login commands explicitly preserve the app's credential-home variables and PATH when opening Terminal, and remove inherited API/billing overrides. Shared session ownership is invalidated for the connector on login/account sign-out; chats remain and future turns start fresh with prior text. The **Validation** identifier permanently scopes Codex to its own `codex-auth` directory under application data (0700), even when reopened without `CODEX_HOME`; normal-product auth paths are unchanged. Model access and subscription entitlements still require a live test.

## Background uploads

Control Panel → Providers → **Background AI · opt-in** controls automatic note tags, media tags and personalized companion check-ins. All start off. Enabling sends the disclosed data to that surface's selected AI, using its subscription or API billing; changing selection changes the recipient. Opt-out cancels pending work but cannot recall already-sent data. If saving opt-out fails, retry before restarting—off-in-memory is not durable consent removal. Image tagging currently requires a supported Claude/Codex vision route; unsupported selections fail without fallback. Manual analysis buttons use shared selection with zero grants, independently of background opt-ins. Analysis and FX's default workspace are newly created private directories, not reused folders or the app's launch directory. Live quota is explicitly unavailable rather than inferred by asking a model.

Shared dispatcher turns reject queued UI callbacks after completion/Stop, including after asynchronous XDesign preparation. Already executing FX/model operations may finish; project switching stays blocked until they settle. Legacy standalone MCP clients have request expiry but no shared-turn Stop ownership. See [the lifecycle evidence and limits](aaa-rebuild/2026-09-12-ui-callback-lifetimes.md).

## Capability matrix

| Surface | Implemented routing | Important limit |
| --- | --- | --- |
| Orion / Archives / XDesign / ROSIE shared rails | Shared provider/model dispatcher | Transport/model capabilities vary; no silent connector fallback |
| Learn generation + Tutor; RepoLens diagram analysis | Shared provider/model dispatcher | Verified web-link lookup remains explicitly Claude-only |
| FX Assist | Shared dispatcher; 10 tools via MCP or HTTP runtime | Bounded Terra read/parameter/name edits and restart passed; advanced shader/provider coverage remains open |
| FX shader generation | Shared selected text model | Generated GLSL still needs validation and visual review |
| img2model | Claude or Codex with reference image + MCP | Other connectors fail explicitly; no claimed vision parity |
| XDesign canvas reference image | Claude / Codex | Other connectors receive structured canvas context, not a fictitious screenshot |
| XDesign raster generation | Native ChatGPT subscription or configured OpenAI/Google image provider | ChatGPT image → Archives/opt-in tagging → canvas edit/restart → PNG/SVG export tested; not every account/model or exact size |
| Asset/note tags, note inline AI/archive answers, Git commit messages, personalized companion | Shared surface-selected analysis; zero tools; bounded timeout/cancellation | Background uploads require opt-in; images require supported Claude/Codex transport; legacy one-shot commands removed |
| Inline edits + Tab autocomplete | Anthropic Messages API + keychain key | Not yet provider-neutral |
| Hermes orchestration | Existing Claude-native backend | Not migrated to shared connectors |
| Command | Existing pi runtime and its own auth/model format | Shared provider-qualified IDs are not interchangeable with pi model IDs |
| RepoLens website reconstruction | Native provider-qualified Claude/Codex subscription routing | Real rotating auth home; live reconstruction remains unverified |

Agents with no grants are chat-only; plain model selections retain unrestricted defaults. Native Orion MCP checks grants at listing and execution, and restricted connectors receive explicit tool configuration. Restricted Codex/Cursor turns start fresh with prior text instead of resuming older permission state. Cancelled shared sessions also start fresh with visible text; a thread ID alone does not prove the CLI saved its last prompt. Unix shared CLI Stop terminates the owned process group; this is not complete detached-process or specialist cancellation coverage. Unsupported HTTP tools/external MCP and noncanonical Cursor account references fail explicitly. **These are not universal filesystem/process sandboxes.** Shell access can run programs and modify files. Use trusted projects and disposable data. See [the exact policy and remaining limits](security/2026-09-11-tool-grants.md).

## Repeatable gates

- `npm run verify`: TypeScript, frontend tests, Node bridge/dependency contracts, Vite production build, then Rust library tests. Vite must emit `dist/licenses` before Tauri compiles its resource manifest—even for native tests. On a fresh checkout, run `npm run build` before invoking `npm run test:native` or Cargo directly.
- `npm run audit:production`: production npm advisories.
- `npm run audit:native`: unfiltered Cargo lockfile advisories; requires `cargo-audit` installed separately.
- `npm run audit:native:target -- --target aarch64-apple-darwin`: classify the actual selected normal/build dependency tree; block selected vulnerable/unsound crates while retaining excluded and maintenance findings. Requires reviewed `cargo-audit` 0.22.2.
- `npm run test:native-policy -- --binary /absolute/path/to/orion-terminal`: adversarial packaged MCP checks against disposable fixtures, without a model or production profile.
- `npm run sync:preview-csp`: regenerate the exact preview-bootstrap hash after changing its bytes; never replace it with blanket inline-script permission.
- `npm run sync:fx-tools`: regenerate `resources/fx-tools.json` after changing FX schemas; the contract test detects drift.
- `npm run tauri build -- --bundles app`: local packaged application.
- `npm run tauri build`: app + DMG; does not imply visual sign-off.

CI runs locked verification, npm production auditing, target-aware native auditing and `python3 scripts/rehearse-profile-recovery.py --binary /absolute/path/to/orion-terminal --report /tmp/recovery-report.json`; release CI also checks the packaged MCP executable and recovery rehearsal. The Python harness generates its own disposable data—never pass a user profile—and tests shared migration SQL, not real historical Tauri/WebKit upgrades. Remote CI has not run: the local GitHub CLI is signed out and this accumulated worktree is not committed/pushed. See the [bounded alpha gates and recovery scope](aaa-rebuild/2026-09-13-alpha-release-gates.md). Latest root/optional-runtime npm audits report **zero vulnerabilities** after the browser-only PPTX replacement. The Apple Silicon target has no selected vulnerable/unsound crate findings, but five unmaintained UNIC packages remain through Tauri's URLPattern dependency. Raw lockfile Cargo audit still reports RSA and Linux-side GLib; they are not selected in the macOS target, not globally waived. Do not use force fixes or blanket ignores. See [the inference migration](aaa-rebuild/2026-09-11-inference-migration.md) and [closure audit](aaa-rebuild/2026-09-11-release-closure.md).

The [background/image continuation](aaa-rebuild/2026-09-12-background-ai-image-workflow.md) records bounded native image/consent/export/restart and overlay checks. It does not complete the broader matrix below.

## Desktop smoke test — still required

Use a scratch workspace and disposable projects; back up real notes first. Launch the newly built `.app`, not an already-running stale binary.

- [ ] Boot, Control Panel, all themes, window drag/resize/minimize, Spotlight, fullscreen switching, notifications, keyboard focus.
- [ ] For each authenticated connector: select it explicitly, stream text, test one read and one reviewed edit/tool, cancel mid-response, switch providers, send again. Confirm no old session or wrong billing identity is reused.
- [ ] Check unavailable-model, missing-key, offline, permission-denied, and deleted-provider errors.
- [ ] Orion: TypeScript/Python/Rust diagnostics; concurrent/permission-preserving saves; terminal resize and clean shutdown; inline edit and Tab completion on a configured key.
- [ ] Archives: create/edit/reopen notes and databases; Learn generation, invalid-answer handling, Tutor stop; RepoLens; Brain/search; PDF/media export.
- [ ] XDesign: design/FX/model round-trips across project tabs and restart; blocked switching during generation/import; shader tools; model reference remains unchanged after comparison captures; audio/video/image export.
- [ ] Hermes and Command: verify their separate credentials, lifecycle, cancel, and error behavior; do not assume global Default AI controls them.
- [ ] Packaged WebView/CSP, file imports, downloads, credential-origin binding, and hostile content checks from the existing security audit.

Passing automated tests does **not** close these boxes.
