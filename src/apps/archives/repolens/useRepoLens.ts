import { create } from "zustand";
import { fetchRepo, fetchSource } from "./fetch";
import { buildPrompt } from "./prompt";
import { withTone } from "./tone";
import { parseClaudeResponse } from "./parser";
import { enqueueClaude } from "./claude";
import { defaultModelConfig } from "./models";
import {
  buildAtomsPrompt,
  parseAtoms,
  buildLineagePrompt,
  parseLineage,
  buildFeynmanPrompt,
  parseFeynman,
} from "./lenses";
import { getAppState, setAppState } from "@/lib/db";
import { saveScan, listScans, getScan, deleteScan, updateLenses, type ScanRow } from "./repolensDb";
import { log } from "@/lib/log";
import type { RepoAnalysis, RepoData, RepoLensModelConfig, Lenses } from "./types";

/** The lens prompt builders read a few RepoData fields; rebuild that shape from
 * a carried analysis (readme/deps aren't persisted — lenses use the file tree). */
function asRepoData(a: RepoAnalysis): RepoData {
  return {
    platform: a.platform ?? "github",
    repo_id: a.repoId ?? "",
    description: a.description ?? "",
    language: a.language ?? "",
    license: a.license ?? "",
    stars: a.stars ?? 0,
    readme: "",
    languages: a.languages ?? [],
    dependencies: [],
  };
}

type RunningPart = null | "core" | "deepdive" | "sktpg" | "synergies";

type State = {
  input: string;
  setInput: (s: string) => void;
  current: RepoAnalysis | null;
  lenses: Lenses;
  running: RunningPart;
  error: string | null;
  model: RepoLensModelConfig;
  tone: string;
  setDefaultModel: (id: string) => void;
  setPartModel: (part: string, id: string) => void;
  setTone: (t: string) => void;
  hydratePrefs: () => Promise<void>;
  runDeepDive: () => Promise<void>;
  library: ScanRow[];
  loadLibrary: () => Promise<void>;
  openFromLibrary: (repoId: string) => Promise<void>;
  removeFromLibrary: (repoId: string) => Promise<void>;
  scan: (input: string) => Promise<void>;
  closeReport: () => void;
};

export const useRepoLens = create<State>((set, get) => ({
  input: "",
  setInput: (input) => set({ input }),
  current: null,
  lenses: {},
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

  runDeepDive: async () => {
    const cur = get().current;
    if (!cur?.repoId) return;
    set({ running: "deepdive", error: null });
    try {
      const source = await fetchSource(cur.repoId);
      const atomsRaw = await enqueueClaude(
        get().model,
        "deepdive",
        withTone(get().tone, buildAtomsPrompt(asRepoData(cur), source, null)),
      );
      const atomsRes = parseAtoms(atomsRaw);
      const lineageRaw = await enqueueClaude(get().model, "deepdive", buildLineagePrompt(atomsRes.atoms));
      const lineage = parseLineage(lineageRaw);
      const feynRaw = await enqueueClaude(
        get().model,
        "deepdive",
        buildFeynmanPrompt(asRepoData(cur), atomsRes.atoms, lineage),
      );
      const feynman = parseFeynman(feynRaw);
      const lenses: Lenses = { ...get().lenses, deepdive: { atoms: atomsRes.atoms, lineage, feynman } };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) {
      log.error("repolens deep dive failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  library: [],
  loadLibrary: async () => set({ library: await listScans(100) }),
  openFromLibrary: async (repoId) => {
    const row = await getScan(repoId);
    if (row) set({ current: row.analysis, lenses: row.lenses, error: null });
  },
  removeFromLibrary: async (repoId) => {
    await deleteScan(repoId);
    await get().loadLibrary();
  },

  scan: async (input) => {
    set({ running: "core", error: null, lenses: {} });
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
      await saveScan({
        repo_id: repo.repo_id,
        platform: repo.platform,
        model: get().model.default_model,
        tone: get().tone,
        analysis,
      });
      await get().loadLibrary();
    } catch (e) {
      log.error("repolens scan failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
