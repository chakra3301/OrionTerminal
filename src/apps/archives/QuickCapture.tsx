import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Inbox } from "lucide-react";
import { useQuickCapture, captureNote } from "@/features/notes/quickCapture";

/** Frictionless capture overlay — appears instantly over anything, takes a
 * thought, files it to Inbox, and gets out of the way. Mounted once in the
 * Shell so it works regardless of which app is focused. */
export function QuickCaptureHost() {
  const open = useQuickCapture((s) => s.open);
  const hide = useQuickCapture((s) => s.hide);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      const t = setTimeout(() => ref.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  const submit = (openAfter: boolean) => {
    const value = text.trim();
    hide();
    if (value) void captureNote(value, { open: openAfter });
  };

  return createPortal(
    <div className="ot-capture-overlay" onMouseDown={hide}>
      <div className="ot-capture" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ot-capture-head">
          <Sparkles size={13} className="ot-capture-spark" />
          <span>Quick capture</span>
          <span className="ot-capture-dest">
            <Inbox size={11} /> Inbox
          </span>
        </div>
        <textarea
          ref={ref}
          className="ot-capture-input"
          value={text}
          rows={3}
          placeholder="What's on your mind? ↵ to capture · ⌘↵ to open · esc to cancel"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              hide();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit(true);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(false);
            }
          }}
        />
        <div className="ot-capture-foot">
          <span className="kbd">↵</span> capture
          <span className="kbd">⌘↵</span> capture & open
          <span className="kbd">⇧↵</span> newline
        </div>
      </div>
    </div>,
    document.body,
  );
}
