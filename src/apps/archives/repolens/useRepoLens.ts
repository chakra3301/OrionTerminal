import { create } from "zustand";
import { fetchRepo } from "./fetch";
import { buildPrompt } from "./prompt";
import { withTone } from "./tone";
import { parseClaudeResponse } from "./parser";
import { enqueueClaude } from "./claude";
import { defaultModelConfig } from "./models";
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
  setTone: (t: string) => void;
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
  setDefaultModel: (id) => set((s) => ({ model: { ...s.model, default_model: id } })),
  setTone: (tone) => set({ tone }),
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
