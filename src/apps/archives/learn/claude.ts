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
  return parseGraphSpec((reply as { result: string }).result);
}

export async function generateLesson(args: { topic: string; nodeTitle: string; objective: string; level: string; priorTitles: string[] }, model: string): Promise<Lesson> {
  const reply = await enqueue(() => learnClaudeCall(lessonPrompt(args), model, false));
  return parseLesson((reply as { result: string }).result);
}

export type Grade = { correct: boolean; partial: boolean; missed_concepts: string[] };
export async function gradeAnswer(args: { question: string; expected: string; concept: string; answer: string }, model: string): Promise<Grade> {
  const reply = await enqueue(() => learnClaudeCall(gradePrompt(args), model, false));
  try {
    const s = (reply as { result: string }).result; const a = s.indexOf("{"); const b = s.lastIndexOf("}");
    const o = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : {};
    return { correct: !!o.correct, partial: !!o.partial, missed_concepts: Array.isArray(o.missed_concepts) ? o.missed_concepts.map(String) : [] };
  } catch {
    return { correct: false, partial: false, missed_concepts: [] };
  }
}

export async function findRealLinks(args: { topic: string; nodeTitle: string; keyTerms: string[] }, model: string): Promise<Array<{ type: string; title: string; url: string }>> {
  const reply = await enqueue(() => learnClaudeCall(findLinksPrompt(args), model, true)); // allow_web
  try {
    const s = (reply as { result: string }).result; const a = s.indexOf("["); const b = s.lastIndexOf("]");
    const arr = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : [];
    return Array.isArray(arr) ? arr.filter((r: any) => r?.url).map((r: any) => ({ type: String(r.type ?? "article"), title: String(r.title ?? r.url), url: String(r.url) })) : [];
  } catch {
    return [];
  }
}
