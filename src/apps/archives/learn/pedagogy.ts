// src/apps/archives/learn/pedagogy.ts
//
// Pedagogy engine — pure prompt builders that encode established teaching science.
// Sources surveyed (open/community references; ideas only, no copied text — all prose below is original):
//   - Wiggins & McTighe, "Understanding by Design" (backward design) — https://en.wikipedia.org/wiki/Backward_design
//   - Knowledge Space Theory / prerequisite DAGs (Doignon & Falmagne) — https://en.wikipedia.org/wiki/Knowledge_space
//   - Bloom's revised taxonomy (Anderson & Krathwohl) — https://en.wikipedia.org/wiki/Bloom%27s_taxonomy
//   - Mager's ABCD performance objectives — https://en.wikipedia.org/wiki/Instructional_objectives (CC BY-SA text, reused as concept not prose)
//   - Cognitive Load Theory (Sweller) & working-memory limits (Miller) — https://en.wikipedia.org/wiki/Cognitive_load
//   - Multimedia learning / dual coding & coherence (Mayer; Paivio) — https://en.wikipedia.org/wiki/Cognitive_theory_of_multimedia_learning
//   - Worked-example effect & retrieval practice — https://www.learningscientists.org/ (CC BY-NC-SA, ideas only)
//   - Mindset & process praise (Dweck), Feynman technique, gradual release (Pearson & Gallagher) — Wikipedia summaries
// License/attribution: Wikipedia/learningscientists text is CC BY-SA / CC BY-NC-SA; only the *pedagogical ideas* are
// adapted here — every instruction string in this file is original wording, so no source text is redistributed.

export const PEDAGOGY_VERSION = "1.2.0";

const JSON_ONLY = "Return ONLY valid JSON matching this exact shape, no prose, no markdown fences:";

/**
 * Build a knowledge-graph prompt: backward design + a prerequisite DAG of Bloom-tagged objectives.
 */
export function graphPrompt(topic: string): string {
  return `You are a master curriculum architect. Design a complete learning map for the topic: "${topic}".

Use BACKWARD DESIGN (Wiggins & McTighe): first picture what genuine mastery of "${topic}" looks like, then work backward to the concepts a learner must pass through to get there.

Structure the map as a PREREQUISITE DAG (Knowledge Space Theory): every node lists the keys of the nodes that MUST be mastered before it. No node may depend on a node that itself depends on it (no cycles), and no node may appear before its prerequisites. Foundational nodes have an empty prereqs array.

Produce 8 to 16 nodes that span FOUR difficulty bands and ramp smoothly basics -> intermediate -> advanced -> pro:
  - "basics": entry concepts, no or few prereqs.
  - "intermediate": combine and apply the basics.
  - "advanced": non-obvious connections, edge cases, deeper mechanisms.
  - "pro": expert judgment, tradeoffs, real-world synthesis.
Include at least one node in each band.

Every node MUST have:
  - a unique short "key" slug (lowercase, hyphenated, e.g. "vector-spaces"),
  - a clear "title",
  - a measurable "objective" written in ABCD form (Audience, Behavior with a concrete observable verb, Condition, Degree) — NEVER vague verbs like "understand", "know", or "be familiar with",
  - a "bloom_level" from remember|understand|apply|analyze|evaluate|create that matches the objective's verb (lower Bloom levels for basics, higher for advanced/pro),
  - a "level" band, and
  - "prereqs": an array of OTHER nodes' keys (must reference real keys in this list).

The "summary" is a 2-3 sentence orientation telling the learner where this journey starts and where it ends.

${JSON_ONLY}
{ "summary": "string", "nodes": [ { "key": "unique-slug", "title": "string", "objective": "ABCD string", "bloom_level": "remember|understand|apply|analyze|evaluate|create", "level": "basics|intermediate|advanced|pro", "prereqs": ["key-of-prereq"] } ] }`;
}

/**
 * Build a single-node lesson prompt: ABCD objective, chunked load, worked example, dual coding, retrieval.
 */
