# Release closure follow-up — 2026-09-11

Continuation of [the polish audit](2026-09-11-polish-audit.md). **Local verification is green; open-source release readiness is not yet green.** Existing work remains uncommitted and was preserved. Evidence and disposable automation are under `/tmp/orion-release-closure/` (private directory), not distributed with the app.

Latest continuation: [bounded alpha gates, fixture profile rehearsal and in-dialog recovery feedback](2026-09-13-alpha-release-gates.md), following [note/file crash recovery](2026-09-12-draft-recovery.md), following [verified backups and restore-copy](2026-09-12-backup-recovery.md), following [native quit safety](2026-09-12-quit-safety.md), following [Archives note save recovery](2026-09-12-archives-save-recovery.md), following [save safety and Validation DMG rehearsal](2026-09-12-save-safety-release-rehearsal.md), following [message boundaries and project transactions](2026-09-12-format-project-recovery.md), following [UI callback lifetimes and native transport bounds](2026-09-12-ui-callback-lifetimes.md), following [background AI and full image workflow](2026-09-12-background-ai-image-workflow.md), following [per-run tool grants and limits](../security/2026-09-11-tool-grants.md). Apache-2.0 covers original work and confirmed creator-owned GLBs. Latest root/optional-runtime npm audits report **zero vulnerabilities**. The selected Apple Silicon native graph has no vulnerable/unsound findings but retains five UNIC maintenance warnings. Whole-lockfile Cargo audit and broader release/security review are not cleared. New evidence is under `/tmp/orion-release-next/`.

## Provider controls / authenticated continuation

Disconnect/Enable is now explicit and persistent for every provider, preserving credentials and existing chat data. Claude/Codex sign-out is a separate confirmed operation; Gemini uses official manual sign-out instructions. Profile-preserving Terminal login, account-use locks, shared-session invalidation, stale-save protection, and image-cache invalidation are covered by regressions. Validation has a persistent private Codex profile independent of the user's global CLI account; no credentials were copied. Packaged UI/SQLite evidence verified Gemini disconnect, and the displayed Codex profile matched the private 0700 app-data directory. The user has since completed the private ChatGPT login. Bounded Terra chat/read/write/cancel and native image-backend tests passed; logout/relogin and other model entitlements remain open. See [connection semantics](../setup-and-verification.md#disconnect-and-account-switching). Evidence: `disconnect-ui-result.json`, `disconnect-mcp-smoke.json`, `disconnect-build.log`.

Login correction: the first user attempt exposed an exec-only flag wrongly used on Codex login/logout. Removed it from auth commands, retained it on exec, and added real CLI parser preflight before Terminal opens. Corrected packaged flow opened Chrome and the user subsequently authorized it. See [live findings, fixes, and limits](2026-09-12-subscription-live.md), including code-mode transport, process cancellation, and early-cancel history recovery. Evidence: `login-fix-cli-parser.json`, `login-fix-build.log`, `login-fix-started.png`.

## Closed implementation slices

- **Background/image workflow:** removed legacy Claude one-shot IPC. Selected-surface analysis uses zero grants and bounded lifecycle; automatic note/media/companion uploads require persisted opt-in. Native ChatGPT image generation, scoped Terra vision tagging with zero tool calls, editable image-layer restart persistence, self-contained PNG/SVG exports and private atomic saves passed. Settings/assistant/confirmation layering and Spotlight's empty-height defect were corrected. A bounded Terra FX tool round-trip changed exactly two fields and survived restart; a subsequent read-only turn verified its new unique Unix 0700 working directory through real native IPC. Details and limits are in the continuation above.

- **RepoLens website routing:** native resolution of provider-qualified model IDs from enabled database providers; ambiguous legacy IDs fail. Subscription-only website capability is explicit. Removed per-run credential copies/cloned auth homes; uses the selected real account profile with isolated configuration. Pinned Playwright MCP 0.0.80, private config writes, bounded preflight, subscription-auth check, packaged scaffold lookup, validated managed paths, bounded artifact reads, and visible continue/delete errors. Live website reconstruction remains unverified.
- **Restored shared conversations:** persisted, bounded ownership records (`ai.sessionOwners`) include provider ID, kind, endpoint, and key reference. Only matching ownership permits session reuse; unknown/changed ownership starts fresh with text history. Pending-start cancellation prevents a cancelled ownership lookup from launching a process. This covers the shared dispatcher, not every specialist subsystem or external CLI account changes.
- **Packaged asset loading:** production CSP allowed IPC/model-host requests but omitted same-origin fetch. ROSIE stayed a fallback polyhedron even though its bundled GLB existed. Added narrowly scoped `'self'`, `blob:`, and Tauri asset origins to `connect-src`, retaining the remote allowlist. A rebuilt, signed validation bundle now visibly loads and animates ROSIE. A Node contract guards these sources without permitting blanket HTTP/HTTPS access.
- **Character failures:** failed model loads surface a warning; selecting another character resets the boundary. Regression covers fallback and recovery.
- **Truthful shell:** removed fabricated `CLAUDE • ONLINE`, Wi-Fi, and `84%` battery status. The new **AI · SETTINGS** button opens provider setup, whose statuses explicitly distinguish login/key readiness from live-model access. Welcome, Archives empty-state, and ROSIE copy no longer assert an unverified connection or universal tool authority.
- **Keyboard/accessibility:** `react-hotkeys-hook` interpreted the comma in `mod+,` as a binding-list separator. Registry chords now use an untypeable list separator; regression checks comma and ordinary shortcuts. Companion gets a focusable Hide button and a Spotlight hide command, in addition to its existing drag/fling gesture.
- **License evidence:** retained img2threejs Apache-2.0 license and adaptation notice; identified the scaffold's existing MIT notice; bundled checked notices/license texts. This is not a complete distribution clearance.

