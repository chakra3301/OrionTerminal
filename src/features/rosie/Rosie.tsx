import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Send, StopCircle, X, RotateCw, Wrench, Check, AlertCircle, Brain, ChevronDown, ChevronRight, Volume2, VolumeX } from "lucide-react";
import {
  useRosie,
  currentActivity,
  type RosieMessage,
  type ToolCall,
} from "@/features/rosie/rosieStore";
import { useSettingsStore } from "@/store/settingsStore";
import { prettyToolName, formatToolResult } from "@/lib/toolFormat";
import { useFileDropZone } from "@/lib/fileDrop";

/** Extended-thinking block — claude emits these between/during turns when
 * reasoning. Collapsed by default so they don't dominate the surface.
 * The body comes verbatim from the model; we render as plain text (no
 * markdown) since these are stream-of-consciousness internal monologue. */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div className={`ot-rosie-thinking${open ? " open" : ""}`}>
      <button
        type="button"
        className="ot-rosie-thinking-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Brain size={10} />
        <span>thinking</span>
      </button>
      {open && <pre className="ot-rosie-thinking-body">{trimmed}</pre>}
    </div>
  );
}

function ToolChip({ call }: { call: ToolCall }) {
  // Auto-expand while running so the user sees what the agent's doing
  // without needing to click. Once finished, collapse to a tidy chip the
  // user can click to inspect.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const isRunning = call.state === "running";
  const open = manualOpen ?? isRunning;
  const Icon =
    call.state === "ok" ? Check : call.state === "error" ? AlertCircle : Wrench;
  const colorVar =
    call.state === "ok"
      ? "var(--neon-green)"
      : call.state === "error"
        ? "var(--neon-magenta)"
        : "var(--neon-cyan)";
  const inputPreview = JSON.stringify(call.input);
  const resultPreview = formatToolResult(call.result);
  const hasDetail = inputPreview !== "{}" || resultPreview !== "";
  return (
    <div className={`ot-rosie-tool-wrap ${call.state}${open ? " open" : ""}`}>
      <button
        type="button"
        className={`ot-rosie-tool ${call.state}`}
        onClick={() => hasDetail && setManualOpen(!open)}
        title={hasDetail ? (open ? "Hide details" : "Show details") : undefined}
      >
        <Icon size={10} color={colorVar} />
        <span className="name">{prettyToolName(call.name)}</span>
        {call.state === "running" && <span className="status">running…</span>}
      </button>
      {open && hasDetail && (
        <div className="ot-rosie-tool-detail">
          {inputPreview !== "{}" && (
            <>
              <div className="label">input</div>
              <pre>{inputPreview}</pre>
            </>
          )}
          {resultPreview !== "" && (
            <>
              <div className="label">result</div>
              <pre>{resultPreview}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}


function MessageBody({ msg }: { msg: RosieMessage }) {
  const toolCalls = useRosie((s) => s.toolCalls);
  if (typeof msg.content === "string") {
    if (!msg.content) return <span className="cursor" />;
    return (
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {msg.content}
        </ReactMarkdown>
      </div>
    );
  }
  // Render blocks in their original order so thinking → tool → text reads
  // naturally as it happened. Empty pending case shows a cursor.
  if (msg.content.length === 0) return <span className="cursor" />;
  return (
    <div className="ot-rosie-blocks">
      {msg.content.map((b, i) => {
        if (b.type === "thinking") {
          const text = (b as { thinking?: string; text?: string }).thinking
            ?? (b as { text?: string }).text
            ?? "";
          return <ThinkingBlock key={i} text={text} />;
        }
        if (b.type === "text") {
          return (
            <div className="md" key={i}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {(b as { text: string }).text}
              </ReactMarkdown>
            </div>
          );
        }
        if (b.type === "tool_use") {
          const tu = b as { id: string };
          const call = toolCalls[tu.id];
          if (!call) return null;
          return <ToolChip key={tu.id} call={call} />;
        }
        return null;
      })}
    </div>
  );
}

function TtsToggle() {
  const enabled = useRosie((s) => s.ttsEnabled);
  const setEnabled = useRosie((s) => s.setTtsEnabled);
  const Icon = enabled ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      className={`iconbtn${enabled ? " on" : ""}`}
      onClick={() => setEnabled(!enabled)}
      title={enabled ? "Voice replies: ON (click to mute)" : "Voice replies: OFF (click to speak)"}
    >
      <Icon size={12} />
    </button>
  );
}

function DiagnosticStrip() {
  const running = useRosie((s) => s.running);
  const stderrLines = useRosie((s) => s.stderrLines);
  const error = useRosie((s) => s.error);
  // Subscribe to the activity inputs so the label updates live.
  const toolCalls = useRosie((s) => s.toolCalls);
  const messages = useRosie((s) => s.messages);
  const [open, setOpen] = useState(false);

  // Show when there's something to show: running with stderr, or an error
  // exists. Otherwise stay invisible.
  if (!running && !error) return null;
  if (running && stderrLines.length === 0) {
    void toolCalls;
    void messages;
    return (
      <div className="ot-rosie-status">
        <span className="dot" />
        <span>{currentActivity(useRosie.getState())}</span>
      </div>
    );
  }
  if (stderrLines.length === 0) return null;

  return (
    <div className={`ot-rosie-diagnostic${open ? " open" : ""}`}>
      <button
        type="button"
        className="ot-rosie-diagnostic-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>
          {running ? "subprocess" : "subprocess output"} ({stderrLines.length})
        </span>
      </button>
      {open && (
        <pre className="ot-rosie-diagnostic-body">
          {stderrLines.slice(-30).join("\n")}
        </pre>
      )}
    </div>
  );
}

export function Rosie() {
  const open = useRosie((s) => s.open);
  const close = useRosie((s) => s.closePanel);
  const newConversation = useRosie((s) => s.newConversation);
  const messages = useRosie((s) => s.messages);
  const running = useRosie((s) => s.running);
  const error = useRosie((s) => s.error);
  const cost = useRosie((s) => s.totalCostUsd);
  const send = useRosie((s) => s.send);
  const cancel = useRosie((s) => s.cancel);

  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const pendingInput = useRosie((s) => s.pendingInput);
  const clearPendingInput = useRosie((s) => s.setPendingInput);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Finder drop → append `@<abspath>` for each file, same as the chat rails.
  // Lets you drag a screenshot or doc onto R.O.S.I.E to attach it.
  useFileDropZone(inputWrapRef, "rosie-input", (e) => {
    if (e.type === "enter") setDragOver(true);
    else if (e.type === "leave") setDragOver(false);
    else {
      setDragOver(false);
      for (const p of e.paths) {
        const ref = `@${p}`;
        setInput((cur) => (cur ? `${cur.trimEnd()} ${ref} ` : `${ref} `));
      }
    }
  });

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Adopt externally-injected text (e.g. voice transcript) into the input.
  // We append rather than replace so a user mid-typing doesn't lose work.
  useEffect(() => {
    if (pendingInput == null) return;
    setInput((cur) => {
      if (!cur.trim()) return pendingInput;
      return `${cur.trimEnd()} ${pendingInput}`;
    });
    clearPendingInput(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingInput, clearPendingInput]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, running, close]);

  const visibleMessages = useMemo(
    // Hide user messages that are pure tool_result echoes — they're
    // book-keeping for the API, not user-meaningful text.
    () =>
      messages.filter((m) => {
        if (m.role !== "user") return true;
        return typeof m.content === "string";
      }),
    [messages],
  );

  if (!open) return null;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    await send(text);
  };

  return (
    <div className="ot-rosie-overlay" onClick={(e) => {
      if (e.target === e.currentTarget && !running) close();
    }}>
      <div className="ot-rosie-panel">
        <div className="ot-rosie-head">
          <div className="ot-rosie-id">
            <div className="ot-claude-orb" style={{ width: 18, height: 18 }} />
            <div className="ot-rosie-title">
              <div className="primary">R.O.S.I.E</div>
              <div className="secondary">recursive oracle · sentient interface entity</div>
            </div>
          </div>
          <div className="ot-rosie-actions">
            <TtsToggle />
            <button
              type="button"
              className="iconbtn"
              onClick={newConversation}
              title="New conversation"
              disabled={running}
            >
              <RotateCw size={12} />
            </button>
            <button
              type="button"
              className="iconbtn"
              onClick={close}
              title="Close (esc)"
              disabled={running}
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div className="ot-rosie-body" ref={scrollRef}>
          {visibleMessages.length === 0 && (
            <div className="ot-rosie-empty">
              <div className="ot-claude-orb" style={{ width: 56, height: 56 }} />
              <div className="title">R.O.S.I.E is online.</div>
              <div className="subtitle">
                I have control over your workstation — apps, projects, notes,
                files, search. Ask me to do something, or say “Rosie…”.
              </div>
              <div className="examples">
                <span>“open archives”</span>
                <span>“find notes about onboarding”</span>
                <span>“switch to the Orion Terminal project”</span>
                <span>“make a journal entry for today”</span>
              </div>
            </div>
          )}
          {visibleMessages.map((m) => (
            <div key={m.id} className={`ot-rosie-msg ${m.role}`}>
              <div className="bubble">
                <MessageBody msg={m} />
              </div>
            </div>
          ))}
        </div>

        <DiagnosticStrip />

        {error && (
          <div className="ot-rosie-error">
            <span className="msg">{error}</span>
            {/Anthropic API key/i.test(error) && (
              <button
                type="button"
                className="action"
                onClick={() => {
                  useRosie.getState().closePanel();
                  useSettingsStore.getState().show();
                }}
              >
                Open Settings →
              </button>
            )}
          </div>
        )}

        <div
          ref={inputWrapRef}
          className={`ot-rosie-input${dragOver ? " drag-over" : ""}`}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={running ? "Working…" : "Tell R.O.S.I.E what to do…"}
            disabled={running}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          {running ? (
            <button
              type="button"
              className="send stop"
              onClick={cancel}
              title="Stop"
            >
              <StopCircle size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="send"
              onClick={() => void handleSend()}
              disabled={!input.trim()}
              title="Send (↵)"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        {cost > 0 && (
          <div className="ot-rosie-cost">${cost.toFixed(4)}</div>
        )}
      </div>
    </div>
  );
}
