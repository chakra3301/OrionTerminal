import { parseModelValue } from "@/features/agents/modelSelection";

// Canonical list of models any interactive Claude surface can run on. Ids must
// match the CLI `--model` values; an empty stored value means "use default".
export type ModelDef = { id: string; label: string; short: string };

export const MODELS: ModelDef[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", short: "opus-4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5", short: "sonnet-5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", short: "sonnet-4.6" },
  { id: "claude-fable-5", label: "Fable 5", short: "fable-5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", short: "haiku-4.5" },
];

export const DEFAULT_MODEL_ID = "claude-opus-4-8";

function rawModel(id: string): string {
  if (!id) return DEFAULT_MODEL_ID;
  try { return parseModelValue(id).modelId; } catch { return id; }
}

export function modelLabel(id: string): string {
  const raw = rawModel(id);
  return MODELS.find((m) => m.id === raw)?.label ?? raw;
}
export function modelShort(id: string): string {
  const raw = rawModel(id);
  return MODELS.find((m) => m.id === raw)?.short ?? raw;
}
