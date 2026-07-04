/**
 * FX Assist panel — chat transcript + input over the stage. Tool calls
 * render as chips so you can watch the agent build the scene live.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Trash2, LoaderCircle, Check, TriangleAlert } from "lucide-react";
import { useFxAssist } from "./fxAssist";

const SUGGESTIONS = [
  "cursor-reactive liquid chrome hero",
  "neon terminal rain with glyphs",
  "dreamy aurora that follows my mouse",
  "glitchy VHS nightclub loop",
];

export function FxAssistPanel() {
  const open = useFxAssist((s) => s.open);
  const busy = useFxAssist((s) => s.busy);
  const items = useFxAssist((s) => s.items);
  const streaming = useFxAssist((s) => s.streaming);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, streaming]);

  if (!open) return null;

  const send = () => {
    const p = draft.trim();
    if (!p || busy) return;
    setDraft("");
    void useFxAssist.getState().send(p);
  };

  return (
    <div className="xd-fx-assist">
      <div className="xd-fx-assist-head">
        <span className="xd-fx-assist-title">
          <Sparkles size={13} /> FX Assist
        </span>
        <span className="xd-fx-assist-actions">
          <button
            type="button"
            onClick={() => useFxAssist.getState().clear()}
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            onClick={() => useFxAssist.getState().setOpen(false)}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </span>
      </div>
      <div className="xd-fx-assist-list" ref={listRef}>
        {items.length === 0 && !streaming && (
          <div className="xd-fx-assist-empty">
            <p>Describe an effect — I’ll build the layers, shaders, and mouse bindings for you.</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void useFxAssist.getState().send(s)}
                disabled={busy}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {items.map((it, i) =>
          it.kind === "tool" ? (
            <div key={i} className={`xd-fx-assist-chip${it.ok ? "" : " err"}`}>
              {it.ok ? <Check size={10} /> : <TriangleAlert size={10} />} {it.label}
            </div>
          ) : (
            <div key={i} className={`xd-fx-assist-msg ${it.kind}`}>
              {it.text}
            </div>
          ),
        )}
        {streaming && <div className="xd-fx-assist-msg assistant">{streaming}</div>}
        {busy && !streaming && (
          <div className="xd-fx-assist-busy">
            <LoaderCircle size={12} className="xd-fx-spin" /> building…
          </div>
        )}
      </div>
      <div className="xd-fx-assist-input">
        <input
          type="text"
          placeholder="e.g. make the text ripple when I move the mouse"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={send} aria-label="Send">
          {busy ? <LoaderCircle size={13} className="xd-fx-spin" /> : <Sparkles size={13} />}
        </button>
      </div>
    </div>
  );
}
