# Learn — topic-shaped constellations + achievements & badges

**Date:** 2026-06-16
**Branch:** `feat/archives-learn-section`
**Status:** approved design, ready for planning
**Module:** `src/apps/archives/learn/`

## Goal

Upgrade the Archives **Learn** section with two features that share a single AI-generated artifact:

1. **Topic-shaped constellations** — the force-directed graph forms a recognizable silhouette of the subject (Linux → penguin), rather than an arbitrary physics blob.
2. **Achievements & badges** — completing (mastering) a node turns it gold and shimmers and awards a node achievement; mastering *every* node in a topic awards a topic **mastery badge**.

Only **two** achievement types ship (per-node mastery, per-topic mastery). No milestones, tiers, or rarity in v1.

## The shared artifact: a "topic figure"

The keystone of the design. When a topic is created, a focused AI call produces a **figure** describing the subject's iconic silhouette in a normalized 0..1 coordinate space:

```ts
type Pt = { x: number; y: number };          // normalized 0..1
type Figure = {
  name: string;        // e.g. "penguin"
  outline: Pt[];       // ordered points tracing the silhouette (watermark + badge glyph)
  anchors: Pt[];       // node attractor positions forming the figure
};
```

This single artifact does double duty:

- **Constellation** → nodes are pulled toward `anchors`, so the settled graph evokes the figure.
- **Badge** → `outline` is drawn as the wireframe glyph in the center of the mastery badge.

`figure_json` is stored on the topic row and cached (like lessons). Generation is **fail-soft**: a parse failure or empty result means `figure = null`, and both features degrade gracefully — the constellation runs today's plain physics, and the badge uses a generic fallback sigil. Nothing about the existing flow breaks when there is no figure.

---

## Feature 1 — Topic-shaped constellation

Approach: **shape-biased physics** (chosen over a literal pinned figure or a purely cosmetic watermark). Physics still runs, but each node is gently pulled toward an anchor inside the figure. This reads as the shape, stays legible, and is robust to any node count — the way real star constellations only *evoke* their namesake.

### New pure logic (TDD)

**`figure.ts`**
- `parseFigure(raw: string): Figure | null` — fail-soft parser mirroring `learnTypes.ts` salvage style (fence-strip, slice outermost `{}`, coerce arrays to `[]`, clamp coords to 0..1, drop non-finite points). Returns `null` when no usable object or when `outline`/`anchors` come back empty.
- `assignAnchors(nodeIds: string[], anchors: Pt[]): Record<string, Pt>` — maps nodes (in `order_idx` order) to anchors by index (zip). Extra nodes (more nodes than anchors) get no anchor (pure physics). Extra anchors are ignored. Pure, deterministic.

**`forceLayout.ts`** (extend existing)
- `SimNode` gains optional `anchor?: { x: number; y: number }` (in the same pixel space as `x`/`y`).
- `stepForces` adds an `ANCHOR_PULL` spring term: for an anchored node, `v += (anchor - pos) * ANCHOR_PULL`.
- When anchors are present the figure dominates: `CENTER_PULL` is suppressed for anchored nodes (anchors replace centering) and the edge `SPRING` is softened so prerequisite edges nudge but don't fight the shape. Pairwise `REPULSION` stays so co-located nodes still separate (no overlap).
- Constants tuned so an anchored node provably converges toward its anchor (unit-tested).

### Constellation rendering changes

`Constellation.tsx`:
- **Seeding:** when the open topic has a figure, seed each node *at* its assigned anchor (anchor.x × seedW, anchor.y × seedH) instead of the deterministic ring; set `anchor` on each `SimNode`. No figure → unchanged ring seed, no anchors.
- **Silhouette watermark:** render the `outline` as a faint closed `<path>` behind the nodes, inside the `lc-viewport` transform group (pans/zooms with the graph). Digital-ghost styling: thin violet stroke, very low-opacity fill, optional grain. Only when a figure exists.
- Existing auto-fit, drag, pan/zoom, reduced-motion static settle, and visibility pausing are untouched — anchors are just an added force, and auto-fit reframes whatever settles.

