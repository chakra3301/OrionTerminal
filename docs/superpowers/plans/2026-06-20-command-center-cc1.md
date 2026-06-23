# Command Center — CC-1 The Pi Engine — Build Plan

**Date:** 2026-06-20
**Spec:** [../specs/2026-06-20-command-center-design.md](../specs/2026-06-20-command-center-design.md)
**Builds on:** CC-0 (foundation). **Goal:** a Captain/General profile actually *runs* — you send it a message in a channel and watch it think, use tools (incl. llm-wiki), and reply, streamed live, persisted to `cc_messages`.

## Decision revised (from the spec's "SDK sidecar")

Drive the **`pi` CLI headless** as a subprocess (`pi --mode json --print …`), mirroring the proven `cli_engine` (codex/gemini) pattern — NOT a bundled Node SDK sidecar. Cleaner, no SDK bundling, reuses spawn/stream/cancel. Verified live: `pi --mode json` streams NDJSON; flags `--model`, `--append-system-prompt` (persona), cwd (vault isolation), `--session-id` (resume), and skills auto-discover (llm-wiki loads). Auth inherited from `~/.pi/agent/auth.json` (no key plumbing).

## Tasks (each green: tsc · vitest · cargo test · build)

- **T1 — Rust `pi_engine/transcode.rs` (pure, TDD):** `pi_line_to_events(line, &mut PiState) -> Vec<Value>` over real `--mode json` shapes → flat cc events `{kind:init|assistant|tool_use|tool_result|result}`. Accumulates text_delta; filters `role:"custom"` (wiki notice) + thinking; session id from header; cost from turn_end. Fixtures grounded in captured output.
- **T2 — Rust `pi_engine/mod.rs`:** pure `pi_args(cfg)` builder + `pi_send`/`pi_cancel`/`pi_status` commands. Spawn loop mirrors `cli_send` but emits `cc:event`/`cc:exit` keyed by `runId`. cwd resolved to `app_data_dir/<wiki_root>` (mkdir -p → realizes the vault). Register in lib.rs.
- **T3 — ipc:** `piSend/piCancel/piStatus` wrappers in `src/lib/ipc.ts`.
- **T4 — store (TDD pure parts):** `commandStore` gains `sendToProfile(profileId, channelId, text)` → persist user msg, create streaming assistant placeholder, call `piSend`; `applyEvent` (init→store session, assistant→live text, tool→inline note, result→cost), `finishRun` (persist assistant `cc_message`), `cancelRun`. Pure reducer `applyCcEvent(state, ev)` unit-tested.
- **T5 — bridge:** `CommandEventBridge` mounts `cc:event`/`cc:exit` listeners → store. Mounted with the app.
- **T6 — UI:** channel composer (textarea + send + cancel) targeting the channel's profile; live streaming assistant bubble + tool chips; model line. Wire into `CommandCenterApp`.

## Out of scope (later)

Delegation protocol (CC-2), per-profile skill/tool scoping + model picker, multi-turn resume hardening, MCP into Orion's own tools, autonomy gating. CC-1 = one profile, one channel, real streamed turn.

## Smoke (needs tauri dev restart — new Rust module + commands)

Restart → open Command Center → pick a Captain channel → type "Write a one-line field note to your vault and tell me you did" → send → streams thinking/tool/answer → reply persists in the thread → vault dir gets a file. Cancel mid-stream halts.
