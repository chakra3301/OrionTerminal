import { MODELS } from "@/lib/models";
import type { Provider } from "@/features/agents/agentTypes";
import type { RepoLensModelConfig } from "./types";
import { owningProvider, providerModelValue, selectedModelValue } from "@/features/agents/modelSelection";

// The scan parts that can be routed to a specific model.
export const PARTS: { id: string; label: string }[] = [
  { id: "core", label: "Core scan" },
  { id: "deepdive", label: "Deep Dive" },
  { id: "sktpg", label: "SKTPG" },
  { id: "synergies", label: "Synergies" },
  { id: "versus", label: "Versus" },
  { id: "lens", label: "Framework Lens" },
  { id: "combinator", label: "Combinator" },
  { id: "retag", label: "Re-tag" },
];

export const REPOLENS_MODELS = MODELS;

export type RepoLensModelGroup = {
  id: string;
  label: string;
  models: { id: string; label: string }[];
};

export type RepoLensCapability = "analysis" | "website-agent";

export function repoLensModelGroups(
  providers: Provider[],
  capability: RepoLensCapability = "analysis",
): RepoLensModelGroup[] {
  return providers
    .filter((provider) =>
      provider.enabled &&
      provider.models.length > 0 &&
      (capability === "analysis" ||
        provider.kind === "anthropic" ||
        provider.kind === "codex_cli"),
    )
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      models: provider.models.map((model) => ({ ...model, id: providerModelValue(provider.id, model.id) })),
    }));
}

export function availableRepoLensModel(
  providers: Provider[],
  selected: string,
  capability: RepoLensCapability = "analysis",
): string {
  const value = selectedModelValue(providers, selected);
  const groups = repoLensModelGroups(providers, capability);
  return groups.some((group) => group.models.some((model) => model.id === value)) ? value : selected;
}

export function websiteModelSelection(providers: Provider[], selected: string | null): string {
  if (!selected) throw new Error("Choose a website agent model.");
  const provider = owningProvider(providers, selected);
  if (!provider) throw new Error("The selected website model is unavailable. Choose an enabled provider.");
  if (provider.kind !== "anthropic" && provider.kind !== "codex_cli") {
    throw new Error("Website reconstruction currently requires Claude or Codex. Choose a supported connector explicitly.");
  }
  return selectedModelValue(providers, selected);
}

export function defaultModelConfig(): RepoLensModelConfig {
  return { default_model: "claude-sonnet-4-6", per_part: {} };
}

/** Resolve which model a given part should run on. Absent/"default" → the global default. */
export function modelFor(cfg: RepoLensModelConfig, part: string): string {
  const m = cfg.per_part[part];
  return m && m !== "default" ? m : cfg.default_model;
}
