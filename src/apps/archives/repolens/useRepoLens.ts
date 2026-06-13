import { create } from "zustand";
import { fetchSource } from "./fetch";
import { detectPlatform } from "./detect";
import { buildPrompt } from "./prompt";
import { withTone } from "./tone";
import { parseClaudeResponse } from "./parser";
import { enqueueClaude } from "./claude";
import { defaultModelConfig, modelFor } from "./models";
import { ipc } from "@/lib/ipc";
import {
  buildAtomsPrompt,
  parseAtoms,
  buildLineagePrompt,
  parseLineage,
  buildFeynmanPrompt,
  parseFeynman,
  buildSktpgPrompt,
  parseSktpg,
  buildSynergiesPrompt,
  parseSynergies,
  buildVersusPrompt,
  parseVersus,
  buildTagPrompt,
  parseTags,
} from "./lenses";
import { buildFrameworkPrompt, parseFramework } from "./frameworks";
import { buildCombinatorPrompt, parseCombinator, type CombinatorResult } from "./combinator";
import { getAppState, setAppState } from "@/lib/db";
import { saveScan, listScans, getScan, deleteScan, updateLenses, type ScanRow } from "./repolensDb";
import { log } from "@/lib/log";
import type { RepoAnalysis, RepoData, RepoLensModelConfig, Lenses, Platform } from "./types";

/** Up to this many scans hit Claude concurrently; extras queue. */
const MAX_CONCURRENT_SCANS = 3;
let jobSeq = 0;

export type ScanStatus = "queued" | "running" | "done" | "error";
export type ScanJob = {
  id: string;
  repoId: string;
  platform: Platform;
  status: ScanStatus;
  error?: string;
};

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

type RunningPart =
  | null
  | "core"
  | "deepdive"
  | "sktpg"
  | "synergies"
  | "versus"
  | "lens"
  | "retag"
  | "combinator";

type State = {
  input: string;
  setInput: (s: string) => void;
  current: RepoAnalysis | null;
  lenses: Lenses;
  running: RunningPart;
  /** Which framework key is mid-run (for the menu spinner); null otherwise. */
  activeFramework: string | null;
  error: string | null;
  model: RepoLensModelConfig;
  tone: string;
  setDefaultModel: (id: string) => void;
  setPartModel: (part: string, id: string) => void;
  setTone: (t: string) => void;
  hydratePrefs: () => Promise<void>;
  runDeepDive: () => Promise<void>;
  runSktpg: () => Promise<void>;
  runSynergies: () => Promise<void>;
  runVersus: (target: { platform: Platform; repoId: string }) => Promise<void>;
  runFramework: (key: string) => Promise<void>;
  retag: (repoId: string) => Promise<void>;
  /** Combinator surface (fuse repos into a new project idea). */
  combinatorOpen: boolean;
  combinatorResult: CombinatorResult | null;
  combinatorInputs: string[];
  openCombinator: () => void;
  closeCombinator: () => void;
  runCombinator: (repoIds: string[]) => Promise<void>;
  library: ScanRow[];
  loadLibrary: () => Promise<void>;
  openFromLibrary: (repoId: string) => Promise<void>;
  removeFromLibrary: (repoId: string) => Promise<void>;
  /** Live scan queue — multiple repos scan concurrently (capped). */
  jobs: ScanJob[];
  scan: (input: string) => void;
  dismissJob: (id: string) => void;
  clearDoneJobs: () => void;
  pumpScans: () => void;
  runScanJob: (id: string) => Promise<void>;
  closeReport: () => void;
};

