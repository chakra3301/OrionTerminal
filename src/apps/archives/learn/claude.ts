// src/apps/archives/learn/claude.ts
import { learnClaudeCall } from "../../../lib/ipc";
import { runTextModel } from "@/features/agents/textCall";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import { routeFor } from "@/features/agents/dispatchSend";
import { parseModelValue } from "@/features/agents/modelSelection";
import { useProvidersStore } from "@/store/providersStore";
import { parseGraphSpec, parseLesson, type GraphSpec, type Lesson } from "./learnTypes";
import { graphPrompt, lessonPrompt, gradePrompt, findLinksPrompt, figurePrompt } from "./pedagogy";
import { parseFigure, type Figure } from "./figure";
import { withArchivesActivity } from "@/apps/archives/runtimeActivity";

const MIN_GAP_MS = 1200;

// A lane serializes its own calls and spaces them by MIN_GAP_MS. Separate lanes
// run independently, so a slow background call can't stall a user-facing one.
function makeLane() {
  let chain: Promise<unknown> = Promise.resolve();
  let lastCall = 0;
  return function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run as Promise<T>;
  };
}

// Graph/lesson/grade/links share one lane (user is waiting on these). The
// decorative topic figure runs on its own lane so it never queues ahead of a
// lesson the user just opened.
const enqueue = makeLane();
const enqueueFigure = makeLane();

function trackedCall(prompt: string, model: string, allowWeb: boolean) {
  return withArchivesActivity(
    "learn-ai",
    "Wait for Archives Learn AI work to finish before disabling the plugin.",
    async () => {
      if (!allowWeb) return { result: await runTextModel(prompt, model) };
      const resolved = resolveSendFromStores(model);
      if (routeFor(useProvidersStore.getState().providers, resolved.model) !== "claude") {
        throw new Error("Verified web-link lookup currently requires the Claude connector. Lesson generation, grading, and tutoring use any configured provider.");
      }
      return learnClaudeCall(prompt, parseModelValue(resolved.model).modelId, true);
    },
  );
}

export async function generateGraph(topic: string, model: string): Promise<GraphSpec> {
  const reply = await enqueue(() => trackedCall(graphPrompt(topic), model, false));
  return parseGraphSpec(reply.result);
}

export async function generateFigure(topic: string, nodeCount: number, model: string): Promise<Figure | null> {
  try {
    const reply = await enqueueFigure(() => trackedCall(figurePrompt({ topic, nodeCount }), model, false));
    return parseFigure(reply.result);
  } catch {
    return null;
  }
}

export async function generateLesson(args: { topic: string; nodeTitle: string; objective: string; level: string; priorTitles: string[] }, model: string): Promise<Lesson> {
  const reply = await enqueue(() => trackedCall(lessonPrompt(args), model, false));
  return parseLesson(reply.result);
}

export type Grade = { correct: boolean; partial: boolean; missed_concepts: string[] };
export async function gradeAnswer(args: { question: string; expected: string; concept: string; answer: string }, model: string): Promise<Grade> {
  const reply = await enqueue(() => trackedCall(gradePrompt(args), model, false));
  try {
    const s = reply.result; const a = s.indexOf("{"); const b = s.lastIndexOf("}");
    const o = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
    if (!o || typeof o.correct !== "boolean" || typeof o.partial !== "boolean" || !Array.isArray(o.missed_concepts) || !o.missed_concepts.every((c: unknown) => typeof c === "string")) {
      throw new Error("Invalid grade");
    }
    return { correct: o.correct, partial: o.partial, missed_concepts: o.missed_concepts };
  } catch {
    throw new Error("The model returned an invalid grade. Your mastery was not changed — please retry.");
  }
}

export async function findRealLinks(args: { topic: string; nodeTitle: string; keyTerms: string[] }, model: string): Promise<Array<{ type: string; title: string; url: string }>> {
  const reply = await enqueue(() => trackedCall(findLinksPrompt(args), model, true)); // allow_web
  try {
    const s = reply.result; const a = s.indexOf("["); const b = s.lastIndexOf("]");
    const arr = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : [];
    return Array.isArray(arr) ? arr.filter((r: any) => r?.url).map((r: any) => ({ type: String(r.type ?? "article"), title: String(r.title ?? r.url), url: String(r.url) })) : [];
  } catch {
    return [];
  }
}
