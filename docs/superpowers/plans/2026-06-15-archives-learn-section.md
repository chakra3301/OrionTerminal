# Archives "Learn" Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Learn" section to Archives where an AI generates a prerequisite learning graph for any topic, rendered as an Obsidian-style force-directed constellation, with on-demand cached lessons, a scoped Socratic tutor, and a code-owned adaptive mastery engine (BKT + forgetting-decay).

**Architecture:** Self-contained module `src/apps/archives/learn/` mirroring `repolens/`. The LLM owns generation/teaching/grading; plain, unit-tested code owns the mastery math, unlock gating, decay, and graph physics. Persistence in SQLite (migration 0024). Section accent = violet (`--neon-violet`).

**Tech Stack:** Tauri 2 + React 19 + TypeScript + Zustand; `react-markdown`/`remark-gfm`/`rehype-highlight` (already present); SVG hand-rolled force layout (no new dep); subscription Claude CLI via a `repolens_claude_call`-style Rust command; `vitest` for tests.

**Spec:** [docs/superpowers/specs/2026-06-15-archives-learn-section-design.md](../specs/2026-06-15-archives-learn-section-design.md)

---

## Conventions for every task

- Run `tsc` (`npx tsc --noEmit`), `vitest` (`npx vitest run`), and (for Rust changes) `cargo check` from `src-tauri/` — gate on the REAL exit code; never mask with `| grep`.
- Pure-logic modules are TDD: failing test first, then minimal implementation.
- UI/visual tasks: after the component compiles and any logic tests pass, invoke the **frontend-design skill** to produce the production-quality styled implementation against the app's real tokens, then mark the task for **user smoke-test** (the agent cannot run Tauri).
- Commit after every task.
- Migration 0024 + any Rust change requires a `tauri dev` restart before smoke-testing — note it in the commit body.

---

## File structure

```
src/apps/archives/learn/
  learnTypes.ts          # TS schemas (Topic, Node, Edge, Lesson, GraphSpec) + fail-soft parsers   [Task 2]
  bkt.ts                 # Bayesian Knowledge Tracing update (pure)                                 [Task 3]
  gating.ts              # recomputeGates, readySet, effectiveMastery (decay) (pure)                [Task 4]
  forceLayout.ts         # force-directed physics step + helpers (pure)                             [Task 5]
  pedagogy.ts            # versioned master-teacher prompt builders                                 [Task 6]
  claude.ts              # serialized queue + generateGraph/generateLesson/gradeAnswer/findLinks    [Task 7]
  learnDb.ts             # SQLite CRUD                                                               [Task 8]
  useLearn.ts            # zustand store                                                             [Task 9]
  LearnView.tsx          # shell: topic rail + constellation/lesson router                          [Task 11]
  Constellation.tsx      # force-directed graph (frontend-design)                                   [Task 12]
  LessonView.tsx         # lesson page anatomy (frontend-design)                                    [Task 13]
  TutorPanel.tsx         # scoped streaming tutor                                                   [Task 14]
src-tauri/migrations/0024_learn.sql                                                                 [Task 1]
src-tauri/src/learn.rs   # learn_claude_call (mirror of repolens_claude_call + allow_web)           [Task 10]
src/lib/ipc.ts           # learnClaudeCall wrapper                                                   [Task 10]
src/styles/tokens.css    # --learn-accent + .learn-* styles                                          [Task 11/12/13]
src/apps/archives/useArchives.ts   # + "learn" view value + setters                                  [Task 11]
src/apps/archives/ArchivesApp.tsx  # + sidebar entry + route                                          [Task 11]
```

---

## Task 1: Migration 0024 — schema

**Files:**
- Create: `src-tauri/migrations/0024_learn.sql`
- Read first: `src-tauri/migrations/0023_repolens_website_design.sql` (confirm the `ALTER`/`CREATE` style + how migrations are registered) and the migration registration list in `src-tauri/src/lib.rs` (search for `add_migrations` / the `Migration {` array).

- [ ] **Step 1: Write the migration SQL**

```sql
-- 0024_learn.sql — Archives "Learn" section
CREATE TABLE learn_topics (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  summary     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE learn_nodes (
  id          TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  objective   TEXT,
  bloom_level TEXT,
  level       TEXT NOT NULL,
  order_idx   INTEGER NOT NULL,
  lesson_json TEXT,
  lesson_at   INTEGER,
  p_mastery   REAL NOT NULL DEFAULT 0.0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER,
  status      TEXT NOT NULL DEFAULT 'locked'
);
CREATE INDEX idx_learn_nodes_topic ON learn_nodes(topic_id);

CREATE TABLE learn_edges (
  topic_id  TEXT NOT NULL,
  from_node TEXT NOT NULL,
  to_node   TEXT NOT NULL,
  PRIMARY KEY (topic_id, from_node, to_node)
);

CREATE TABLE learn_reviews (
  id        TEXT PRIMARY KEY,
  node_id   TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  correct   INTEGER NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'recall'
);
CREATE INDEX idx_learn_reviews_node ON learn_reviews(node_id);
```

