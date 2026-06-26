import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { X, LifeBuoy } from "lucide-react";
import { useHelp } from "./helpStore";
import { HELP_SECTIONS } from "./helpContent";
import "./help.css";

// Mirrors the ClaudeChat / LessonView markdown config.
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {children}
    </ReactMarkdown>
  );
}

/** Always-available in-app docs. Opened from Spotlight ("Help") or the app
 * menu. Plain overlay (same family as Settings / Keyboard Shortcuts). */
export function HelpWindow() {
  const open = useHelp((s) => s.open);
  const requested = useHelp((s) => s.sectionId);
  const hide = useHelp((s) => s.hide);
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0]!.id);

  useEffect(() => {
    if (open && requested) setActiveId(requested);
  }, [open, requested]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  const active = useMemo(
    () => HELP_SECTIONS.find((s) => s.id === activeId) ?? HELP_SECTIONS[0]!,
    [activeId],
  );

  if (!open) return null;

  return (
    <div
      className="ot-help-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div className="ot-help-modal" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="ot-help-nav">
          <div className="ot-help-nav-title">
            <LifeBuoy size={14} />
            <span>Help</span>
          </div>
          {HELP_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`ot-help-nav-item${s.id === activeId ? " active" : ""}`}
              onClick={() => setActiveId(s.id)}
            >
              {s.title}
            </button>
          ))}
        </aside>
        <main className="ot-help-main">
          <header className="ot-help-head">
            <span>{active.title}</span>
            <button
              type="button"
              className="ot-help-close"
              onClick={hide}
              aria-label="Close help"
            >
              <X size={14} />
            </button>
          </header>
          <div className="ot-help-body scroll">
            <div className="ot-help-md">
              <Markdown>{active.body}</Markdown>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
