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
export type Lesson = {
  objective: string;
  concept_chunks: ConceptChunk[];
  worked_example: WorkedExample;
  key_terms: string[];
  suggested_resources: SuggestedResource[];
  recall_check: RecallQuestion[];
};

// Persisted row shapes (match migration 0024)
export type TopicRow = { id: string; title: string; summary: string | null; status: string; created_at: number; updated_at: number };
export type NodeRow = {
  id: string; topic_id: string; title: string; objective: string | null; bloom_level: string | null;
  level: Level; order_idx: number; lesson_json: string | null; lesson_at: number | null;
  p_mastery: number; attempts: number; last_seen: number | null; status: NodeStatus;
};
export type EdgeRow = { topic_id: string; from_node: string; to_node: string };
export type ReviewRow = { id: string; node_id: string; ts: number; correct: number; kind: string };

const asArray = <T>(v: unknown, map: (x: any) => T): T[] =>
  Array.isArray(v) ? v.map(map) : [];
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

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
  };
}
