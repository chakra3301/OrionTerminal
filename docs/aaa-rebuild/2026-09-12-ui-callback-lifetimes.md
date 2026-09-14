# UI callback lifetimes — 2026-09-12

Continuation of [background/image and bounded FX acceptance](2026-09-12-background-ai-image-workflow.md). **Not public-release clearance.** Existing WIP and production data are preserved; no commit or release.

## Finding and fix

The native UI bridge authenticated callers but had no originating-turn identity. Its five-second response timeout removed a pending reply; it did not invalidate the event already queued in the frontend. FX/model tools also mutate live stores after asynchronous preparation. Source review identified these gaps; this is not a claim of reproduced production data loss.

- `uiActionRuns.ts` assigns a fresh, in-memory identity to every shared dispatcher turn. Stop/forget revokes it synchronously, before native cancellation acknowledges. Native send completion/failure closes admission; cleanup from an older turn cannot revoke a newer identity.
- The existing IPC helpers attach identity without changing caller argument positions. Claude, Codex, Gemini and Cursor scoped MCP configs carry it in their environment. `mcp_server` puts it in bridge envelope metadata, not model-controlled arguments. The HTTP runtime explicitly carries identity through its blocking tool worker; nested/panicking worker context restores correctly.
- Native events have a five-second expiry. `EventBridge` rejects unknown/ended managed turns and expired requests before dispatch, and rechecks after async FX/model preparation. XDesign plugin availability is rechecked with these guards. Canvas actions recheck after project preparation; batch commands also reject a project change during module loading.
- An admitted FX/model tool holds `ui-tool` activity until it settles, including after the assistant stops. Real project-store transitions remain blocked during this interval. This prevents an already executing tool from following the user into another project; it does **not** roll back earlier mutations or promise instant abortion of every local operation.

## Local bridge bounds

Unauthenticated sockets previously awaited an unbounded line. The bridge now limits input to 1 MB, requires a complete UTF-8 line, gives reads two seconds, limits concurrent connections to 64, and bounds response writes to two seconds. Authentication remains required; no CSP or tool-grant weakening.

## Automated evidence

`/tmp/orion-release-next/verify-callback-final.log` (exit 0):

- TypeScript and production Vite passed.
- **180 frontend files / 1,152 tests**; **21 Node contracts**.
- **217 Rust passed / 1 ignored**.
- New regressions cover cancelled/unknown/replaced identities, expiry, all shared IPC transports, native-start failure, rejection before Stop acknowledgment, actual canvas mutation delayed by project preparation, real project-store transition locking, bounded/partial/invalid/idle bridge reads, metadata separation and worker-context restoration.

## Native acceptance

- Rebuilt **Orion Terminal Validation**, normal quit first, then verified deep/strict ad-hoc signature and ran packaged model-free MCP policy smoke. Production was untouched.
- Tested the rebuilt process's own loopback listener without reading any credential: invalid authentication rejected; oversized, incomplete and invalid UTF-8 input rejected; idle reader closed in **2.003 seconds**; connection 65 rejected while 64 slots were occupied; service recovered afterward. No model request in these transport probes.
- Two bounded GPT-5.6 Terra read-only FX turns returned `ORION_CALLBACK_FX_OK` / `ORION_CALLBACK_RECHECK_OK`, each with discovery plus get-scene code-mode calls. Persisted scene JSON remained exactly unchanged and background opt-ins remained off. Home navigation succeeded afterward, showing the tool activity lock was released. UI preamble/final-text formatting remains imperfect.
- An initial process-argument probe incorrectly expected a literal run-ID assignment. Codex deliberately forwards environment-variable **names**, keeping values out of arguments. The corrected probe observed `ORION_UI_RUN_ID` in `mcp_servers.orion.env_vars`; raw arguments and environment values were not logged/read respectively. Retained the initial inconclusive artifact rather than relabeling it a pass.
- Evidence under `/tmp/orion-release-next/`: `callback-build.log`, `callback-mcp.json`, `callback-transport-result.json`, `callback-native-identity-recheck.json`, `callback-live-result.json`. Screenshots under `/tmp/orion-release-closure/callback-*`.
- Fresh root/runtime npm audit: zero vulnerabilities. No dependency or lockfile change in this slice; previous selected-macOS native audit still carries five maintenance findings and no blocking findings, not whole-lockfile clearance.

Earlier image and FX edit proof belongs to its original binary; it is not silently relabeled as a new-build test. Cancellation-at-preparation and project-switch races above are deterministic regression tests, not a claim that a live cloud race was forced on every connector.

## Remaining limits

- Run identity is an admission/lifecycle boundary, not a global filesystem sandbox or a substitute for native grants and plugin policy.
- Legacy/unmanaged MCP clients without an Orion-managed identity remain supported, with request expiry but without shared-dispatcher Stop ownership. Independent specialists, external processes and all provider/account parity remain separate work.
- Already executing local operations may finish; prior changes are not rolled back. Broader asynchronous plugin behavior, interrupted saves/crash recovery, power-loss durability and retention remain open.
- Broader native validation, full streaming/message formatting, broader visual/accessibility workflows, provenance/maintenance, normal app/DMG clean-machine installation and remote CI remain release gates.
