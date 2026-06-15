# Archives "Learn" — AI tutor + learning-tree section

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pre-plan
**Section accent:** `--neon-violet` (#b14cff) — the one app accent not yet claimed by a section.
**Module:** `src/apps/archives/learn/` (self-contained, mirrors `repolens/`)

---

## 1. Summary

A new **Learn** section in Archives. You name a topic you want to learn; an AI researches it and generates a **learning tree** (a prerequisite graph from basics → pro). You navigate the tree as an **Obsidian-style force-directed constellation**. Opening a node generates (and caches) a richly-structured **lesson page** with an always-available **scoped AI tutor**. Progress is tracked by a **code-owned adaptive mastery engine** (Bayesian Knowledge Tracing): recall checks update a per-node mastery score, which gates when dependent nodes unlock, and a forgetting-decay model resurfaces "cooled" nodes for review.

The differentiator vs. a generic chatbot is the **pedagogy engine**: every AI generation/tutoring call runs through a versioned "master teacher" system prompt grounded in learning-science research, so lessons are an elite learning experience by construction.

---

## 2. Guiding principle — LLM vs. code split

The 2024–2026 AI-tutor literature is emphatic: **LLMs are unreliable at holding a persistent learner model in-context** (unstable, wrong-direction mastery estimates). The fix the field converged on is "LLM + explicit external memory." So:

- **LLM owns:** generating the concept graph, generating each lesson, Socratic tutoring, grading free-text answers, fetching real resources.
- **Plain code owns:** the mastery math (BKT, ~6 lines, no ML), unlock gating, forgetting-decay, and what to resurface — all auditable, all unit-tested.

The LLM proposes and teaches; code decides mastery and progression.

---

## 3. User-approved decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Core experience | **Lesson page (spine) + scoped tutor panel** per node |
| Progression | **Adaptive mastery tracking** (BKT) — checks gate unlocks; decay drives review |
| Generation timing | **Tree structure on topic-create (1 call); lessons on-demand + cached** |
| Resources | **Suggested by default** (no fabricated URLs) + a **"Find real links"** web-search agent button |
| Tree visualization | **Constellation / radial, Obsidian-style force-directed** (draggable, zoom/pan) |
| Lesson anatomy | objective → concept chunks → worked example → key terms → suggested resources → recall check |
| Pedagogy prompt | **Drafted at implementation time**; first survey GitHub for existing teaching skills/prompts to adapt |
| Visual quality | **Production-grade via the frontend-design skill** — a hard requirement, not later polish |

---

## 4. Architecture

```
Topic create ──▶ 1 LLM call ──▶ concept graph (DAG: nodes + prereq edges)
                                      │
                                rendered as force-directed CONSTELLATION
                                      │
Open a node ──▶ generate lesson on demand (cached on the node) ──▶ LESSON PAGE + scoped TUTOR
                                      │
Answer recall checks ──▶ LLM grades ──▶ code-side BKT updates p_mastery ──▶ recompute gates ──▶ unlock dependents
                                      │
Forgetting decay over time ──▶ mastered nodes cool ──▶ resurface as "Ready to review"
```

A new `learn` value in the `ArchivesView` union (`useArchives.ts`), a sidebar entry in the `LIBRARY` array (`ArchivesApp.tsx`, icon e.g. `GraduationCap`/`Sparkles`), and a route to `<LearnView>` in the content router. All section-local state in a `useLearn` Zustand store mirroring `useRepoLens` (optimistic updates, DB persistence, prefs hydration).

---

## 5. Data model — migration `0024_learn.sql` (additive)

```sql
CREATE TABLE learn_topics (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  summary     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | archived
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE learn_nodes (
  id          TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL REFERENCES learn_topics(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  objective   TEXT,                              -- ABCD measurable objective
  bloom_level TEXT,                              -- remember..create
  level       TEXT NOT NULL,                     -- basics | intermediate | advanced | pro
  order_idx   INTEGER NOT NULL,
  lesson_json TEXT,                              -- cached lesson content (nullable until first open)
  lesson_at   INTEGER,
  p_mastery   REAL NOT NULL DEFAULT 0.0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER,
  status      TEXT NOT NULL DEFAULT 'locked'     -- locked | ready | in_progress | mastered
);
CREATE INDEX idx_learn_nodes_topic ON learn_nodes(topic_id);

CREATE TABLE learn_edges (                        -- prerequisite DAG
  topic_id  TEXT NOT NULL REFERENCES learn_topics(id) ON DELETE CASCADE,
  from_node TEXT NOT NULL,                         -- prerequisite
  to_node   TEXT NOT NULL,                         -- depends on from_node
  PRIMARY KEY (topic_id, from_node, to_node)
);

CREATE TABLE learn_reviews (                       -- append-only check log (feeds BKT + decay)
  id        TEXT PRIMARY KEY,
  node_id   TEXT NOT NULL REFERENCES learn_nodes(id) ON DELETE CASCADE,
  ts        INTEGER NOT NULL,
  correct   INTEGER NOT NULL,                       -- 0/1
  kind      TEXT NOT NULL DEFAULT 'recall'          -- recall | review
);
CREATE INDEX idx_learn_reviews_node ON learn_reviews(node_id);
```

CRUD helpers in `src/apps/archives/learn/learnDb.ts` (mirror `repolensDb.ts`). `lesson_json` is fail-soft parsed.

---

## 6. The constellation view (`Constellation.tsx`)

Hand-rolled force-directed graph in SVG — **no new dependency** (locked stack).

- **Physics:** charge repulsion + spring links along prerequisite edges + gentle centering pull, run in a `requestAnimationFrame` loop that settles then idles. Pauses when the window is hidden/covered (as the wallpaper already does). `prefers-reduced-motion` → jump straight to the settled layout, no animation.
- **Interaction:** drag a node (springs back into the web), scroll/pinch zoom, drag-to-pan. Click a node → open its lesson (if `ready`/`in_progress`/`mastered`; a `locked` node shows "needs X first").
- **Node states:** `mastered` (filled violet + glow), `ready` (outlined, bright), `in_progress` (partial), `locked` (dim). Node size/glow scales with `p_mastery`. Hover lights its edges. A "Ready to review" pulse for decayed-but-mastered nodes.
- **Topic rail:** left list of topics (like RepoLens's library) + a "＋ Learn something new…" input that creates a topic (fires graph generation). Selecting a topic loads its constellation.

Pure layout/physics helpers (`forceLayout.ts`) and graph derivations (gating, ready-set) are unit-tested.

---

## 7. Lessons — generation + anatomy

- **On first open of a node:** one LLM call generates structured `lesson_json`, cached on the node. Re-openable instantly; a "regenerate" affordance overwrites.
- **Generation method:** backward design (objective → evidence → content); capped to **3–5 single-idea chunks**.
- **Lesson anatomy (the rendered contract):**
  - `objective` — ABCD measurable ("By the end you'll be able to…").
  - `concept_chunks[]` — segmented, one idea each, with key-term highlights; a Continue between chunks; segmented progress bar.
  - `worked_example` — fully worked, with per-step rationale.
  - `key_terms[]` — chips.
  - `suggested_resources[]` — `{type, title, search_query}`; no URLs by default.
  - `recall_check[]` — 2–4 questions, each `{prompt, expected, concept}`.
- Rendered to production quality with the **frontend-design skill** against real tokens (violet accents, glass surfaces, motion). Markdown via the existing `react-markdown` + `remark-gfm` + `rehype-highlight` setup.
- A pure `learnTypes.ts` schema + fail-soft `parseLesson` (fence-strip + `{`..`}` slice + array coercion, mirroring `parseDesignSpec`), unit-tested.

---

## 8. Mastery engine (code-owned)

- **BKT** (`bkt.ts`, pure, TDD): after each graded recall answer, update `p_mastery` from `{prior, correct, p_slip≈0.1, p_guess≈0.2, p_transit≈0.15}`. Mastery classified at `p_mastery ≥ 0.8`.
- **Grading:** free-text answers graded by a small LLM call → `{correct, partial, missed_concepts[]}`. The boolean feeds BKT; `missed_concepts` feed the tutor and future review framing.
- **Gating:** a node is `ready` when **all prerequisites** have `p_mastery ≥ 0.8` AND `attempts ≥ 3`; `mastered` when its own score crosses the threshold with enough attempts. Store recomputes every node's `status` after each review (pure `recomputeGates(nodes, edges)`, unit-tested).
- **Forgetting + spacing:** an effective mastery decays with `last_seen` age (e.g. small per-day decrement, floored). When a mastered node's effective score drops below a review band, the constellation flags it "Ready to review." This delivers spaced repetition without a separate flashcard subsystem in v1.

---

## 9. Pedagogy engine (the "teacher skill") — `pedagogy.ts`

Versioned "master teacher" system-prompt templates, applied to every AI call. **Drafted at implementation time**, and the first step of that task is to **survey GitHub/community for existing teaching/tutor skills and prompts to adapt** (e.g. the Vanderbilt `knowledge-spaces` Claude skills, Anthropic/community skill collections, Socratic-tutor prompts), with license/attribution care — not invent from scratch. A `PEDAGOGY_VERSION` string lets us improve teaching quality without touching the rest of the code.

Techniques operationalized as enforced prompt instructions:

- **Graph generation:** backward design (Wiggins & McTighe); prerequisite DAG / Knowledge Space Theory (no node before its prereqs); Bloom-tagged objectives ramping basics→pro.
- **Lesson generation:** ABCD measurable objectives (Mager, no vague verbs); cognitive-load + chunking (Sweller/Miller, ≤2–3 new elements/chunk); worked-example effect (example-before-practice, with rationale); dual coding + Mayer coherence (structural analogy, no filler); concrete-first + prediction (desirable difficulty); retrieval practice (answer-first recall checks, the top-evidenced technique).
- **Tutoring (enforced Socratic contract — base LLMs over-help):** one guiding question first, escalating hint tiers, answer only after N attempts or explicit request; gradual release (I do/we do/you do); process praise not ability praise (Dweck) with a strategy-switch off-ramp; Feynman "explain it back."
- **Grading:** partial credit + name missed sub-concepts (formative assessment).

---

## 10. Tutor + resources + AI plumbing

- **Tutor panel** (`TutorPanel.tsx`): scoped to the open lesson (objective + content + recent misses injected as context). Quick actions: Hint · Explain it back · Simpler · Deeper. Streaming via `claude_send` (token-by-token, like the other rails) with a per-section model picker (`useModelPrefs`).
- **Resources:** "Find real links" dispatches a web-search-enabled CLI call returning verified URLs, cached onto the lesson's resources.
- **One-shot generations** (graph, lesson, grading, real-links): a serialized queue mirroring `repolens/claude.ts` (1.2s gap, single-flight) over a `repolens_claude_call`-style command; fail-soft JSON parsing throughout.
- **Web search for resources/graph:** uses the subscription CLI's web-search capability on that specific call only.

---

## 11. Styling

- Section tokens: add `--learn-accent: var(--neon-violet)` + `--learn-accent-rgb` in `tokens.css`; scope `.learn-view { --lr: …; --lr-rgb: … }` (RepoLens pattern). `.learn-*` classes for all surfaces.
- Production-grade visual quality via the **frontend-design skill** — constellation, lesson page, tutor, topic rail. Glass surfaces, Space Grotesk, segmented progress, motion, `prefers-reduced-motion` guards.

---

## 12. Phasing

**v1 (this spec):** Learn view + topic rail; topic-create → graph generation; force-directed constellation with states/zoom/pan/drag; on-demand cached lesson generation; full lesson anatomy rendered to production quality; scoped streaming tutor + quick actions; recall checks → LLM grading → code-side BKT → gating; forgetting-decay review resurfacing; suggested resources + find-real-links agent; pedagogy engine v1.

**Deferred to v2:** dedicated spaced-repetition flashcard deck; interleaved mixed-practice sessions; a skillometer/stats dashboard; cross-topic linking; export a topic/lesson to an Archives note; richer model-tracing for multi-step problems.

---

## 13. Testing & gates

- Pure-logic TDD: `bkt.ts`, `recomputeGates`, `forceLayout.ts`, `parseLesson`/`parseGraph`, decay math.
- Standard gates per slice: `tsc`, `vitest`, `cargo check`/tests (migration only), `npm run build` — all on real exit codes.
- Migration 0024 requires a `tauri dev` restart before smoke-testing. UI is human-verified by the user (agent can't run Tauri).

---

## 14. File map

```
src/apps/archives/learn/
  LearnView.tsx          # shell: topic rail + constellation / lesson router
  Constellation.tsx      # force-directed graph
  forceLayout.ts         # pure physics + layout helpers (tested)
  LessonView.tsx         # lesson page (anatomy)
  TutorPanel.tsx         # scoped streaming tutor
  useLearn.ts            # zustand store
  learnDb.ts             # SQLite CRUD
  learnTypes.ts          # schemas + fail-soft parsers (tested)
  bkt.ts                 # mastery math (tested)
  gating.ts              # recomputeGates + ready-set + decay (tested)
  pedagogy.ts            # versioned master-teacher prompts
  claude.ts              # serialized queue wrapper
src-tauri/migrations/
  0024_learn.sql
src/styles/tokens.css    # --learn-accent + .learn-* styles
src/apps/archives/useArchives.ts   # + "learn" view
src/apps/archives/ArchivesApp.tsx  # + sidebar entry + route
```
