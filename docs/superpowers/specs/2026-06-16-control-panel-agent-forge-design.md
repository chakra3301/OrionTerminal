# Control Panel + Agent Forge — Design Spec (Phase 1)

**Date:** 2026-06-16
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Branch context:** cut work off a clean base; next migration number is **0026** (0025 already used by `learn_figures_achievements`).

---

## 1. What this is

A new **Control Panel** — a dedicated in-canvas surface that becomes the single home for every Orion Terminal setting and option — plus two new subsystems it hosts:

1. **Provider Registry** — register any AI provider (Claude, OpenAI, Google, OpenAI-compatible, custom), store its key, and surface its models in the model dropdowns everywhere.
2. **Agent Forge** — a game-inventory–style "class builder" where you compose a named agent from a **Brain** model, an **Action** model, and **equipped skills** drawn from a **Skill Library**, then save it so it appears as a selectable option in every dropdown.

This is **Phase 1 of three**. The full vision (non-Claude models running *everywhere*, including agentic editing, with literal Brain→Action routing) is intentionally decomposed so Phase 1 ships complete, useful, and **with zero regression** to the existing Claude-backed terminal.

### The three phases

- **Phase 1 (this spec)** — Control Panel + Provider Registry + Skill Library + Agent Forge + unified dropdown. **All execution stays on the existing Claude CLI path.** Non-Claude providers can be *registered* but are marked "needs runtime" and are not runnable yet. Agents run on their Brain model via Claude; the Action model is stored but unused.
- **Phase 2** — provider-agnostic agent runtime (a tool-calling loop that does for OpenAI/Gemini/local what the Claude CLI does for Claude). Lights up non-Claude across surfaces. *Own spec.*
- **Phase 3** — literal Brain→Action routing (planner model hands off to executor model per step), built on the Phase 2 runtime. *Own spec.*

### Locked decisions (from brainstorming)

- Multi-AI must *eventually* work **everywhere** (open-source release goal: users not locked to Claude). The runtime that enables this is Phase 2 — Phase 1 builds the framework so it can reach there without regressing today's behavior.
- A **skill = instructions + tools**, bundled.
- Brain/Action = **literal two-model routing** (Phase 3). Phase 1 stores both fields, runs on Brain only.
- Control Panel = **dedicated surface**; the existing Settings sections fold into it (nothing removed).
- Agent Forge UI = **game inventory / equip-loadout** aesthetic, arrangement: Equipment column left · agent center · Skill Inventory grid right. Character portrait is a **custom image** (from Archives assets or upload), with a generated/emoji fallback.
- Skill Library = **seeded starter pack + full custom authoring**.
- Phase 1 providers = **register now, marked "needs runtime"**; Claude is the only live provider.

---

## 2. Architecture & data model

### Module layout

- `src/features/controlpanel/` — the Control Panel surface and its section components (UI).
  - `ControlPanel.tsx` (rail + router), `ProvidersPanel.tsx`, `SkillLibraryPanel.tsx`, `SkillEditor.tsx`, `AgentForge.tsx` (+ inventory subcomponents).
  - Existing settings section components (Appearance, Wallpaper, MCP, Shortcuts, About, API Keys) are lifted in from `src/features/settings/` with minimal change.
- `src/features/agents/` — **pure, TDD'd logic + types** (mirrors how `repolens/` and `learn/` isolate pure logic):
  - `agentTypes.ts` — `Provider`, `Skill`, `Agent` types + **fail-soft parsers** (`parseSkill`, `parseAgent`, `parseProvider`) in the salvage style of `parseGraphSpec`/`parseDesignSpec` (coerce arrays to `[]`, strings to `""`, never throw).
  - `composeAgent.ts` — `composeAgent(agent, skills) → { model, appendSystemPrompt, allowedTools, mcpRefs }`. The resolver that turns a saved agent into runnable CLI params.
  - `toolCatalog.ts` — the universe of grantable tools: built-in Claude tools + configured MCP servers + Orion MCP tools.
  - `agentValue.ts` — tagged-value format/parse for the dropdown (`agent:<id>` vs plain model id).
- `src/lib/agentsDb.ts` — CRUD over the new tables.
- `src/store/providersStore.ts`, `src/store/skillsStore.ts`, `src/store/agentsStore.ts` — Map-based stores mirroring `notesStore`.

### Migration 0026 (append-only)

