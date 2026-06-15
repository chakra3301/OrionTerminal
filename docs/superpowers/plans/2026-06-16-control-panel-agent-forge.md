# Control Panel + Agent Forge (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated Control Panel surface hosting a Provider Registry, a Skill Library, and a game-inventory Agent Forge, where saved agents become selectable options in every model dropdown — all Claude-backed with byte-identical non-regression.

**Architecture:** A pure-logic core (`src/features/agents/`) defines types, fail-soft parsers, a tagged dropdown-value codec, a tool catalog, and a `composeAgent` resolver that turns a saved agent into Claude CLI params (`--model` + `--append-system-prompt` + `--allowed-tools`). SQLite migration 0026 adds `providers`/`skills`/`agents` tables; keys live in the OS keychain. The Control Panel is a full-surface modal (modeled on the Settings modal) that folds in the existing Settings sections. `ModelSelect` becomes a grouped picker; a thin resolver at each send site expands `agent:<id>` values. `claude_send` gains optional params that default to today's behavior.

**Tech Stack:** Tauri 2 + Rust, React 19 + TypeScript, Zustand, `tauri-plugin-sql` (SQLite), vitest, keyring.

---

## File Structure

**Create:**
- `src-tauri/migrations/0026_control_panel.sql` — providers/skills/agents tables
- `src-tauri/src/provider_keys.rs` — keychain CRUD for provider API keys
- `src/features/agents/agentTypes.ts` — types + fail-soft parsers
- `src/features/agents/agentTypes.test.ts`
- `src/features/agents/agentValue.ts` — tagged dropdown-value codec
- `src/features/agents/agentValue.test.ts`
- `src/features/agents/toolCatalog.ts` — grantable-tool universe
- `src/features/agents/toolCatalog.test.ts`
- `src/features/agents/composeAgent.ts` — agent+skills → CLI params
- `src/features/agents/composeAgent.test.ts`
- `src/features/agents/seedData.ts` — builtin Anthropic provider + starter skills
- `src/lib/agentsDb.ts` — providers/skills/agents CRUD
- `src/store/providersStore.ts`, `src/store/skillsStore.ts`, `src/store/agentsStore.ts`
- `src/store/controlPanelStore.ts` — surface open/section state
- `src/features/controlpanel/ControlPanel.tsx` — surface shell + rail
- `src/features/controlpanel/ProvidersPanel.tsx`
- `src/features/controlpanel/SkillLibraryPanel.tsx`
- `src/features/controlpanel/SkillEditor.tsx`
- `src/features/controlpanel/AgentForge.tsx`
- `src/features/controlpanel/controlpanel.css`

**Modify:**
- `src-tauri/src/lib.rs` — register migration 0026 + `provider_keys` commands
- `src/lib/ipc.ts` — provider-key wrappers + `claudeSend` new params
- `src/lib/db.ts` — add app_state keys (`controlpanel`) if needed
- `src-tauri/src/claude_cli.rs` — optional `system_append` + `allowed_tools`
- `src/components/ModelSelect.tsx` — grouped picker (models + agents)
- `src/lib/models.ts` — `resolveSelection()` helper (model vs agent)
- `src/components/ClaudeChat.tsx` / `src/apps/orion/OrionClaudeRail.tsx` / Archives + XDesign rails / ROSIE / Learn — pass resolved agent params on send
- `src/commands/builtins.ts` — `controlpanel.open` command (re-point `settings.open`)
- `src/features/settings/SettingsPanel.tsx` — export section components for reuse
- `src/app/App.tsx` — mount `<ControlPanel/>` + hydrate new stores
- `src/shell/MenuBar.tsx` / `src/shell/Dock.tsx` — Control Panel entry

---

## Milestone A — Data + pure-logic foundation

### Task 1: Migration 0026 (providers / skills / agents tables)

**Files:**
- Create: `src-tauri/migrations/0026_control_panel.sql`
- Modify: `src-tauri/src/lib.rs` (migration array, after the version-25 entry)

- [ ] **Step 1: Write the migration SQL**

Create `src-tauri/migrations/0026_control_panel.sql`:

```sql
-- 0026_control_panel.sql — provider registry, skill library, custom agents
CREATE TABLE providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- 'anthropic' | 'openai' | 'google' | 'openai_compat' | 'custom'
  base_url    TEXT NOT NULL DEFAULT '',
  models_json TEXT NOT NULL DEFAULT '[]',
  key_ref     TEXT NOT NULL DEFAULT '', -- keychain account name; '' = keyless/local
  enabled     INTEGER NOT NULL DEFAULT 1,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE skills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT '',
  accent       TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  tools_json   TEXT NOT NULL DEFAULT '[]',
  builtin      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE agents (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT '',
  accent         TEXT NOT NULL DEFAULT '',
  avatar_asset_id TEXT,
  avatar_url     TEXT,
  brain_model    TEXT NOT NULL,
  action_model   TEXT NOT NULL DEFAULT '',
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

- [ ] **Step 2: Register the migration in Rust**

In `src-tauri/src/lib.rs`, immediately after the `version: 25` `Migration { ... }` entry, add:

```rust
Migration {
    version: 26,
    description: "control panel: providers, skills, agents",
    sql: include_str!("../migrations/0026_control_panel.sql"),
    kind: MigrationKind::Up,
},
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles clean (no schema applied yet — runs on next app boot).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/0026_control_panel.sql src-tauri/src/lib.rs
git commit -m "feat(control-panel): migration 0026 — providers/skills/agents tables"
```

---

### Task 2: `agentTypes.ts` — types + fail-soft parsers

**Files:**
- Create: `src/features/agents/agentTypes.ts`
- Test: `src/features/agents/agentTypes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/agentTypes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSkill, parseAgent, parseProvider } from "./agentTypes";

describe("parseSkill", () => {
  it("salvages a partial skill and defaults missing fields", () => {
    const s = parseSkill({ id: "s1", name: "Web Research" });
    expect(s).toEqual({
      id: "s1",
      name: "Web Research",
      icon: "",
      accent: "",
      instructions: "",
      tools: [],
      builtin: false,
    });
  });

  it("coerces a non-array tools field to []", () => {
    expect(parseSkill({ id: "s1", name: "x", tools: "nope" as never }).tools).toEqual([]);
  });

  it("returns null when id or name is missing", () => {
    expect(parseSkill({ name: "x" })).toBeNull();
    expect(parseSkill({ id: "s1" })).toBeNull();
  });
});

describe("parseAgent", () => {
  it("defaults action_model and skills", () => {
    const a = parseAgent({ id: "a1", name: "Atlas", brain_model: "claude-opus-4-8" });
    expect(a).toMatchObject({ id: "a1", name: "Atlas", brainModel: "claude-opus-4-8", actionModel: "", skillIds: [] });
  });

  it("returns null without a brain model", () => {
    expect(parseAgent({ id: "a1", name: "Atlas" })).toBeNull();
  });
});

