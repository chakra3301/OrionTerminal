// src/apps/archives/learn/ScratchpadWidget.tsx
// Floating, draggable scratchpad for jotting notes while learning. Scoped per
// topic, auto-persists via scratchpadStore, and can promote its text into a real
// Archives note. Anchored top-right by default; remembers a dragged position.

import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { StickyNote, X, Minus, Save, GripVertical } from "lucide-react";
import { useDraggable } from "@/shell/useDraggable";
import { useNotesStore } from "@/store/notesStore";
import { toast } from "@/store/toastStore";
import { useScratchpad } from "./scratchpadStore";
import { scratchpadToNote, clampPos } from "./scratchpad";

const W = 320;
const H = 360;

export function ScratchpadWidget({ topicId, topicTitle }: { topicId: string; topicTitle: string }) {
  const open      = useScratchpad((s) => s.open);
  const collapsed = useScratchpad((s) => s.collapsed);
  const pos       = useScratchpad((s) => s.pos);
  const text      = useScratchpad((s) => s.notes[topicId] ?? "");
  const setNote      = useScratchpad((s) => s.setNote);
  const setOpen      = useScratchpad((s) => s.setOpen);
  const setCollapsed = useScratchpad((s) => s.setCollapsed);
  const setPos       = useScratchpad((s) => s.setPos);

  const rootRef = useRef<HTMLDivElement>(null);
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

  const { onMouseDown } = useDraggable({
    onStart: () => {
      const el = rootRef.current;
      // Resolve the default top-right anchor to absolute viewport coords on first drag.
      startPos.current = el
        ? { x: el.getBoundingClientRect().left, y: el.getBoundingClientRect().top }
        : (pos ?? { x: 0, y: 0 });
    },
    onDrag: (dx, dy) => {
      setPos(clampPos({ x: startPos.current.x + dx, y: startPos.current.y + dy }, { w: W, h: H }, viewport()));
    },
  });

  // Keep the widget on-screen when the window resizes (only when a custom pos is set).
  useEffect(() => {
    if (!pos) return;
    const reclamp = () => {
      const clamped = clampPos(pos, { w: W, h: H }, viewport());
      if (clamped.x !== pos.x || clamped.y !== pos.y) setPos(clamped);
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [pos]);

  const handleSave = useCallback(async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const { title, blocks } = scratchpadToNote(topicTitle, text);
      const note = await useNotesStore.getState().create(null, "note");
      await useNotesStore.getState().saveTitle(note.id, title);
      await useNotesStore.getState().saveBlocks(note.id, blocks);
      toast.success("Saved to Archives", { body: title });
    } catch {
      toast.error("Couldn't save note");
    } finally {
      setSaving(false);
    }
  }, [text, topicTitle, saving]);

  // Launcher when closed
  if (!open) {
    return createPortal(
      <button
        type="button"
        className="sp-launcher"
        title="Notepad"
        aria-label="Open notepad"
        onClick={() => setOpen(true)}
      >
        <StickyNote size={16} />
      </button>,
      document.body,
    );
  }

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: "auto" }
    : { right: 18, top: 64 };

  return createPortal(
    <div
      ref={rootRef}
      className={`sp-widget${collapsed ? " sp-collapsed" : ""}`}
      style={{ ...style, width: W, height: collapsed ? undefined : H }}
    >
      <div className="sp-header" onMouseDown={onMouseDown}>
        <GripVertical size={13} className="sp-grip" aria-hidden />
        <StickyNote size={13} className="sp-header-icon" />
        <span className="sp-title">Notes</span>
        <div className="sp-header-actions" data-no-drag>
          <button type="button" className="sp-icon-btn" title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed(!collapsed)}>
            <Minus size={13} />
          </button>
          <button type="button" className="sp-icon-btn" title="Close" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={13} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <textarea
            className="sp-textarea scroll"
            value={text}
            placeholder={`Jot notes on ${topicTitle || "this topic"}…`}
            onChange={(e) => setNote(topicId, e.target.value)}
            data-no-drag
          />
          <div className="sp-footer" data-no-drag>
            <span className="sp-count">{text.trim() ? `${text.trim().length} chars` : "Empty"}</span>
            <button type="button" className="sp-save-btn" disabled={!text.trim() || saving} onClick={() => void handleSave()}>
              <Save size={12} /> {saving ? "Saving…" : "Save to Archives"}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
