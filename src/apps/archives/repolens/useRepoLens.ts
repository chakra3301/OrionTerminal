import { create } from "zustand";
import { fetchRepo } from "./fetch";
import { buildPrompt } from "./prompt";
import { withTone } from "./tone";
import { parseClaudeResponse } from "./parser";
import { enqueueClaude } from "./claude";
import { defaultModelConfig } from "./models";
import { getAppState, setAppState } from "@/lib/db";
import { log } from "@/lib/log";
import type { RepoAnalysis, RepoLensModelConfig } from "./types";

type RunningPart = null | "core" | "deepdive" | "sktpg" | "synergies";

type State = {
  input: string;
  setInput: (s: string) => void;
  current: RepoAnalysis | null;
  running: RunningPart;
  error: string | null;
  model: RepoLensModelConfig;
  tone: string;
  setDefaultModel: (id: string) => void;
  setPartModel: (part: string, id: string) => void;
  setTone: (t: string) => void;
  hydratePrefs: () => Promise<void>;
  scan: (input: string) => Promise<void>;
  closeReport: () => void;
};

export const useRepoLens = create<State>((set, get) => ({
  input: "",
  setInput: (input) => set({ input }),
  current: null,
  running: null,
  error: null,
  model: defaultModelConfig(),
  tone: "neutral",
  setDefaultModel: (id) => {
    const model = { ...get().model, default_model: id };
    set({ model });
    void setAppState("repolens", { model, tone: get().tone });
  },
  setPartModel: (part, id) => {
    const model = { ...get().model, per_part: { ...get().model.per_part, [part]: id } };
    set({ model });
    void setAppState("repolens", { model, tone: get().tone });
  },
  setTone: (tone) => {
    set({ tone });
    void setAppState("repolens", { model: get().model, tone });
  },
  hydratePrefs: async () => {
    const saved = await getAppState<{ model?: RepoLensModelConfig; tone?: string }>("repolens");
    if (saved) set({ model: saved.model ?? defaultModelConfig(), tone: saved.tone ?? "neutral" });
  },
  closeReport: () => set({ current: null, error: null }),

  scan: async (input) => {
    set({ running: "core", error: null });
    try {
      const repo = await fetchRepo(input);
      const prompt = withTone(get().tone, buildPrompt(repo));
      const raw = await enqueueClaude(get().model, "core", prompt);
      const analysis = parseClaudeResponse(raw);
      // Carry repo metadata for rendering/export.
      analysis.repoId = repo.repo_id;
      analysis.platform = repo.platform;
      analysis.language = repo.language;
      analysis.license = repo.license;
      analysis.stars = repo.stars;
      analysis.description = repo.description;
      analysis.languages = repo.languages;
      set({ current: analysis, running: null });
    } catch (e) {
      log.error("repolens scan failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
