// src/apps/archives/learn/learnTypes.ts

export type Level = "basics" | "intermediate" | "advanced" | "pro";
export type NodeStatus = "locked" | "ready" | "in_progress" | "mastered";

export type GraphNodeSpec = {
  key: string;            // LLM-local key used to resolve prereqs into real node ids
  title: string;
  objective: string;
  bloom_level: string;
  level: Level;
  prereqs: string[];      // references other nodes' `key`
};
export type GraphSpec = { summary: string; nodes: GraphNodeSpec[] };

export type ConceptChunk = { tag: string; body: string };
export type WorkedStep = { text: string; why: string };
export type WorkedExample = { title: string; steps: WorkedStep[] } | null;
export type ResourceKind = "video" | "article" | "book" | "course" | "docs" | "search";
export type SuggestedResource = { type: ResourceKind | string; title: string; search_query: string; url?: string };
export type RecallQuestion = { prompt: string; expected: string; concept: string };

// ── Visual specs (AI-generated; rendered inline beside the concept they illustrate) ──
export type VisualKind = "flow" | "cycle" | "tree" | "compare" | "analogy" | "timeline";
export type VisualStep = { label: string; detail: string };          // flow · cycle · timeline
export type TreeItem = { label: string; detail: string; parent: number | null };
export type CompareRow = { aspect: string; left: string; right: string };
export type AnalogyPair = { familiar: string; concept: string; note: string };
export type LessonVisual = {
  kind: VisualKind;
  title: string;
  chunk: number;          // 0-based concept-chunk index this illustrates; -1 = general
  caption: string;
  steps: VisualStep[];     // flow · cycle · timeline
  nodes: TreeItem[];       // tree
  rows: CompareRow[];      // compare
  pairs: AnalogyPair[];    // analogy
  leftLabel: string;       // compare / analogy (familiar side) header
  rightLabel: string;      // compare / analogy (concept side) header
};

export type Lesson = {
  objective: string;
  concept_chunks: ConceptChunk[];
  worked_example: WorkedExample;
  key_terms: string[];
  suggested_resources: SuggestedResource[];
  recall_check: RecallQuestion[];
  visuals: LessonVisual[];
};

// Persisted row shapes (match migration 0024)
export type TopicRow = { id: string; title: string; summary: string | null; status: string; figure_json: string | null; created_at: number; updated_at: number };
export type NodeRow = {
  id: string; topic_id: string; title: string; objective: string | null; bloom_level: string | null;
  level: Level; order_idx: number; lesson_json: string | null; lesson_at: number | null;
  p_mastery: number; attempts: number; last_seen: number | null; status: NodeStatus;
};
export type EdgeRow = { topic_id: string; from_node: string; to_node: string };
export type ReviewRow = { id: string; node_id: string; ts: number; correct: number; kind: string };
export type AchievementRow = { id: string; topic_id: string; kind: "node" | "topic"; node_id: string | null; title: string; earned_at: number };
export type TopicProgress = { total: number; mastered: number };

const asArray = <T>(v: unknown, map: (x: any) => T): T[] =>
  Array.isArray(v) ? v.map(map) : [];
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;

const VISUAL_KINDS: VisualKind[] = ["flow", "cycle", "tree", "compare", "analogy", "timeline"];

/** Parse one visual spec; returns null if it has no renderable payload for its kind. */
function parseVisual(v: any): LessonVisual | null {
  if (!v || typeof v !== "object") return null;
  const kind = VISUAL_KINDS.includes(v.kind) ? (v.kind as VisualKind) : null;
  if (!kind) return null;
  const vis: LessonVisual = {
    kind,
    title: asStr(v.title),
    chunk: asInt(v.chunk, -1),
    caption: asStr(v.caption),
    steps: asArray<VisualStep>(v.steps, (s) => ({ label: asStr(s?.label), detail: asStr(s?.detail) })).filter((s) => s.label),
    nodes: asArray<TreeItem>(v.nodes, (n) => ({ label: asStr(n?.label), detail: asStr(n?.detail), parent: n?.parent == null ? null : asInt(n.parent, -1) })).filter((n) => n.label),
    rows: asArray<CompareRow>(v.rows, (r) => ({ aspect: asStr(r?.aspect), left: asStr(r?.left), right: asStr(r?.right) })).filter((r) => r.left || r.right),
    pairs: asArray<AnalogyPair>(v.pairs, (p) => ({ familiar: asStr(p?.familiar), concept: asStr(p?.concept), note: asStr(p?.note) })).filter((p) => p.familiar && p.concept),
    leftLabel: asStr(v.leftLabel),
    rightLabel: asStr(v.rightLabel),
  };
  // Drop a visual that has no usable payload for its kind.
  const hasPayload =
    (kind === "flow" || kind === "cycle" || kind === "timeline") ? vis.steps.length >= 2 :
    kind === "tree" ? vis.nodes.length >= 2 :
    kind === "compare" ? vis.rows.length >= 1 :
    kind === "analogy" ? vis.pairs.length >= 1 : false;
  return hasPayload ? vis : null;
}

/** Strip ``` fences and slice the outermost {...}; returns null if no object found. */
function salvageJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export function parseGraphSpec(raw: string): GraphSpec {
  const o = salvageJson(raw);
  if (!o) return { summary: "", nodes: [] };
  return {
    summary: asStr(o.summary),
    nodes: asArray<GraphNodeSpec>(o.nodes, (n) => ({
      key: asStr(n?.key) || asStr(n?.title),
      title: asStr(n?.title),
      objective: asStr(n?.objective),
      bloom_level: asStr(n?.bloom_level),
      level: (["basics", "intermediate", "advanced", "pro"].includes(n?.level) ? n.level : "basics") as Level,
      prereqs: asArray<string>(n?.prereqs, asStr).filter(Boolean),
    })).filter((n) => n.title),
  };
}

export function parseLesson(raw: string): Lesson {
  const o = salvageJson(raw) ?? {};
  const we = o.worked_example;
  return {
    objective: asStr(o.objective),
    concept_chunks: asArray<ConceptChunk>(o.concept_chunks, (c) => ({ tag: asStr(c?.tag) || "Concept", body: asStr(c?.body) })),
    worked_example: we && typeof we === "object"
      ? { title: asStr(we.title), steps: asArray<WorkedStep>(we.steps, (s) => ({ text: asStr(s?.text), why: asStr(s?.why) })) }
      : null,
    key_terms: asArray<string>(o.key_terms, asStr).filter(Boolean),
    suggested_resources: asArray<SuggestedResource>(o.suggested_resources, (r) => ({
      type: asStr(r?.type) || "search", title: asStr(r?.title), search_query: asStr(r?.search_query),
      ...(typeof r?.url === "string" && r.url ? { url: r.url } : {}),
    })),
    recall_check: asArray<RecallQuestion>(o.recall_check, (q) => ({ prompt: asStr(q?.prompt), expected: asStr(q?.expected), concept: asStr(q?.concept) })).filter((q) => q.prompt),
    visuals: asArray<LessonVisual | null>(o.visuals, parseVisual).filter((v): v is LessonVisual => v !== null),
  };
}
