// Canonical list of models any interactive Claude surface can run on. Ids must
// match the CLI `--model` values; an empty stored value means "use default".
export type ModelDef = { id: string; label: string; short: string };

export const MODELS: ModelDef[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", short: "opus-4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", short: "sonnet-4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", short: "haiku-4.5" },
];

export const DEFAULT_MODEL_ID = "claude-opus-4-8";

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? "Opus 4.8";
}
export function modelShort(id: string): string {
  return MODELS.find((m) => m.id === id)?.short ?? "opus-4.8";
}