Three new tables. **API keys are NOT stored here** — they live in the OS keychain (extending `api_key.rs`), referenced by an account name.

**`providers`**
- `id` TEXT PK, `name` TEXT, `kind` TEXT (`anthropic` | `openai` | `google` | `openai_compat` | `custom`)
- `base_url` TEXT, `models_json` TEXT (array of `{ id, label }`)
- `key_ref` TEXT (keychain account name; empty for keyless/local)
- `enabled` INTEGER, `builtin` INTEGER, `created_at` INTEGER
- Anthropic ships as a `builtin` row (seeded on first run, idempotent).

**`skills`**
- `id` TEXT PK, `name` TEXT, `icon` TEXT, `accent` TEXT
- `instructions` TEXT (appended to the agent's system prompt)
- `tools_json` TEXT (array of tool grants — built-in tool names and/or MCP server refs)
- `builtin` INTEGER, `created_at` INTEGER, `updated_at` INTEGER

**`agents`**
- `id` TEXT PK, `name` TEXT, `role` TEXT, `accent` TEXT
- `avatar_asset_id` TEXT (nullable) / `avatar_url` TEXT (nullable)
- `brain_model` TEXT, `action_model` TEXT
- `skill_ids_json` TEXT (ordered array of skill ids)
- `created_at` INTEGER, `updated_at` INTEGER

### The integration seam (saved agent → selectable & runnable)

1. `ModelSelect`'s value becomes a **tagged string**: a plain model id (today's behavior, unchanged) **or** `agent:<id>`.
2. On send, a thin resolver inspects the tag:
   - `agent:<id>` → `composeAgent()` → Claude CLI receives `--model <brain>` + `--append-system-prompt <persona + skill instructions>` + tool allow-list (union of equipped skills' grants).
   - plain model id → behaves **exactly as today** (byte-identical CLI args).
3. `claude_cli.rs::claude_send` gains **optional** params (`system_append: Option<String>`, `allowed_tools: Option<Vec<String>>`). `None` = identical to current behavior → **zero regression**.

Claude remains the untouched default path; agents are a resolver layer on top of it.

---

## 3. The Control Panel surface

A dedicated in-canvas window. Opened from:
- the **dock**,
- the **menubar** app menu,
- a **Spotlight command** ("Open Control Panel"),
- the existing **⌘,** shortcut (re-routed here).

Left-rail navigation. The existing Settings sections **fold in** (nothing is lost):

```
Providers       🧠  (new)
Agent Forge     ⚒  (new)
Skill Library   📚  (new)
──────────────
API Keys        🔑  (existing; now multi-provider)
Appearance      🎨  (existing)
Wallpaper       🖼  (existing)
MCP Servers     🔌  (existing)
Shortcuts       ⌨  (existing)
About           ℹ  (existing)
```

The existing section components are self-contained and move in with minimal change. Old Settings entry points now route to the Control Panel.

---

## 4. Provider Registry

The **Providers** section lists provider cards. Anthropic/Claude is pinned as the **built-in default**, marked ✓ **live**.

**+ Add provider** form: `name`, `kind` (Anthropic / OpenAI / Google / OpenAI-compatible / custom), `base_url`, API key (→ keychain via the `api_key.rs` pattern, referenced by `key_ref`), and a model list (typed in for Phase 1; "fetch models" is a later nicety).

Each **non-Claude** provider card shows a **"Runs after the engine update (Phase 2)"** badge. Its models appear in dropdowns but are **non-selectable for running** in Phase 1. Claude is the only live provider this phase.

This is pure groundwork for Phase 2's runtime — no wasted work.

---

## 5. Skill Library

A grid of skill tiles (rarity-accented, matching the inventory aesthetic). **Skill = instructions + granted tools.**

- **Seeded starter pack** (built-in, shipped as a data file, inserted on first run idempotently, flagged `builtin`): Web Research, Code Reviewer, Cite Sources, Summarizer, Note-Taker (Archives), Data Analyst, and a few more.
- **Skill editor** (create / edit): `name`, `icon`, `accent`, an **instructions** markdown field (appended to the agent's system prompt), and a **tool picker** — checkboxes over the `toolCatalog`: built-in Claude tools (WebSearch, Read, Edit, Write, Bash, Glob, Grep, …) + configured MCP servers + Orion MCP tools. A hover/detail shows "grants: …".
- **Built-in skills are duplicate-to-customize** (never destructively edited), so seeded-pack updates never clobber user tweaks.

---

## 6. Agent Forge (the inventory screen)

Single-screen "class sheet" with a game-inventory aesthetic:

- **Equipment column (left):** **Brain** slot (legendary/violet), **Action** slot (swift/green), optional **Persona** slot.
- **Agent (center):** custom **portrait image** (from Archives assets or upload; generated/emoji fallback), name, role/tagline, and **equipped skill slots** beneath the portrait (cap ~4–6, generous).
- **Skill Inventory grid (right):** equip skills from the library; rarity-colored tiles; hover tooltip showing what each grants.
- **Action bar (bottom):** model/skill summary + a **cost rating**, a "Test run" button, and **⚒ Forge Agent** (save).

Behavior:
- **Brain / Action** = two model pickers over any registered model. Phase 1 stores both; **runs on Brain only**. The Action slot shows a subtle "wires up in a later update" hint.
- **Equip skills** = click inventory tiles → fill slots.
- **Persona** = optional tone/system-prompt snippet.
- **Save** → writes an `agents` row → the agent immediately appears in every `ModelSelect` under a **"Your Agents"** group.

### Execution in Phase 1 (Claude-backed)

Selecting an agent in any dropdown resolves via `composeAgent`:
`--model <brain>` + `--append-system-prompt` (persona + equipped skills' instructions, concatenated) + tool allow-list (union of the skills' granted tools), riding the **existing Claude CLI path**. So an agent is "a saved model + instructions + tools," fully functional in Phase 1; the dual-model/multi-provider depth arrives in Phases 2–3.

---

## 7. Unified dropdown (`ModelSelect`)

`ModelSelect` (Archives, Orion, XDesign, ROSIE, Learn) becomes a small **grouped** picker:

- **Models** — grouped by provider (Anthropic live; others greyed with the "needs runtime" badge).
- **Your Agents** — saved agents, each with portrait + accent.

The stored value stays a single string but is now **tagged** (`agent:<id>` or a plain model id), so `app_state` persistence and the `modelFor(surface)` fallback are unchanged. Every send site already calls `modelFor(surface)`; it now passes the tagged value through the thin resolver.

**Hermes** (per-agent model in its own DB) gets the same picker so swarm agents can be custom agents too — an easy follow-on, **not required for Phase 1 sign-off**.

---

## 8. Testing & non-regression

- **Pure-logic TDD** (the `bkt.ts`/`designSpec.ts` discipline): `agentTypes` parsers, `composeAgent`, `toolCatalog`, tagged-value format/parse. Target ~25–35 new vitest cases.
- **Headline guarantee — non-regression:** a plain (untagged) model id flows through the new resolver to **byte-identical** CLI args as today. Explicit test: untagged / `None` → current behavior.
- **Rust:** unit-test the new optional-arg handling in `claude_cli.rs`; existing suites + `cargo check` stay green. New params default to today's behavior.
- **Migration 0026** is additive only; existing tables untouched.
- **Gates:** `tsc` clean · full vitest green · `cargo check` + tests · `npm run build` exit 0.
- **UI is human-verified** by the user after a `tauri dev` restart (migration 0026 + Rust changes mean a restart is required, not just hot-reload).

---

## 9. Explicit deferrals

- **Phase 2:** provider-agnostic agent runtime; non-Claude execution on any surface; "fetch models" from a provider API.
- **Phase 3:** literal Brain→Action routing (planner→executor handoff).
- **Phase 1 follow-ons (not blocking sign-off):** Hermes per-agent picker showing custom agents; provider model auto-discovery; agent "Test run" deeper than a single prompt.

---

## 10. Success criteria (Phase 1)

1. Control Panel opens as its own surface; all prior Settings sections present and working.
2. A non-Claude provider can be registered (key → keychain) and its models appear in dropdowns, badged "needs runtime," non-runnable.
3. The Skill Library shows seeded skills; a user can create/edit a custom skill (instructions + tool grants).
4. The Agent Forge can compose + save an agent (custom portrait, Brain, Action, equipped skills); it appears under "Your Agents" in every dropdown.
5. Selecting a custom agent runs it on its Brain model via the Claude CLI with the composed system prompt + tool allow-list.
6. Selecting a plain Claude model behaves byte-identically to today (verified non-regression).
7. All gates green; user smoke-tests after a restart.
