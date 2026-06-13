import { create } from "zustand";
import { searchHybrid } from "@/lib/searchHybrid";
import { useNotesStore } from "@/store/notesStore";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

/** "Ask your Archive" — retrieval-augmented Q&A over your own notes, with
 * citations back to the source notes. Directly targets Notion's weakest
 * (and paywalled) AI surface, using the hybrid FTS5+semantic search and the
 * subscription CLI we already have. */

export type Source = { n: number; id: string; title: string; kind: string | null };

const MAX_SOURCES = 6;
const PER_NOTE_CHARS = 1600;

export function buildPrompt(question: string, sources: Array<{ n: number; title: string; body: string }>): string {
  const ctx = sources
    .map((s) => `[${s.n}] ${s.title}\n${s.body}`)
    .join("\n\n---\n\n");
  return [
    "You are answering a question using ONLY the user's own notes below. Cite every claim with its source number in square brackets like [1] or [2]. If the notes don't contain the answer, say so plainly — do not invent. Be concise.",
    "",
    "=== NOTES ===",
    ctx,
    "=== END NOTES ===",
    "",
    `Question: ${question}`,
  ].join("\n");
}

export type AskResult = { answer: string; sources: Source[] };

export async function askArchive(question: string): Promise<AskResult> {
  const hits = await searchHybrid(question, 14);
  const notes = useNotesStore.getState().notes;

  const picked: Array<{ n: number; id: string; title: string; kind: string | null; body: string }> = [];
  for (const h of hits) {
    if (h.entityType !== "note") continue;
    const note = notes.get(h.entityId);
    const body = (note?.plaintext ?? h.snippet ?? "").slice(0, PER_NOTE_CHARS);
    if (!body.trim()) continue;
    picked.push({
      n: picked.length + 1,
      id: h.entityId,
      title: h.title || "Untitled",
      kind: h.noteKind ?? null,
      body,
    });
    if (picked.length >= MAX_SOURCES) break;
  }

  if (picked.length === 0) {
    return {
      answer: "I couldn't find anything in your notes about that yet.",
      sources: [],
    };
  }

  const answer = await ipc.claudeOneshot(buildPrompt(question, picked));
  return {
    answer: answer.trim(),
    sources: picked.map((p) => ({ n: p.n, id: p.id, title: p.title, kind: p.kind })),
  };
}

type AskState = {
  open: boolean;
  question: string;
  loading: boolean;
  result: AskResult | null;
  error: string | null;
  show: () => void;
  hide: () => void;
  setQuestion: (q: string) => void;
  run: () => Promise<void>;
};

export const useAskArchive = create<AskState>((set, get) => ({
  open: false,
  question: "",
  loading: false,
  result: null,
  error: null,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  setQuestion: (question) => set({ question }),
  run: async () => {
    const q = get().question.trim();
    if (!q || get().loading) return;
    set({ loading: true, error: null, result: null });
    try {
      const result = await askArchive(q);
      set({ result, loading: false });
    } catch (e) {
      log.error("ask archive failed", e);
      set({
        error: e instanceof Error ? e.message : String(e),
        loading: false,
      });
    }
  },
}));