export function lessonPrompt(args: {
  topic: string;
  nodeTitle: string;
  objective: string;
  level: string;
  priorTitles: string[];
}): string {
  const { topic, nodeTitle, objective, level, priorTitles } = args;
  const prior = priorTitles.length
    ? priorTitles.map((t) => `"${t}"`).join(", ")
    : "(this is an entry node — assume no prior nodes)";
  return `You are a master teacher writing one focused lesson inside the topic "${topic}".

LESSON NODE: "${nodeTitle}"
TARGET OBJECTIVE: ${objective}
DIFFICULTY BAND: ${level} — calibrate depth, vocabulary, and pace to this band (gentle and concrete for basics; assume fluency and push tradeoffs for advanced/pro).
ALREADY-MASTERED PRIOR NODES: ${prior}. Explicitly BUILD ON these — reference what the learner already knows and connect the new idea to it; never re-teach them from scratch.

Write the lesson following these rules exactly:

1. OBJECTIVE: Restate the objective in ABCD form (Audience, Behavior with a concrete observable verb, Condition, Degree). Use Mager's rule: NO vague verbs ("understand", "know", "appreciate"). The verb must name something the learner can be observed DOING.

2. CHUNKING (Cognitive Load Theory — Sweller / Miller): break the concept into 3 to 5 chunks. Each chunk teaches exactly ONE idea and introduces AT MOST 2-3 new elements (terms, symbols, or steps). Never overload a chunk. Order chunks so each rests on the one before it. Give each chunk a short "tag" naming its single idea and a "body" in markdown.

3. CONCRETE-FIRST + PREDICTION: open the very first chunk with a concrete, specific example or scenario BEFORE any abstraction, and pose a quick prediction ("what do you expect happens if...?") so the learner commits to an answer before the explanation lands.

4. DUAL CODING + COHERENCE (Mayer / Paivio): weave in exactly ONE vivid STRUCTURAL ANALOGY that maps the concept onto something familiar (describe the mapping in words). Respect the coherence principle: NO decorative filler, no tangents — every sentence must serve the objective.

5. WORKED EXAMPLE BEFORE PRACTICE (worked-example effect): provide one fully worked example with a title and ordered steps. For EACH step give the "text" (what is done) AND a "why" (the reasoning that makes the step non-obvious). The learner should be able to reconstruct the expert's thinking, not just the moves.

6. KEY TERMS: list the handful of terms the learner must own after this lesson.

7. RESOURCES: suggest 2-4 outside resources by TYPE and TITLE plus a "search_query" the learner can paste into a search engine. Do NOT invent URLs — provide search queries only.

8. RETRIEVAL PRACTICE: end with 2 to 4 answer-first recall questions that force active recall of THIS lesson's chunks (not recognition). For each, give the "prompt", the "expected" answer, and the "concept" tag it tests.

9. VISUALS (dual coding — Mayer/Paivio): generate 2 to 4 diagrams that make the hardest ideas SEEABLE. Each visual MUST carry real instructional load (never decorative) and "chunk" MUST be the 0-based index of the concept chunk it illustrates (use -1 only for a whole-lesson overview). Pick the form that fits the idea — do NOT force one type:
   - "flow": a sequential process / algorithm / cause→effect chain. Use "steps" (ordered) where each step has a "label" (short, ≤ 4 words) and a "detail" (one sentence shown on step-through).
   - "cycle": a feedback loop or repeating process that returns to its start. Same "steps" shape (the last step loops back to the first).
   - "tree": a hierarchy / taxonomy / dependency. Use "nodes" where each node has a "label", a "detail", and "parent" = the array index of its parent node (or null for the single root). Order parents before children.
   - "compare": contrast two things side by side. Set "leftLabel" and "rightLabel" to the two things, and "rows" where each row has an "aspect", a "left" value, and a "right" value.
   - "analogy": REUSE the structural analogy from rule 4 — set "leftLabel" to the familiar domain and "rightLabel" to the concept domain, and "pairs" mapping each "familiar" element to its "concept" counterpart with a short "note" explaining the mapping.
   - "timeline": an ordered sequence of events / historical or build-up progression. Same "steps" shape, read top to bottom.
   Every visual needs a short "title" and a one-line "caption". Keep labels terse so they render cleanly; put the prose in "detail"/"note"/"caption".

${JSON_ONLY}
{ "objective": "ABCD string", "concept_chunks": [ { "tag": "string", "body": "markdown" } ], "worked_example": { "title": "string", "steps": [ { "text": "string", "why": "string" } ] }, "key_terms": ["string"], "suggested_resources": [ { "type": "video|article|book|course|docs", "title": "string", "search_query": "string" } ], "recall_check": [ { "prompt": "string", "expected": "string", "concept": "string" } ], "visuals": [ { "kind": "flow|cycle|tree|compare|analogy|timeline", "title": "string", "chunk": 0, "caption": "string", "steps": [ { "label": "string", "detail": "string" } ], "nodes": [ { "label": "string", "detail": "string", "parent": null } ], "rows": [ { "aspect": "string", "left": "string", "right": "string" } ], "pairs": [ { "familiar": "string", "concept": "string", "note": "string" } ], "leftLabel": "string", "rightLabel": "string" } ] }`;
}

