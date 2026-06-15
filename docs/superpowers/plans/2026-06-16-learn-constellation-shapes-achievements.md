# Learn — Topic-Shaped Constellations + Achievements & Badges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Learn constellation form a recognizable silhouette of its subject (Linux → penguin) and award gold-shimmer node achievements + a mil-spec topic mastery badge, both driven by one shared AI-generated "topic figure".

**Architecture:** A focused AI call produces a normalized `Figure` (outline + anchors) per topic, cached in `learn_topics.figure_json`. The constellation's existing physics gains an anchor-pull force so nodes settle into the figure; the badge reuses the same outline as its centered wireframe glyph. Mastery transitions are detected purely in the store and recorded in a new `learn_achievements` table (idempotent). No new Rust commands or IPC — only migration 0025 and a new prompt builder.

**Tech Stack:** React 19 + TypeScript + Zustand, SQLite via `tauri-plugin-sql`, vitest (pure-logic TDD), SVG (constellation + badge). Subscription CLI via the existing `learn_claude_call`.

---

## File Structure

**Create:**
- `src-tauri/migrations/0025_learn_figures_achievements.sql` — additive column + achievements table
- `src/apps/archives/learn/figure.ts` — `Pt`, `Figure`, `parseFigure`, `assignAnchors` (pure)
- `src/apps/archives/learn/figure.test.ts`
- `src/apps/archives/learn/achievements.ts` — `achievementKey`, `topicFullyMastered`, `detectNewAchievements` (pure)
- `src/apps/archives/learn/achievements.test.ts`
- `src/apps/archives/learn/MasteryBadge.tsx` — animated mil-spec badge + small rail medallion variant
- `src/apps/archives/learn/MasteryCelebration.tsx` — topic-completion overlay
- `src/apps/archives/learn/TrophyShelf.tsx` — earned-trophies grid

**Modify:**
- `src-tauri/src/lib.rs:166-171` — register migration 25
- `src/apps/archives/learn/learnTypes.ts` — `TopicRow.figure_json`, `AchievementRow`, `TopicProgress`
- `src/apps/archives/learn/forceLayout.ts` — `SimNode.anchor`, anchor-pull in `stepForces`
- `src/apps/archives/learn/learnDb.ts` — `figure_json` in topic I/O, `updateTopic`, achievements + progress helpers
- `src/apps/archives/learn/pedagogy.ts` — `figurePrompt`, bump `PEDAGOGY_VERSION`
- `src/apps/archives/learn/claude.ts` — `generateFigure`
- `src/apps/archives/learn/useLearn.ts` — figure on create, `shapeTopic`, `earnedKeys`, detection in `submitAnswer`, `progress`, `loadTopicProgress`, trophy-shelf state
- `src/apps/archives/learn/Constellation.tsx` — anchor seeding, outline watermark, gold/shimmer mastered nodes, "Shape this" button
- `src/apps/archives/learn/LearnView.tsx` — rail medallion + progress hint, Trophies toggle, celebration mount
- `src/styles/tokens.css` — `--lr-gold-rgb`, shimmer/badge/watermark/shelf styles

**Test commands:** `npx vitest run src/apps/archives/learn` (frontend), `cargo check` (Rust, from `src-tauri`). Full gates before done: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `cargo check`.

---

### Task 1: Migration 0025 — figure column + achievements table

**Files:**
- Create: `src-tauri/migrations/0025_learn_figures_achievements.sql`
- Modify: `src-tauri/src/lib.rs:166-172`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 0025_learn_figures_achievements.sql — topic figures + mastery achievements
ALTER TABLE learn_topics ADD COLUMN figure_json TEXT;

