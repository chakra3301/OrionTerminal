export type ProviderKind =
  | "anthropic" | "openai" | "google" | "openai_compat" | "custom"
  | "codex_cli" | "gemini_cli" | "nous_oauth";

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
