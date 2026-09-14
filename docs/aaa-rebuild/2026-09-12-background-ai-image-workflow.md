# Background AI and full subscription image workflow — 2026-09-12

Continuation of [subscription acceptance](2026-09-12-subscription-live.md). This closes the identified legacy one-shot/image-ingestion blocker, **not the complete release audit**. Production data, normal app bundle and unrelated accounts were not changed; no commit or release was made.

## Routing and consent

- Removed `claude_oneshot` and `claude_oneshot_with_image` from native commands and frontend IPC. Asset tags, note tags, note inline AI, Ask Archive, Git commit-message generation and personalized companion check-ins now use `runSurfaceAnalysis` through shared routing.
- Analysis honors its owning surface's selected provider/model, grants **zero tools**, uses a newly created private working directory rather than a reused temporary folder or user project, supports real image attachments on the supported Claude/Codex routes, and fails rather than substituting a different provider or a filename-only image description. Setup/response time is bounded to 180 seconds; listeners, output size, errors and cancellation are handled by the shared runner. This is not universal filesystem/process sandboxing.
- `ai.background` stores versioned opt-ins for notes, assets and companion. All default off. Serialized queues check consent before starting, opt-out cancels active requests and invalidates queued/late results. Failed enable stays off; failed disable stays off in memory and exposes a persistence warning/retry—do not assume it survived a restart until the save succeeds. Already-sent data cannot be recalled.
- Providers settings disclose the uploaded data, changing recipients when model selection changes, and subscription limits versus API billing. Manual analysis actions remain explicit actions, not background opt-ins. Image transport parity across every provider is not claimed.
- Manual tags are retained, stale/deleted note or asset results are discarded, and failures are visible. Tag activity lasts until the analysis lifecycle settles, even after manual tag edits or deletion, so plugin lifecycle checks cannot mistake an unfinished request for idle work. Ask Archive cancels on dismissal; companion cancels on unmount and avoids overlapping requests.
- Shared Claude execution now uses owned Unix process groups and signature-validated, bounded PNG/JPEG/GIF/WebP attachments. Removed the monitor's unverified `claude --print /usage` invocation: live quota is explicitly unavailable; local Claude transcript totals follow the selected Claude credential directory.

## Packaged live image acceptance

Only the isolated **Orion Terminal Validation** profile was used, with API-key environment overrides removed and its existing private ChatGPT OAuth session retained.

1. Explicitly enabled automatic media tags for this synthetic test; other background opt-ins stayed off.
2. XDesign → Image generator generated a cyan glass sphere through the native ChatGPT subscription backend, `gpt-image-2`.
3. A real **1,006,143-byte, 1254×1254 PNG** appeared on the canvas and in Archives asset storage. Requested size is not a promise of exact returned dimensions.
4. Scoped **GPT-5.6 Terra** tagging received an actual `input_image`, emitted **zero tool calls**, and persisted `glass-orb`, `abstract`, `neon`. No unrelated Claude call or API fallback was used.
5. Turned media opt-in back off through settings. All three saved opt-ins remained off after normal restarts.
6. Reopened the image project, selected the image layer and nudged X from 290 to 291. SQLite persistence and the reopened native Inspector both retained 291, with the real image still visible.
7. Native PNG and SVG export passed. PNG: 872×872 with alpha bounds (16,16,856,856); mean resampled per-channel difference versus the original was 0.0775/255. SVG embedded the exact original PNG bytes and contained no `asset://` references. New files had Unix 0600 permissions.

This is bounded account/model/workflow acceptance—not a verified subscription plan name, every model entitlement, all vision transports, all image formats or full reconstruction/FX acceptance.

## Defects found by export and overlay testing

- SVG serialization could duplicate `xmlns`; serialization now lets `XMLSerializer` supply the namespace.
- External image references do not render reliably when an SVG is loaded as an image. PNG/SVG export now embeds local raster bytes: signature checks, 20MB/image, 64MB expanded resource budget, 15-second deadline, no remote imports or redirects. Unsupported resources fail visibly instead of silently disappearing. PNG rendering is bounded to 16 megapixels.
- Canvas export used browser downloads and did not surface asynchronous errors. Tauri now uses native save dialogs and atomic binary writes; duplicate export and project-switch races are guarded. The browser download fallback remains for non-Tauri use.
- Binary export, generated asset bytes and snapshots now reuse the atomic temporary-file/rename writer: new files 0600, existing permissions preserved, failed temporary files cleaned. This does not establish power-loss/parent-directory durability or close all filesystem races.
- The floating design assistant covered Control Panel. Settings are now above floating assistants; Spotlight/toasts/confirmations have explicit higher layers. Focus entry/restoration, Tab wrapping and nested Escape handling have regressions. Packaged checks confirmed settings above the open assistant and Spotlight above settings. Native confirmation was opened and cancelled without deleting the synthetic provider; this is not a VoiceOver/accessibility certification.
- Spotlight's flex cross-axis stretching created a large empty tail down to the screen edge. The panel is now content-sized and viewport-bounded; verified in the packaged app.