CREATE TABLE learn_achievements (
  id        TEXT PRIMARY KEY,
  topic_id  TEXT NOT NULL,
  kind      TEXT NOT NULL,   -- 'node' | 'topic'
  node_id   TEXT,            -- null for topic badges
  title     TEXT NOT NULL,
  earned_at INTEGER NOT NULL
);
CREATE INDEX idx_learn_achv_topic ON learn_achievements(topic_id);
```

- [ ] **Step 2: Register the migration in `lib.rs`**

In `src-tauri/src/lib.rs`, after the `version: 24` `Migration { ... }` block (line ~171, before the closing `];`), add:

```rust
        Migration {
            version: 25,
            description: "learn: topic figures + mastery achievements",
            sql: include_str!("../migrations/0025_learn_figures_achievements.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles clean (one pre-existing unrelated warning is OK). ⚠️ Note for later: the running app needs a `tauri dev` restart to apply migration 25.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/0025_learn_figures_achievements.sql src-tauri/src/lib.rs
git commit -m "feat(learn): migration 0025 — topic figures + achievements"
```

---

### Task 2: `figure.ts` — figure types + fail-soft parser + anchor assignment

**Files:**
- Create: `src/apps/archives/learn/figure.ts`
- Test: `src/apps/archives/learn/figure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/apps/archives/learn/figure.test.ts
import { describe, it, expect } from "vitest";
import { parseFigure, assignAnchors } from "./figure";

describe("parseFigure", () => {
  it("parses a clean figure object", () => {
    const raw = JSON.stringify({
      name: "penguin",
      outline: [{ x: 0.5, y: 0.1 }, { x: 0.4, y: 0.9 }],
      anchors: [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }],
    });
    const f = parseFigure(raw)!;
    expect(f.name).toBe("penguin");
    expect(f.outline).toHaveLength(2);
    expect(f.anchors).toHaveLength(2);
  });

  it("strips code fences", () => {
    const raw = "```json\n" + JSON.stringify({ name: "atom", outline: [{ x: 0.1, y: 0.1 }], anchors: [{ x: 0.2, y: 0.2 }] }) + "\n```";
    expect(parseFigure(raw)?.name).toBe("atom");
  });

  it("clamps out-of-range coords to 0..1 and drops non-finite points", () => {
    const raw = JSON.stringify({ name: "x", outline: [{ x: 2, y: -1 }, { x: "bad", y: 0.5 }], anchors: [{ x: 0.5, y: 0.5 }] });
    const f = parseFigure(raw)!;
    expect(f.outline).toEqual([{ x: 1, y: 0 }]); // second point dropped (non-finite x)
  });

  it("returns null on garbage", () => {
    expect(parseFigure("not json at all")).toBeNull();
  });

  it("returns null when outline or anchors are empty", () => {
    expect(parseFigure(JSON.stringify({ name: "x", outline: [], anchors: [{ x: 0.5, y: 0.5 }] }))).toBeNull();
  });
});

describe("assignAnchors", () => {
  it("zips node ids to anchors in order", () => {
    const out = assignAnchors(["n1", "n2"], [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]);
    expect(out).toEqual({ n1: { x: 0.1, y: 0.1 }, n2: { x: 0.2, y: 0.2 } });
  });

  it("leaves surplus nodes unassigned and ignores surplus anchors", () => {
    const out = assignAnchors(["n1", "n2", "n3"], [{ x: 0.1, y: 0.1 }]);
    expect(out).toEqual({ n1: { x: 0.1, y: 0.1 } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/figure.test.ts`
Expected: FAIL — cannot find module `./figure`.

- [ ] **Step 3: Write the implementation**

```ts
// src/apps/archives/learn/figure.ts
export type Pt = { x: number; y: number };
export type Figure = { name: string; outline: Pt[]; anchors: Pt[] };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function asPoints(v: unknown): Pt[] {
  if (!Array.isArray(v)) return [];
  const out: Pt[] = [];
  for (const p of v) {
    const x = (p as any)?.x;
    const y = (p as any)?.y;
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      out.push({ x: clamp01(x), y: clamp01(y) });
    }
  }
  return out;
}

/** Strip ``` fences and slice the outermost {...}; returns null if no object found. */
function salvageJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export function parseFigure(raw: string): Figure | null {
  const o = salvageJson(raw);
  if (!o) return null;
  const outline = asPoints(o.outline);
  const anchors = asPoints(o.anchors);
  if (outline.length === 0 || anchors.length === 0) return null;
  return { name: typeof o.name === "string" ? o.name : "", outline, anchors };
}

/** Map node ids (in given order) to anchors by index. Surplus nodes get no anchor. */
export function assignAnchors(nodeIds: string[], anchors: Pt[]): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  for (let i = 0; i < nodeIds.length && i < anchors.length; i++) {
    out[nodeIds[i]!] = anchors[i]!;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/figure.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/figure.ts src/apps/archives/learn/figure.test.ts
git commit -m "feat(learn): figure types + fail-soft parser + anchor assignment"
```

---

### Task 3: `forceLayout.ts` — anchor-pull force

**Files:**
- Modify: `src/apps/archives/learn/forceLayout.ts`
- Test: `src/apps/archives/learn/forceLayout.test.ts` (existing — append)

- [ ] **Step 1: Write the failing test (append to existing file)**

```ts
// append to src/apps/archives/learn/forceLayout.test.ts
import { stepForces } from "./forceLayout";

describe("anchor pull", () => {
  it("draws an anchored node toward its anchor", () => {
    let nodes = [{ id: "a", x: 100, y: 100, vx: 0, vy: 0, anchor: { x: 500, y: 300 } }];
    for (let i = 0; i < 400; i++) nodes = stepForces(nodes, [], 800, 600);
    const a = nodes[0]!;
    expect(Math.hypot(a.x - 500, a.y - 300)).toBeLessThan(30);
  });

  it("leaves an unanchored single node near center (unchanged behavior)", () => {
    let nodes = [{ id: "a", x: 100, y: 100, vx: 0, vy: 0 }];
    for (let i = 0; i < 400; i++) nodes = stepForces(nodes, [], 800, 600);
    const a = nodes[0]!;
    expect(Math.hypot(a.x - 400, a.y - 300)).toBeLessThan(60);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/forceLayout.test.ts`
Expected: FAIL — the anchored node won't converge (no anchor force yet); `anchor` is not on the type.

- [ ] **Step 3: Implement the anchor force**

In `src/apps/archives/learn/forceLayout.ts`:

Extend the type (line 2):

```ts
export type SimNode = { id: string; x: number; y: number; vx: number; vy: number; fixed?: boolean; anchor?: { x: number; y: number } };
```

Add a constant near the others (after line 13):

```ts
const ANCHOR_PULL = 0.08;   // spring toward a figure anchor (dominates when present)
const EDGE_SPRING_FIGURE = 0.012; // softened edge stiffness when any node is anchored
```

In `stepForces`, replace the spring + centering/integrate sections (lines 49-72) with anchor-aware versions:

```ts
  // spring attraction along edges — softened when a figure is anchoring nodes
  const anchored = next.some((n) => n.anchor);
  const spring = anchored ? EDGE_SPRING_FIGURE : SPRING;
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = spring * (d - REST_LEN);
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  }
  // anchor pull + centering + integrate
  for (const n of next) {
    if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
    if (n.anchor) {
      n.vx += (n.anchor.x - n.x) * ANCHOR_PULL;
      n.vy += (n.anchor.y - n.y) * ANCHOR_PULL;
    } else {
      n.vx += (cx - n.x) * CENTER_PULL;
      n.vy += (cy - n.y) * CENTER_PULL;
    }
    n.vx = clampV(n.vx * DAMPING);
    n.vy = clampV(n.vy * DAMPING);
    n.x += n.vx;
    n.y += n.vy;
    n.x = clampPos(n.x, BOUND_MARGIN, w - BOUND_MARGIN);
    n.y = clampPos(n.y, BOUND_MARGIN, h - BOUND_MARGIN);
  }
  return next;
```

Note: the `next.map((n) => ({ ...n }))` at the top already copies `anchor` through the spread, so anchored nodes keep their anchor each tick.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/forceLayout.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/forceLayout.ts src/apps/archives/learn/forceLayout.test.ts
git commit -m "feat(learn): anchor-pull force for figure-shaped layout"
```

---

### Task 4: `pedagogy.ts` figure prompt + `claude.ts` `generateFigure`

**Files:**
- Modify: `src/apps/archives/learn/pedagogy.ts`, `src/apps/archives/learn/claude.ts`
- Test: `src/apps/archives/learn/claude.test.ts` (existing — append)

- [ ] **Step 1: Write the failing test (append to existing file)**

```ts
// append to src/apps/archives/learn/claude.test.ts
import { generateFigure } from "./claude";

describe("generateFigure", () => {
  it("parses a figure reply", async () => {
    (learnClaudeCall as any).mockResolvedValue({ result: JSON.stringify({ name: "penguin", outline: [{ x: 0.5, y: 0.1 }], anchors: [{ x: 0.5, y: 0.2 }] }), cost: 0, model: "m" });
    const f = await generateFigure("Linux", 5, "model-x");
    expect(f?.name).toBe("penguin");
  });

  it("returns null on garbage", async () => {
    (learnClaudeCall as any).mockResolvedValue({ result: "no json", cost: 0, model: "m" });
    expect(await generateFigure("Linux", 5, "model-x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/claude.test.ts`
Expected: FAIL — `generateFigure` not exported.

- [ ] **Step 3: Add `figurePrompt` to `pedagogy.ts`**

Bump the version constant:

```ts
export const PEDAGOGY_VERSION = "1.1.0";
```

Add at the end of `pedagogy.ts`:

```ts
/**
 * Build a figure prompt: a recognizable silhouette of the topic's iconic symbol
 * as normalized points, for a "constellation that evokes the subject".
 */
export function figurePrompt(args: { topic: string; nodeCount: number }): string {
  return `You are a constellation cartographer. For the learning topic "${args.topic}", design a simple, instantly recognizable SILHOUETTE of the single most iconic visual symbol of that topic (e.g. Linux -> a penguin, React -> an atom, Chess -> a knight piece).

Express it in a normalized coordinate space where x and y each run 0.0 (left/top) to 1.0 (right/bottom).

Return:
  - "name": the symbol you chose (one or two words).
  - "outline": an ORDERED list of 12 to 28 points that trace the symbol's outer silhouette as a single closed loop. Keep it clean and readable at small size — favor a bold, simple shape over fine detail.
  - "anchors": EXACTLY ${args.nodeCount} points positioned so that, taken together, they clearly evoke the same symbol. Spread them across the whole figure (not clustered); they may sit on the outline or inside it. These are where stars (concepts) will be placed.

Keep the figure centered and using most of the 0..1 box (roughly 0.1..0.9 on each axis). ${JSON_ONLY}
{"name":"penguin","outline":[{"x":0.5,"y":0.08}, ...],"anchors":[{"x":0.5,"y":0.2}, ...]}`;
}
```

(`JSON_ONLY` is the existing module-level const in `pedagogy.ts`.)

- [ ] **Step 4: Add `generateFigure` to `claude.ts`**

Add the import at the top (extend the existing pedagogy import):

```ts
import { graphPrompt, lessonPrompt, gradePrompt, findLinksPrompt, figurePrompt } from "./pedagogy";
import { parseFigure, type Figure } from "./figure";
```

Add the function:

```ts
export async function generateFigure(topic: string, nodeCount: number, model: string): Promise<Figure | null> {
  try {
    const reply = await enqueue(() => learnClaudeCall(figurePrompt({ topic, nodeCount }), model, false));
    return parseFigure(reply.result);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/claude.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/learn/pedagogy.ts src/apps/archives/learn/claude.ts src/apps/archives/learn/claude.test.ts
git commit -m "feat(learn): figure prompt + generateFigure (fail-soft)"
```

---

### Task 5: `learnTypes.ts` + `learnDb.ts` — figure I/O, achievements, progress

**Files:**
- Modify: `src/apps/archives/learn/learnTypes.ts`, `src/apps/archives/learn/learnDb.ts`

- [ ] **Step 1: Extend types in `learnTypes.ts`**

Change `TopicRow` (line 32) to add `figure_json`:

```ts
export type TopicRow = { id: string; title: string; summary: string | null; status: string; figure_json: string | null; created_at: number; updated_at: number };
```

Add new row/aggregate types after `ReviewRow` (line 39):

```ts
export type AchievementRow = { id: string; topic_id: string; kind: "node" | "topic"; node_id: string | null; title: string; earned_at: number };
export type TopicProgress = { total: number; mastered: number };
```

- [ ] **Step 2: Update `learnDb.ts` topic I/O + add helpers**

Update the import line 3 to include the new types:

```ts
import type { TopicRow, NodeRow, EdgeRow, ReviewRow, AchievementRow, TopicProgress } from "./learnTypes";
```

Replace `insertTopic` (lines 10-16) to persist `figure_json` (the `SELECT *` in `listTopics` already returns the new column):

```ts
export async function insertTopic(r: TopicRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO learn_topics (id,title,summary,status,figure_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [r.id, r.title, r.summary, r.status, r.figure_json, r.created_at, r.updated_at],
  );
}

export async function updateTopic(id: string, patch: Partial<TopicRow>): Promise<void> {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const db = await getDb();
  const set = cols.map((c, i) => `${c}=$${i + 2}`).join(",");
  await db.execute(`UPDATE learn_topics SET ${set} WHERE id=$1`, [id, ...cols.map((c) => (patch as any)[c])]);
}
```

Extend `deleteTopic` (lines 18-27) to also remove achievements — add this line before the `DELETE FROM learn_topics` line:

```ts
  await db.execute("DELETE FROM learn_achievements WHERE topic_id=$1", [id]);
```

Add achievement + progress helpers at the end of the file:

```ts
export async function listAchievements(topicId?: string): Promise<AchievementRow[]> {
  const db = await getDb();
  return topicId
    ? db.select<AchievementRow[]>("SELECT * FROM learn_achievements WHERE topic_id=$1 ORDER BY earned_at", [topicId])
    : db.select<AchievementRow[]>("SELECT * FROM learn_achievements ORDER BY earned_at", []);
}

export async function insertAchievement(r: AchievementRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO learn_achievements (id,topic_id,kind,node_id,title,earned_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [r.id, r.topic_id, r.kind, r.node_id, r.title, r.earned_at],
  );
}

export async function topicProgress(): Promise<Record<string, TopicProgress>> {
  const db = await getDb();
  const rows = await db.select<Array<{ topic_id: string; total: number; mastered: number }>>(
    "SELECT topic_id, COUNT(*) AS total, SUM(CASE WHEN status='mastered' THEN 1 ELSE 0 END) AS mastered FROM learn_nodes GROUP BY topic_id",
    [],
  );
  const out: Record<string, TopicProgress> = {};
  for (const r of rows) out[r.topic_id] = { total: Number(r.total), mastered: Number(r.mastered) };
  return out;
}
```

- [ ] **Step 3: Fix the one existing `insertTopic` caller's type**

`useLearn.createTopic` builds a `TopicRow` literal (Task 7 updates it to include `figure_json`). For now, run tsc to find the gap:

Run: `npx tsc --noEmit`
Expected: an error in `useLearn.ts` that `figure_json` is missing from the topic literal — that's fixed in Task 7. (If you are doing strict task isolation, add `figure_json: null,` to the `TopicRow` literal in `useLearn.createTopic` now to keep tsc green; Task 7 will build on it.)

- [ ] **Step 4: Commit**

```bash
git add src/apps/archives/learn/learnTypes.ts src/apps/archives/learn/learnDb.ts
git commit -m "feat(learn): figure_json topic I/O + achievements/progress db helpers"
```

---

### Task 6: `achievements.ts` — pure detection

**Files:**
- Create: `src/apps/archives/learn/achievements.ts`
- Test: `src/apps/archives/learn/achievements.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/apps/archives/learn/achievements.test.ts
import { describe, it, expect } from "vitest";
import { achievementKey, topicFullyMastered, detectNewAchievements } from "./achievements";
import type { NodeRow } from "./learnTypes";

const node = (id: string, status: NodeRow["status"]): NodeRow => ({
  id, topic_id: "t", title: id.toUpperCase(), objective: null, bloom_level: null,
  level: "basics", order_idx: 0, lesson_json: null, lesson_at: null,
  p_mastery: status === "mastered" ? 0.9 : 0.1, attempts: status === "mastered" ? 3 : 0,
  last_seen: null, status,
});
const rec = (...ns: NodeRow[]) => Object.fromEntries(ns.map((n) => [n.id, n]));

describe("achievementKey", () => {
  it("namespaces node vs topic", () => {
    expect(achievementKey("node", "a")).toBe("node:a");
    expect(achievementKey("topic")).toBe("topic");
  });
});

describe("topicFullyMastered", () => {
  it("is true only when every node is mastered", () => {
    expect(topicFullyMastered([node("a", "mastered"), node("b", "mastered")])).toBe(true);
    expect(topicFullyMastered([node("a", "mastered"), node("b", "ready")])).toBe(false);
    expect(topicFullyMastered([])).toBe(false);
  });
});

describe("detectNewAchievements", () => {
  it("detects a node that just became mastered", () => {
    const prev = rec(node("a", "in_progress"), node("b", "locked"));
    const next = rec(node("a", "mastered"), node("b", "locked"));
    const out = detectNewAchievements(prev, next, new Set());
    expect(out.nodeIds).toEqual(["a"]);
    expect(out.topicEarned).toBe(false);
  });

  it("does not re-award an already-earned node (decay then re-master)", () => {
    const prev = rec(node("a", "ready"));
    const next = rec(node("a", "mastered"));
    const out = detectNewAchievements(prev, next, new Set(["node:a"]));
    expect(out.nodeIds).toEqual([]);
  });

  it("awards the topic when the last node flips and topic not yet earned", () => {
    const prev = rec(node("a", "mastered"), node("b", "in_progress"));
    const next = rec(node("a", "mastered"), node("b", "mastered"));
    const out = detectNewAchievements(prev, next, new Set(["node:a"]));
    expect(out.nodeIds).toEqual(["b"]);
    expect(out.topicEarned).toBe(true);
  });

  it("does not re-award an already-earned topic", () => {
    const prev = rec(node("a", "mastered"));
    const next = rec(node("a", "mastered"));
    const out = detectNewAchievements(prev, next, new Set(["node:a", "topic"]));
    expect(out.topicEarned).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/achievements.test.ts`
Expected: FAIL — cannot find module `./achievements`.

- [ ] **Step 3: Write the implementation**

```ts
// src/apps/archives/learn/achievements.ts
import type { NodeRow } from "./learnTypes";

export type AchievementKind = "node" | "topic";

export function achievementKey(kind: AchievementKind, nodeId?: string): string {
  return kind === "node" ? `node:${nodeId}` : "topic";
}

export function topicFullyMastered(nodes: NodeRow[]): boolean {
  return nodes.length > 0 && nodes.every((n) => n.status === "mastered");
}

/**
 * Pure diff of node-status records. Returns the node ids that newly became
 * mastered (and aren't already earned), and whether the topic badge is newly
 * earned. Idempotent via the `earned` key set — decay then re-master never
 * re-awards.
 */
export function detectNewAchievements(
  prev: Record<string, NodeRow>,
  next: Record<string, NodeRow>,
  earned: Set<string>,
): { nodeIds: string[]; topicEarned: boolean } {
  const nodeIds: string[] = [];
  for (const id of Object.keys(next)) {
    const before = prev[id];
    const after = next[id]!;
    const becameMastered = after.status === "mastered" && (!before || before.status !== "mastered");
    if (becameMastered && !earned.has(achievementKey("node", id))) nodeIds.push(id);
  }
  const topicEarned = topicFullyMastered(Object.values(next)) && !earned.has(achievementKey("topic"));
  return { nodeIds, topicEarned };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/achievements.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/achievements.ts src/apps/archives/learn/achievements.test.ts
git commit -m "feat(learn): pure achievement detection (idempotent)"
```

---

### Task 7: `useLearn.ts` — figure on create, shapeTopic, achievements, progress, trophy state

**Files:**
- Modify: `src/apps/archives/learn/useLearn.ts`
- Test: `src/apps/archives/learn/useLearn.test.ts` (existing — extend mocks + add tests)

- [ ] **Step 1: Update existing test mocks and add coverage**

In `useLearn.test.ts`, extend the `./learnDb` mock (lines 3-13) with the new helpers, the `./claude` mock (lines 14-22) with `generateFigure`, and add an achievements test. Replace those mock blocks with:

```ts
vi.mock("./learnDb", () => ({
  listTopics: vi.fn().mockResolvedValue([]),
  insertTopic: vi.fn().mockResolvedValue(undefined),
  updateTopic: vi.fn().mockResolvedValue(undefined),
  insertNode: vi.fn().mockResolvedValue(undefined),
  insertEdge: vi.fn().mockResolvedValue(undefined),
  listNodes: vi.fn().mockResolvedValue([]),
  listEdges: vi.fn().mockResolvedValue([]),
  updateNode: vi.fn().mockResolvedValue(undefined),
  insertReview: vi.fn().mockResolvedValue(undefined),
  deleteTopic: vi.fn().mockResolvedValue(undefined),
  listAchievements: vi.fn().mockResolvedValue([]),
  insertAchievement: vi.fn().mockResolvedValue(undefined),
  topicProgress: vi.fn().mockResolvedValue({}),
}));
vi.mock("./claude", () => ({
  generateGraph: vi.fn().mockResolvedValue({ summary: "s", nodes: [
    { key: "a", title: "A", objective: "o", bloom_level: "remember", level: "basics", prereqs: [] },
    { key: "b", title: "B", objective: "o", bloom_level: "apply", level: "intermediate", prereqs: ["a"] },
  ]}),
  generateLesson: vi.fn().mockResolvedValue({ objective: "o", concept_chunks: [], worked_example: null, key_terms: [], suggested_resources: [], recall_check: [] }),
  gradeAnswer: vi.fn().mockResolvedValue({ correct: true, partial: false, missed_concepts: [] }),
  findRealLinks: vi.fn().mockResolvedValue([]),
  generateFigure: vi.fn().mockResolvedValue(null),
}));
```

Add a new test after the `submitAnswer` describe block:

```ts
import { insertAchievement } from "./learnDb";

describe("achievements", () => {
  it("records a node achievement when a node is mastered", async () => {
    await useLearn.getState().createTopic("Photography");
    const a = Object.values(useLearn.getState().nodes).find((n: any) => n.title === "A")! as any;
    for (let i = 0; i < 4; i++) {
      await useLearn.getState().submitAnswer(a.id, { question: "q", expected: "e", concept: "c", answer: "yes" });
    }
    expect(useLearn.getState().earnedKeys.has(`node:${a.id}`)).toBe(true);
    expect(insertAchievement).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apps/archives/learn/useLearn.test.ts`
Expected: FAIL — `earnedKeys` is undefined on the state.

- [ ] **Step 3: Wire the store**

In `useLearn.ts`:

Add imports:

```ts
import { ulid } from "ulid";
import { toast } from "@/store/toastStore";
import type { TopicRow, NodeRow, EdgeRow, Lesson, AchievementRow, TopicProgress } from "./learnTypes";
import { generateGraph, generateLesson, gradeAnswer, findRealLinks, generateFigure } from "./claude";
import {
  listTopics, insertTopic, updateTopic, insertNode, insertEdge, listNodes, listEdges,
  updateNode, insertReview, deleteTopic as dbDeleteTopic,
  listAchievements, insertAchievement, topicProgress,
} from "./learnDb";
import { detectNewAchievements, achievementKey } from "./achievements";
```

Extend `LearnState` (after `recentMisses`):

```ts
  progress: Record<string, TopicProgress>;
  earnedKeys: Set<string>;
  trophyShelfOpen: boolean;
  celebrateTopicId: string | null;
  loadTopicProgress: () => Promise<void>;
  shapeTopic: (id: string) => Promise<void>;
  openTrophyShelf: (open: boolean) => void;
  dismissCelebration: () => void;
```

Extend `initialState`:

```ts
  progress: {} as Record<string, TopicProgress>,
  earnedKeys: new Set<string>() as Set<string>,
  trophyShelfOpen: false,
  celebrateTopicId: null as string | null,
```

In `loadTopics`, also load progress — replace the body:

```ts
  async loadTopics() {
    const rows = await listTopics();
    set({ topics: toRecord(rows) });
    await get().loadTopicProgress();
  },

  async loadTopicProgress() {
    set({ progress: await topicProgress() });
  },
```

In `createTopic`, set `figure_json: null` in the `TopicRow` literal, and after the final `set(...)` that stores nodes/edges, generate the figure (fail-soft) and refresh progress. Add the topic-literal field:

```ts
      const topic: TopicRow = {
        id: topicId, title, summary: spec.summary, status: "active",
        figure_json: null, created_at: now, updated_at: now,
      };
```

Replace the final `set((s) => ({ ... generatingGraph: false }))` block with one that keeps `generatingGraph: false`, then append after it (still inside the `try`, before the `catch`):

```ts
      set((s) => ({
        topics: { ...s.topics, [topicId]: topic },
        openTopicId: topicId,
        nodes: finalRecord,
        edges,
        generatingGraph: false,
      }));

      // Figure generation is fail-soft and must never block topic creation.
      void get().shapeTopic(topicId);
      await get().loadTopicProgress();
```

In `openTopic`, load that topic's earned achievement keys so detection is idempotent across sessions — replace the body:

```ts
  async openTopic(id: string) {
    const [nodeRows, edges, achv] = await Promise.all([listNodes(id), listEdges(id), listAchievements(id)]);
    const earnedKeys = new Set(achv.map((a) => a.kind === "node" ? achievementKey("node", a.node_id ?? "") : achievementKey("topic")));
    set({ openTopicId: id, nodes: toRecord(nodeRows), edges, openNodeId: null, earnedKeys, trophyShelfOpen: false });
  },
```

Add `shapeTopic` (generates + persists the figure for a topic, using its node count) after `openTopic`:

```ts
  async shapeTopic(id: string) {
    const model = useModelPrefs.getState().modelFor("learn");
    const { topics, openTopicId } = get();
    const topic = topics[id];
    if (!topic) return;
    const nodeCount = openTopicId === id
      ? Object.keys(get().nodes).length
      : (get().progress[id]?.total ?? 0);
    const figure = await generateFigure(topic.title, Math.max(1, nodeCount), model);
    if (!figure) return;
    const json = JSON.stringify(figure);
    await updateTopic(id, { figure_json: json });
    set((s) => {
      const t = s.topics[id];
      if (!t) return {};
      return { topics: { ...s.topics, [id]: { ...t, figure_json: json } } };
    });
  },
```

In `submitAnswer`, after `set({ nodes: finalRecord });`, run detection. Insert this block right after that `set` (before the `recentMisses` block):

```ts
    // Achievement detection — pure diff over status transitions, idempotent.
    const { earnedKeys, openTopicId } = get();
    const det = detectNewAchievements(prevNodes, finalRecord, earnedKeys);
    if (det.nodeIds.length || det.topicEarned) {
      const nextEarned = new Set(earnedKeys);
      const ts = Date.now();
      for (const nid of det.nodeIds) {
        nextEarned.add(achievementKey("node", nid));
        const title = finalRecord[nid]?.title ?? "Concept";
        toast.success(`Node mastered — ${title}`, { body: "Achievement unlocked" });
        void insertAchievement({ id: ulid(), topic_id: openTopicId ?? "", kind: "node", node_id: nid, title, earned_at: ts });
      }
      if (det.topicEarned && openTopicId) {
        nextEarned.add(achievementKey("topic"));
        const tTitle = get().topics[openTopicId]?.title ?? "Topic";
        void insertAchievement({ id: ulid(), topic_id: openTopicId, kind: "topic", node_id: null, title: tTitle, earned_at: ts });
        set({ celebrateTopicId: openTopicId });
      }
      set({ earnedKeys: nextEarned });
      // refresh per-topic progress so the rail medallion + shelf update
      if (openTopicId) {
        const vals = Object.values(finalRecord);
        set((s) => ({ progress: { ...s.progress, [openTopicId]: { total: vals.length, mastered: vals.filter((n) => n.status === "mastered").length } } }));
      }
    }
```

Add the small UI-state actions (after `closeNode`):

```ts
  openTrophyShelf(open: boolean) { set({ trophyShelfOpen: open }); },
  dismissCelebration() { set({ celebrateTopicId: null }); },
```

In `deleteTopic`, also drop progress for the id — inside the `set((s) => {...})`, add `const progress = { ...s.progress }; delete progress[id];` and return `progress` in the object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apps/archives/learn/useLearn.test.ts`
Expected: PASS (existing 2 + new achievements test).

- [ ] **Step 5: Verify the full learn suite + types**

Run: `npx vitest run src/apps/archives/learn && npx tsc --noEmit`
Expected: all learn tests pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/learn/useLearn.ts src/apps/archives/learn/useLearn.test.ts
git commit -m "feat(learn): figure-on-create, shapeTopic, achievement detection, progress"
```

---

### Task 8: CSS — gold token, shimmer, watermark, badge/shelf scaffolding

**Files:**
- Modify: `src/styles/tokens.css`

The learn styles live in `tokens.css` under the `.learn-*` / `.lc-*` selectors (search for `--lr-rgb`). This task adds the new visual primitives; later UI tasks consume them. UI is human-verified — frontend-design polish is expected.

- [ ] **Step 1: Add the gold token next to the existing `--lr-rgb` definition**

Find where `--lr-rgb` (the learn violet, `177,76,255`) is declared and add beside it:

```css
  --lr-gold-rgb: 232, 193, 74;
```

- [ ] **Step 2: Add mastered-node gold + shimmer + figure watermark styles**

Append in the learn CSS region:

```css
/* Mastered node — gold fill + glow (overrides the violet mastered look) */
.lc-node--mastered .lc-hex-outer { fill: url(#lc-grad-gold); stroke: rgba(var(--lr-gold-rgb), 0.9); }
.lc-node--mastered .lc-center-dot { fill: #fff3cf; }
.lc-node--mastered { color: rgba(var(--lr-gold-rgb), 1); }

/* Shimmer sweep — a translating highlight clipped to the hex */
@keyframes lc-shimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
.lc-shimmer-bar { fill: rgba(255, 255, 255, 0.5); animation: lc-shimmer 2.6s linear infinite; }

/* Figure silhouette watermark behind the nodes */
.lc-figure-outline { fill: rgba(var(--lr-rgb), 0.05); stroke: rgba(var(--lr-rgb), 0.22); stroke-width: 1; }

@media (prefers-reduced-motion: reduce) {
  .lc-shimmer-bar { animation: none; opacity: 0; }
}
```

- [ ] **Step 3: Add badge / medallion / shelf / celebration animation tokens**

Append:

```css
/* Mastery badge motion */
@keyframes lb-spin { 100% { transform: rotate(360deg); } }
@keyframes lb-spin-r { 100% { transform: rotate(-360deg); } }
@keyframes lb-glow { 0%,100% { filter: drop-shadow(0 0 7px rgba(var(--lr-gold-rgb), .45)); } 50% { filter: drop-shadow(0 0 18px rgba(var(--lr-gold-rgb), .85)); } }
@keyframes lb-scan { 0% { transform: translateY(-44px); } 100% { transform: translateY(44px); } }
.lb-reticle { animation: lb-spin 26s linear infinite; transform-origin: center; }
.lb-subdial { animation: lb-spin-r 34s linear infinite; transform-origin: center; }
.lb-badge   { animation: lb-glow 2.8s ease-in-out infinite; }
.lb-scan    { animation: lb-scan 3.4s ease-in-out infinite alternate; }

/* Trophy shelf grid */
.learn-trophy-shelf { padding: 28px; overflow-y: auto; }
.learn-trophy-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }
.learn-trophy-topic { font-family: var(--font-mono, ui-monospace); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--t-tertiary); margin: 18px 0 8px; }
.learn-trophy-locked { opacity: .28; filter: grayscale(1); }

/* Topic-mastery celebration overlay */
@keyframes lb-zoom { 0% { transform: scale(.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
.learn-celebrate { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: rgba(3, 6, 10, 0.82); z-index: 40; }
.learn-celebrate-badge { animation: lb-zoom .5s cubic-bezier(.2,.9,.3,1.2) both; }
.learn-celebrate-stamp { font-family: var(--font-mono, ui-monospace); letter-spacing: .3em; color: rgba(var(--lr-gold-rgb), 1); font-size: 13px; }

/* Rail medallion next to a fully-mastered topic */
.learn-topic-medallion { margin-left: auto; flex-shrink: 0; }
.learn-topic-progress { margin-left: auto; font-size: 10px; color: var(--t-tertiary); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .lb-reticle, .lb-subdial, .lb-badge, .lb-scan, .learn-celebrate-badge { animation: none; }
}
```

- [ ] **Step 4: Add the gold radial gradient def to the constellation (in Task 9 SVG)**

Note for Task 9: the `url(#lc-grad-gold)` referenced above is defined in the Constellation `<defs>` in the next task.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0 (CSS compiles).

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(learn): gold token, shimmer, figure watermark, badge/shelf styles"
```

---

### Task 9: `Constellation.tsx` — anchor seeding, watermark, gold nodes, Shape button

**Files:**
- Modify: `src/apps/archives/learn/Constellation.tsx`, `src/apps/archives/learn/LearnView.tsx`

UI — human-verified. Keep the existing physics/auto-fit/pan/zoom intact; only add the figure overlay + gold treatment + anchor seeding.

- [ ] **Step 1: Read the topic's figure in the component**

At the top of `Constellation`, alongside the other `useLearn` selectors, add:

```ts
  const openTopicId = useLearn((s) => s.openTopicId);
  const topics      = useLearn((s) => s.topics);
  const figure = useMemo(() => {
    const raw = openTopicId ? topics[openTopicId]?.figure_json : null;
    if (!raw) return null;
    try { return JSON.parse(raw) as import("./figure").Figure; } catch { return null; }
  }, [openTopicId, topics]);
```

- [ ] **Step 2: Seed nodes from anchors when a figure exists**

Import `assignAnchors`:

```ts
import { assignAnchors } from "./figure";
```

In the seed effect (around lines 137-144), when `figure` is present, build an anchor map (node ids in `order_idx` order → anchors) and seed each node at its anchor in the seed box, setting `anchor` on the `SimNode`. Replace the `positions`/`seeded` construction with:

```ts
    const ordered = ids
      .map((id) => storeNodes[id])
      .filter(Boolean)
      .sort((a, b) => (a!.order_idx - b!.order_idx))
      .map((n) => n!.id);
    const anchorMap = figure ? assignAnchors(ordered, figure.anchors) : {};
    const positions = initialPositions(ids, dims.w, dims.h);
    const seeded: SimNode[] = ids.map((id) => {
      const a = anchorMap[id];
      const ax = a ? a.x * dims.w : (positions[id]?.x ?? dims.w / 2);
      const ay = a ? a.y * dims.h : (positions[id]?.y ?? dims.h / 2);
      return { id, x: ax, y: ay, vx: 0, vy: 0, ...(a ? { anchor: { x: ax, y: ay } } : {}) };
    });
```

Add `figure` to the seed effect's dependency array (the `// eslint-disable-next-line` deps line near 160-161): `[storeNodes, dims.w, dims.h, figure]`.

- [ ] **Step 3: Render the figure watermark**

In the `<defs>`, add the gold gradient (next to `lc-grad-mastered`):

```tsx
        <radialGradient id="lc-grad-gold" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="rgba(var(--lr-gold-rgb),1)" />
          <stop offset="55%" stopColor="rgba(var(--lr-gold-rgb),0.78)" />
          <stop offset="100%" stopColor="rgba(var(--lr-gold-rgb),0.42)" />
        </radialGradient>
```

Inside `<g className="lc-viewport">`, BEFORE the `lc-edges` group, add the watermark (maps normalized outline into the seed box so it shares the viewport transform):

```tsx
        {figure && (
          <polygon
            className="lc-figure-outline"
            points={figure.outline.map((p) => `${p.x * dims.w},${p.y * dims.h}`).join(" ")}
          />
        )}
```

- [ ] **Step 4: Add the shimmer sweep to mastered nodes**

In the node `<g>` render, after the mastery arc / before the center dot, add a clipped shimmer for mastered nodes. Each node needs a unique clip id:

```tsx
                {status === "mastered" && !reduceMotion && (
                  <g>
                    <clipPath id={`lc-hexclip-${sim.id}`}>
                      <polygon points={hexPoints(0, 0, r)} />
                    </clipPath>
                    <g clipPath={`url(#lc-hexclip-${sim.id})`}>
                      <rect className="lc-shimmer-bar" x={-r} y={-r} width={r * 0.7} height={r * 2} transform="skewX(-18)" />
                    </g>
                  </g>
                )}
```

(The gold fill itself comes from the CSS `.lc-node--mastered .lc-hex-outer` rule referencing `url(#lc-grad-gold)`, plus the existing `fill={status === "mastered" ? "url(#lc-grad-mastered)" : ...}` should be changed to `"url(#lc-grad-gold)"` for the mastered branch.)

Update the `fill={...}` on `lc-hex-outer` so the mastered branch uses gold:

```tsx
                  fill={
                    status === "mastered" ? "url(#lc-grad-gold)" :
                    status === "in_progress" ? `rgba(var(--lr-rgb),${0.1 + mastery * 0.25})` :
                    status === "ready"    ? "rgba(var(--lr-rgb),0.06)" :
                    "transparent"
                  }
```

- [ ] **Step 5: Add the "Shape this" button in LearnView's constellation header**

In `LearnView.tsx`, the constellation header (lines 130-133) gets a button when the open topic has no figure. Add a selector + handler near the other hooks:

```ts
  const shapeTopic = useLearn((s) => s.shapeTopic);
  const [shaping, setShaping] = useState(false);
  const hasFigure = !!(openTopicId && topics[openTopicId]?.figure_json);
```

In the header JSX:

```tsx
            {openTopicId && !hasFigure && (
              <button
                className="learn-shape-btn"
                disabled={shaping}
                onClick={async () => { setShaping(true); try { await shapeTopic(openTopicId); } finally { setShaping(false); } }}
              >
                {shaping ? "Shaping…" : "✦ Shape this"}
              </button>
            )}
```

Add a minimal style for `.learn-shape-btn` in tokens.css (small pill, violet outline) — match the existing `.learn-*` button look.

- [ ] **Step 6: Smoke test (human)**

⚠️ Requires a `tauri dev` restart (migration 0025). In the app: open an existing topic → click **✦ Shape this** → after generation the nodes re-seed into the subject silhouette with a faint outline behind them. Master a node (answer recalls correctly until it flips) → it turns gold and shimmers.

- [ ] **Step 7: Verify build + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

```bash
git add src/apps/archives/learn/Constellation.tsx src/apps/archives/learn/LearnView.tsx src/styles/tokens.css
git commit -m "feat(learn): figure-shaped constellation + gold-shimmer mastered nodes"
```

---

### Task 10: `MasteryBadge.tsx` — animated badge + rail medallion

**Files:**
- Create: `src/apps/archives/learn/MasteryBadge.tsx`

UI — human-verified; the brainstormed mock is the visual target (mil-spec plate, sunburst, rotating reticle + violet sub-dial, rivets, scanline, grain, monospace stamps, wireframe glyph = topic figure outline). Polish expected.

- [ ] **Step 1: Write the component**

Signature and structure:

```tsx
// src/apps/archives/learn/MasteryBadge.tsx
import { useMemo } from "react";
import type { Pt } from "./figure";

type Props = {
  topicTitle: string;
  outline?: Pt[] | null;     // the topic figure outline → centered wireframe glyph
  masteredCount: number;
  total: number;
  size?: number;             // px; default 220
  variant?: "full" | "medallion";
};

// Map a normalized (0..1) outline into a centered box of side `box` around (cx,cy).
function glyphPoints(outline: Pt[], cx: number, cy: number, box: number): string {
  return outline.map((p) => `${cx + (p.x - 0.5) * box},${cy + (p.y - 0.5) * box}`).join(" ");
}

export function MasteryBadge({ topicTitle, outline, masteredCount, total, size = 220, variant = "full" }: Props) {
  const pct = total > 0 ? Math.round((masteredCount / total) * 100) : 0;
  const callsign = topicTitle.toUpperCase().slice(0, 14);
  const glyph = useMemo(() => (outline && outline.length >= 3 ? glyphPoints(outline, 120, 120, 70) : null), [outline]);
  // ... render per variant (see steps below)
}
```

- [ ] **Step 2: Render the `full` variant**

A 240×240 viewBox SVG (scaled to `size`) containing, in order: the `lb-badge` glow wrapper; 8 sunburst ray `<line>`s from center; an `<g className="lb-reticle">` dashed outer ring + 4 ticks; the 8-point star plate `<polygon>`; the octagon plate (double border) + 8 rivet `<circle>`s; an `<g className="lb-subdial">` violet dashed ring; a grain `<rect>` using an SVG `<filter><feTurbulence>`; the centered glyph — `glyph ? <polygon points={glyph} className="lb-glyph"/> : <generic star polygon>`; the `lb-scan` line clipped to the plate; and monospace `<text>` stamps `UNIT · {callsign}`, `MASTERED`, `{masteredCount}/{total} · {pct}%`. Use the gold/violet token rgb values (`rgba(var(--lr-gold-rgb),…)`, `rgba(var(--lr-rgb),…)`). Mirror the geometry from the approved mock at `.superpowers/brainstorm/*/content/badge-final.html` (read it for exact coordinates).

- [ ] **Step 3: Render the `medallion` variant**

A compact ~48px octagon plate + the glyph only (static, no rings/animation), for the rail. Return early when `variant === "medallion"`.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean (component is not yet mounted anywhere — that's Tasks 11-13).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/learn/MasteryBadge.tsx
git commit -m "feat(learn): MasteryBadge component (full + rail medallion)"
```

---

### Task 11: `MasteryCelebration.tsx` + wire to topic completion

**Files:**
- Create: `src/apps/archives/learn/MasteryCelebration.tsx`
- Modify: `src/apps/archives/learn/LearnView.tsx`

- [ ] **Step 1: Write the overlay component**

```tsx
// src/apps/archives/learn/MasteryCelebration.tsx
import { useLearn } from "./useLearn";
import { MasteryBadge } from "./MasteryBadge";
import type { Figure } from "./figure";

export function MasteryCelebration() {
  const topicId = useLearn((s) => s.celebrateTopicId);
  const topics = useLearn((s) => s.topics);
  const progress = useLearn((s) => s.progress);
  const dismiss = useLearn((s) => s.dismissCelebration);
  if (!topicId) return null;
  const topic = topics[topicId];
  if (!topic) return null;
  let outline: Figure["outline"] | null = null;
  try { outline = topic.figure_json ? (JSON.parse(topic.figure_json) as Figure).outline : null; } catch { outline = null; }
  const p = progress[topicId] ?? { total: 0, mastered: 0 };

  return (
    <div className="learn-celebrate" role="dialog" aria-label="Topic mastered" onClick={dismiss}>
      <div className="learn-celebrate-badge">
        <MasteryBadge topicTitle={topic.title} outline={outline} masteredCount={p.mastered} total={p.total} size={260} />
      </div>
      <div className="learn-celebrate-stamp">TOPIC MASTERED</div>
      <button className="learn-shape-btn" onClick={dismiss}>Dismiss</button>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in LearnView**

In `LearnView.tsx`, import `MasteryCelebration` and render it once inside the `learn-body` container (it self-hides when `celebrateTopicId` is null), e.g. at the end of `learn-body`:

```tsx
        <MasteryCelebration />
```

- [ ] **Step 3: Smoke test (human)**

Master the final remaining node of a topic → the celebration overlay fades in with the badge + "TOPIC MASTERED"; clicking anywhere or Dismiss closes it.

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npm run build`

```bash
git add src/apps/archives/learn/MasteryCelebration.tsx src/apps/archives/learn/LearnView.tsx
git commit -m "feat(learn): topic-mastery celebration overlay"
```

---

### Task 12: `TrophyShelf.tsx` + rail toggle

**Files:**
- Create: `src/apps/archives/learn/TrophyShelf.tsx`
- Modify: `src/apps/archives/learn/useLearn.ts` (load all achievements), `src/apps/archives/learn/LearnView.tsx`

- [ ] **Step 1: Add an all-achievements loader to the store**

In `useLearn.ts`, add state `allAchievements: AchievementRow[]` (init `[]`) and an action:

```ts
  async loadAllAchievements() {
    set({ allAchievements: await listAchievements() });
  },
```

Add `loadAllAchievements: () => Promise<void>;` and `allAchievements: AchievementRow[];` to the interface, and `allAchievements: [] as AchievementRow[],` to `initialState`. Call it inside `openTrophyShelf(true)`:

```ts
  openTrophyShelf(open: boolean) {
    set({ trophyShelfOpen: open });
    if (open) void get().loadAllAchievements();
  },
```

- [ ] **Step 2: Write the shelf component**

```tsx
// src/apps/archives/learn/TrophyShelf.tsx
import { useLearn } from "./useLearn";
import { MasteryBadge } from "./MasteryBadge";
import type { Figure } from "./figure";

export function TrophyShelf() {
  const topics = useLearn((s) => s.topics);
  const progress = useLearn((s) => s.progress);
  const achievements = useLearn((s) => s.allAchievements);

  const topicList = Object.values(topics).sort((a, b) => b.created_at - a.created_at);
  const earnedTopicIds = new Set(achievements.filter((a) => a.kind === "topic").map((a) => a.topic_id));
  const nodeCountByTopic = (id: string) => achievements.filter((a) => a.kind === "node" && a.topic_id === id).length;

  const outlineOf = (figJson: string | null): Figure["outline"] | null => {
    try { return figJson ? (JSON.parse(figJson) as Figure).outline : null; } catch { return null; }
  };

  return (
    <div className="learn-trophy-shelf">
      <h2 className="learn-trophy-heading">Trophies</h2>
      {topicList.length === 0 && <div className="learn-rail-empty">Nothing earned yet — master some concepts.</div>}
      {topicList.map((t) => {
        const p = progress[t.id] ?? { total: 0, mastered: 0 };
        const earned = earnedTopicIds.has(t.id);
        return (
          <div key={t.id}>
            <div className="learn-trophy-topic">{t.title} · {nodeCountByTopic(t.id)} nodes · {p.mastered}/{p.total}</div>
            <div className="learn-trophy-grid">
              <div className={earned ? "" : "learn-trophy-locked"}>
                <MasteryBadge topicTitle={t.title} outline={outlineOf(t.figure_json)} masteredCount={p.mastered} total={p.total} size={150} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

(v1 shows the per-topic badge earned/locked; node-star tiles can be added in polish. Keep the grid so it can grow.)

- [ ] **Step 3: Add the rail toggle + body routing in LearnView**

In `LearnView.tsx`: add selectors `const trophyShelfOpen = useLearn((s) => s.trophyShelfOpen); const openTrophyShelf = useLearn((s) => s.openTrophyShelf);`. Add a **Trophies** button in the rail header (next to the title). In the `learn-body` render branch, when `trophyShelfOpen` is true render `<TrophyShelf />` instead of the constellation/empty-state (highest priority branch).

- [ ] **Step 4: Smoke test (human)**

Click **Trophies** in the rail → the shelf lists each topic's badge (gold if fully mastered, dimmed if not).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npm run build`

```bash
git add src/apps/archives/learn/TrophyShelf.tsx src/apps/archives/learn/useLearn.ts src/apps/archives/learn/LearnView.tsx
git commit -m "feat(learn): trophy shelf + rail toggle"
```

---

### Task 13: Rail medallion + progress hint on topics

**Files:**
- Modify: `src/apps/archives/learn/LearnView.tsx`

- [ ] **Step 1: Render the medallion / progress in the topic list**

In the topic list `.map` (lines 84-107), use `progress` to show a medallion when fully mastered, else a `m/N` hint. Add the `progress` selector (`const progress = useLearn((s) => s.progress);`) and inside each topic item, after the title span:

```tsx
              {(() => {
                const p = progress[topic.id];
                if (p && p.total > 0 && p.mastered === p.total) {
                  return (
                    <span className="learn-topic-medallion">
                      <MasteryBadge
                        topicTitle={topic.title}
                        outline={(() => { try { return topic.figure_json ? (JSON.parse(topic.figure_json) as import("./figure").Figure).outline : null; } catch { return null; } })()}
                        masteredCount={p.mastered} total={p.total} size={26} variant="medallion"
                      />
                    </span>
                  );
                }
                if (p && p.total > 0) return <span className="learn-topic-progress">{p.mastered}/{p.total}</span>;
                return null;
              })()}
```

(Keep the existing delete button after this; the medallion uses `margin-left:auto`, so place it before the delete button and let flex handle spacing — adjust if the delete button needs to stay rightmost.)

- [ ] **Step 2: Smoke test (human)**

Topics with partial progress show `m/N`; a fully mastered topic shows the tiny wireframe medallion.

- [ ] **Step 3: Final full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build && (cd src-tauri && cargo check)`
Expected: all tests pass, tsc clean, build exit 0, cargo clean (one pre-existing warning OK).

- [ ] **Step 4: Commit**

```bash
git add src/apps/archives/learn/LearnView.tsx
git commit -m "feat(learn): rail medallion + per-topic progress hint"
```

---

## Self-Review Checklist (completed)

**Spec coverage:**
- Topic figure artifact → Tasks 2, 4, 5, 7 (parse, prompt, storage, generation). ✓
- Shape-biased physics + watermark + anchor seeding → Tasks 3, 9. ✓
- On-demand "Shape this" for existing topics → Task 7 (`shapeTopic`) + Task 9 (button). ✓
- Gold + shimmer mastered nodes → Tasks 8, 9. ✓
- Idempotent achievement detection → Tasks 6, 7. ✓
- MasteryBadge (chassis + figure glyph) + rail medallion → Tasks 10, 13. ✓
- TrophyShelf (both placements) → Tasks 12, 13. ✓
- Celebration overlay → Task 11. ✓
- Migration 0025 (additive) + no new Rust/IPC → Task 1. ✓
- Per-topic progress → Tasks 5, 7. ✓
- Reduced-motion handling → Task 8 (CSS guards). ✓

**Type consistency:** `Pt`/`Figure` (figure.ts) used in claude.ts, Constellation, MasteryBadge, TrophyShelf, MasteryCelebration. `AchievementRow`/`TopicProgress` (learnTypes) used in learnDb + useLearn. `achievementKey`/`detectNewAchievements` signatures match between Task 6 and Task 7. `MasteryBadge` props identical across Tasks 10/11/12/13. ✓

**Placeholder scan:** Pure-logic tasks (1-7) carry full code + tests. UI tasks (8-13) are human-verified and carry concrete class names, prop signatures, and skeleton JSX; the badge geometry references the approved mock file for exact coordinates rather than restating ~80 SVG elements. ✓

## Notes for the executor
- ⚠️ A `tauri dev` restart is required after Task 1 (migration 0025) before any UI smoke test in Tasks 9, 11, 12, 13.
- UI Tasks 9-13 end at human smoke-test gates — the agent cannot run Tauri.
- Existing topics have `figure_json = null`; they get shaped via the **✦ Shape this** button. New topics auto-shape on creation (fail-soft).
- Frontend tests target: existing 416 + ~17 new (figure 7, forceLayout 2, claude 2, achievements 6) ≈ 433+.
```
