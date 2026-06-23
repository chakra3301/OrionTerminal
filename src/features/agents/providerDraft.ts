import type { ProviderKind } from "@/features/agents/agentTypes";

/** A known OpenAI-compatible provider preset: fills the base URL (and steers
 *  the model-id format) so users don't misroute a key to api.openai.com. */
export type ProviderPreset = {
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Example model id in this provider's namespace. */
  exampleModel: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: "NVIDIA",
    kind: "openai_compat",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    exampleModel: "nvidia/nvidia-nemotron-3-ultra-550b-a55b",
  },
  {
    label: "NousResearch",
    kind: "nous_oauth",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    exampleModel: "nvidia/nemotron-3-ultra-550b-a55b",
  },
  {
    label: "Groq",
    kind: "openai_compat",
    baseUrl: "https://api.groq.com/openai/v1",
    exampleModel: "llama-3.3-70b-versatile",
  },
  {
    label: "Together",
    kind: "openai_compat",
    baseUrl: "https://api.together.xyz/v1",
    exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    label: "OpenRouter",
    kind: "openai_compat",
    baseUrl: "https://openrouter.ai/api/v1",
    exampleModel: "anthropic/claude-sonnet-4",
  },
  {
    label: "Ollama (local)",
    kind: "openai_compat",
    baseUrl: "http://localhost:11434/v1",
    exampleModel: "llama3.2",
  },
];

/** Only "openai" (and the CLI engines) have a safe implicit endpoint. Every
 *  other HTTP kind MUST carry an explicit base URL or the runtime silently
 *  falls back to api.openai.com and rejects a foreign key with a confusing
 *  401. */
export function requiresBaseUrl(kind: ProviderKind): boolean {
  return (
    kind === "openai_compat" ||
    kind === "custom" ||
    kind === "google" ||
    kind === "nous_oauth"
  );
}

/** Nous Portal authenticates via OAuth device-code, not a pasted API key. */
export function usesOAuth(kind: ProviderKind): boolean {
  return kind === "nous_oauth";
}

export type ProviderDraft = {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
};

/** Returns an error string when the draft is unsendable, else null. */
export function validateProviderDraft(d: ProviderDraft): string | null {
  if (!d.name.trim()) return "Name is required.";
  if (requiresBaseUrl(d.kind) && !d.baseUrl.trim()) {
    return "Base URL is required for this provider kind (e.g. https://integrate.api.nvidia.com/v1).";
  }
  return null;
}
