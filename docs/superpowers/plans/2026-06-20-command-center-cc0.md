# Command Center — CC-0 Foundation — Build Plan

**Date:** 2026-06-20
**Spec:** [../specs/2026-06-20-command-center-design.md](../specs/2026-06-20-command-center-design.md)
**Spike:** [../specs/2026-06-20-command-center-pi-spike-findings.md](../specs/2026-06-20-command-center-pi-spike-findings.md) (PASS)
**Goal of CC-0:** the foundation — migration + profiles/channels/messages/missions data model + a **read-only** org/channel shell as a new top-level app (gold accent), seeded with the default org. **No engine runs yet** (that's CC-1). Hermes loses its dock tile (data kept, still reachable via command palette).

## Locked scope

In: migration 0027, DB layer, pure-logic core (TDD), zustand store, read-only Command Center app surface (org tree rail + channel list + thread/mission placeholders), dock/menu/shell wiring, retire Hermes dock tile.
Out (later phases): pi sidecar + running profiles (CC-1), delegation protocol execution (CC-2), memory vaults + graph (CC-3), autonomy (CC-4).

## Tasks (each ends green: tsc · vitest · cargo check · build)

- **T1 — migration 0027** `0027_command_center.sql` (cc_profiles/cc_channels/cc_messages/cc_missions, append-only) + register `version: 27` in lib.rs.
- **T2 — pure core (TDD)** `src/apps/command/ccTypes.ts` — types, `RANK_ORDER`, `sortByRank`, `buildOrgTree`, `DIVISIONS` catalog. Tests first.
- **T3 — seed (TDD)** `src/apps/command/ccSeed.ts` — deterministic `defaultSeed({wikiBase, now})` → profiles (commander/general/4 captains) + channels (command/per-division). Tests.
- **T4 — DB layer** `src/lib/db.ts` — cc_* row types + list/insert/update/delete for profiles/channels/messages/missions (mirror the Hermes layer).
- **T5 — store** `src/store/commandStore.ts` — load → seed-if-empty → expose profiles/channels/messages/missions + selectors. Boot-load in App.tsx.
- **T6 — surface** `src/apps/command/CommandCenterApp.tsx` + `command.css` — read-only: org tree rail, channel list, active-channel thread placeholder, per-profile mission/vault peek. Gold accent.
- **T7 — wiring** AppId `"command"`, DEFAULT_SIZE, APP_NAMES, Shell lazy+render+titles, Dock tile (replace Hermes slot), menus + builtins "Open Command Center", retire Hermes dock tile.

## Smoke (hand back to user — needs tauri dev restart for migration 0027)

Restart → dock shows Command Center (gold) where Hermes was → opens → default org renders (Commander · General · 4 Captains) + channels list → read-only, nothing runs → Hermes still openable via Spotlight, board intact.
