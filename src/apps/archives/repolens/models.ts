import { MODELS } from "@/lib/models";
import type { RepoLensModelConfig } from "./types";

// The scan parts that can be routed to a specific model. Anthropic-only —
// RepoLens drives the local `claude` CLI, so the catalog reuses the app's
// canonical model list.
export const PARTS: { id: string; label: string }[] = [
  { id: "core", label: "Core scan" },
  { id: "deepdive", label: "Deep Dive" },
  { id: "sktpg", label: "SKTPG" },
  { id: "synergies", label: "Synergies" },
  { id: "versus", label: "Versus" },
  { id: "lens", label: "Framework Lens" },
  { id: "retag", label: "Re-tag" },
];

export const REPOLENS_MODELS = MODELS;

export function defaultModelConfig(): RepoLensModelConfig {
  return { default_model: "claude-sonnet-4-6", per_part: {} };
}

/** Resolve which model a given part should run on. Absent/"default" → the global default. */
export function modelFor(cfg: RepoLensModelConfig, part: string): string {
  const m = cfg.per_part[part];
  return m && m !== "default" ? m : cfg.default_model;
}