- [ ] **Step 2: Register the migration** in `src-tauri/src/lib.rs` — add a `Migration { version: 24, description: "learn", sql: include_str!("../migrations/0024_learn.sql"), kind: MigrationKind::Up }` entry following the exact shape of the version 23 entry already there. Do NOT edit any prior migration.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/0024_learn.sql src-tauri/src/lib.rs
git commit -m "feat(learn): migration 0024 — topics/nodes/edges/reviews"
```

---

## Task 2: learnTypes.ts — schemas + fail-soft parsers

**Files:**
- Create: `src/apps/archives/learn/learnTypes.ts`
- Test: `src/apps/archives/learn/learnTypes.test.ts`
- Read first: `src/apps/archives/repolens/parser.ts` (or `designSpec.ts`) to copy the existing fail-soft salvage style (fence-strip, `{`..`}` slice, array coercion).

The LLM returns JSON for two shapes: a **GraphSpec** (topic graph) and a **Lesson**. Parsers must never throw — they salvage or return a safe empty shape.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseGraphSpec, parseLesson } from "./learnTypes";

describe("parseGraphSpec", () => {
  it("parses a fenced JSON graph", () => {
    const raw = "```json\n" + JSON.stringify({
      summary: "Learn photography",
      nodes: [
        { key: "a", title: "Exposure", objective: "Be able to set exposure", bloom_level: "apply", level: "basics" },
        { key: "b", title: "Composition", objective: "Compose shots", bloom_level: "create", level: "intermediate", prereqs: ["a"] },
      ],
    }) + "\n```";
    const g = parseGraphSpec(raw);
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes[1].prereqs).toEqual(["a"]);
    expect(g.summary).toBe("Learn photography");
  });

  it("salvages prose-wrapped JSON and coerces missing arrays", () => {
    const raw = 'Sure! Here is your tree: {"nodes":[{"key":"x","title":"X","level":"basics"}]} hope it helps';
    const g = parseGraphSpec(raw);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].prereqs).toEqual([]);
  });

  it("returns an empty graph on garbage", () => {
    expect(parseGraphSpec("no json here").nodes).toEqual([]);
  });
});

