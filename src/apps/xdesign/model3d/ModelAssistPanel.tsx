/**
 * img2model chat panel — mirrors `fx/FxAssistPanel.tsx`'s shape (transcript
 * + tool chips + input), plus two things FX doesn't need: rendered
 * comparison-sheet thumbnails inline (so a human can eyeball each pass
 * review too, not just Claude), and a bounded-loop stop banner when the
 * correction loop force-stops a stuck pass.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Trash2, LoaderCircle, Check, TriangleAlert, OctagonAlert } from "lucide-react";
import { useModelAssist, passProgressLabel } from "./modelAssist";
import { useModelStore } from "./modelStore";
import { useModelFeed } from "./modelTranscriptFeed";
import { ModelSelect } from "@/components/ModelSelect";

export function ModelAssistPanel() {
  const open = useModelAssist((s) => s.open);
  const busy = useModelAssist((s) => s.busy);
  const items = useModelFeed((s) => s.items);
  const streaming = useModelAssist((s) => s.streaming);
  const reference = useModelStore((s) => s.reference);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, streaming]);

  // A real pass can legitimately run for minutes (many tool round-trips +
  // actual vision inspection of each render) — an elapsed-time readout is
  // the difference between "still working" and "looks frozen", especially
  // during a stretch with no visible tool chips yet (the model "thinking"
  // before its first tool call).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  if (!open) return null;

  const send = () => {
    const p = draft.trim();
    if (busy) return;
    if (!p && !reference) return;
    setDraft("");
    void useModelAssist.getState().send(p);
  };

  return (
    <div className="xd-model-assist">
      <div className="xd-model-assist-head">
        <span className="xd-model-assist-title">
          <Sparkles size={13} /> img2model
        </span>
        <span className="xd-model-assist-pass">{passProgressLabel()}</span>
        <span className="xd-model-assist-actions">
          {busy && (
            <button type="button" onClick={() => useModelAssist.getState().cancel()} title="Stop" aria-label="Stop">
              <OctagonAlert size={12} />
            </button>
          )}
          <button type="button" onClick={() => useModelAssist.getState().clear()} title="Clear conversation" aria-label="Clear conversation">
            <Trash2 size={12} />
          </button>
          <button type="button" onClick={() => useModelAssist.getState().setOpen(false)} aria-label="Close">
            <X size={13} />
          </button>
        </span>
      </div>
      <div style={{ padding: "8px 12px" }}>
        <ModelSelect surface="model3d" disabled={busy} />
        <div className="cp-card-sub">Vision + MCP reconstruction: Claude or Codex.</div>
      </div>
      <div className="xd-model-assist-list" ref={listRef}>
        {items.length === 0 && !streaming && (
          <div className="xd-model-assist-empty">
            {reference
              ? <p>Reference loaded. Say what to preserve or approximate, or just send to start the staged reconstruction.</p>
              : <p>Attach a reference image above first — img2model rebuilds it pass by pass: blockout → structure → form → material → surface → lighting → interaction → optimization.</p>}
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === "tool") {
            return (
              <div key={i} className={`xd-model-assist-chip${it.ok ? "" : " err"}`}>
                {it.ok ? <Check size={10} /> : <TriangleAlert size={10} />} {it.label}
              </div>
            );
          }
          if (it.kind === "render") {
            return (
              <div key={i} className="xd-model-assist-render">
                <img src={it.dataUrl} alt="reference vs render comparison sheet" />
              </div>
            );
          }
          if (it.kind === "loop-stop") {
            return (
              <div key={i} className="xd-model-assist-loopstop">
                <OctagonAlert size={12} /> {it.reason}
              </div>
            );
          }
          return (
            <div key={i} className={`xd-model-assist-msg ${it.kind}`}>
              {it.text}
            </div>
          );
        })}
        {streaming && <div className="xd-model-assist-msg assistant">{streaming}</div>}
        {busy && (
          <div className="xd-model-assist-busy">
            <LoaderCircle size={12} className="xd-model-spin" />
            {streaming ? "streaming" : "working"} · {elapsed}s {elapsed > 60 ? "— real passes can take a few minutes, this is normal" : ""}
          </div>
        )}
      </div>
      <div className="xd-model-assist-input">
        <input
          type="text"
          value={draft}
          placeholder={reference ? "e.g. keep the gold trim on the lid, stylize the wood grain" : "Attach a reference image first"}
          disabled={!reference && items.length === 0}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button type="button" onClick={send} disabled={busy || (!draft.trim() && !reference)}>
          {busy ? <LoaderCircle size={13} className="xd-model-spin" /> : "Send"}
        </button>
      </div>
    </div>
  );
}
