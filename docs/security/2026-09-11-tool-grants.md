# Per-run tool grants — September 11, 2026

This closes specific permission-routing defects, **not** a universal agent sandbox or a release sign-off.

## Implemented

- Codex/Gemini IPC now carries `allowedTools`; previously it dropped the field, including tool-less planning/text turns.
- Agent selections with zero composed grants resolve to `[]`, not unrestricted `null`. Plain model selections retain the existing unrestricted default.
- `mcp_grants.rs` enforces the process-local `ORION_TOOL_GRANTS` snapshot on **both `tools/list` and `tools/call`**. Empty/malformed snapshots deny tools. Exact names, supported built-in aliases, and explicit whole-Orion-server grants are distinguished. Plugin-disable checks still apply.
- Claude gets a unique private MCP configuration retained until process completion, an explicit built-in `--tools` list for restricted runs, strict MCP configuration, and no user/project settings sources for those restricted runs. Edit/Write route through Orion tools rather than native edits.
- Gemini gets a unique private settings file, `tools.core` allowlist (including a genuinely empty list), Orion-only MCP, and disabled hooks for restricted turns. Filesystem aliases are mediated by Orion; shell/web tools require their corresponding grants.
- Cursor's SDK-wide `mcp` family is backed by the native per-tool snapshot. Its bridge rejects missing/mismatched snapshots and unexpected additional MCP servers for restricted runs. The current dedicated Cursor key slot accepts only the built-in account reference instead of silently ignoring another reference.
- Restricted Codex turns use a fresh session, no approval escalation, read-only sandbox unless Shell is granted, and disabled shell/cloud/plugin/agent/image capabilities except explicitly supported grants. `ShellTool` is the execution gate: **Codex 0.154 keeps `unified_exec` enabled even when asked to disable it**. The ineffective flag is not used as a security claim.
- Codex code-mode-only models need `code_mode_host`; it remains enabled as a V8 tool dispatcher, not a Node runtime. Orion's exact-grant MCP server alone receives automatic approval, with required/bounded startup; global CLI approval escalation remains disabled. Live read-only probes denied guessed writes and Node filesystem imports.
- Restricted Codex/Cursor turns do not resume old sandbox/SDK tool state; the shared dispatcher restores prior text context. This is not lossless restoration of hidden tool traces or prior image attachments.
- Restricted CLI behavior is limited to reviewed Codex **0.154.x** / Gemini **0.47.x** versions; other versions fail before model launch. Fetch-only Codex grants are rejected because its web capability is not independently fetch-only.
- HTTP tool mapping rejects unsupported shell/web/external-MCP grants rather than silently dropping them.
- Subscription sends require Claude/Codex subscription readiness and remove known inherited alternate-provider/API overrides; Gemini system settings enforce Google OAuth. Cursor ignores inherited API-key/Node-preload overrides in favor of its explicit managed account.
- Claude/CLI/Cursor cancellation is registered before asynchronous setup probes; stopping runs retain ownership until cleanup, preventing replacement races.
- Shared CLI Unix cancellation now terminates the owned process group, rather than only the npm launcher. Live Stop removed the tracked launcher/engine/MCP processes. Cancelled shared sessions lose resume ownership; fresh sessions restore visible text, including prompts cancelled before CLI persistence. This does not cover every specialist, Windows descendant tree, or deliberately detached process.
- MCP file reads are bounded before allocation and reject non-regular files; MCP file writes reuse the permission-preserving unique atomic-save implementation.

## Evidence

- Unit tests cover grant parsing/aliases, malformed and empty grants, IPC forwarding, fresh-session text recovery, configuration cleanup, restricted argument/config generation, cancellation during preflight, and bounded/atomic file operations.
- `npm run test:native-policy -- --binary /absolute/path/to/orion-terminal` runs a built executable in MCP mode against a disposable database and filesystem fixture. It does not launch the desktop, access a production profile, or call a model.
- The packaged validation executable passed: permitted reads succeed; guessed note creation is denied; empty/malformed policies expose no tools; explicit note-write permission creates exactly one synthetic note; disabling the owning plugin still blocks a granted tool.
- Codex's installed CLI was inspected offline. Upstream source at [`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/spec_plan.rs) checks `Feature::ShellTool` before registering shell handlers. The native apply-patch handler can still be present; read-only sandbox policy, not a claim of an empty internal tool registry, constrains ungranted writes.
- Codex's same-revision [`safety.rs`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/safety.rs) rejects patches outside writable roots when approval policy is never, including its explicit read-only rejection. This is inspected upstream policy, not a live adversarial model test.
- A signed-out native chat probe now visibly reports subscription preflight failure and restores the draft. It exposed and fixed a prior log-only Orion catch; no AI subprocess/model request was started.
- Gemini 0.47.0's installed `createToolRegistry` checks `tools.core` for built-ins, including `[]`; system settings override workspace/user core lists. These are source/configuration checks, **not live model acceptance tests**.

Follow-up: [UI callback lifetimes and native transport bounds](../aaa-rebuild/2026-09-12-ui-callback-lifetimes.md) adds shared-turn admission revocation, request expiry, async XDesign rechecks and admitted-tool project locks. Unauthenticated bridge reads/connections/writes are bounded. This supplements immutable grants; it does not replace them or promise rollback of already executing operations.

## Remaining limits

Use trusted projects and disposable data when testing agents. Shell access can run programs and modify files; it is not a narrow file-edit permission. Orion MCP file tools are not confined to a project-root capability filesystem. A process with sufficient filesystem/shell access can bypass a tool broker; this is not protection against a compromised app or local owner process.

External MCP servers and specialist paths (Hermes, Command/pi, website reconstruction, inline/Tab API calls) need their own capability/account acceptance matrix. CLI account changes outside Orion, complete cancellation of descendant/background processes, filesystem races, recovery failures, and live provider behavior remain review items. CLI/internal planning helpers are not equivalent to external tool access and may still exist in a restricted CLI runtime.

The original model-free checks were followed by user-authorized private ChatGPT subscription testing: Terra chat, scoped tools, accepted synthetic writes, Stop/retry, and a native image-backend request. No API fallback was used. See [the live evidence and limits](../aaa-rebuild/2026-09-12-subscription-live.md). The subsequent [background AI/image slice](../aaa-rebuild/2026-09-12-background-ai-image-workflow.md) removed the legacy Claude-only one-shot commands. Those analyses now use shared selection and explicit zero grants; automatic uploads require persisted opt-in. Live subscription image tagging used actual pixels and emitted zero tool calls. This does not migrate every specialist or establish universal confinement.
