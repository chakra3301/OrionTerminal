# Command Center — Pi SDK Sidecar Spike Findings (Task 0)

**Date:** 2026-06-20
**Status:** ✅ PASS — pi-as-engine is real. The CC-1 engine slice is de-risked; proceed to CC-0.
**Spec:** [2026-06-20-command-center-design.md](./2026-06-20-command-center-design.md) §2.2, §6
**Machine:** pi `@earendil-works/pi-coding-agent` **v0.79.6**, global install; Anthropic auth present (`~/.pi/agent/auth.json`).

---

## What was tested

A throwaway Node ESM script drove a **headless pi `AgentSession`** via the SDK (`createAgentSession`) — no TUI, no subprocess CLI. Three things had to be true for the Command Center engine to be buildable:

1. spawn a session with a **chosen model**,
2. with a **per-profile isolated vault as cwd**,
3. with the **llm-wiki skill loaded**, **streaming**, and **able to use tools**.

All three confirmed.

## Results

| Check | Result |
| --- | --- |
| Model selection | ✅ `ModelRegistry.create(auth).find("anthropic","claude-haiku-4-5")` → session ran on it. `getAvailable()` lists the Anthropic family from existing auth. |
| Per-profile vault isolation | ✅ Set process cwd to `…/divisions/design/wiki`; session reported that exact path and **wrote `FIELD-NOTE.md` into it**. cwd is the isolation primitive — one process per profile, cwd = its vault. |
| Skill loading | ✅ `DefaultResourceLoader` discovers `llm-wiki` from cwd/agentDir; `skillsOverride` filtered to **only** `llm-wiki` and the model confirmed it was loaded. Per-profile skill sets are a filter on the loader. |
| Streaming | ✅ `session.subscribe` → `message_update / text_delta` streams token-by-token, exactly like the minimal example. |
| Tool use | ✅ Asked it to write a file; it called the write tool and the file appeared on disk with correct contents. |
| Cost/auth | ✅ Runs on existing subscription/key auth via `AuthStorage.create()` — no per-call key plumbing needed in the spike. |

## Event taxonomy (for transcoding to the `claude:event` contract)

The SDK event stream maps cleanly onto Orion's existing `claude:event`/`claude:exit` contract — **no new EventBridge plumbing** needed, same trick the CLI engines use.

```
agent_start / agent_end                 → turn lifecycle
turn_start  / turn_end                  → turn lifecycle
message_start / message_end             → assistant message boundaries
message_update:text_start/_delta/_end   → assistant text  → claude:event(assistant)
message_update:toolcall_start/_delta/_end → tool call args → claude:event(tool_use)
tool_execution_start / tool_execution_end → tool run/result → claude:event(tool_result)
```

So a `pi_line_to_events`-style transcoder (mirroring `cli_engine/transcode.rs`) is straightforward: text deltas → assistant snapshot, toolcall_* → tool_use, tool_execution_end → tool_result, agent_end/turn_end → result+exit.

## Architecture implications (locked for CC-1)

- **Sidecar shape:** a Node process per active profile (or a pool), spawned with the profile's cwd=`wiki_root`, a `skillsOverride` to the profile's skill set, the profile's `brain_model`, and the profile's persona appended (via a synthetic skill or system append). Streams events back over stdio/IPC; a thin transcoder emits `claude:event`/`claude:exit`.
- **Isolation = cwd + loader**, not env-var gymnastics. Cleaner than the Codex/Gemini CLI isolation (no `CODEX_HOME`/`GEMINI_DIR` bridging).
- **Tools come from pi's own resource discovery** — the llm-wiki tools (`wiki_*`) are available in-session, so `wiki_retro` after a mission is native, not bolted on.
- **Subscription auth** is inherited from `~/.pi/agent/auth.json` — no key handling in Command Center for the pi path.

## Open items for the build (not blockers)

- **[P-IMPL]** Persona injection: decide synthetic-skill vs system-append vs context-file for a profile's charter/persona (04-skills shows synthetic skills; 03-custom-prompt shows system prompt). Lean: synthetic skill so it composes with discovered skills.
- **[P-IMPL]** Process lifecycle: one long-lived sidecar per profile (resume across missions via `SessionManager` on disk) vs spawn-per-mission. Spike used `SessionManager.inMemory()`; real impl wants on-disk sessions for resume.
- **[P-IMPL]** Cancel: SDK exposes `session.abort()` — wire to the Command Center cancel path (parity with `dispatchCancel`).
- **[P-IMPL]** Tool-permission scoping per profile (e.g., research = read+web, dev = full) — a tools filter on the session, same place skills are filtered.
- **[P-VERIFY]** Bundling: the sidecar needs the pi package resolvable from the packaged Tauri app. Confirm pi is a runtime dep (or vendored) before CC-1 ships.

## Verdict

**Proceed.** The one genuinely unknown dependency in the Command Center spec — "can a profile really *be* a headless pi with its own vault + the wiki skill?" — is **yes**, demonstrated end-to-end (spawn → isolate → load skill → stream → use tools → write to vault). CC-0 (migration + profiles model + read-only shell) can start; CC-1 builds the sidecar + transcoder on this footing.
