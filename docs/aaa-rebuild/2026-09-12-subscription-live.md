# ChatGPT subscription acceptance — 2026-09-12

The user completed OAuth in **Orion Terminal Validation** and authorized bounded subscription-only tests. No API fallback, unrelated account login/logout, credential copying, production-data changes, commit, or release was performed. The plan name remains unverified; successful requests establish only the tested capabilities.

**Follow-up:** the [background AI/image workflow slice](2026-09-12-background-ai-image-workflow.md) subsequently removed the legacy helpers and passed full subscription image ingestion, opt-in vision tagging, canvas edit/restart and native PNG/SVG export. Counts below describe this earlier checkpoint.

## Live findings and fixes

1. **Model availability and errors.** GPT-5.4 Mini was rejected by this subscription endpoint. The account-generated model catalog lists GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5, and Codex Spark. Refreshed the static built-in choices without silently changing existing selections. Explicitly selected **GPT-5.6 Terra** in Validation. Protocol error messages now survive the CLI adapter instead of becoming only “exit code 1”; regressions use the real nested error shape. Catalog presence does not guarantee every model's entitlement.
2. **Code-mode tool transport.** New models require `code_mode_host`. Disabling it prevented tool access. Enabled the host while retaining reviewed capability restrictions and the immutable Orion grant snapshot. Orion's MCP server alone receives `default_tools_approval_mode="approve"`; otherwise the CLI's `approval_policy="never"` refused every MCP call. Required startup and a ten-second startup deadline avoid silently continuing without that server. This authorizes the already-scoped tools, not every MCP server or built-in operation.
3. **Real MCP result shape.** Successful Codex events contain `error:null`. The transcoder no longer marks those as errors; non-null errors and `result.isError`/`result.is_error` remain failures.
4. **Stop reached the wrong process.** Killing the npm Node launcher left the actual Codex engine running. New dependency-free `process_group.rs` creates a separate Unix process group and terminates it before reaping its leader on cancellation/error/abandonment. Shared Codex/Gemini CLI runs use it. Normal completion disarms the guard. This is not Windows tree termination, containment of deliberately detached processes, or migration of every specialist launcher.
5. **Early-cancel context loss.** Codex can emit a thread ID before saving the user prompt. A first live retry answered “I don’t have it” despite the marker remaining visible in Orion. Cancellation now revokes that shared session binding; a fresh CLI session receives prior visible text even when no session ID ever arrived. Late init records cannot rebind a recently revoked session. Deletion is serialized/persisted; a write failure keeps the in-memory revocation and surfaces a sticky warning about restart recovery. Hidden tool traces and old images are not reconstructed.

## Actual acceptance evidence

Private evidence is in `/tmp/orion-release-next/`; screenshots are in `/tmp/orion-release-closure/`.

- **Packaged chat:** Terra returned the requested subscription marker, with the selected model visible.
- **Packaged read/write:** read the synthetic TypeScript fixture and reported exported answer `42`; created `subscription-live-write.txt` with exactly `ORION_SUBSCRIPTION_WRITE_OK\n`, mode **0600**. Orion opened its review/accept UI; the synthetic change was accepted. The file remained after restart.
- **Read-only live CLI policy:** read succeeded; a guessed write was unavailable and the forbidden file remained absent. Code-mode `process`, `fetch`, and `require` were undefined; importing `node:fs` failed. `subscription-policy-live.jsonl` retains the result. These are bounded probes, not an exhaustive adversarial sandbox proof. Upstream code-mode V8/delegation behavior was reviewed at Codex revision `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`.
- **Packaged Stop and recovery:** tracked the npm launcher, Rust engine, and Orion MCP process before Stop; all three were gone approximately 3.5 seconds after the click. SQLite confirmed the cancelled session no longer had resume ownership. Retrying used a **different** session and correctly returned **`ORBIT73`** from visible prior history. See `subscription-final-cancel-result.json`, `subscription-final-live-result.json`, and `subscription-final-retry-result.png`.
- **Native subscription image backend:** the explicitly invoked ignored Rust test generated and decoded a real PNG, without API-key environment variables. `subscription-live-image.png` is **1,286,291 bytes, 1254×1254**, despite requested 1024×1024. The image was visually inspected. This proves the native subscription request, not the complete XDesign ingestion/UI workflow or exact size-parameter compliance.
- **Final packaged MCP:** `subscription-final-mcp.json` passed the model-free exact-grant/plugin-denial suite against the bundle at this checkpoint.
- **Fixture cleanup:** removed only the known synthetic Archives/XDesign model overrides and disabled the stopped loopback fixture provider. Validation retains explicitly selected default Terra and disabled Tab autocomplete. The authenticated private Codex profile survived normal rebuild/reopen cycles.

## Final gates

`verify-subscription-final.log`: **171 frontend files / 1,105 tests; 21 Node contracts; 207 Rust passed / 1 ignored; TypeScript and Vite passed**. The provider image test remains ignored in the ordinary suite and was invoked separately for the authorized live image test. `subscription-final-build.log`: packaged app build and deep/strict ad-hoc signature verification passed. No dependencies were added for these fixes.

## Follow-up / still open

- **Legacy one-shot blocker closed in the follow-up.** Shared selected-provider analysis, zero grants, opt-in background uploads and lifecycle handling replaced the old native commands. Full XDesign image workflow acceptance is now recorded in the linked continuation, with remaining limitations kept explicit.
- Native image success does not clear img2model, website reconstruction, FX agent, other provider accounts, token-level streaming, live logout/relogin, or all model choices.
- Other specialist authentication, broad filesystem/process/recovery review, surface-by-surface accessibility, supply-chain maintenance/provenance, normal-product app/DMG/clean-machine testing, and remote CI remain open.

**Release remains uncleared.** See the [closure checklist](2026-09-11-release-closure.md) and [capability matrix](../setup-and-verification.md).
