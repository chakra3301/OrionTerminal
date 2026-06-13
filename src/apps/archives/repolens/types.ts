export type Platform = "github" | "gitlab" | "npm" | "pypi";

export type LangPct = { name: string; pct: number };
export type Dep = { name: string; version: string };

export type RepoData = {
  platform: Platform;
  repo_id: string;
  description: string;
  language: string;
  license: string;
  stars: number;
  readme: string;
  languages: LangPct[];
  dependencies: Dep[];
};

export type RepoSource = {
  tree: string[];
  files: { path: string; content: string }[];
  degraded: boolean;
};

export type Health = {
  score: number;
  commit_activity: number;
  issue_response: number;
  pr_merge_rate: number;
  maintainer_count: number;
  summary: string;
};
export type RedFlag = { title: string; text: string; severity: "warning" | "ok" };
export type Highlight = {
  text: string;
  why: string;
  severity: "risk" | "insight" | "opportunity";
  tab: string;
};

export type RepoAnalysis = {
  eli5: string;
  bottom_line: string;
  analogies: string[];
  technical: string;
  use_cases: { core_fit: string; good_fit: string; works_well: string; long_term: string };
  skip_if: { overkill: string; wrong_tool: string; needs_care: string; consider: string };
  enables: string;
  pros: string[];
  cons: string[];
  alternatives: { name: string; when: string }[];
  health: Health;
  red_flags: RedFlag[];
  start_here: { icon: string; title: string; desc: string; tag: string }[];
  compare_hooks: string;
  tech_stack: { built_with: string[]; key_dependencies: { name: string; purpose: string }[] };
  tags: string[];
  category: string;
  capabilities: string[];
  highlights: Highlight[];
  // Carried from RepoData for rendering/export (set by the store, not the parser).
  repoId?: string;
  platform?: Platform;
  language?: string;
  license?: string;
  stars?: number;
  description?: string;
  languages?: LangPct[];
};

// ── Lens result types ──
export type DeepDive = {
  atoms: { id: string; name: string; kind: string; purpose: string; files: string[] }[];
  lineage: {
    links: { from: string; to: string; relation: string; why: string }[];
    roots: string[];
    leaves: string[];
  };
  feynman: {
    explanation: string;
    gaps: string[];
    assumptions: string[];
    questions: { q: string; a: string }[];
    confidence: { claim: string; level: string; note: string }[];
  };
};

export type Sktpg = {
  thesis: {
    becoming: string;
    forced_next: string;
    opportunity: string;
    before_consensus: string;
    wrong_if: string;
  };
  score: { value: number; band: string };
  base_rate: {
    reference_class: string;
    rate: string;
    cause_of_death: string;
    prior: string;
    evidence: string;
  };
  weak_signals: { signal: string; why: string; evidence: string; forces_next: string }[];
  hype_vs_motion: { claim: string; verdict: string; evidence: string }[];
  bottleneck: { current: string; weakening: string; next: string; who_profits: string };
  forecast: { base: string; bull: string; bear: string; wildcard: string };
  becomes_obvious: string[];
  actions: { action: string; timeframe: string; why_now: string }[];
  premortem: { kill_path: string; likelihood: string; survives: boolean }[];
  tracking: { signal: string; flag: string; why: string }[];
};

export type Synergies = {
  synergies: { repoId: string; category: string; synergy: string; in_library: boolean }[];
};

export type Versus = {
  target: string; // repoId of side B (set by the store, not the parser)
  summary_a: string;
  summary_b: string;
  dimensions: { label: string; a: string; b: string; winner: "a" | "b" | "tie" }[];
  pick_a_when: string[];
  pick_b_when: string[];
  verdict: string;
};

export type Lenses = {
  deepdive?: DeepDive;
  sktpg?: Sktpg;
  synergies?: Synergies;
  versus?: Versus;
  /** Framework-lens results keyed by framework key (toc, triz, pareto, …). */
  frameworks?: Record<string, Record<string, unknown>>;
};

export type PartId = "core" | "deepdive" | "sktpg" | "synergies" | "versus" | "lens";
export type RepoLensModelConfig = { default_model: string; per_part: Record<string, string> };
export type RepoLensPrefs = { model: RepoLensModelConfig; tone: string };