export const useRepoLens = create<State>((set, get) => ({
  input: "",
  setInput: (input) => set({ input }),
  current: null,
  lenses: {},
  running: null,
  activeFramework: null,
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
  closeReport: () => set({ current: null, error: null, combinatorOpen: false }),

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

  runSktpg: async () => {
    const cur = get().current;
    if (!cur?.repoId) return;
    set({ running: "sktpg", error: null });
    try {
      const source = await fetchSource(cur.repoId);
      const raw = await enqueueClaude(
        get().model,
        "sktpg",
        withTone(get().tone, buildSktpgPrompt(asRepoData(cur), source)),
      );
      const lenses: Lenses = { ...get().lenses, sktpg: parseSktpg(raw) };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) {
      log.error("repolens sktpg failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  runSynergies: async () => {
    const cur = get().current;
    if (!cur?.repoId) return;
    set({ running: "synergies", error: null });
    try {
      const candidates = get()
        .library.filter((r) => r.repo_id !== cur.repoId)
        .slice(0, 30)
        .map((r) => ({ repoId: r.repo_id, category: r.analysis.category, eli5: r.analysis.eli5 }));
      const target = {
        repoId: cur.repoId,
        eli5: cur.eli5,
        description: cur.description,
        category: cur.category,
        language: cur.language,
      };
      const raw = await enqueueClaude(
        get().model,
        "synergies",
        withTone(get().tone, buildSynergiesPrompt(target, candidates)),
      );
      const lenses: Lenses = { ...get().lenses, synergies: parseSynergies(raw) };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) {
      log.error("repolens synergies failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  runVersus: async (target) => {
    const cur = get().current;
    if (!cur?.repoId) return;
    set({ running: "versus", error: null });
    try {
      const [aData, bData] = await Promise.all([
        ipc.repolensFetchRepo(cur.platform ?? "github", cur.repoId),
        ipc.repolensFetchRepo(target.platform, target.repoId),
      ]);
      const raw = await enqueueClaude(
        get().model,
        "versus",
        withTone(get().tone, buildVersusPrompt(aData, bData)),
      );
      const versus = { ...parseVersus(raw), target: target.repoId };
      const lenses: Lenses = { ...get().lenses, versus };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) {
      log.error("repolens versus failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  runFramework: async (key) => {
    const cur = get().current;
    if (!cur?.repoId) return;
    set({ running: "lens", activeFramework: key, error: null });
    try {
      const source = await fetchSource(cur.repoId);
      const raw = await enqueueClaude(
        get().model,
        "lens",
        withTone(get().tone, buildFrameworkPrompt(key, asRepoData(cur), source)),
      );
      const result = parseFramework(raw);
      const frameworks = { ...(get().lenses.frameworks ?? {}), [key]: result };
      const lenses: Lenses = { ...get().lenses, frameworks };
      set({ lenses, running: null, activeFramework: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) {
      log.error("repolens framework lens failed", e);
      set({ running: null, activeFramework: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  retag: async (repoId) => {
    const cur = get().current;
    const fromCur = cur?.repoId === repoId ? cur : null;
    const seed = fromCur ?? get().library.find((r) => r.repo_id === repoId)?.analysis;
    if (!seed) return;
    set({ running: "retag", error: null });
    try {
      const raw = await enqueueClaude(
        get().model,
        "retag",
        buildTagPrompt({
          repoId,
          category: seed.category,
          eli5: seed.eli5,
          compare_hooks: seed.compare_hooks,
        }),
      );
      const capabilities = parseTags(raw);
      if (capabilities.length === 0) {
        set({ running: null });
        return;
      }
      if (fromCur) set({ current: { ...fromCur, capabilities } });
      const row = await getScan(repoId);
      if (row) {
        await saveScan({
          repo_id: repoId,
          platform: row.platform,
          model: row.model,
          tone: row.tone,
          analysis: { ...row.analysis, capabilities },
          lenses: row.lenses,
        });
      }
      set({ running: null });
      await get().loadLibrary();
    } catch (e) {
      log.error("repolens retag failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  combinatorOpen: false,
  combinatorResult: null,
  combinatorInputs: [],
  openCombinator: () => set({ combinatorOpen: true, current: null }),
  closeCombinator: () => set({ combinatorOpen: false }),
  runCombinator: async (repoIds) => {
    if (repoIds.length < 2) return;
    const rows = get()
      .library.filter((r) => repoIds.includes(r.repo_id))
      .map((r) => ({
        repoId: r.repo_id,
        capabilities: r.analysis.capabilities,
        eli5: r.analysis.eli5,
      }));
    if (rows.length < 2) return;
    set({ running: "combinator", error: null, combinatorResult: null, combinatorInputs: repoIds });
    try {
      const raw = await enqueueClaude(get().model, "combinator", buildCombinatorPrompt(rows));
      const result = parseCombinator(raw, repoIds);
      set({ combinatorResult: result, running: null });
    } catch (e) {
      log.error("repolens combinator failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  library: [],
  loadLibrary: async () => set({ library: await listScans(100) }),
  openFromLibrary: async (repoId) => {
    const row = await getScan(repoId);
    if (row) set({ current: row.analysis, lenses: row.lenses, error: null, combinatorOpen: false });
  },
  removeFromLibrary: async (repoId) => {
    await deleteScan(repoId);
    await get().loadLibrary();
  },

  jobs: [],

  scan: (input) => {
    const hit = detectPlatform(input);
    if (!hit) {
      set({ error: "Not a recognized repo URL or owner/repo" });
      return;
    }
    set({ input: "", error: null });
    const jobs = get().jobs;
    // Already queued/running for this repo? Don't double-add.
    if (jobs.some((j) => j.repoId === hit.repoId && (j.status === "queued" || j.status === "running"))) {
      return;
    }
    // Drop a prior finished chip for the same repo, then enqueue fresh.
    const kept = jobs.filter((j) => j.repoId !== hit.repoId);
    const job: ScanJob = { id: `job-${jobSeq++}`, repoId: hit.repoId, platform: hit.platform, status: "queued" };
    set({ jobs: [...kept, job] });
    get().pumpScans();
  },

  dismissJob: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
  clearDoneJobs: () =>
    set({ jobs: get().jobs.filter((j) => j.status === "queued" || j.status === "running") }),

  pumpScans: () => {
    const jobs = get().jobs;
    let slots = MAX_CONCURRENT_SCANS - jobs.filter((j) => j.status === "running").length;
    for (const j of jobs) {
      if (slots <= 0) break;
      if (j.status === "queued") {
        slots--;
        void get().runScanJob(j.id);
      }
    }
  },

  runScanJob: async (id) => {
    const patch = (partial: Partial<ScanJob>) =>
      set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...partial } : j)) });
    const job = get().jobs.find((j) => j.id === id);
    if (!job || job.status !== "queued") return;
    patch({ status: "running", error: undefined });
    try {
      const repo = await ipc.repolensFetchRepo(job.platform, job.repoId);
      const prompt = withTone(get().tone, buildPrompt(repo));
      const reply = await ipc.repolensClaudeCall(prompt, modelFor(get().model, "core"));
      const analysis = parseClaudeResponse(reply.result);
      analysis.repoId = repo.repo_id;
      analysis.platform = repo.platform;
      analysis.language = repo.language;
      analysis.license = repo.license;
      analysis.stars = repo.stars;
      analysis.description = repo.description;
      analysis.languages = repo.languages;
      await saveScan({
        repo_id: repo.repo_id,
        platform: repo.platform,
        model: get().model.default_model,
        tone: get().tone,
        analysis,
      });
      patch({ status: "done" });
      await get().loadLibrary();
      // Lone scan with nothing else in flight + no report open → auto-open it.
      const others = get().jobs.filter((j) => j.id !== id && (j.status === "queued" || j.status === "running"));
      if (!get().current && others.length === 0) {
        await get().openFromLibrary(job.repoId);
      }
    } catch (e) {
      log.error("repolens scan failed", e);
      patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      get().pumpScans();
    }
  },
}));