## Latest completed automated gate

`npm run verify` → exit **0** (`verify-backup-safety-complete.log`):

| Gate | Result |
|---|---|
| TypeScript | passed |
| Frontend | **191 files / 1,218 tests passed** |
| Node bridge/dependency/packaging contracts | **22 passed** |
| Native | **234 passed / 1 ignored** |
| Vite production build | passed |

Warnings about large/mixed chunks and jsdom canvas support are not performance or visual acceptance evidence. The provider test remains ignored in this ordinary suite; it was invoked separately for the user-authorized subscription image test.

## Actual desktop verification

A separate bundle was built using a **temporary**, non-repository Tauri config:

- Product: `Orion Terminal Validation`
- Identifier: `com.lucaorion.orion-terminal.validation`
- Data: its own `~/Library/Application Support/com.lucaorion.orion-terminal.validation/orion.db`

A disposable account was created through the normal UI and its database identity checked. The production app was left at its lock screen; no production password, auth row, or existing account was reset. Test credentials remain only in a private temporary file. The validation app was closed normally before replacing its bundle.

**Observed passes:** first-run signup; warm restart; keyboard tour progression; Archives/Orion/XDesign launch via ⌘1/2/3; provider panel via the new AI Settings button; provider readiness labels matching installed/login state; all five Appearance selections (including Liquid rendering); monitor collapse; GLB companion load/animation after the CSP fix. These are specific smoke checks, not all-feature acceptance.

**Latest rebuilt desktop passes:** ⌘, opens Control Panel; the new companion Hide button removes the avatar without opening chat. Quick Capture created and opened a two-line disposable note; its exact title/body were verified in the validation database and the Notes list after a normal restart. An FX project rendered its default animated gradient, survived restart, and reopened with the gradient intact. These do not establish failure recovery, all shader correctness, model reconstruction, live in-app AI/tool flows, or comprehensive accessibility/performance acceptance.

The latest validation package passed ad-hoc `codesign --verify --deep --strict`; packaged img2threejs license and root notices were confirmed present. This is neither notarization nor a production-identifier/DMG acceptance result. The normal product's previously built `.app` has not been silently replaced.

## Latest packaged closure checks

- **Archives recovery (newest build):** native title/body save failures retained drafts through editor remount; Retry save committed both; normal restart/reopen and inspected fixture deletion passed. Per-note ordering, stale refresh protection, malformed-body guards and plugin-disable blocking have deterministic regressions. Prior notes/XDesign state and production binaries unchanged. Fresh Validation app/DMG, signature/MCP, read-only DMG mount/hash/detach passed. [Build-specific evidence and limits](2026-09-12-archives-save-recovery.md); earlier workflows below retain their own build attribution.
- **Exact tool denial:** HTTP malicious-response fixture could not create an ungranted note. Latest packaged MCP smoke (`backup-safety-mcp-final.json`) separately proves list/call denial for empty, malformed and narrow grants; explicit writes and whole-server grants succeed; disabling the owning plugin still blocks access. Neither is universal CLI/filesystem confinement.
- **Connector policy:** grants now cross Codex/Gemini IPC; Cursor MCP families have a native exact-grant snapshot; Claude has explicit restricted built-ins. Restricted Codex/Cursor sessions start fresh. Subscription sends reject unavailable Claude/Codex subscription auth, strip inherited alternative billing overrides, and enforce Gemini Google OAuth settings. Cancellation remains registered through async preflight and cleanup. Terra shared chat/read/write/review and Stop/retry now have bounded live acceptance; other connectors and specialist paths remain open.
- **Independent Cursor setup:** packaged Install SDK succeeded; the pinned managed runtime imported offline from outside the checkout. No SDK key or live request was used. Proprietary terms remain separate.
- **Executed HTML isolation:** hostile preview scripts actually ran, while parent/storage/native access and self-navigation probes were denied. Editing and persisted script/style export passed. Not a JavaScript-engine denial-of-service guarantee.
- **PPTX:** browser-only upstream artifact removed the vulnerable parser dependency. Native export produced two editable slides and no imported media files.
- **Editor:** bundled Monaco 0.56 worker/runtime compatibility; latest packaged dark theme, syntax coloring, ⌘K/⌘, from editor focus, Spotlight Format Document, and saved formatted scratch-file contents passed. Broader completion/LSP/language acceptance remains open.
- **Notices:** generated frontend inventory is embedded; supplemental Monaco MIT/third-party files are packaged. Vite's inventory excludes worker-only graphs and does not complete distribution review.
- **Visible negative auth:** the signed-out packaged probe first exposed a log-only Orion failure. Orion now rethrows after cleanup; shared chat shows an accessible error, restores the failed draft/chips, and blocks duplicate preparation sends. Rebuilt again (`visible-errors-build.log`); final native screen shows the subscription-login error and restored synthetic prompt before any AI subprocess/model request. Two new regressions passed. This is not persisted-draft/crash recovery.
- **Build hygiene:** an invalid quit-automation action let one intermediate build run while the old validation process was open. No mixed-process UI result was accepted. The verified validation process was subsequently quit normally via AppleEvent, the bundle rebuilt again (`grants-clean-build.log`), signature verified, and a fresh PID used for final checks. Production bundle/data were untouched.