## Bounded FX follow-up and private working directories

- Packaged FX Assist used GPT-5.6 Terra and three scoped operations (`orion_fx_get_scene`, `orion_fx_set_params`, `orion_fx_patch_layer`). It changed exactly the disposable gradient's name to `Subscription FX proof` and `colorB` to `#ff3ea5`; every other saved JSON field was unchanged. The canvas visibly changed to magenta, returned `ORION_FX_SUBSCRIPTION_OK`, and survived tab switching and a normal app restart.
- The first evidence counter only recognized `function_call`. Codex also records code-mode wrappers as `custom_tool_call` named `exec`—not the OS shell tool. Corrected the counter: four wrappers performed discovery and the three MCP operations. Rechecked the earlier image-tag session; its response items were six messages, genuinely zero calls.
- Review found the analysis helper reused `orion-text-model` under the temporary directory. New native `analysis_work_dir` creates an exclusive, unique directory per call, Unix 0700, rejecting an existing directory/symlink rather than reusing contents. Surface analysis and FX's default agent working directory use it; explicitly supplied project directories remain explicit. Setup stays inside timeout/cancellation handling, including rejection of a late start after cancellation.
- Rebuilt and ran a second read-only FX request. Its actual Codex session used the new private directory, mode 0700 and empty after the call, returned final marker `ORION_PRIVATE_FX_OK`, and left scene JSON unchanged. This tests the real IPC binding and CLI working directory, not just a mocked path. The UI also retained a preamble; preamble/final formatting and token-level streaming are not fully accepted.
- This is not every FX tool, shader repair, video/audio export or provider. Working-directory isolation does not certify every CLI profile/configuration or filesystem boundary. Empty run-directory retention is still part of the broader cleanup work.

## Gates and evidence

- **179 frontend files / 1,141 tests**, **21 Node contracts**, **213 Rust tests passed / 1 ignored**; TypeScript and Vite passed.
- Root and optional-runtime npm audits: **zero findings**. Fresh selected Apple Silicon native audit: no blocking findings, **five UNIC maintenance advisories**. Raw lockfile/other-target review remains open.
- Fresh isolated app build, deep/strict ad-hoc signature verification and packaged MCP-policy smoke passed. No dependency added for this slice.
- Latest gates/bundle: `/tmp/orion-release-next/verify-private-analysis.log`, `private-analysis-build.log`, `private-analysis-mcp.json`; FX evidence `fx-live-result.json`, `fx-private-result.json`. Earlier image/export evidence: `verify-background-final.log`, `background-final-build.log`, `background-final-mcp.json`, `background-final-{npm-audit.log,native-audit.json}`, `background-image-result.json`, and `background-image-document-{before,after}-edit.json`. Screenshots: `/tmp/orion-release-closure/background-*` and `fx-*`.
- Known-pattern scan: 2,057 historical blobs / 2,980 text versions, zero findings, 127 binary/large versions skipped. Not comprehensive secret/asset privacy clearance.
- The first new asset-race regression used JSON despite the actual comma-separated tag prompt; corrected that test fixture. Failure evidence is retained. The native Save As automation once retained the existing `.png` suffix while typing it again; the verified file therefore ends `.png.png`. This was recorded rather than mistaken for an export failure.

Latest follow-up: [UI callback lifetimes and native transport bounds](2026-09-12-ui-callback-lifetimes.md), with newer gate counts. Counts above retain this image/private-directory checkpoint.

## Still open

See [release closure](2026-09-11-release-closure.md): remaining specialist/account contracts and live workflows, broad filesystem/security/recovery checks, wider visual/accessibility acceptance, third-party/maintenance review, normal app/DMG clean-machine installation and remote CI. No universal subscription parity, notarization, clean-machine readiness or release sign-off is claimed.
