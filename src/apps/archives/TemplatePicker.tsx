import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, NotebookPen, FolderKanban, BookOpen } from "lucide-react";
import {
  useTemplatePicker,
  applyTemplate,
  TEMPLATES,
  type Template,
} from "@/features/notes/templates";

const ICON: Record<string, typeof FileText> = {
  meeting: NotebookPen,
  "daily-log": FileText,
  "project-brief": FolderKanban,
  "reading-note": BookOpen,
};

/** Small picker for the built-in note templates. Mounted once in the Shell. */
export function TemplatePickerHost() {
  const open = useTemplatePicker((s) => s.open);
  const hide = useTemplatePicker((s) => s.hide);
  const [hi, setHi] = useState(0);

  useEffect(() => {
    if (open) setHi(0);
  }, [open]);

  if (!open) return null;

  const pick = (tpl: Template) => {
    hide();
    void applyTemplate(tpl);
  };

  return createPortal(
    <div className="ot-tpl-overlay" onMouseDown={hide}>
      <div
        className="ot-tpl"
        onMouseDown={(e) => e.stopPropagation()}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            hide();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const dir = e.key === "ArrowDown" ? 1 : -1;
            setHi((i) => (i + dir + TEMPLATES.length) % TEMPLATES.length);
          } else if (e.key === "Enter" && TEMPLATES[hi]) {
            e.preventDefault();
            pick(TEMPLATES[hi]!);
          }
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      >
        <div className="ot-tpl-head">New from template</div>
        {TEMPLATES.map((tpl, i) => {
          const Icon = ICON[tpl.id] ?? FileText;
          return (
            <button
              key={tpl.id}
              type="button"
              className={`ot-tpl-row${i === hi ? " hi" : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(tpl);
              }}
            >
              <Icon size={15} />
              <span className="ot-tpl-meta">
                <span className="ot-tpl-name">{tpl.label}</span>
                <span className="ot-tpl-blurb">{tpl.blurb}</span>
              </span>
              <span className="ot-tpl-kind">{tpl.kind}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