## Bounded live and source checks

- **New private ChatGPT account:** [September 12 live evidence](2026-09-12-subscription-live.md) supersedes the earlier text-only limitation below for the tested Terra shared-chat/tool/cancel paths and native image backend. The [subsequent image workflow slice](2026-09-12-background-ai-image-workflow.md) also passed generation/ingestion, opt-in tagging, edit/restart and native PNG/SVG export. Specialist workflows, all models and token-level streaming are not comprehensively certified.

- Codex subscription, model `gpt-5.6-terra`, read-only ephemeral text-only CLI test: exit **0**, exact `ORION_TEST_OK`, **zero tool events**. Scratch working directory; no Orion MCP attached. This proves CLI text/auth only—not app transport, images, tools, resume, or website reconstruction.
- Known-pattern secret scan: **2,057 historical blobs**, **2,997 scanned text versions**, **zero pattern matches**. **127 binary/large versions skipped.** It covers referenced history and nonignored working files, not ignored credentials, every secret format, asset metadata, or all personal information. Do not call it comprehensive secret clearance.
- img2threejs license checked against upstream revision `6e60b5e22419464b4853e01ddb6c0e6f6659a733`; the exact earlier port revision is still not reconstructed.

## Still blocking universal green

1. **Supply-chain maintenance:** npm currently has zero findings. Raw Cargo audit remains nonzero (RSA, Linux-side GLib, maintenance warnings). Target-aware gating retains rather than hides unselected findings; other platforms still need review. Five selected UNIC maintenance advisories remain through Tauri/URLPattern.
2. **Security review:** exact HTTP/Orion MCP authorization and executed-preview boundaries have evidence, but CLI built-ins, specialist policies, external account changes, background-process cancellation, filesystem races and broader plugin/untrusted-content behavior remain open. No universal sandbox claim.
3. **Standalone distribution:** Cursor's managed installation passed, but comprehensive rights review, clean-machine testing, a fresh normal-identifier app/DMG, install/upgrade/recovery checks and remote CI evidence remain outstanding.
4. **Visual/accessibility polish:** first-party smokes are partial. Spotlight's excess empty height and settings/assistant overlap are fixed and packaged-checked; narrow multi-pane layouts still need review. Custom loopback key-required classification is now fixed. Surface-by-surface verification remains required.
5. **Specialist coverage and live access:** remaining Claude/pi-specific paths, additional vision transports, other provider logins/model access, and app-by-app acceptance are not all certified. The legacy one-shot/image-ingestion blocker is closed, but that does not certify every specialist or account.
6. **Persistence and retention:** scoped XDesign/Archives failed-save recovery, macOS normal-quit guard, verified SQLite backup retention and non-destructive restore-copy are accepted. [Note/file private journaling](2026-09-12-draft-recovery.md) now has scoped native process-crash → explicit new-copy recovery, no-overwrite and discard acceptance; unsafe startup empty-plaintext note purging was removed and blank/image-only preservation verified. Last/in-flight edits, XDesign/other draft coverage, full-profile promotion/historical upgrades, power loss and broader interrupted-work recovery remain open. Latest gates193 frontend files/1227tests/23Node/240Rust+1ignored. Fixture-only cold recovery and 26 shared-SQL historical-prefix upgrades now pass, as does packaged in-dialog recovery feedback; real profile promotion/WebKit recovery is still unaccepted. Evidence keeps per-binary attribution.
7. **Remaining third-party review:** the owner decisions are settled—Apache-2.0 for original code/creator-owned models, GLB authorship confirmed, maintained Transformers replacement approved and implemented. Full dependency/asset notices, SDK distribution rights, and exact derivative provenance still need review.

No public release, remote CI run, blanket third-party redistribution clearance, or universal green status is claimed by this follow-up.
