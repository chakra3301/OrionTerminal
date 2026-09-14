import type { Provider } from "./agentTypes";

const PREFIX = "provider:";

export function providerModelValue(providerId: string, modelId: string): string {
  return `${PREFIX}${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;
}

export function parseModelValue(value: string): { providerId?: string; modelId: string } {
  if (!value.startsWith(PREFIX)) return { modelId: value };
  const parts = value.slice(PREFIX.length).split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid model selection. Choose a model again.");
  try {
    return { providerId: decodeURIComponent(parts[0]), modelId: decodeURIComponent(parts[1]) };
  } catch {
    throw new Error("Invalid model selection. Choose a model again.");
  }
}

export function owningProvider(providers: Provider[], value: string): Provider | undefined {
  const { providerId, modelId } = parseModelValue(value);
  const matches = providers.filter((p) => p.enabled && (!providerId || p.id === providerId) && p.models.some((m) => m.id === modelId));
  if (matches.length > 1) throw new Error(`“${modelId}” belongs to multiple providers. Choose its provider in the model selector.`);
  return matches[0];
}

export function selectedModelValue(providers: Provider[], value: string): string {
  if (value.startsWith("agent:")) return value;
  try {
    const owner = owningProvider(providers, value);
    return owner ? providerModelValue(owner.id, parseModelValue(value).modelId) : value;
  } catch {
    return value;
  }
}