### On-demand "shape this constellation"

Existing topics (already created before this feature) have no figure. A small **"Shape this"** affordance in the constellation header generates a figure on demand for the open topic, persists `figure_json`, and re-seeds. New topics auto-generate a figure at creation time. This makes the feature apply to the whole library, not just future topics.

### Figure generation plumbing

- New prompt builder `figurePrompt({ topic, nodeCount })` in `pedagogy.ts` (bump `PEDAGOGY_VERSION`): asks for a recognizable silhouette of the topic's iconic symbol as normalized points — `name`, an ordered `outline` (~12–28 points tracing the shape), and exactly `nodeCount` `anchors` distributed across the figure. Strict JSON-shape contract matching `parseFigure`.
- New `generateFigure(topic, nodeCount, model): Promise<Figure | null>` in `claude.ts`, enqueued on the existing serialized 1.2s-gap queue, reusing `learnClaudeCall(prompt, model, false)`. Wrapped so any failure resolves to `null`.
- `useLearn`: `createTopic` enqueues `generateFigure` after the graph and persists `figure_json`; a new `shapeTopic(id)` action covers the on-demand path. Both fail-soft (a missing figure never blocks topic creation).

---

## Feature 2 — Achievements & badges

### Mastered node → gold + shimmer

- New token `--lr-gold-rgb` (≈ `232,193,74`). Mastered nodes render a **gold radial fill**, a **gold glow**, and a **shimmer sweep** (an animated highlight clipped to the hex). In-progress / ready / locked nodes stay violet (the section accent). The review-pulse ring and mastery arc are unchanged.
- Reduced-motion: static gold fill, no sweep.
- Edges remain violet (the "signal" energy); only node mastery turns gold, keeping churn minimal.

### Achievement detection (pure, idempotent)

**`achievements.ts`** (TDD):
- `achievementKey(kind: "node" | "topic", nodeId?: string): string`.
- `topicFullyMastered(nodes: NodeRow[]): boolean`.
- `detectNewAchievements(prev, next, earnedKeys, topicId)` → `{ nodeAchievements: NodeRow[]; topicEarned: boolean }`, computed from `!mastered → mastered` status transitions, excluding anything already in `earnedKeys`. **Idempotent**: a node that decays below threshold and is re-mastered does *not* re-award (its key is already earned). Topic award fires only on the transition into "all mastered" and only if not already earned.

### Where detection runs

In `useLearn.submitAnswer`, after `recomputeStatuses`: diff prev vs next via `detectNewAchievements`, then for each new achievement — insert a row, add its key to the in-memory `earnedKeys` set, and fire the celebration:
- **Node:** gold toast ("Node mastered — <title>").
- **Topic:** a modest center-screen **celebration overlay** showing the badge, plus a toast. Fires once (idempotency guards re-runs).

### Components

- **`MasteryBadge.tsx`** — the animated mil-spec badge chassis: octagon plate + double border + rivets, 8-point sunburst star, a slow rotating outer reticle, a counter-rotating violet sub-dial, a scanline sweep, fractal grain wash, and monospace `UNIT·<TOPIC> / MASTERED / n/N · %` stamps. The **centered glyph is the topic figure's `outline`** rendered as a thin gold wireframe; a generic sigil when no figure exists. Props: `topicTitle`, `outline?`, `masteredCount`, `total`, `size`. Reduced-motion freezes rotations/scan. (Visual polish is expected during implementation — the brainstormed mock is the direction, not the final pixels.)
- **`RailMedallion`** — a tiny static plate + glyph variant (a `size`/`variant` mode of `MasteryBadge` or a thin wrapper) shown next to fully-mastered topics in the rail.
- **`TrophyShelf.tsx`** — a body view (toggled from the rail) gathering all earned achievements grouped by topic: the topic badge (earned, or a locked silhouette) and that topic's node-stars (gold for earned). Locked/empty slots are hinted so progress is visible.
- **`MasteryCelebration.tsx`** — the center-screen overlay for topic completion: badge zoom-in with grain/scanline + "TOPIC MASTERED" stamp, dismissible. Lightweight; node completions are toast-only.

