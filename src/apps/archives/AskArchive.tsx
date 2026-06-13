import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Loader2, FileText, NotebookPen, FolderKanban } from "lucide-react";
import { useAskArchive, type Source } from "@/features/notes/askArchive";
import { useArchives } from "@/apps/archives/useArchives";
import { useShell } from "@/shell/store/useShell";

const KIND_ICON: Record<string, typeof FileText> = {
  note: FileText,
  journal: NotebookPen,
  project: FolderKanban,
};

function openSource(s: Source) {
  const a = useArchives.getState();
  if (s.kind === "journal") {
    a.setView("journal");
    a.setSelectedNoteId(s.id);
  } else if (s.kind === "project") {
    a.setView("projects");
    a.setOpenProjectId(s.id);
  } else {
    a.setView("notes");
    a.setOpenNoteId(s.id);
  }
  useShell.getState().openApp("archives");
}

/** Render an answer string with [n] tokens turned into clickable citation
 * chips that jump to the source note. */
function AnswerWithCitations({ answer, sources }: { answer: string; sources: Source[] }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const parts: ReactNode[] = [];
  let last = 0;
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) parts.push(answer.slice(last, m.index));
    const n = Number(m[1]);
    const src = byN.get(n);
    if (src) {
      parts.push(
        <button
          key={`c-${key++}`}
          type="button"
          className="ot-ask-cite"
          title={src.title}
          onClick={() => openSource(src)}
        >
          {n}
        </button>,
      );
    } else {
      parts.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push(answer.slice(last));
  return <div className="ot-ask-answer">{parts}</div>;
}

/** "Ask your Archive" overlay — RAG Q&A over your notes with citations.
 * Mounted once in the Shell. */
export function AskArchiveHost() {
  const open = useAskArchive((s) => s.open);
  const hide = useAskArchive((s) => s.hide);
  const question = useAskArchive((s) => s.question);
  const setQuestion = useAskArchive((s) => s.setQuestion);
  const run = useAskArchive((s) => s.run);
  const loading = useAskArchive((s) => s.loading);
  const result = useAskArchive((s) => s.result);
  const error = useAskArchive((s) => s.error);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => ref.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="ot-ask-overlay" onMouseDown={hide}>
      <div className="ot-ask" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ot-ask-bar">
          <Sparkles size={15} className="ot-ask-spark" />
          <input
            ref={ref}
            className="ot-ask-input"
            value={question}
            placeholder="Ask your archive… e.g. what did I decide about the trip?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                hide();
              } else if (e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
          />
          {loading && <Loader2 size={15} className="ot-ask-spin" />}
        </div>

        {error && <div className="ot-ask-error">{error}</div>}

        {result && (
          <div className="ot-ask-body">
            <AnswerWithCitations answer={result.answer} sources={result.sources} />
            {result.sources.length > 0 && (
              <div className="ot-ask-sources">
                <div className="ot-ask-sources-head">Sources</div>
                {result.sources.map((s) => {
                  const Icon = KIND_ICON[s.kind ?? "note"] ?? FileText;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="ot-ask-source"
                      onClick={() => openSource(s)}
                    >
                      <span className="ot-ask-source-n">{s.n}</span>
                      <Icon size={12} />
                      <span className="ot-ask-source-title">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="ot-ask-hint">
            Answers come only from your notes, with citations you can click.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
