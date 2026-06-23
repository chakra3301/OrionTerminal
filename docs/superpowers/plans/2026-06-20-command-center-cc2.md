# Command Center — CC-2 Delegation Protocol — Build Plan

**Date:** 2026-06-20
**Spec:** [../specs/2026-06-20-command-center-design.md](../specs/2026-06-20-command-center-design.md) §2.3
**Builds on:** CC-1 (pi engine). **Goal:** a mission flows through the org as typed messages, approval-gated — you brief the General, it proposes a plan, you approve, Captains run their directives, reports roll up into one briefing.

## Flow

```
You → Mission(title, brief) ──▶ General
General → Plan {directives:[{division,title,instruction}]}  (pi one-shot)
        ──▶ [YOUR APPROVAL GATE] ──▶
For each directive: post `directive` msg → Captain runs it (pi one-shot) → post `report` msg
General → aggregate reports → Briefing  ──▶ `report` msg in #command
```

Never auto-fires: planning is gated; nothing dispatches until you click Approve.

## Tasks (each green: tsc · vitest · cargo test · build)

- **T1 — Rust `pi_oneshot`** in `pi_engine` — runs `pi --mode json --print` (cwd=vault, model, persona), feeds the existing transcoder, returns `{result, cost}` (clean final text, no wiki notice). +tests via `pi_args`-style. Register in lib.rs + ipc `piOneshot`.
- **T2 — pure `ccPlan.ts` (TDD):** `buildPlanPrompt(brief, captains)` · `parsePlan(text) → {directives}` (fail-soft JSON extract, drops directives for unknown divisions) · `buildBriefingPrompt(title, brief, reports)`. Tests.
- **T3 — store orchestration:** `cc_missions` CRUD wired; `startMission(title, brief)` (General plans → `proposedPlan` + status `planned`), `approveMission()` (post directives → run Captains one-shot → post reports → General briefing → status `done`), `rejectMission()`. `planning`/`dispatching` flags. All messages persisted via `insertCCMessage`.
- **T4 — UI:** mission affordance in command/cross channels — New Mission composer, "General is planning…", plan-approval panel (directive cards + Approve/Reject), "Dispatching…" state. Directive/report/briefing messages render in their channels (kind pills already exist).

## Out of scope (later)

Per-captain live streaming during dispatch (CC-2 uses one-shot for deterministic orchestration), cross-division handoffs (CC stretch), autonomy levels ≥2 (CC-4), per-profile vault routing fix (CC-3).

## Smoke (needs tauri dev restart — new `pi_oneshot` command)

Restart → #command → New Mission "Landing page" / brief → General proposes directives → Approve → directives appear in Captain channels, each Captain reports, a briefing lands in #command. Reject discards.