/**
 * Build a grading prompt: partial credit + name the specific missed sub-concepts.
 */
export function gradePrompt(args: {
  question: string;
  expected: string;
  concept: string;
  answer: string;
}): string {
  const { question, expected, concept, answer } = args;
  return `You are a fair, generous grader assessing one recall answer.

CONCEPT BEING TESTED: ${concept}
QUESTION: ${question}
MODEL / EXPECTED ANSWER: ${expected}
LEARNER'S ANSWER: ${answer}

Grade for UNDERSTANDING, not wording — accept paraphrases, synonyms, and equivalent reasoning. Award PARTIAL CREDIT: if the learner got the core idea but missed a sub-point, mark it partial rather than wrong.

Set "correct" true only if the answer fully captures the expected idea. Set "partial" true if it captures part but not all (in that case "correct" is false). If anything is missing or wrong, list the SPECIFIC missed sub-concepts by name in "missed_concepts" so the tutor knows exactly what to reteach. If the answer is fully correct, "missed_concepts" is an empty array.

${JSON_ONLY}
{ "correct": true, "partial": false, "missed_concepts": ["string"] }`;
}

/**
 * Build a SYSTEM prompt for a streaming Socratic tutor chat. Natural dialogue — NOT JSON.
 */
export function tutorSystemPrompt(args: {
  topic: string;
  nodeTitle: string;
  objective: string;
  lessonSummary: string;
  recentMisses: string[];
}): string {
  const { topic, nodeTitle, objective, lessonSummary, recentMisses } = args;
  const misses = recentMisses.length
    ? recentMisses.map((m) => `- ${m}`).join("\n")
    : "- (none recorded yet)";
  return `You are a warm, patient master tutor helping a learner master "${nodeTitle}" within the topic "${topic}".

OBJECTIVE FOR THIS SESSION: ${objective}
LESSON CONTEXT (what was just taught): ${lessonSummary}

CONCEPTS THE LEARNER RECENTLY GOT WRONG (probe these gently to repair them):
${misses}

How you teach (follow these rules in every reply):

1. ONE QUESTION FIRST. Open by asking a single guiding question that gets the learner thinking. Do not lecture. Ask, then wait.

2. ESCALATING HINTS. If they're stuck or wrong, give the SMALLEST possible hint first. Only escalate to a bigger hint if they're still stuck. Tier your help: nudge -> partial scaffold -> near-complete -> full explanation.

3. WITHHOLD THE ANSWER. Reveal the full answer ONLY after the learner has made a genuine attempt (right or wrong), or after they explicitly ask you to just tell them. Never hand over the answer on the first turn.

4. GRADUAL RELEASE (I do / we do / you do). Early on, model the thinking yourself (I do). Then solve a step together (we do). Then hand the next step entirely to them (you do). Shift more responsibility to the learner as they succeed.

5. PROCESS PRAISE, NOT ABILITY PRAISE (Dweck). Praise effort, strategy, and persistence ("nice — testing that edge case was a smart move") — never fixed traits ("you're so smart"). When a strategy isn't working, offer a STRATEGY-SWITCH off-ramp ("that approach is getting tangled — want to try thinking about it as ___ instead?") rather than letting them grind.

6. FEYNMAN CHECK. At natural milestones, ask the learner to EXPLAIN THE IDEA BACK in their own words (or teach it to a beginner). Use the gaps in their explanation to find what to reinforce next.

Keep replies short, conversational, and encouraging. You are a dialogue partner, not a textbook. Respond in plain natural language — never JSON, never markdown headings.`;
}

/**
 * Build a prompt that uses web search to find REAL learning resources (only URLs actually found).
 */
export function findLinksPrompt(args: {
  topic: string;
  nodeTitle: string;
  keyTerms: string[];
}): string {
  const { topic, nodeTitle, keyTerms } = args;
  const terms = keyTerms.length ? keyTerms.join(", ") : "(no specific key terms)";
  return `You are a research librarian finding high-quality learning resources for the lesson "${nodeTitle}" within the topic "${topic}".
Key terms to anchor your searches: ${terms}.

USE WEB SEARCH to find real, currently-reachable resources (videos, articles, official docs, courses) that teach this material well.

CRITICAL: Only return URLs you ACTUALLY FOUND via web search. NEVER guess, construct, or hallucinate a URL. If you cannot verify a resource exists from your search results, leave it out. It is better to return fewer resources than to return a single fabricated link. Prefer authoritative sources (official docs, reputable educators, well-known publications).

${JSON_ONLY}
{ "resources": [ { "type": "video|article|docs|course", "title": "string", "url": "https://..." } ] }`;
}

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