### Per-topic progress

The rail medallion and shelf need mastery counts for topics that aren't currently open (nodes are only loaded for the open topic). Add to `useLearn`:
- `loadTopicProgress()` → `SELECT topic_id, COUNT(*) AS total, SUM(status='mastered') AS mastered FROM learn_nodes GROUP BY topic_id`, stored as `progress: Record<topicId, { total: number; mastered: number }>`.
- Refreshed on topic-list load and recomputed locally for the open topic after `submitAnswer`.
- LearnView renders the medallion when `progress[topicId].total > 0 && mastered === total`, with an inline `m/N` hint otherwise.

---

## Data model

**Migration `0025_learn_figures_achievements.sql`** (additive, append-only — never edit 0024):

```sql
ALTER TABLE learn_topics ADD COLUMN figure_json TEXT;

CREATE TABLE learn_achievements (
  id        TEXT PRIMARY KEY,
  topic_id  TEXT NOT NULL,
  kind      TEXT NOT NULL,   -- 'node' | 'topic'
  node_id   TEXT,            -- null for topic badges
  title     TEXT NOT NULL,   -- denormalized label (node or topic title)
  earned_at INTEGER NOT NULL
);
CREATE INDEX idx_learn_achv_topic ON learn_achievements(topic_id);
```

- `TopicRow` gains `figure_json: string | null`; `insertTopic` and a new `updateTopic(id, patch)` handle it.
- `deleteTopic` also deletes `learn_achievements` for the topic (cascade by hand, matching the existing manual-cascade pattern).
- `learnDb.ts` gains `listAchievements(topicId?)`, `insertAchievement`, `topicProgress()`.
- Achievement `title` is denormalized so the shelf renders without joins and a deleted node still reads sensibly until its topic is deleted.

---

## Plumbing / scope

- **No new Rust, no new IPC.** Figure generation reuses the existing `learn_claude_call` command via `claude.ts`; achievements are pure frontend + the existing `getDb` SQLite path.
- ⚠️ **A `tauri dev` restart is required only for migration 0025** to apply. All TypeScript/CSS hot-reloads.
- The new migration must be registered in the Rust migrations list alongside 0024.

## Error handling & edge cases

- Figure generation failure → `figure = null` → plain physics + fallback badge glyph. Never blocks topic creation.
- Node count ≠ anchor count → `assignAnchors` zips the overlap; surplus nodes fall back to physics, surplus anchors are ignored.
- Decay then re-master → no duplicate achievement (idempotent keys).
- Topic deleted → its achievements are removed; its trophies leave the shelf (acceptable).
- Concurrent recall submit → keep the existing synchronous read-modify-write in `submitAnswer`; achievement detection runs inside the same synchronous block before the DB persist.
- Reduced-motion → static gold node, frozen badge animations, static celebration.

## Testing

Pure-logic unit tests (vitest), matching the module's existing TDD discipline:
- `figure.ts` — `parseFigure` fail-soft cases (good JSON, fenced, garbage, empty arrays, out-of-range coords); `assignAnchors` zip/surplus/deficit.
- `forceLayout.ts` — an anchored node converges toward its anchor; unanchored behavior unchanged.
- `achievements.ts` — node/topic transition detection, idempotency under decay→re-master, topic award only on full completion, no double-award.
- `progress`/db helper — `topicProgress` shape (where unit-testable without Tauri).

UI components (`Constellation`, `MasteryBadge`, `TrophyShelf`, `MasteryCelebration`, rail medallion) are **human-verified** — the agent can't run Tauri; these end at user smoke-test gates.

## Out of scope (v1)

- Milestone / tiered / rarity achievements (only the two named types).
- AI-drawn per-topic glyphs (reuse the figure outline; generic fallback otherwise).
- Figure re-roll / multiple variants (generate once or absent; on-demand "shape this" is the only regeneration).
- Semantic node→anchor assignment (e.g. basics-at-the-feet) — simple `order_idx` zip only.
- Cross-topic meta-badges, streaks, leaderboards.
```