describe("parseProvider", () => {
  it("coerces models to [] and defaults flags", () => {
    const p = parseProvider({ id: "p1", name: "OpenAI", kind: "openai", models: "x" as never });
    expect(p).toMatchObject({ id: "p1", name: "OpenAI", kind: "openai", baseUrl: "", models: [], enabled: true, builtin: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/agentTypes.test.ts`
Expected: FAIL — "Cannot find module './agentTypes'".

- [ ] **Step 3: Write the implementation**

Create `src/features/agents/agentTypes.ts`:

```typescript
export type ProviderKind = "anthropic" | "openai" | "google" | "openai_compat" | "custom";

export type ProviderModel = { id: string; label: string };

export type Provider = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  models: ProviderModel[];
  keyRef: string;
  enabled: boolean;
  builtin: boolean;
};

export type ToolGrant =
  | { kind: "builtin"; name: string }
  | { kind: "mcp"; server: string };

export type Skill = {
  id: string;
  name: string;
  icon: string;
  accent: string;
  instructions: string;
  tools: ToolGrant[];
  builtin: boolean;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  accent: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  brainModel: string;
  actionModel: string;
  skillIds: string[];
};

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function parseSkill(raw: unknown): Skill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    icon: str(r.icon),
    accent: str(r.accent),
    instructions: str(r.instructions),
    tools: arr<ToolGrant>(r.tools).filter((t) => t && typeof t === "object"),
    builtin: r.builtin === true || r.builtin === 1,
  };
}

export function parseAgent(raw: unknown): Agent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  const brainModel = str(r.brain_model) || str(r.brainModel);
  if (!id || !name || !brainModel) return null;
  return {
    id,
    name,
    role: str(r.role),
    accent: str(r.accent),
    avatarAssetId: (str(r.avatar_asset_id) || str(r.avatarAssetId)) || null,
    avatarUrl: (str(r.avatar_url) || str(r.avatarUrl)) || null,
    brainModel,
    actionModel: str(r.action_model) || str(r.actionModel),
    skillIds: arr<string>(r.skill_ids ?? r.skillIds).filter((s) => typeof s === "string"),
  };
}

export function parseProvider(raw: unknown): Provider | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  const kind = str(r.kind) as ProviderKind;
  if (!id || !name || !kind) return null;
  return {
    id,
    name,
    kind,
    baseUrl: str(r.base_url) || str(r.baseUrl),
    models: arr<ProviderModel>(r.models).filter((m) => m && typeof m === "object" && typeof (m as ProviderModel).id === "string"),
    keyRef: str(r.key_ref) || str(r.keyRef),
    enabled: r.enabled === undefined ? true : r.enabled === true || r.enabled === 1,
    builtin: r.builtin === true || r.builtin === 1,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/agentTypes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/agentTypes.ts src/features/agents/agentTypes.test.ts
git commit -m "feat(agents): types + fail-soft parsers for provider/skill/agent"
```

---

### Task 3: `agentValue.ts` — tagged dropdown-value codec

**Files:**
- Create: `src/features/agents/agentValue.ts`
- Test: `src/features/agents/agentValue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/agentValue.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatAgentValue, parseSelection } from "./agentValue";

describe("agent value codec", () => {
  it("formats an agent id with the agent: tag", () => {
    expect(formatAgentValue("a1")).toBe("agent:a1");
  });

  it("parses an agent-tagged value", () => {
    expect(parseSelection("agent:a1")).toEqual({ kind: "agent", id: "a1" });
  });

  it("parses a plain model id as a model selection", () => {
    expect(parseSelection("claude-opus-4-8")).toEqual({ kind: "model", id: "claude-opus-4-8" });
  });

  it("treats empty/null as a default model selection", () => {
    expect(parseSelection("")).toEqual({ kind: "model", id: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/agentValue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/agents/agentValue.ts`:

```typescript
export type Selection =
  | { kind: "model"; id: string }
  | { kind: "agent"; id: string };

const AGENT_PREFIX = "agent:";

export function formatAgentValue(agentId: string): string {
  return AGENT_PREFIX + agentId;
}

export function parseSelection(value: string | null | undefined): Selection {
  const v = value ?? "";
  if (v.startsWith(AGENT_PREFIX)) {
    return { kind: "agent", id: v.slice(AGENT_PREFIX.length) };
  }
  return { kind: "model", id: v };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/agentValue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/agentValue.ts src/features/agents/agentValue.test.ts
git commit -m "feat(agents): tagged dropdown-value codec (model vs agent)"
```

---

### Task 4: `toolCatalog.ts` — grantable-tool universe

**Files:**
- Create: `src/features/agents/toolCatalog.ts`
- Test: `src/features/agents/toolCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/toolCatalog.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BUILTIN_TOOLS, mcpToolGrants, allToolGrants } from "./toolCatalog";
import type { ToolGrant } from "./agentTypes";

describe("toolCatalog", () => {
  it("exposes the built-in Claude tools as grants", () => {
    expect(BUILTIN_TOOLS.map((t) => t.name)).toContain("WebSearch");
    expect(BUILTIN_TOOLS.every((t) => t.kind === "builtin")).toBe(true);
  });

  it("maps enabled MCP servers to mcp grants", () => {
    const grants = mcpToolGrants([
      { id: "1", name: "playwright", enabled: true, config: { command: "x" } },
      { id: "2", name: "off", enabled: false, config: { command: "y" } },
    ]);
    expect(grants).toEqual([{ kind: "mcp", server: "playwright" }]);
  });

  it("dedupes builtin + mcp grants into one catalog", () => {
    const cat = allToolGrants([{ id: "1", name: "playwright", enabled: true, config: { command: "x" } }]);
    const keys = cat.map((g: ToolGrant) => (g.kind === "builtin" ? `b:${g.name}` : `m:${g.server}`));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("m:playwright");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/toolCatalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/agents/toolCatalog.ts`:

```typescript
import type { ToolGrant } from "./agentTypes";
import type { McpServer } from "@/store/mcpServersStore";

export type BuiltinTool = { kind: "builtin"; name: string; label: string };

export const BUILTIN_TOOLS: BuiltinTool[] = [
  { kind: "builtin", name: "WebSearch", label: "Web Search" },
  { kind: "builtin", name: "Read", label: "Read files" },
  { kind: "builtin", name: "Glob", label: "Find files" },
  { kind: "builtin", name: "Grep", label: "Search file contents" },
  { kind: "builtin", name: "Bash", label: "Run shell commands" },
  { kind: "builtin", name: "Edit", label: "Edit files" },
  { kind: "builtin", name: "Write", label: "Write files" },
];

export function mcpToolGrants(servers: McpServer[]): ToolGrant[] {
  return servers.filter((s) => s.enabled).map((s) => ({ kind: "mcp", server: s.name }));
}

export function allToolGrants(servers: McpServer[]): ToolGrant[] {
  const builtins: ToolGrant[] = BUILTIN_TOOLS.map((t) => ({ kind: "builtin", name: t.name }));
  return [...builtins, ...mcpToolGrants(servers)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/toolCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/toolCatalog.ts src/features/agents/toolCatalog.test.ts
git commit -m "feat(agents): tool catalog (builtin tools + MCP server grants)"
```

---

### Task 5: `composeAgent.ts` — agent+skills → CLI params

**Files:**
- Create: `src/features/agents/composeAgent.ts`
- Test: `src/features/agents/composeAgent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/composeAgent.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { composeAgent } from "./composeAgent";
import type { Agent, Skill } from "./agentTypes";

const agent: Agent = {
  id: "a1", name: "Atlas", role: "Research analyst", accent: "#b14cff",
  avatarAssetId: null, avatarUrl: null,
  brainModel: "claude-sonnet-4-6", actionModel: "claude-haiku-4-5-20251001",
  skillIds: ["web", "cite"],
};

const skills: Skill[] = [
  { id: "web", name: "Web Research", icon: "", accent: "", instructions: "Search the web for primary sources.", tools: [{ kind: "builtin", name: "WebSearch" }], builtin: true },
  { id: "cite", name: "Cite Sources", icon: "", accent: "", instructions: "Always cite with [n] markers.", tools: [{ kind: "mcp", server: "playwright" }], builtin: true },
];

describe("composeAgent", () => {
  it("runs on the brain model in Phase 1", () => {
    expect(composeAgent(agent, skills).model).toBe("claude-sonnet-4-6");
  });

  it("concatenates equipped skill instructions (in skillIds order) with a role header", () => {
    const out = composeAgent(agent, skills).appendSystemPrompt;
    expect(out).toContain("Research analyst");
    expect(out.indexOf("Search the web")).toBeLessThan(out.indexOf("Always cite"));
  });

  it("unions tool grants into a flat allowed-tools list (mcp as mcp__<server>)", () => {
    expect(composeAgent(agent, skills).allowedTools.sort()).toEqual(["WebSearch", "mcp__playwright"].sort());
  });

  it("ignores skill ids that resolve to no skill", () => {
    const out = composeAgent({ ...agent, skillIds: ["web", "ghost"] }, skills);
    expect(out.allowedTools).toEqual(["WebSearch"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/composeAgent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/agents/composeAgent.ts`:

```typescript
import type { Agent, Skill } from "./agentTypes";

export type ComposedAgent = {
  model: string;
  appendSystemPrompt: string;
  allowedTools: string[];
};

export function composeAgent(agent: Agent, allSkills: Skill[]): ComposedAgent {
  const byId = new Map(allSkills.map((s) => [s.id, s]));
  const equipped = agent.skillIds.map((id) => byId.get(id)).filter((s): s is Skill => !!s);

  const header = agent.role
    ? `You are ${agent.name}, a ${agent.role}.`
    : `You are ${agent.name}.`;
  const body = equipped.map((s) => `## ${s.name}\n${s.instructions}`.trim()).filter(Boolean);
  const appendSystemPrompt = [header, ...body].join("\n\n");

  const tools = new Set<string>();
  for (const s of equipped) {
    for (const g of s.tools) {
      tools.add(g.kind === "builtin" ? g.name : `mcp__${g.server}`);
    }
  }

  return { model: agent.brainModel, appendSystemPrompt, allowedTools: [...tools] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/composeAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/composeAgent.ts src/features/agents/composeAgent.test.ts
git commit -m "feat(agents): composeAgent resolver (agent+skills -> CLI params)"
```

---

### Task 6: `agentsDb.ts` — providers/skills/agents CRUD

**Files:**
- Create: `src/lib/agentsDb.ts`

- [ ] **Step 1: Write the implementation** (DB-layer; verified by store tests + manual)

Create `src/lib/agentsDb.ts`:

```typescript
import { getDb } from "@/lib/db";
import { parseProvider, parseSkill, parseAgent } from "@/features/agents/agentTypes";
import type { Provider, Skill, Agent } from "@/features/agents/agentTypes";

type ProviderRow = { id: string; name: string; kind: string; base_url: string; models_json: string; key_ref: string; enabled: number; builtin: number; created_at: number };
type SkillRow = { id: string; name: string; icon: string; accent: string; instructions: string; tools_json: string; builtin: number; created_at: number; updated_at: number };
type AgentRow = { id: string; name: string; role: string; accent: string; avatar_asset_id: string | null; avatar_url: string | null; brain_model: string; action_model: string; skill_ids_json: string; created_at: number; updated_at: number };

function jp<T>(s: string, d: T): T { try { return JSON.parse(s) as T; } catch { return d; } }

// ── Providers ────────────────────────────────────────────────────────────────
export async function listProviders(): Promise<Provider[]> {
  const db = await getDb();
  const rows = await db.select<ProviderRow[]>("SELECT * FROM providers ORDER BY builtin DESC, created_at", []);
  return rows
    .map((r) => parseProvider({ id: r.id, name: r.name, kind: r.kind, base_url: r.base_url, models: jp(r.models_json, []), key_ref: r.key_ref, enabled: r.enabled, builtin: r.builtin }))
    .filter((p): p is Provider => !!p);
}

export async function upsertProvider(p: Provider): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO providers (id,name,kind,base_url,models_json,key_ref,enabled,builtin,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
       models_json=excluded.models_json, key_ref=excluded.key_ref, enabled=excluded.enabled`,
    [p.id, p.name, p.kind, p.baseUrl, JSON.stringify(p.models), p.keyRef, p.enabled ? 1 : 0, p.builtin ? 1 : 0, Date.now()],
  );
}

export async function deleteProvider(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM providers WHERE id=$1 AND builtin=0", [id]);
}

// ── Skills ───────────────────────────────────────────────────────────────────
export async function listSkills(): Promise<Skill[]> {
  const db = await getDb();
  const rows = await db.select<SkillRow[]>("SELECT * FROM skills ORDER BY builtin DESC, name", []);
  return rows
    .map((r) => parseSkill({ id: r.id, name: r.name, icon: r.icon, accent: r.accent, instructions: r.instructions, tools: jp(r.tools_json, []), builtin: r.builtin }))
    .filter((s): s is Skill => !!s);
}

export async function upsertSkill(s: Skill): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO skills (id,name,icon,accent,instructions,tools_json,builtin,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, accent=excluded.accent,
       instructions=excluded.instructions, tools_json=excluded.tools_json, updated_at=excluded.updated_at`,
    [s.id, s.name, s.icon, s.accent, s.instructions, JSON.stringify(s.tools), s.builtin ? 1 : 0, now, now],
  );
}

export async function deleteSkill(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM skills WHERE id=$1", [id]);
}

// ── Agents ───────────────────────────────────────────────────────────────────
export async function listAgents(): Promise<Agent[]> {
  const db = await getDb();
  const rows = await db.select<AgentRow[]>("SELECT * FROM agents ORDER BY created_at", []);
  return rows
    .map((r) => parseAgent({ id: r.id, name: r.name, role: r.role, accent: r.accent, avatar_asset_id: r.avatar_asset_id, avatar_url: r.avatar_url, brain_model: r.brain_model, action_model: r.action_model, skill_ids: jp(r.skill_ids_json, []) }))
    .filter((a): a is Agent => !!a);
}

export async function upsertAgent(a: Agent): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO agents (id,name,role,accent,avatar_asset_id,avatar_url,brain_model,action_model,skill_ids_json,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, accent=excluded.accent,
       avatar_asset_id=excluded.avatar_asset_id, avatar_url=excluded.avatar_url, brain_model=excluded.brain_model,
       action_model=excluded.action_model, skill_ids_json=excluded.skill_ids_json, updated_at=excluded.updated_at`,
    [a.id, a.name, a.role, a.accent, a.avatarAssetId, a.avatarUrl, a.brainModel, a.actionModel, JSON.stringify(a.skillIds), now, now],
  );
}

export async function deleteAgent(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM agents WHERE id=$1", [id]);
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors in `agentsDb.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agentsDb.ts
git commit -m "feat(agents): SQLite CRUD for providers/skills/agents"
```

---

### Task 7: `seedData.ts` — builtin provider + starter skills (idempotent)

**Files:**
- Create: `src/features/agents/seedData.ts`
- Test: `src/features/agents/seedData.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/seedData.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BUILTIN_PROVIDER, STARTER_SKILLS } from "./seedData";

describe("seed data", () => {
  it("ships Anthropic as the builtin provider with the three models", () => {
    expect(BUILTIN_PROVIDER.builtin).toBe(true);
    expect(BUILTIN_PROVIDER.kind).toBe("anthropic");
    expect(BUILTIN_PROVIDER.models.map((m) => m.id)).toContain("claude-opus-4-8");
  });

  it("ships starter skills, all builtin with stable ids", () => {
    expect(STARTER_SKILLS.length).toBeGreaterThanOrEqual(5);
    expect(STARTER_SKILLS.every((s) => s.builtin && s.id.startsWith("builtin:"))).toBe(true);
    expect(new Set(STARTER_SKILLS.map((s) => s.id)).size).toBe(STARTER_SKILLS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/seedData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/agents/seedData.ts`:

```typescript
import type { Provider, Skill } from "./agentTypes";
import { MODELS } from "@/lib/models";

export const BUILTIN_PROVIDER: Provider = {
  id: "builtin:anthropic",
  name: "Anthropic (Claude)",
  kind: "anthropic",
  baseUrl: "",
  models: MODELS.map((m) => ({ id: m.id, label: m.label })),
  keyRef: "",
  enabled: true,
  builtin: true,
};

export const STARTER_SKILLS: Skill[] = [
  { id: "builtin:web-research", name: "Web Research", icon: "🔍", accent: "#00e0ff", instructions: "Search the web for primary, current sources. Prefer official docs and firsthand reports over summaries.", tools: [{ kind: "builtin", name: "WebSearch" }], builtin: true },
  { id: "builtin:cite-sources", name: "Cite Sources", icon: "📝", accent: "#00e0ff", instructions: "Back every non-obvious claim with a citation. Use [n] markers and list sources at the end.", tools: [], builtin: true },
  { id: "builtin:code-reviewer", name: "Code Reviewer", icon: "🛠️", accent: "#39ff88", instructions: "Review code for correctness, edge cases, and security. Report only high-confidence issues, most important first.", tools: [{ kind: "builtin", name: "Read" }, { kind: "builtin", name: "Grep" }, { kind: "builtin", name: "Glob" }], builtin: true },
  { id: "builtin:summarizer", name: "Summarizer", icon: "📚", accent: "#b14cff", instructions: "Produce tight, faithful summaries. Lead with the conclusion, then the few facts that support it. No filler.", tools: [], builtin: true },
  { id: "builtin:data-analyst", name: "Data Analyst", icon: "🧮", accent: "#e6ff3a", instructions: "Reason quantitatively. Show the steps, state assumptions explicitly, and sanity-check results.", tools: [{ kind: "builtin", name: "Bash" }, { kind: "builtin", name: "Read" }], builtin: true },
  { id: "builtin:note-taker", name: "Note-Taker", icon: "🗂️", accent: "#39ff88", instructions: "Capture decisions, action items, and open questions as clean structured notes.", tools: [], builtin: true },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/seedData.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/seedData.ts src/features/agents/seedData.test.ts
git commit -m "feat(agents): seed data — builtin Anthropic provider + starter skills"
```

---

## Milestone B — Backend plumbing (Rust)

### Task 8: `provider_keys.rs` — keychain CRUD for provider keys

**Files:**
- Create: `src-tauri/src/provider_keys.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod provider_keys;` + register commands)
- Modify: `src/lib/ipc.ts` (wrappers)

- [ ] **Step 1: Write the Rust module**

Create `src-tauri/src/provider_keys.rs`:

```rust
use keyring::Entry;

const SERVICE: &str = "personal-workstation";

fn account(key_ref: &str) -> String {
    format!("provider:{}", key_ref)
}

fn entry(key_ref: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &account(key_ref))
        .map_err(|e| format!("Secret storage unavailable ({})", e))
}

pub fn read(key_ref: &str) -> Option<String> {
    match entry(key_ref) {
        Ok(e) => match e.get_password() {
            Ok(s) if !s.trim().is_empty() => Some(s),
            _ => None,
        },
        Err(_) => None,
    }
}

#[tauri::command]
pub fn provider_key_set(key_ref: String, key: String) -> Result<(), String> {
    if key_ref.trim().is_empty() {
        return Err("key_ref is empty".into());
    }
    if key.trim().is_empty() {
        return Err("api key is empty".into());
    }
    entry(&key_ref)?
        .set_password(key.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn provider_key_clear(key_ref: String) -> Result<(), String> {
    let e = entry(&key_ref)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn provider_key_status(key_ref: String) -> Result<bool, String> {
    Ok(read(&key_ref).is_some())
}
```

- [ ] **Step 2: Register the module + commands**

In `src-tauri/src/lib.rs`: add `mod provider_keys;` near the other `mod` declarations, and add the three commands to the `tauri::generate_handler![ ... ]` list (alongside `api_key_set` etc.):

```rust
provider_keys::provider_key_set,
provider_keys::provider_key_clear,
provider_keys::provider_key_status,
```

- [ ] **Step 3: Add ipc wrappers**

In `src/lib/ipc.ts`, inside the `ipc` object, add:

```typescript
providerKeySet: (keyRef: string, key: string): Promise<void> =>
  invoke("provider_key_set", { keyRef, key }),
providerKeyClear: (keyRef: string): Promise<void> =>
  invoke("provider_key_clear", { keyRef }),
providerKeyStatus: (keyRef: string): Promise<boolean> =>
  invoke("provider_key_status", { keyRef }),
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check` then `cd .. && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/provider_keys.rs src-tauri/src/lib.rs src/lib/ipc.ts
git commit -m "feat(providers): keychain CRUD for per-provider API keys"
```

---

### Task 9: `claude_send` optional `system_append` + `allowed_tools` (non-regression)

**Files:**
- Modify: `src-tauri/src/claude_cli.rs` (signature + arg building)
- Modify: `src/lib/ipc.ts` (`claudeSend` params)

- [ ] **Step 1: Add a Rust unit test for the arg-building helper**

In `src-tauri/src/claude_cli.rs`, first extract a small pure helper and test it. Add near the top of the file (below imports):

```rust
/// Build the extra agent args appended after the base flags. Returns an empty
/// vec when no agent overrides are present (byte-identical to pre-agent behavior).
fn agent_args(system_append: &Option<String>, allowed_tools: &Option<Vec<String>>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(sys) = system_append.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        out.push("--append-system-prompt".into());
        out.push(sys.to_string());
    }
    if let Some(tools) = allowed_tools {
        let tools: Vec<&String> = tools.iter().filter(|t| !t.trim().is_empty()).collect();
        if !tools.is_empty() {
            out.push("--allowed-tools".into());
            for t in tools {
                out.push(t.clone());
            }
        }
    }
    out
}

#[cfg(test)]
mod agent_args_tests {
    use super::agent_args;

    #[test]
    fn none_yields_no_args() {
        assert!(agent_args(&None, &None).is_empty());
        assert!(agent_args(&Some("   ".into()), &Some(vec![])).is_empty());
    }

    #[test]
    fn builds_system_and_tools() {
        let out = agent_args(&Some("be terse".into()), &Some(vec!["WebSearch".into(), "mcp__playwright".into()]));
        assert_eq!(out, vec!["--append-system-prompt", "be terse", "--allowed-tools", "WebSearch", "mcp__playwright"]);
    }
}
```

- [ ] **Step 2: Run the Rust test to verify it fails**

Run: `cd src-tauri && cargo test agent_args`
Expected: FAIL — `agent_args` not found / not yet wired (it will actually compile+pass once the helper above is added; if you added the helper in Step 1, this confirms the helper logic). If the helper is present, expect PASS — then proceed to wire it.

- [ ] **Step 3: Thread the params through `claude_send`**

In `src-tauri/src/claude_cli.rs`, extend the signature:

```rust
#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    chat_id: String,
    prompt: String,
    project_root: Option<String>,
    session_id: Option<String>,
    image_path: Option<String>,
    model: Option<String>,
    system_append: Option<String>,
    allowed_tools: Option<Vec<String>>,
) -> Result<(), String> {
```

Then, in the arg-building block, immediately AFTER the existing `--disallowed-tools` args block and BEFORE the `--mcp-config` block, add:

```rust
    for a in agent_args(&system_append, &allowed_tools) {
        cmd.arg(a);
    }
```

(Leaving the existing `--disallowed-tools Edit Write MultiEdit NotebookEdit` untouched preserves reviewable-edit routing; `--allowed-tools` is additive.)

- [ ] **Step 4: Update the ipc wrapper**

In `src/lib/ipc.ts`, replace the `claudeSend` wrapper with:

```typescript
claudeSend: (
  chatId: string,
  prompt: string,
  projectRoot: string | null,
  sessionId: string | null,
  imagePath: string | null = null,
  model: string | null = null,
  systemAppend: string | null = null,
  allowedTools: string[] | null = null,
): Promise<void> =>
  invoke("claude_send", {
    chatId,
    prompt,
    projectRoot,
    sessionId,
    imagePath,
    model,
    systemAppend,
    allowedTools,
  }),
```

- [ ] **Step 5: Verify compile + tests**

Run: `cd src-tauri && cargo test agent_args && cargo check` then `cd .. && npx tsc --noEmit`
Expected: tests PASS, both compile. Existing `claudeSend` call sites still typecheck (new params optional).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/claude_cli.rs src/lib/ipc.ts
git commit -m "feat(claude): optional system_append + allowed_tools (non-regressive)"
```

---

## Milestone C — Stores + boot seeding

### Task 10: providersStore / skillsStore / agentsStore (+ idempotent seed + boot hydrate)

**Files:**
- Create: `src/store/providersStore.ts`, `src/store/skillsStore.ts`, `src/store/agentsStore.ts`
- Test: `src/store/agentsStore.test.ts`
- Modify: `src/app/App.tsx` (hydrate on boot)

- [ ] **Step 1: Write the failing store test**

Create `src/store/agentsStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agentsDb", () => {
  const mem: any[] = [];
  return {
    listAgents: vi.fn(async () => mem.slice()),
    upsertAgent: vi.fn(async (a: any) => { const i = mem.findIndex((x) => x.id === a.id); if (i >= 0) mem[i] = a; else mem.push(a); }),
    deleteAgent: vi.fn(async (id: string) => { const i = mem.findIndex((x) => x.id === id); if (i >= 0) mem.splice(i, 1); }),
  };
});

import { useAgentsStore } from "./agentsStore";

beforeEach(() => { useAgentsStore.setState({ agents: new Map(), loaded: false }); });

describe("agentsStore", () => {
  it("saves an agent and lists it", async () => {
    await useAgentsStore.getState().save({
      id: "a1", name: "Atlas", role: "", accent: "", avatarAssetId: null, avatarUrl: null,
      brainModel: "claude-opus-4-8", actionModel: "", skillIds: [],
    });
    expect(useAgentsStore.getState().list().map((a) => a.id)).toEqual(["a1"]);
  });

  it("removes an agent", async () => {
    await useAgentsStore.getState().save({ id: "a1", name: "Atlas", role: "", accent: "", avatarAssetId: null, avatarUrl: null, brainModel: "x", actionModel: "", skillIds: [] });
    await useAgentsStore.getState().remove("a1");
    expect(useAgentsStore.getState().list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/agentsStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the three stores**

Create `src/store/agentsStore.ts`:

```typescript
import { create } from "zustand";
import { listAgents, upsertAgent, deleteAgent } from "@/lib/agentsDb";
import type { Agent } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

type AgentsState = {
  agents: Map<string, Agent>;
  loaded: boolean;
  load: () => Promise<void>;
  list: () => Agent[];
  get: (id: string) => Agent | undefined;
  save: (a: Agent) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: new Map(),
  loaded: false,
  load: async () => {
    try {
      const rows = await listAgents();
      set({ agents: new Map(rows.map((a) => [a.id, a])), loaded: true });
    } catch (e) {
      log.warn("agents load failed", e);
      set({ loaded: true });
    }
  },
  list: () => Array.from(get().agents.values()),
  get: (id) => get().agents.get(id),
  save: async (a) => {
    set((s) => { const next = new Map(s.agents); next.set(a.id, a); return { agents: next }; });
    await upsertAgent(a);
  },
  remove: async (id) => {
    set((s) => { const next = new Map(s.agents); next.delete(id); return { agents: next }; });
    await deleteAgent(id);
  },
}));
```

Create `src/store/skillsStore.ts` (same shape; seeds starter skills if empty):

```typescript
import { create } from "zustand";
import { listSkills, upsertSkill, deleteSkill } from "@/lib/agentsDb";
import { STARTER_SKILLS } from "@/features/agents/seedData";
import type { Skill } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

type SkillsState = {
  skills: Map<string, Skill>;
  loaded: boolean;
  load: () => Promise<void>;
  list: () => Skill[];
  get: (id: string) => Skill | undefined;
  save: (s: Skill) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: new Map(),
  loaded: false,
  load: async () => {
    try {
      let rows = await listSkills();
      if (rows.length === 0) {
        for (const s of STARTER_SKILLS) await upsertSkill(s);
        rows = await listSkills();
      }
      set({ skills: new Map(rows.map((s) => [s.id, s])), loaded: true });
    } catch (e) {
      log.warn("skills load failed", e);
      set({ loaded: true });
    }
  },
  list: () => Array.from(get().skills.values()),
  get: (id) => get().skills.get(id),
  save: async (s) => {
    set((st) => { const next = new Map(st.skills); next.set(s.id, s); return { skills: next }; });
    await upsertSkill(s);
  },
  remove: async (id) => {
    set((st) => { const next = new Map(st.skills); next.delete(id); return { skills: next }; });
    await deleteSkill(id);
  },
}));
```

Create `src/store/providersStore.ts` (seeds the builtin Anthropic provider if absent):

```typescript
import { create } from "zustand";
import { listProviders, upsertProvider, deleteProvider } from "@/lib/agentsDb";
import { BUILTIN_PROVIDER } from "@/features/agents/seedData";
import type { Provider } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

type ProvidersState = {
  providers: Provider[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (p: Provider) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  load: async () => {
    try {
      let rows = await listProviders();
      if (!rows.some((p) => p.id === BUILTIN_PROVIDER.id)) {
        await upsertProvider(BUILTIN_PROVIDER);
        rows = await listProviders();
      }
      set({ providers: rows, loaded: true });
    } catch (e) {
      log.warn("providers load failed", e);
      set({ loaded: true });
    }
  },
  save: async (p) => { await upsertProvider(p); set({ providers: await listProviders() }); },
  remove: async (id) => { await deleteProvider(id); set({ providers: get().providers.filter((p) => p.id !== id) }); },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/agentsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Hydrate on boot**

In `src/app/App.tsx`, where other stores hydrate (near the `useModelPrefs` / `useMcpServers` load calls), add:

```typescript
void useProvidersStore.getState().load();
void useSkillsStore.getState().load();
void useAgentsStore.getState().load();
```

(with the matching imports at the top of App.tsx).

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run src/store/agentsStore.test.ts`
Expected: clean + PASS.

```bash
git add src/store/providersStore.ts src/store/skillsStore.ts src/store/agentsStore.ts src/store/agentsStore.test.ts src/app/App.tsx
git commit -m "feat(agents): providers/skills/agents stores + boot seed + hydrate"
```

---

## Milestone D — Unified dropdown + send-site resolver

### Task 11: `ModelSelect` grouped picker (models + Your Agents)

**Files:**
- Modify: `src/components/ModelSelect.tsx`

- [ ] **Step 1: Rewrite ModelSelect as a grouped picker**

Replace `src/components/ModelSelect.tsx` with:

```typescript
import { useModelPrefs, type ModelSurface } from "@/store/modelPrefsStore";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { useProvidersStore } from "@/store/providersStore";
import { useAgentsStore } from "@/store/agentsStore";
import { formatAgentValue } from "@/features/agents/agentValue";

export function ModelSelect({ surface }: { surface: ModelSurface }) {
  const value = useModelPrefs((s) => s.models[surface]) || DEFAULT_MODEL_ID;
  const setModel = useModelPrefs((s) => s.setModel);
  const providers = useProvidersStore((s) => s.providers);
  const agents = useAgentsStore((s) => Array.from(s.agents.values()));

  return (
    <select
      className="ot-model-select"
      value={value}
      title="Model or agent for this assistant"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setModel(surface, e.target.value)}
    >
      {providers.map((p) => (
        <optgroup key={p.id} label={p.builtin ? p.name : `${p.name} — needs runtime`}>
          {p.models.map((m) => (
            <option key={`${p.id}/${m.id}`} value={m.id} disabled={!p.builtin}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
      {agents.length > 0 && (
        <optgroup label="Your Agents">
          {agents.map((a) => (
            <option key={a.id} value={formatAgentValue(a.id)}>
              {a.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
```

- [ ] **Step 2: Verify it typechecks + existing tests stay green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; full suite green (non-Claude options are `disabled`; agents only appear when present).

- [ ] **Step 3: Commit**

```bash
git add src/components/ModelSelect.tsx
git commit -m "feat(dropdown): grouped model picker (providers + Your Agents)"
```

---

### Task 12: Resolve the selection at the Claude send sites

**Files:**
- Create: `src/features/agents/resolveSend.ts`
- Test: `src/features/agents/resolveSend.test.ts`
- Modify: each `ipc.claudeSend(...)` call site (OrionClaudeRail, Archives rail, XDesign rail, ROSIE, ClaudeChat parent) to pass resolved params.

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/resolveSend.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveSend } from "./resolveSend";
import type { Agent, Skill } from "./agentTypes";

const agents: Agent[] = [{ id: "a1", name: "Atlas", role: "analyst", accent: "", avatarAssetId: null, avatarUrl: null, brainModel: "claude-sonnet-4-6", actionModel: "", skillIds: ["web"] }];
const skills: Skill[] = [{ id: "web", name: "Web Research", icon: "", accent: "", instructions: "search", tools: [{ kind: "builtin", name: "WebSearch" }], builtin: true }];

describe("resolveSend", () => {
  it("passes a plain model through with no agent params", () => {
    expect(resolveSend("claude-opus-4-8", agents, skills)).toEqual({ model: "claude-opus-4-8", systemAppend: null, allowedTools: null });
  });

  it("expands an agent value into model + system + tools", () => {
    const r = resolveSend("agent:a1", agents, skills);
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.systemAppend).toContain("analyst");
    expect(r.allowedTools).toEqual(["WebSearch"]);
  });

  it("falls back to the value as a model if the agent is missing", () => {
    expect(resolveSend("agent:ghost", agents, skills)).toEqual({ model: "agent:ghost", systemAppend: null, allowedTools: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agents/resolveSend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/agents/resolveSend.ts`:

```typescript
import { parseSelection } from "./agentValue";
import { composeAgent } from "./composeAgent";
import type { Agent, Skill } from "./agentTypes";

export type ResolvedSend = {
  model: string;
  systemAppend: string | null;
  allowedTools: string[] | null;
};

export function resolveSend(value: string, agents: Agent[], skills: Skill[]): ResolvedSend {
  const sel = parseSelection(value);
  if (sel.kind === "model") {
    return { model: sel.id, systemAppend: null, allowedTools: null };
  }
  const agent = agents.find((a) => a.id === sel.id);
  if (!agent) return { model: value, systemAppend: null, allowedTools: null };
  const c = composeAgent(agent, skills);
  return { model: c.model, systemAppend: c.appendSystemPrompt || null, allowedTools: c.allowedTools.length ? c.allowedTools : null };
}
```

Add a convenience selector to read live store state (used by call sites):

```typescript
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";

export function resolveSendFromStores(value: string): ResolvedSend {
  return resolveSend(value, Array.from(useAgentsStore.getState().agents.values()), useSkillsStore.getState().list());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agents/resolveSend.test.ts`
Expected: PASS.

- [ ] **Step 5: Update each send site**

At every `ipc.claudeSend(...)` call that currently passes `useModelPrefs.getState().modelFor(surface)` as the `model` arg (OrionClaudeRail, the Archives rail, XDesignClaudeRail, ROSIE), replace the single model arg with the resolved trio. Example for OrionClaudeRail:

```typescript
import { resolveSendFromStores } from "@/features/agents/resolveSend";
// ...
const r = resolveSendFromStores(useModelPrefs.getState().modelFor("orion"));
await ipc.claudeSend(chat.id, prompt, project.root_path, chat.sessionId, null, r.model, r.systemAppend, r.allowedTools);
```

(For Learn/RepoLens which use their own `_claude_call` commands, leave them as-is in Phase 1 — they pass a bare model; agent expansion there is a Phase 1 follow-on, noted in the spec.)

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green.

```bash
git add src/features/agents/resolveSend.ts src/features/agents/resolveSend.test.ts src/apps/orion/OrionClaudeRail.tsx src/apps/xdesign/XDesignClaudeRail.tsx src/features/rosie/Rosie.tsx
git commit -m "feat(agents): resolve agent selections into model+system+tools at send sites"
```

---

## Milestone E — Control Panel surface + sections

### Task 13: Control Panel surface shell + entry points

**Files:**
- Create: `src/store/controlPanelStore.ts`, `src/features/controlpanel/ControlPanel.tsx`, `src/features/controlpanel/controlpanel.css`
- Modify: `src/app/App.tsx` (mount), `src/commands/builtins.ts` (command + re-point ⌘,), `src/shell/MenuBar.tsx` + `src/shell/Dock.tsx` (entries)

- [ ] **Step 1: Write the store**

Create `src/store/controlPanelStore.ts`:

```typescript
import { create } from "zustand";

export type CpSection = "providers" | "agents" | "skills" | "key" | "theme" | "wallpaper" | "mcp" | "shortcuts" | "about";

type CpState = {
  open: boolean;
  section: CpSection;
  show: (section?: CpSection) => void;
  hide: () => void;
  setSection: (s: CpSection) => void;
};

export const useControlPanel = create<CpState>((set) => ({
  open: false,
  section: "providers",
  show: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  hide: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));
```

- [ ] **Step 2: Write the surface shell**

Create `src/features/controlpanel/ControlPanel.tsx`:

```typescript
import { useControlPanel, type CpSection } from "@/store/controlPanelStore";
import { ProvidersPanel } from "./ProvidersPanel";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import { AgentForge } from "./AgentForge";
import { X } from "lucide-react";
import "./controlpanel.css";

const NAV: { key: CpSection; label: string; icon: string }[] = [
  { key: "providers", label: "Providers", icon: "🧠" },
  { key: "agents", label: "Agent Forge", icon: "⚒" },
  { key: "skills", label: "Skill Library", icon: "📚" },
  { key: "key", label: "API Keys", icon: "🔑" },
  { key: "theme", label: "Appearance", icon: "🎨" },
  { key: "wallpaper", label: "Wallpaper", icon: "🖼" },
  { key: "mcp", label: "MCP Servers", icon: "🔌" },
  { key: "shortcuts", label: "Shortcuts", icon: "⌨" },
  { key: "about", label: "About", icon: "ℹ" },
];

export function ControlPanel() {
  const open = useControlPanel((s) => s.open);
  const section = useControlPanel((s) => s.section);
  const setSection = useControlPanel((s) => s.setSection);
  const hide = useControlPanel((s) => s.hide);
  if (!open) return null;

  return (
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="cp-surface" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="cp-rail">
          <div className="cp-rail-title">⌃ Control Panel</div>
          {NAV.map((n, i) => (
            <>
              {n.key === "key" && <div key="div" className="cp-rail-divider" />}
              <button
                key={n.key}
                className={`cp-rail-item${section === n.key ? " active" : ""}`}
                onClick={() => setSection(n.key)}
              >
                <span className="cp-rail-icon">{n.icon}</span>{n.label}
              </button>
            </>
          ))}
        </aside>
        <main className="cp-main">
          <header className="cp-main-head">
            <span>{NAV.find((n) => n.key === section)?.label}</span>
            <button className="icon-btn" onClick={hide}><X size={14} /></button>
          </header>
          <div className="cp-main-body">
            {section === "providers" && <ProvidersPanel />}
            {section === "agents" && <AgentForge />}
            {section === "skills" && <SkillLibraryPanel />}
            {/* existing settings sections wired in Task 17 */}
          </div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write minimal CSS**

Create `src/features/controlpanel/controlpanel.css`:

```css
.cp-overlay { position: fixed; inset: 0; z-index: 2400; display: grid; place-items: center; background: rgba(0,0,0,0.5); }
.cp-surface { width: min(1100px, 92vw); height: min(760px, 88vh); display: grid; grid-template-columns: 220px 1fr; background: var(--bg-1); border: 1px solid var(--glass-border); border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow-window); }
.cp-rail { background: var(--bg-0); padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.cp-rail-title { font: 600 12px var(--font-mono); letter-spacing: 2px; color: var(--neon-violet); padding: 6px 8px 12px; }
.cp-rail-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--r-sm); color: var(--t-secondary); background: none; border: none; text-align: left; font-size: 13px; cursor: pointer; }
.cp-rail-item:hover { background: var(--bg-2); color: var(--t-primary); }
.cp-rail-item.active { background: var(--bg-3); color: var(--t-primary); }
.cp-rail-icon { width: 18px; text-align: center; }
.cp-rail-divider { height: 1px; background: var(--glass-border); margin: 8px 6px; }
.cp-main { display: flex; flex-direction: column; min-width: 0; }
.cp-main-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--glass-border); font-weight: 600; }
.cp-main-body { flex: 1; overflow-y: auto; padding: 18px; }
```

- [ ] **Step 4: Mount + commands + entries**

In `src/app/App.tsx`, add `<ControlPanel />` next to `<SettingsPanel />`.

In `src/commands/builtins.ts`, add a command and re-point Settings:

```typescript
registry.register({
  id: "controlpanel.open",
  label: "Open Control Panel",
  hotkey: "mod+,",
  group: "View",
  run: () => useControlPanel.getState().show(),
});
```

Remove (or change the hotkey on) the old `settings.open` registration so `mod+,` maps to the Control Panel (keep `settings.open` registered without a hotkey if other code references it, pointing its `run` at `useControlPanel.getState().show("theme")`).

In `src/shell/MenuBar.tsx`, add a "Control Panel…" item to the app menu that calls `useControlPanel.getState().show()`. In `src/shell/Dock.tsx`, add a Control Panel button (gear/sliders icon) that calls the same.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green (ProvidersPanel/SkillLibraryPanel/AgentForge are created in the next tasks — create empty stub components returning `null` first so this task compiles, then flesh out).

Stub creation before compiling:
```typescript
// src/features/controlpanel/ProvidersPanel.tsx
export function ProvidersPanel() { return null; }
// src/features/controlpanel/SkillLibraryPanel.tsx
export function SkillLibraryPanel() { return null; }
// src/features/controlpanel/AgentForge.tsx
export function AgentForge() { return null; }
```

```bash
git add src/store/controlPanelStore.ts src/features/controlpanel/ControlPanel.tsx src/features/controlpanel/controlpanel.css src/features/controlpanel/ProvidersPanel.tsx src/features/controlpanel/SkillLibraryPanel.tsx src/features/controlpanel/AgentForge.tsx src/app/App.tsx src/commands/builtins.ts src/shell/MenuBar.tsx src/shell/Dock.tsx
git commit -m "feat(control-panel): surface shell, rail, entry points (dock/menubar/cmd)"
```

---

### Task 14: Providers section UI

**Files:**
- Modify: `src/features/controlpanel/ProvidersPanel.tsx`

- [ ] **Step 1: Implement the providers list + add form**

Replace `src/features/controlpanel/ProvidersPanel.tsx`:

```typescript
import { useState } from "react";
import { ulid } from "ulid";
import { useProvidersStore } from "@/store/providersStore";
import { ipc } from "@/lib/ipc";
import type { Provider, ProviderKind } from "@/features/agents/agentTypes";

const KINDS: ProviderKind[] = ["openai", "google", "openai_compat", "custom"];

export function ProvidersPanel() {
  const providers = useProvidersStore((s) => s.providers);
  const save = useProvidersStore((s) => s.save);
  const remove = useProvidersStore((s) => s.remove);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="cp-list">
        {providers.map((p) => (
          <div key={p.id} className="cp-card">
            <div className="cp-card-main">
              <div className="cp-card-title">{p.name}</div>
              <div className="cp-card-sub">{p.kind}{p.models.length ? ` · ${p.models.length} models` : ""}</div>
            </div>
            {p.builtin
              ? <span className="cp-badge live">live ✓</span>
              : <span className="cp-badge wait">needs runtime</span>}
            {!p.builtin && <button className="cp-link-danger" onClick={() => remove(p.id)}>Remove</button>}
          </div>
        ))}
      </div>
      {adding
        ? <AddProvider onDone={() => setAdding(false)} onSave={save} />
        : <button className="cp-btn" onClick={() => setAdding(true)}>+ Add provider</button>}
    </div>
  );
}

function AddProvider({ onDone, onSave }: { onDone: () => void; onSave: (p: Provider) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");
  const [key, setKey] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    const id = ulid();
    const keyRef = key.trim() ? id : "";
    if (keyRef) await ipc.providerKeySet(keyRef, key.trim());
    await onSave({
      id, name: name.trim(), kind, baseUrl: baseUrl.trim(),
      models: models.split(",").map((m) => m.trim()).filter(Boolean).map((m) => ({ id: m, label: m })),
      keyRef, enabled: true, builtin: false,
    });
    onDone();
  };

  return (
    <div className="cp-form">
      <input className="cp-input" placeholder="Name (e.g. OpenAI)" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="cp-input" value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <input className="cp-input" placeholder="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <input className="cp-input" placeholder="Models, comma-separated (e.g. gpt-5, gpt-5-mini)" value={models} onChange={(e) => setModels(e.target.value)} />
      <input className="cp-input" type="password" placeholder="API key (stored in keychain)" value={key} onChange={(e) => setKey(e.target.value)} />
      <div className="cp-form-actions">
        <button className="cp-btn ghost" onClick={onDone}>Cancel</button>
        <button className="cp-btn" onClick={submit}>Add</button>
      </div>
    </div>
  );
}
```

Append to `controlpanel.css`:

```css
.cp-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.cp-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--bg-2); border: 1px solid var(--glass-border); border-radius: var(--r-md); }
.cp-card-main { flex: 1; min-width: 0; }
.cp-card-title { font-weight: 600; }
.cp-card-sub { font-size: 11px; color: var(--t-tertiary); }
.cp-badge { font-size: 10px; padding: 3px 8px; border-radius: var(--r-pill); }
.cp-badge.live { color: var(--neon-green); border: 1px solid var(--neon-green); }
.cp-badge.wait { color: var(--neon-yellow); border: 1px solid var(--neon-yellow); }
.cp-btn { padding: 8px 14px; border-radius: var(--r-sm); background: var(--neon-violet); color: var(--bg-0); border: none; font-weight: 600; cursor: pointer; }
.cp-btn.ghost { background: transparent; color: var(--t-secondary); border: 1px solid var(--glass-border); }
.cp-link-danger { background: none; border: none; color: var(--neon-magenta); cursor: pointer; font-size: 12px; }
.cp-form { display: flex; flex-direction: column; gap: 8px; padding: 14px; background: var(--bg-2); border-radius: var(--r-md); }
.cp-input { padding: 8px 10px; background: var(--bg-0); border: 1px solid var(--glass-border); border-radius: var(--r-sm); color: var(--t-primary); }
.cp-form-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green.

```bash
git add src/features/controlpanel/ProvidersPanel.tsx src/features/controlpanel/controlpanel.css
git commit -m "feat(control-panel): Providers section — list + add (key to keychain)"
```

---

### Task 15: Skill Library section + Skill editor

**Files:**
- Modify: `src/features/controlpanel/SkillLibraryPanel.tsx`
- Create: `src/features/controlpanel/SkillEditor.tsx`

- [ ] **Step 1: Implement the library grid**

Replace `src/features/controlpanel/SkillLibraryPanel.tsx`:

```typescript
import { useState } from "react";
import { ulid } from "ulid";
import { useSkillsStore } from "@/store/skillsStore";
import type { Skill } from "@/features/agents/agentTypes";
import { SkillEditor } from "./SkillEditor";

export function SkillLibraryPanel() {
  const skills = useSkillsStore((s) => s.list());
  const [editing, setEditing] = useState<Skill | null>(null);

  const newSkill = (): Skill => ({ id: ulid(), name: "New Skill", icon: "✨", accent: "#b14cff", instructions: "", tools: [], builtin: false });
  const duplicate = (s: Skill): Skill => ({ ...s, id: ulid(), name: `${s.name} (copy)`, builtin: false });

  if (editing) return <SkillEditor skill={editing} onClose={() => setEditing(null)} />;

  return (
    <div>
      <div className="cp-skill-grid">
        {skills.map((s) => (
          <button key={s.id} className="cp-skill-tile" style={{ borderColor: s.accent || "var(--glass-border)" }}
            onClick={() => setEditing(s.builtin ? duplicate(s) : s)} title={s.builtin ? "Built-in — opens a customizable copy" : "Edit"}>
            <span className="cp-skill-icon">{s.icon || "✨"}</span>
            <span className="cp-skill-name">{s.name}</span>
            {s.builtin && <span className="cp-skill-flag">built-in</span>}
          </button>
        ))}
      </div>
      <button className="cp-btn" onClick={() => setEditing(newSkill())}>+ New skill</button>
    </div>
  );
}
```

Append CSS:

```css
.cp-skill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
.cp-skill-tile { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px; background: var(--bg-2); border: 1.5px solid var(--glass-border); border-radius: var(--r-md); cursor: pointer; color: var(--t-primary); }
.cp-skill-icon { font-size: 24px; }
.cp-skill-name { font-size: 12px; text-align: center; }
.cp-skill-flag { font-size: 9px; color: var(--t-tertiary); }
```

- [ ] **Step 2: Implement the editor**

Create `src/features/controlpanel/SkillEditor.tsx`:

```typescript
import { useState } from "react";
import { useSkillsStore } from "@/store/skillsStore";
import { useMcpServers } from "@/store/mcpServersStore";
import { BUILTIN_TOOLS } from "@/features/agents/toolCatalog";
import type { Skill, ToolGrant } from "@/features/agents/agentTypes";

function hasGrant(tools: ToolGrant[], g: ToolGrant): boolean {
  return tools.some((t) => (t.kind === "builtin" && g.kind === "builtin" && t.name === g.name) || (t.kind === "mcp" && g.kind === "mcp" && t.server === g.server));
}

export function SkillEditor({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const save = useSkillsStore((s) => s.save);
  const remove = useSkillsStore((s) => s.remove);
  const mcp = useMcpServers((s) => s.servers.filter((x) => x.enabled));
  const [draft, setDraft] = useState<Skill>(skill);

  const toggle = (g: ToolGrant) =>
    setDraft((d) => ({ ...d, tools: hasGrant(d.tools, g) ? d.tools.filter((t) => !hasGrant([t], g)) : [...d.tools, g] }));

  return (
    <div className="cp-form">
      <div className="cp-form-row">
        <input className="cp-input" style={{ width: 64 }} value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
        <input className="cp-input" style={{ flex: 1 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <textarea className="cp-input" rows={6} placeholder="Instructions appended to the agent's system prompt…" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
      <div className="cp-label">Granted tools</div>
      <div className="cp-tool-grid">
        {BUILTIN_TOOLS.map((t) => {
          const g: ToolGrant = { kind: "builtin", name: t.name };
          return <label key={t.name} className="cp-tool"><input type="checkbox" checked={hasGrant(draft.tools, g)} onChange={() => toggle(g)} />{t.label}</label>;
        })}
        {mcp.map((s) => {
          const g: ToolGrant = { kind: "mcp", server: s.name };
          return <label key={s.id} className="cp-tool"><input type="checkbox" checked={hasGrant(draft.tools, g)} onChange={() => toggle(g)} />MCP: {s.name}</label>;
        })}
      </div>
      <div className="cp-form-actions">
        {!skill.builtin && <button className="cp-link-danger" onClick={() => { void remove(draft.id); onClose(); }}>Delete</button>}
        <button className="cp-btn ghost" onClick={onClose}>Cancel</button>
        <button className="cp-btn" onClick={() => { void save(draft); onClose(); }}>Save skill</button>
      </div>
    </div>
  );
}
```

Append CSS:

```css
.cp-form-row { display: flex; gap: 8px; }
.cp-label { font-size: 11px; color: var(--t-tertiary); text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; }
.cp-tool-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.cp-tool { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t-secondary); }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green.

```bash
git add src/features/controlpanel/SkillLibraryPanel.tsx src/features/controlpanel/SkillEditor.tsx src/features/controlpanel/controlpanel.css
git commit -m "feat(control-panel): Skill Library grid + skill editor (instructions + tools)"
```

---

### Task 16: Agent Forge (inventory UI) + avatar picker

**Files:**
- Modify: `src/features/controlpanel/AgentForge.tsx`

- [ ] **Step 1: Implement the forge**

Replace `src/features/controlpanel/AgentForge.tsx`:

```typescript
import { useState } from "react";
import { ulid } from "ulid";
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useProvidersStore } from "@/store/providersStore";
import type { Agent } from "@/features/agents/agentTypes";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

const ACCENTS = ["#b14cff", "#00e0ff", "#39ff88", "#e6ff3a", "#ff3ea5"];

function blank(): Agent {
  return { id: ulid(), name: "New Agent", role: "", accent: "#b14cff", avatarAssetId: null, avatarUrl: null, brainModel: "claude-opus-4-8", actionModel: "", skillIds: [] };
}

export function AgentForge() {
  const agents = useAgentsStore((s) => s.list());
  const skills = useSkillsStore((s) => s.list());
  const save = useAgentsStore((s) => s.save);
  const remove = useAgentsStore((s) => s.remove);
  const providers = useProvidersStore((s) => s.providers);
  const runnableModels = providers.filter((p) => p.builtin).flatMap((p) => p.models);
  const [draft, setDraft] = useState<Agent>(blank());

  const equipped = new Set(draft.skillIds);
  const toggleSkill = (id: string) =>
    setDraft((d) => ({ ...d, skillIds: equipped.has(id) ? d.skillIds.filter((x) => x !== id) : [...d.skillIds, id] }));

  const pickAvatar = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof path === "string") setDraft({ ...draft, avatarUrl: `asset://localhost/${path}`, avatarAssetId: null });
  };

  return (
    <div className="forge">
      <div className="forge-grid">
        {/* Equipment column */}
        <div className="forge-equip">
          <div className="forge-eyebrow">EQUIPMENT</div>
          <div className="forge-slot brain">
            <div className="forge-slot-label">🧠 BRAIN · THINKS</div>
            <select className="cp-input" value={draft.brainModel} onChange={(e) => setDraft({ ...draft, brainModel: e.target.value })}>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="forge-slot action">
            <div className="forge-slot-label">⚡ ACTION · DOES <span className="forge-hint">(wires up in a later update)</span></div>
            <select className="cp-input" value={draft.actionModel} onChange={(e) => setDraft({ ...draft, actionModel: e.target.value })}>
              <option value="">same as brain</option>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Center: the agent */}
        <div className="forge-center">
          <button className="forge-portrait" style={{ borderColor: draft.accent }} onClick={pickAvatar} title="Choose a portrait image">
            {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : <span>＋ image</span>}
          </button>
          <input className="cp-input forge-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="cp-input forge-role" placeholder="role / tagline" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <div className="forge-accents">
            {ACCENTS.map((c) => <button key={c} className={`forge-dot${draft.accent === c ? " on" : ""}`} style={{ background: c }} onClick={() => setDraft({ ...draft, accent: c })} />)}
          </div>
          <div className="forge-eyebrow">EQUIPPED SKILLS · {draft.skillIds.length}</div>
          <div className="forge-equipped">
            {draft.skillIds.map((id) => { const s = skills.find((x) => x.id === id); return s ? <span key={id} className="forge-chip" style={{ borderColor: s.accent }} onClick={() => toggleSkill(id)}>{s.icon} {s.name} ✕</span> : null; })}
          </div>
        </div>

        {/* Right: skill inventory */}
        <div className="forge-inv">
          <div className="forge-eyebrow">SKILL INVENTORY</div>
          <div className="cp-skill-grid">
            {skills.map((s) => (
              <button key={s.id} className={`cp-skill-tile${equipped.has(s.id) ? " on" : ""}`} style={{ borderColor: equipped.has(s.id) ? s.accent : "var(--glass-border)" }} onClick={() => toggleSkill(s.id)}>
                <span className="cp-skill-icon">{s.icon || "✨"}</span>
                <span className="cp-skill-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="forge-bar">
        <div className="forge-summary">🧠 {draft.brainModel.replace("claude-", "")} · ⚡ {(draft.actionModel || draft.brainModel).replace("claude-", "")} · 📚 {draft.skillIds.length} skills</div>
        <button className="cp-btn" onClick={() => { void save(draft); setDraft(blank()); }}>⚒ Forge Agent</button>
      </div>

      {agents.length > 0 && (
        <div className="forge-saved">
          <div className="forge-eyebrow">YOUR AGENTS</div>
          {agents.map((a) => (
            <div key={a.id} className="cp-card">
              <div className="cp-card-main"><div className="cp-card-title">{a.name}</div><div className="cp-card-sub">{a.role || "—"}</div></div>
              <button className="cp-link-danger" onClick={() => setDraft(a)}>Edit</button>
              <button className="cp-link-danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Append CSS:

```css
.forge-grid { display: grid; grid-template-columns: 180px 1fr 240px; gap: 16px; }
.forge-eyebrow { font: 600 9px var(--font-mono); letter-spacing: 2px; color: var(--t-tertiary); margin: 6px 0; }
.forge-equip { display: flex; flex-direction: column; gap: 12px; }
.forge-slot { padding: 10px; border-radius: var(--r-md); background: var(--bg-2); border: 1.5px solid var(--glass-border); }
.forge-slot.brain { border-color: var(--neon-violet); box-shadow: 0 0 16px -6px var(--neon-violet); }
.forge-slot.action { border-color: var(--neon-green); box-shadow: 0 0 16px -6px var(--neon-green); }
.forge-slot-label { font-size: 9px; letter-spacing: 1px; margin-bottom: 6px; color: var(--t-secondary); }
.forge-hint { color: var(--t-tertiary); }
.forge-center { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.forge-portrait { width: 120px; height: 120px; border-radius: 24px; border: 1.5px solid; background: var(--bg-3); color: var(--t-tertiary); cursor: pointer; overflow: hidden; display: grid; place-items: center; }
.forge-portrait img { width: 100%; height: 100%; object-fit: cover; }
.forge-name { text-align: center; font-size: 16px; }
.forge-role { text-align: center; font-size: 12px; }
.forge-accents { display: flex; gap: 6px; }
.forge-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.forge-dot.on { border-color: var(--t-primary); }
.forge-equipped { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; }
.forge-chip { padding: 4px 8px; border-radius: var(--r-pill); border: 1px solid; font-size: 11px; cursor: pointer; }
.cp-skill-tile.on { background: var(--bg-3); }
.forge-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--glass-border); }
.forge-summary { font-size: 11px; color: var(--t-secondary); }
.forge-saved { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green. (Note: confirm `@tauri-apps/plugin-dialog`'s `open` is the dialog import already used elsewhere — if the project uses a different dialog import path, match it.)

```bash
git add src/features/controlpanel/AgentForge.tsx src/features/controlpanel/controlpanel.css
git commit -m "feat(control-panel): Agent Forge inventory UI + portrait picker"
```

---

### Task 17: Fold existing settings sections into the Control Panel

**Files:**
- Modify: `src/features/settings/SettingsPanel.tsx` (export the section components)
- Modify: `src/features/controlpanel/ControlPanel.tsx` (render them)

- [ ] **Step 1: Export the section components**

In `src/features/settings/SettingsPanel.tsx`, the section render functions (e.g. `KeySection`, `AppearanceSection`, `WallpaperSection`, `McpSection`, `ShortcutsSection`, `AboutSection`) are currently internal. Add `export` to each function declaration so they can be reused. Do not otherwise change them.

- [ ] **Step 2: Render them in the Control Panel body**

In `src/features/controlpanel/ControlPanel.tsx`, import the sections and extend the body switch:

```typescript
import { KeySection, AppearanceSection, WallpaperSection, McpSection, ShortcutsSection, AboutSection } from "@/features/settings/SettingsPanel";
// ...
{section === "key" && <KeySection />}
{section === "theme" && <AppearanceSection />}
{section === "wallpaper" && <WallpaperSection />}
{section === "mcp" && <McpSection />}
{section === "shortcuts" && <ShortcutsSection />}
{section === "about" && <AboutSection />}
```

If a section function takes props (e.g. local state setters from the old panel), refactor only as far as needed to make it self-contained (lift any required local state into the section component itself). Keep changes minimal.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean, green, build exit 0.

```bash
git add src/features/settings/SettingsPanel.tsx src/features/controlpanel/ControlPanel.tsx
git commit -m "feat(control-panel): fold existing Settings sections into the Control Panel"
```

---

## Milestone F — Verify & finish

### Task 18: Full gate run + manual smoke checklist

**Files:** none (verification only)

- [ ] **Step 1: Run all gates**

```bash
npx tsc --noEmit
npx vitest run
cd src-tauri && cargo test && cargo check && cd ..
npm run build
```
Expected: tsc clean · full vitest green (incl. ~30 new agent tests) · cargo tests pass · build exit 0.

- [ ] **Step 2: Write the smoke checklist into the session log**

Add a `## Session log` entry to `CLAUDE.md` summarizing the feature, noting **a `tauri dev` restart is required** (migration 0026 + new Rust commands + `claude_send` signature change), and listing the manual smoke steps:

1. Restart `tauri dev`. Open the Control Panel (⌘, / dock / menubar / Spotlight "Open Control Panel"). All prior Settings sections present and working.
2. Providers → Add provider (e.g. OpenAI, a fake key) → it appears badged "needs runtime"; its models show greyed/disabled in a `ModelSelect`.
3. Skill Library → seeded skills present → create a custom skill (instructions + a couple of tool grants) → Save → it appears.
4. Agent Forge → pick a portrait image, name it, choose a Brain model, equip 1–2 skills → Forge Agent → it appears under "Your Agents".
5. Open any chat rail → the model dropdown shows "Your Agents" → select the agent → send a prompt → it runs (on the brain model, with the skill instructions + tools in effect).
6. Select a plain Claude model → behaves exactly as before.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Control Panel + Agent Forge Phase 1 session log + smoke checklist"
```

---

## Self-review notes (addressed)

- **Spec coverage:** Control Panel surface (T13, T17) · Provider Registry (T1, T6, T8, T10, T14) · Skill Library seeded+custom (T7, T10, T15) · Agent Forge inventory + custom portrait (T16) · unified dropdown (T11) · agent execution via composeAgent on the Claude path (T5, T9, T12) · non-regression (T9 test + T11/T12 untagged passthrough) · keychain keys (T8) · migration 0026 (T1). All spec sections map to a task.
- **Non-regression guarantee:** `agent_args(None, None)` is empty (T9 test); `resolveSend` returns `{systemAppend:null, allowedTools:null}` for plain model ids (T12 test); `claude_send`'s new params are optional. A plain Claude selection produces identical CLI args.
- **Type consistency:** `Provider`/`Skill`/`Agent`/`ToolGrant`/`ComposedAgent`/`Selection`/`ResolvedSend` are defined once (T2, T3, T5, T12) and reused verbatim. `composeAgent` returns `{model, appendSystemPrompt, allowedTools}`; `resolveSend` maps it to `{model, systemAppend, allowedTools}` for the ipc wrapper — names intentional and consistent across T5/T9/T12.
- **Deferred (per spec):** non-Claude execution, provider-agnostic runtime (Phase 2); literal Brain→Action routing (Phase 3); Learn/RepoLens agent expansion + Hermes custom-agent picker (Phase 1 follow-ons).