describe("parseLesson", () => {
  it("parses a lesson and coerces all arrays", () => {
    const raw = JSON.stringify({
      objective: "Balance the exposure triangle",
      concept_chunks: [{ tag: "Concept", body: "Light is a bucket." }],
      worked_example: { title: "Sunset", steps: [{ text: "Set f/11", why: "deep DoF" }] },
      key_terms: ["Aperture", "ISO"],
      suggested_resources: [{ type: "video", title: "Exposure 101", search_query: "exposure triangle" }],
      recall_check: [{ prompt: "Widen aperture — fix shutter how?", expected: "speed it up", concept: "reciprocity" }],
    });
    const l = parseLesson(raw);
    expect(l.concept_chunks).toHaveLength(1);
    expect(l.recall_check[0].concept).toBe("reciprocity");
  });

  it("never throws; missing fields become safe empties", () => {
    const l = parseLesson("{}");
    expect(l.objective).toBe("");
    expect(l.concept_chunks).toEqual([]);
    expect(l.recall_check).toEqual([]);
    expect(l.worked_example).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/learnTypes.test.ts`
Expected: FAIL ("Cannot find module ./learnTypes").

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/learnTypes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/learnTypes.ts src/apps/archives/learn/learnTypes.test.ts
git commit -m "feat(learn): types + fail-soft graph/lesson parsers"
```

---

## Task 3: bkt.ts — Bayesian Knowledge Tracing (pure)

**Files:**
- Create: `src/apps/archives/learn/bkt.ts`
- Test: `src/apps/archives/learn/bkt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { bktUpdate, BKT_DEFAULTS, MASTERY_THRESHOLD } from "./bkt";

describe("bktUpdate", () => {
  it("raises mastery on a correct answer", () => {
    const next = bktUpdate(0.3, true);
    expect(next).toBeGreaterThan(0.3);
    expect(next).toBeLessThanOrEqual(1);
  });

  it("lowers the posterior on an incorrect answer", () => {
    // After an incorrect answer the transit can nudge up slightly, but the
    // evidence component must pull the posterior below the no-evidence value.
    const correct = bktUpdate(0.5, true);
    const incorrect = bktUpdate(0.5, false);
    expect(incorrect).toBeLessThan(correct);
  });

  it("stays within [0,1]", () => {
    expect(bktUpdate(0.99, true)).toBeLessThanOrEqual(1);
    expect(bktUpdate(0.01, false)).toBeGreaterThanOrEqual(0);
  });

  it("converges above threshold after repeated correct answers", () => {
    let p = BKT_DEFAULTS.pInit;
    for (let i = 0; i < 5; i++) p = bktUpdate(p, true);
    expect(p).toBeGreaterThanOrEqual(MASTERY_THRESHOLD);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/bkt.test.ts`
Expected: FAIL ("Cannot find module ./bkt").

- [ ] **Step 3: Write the implementation**

```ts
// src/apps/archives/learn/bkt.ts
// Bayesian Knowledge Tracing — a 2-state HMM mastery estimate per concept.

export const BKT_DEFAULTS = {
  pInit: 0.3,     // prior P(known) for a fresh concept
  pTransit: 0.15, // P(learn) per opportunity
  pSlip: 0.1,     // P(wrong | known)
  pGuess: 0.2,    // P(right | not known)
};

export const MASTERY_THRESHOLD = 0.8;
export const MIN_ATTEMPTS = 3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Update P(mastery) given the prior and whether the latest answer was correct. */
export function bktUpdate(prior: number, correct: boolean, params = BKT_DEFAULTS): number {
  const p = clamp01(prior);
  const { pTransit, pSlip, pGuess } = params;
  let posterior: number;
  if (correct) {
    const num = p * (1 - pSlip);
    const den = p * (1 - pSlip) + (1 - p) * pGuess;
    posterior = den === 0 ? p : num / den;
  } else {
    const num = p * pSlip;
    const den = p * pSlip + (1 - p) * (1 - pGuess);
    posterior = den === 0 ? p : num / den;
  }
  return clamp01(posterior + (1 - posterior) * pTransit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/bkt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/bkt.ts src/apps/archives/learn/bkt.test.ts
git commit -m "feat(learn): BKT mastery update (pure, tested)"
```

---

## Task 4: gating.ts — unlock gating + forgetting decay (pure)

**Files:**
- Create: `src/apps/archives/learn/gating.ts`
- Test: `src/apps/archives/learn/gating.test.ts`

A node is `ready` when ALL its prerequisites are mastered (`p_mastery ≥ threshold` AND `attempts ≥ MIN_ATTEMPTS`). Nodes with no prereqs are `ready` from the start (unless already mastered/in-progress). `effectiveMastery` applies time decay so mastered concepts cool and resurface for review.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { recomputeStatuses, effectiveMastery, needsReview } from "./gating";
import type { NodeRow, EdgeRow } from "./learnTypes";

const node = (id: string, over: Partial<NodeRow> = {}): NodeRow => ({
  id, topic_id: "t", title: id, objective: null, bloom_level: null, level: "basics",
  order_idx: 0, lesson_json: null, lesson_at: null, p_mastery: 0, attempts: 0, last_seen: null, status: "locked", ...over,
});

describe("recomputeStatuses", () => {
  it("marks prereq-free nodes ready and dependents locked", () => {
    const nodes = [node("a"), node("b")];
    const edges: EdgeRow[] = [{ topic_id: "t", from_node: "a", to_node: "b" }];
    const out = recomputeStatuses(nodes, edges);
    expect(out.find((n) => n.id === "a")!.status).toBe("ready");
    expect(out.find((n) => n.id === "b")!.status).toBe("locked");
  });

  it("unlocks a dependent once its prereq is mastered", () => {
    const nodes = [node("a", { p_mastery: 0.9, attempts: 4 }), node("b")];
    const edges: EdgeRow[] = [{ topic_id: "t", from_node: "a", to_node: "b" }];
    const out = recomputeStatuses(nodes, edges);
    expect(out.find((n) => n.id === "a")!.status).toBe("mastered");
    expect(out.find((n) => n.id === "b")!.status).toBe("ready");
  });

  it("does not unlock on a lucky guess (attempts < MIN)", () => {
    const nodes = [node("a", { p_mastery: 0.95, attempts: 1 }), node("b")];
    const edges: EdgeRow[] = [{ topic_id: "t", from_node: "a", to_node: "b" }];
    const out = recomputeStatuses(nodes, edges);
    expect(out.find((n) => n.id === "b")!.status).toBe("locked");
  });

  it("preserves in_progress for a started-but-unmastered node", () => {
    const nodes = [node("a", { p_mastery: 0.4, attempts: 2, status: "in_progress" })];
    const out = recomputeStatuses(nodes, []);
    expect(out[0].status).toBe("in_progress");
  });
});

describe("effectiveMastery / needsReview", () => {
  it("decays mastery with age but never below 0", () => {
    const now = 1_000_000_000_000;
    const monthAgo = now - 30 * 86_400_000;
    expect(effectiveMastery(0.9, monthAgo, now)).toBeLessThan(0.9);
    expect(effectiveMastery(0.9, monthAgo, now)).toBeGreaterThanOrEqual(0);
  });

  it("flags a mastered node for review once decayed below the review band", () => {
    const now = 1_000_000_000_000;
    const longAgo = now - 120 * 86_400_000;
    expect(needsReview({ p_mastery: 0.85, last_seen: longAgo } as any, now)).toBe(true);
    expect(needsReview({ p_mastery: 0.85, last_seen: now } as any, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/gating.test.ts`
Expected: FAIL ("Cannot find module ./gating").

- [ ] **Step 3: Write the implementation**

```ts
// src/apps/archives/learn/gating.ts
import type { NodeRow, EdgeRow } from "./learnTypes";
import { MASTERY_THRESHOLD, MIN_ATTEMPTS } from "./bkt";

const DECAY_PER_DAY = 0.004;       // slow cooling of mastery
const REVIEW_BAND = 0.7;            // mastered node drops below this -> review
const DAY = 86_400_000;

export function isMastered(n: Pick<NodeRow, "p_mastery" | "attempts">): boolean {
  return n.p_mastery >= MASTERY_THRESHOLD && n.attempts >= MIN_ATTEMPTS;
}

/** Recompute every node's status from mastery + prerequisite edges. Pure; returns new rows. */
export function recomputeStatuses(nodes: NodeRow[], edges: EdgeRow[]): NodeRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const prereqs = new Map<string, string[]>();
  for (const e of edges) {
    const list = prereqs.get(e.to_node) ?? [];
    list.push(e.from_node);
    prereqs.set(e.to_node, list);
  }
  return nodes.map((n) => {
    if (isMastered(n)) return { ...n, status: "mastered" as const };
    if (n.status === "in_progress") return n;
    const reqs = prereqs.get(n.id) ?? [];
    const unlocked = reqs.every((id) => {
      const p = byId.get(id);
      return p ? isMastered(p) : false;
    });
    return { ...n, status: unlocked ? ("ready" as const) : ("locked" as const) };
  });
}

/** Time-decayed mastery used for review surfacing (does NOT mutate the stored p_mastery). */
export function effectiveMastery(pMastery: number, lastSeen: number | null, now: number): number {
  if (lastSeen == null) return pMastery;
  const days = Math.max(0, (now - lastSeen) / DAY);
  return Math.max(0, pMastery - days * DECAY_PER_DAY);
}

export function needsReview(n: Pick<NodeRow, "p_mastery" | "attempts" | "last_seen">, now: number): boolean {
  if (!isMastered(n as NodeRow)) return false;
  return effectiveMastery(n.p_mastery, n.last_seen ?? null, now) < REVIEW_BAND;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/gating.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/gating.ts src/apps/archives/learn/gating.test.ts
git commit -m "feat(learn): unlock gating + forgetting-decay review (pure, tested)"
```

---

## Task 5: forceLayout.ts — force-directed physics (pure)

**Files:**
- Create: `src/apps/archives/learn/forceLayout.ts`
- Test: `src/apps/archives/learn/forceLayout.test.ts`

A minimal force simulation: charge repulsion (all pairs), spring attraction (edges), centering pull. One `stepForces` advances positions by one tick; the component calls it in a rAF loop. Pure and deterministic given inputs (no randomness inside — initial positions are passed in).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { stepForces, initialPositions, type SimNode, type SimEdge } from "./forceLayout";

describe("initialPositions", () => {
  it("places n nodes deterministically on a circle around the center", () => {
    const pos = initialPositions(["a", "b", "c"], 100, 100);
    expect(Object.keys(pos)).toHaveLength(3);
    expect(pos.a).toHaveProperty("x");
    // deterministic: same call -> same coords
    expect(initialPositions(["a", "b", "c"], 100, 100)).toEqual(pos);
  });
});

describe("stepForces", () => {
  it("pushes two overlapping unconnected nodes apart", () => {
    const nodes: SimNode[] = [
      { id: "a", x: 100, y: 100, vx: 0, vy: 0 },
      { id: "b", x: 101, y: 100, vx: 0, vy: 0 },
    ];
    const before = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
    let n = nodes;
    for (let i = 0; i < 20; i++) n = stepForces(n, [], 200, 200);
    const after = Math.hypot(n[0].x - n[1].x, n[0].y - n[1].y);
    expect(after).toBeGreaterThan(before);
  });

  it("pulls two far-apart connected nodes closer", () => {
    const nodes: SimNode[] = [
      { id: "a", x: 20, y: 100, vx: 0, vy: 0 },
      { id: "b", x: 380, y: 100, vx: 0, vy: 0 },
    ];
    const edges: SimEdge[] = [{ from: "a", to: "b" }];
    const before = Math.abs(nodes[0].x - nodes[1].x);
    let n = nodes;
    for (let i = 0; i < 40; i++) n = stepForces(n, edges, 400, 200);
    const after = Math.abs(n[0].x - n[1].x);
    expect(after).toBeLessThan(before);
  });

  it("keeps coordinates finite", () => {
    let n: SimNode[] = [{ id: "a", x: 50, y: 50, vx: 0, vy: 0 }, { id: "b", x: 50, y: 50, vx: 0, vy: 0 }];
    for (let i = 0; i < 50; i++) n = stepForces(n, [], 100, 100);
    for (const node of n) { expect(Number.isFinite(node.x)).toBe(true); expect(Number.isFinite(node.y)).toBe(true); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/forceLayout.test.ts`
Expected: FAIL ("Cannot find module ./forceLayout").

- [ ] **Step 3: Write the implementation**

```ts
// src/apps/archives/learn/forceLayout.ts
export type SimNode = { id: string; x: number; y: number; vx: number; vy: number; fixed?: boolean };
export type SimEdge = { from: string; to: string };

const REPULSION = 6000;   // charge strength
const SPRING = 0.02;      // edge stiffness
const REST_LEN = 120;     // desired edge length
const CENTER_PULL = 0.01; // gravity toward center
const DAMPING = 0.85;     // velocity damping per tick
const MAX_V = 30;

const clampV = (v: number) => Math.max(-MAX_V, Math.min(MAX_V, v));

/** Deterministic ring layout around the center; used to seed the sim. */
export function initialPositions(ids: string[], w: number, h: number): Record<string, { x: number; y: number }> {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3 || 1;
  const out: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2;
    out[id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  return out;
}

/** Advance the simulation by one tick. Returns NEW node objects (pure). */
export function stepForces(nodes: SimNode[], edges: SimEdge[], w: number, h: number): SimNode[] {
  const cx = w / 2, cy = h / 2;
  const next = nodes.map((n) => ({ ...n }));
  const byId = new Map(next.map((n) => [n.id, n]));

  // pairwise repulsion
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      const a = next[i], b = next[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) { dx = (i - j) || 1; dy = 1; d2 = dx * dx + dy * dy; }
      const f = REPULSION / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
  }
  // spring attraction along edges
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = SPRING * (d - REST_LEN);
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  }
  // centering + integrate
  for (const n of next) {
    if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
    n.vx += (cx - n.x) * CENTER_PULL;
    n.vy += (cy - n.y) * CENTER_PULL;
    n.vx = clampV(n.vx * DAMPING);
    n.vy = clampV(n.vy * DAMPING);
    n.x += n.vx;
    n.y += n.vy;
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/forceLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/forceLayout.ts src/apps/archives/learn/forceLayout.test.ts
git commit -m "feat(learn): hand-rolled force-directed layout (pure, tested)"
```

---

## Task 6: pedagogy.ts — the master-teacher prompts (research-first)

**Files:**
- Create: `src/apps/archives/learn/pedagogy.ts`
- Reference: spec §9; the research synthesis embedded in the spec.

> **This task begins with a GitHub/community survey (user requirement).** Before writing prompts, use WebSearch + WebFetch to find existing open-source teaching/tutor skills and system prompts to adapt — e.g. the Vanderbilt `knowledge-spaces` Claude skills, Anthropic skill collections, "awesome-prompts"/Socratic-tutor repos. Note any borrowed material's license in a comment. Adapt the best; do not invent from scratch where a vetted prompt exists.

- [ ] **Step 1: GitHub/community survey** — search for and skim 3–5 candidate teaching prompts/skills. Write a 5-line comment block at the top of `pedagogy.ts` listing what was reviewed and what was adapted (+ license notes).

- [ ] **Step 2: Implement the prompt builders** — pure functions returning strings. Encode the spec §9 techniques as explicit instructions. Signature contract (used by Task 7):

```ts
// src/apps/archives/learn/pedagogy.ts
export const PEDAGOGY_VERSION = "1.0.0";

/** System+user prompt to generate the topic's prerequisite graph as GraphSpec JSON. */
export function graphPrompt(topic: string): string { /* backward design + DAG + Bloom; returns instructions to emit ONLY the JSON shape parseGraphSpec expects */ }

/** Prompt to generate one node's Lesson JSON. */
export function lessonPrompt(args: { topic: string; nodeTitle: string; objective: string; level: string; priorTitles: string[] }): string { /* ABCD objective, ≤3-5 chunks, worked example w/ rationale, key terms, suggested resources (no URLs), 2-4 recall questions; emit ONLY the Lesson JSON shape */ }

/** Prompt to grade a free-text recall answer. Returns instructions to emit {correct, partial, missed_concepts}. */
export function gradePrompt(args: { question: string; expected: string; concept: string; answer: string }): string { /* partial credit + name missed sub-concepts */ }

/** System prompt for the scoped Socratic tutor (passed to claude_send). */
export function tutorSystemPrompt(args: { topic: string; nodeTitle: string; objective: string; lessonSummary: string; recentMisses: string[] }): string { /* one guiding question first, escalating hints, answer only after attempts/explicit ask; gradual release; process praise; explain-it-back */ }

/** Prompt to fetch REAL resource links via web search. Returns instructions to emit a resources[] array of {type,title,url}. */
export function findLinksPrompt(args: { topic: string; nodeTitle: string; keyTerms: string[] }): string { /* must use web search; only return URLs actually found */ }
```

Fill the bodies with concrete, carefully-worded prompts implementing the techniques. Each generation prompt MUST end with a strict "Return ONLY valid JSON matching this exact shape: …" instruction matching the parsers in Task 2.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/apps/archives/learn/pedagogy.ts
git commit -m "feat(learn): pedagogy engine v1 — master-teacher prompts (GitHub-surveyed)"
```

---

## Task 7: Rust `learn_claude_call` + ipc wrapper

**Files:**
- Read first: `src-tauri/src/repolens.rs` — the `repolens_claude_call` command (the verified `printf … | claude -p --output-format json --model …`, stdin-not-argv, `.result`/`.is_error` envelope parse). Also how it's registered in `src-tauri/src/lib.rs` `invoke_handler`.
- Create: `src-tauri/src/learn.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod learn;` + register the command), `src/lib/ipc.ts` (add wrapper).

- [ ] **Step 1: Implement `learn_claude_call`** mirroring `repolens_claude_call`, adding an `allow_web: bool` param. When `allow_web` is false, keep the same flags as repolens (incl. `--strict-mcp-config`). When true, enable the CLI's web search instead (drop `--strict-mcp-config` and pass `--allowedTools WebSearch`, matching how the repolens website ripper enables tools — confirm exact flags against `repolens_website.rs`). Same return shape `{ result: String, cost: f64, model: String }`.

- [ ] **Step 2: Register** `mod learn;` and add `learn::learn_claude_call` to the `invoke_handler![]` list in `lib.rs`.

- [ ] **Step 3: Add the ipc wrapper** in `src/lib/ipc.ts`:

```ts
export async function learnClaudeCall(prompt: string, model: string, allowWeb = false): Promise<{ result: string; cost: number; model: string }> {
  return invoke("learn_claude_call", { prompt, model, allowWeb });
}
```
(Match the existing `repolensClaudeCall` wrapper's casing/param convention exactly.)

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo check` → PASS. Then `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/learn.rs src-tauri/src/lib.rs src/lib/ipc.ts
git commit -m "feat(learn): learn_claude_call Rust command + ipc (web-search optional)

Needs a tauri dev restart (new Rust command)."
```

---

## Task 8: claude.ts — serialized generation calls

**Files:**
- Create: `src/apps/archives/learn/claude.ts`
- Test: `src/apps/archives/learn/claude.test.ts` (test the queue serialization + parser wiring with a mocked `ipc`)
- Read first: `src/apps/archives/repolens/claude.ts` (copy the 1.2s-gap single-flight chain).

- [ ] **Step 1: Write the failing test** (mocking `../../../lib/ipc`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/ipc", () => ({
  learnClaudeCall: vi.fn(),
}));
import { learnClaudeCall } from "../../../lib/ipc";
import { generateGraph, gradeAnswer } from "./claude";

beforeEach(() => vi.clearAllMocks());

describe("generateGraph", () => {
  it("parses the model reply into a GraphSpec", async () => {
    (learnClaudeCall as any).mockResolvedValue({ result: JSON.stringify({ summary: "s", nodes: [{ key: "a", title: "A", level: "basics" }] }), cost: 0, model: "m" });
    const g = await generateGraph("Photography", "model-x");
    expect(g.nodes).toHaveLength(1);
    expect(learnClaudeCall).toHaveBeenCalledTimes(1);
  });
});

describe("gradeAnswer", () => {
  it("returns a structured grade and defaults to incorrect on garbage", async () => {
    (learnClaudeCall as any).mockResolvedValue({ result: "not json", cost: 0, model: "m" });
    const grade = await gradeAnswer({ question: "q", expected: "e", concept: "c", answer: "a" }, "model-x");
    expect(grade.correct).toBe(false);
    expect(Array.isArray(grade.missed_concepts)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/claude.test.ts`
Expected: FAIL ("Cannot find module ./claude").

- [ ] **Step 3: Implement**

```ts
// src/apps/archives/learn/claude.ts
import { learnClaudeCall } from "../../../lib/ipc";
import { parseGraphSpec, parseLesson, type GraphSpec, type Lesson } from "./learnTypes";
import { graphPrompt, lessonPrompt, gradePrompt, findLinksPrompt } from "./pedagogy";

const MIN_GAP_MS = 1200;
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run as Promise<T>;
}

export async function generateGraph(topic: string, model: string): Promise<GraphSpec> {
  const reply = await enqueue(() => learnClaudeCall(graphPrompt(topic), model, false));
  return parseGraphSpec(reply.result);
}

export async function generateLesson(args: { topic: string; nodeTitle: string; objective: string; level: string; priorTitles: string[] }, model: string): Promise<Lesson> {
  const reply = await enqueue(() => learnClaudeCall(lessonPrompt(args), model, false));
  return parseLesson(reply.result);
}

export type Grade = { correct: boolean; partial: boolean; missed_concepts: string[] };
export async function gradeAnswer(args: { question: string; expected: string; concept: string; answer: string }, model: string): Promise<Grade> {
  const reply = await enqueue(() => learnClaudeCall(gradePrompt(args), model, false));
  try {
    const s = reply.result; const a = s.indexOf("{"); const b = s.lastIndexOf("}");
    const o = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : {};
    return { correct: !!o.correct, partial: !!o.partial, missed_concepts: Array.isArray(o.missed_concepts) ? o.missed_concepts.map(String) : [] };
  } catch {
    return { correct: false, partial: false, missed_concepts: [] };
  }
}

export async function findRealLinks(args: { topic: string; nodeTitle: string; keyTerms: string[] }, model: string): Promise<Array<{ type: string; title: string; url: string }>> {
  const reply = await enqueue(() => learnClaudeCall(findLinksPrompt(args), model, true)); // allow_web
  try {
    const s = reply.result; const a = s.indexOf("["); const b = s.lastIndexOf("]");
    const arr = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : [];
    return Array.isArray(arr) ? arr.filter((r: any) => r?.url).map((r: any) => ({ type: String(r.type ?? "article"), title: String(r.title ?? r.url), url: String(r.url) })) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/claude.ts src/apps/archives/learn/claude.test.ts
git commit -m "feat(learn): serialized generation calls (graph/lesson/grade/find-links)"
```

---

## Task 9: learnDb.ts — SQLite CRUD

**Files:**
- Create: `src/apps/archives/learn/learnDb.ts`
- Read first: `src/apps/archives/repolens/repolensDb.ts` and `src/lib/db.ts` (`getDb()` + select/execute pattern).

- [ ] **Step 1: Implement CRUD** (no separate unit test — thin DB I/O, verified via the store + smoke test). Functions:

```ts
// src/apps/archives/learn/learnDb.ts
import { getDb } from "../../../lib/db";
import type { TopicRow, NodeRow, EdgeRow, ReviewRow } from "./learnTypes";

export async function listTopics(): Promise<TopicRow[]> {
  const db = await getDb();
  return db.select<TopicRow[]>("SELECT * FROM learn_topics WHERE status='active' ORDER BY updated_at DESC", []);
}
export async function insertTopic(r: TopicRow): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT INTO learn_topics (id,title,summary,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [r.id, r.title, r.summary, r.status, r.created_at, r.updated_at]);
}
export async function deleteTopic(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM learn_reviews WHERE node_id IN (SELECT id FROM learn_nodes WHERE topic_id=$1)", [id]);
  await db.execute("DELETE FROM learn_nodes WHERE topic_id=$1", [id]);
  await db.execute("DELETE FROM learn_edges WHERE topic_id=$1", [id]);
  await db.execute("DELETE FROM learn_topics WHERE id=$1", [id]);
}
export async function listNodes(topicId: string): Promise<NodeRow[]> {
  const db = await getDb();
  return db.select<NodeRow[]>("SELECT * FROM learn_nodes WHERE topic_id=$1 ORDER BY order_idx", [topicId]);
}
export async function insertNode(r: NodeRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO learn_nodes (id,topic_id,title,objective,bloom_level,level,order_idx,lesson_json,lesson_at,p_mastery,attempts,last_seen,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [r.id, r.topic_id, r.title, r.objective, r.bloom_level, r.level, r.order_idx, r.lesson_json, r.lesson_at, r.p_mastery, r.attempts, r.last_seen, r.status]);
}
export async function updateNode(id: string, patch: Partial<NodeRow>): Promise<void> {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const db = await getDb();
  const set = cols.map((c, i) => `${c}=$${i + 2}`).join(",");
  await db.execute(`UPDATE learn_nodes SET ${set} WHERE id=$1`, [id, ...cols.map((c) => (patch as any)[c])]);
}
export async function insertEdge(e: EdgeRow): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO learn_edges (topic_id,from_node,to_node) VALUES ($1,$2,$3)", [e.topic_id, e.from_node, e.to_node]);
}
export async function listEdges(topicId: string): Promise<EdgeRow[]> {
  const db = await getDb();
  return db.select<EdgeRow[]>("SELECT * FROM learn_edges WHERE topic_id=$1", [topicId]);
}
export async function insertReview(r: ReviewRow): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT INTO learn_reviews (id,node_id,ts,correct,kind) VALUES ($1,$2,$3,$4,$5)", [r.id, r.node_id, r.ts, r.correct, r.kind]);
}
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/learn/learnDb.ts
git commit -m "feat(learn): SQLite CRUD helpers"
```

---

## Task 10: useLearn.ts — the store

**Files:**
- Create: `src/apps/archives/learn/useLearn.ts`
- Test: `src/apps/archives/learn/useLearn.test.ts` (reducer-style: mock db + claude, assert the create→graph→gate flow and the answer→bkt→gate flow)
- Read first: `src/apps/archives/repolens/useRepoLens.ts` (store shape, optimistic updates, prefs hydration) and `src/lib/models.ts` + `useModelPrefs` (model selection).

The store holds topics, the open topic's nodes+edges, the open node id, generation flags, and orchestrates: `createTopic`, `openTopic`, `openNode` (generate-lesson-on-first-open), `submitAnswer` (grade → bkt → review log → recompute → persist), `findLinks`. Use `ulid()` for ids (match how repolens/notes generate ids).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./learnDb", () => ({
  listTopics: vi.fn().mockResolvedValue([]),
  insertTopic: vi.fn().mockResolvedValue(undefined),
  insertNode: vi.fn().mockResolvedValue(undefined),
  insertEdge: vi.fn().mockResolvedValue(undefined),
  listNodes: vi.fn().mockResolvedValue([]),
  listEdges: vi.fn().mockResolvedValue([]),
  updateNode: vi.fn().mockResolvedValue(undefined),
  insertReview: vi.fn().mockResolvedValue(undefined),
  deleteTopic: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./claude", () => ({
  generateGraph: vi.fn().mockResolvedValue({ summary: "s", nodes: [
    { key: "a", title: "A", objective: "o", bloom_level: "remember", level: "basics", prereqs: [] },
    { key: "b", title: "B", objective: "o", bloom_level: "apply", level: "intermediate", prereqs: ["a"] },
  ]}),
  generateLesson: vi.fn().mockResolvedValue({ objective: "o", concept_chunks: [], worked_example: null, key_terms: [], suggested_resources: [], recall_check: [] }),
  gradeAnswer: vi.fn().mockResolvedValue({ correct: true, partial: false, missed_concepts: [] }),
  findRealLinks: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../lib/models", () => ({ MODELS: [], }));

import { useLearn } from "./useLearn";

beforeEach(() => { useLearn.setState(useLearn.getInitialState ? useLearn.getInitialState() : {} as any, true); });

describe("createTopic", () => {
  it("generates a graph, persists nodes+edges, and gates the dependent node locked", async () => {
    await useLearn.getState().createTopic("Photography");
    const s = useLearn.getState();
    const nodes = Object.values(s.nodes);
    expect(nodes).toHaveLength(2);
    const a = nodes.find((n: any) => n.title === "A")!;
    const b = nodes.find((n: any) => n.title === "B")!;
    expect(a.status).toBe("ready");
    expect(b.status).toBe("locked");
  });
});

describe("submitAnswer", () => {
  it("raises mastery and eventually unlocks the dependent after enough correct attempts", async () => {
    await useLearn.getState().createTopic("Photography");
    const a = Object.values(useLearn.getState().nodes).find((n: any) => n.title === "A")! as any;
    for (let i = 0; i < 4; i++) {
      await useLearn.getState().submitAnswer(a.id, { question: "q", expected: "e", concept: "c", answer: "yes" });
    }
    const nodes = Object.values(useLearn.getState().nodes) as any[];
    expect(nodes.find((n) => n.title === "A")!.status).toBe("mastered");
    expect(nodes.find((n) => n.title === "B")!.status).toBe("ready");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/useLearn.test.ts`
Expected: FAIL ("Cannot find module ./useLearn").

- [ ] **Step 3: Implement the store** — `nodes`/`edges` as `Record<id, Row>` for easy patching; `recomputeStatuses` (Task 4) runs after create and after every answer; `submitAnswer` does `bktUpdate` (Task 3) → bump `attempts` + set `last_seen` → `insertReview` → `recomputeStatuses` over the full set → persist changed rows via `updateNode`. `createTopic` resolves `prereqs` (LLM keys) to real node ids when building edges. `openNode` generates+caches the lesson if `lesson_json` is null and sets the node `in_progress`. Provide `getInitialState()` returning the default slice so the test reset works.

Key signatures the UI relies on:
```ts
type Grade = { correct: boolean; partial: boolean; missed_concepts: string[] };
interface LearnState {
  topics: Record<string, TopicRow>;
  openTopicId: string | null;
  nodes: Record<string, NodeRow>;
  edges: EdgeRow[];
  openNodeId: string | null;
  generatingGraph: boolean;
  generatingLesson: boolean;
  recentMisses: string[];               // accumulates missed_concepts for the tutor
  loadTopics: () => Promise<void>;
  createTopic: (title: string) => Promise<void>;
  openTopic: (id: string) => Promise<void>;
  openNode: (id: string) => Promise<void>;
  closeNode: () => void;
  submitAnswer: (nodeId: string, q: { question: string; expected: string; concept: string; answer: string }) => Promise<Grade>;
  findLinks: (nodeId: string) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/useLearn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/useLearn.ts src/apps/archives/learn/useLearn.test.ts
git commit -m "feat(learn): useLearn store — create/open/answer/gate orchestration"
```

---

## Task 11: Register the section (view + sidebar + shell) + tokens

**Files:**
- Modify: `src/apps/archives/useArchives.ts` (add `"learn"` to the `ArchivesView` union, ~lines 3-13)
- Modify: `src/apps/archives/ArchivesApp.tsx` (add to the `LIBRARY` array ~lines 49-65 with a `GraduationCap` lucide icon; add a route to `<LearnView>` in the content router ~lines 333-344)
- Create: `src/apps/archives/learn/LearnView.tsx` (shell only this task — topic rail + empty-state + "＋ Learn something new" input; renders constellation/lesson in later tasks)
- Modify: `src/styles/tokens.css` (add `--learn-accent: var(--neon-violet);` + `--learn-accent-rgb: var(--neon-violet-rgb);` near the `--repolens-green` block ~lines 29-31; scope `.learn-view { --lr: var(--learn-accent); --lr-rgb: var(--learn-accent-rgb); }`)

- [ ] **Step 1:** Add `"learn"` to `ArchivesView`. Run `npx tsc --noEmit` — expect errors only where the union is exhaustively switched (fix those by adding a `learn` branch).
- [ ] **Step 2:** Add the sidebar entry + route. Build a minimal `LearnView` that calls `useLearn().loadTopics()` on mount, shows the topic rail + a create input wired to `createTopic`, and a placeholder body.
- [ ] **Step 3:** Add the tokens + `.learn-view` scope.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` → PASS; `npm run build` → PASS.
- [ ] **Step 5: User smoke-test gate** — after a `tauri dev` restart: Archives sidebar shows **Learn**; clicking it shows the topic rail; typing a topic + Enter creates it and a constellation placeholder appears. (Agent can't run Tauri — flag for user.)
- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/useArchives.ts src/apps/archives/ArchivesApp.tsx src/apps/archives/learn/LearnView.tsx src/styles/tokens.css
git commit -m "feat(learn): register Learn section (view + sidebar + shell + violet tokens)

Needs a tauri dev restart (migration 0024 must be applied)."
```

---

## Task 12: Constellation.tsx — force-directed graph (frontend-design)

**Files:**
- Create: `src/apps/archives/learn/Constellation.tsx`
- Modify: `src/styles/tokens.css` (`.learn-constellation`, node/edge classes)
- Uses: `forceLayout.ts` (Task 5), `gating.needsReview` (Task 4), `useLearn` nodes/edges.

- [ ] **Step 1:** Build the SVG graph: seed positions with `initialPositions`, run `stepForces` in a `requestAnimationFrame` loop in a `useEffect`, stop the loop when settled (max velocity < epsilon) and on unmount; **pause when `document.hidden`** (mirror the wallpaper's visibility handling). Guard `prefers-reduced-motion` → run a fixed number of synchronous steps then render static.
- [ ] **Step 2:** Render edges as `<line>`/`<path>`, nodes as `<g>` with a circle + label. Color by `status` (mastered=violet+glow, ready=outlined bright, in_progress=partial, locked=dim); size/glow scale with `p_mastery`; a pulse ring when `needsReview(node, Date.now())`. Hover lights incident edges.
- [ ] **Step 3:** Interaction — drag a node (set it `fixed` while dragging, update its x/y from pointer; release un-fixes), wheel to zoom (scale transform on a `<g>`), drag empty space to pan. Click a non-locked node → `useLearn().openNode(id)`; clicking a locked node toasts "Master its prerequisites first."
- [ ] **Step 4:** **Invoke the frontend-design skill** to bring this to production quality against the violet tokens — glow, motion, depth, the neo-Tokyo feel. This is the headline view; quality bar is high.
- [ ] **Step 5: Verify** — `npx tsc --noEmit` + `npm run build` → PASS.
- [ ] **Step 6: User smoke-test gate** — create a topic; the constellation animates into a settled web; nodes show correct states; drag/zoom/pan work; clicking a ready node opens its lesson; reduced-motion shows a static layout.
- [ ] **Step 7: Commit**

```bash
git add src/apps/archives/learn/Constellation.tsx src/styles/tokens.css
git commit -m "feat(learn): Obsidian-style force-directed constellation"
```

---

## Task 13: LessonView.tsx — lesson page (frontend-design)

**Files:**
- Create: `src/apps/archives/learn/LessonView.tsx`
- Modify: `src/styles/tokens.css` (`.learn-lesson` + section classes)
- Uses: `useLearn` (openNode generates/caches lesson; submitAnswer grades), the `Lesson` type, `react-markdown`/`remark-gfm`/`rehype-highlight` for chunk bodies.

- [ ] **Step 1:** Render the lesson anatomy from `lesson_json`: breadcrumb → objective banner → segmented progress → `concept_chunks` (one revealed at a time with a Continue button; key terms highlightable) → `worked_example` (steps + per-step "why") → `key_terms` chips → `suggested_resources` list with a **"Find real links"** button calling `useLearn().findLinks(nodeId)` (shows a spinner; replaces suggestions with returned URLs) → `recall_check`: each question is **answer-first** (textarea + reveal), Submit calls `submitAnswer` and shows the grade (correct/partial + missed concepts) with a mastery delta. While generating, show a skeleton; on parse-empty, show a "regenerate" affordance.
- [ ] **Step 2:** A back-to-constellation control; show the node's live `p_mastery` as a small meter.
- [ ] **Step 3:** **Invoke the frontend-design skill** for production styling against the violet tokens (the polish level of the existing RepoLens cards or better — the user explicitly cares about this).
- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run build` → PASS.
- [ ] **Step 5: User smoke-test gate** — open a node: lesson generates and renders; chunks advance; recall check grades and bumps mastery; "Find real links" returns clickable URLs; mastering enough unlocks the next node in the constellation.
- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/learn/LessonView.tsx src/styles/tokens.css
git commit -m "feat(learn): lesson page — anatomy, recall checks, find-real-links"
```

---

## Task 14: TutorPanel.tsx — scoped streaming tutor

**Files:**
- Create: `src/apps/archives/learn/TutorPanel.tsx`
- Modify: `src/styles/tokens.css` (`.learn-tutor`)
- Read first: how `ClaudeChat` / the Archives rail calls `claudeSend` (chatId, prompt, system/context, sessionId, model) and renders streaming tokens; reuse that mechanism. Use `tutorSystemPrompt` (Task 6) seeded with the open node + `recentMisses` from the store.

- [ ] **Step 1:** A chat panel scoped to the open lesson: a unique chatId per node (e.g. `learn-tutor-<nodeId>`), system prompt from `tutorSystemPrompt`, streaming reply rendering (reuse the existing markdown streaming used by the rails). Quick-action buttons (Hint · Explain it back · Simpler · Deeper) send canned user turns. Per-section model picker via `useModelPrefs` keyed `"learn"`.
- [ ] **Step 2:** Mount it as the right-hand panel inside `LessonView` (lesson spine left, tutor right — the approved layout). Collapsible.
- [ ] **Step 3:** **Invoke the frontend-design skill** for styling against violet tokens, consistent with the other Claude rails.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run build` → PASS.
- [ ] **Step 5: User smoke-test gate** — open a lesson, ask the tutor a question → it streams a Socratic reply (a guiding question, not the full answer); quick actions work; the answer reveals only after attempts/explicit ask.
- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/learn/TutorPanel.tsx src/styles/tokens.css
git commit -m "feat(learn): scoped Socratic streaming tutor panel"
```

---

## Task 15: Final integration review

- [ ] **Step 1:** Full gate sweep — `npx tsc --noEmit`, `npx vitest run` (all learn tests green + total count up), `cd src-tauri && cargo check`, `npm run build`. Gate on real exit codes.
- [ ] **Step 2:** Invoke **superpowers:requesting-code-review** for a holistic review of the section (correctness of the BKT→gate loop, fail-soft parsing, no silent failures in generation, visibility-pause on the rAF loop, no accidental edits to prior migrations).
- [ ] **Step 3:** Update `CLAUDE.md` Session Log with a dated entry (what shipped, the migration-0024/`tauri dev`-restart caveat, v2 deferrals, UI-human-unverified note) following the existing entry style.
- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: session log — Archives Learn section"
```

---

## Notes for the executing session

- **Restart `tauri dev`** before smoke-testing once Tasks 1, 7, or 11 land (migration 0024 + the new Rust command).
- The agent **cannot run Tauri** — every UI task ends at a user smoke-test gate. Batch these for the user.
- Keep prior migrations untouched (append-only; the project has been burned by migration edits before).
- Pure logic is TDD; UI quality goes through the **frontend-design skill** (a spec requirement, not optional polish).
