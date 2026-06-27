import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { orionClaude } from "@/apps/orion/claude";
import { archivesClaude } from "@/apps/archives/claude";
import { xdesignClaude } from "@/apps/xdesign/claude";
import type { ToolGrant } from "@/features/agents/agentTypes";
import { useSkillsStore } from "@/store/skillsStore";

export type AppId = "orion" | "archives" | "xdesign";

// The shipped identity for each app's embedded Claude. These are the reset
// targets — overrides in AppConfig win when present.
export const APP_DEFAULTS: Record<AppId, {
  name: string;
  subtitle: string;
  accentColor: string;
  systemPrompt: string;
  openingLine: string;
  suggestionChips: string[];
}> = {
  orion: {
    name: orionClaude.name,
    subtitle: orionClaude.subtitle,
    accentColor: orionClaude.accentColor,
    systemPrompt: orionClaude.systemPrompt,
    openingLine: orionClaude.openingLine,
    suggestionChips: orionClaude.suggestionChips,
  },
  archives: {
    name: archivesClaude.name,
    subtitle: archivesClaude.subtitle,
    accentColor: archivesClaude.accentColor,
    systemPrompt: archivesClaude.systemPrompt,
    openingLine: archivesClaude.openingLine,
    suggestionChips: archivesClaude.suggestionChips,
  },
  xdesign: {
    name: xdesignClaude.name,
    subtitle: xdesignClaude.subtitle,
    accentColor: xdesignClaude.accentColor,
    systemPrompt: xdesignClaude.systemPrompt,
    openingLine: xdesignClaude.openingLine,
    suggestionChips: xdesignClaude.suggestionChips,
  },
};

// Undefined override fields fall back to the default. Enabled flags gate
// whether a piece is applied at all; skills/tools are additive grants.
export type AppConfig = {
  name?: string;
  subtitle?: string;
  systemPrompt?: string;
  systemPromptEnabled: boolean;
  openingLine?: string;
  openingLineEnabled: boolean;
  chips?: string[];
  chipsEnabled: boolean;
  skillIds: string[];
  tools?: ToolGrant[];
  toolsCustomized: boolean;
};

export type ResolvedAppConfig = {
  name: string;
  subtitle: string;
  accentColor: string;
  systemPrompt: string;
  systemPromptEnabled: boolean;
  openingLine: string;
  openingLineEnabled: boolean;
  chips: string[];
  chipsEnabled: boolean;
  skillIds: string[];
  tools: ToolGrant[];
  toolsCustomized: boolean;
};

function blankConfig(): AppConfig {
  return {
    systemPromptEnabled: true,
    openingLineEnabled: true,
    chipsEnabled: true,
    skillIds: [],
    toolsCustomized: false,
  };
}

type Configs = Record<AppId, AppConfig>;
export type AppConfigsPersist = Partial<Configs>;

/** Pure resolver: merge a config over its app defaults. Kept outside the store
 *  so React callers can `useMemo` it from the stable `configs[app]` reference
 *  (returning a fresh object straight from a selector loops useSyncExternalStore). */
export function resolveConfig(app: AppId, c: AppConfig): ResolvedAppConfig {
  const d = APP_DEFAULTS[app];
  return {
    name: c.name ?? d.name,
    subtitle: c.subtitle ?? d.subtitle,
    accentColor: d.accentColor,
    systemPrompt: c.systemPrompt ?? d.systemPrompt,
    systemPromptEnabled: c.systemPromptEnabled,
    openingLine: c.openingLine ?? d.openingLine,
    openingLineEnabled: c.openingLineEnabled,
    chips: c.chips ?? d.suggestionChips,
    chipsEnabled: c.chipsEnabled,
    skillIds: c.skillIds,
    tools: c.tools ?? [],
    toolsCustomized: c.toolsCustomized,
  };
}

const EMPTY: Configs = {
  orion: blankConfig(),
  archives: blankConfig(),
  xdesign: blankConfig(),
};

type AppConfigState = {
  configs: Configs;
  resolved: (app: AppId) => ResolvedAppConfig;
  patch: (app: AppId, patch: Partial<AppConfig>) => void;
  reset: (app: AppId) => void;
  hydrate: (value: Partial<Configs> | null | undefined) => void;
};

export const useAppConfig = create<AppConfigState>((set, get) => ({
  configs: { ...EMPTY },
  resolved: (app) => resolveConfig(app, get().configs[app]),
  patch: (app, patch) => {
    const configs = { ...get().configs, [app]: { ...get().configs[app], ...patch } };
    set({ configs });
    void setAppState("appconfig", configs);
  },
  reset: (app) => {
    const configs = { ...get().configs, [app]: blankConfig() };
    set({ configs });
    void setAppState("appconfig", configs);
  },
  hydrate: (value) => {
    if (!value) return;
    const merged: Configs = { ...EMPTY };
    for (const k of ["orion", "archives", "xdesign"] as AppId[]) {
      if (value[k]) merged[k] = { ...blankConfig(), ...value[k] };
    }
    set({ configs: merged });
  },
}));

/** Text injected on the FIRST turn of an app chat — the app's system prompt
 *  plus the instructions of every enabled skill. Empty string when nothing is
 *  active. Kept first-turn-only so long prompts don't re-bill every turn. */
export function appFirstTurnPreamble(app: AppId): string {
  const r = useAppConfig.getState().resolved(app);
  const parts: string[] = [];
  if (r.systemPromptEnabled && r.systemPrompt.trim()) parts.push(r.systemPrompt.trim());
  if (r.skillIds.length) {
    const byId = new Map(useSkillsStore.getState().list().map((s) => [s.id, s]));
    for (const id of r.skillIds) {
      const s = byId.get(id);
      if (s && s.instructions.trim()) parts.push(`## ${s.name}\n${s.instructions.trim()}`);
    }
  }
  return parts.join("\n\n");
}

/** Allowed-tools list for dispatch, or null for "unrestricted" (the app
 *  default). Combines the app's explicit tool grants with any tools its
 *  enabled skills require. */
export function appAllowedTools(app: AppId): string[] | null {
  const r = useAppConfig.getState().resolved(app);
  const grants: ToolGrant[] = [];
  if (r.toolsCustomized) grants.push(...r.tools);
  if (r.skillIds.length) {
    const byId = new Map(useSkillsStore.getState().list().map((s) => [s.id, s]));
    for (const id of r.skillIds) byId.get(id)?.tools.forEach((g) => grants.push(g));
  }
  if (!r.toolsCustomized && grants.length === 0) return null;
  const names = new Set<string>();
  for (const g of grants) names.add(g.kind === "builtin" ? g.name : `mcp__${g.server}`);
  return [...names];
}
