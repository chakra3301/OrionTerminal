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
