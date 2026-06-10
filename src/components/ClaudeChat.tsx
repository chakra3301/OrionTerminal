import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  Sparkles,
  Send,
  StopCircle,
  MoreHorizontal,
  Plus,
  FileText,
  Folder,
  AlertTriangle,
  SquareTerminal,
  GitBranch,
  StickyNote,
  Braces,
  X,
} from "lucide-react";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import { useFileDropZone } from "@/lib/fileDrop";
import { ModelSelect } from "@/components/ModelSelect";
// Type-only — keeps ClaudeChat decoupled from any provider implementation.
import type {
  ContextChip,
  ContextSuggestion,
} from "@/features/context/contextProviders";

/** Display twin of chatStore's MessagePill — structural, no store import. */
export type ClaudeChatPill = {
  kind: string;
  label: string;
  chars: number;
  truncated: boolean;
  preview: string;
};

export type ClaudeChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: ReactNode | string;
  pending?: boolean;
  pills?: ClaudeChatPill[];
};

export type ClaudeChatProps = {
  appId: "archives" | "orion" | "xdesign";
  name: string;
  subtitle: string;
  accentColor: string;
  systemPrompt: string;
  openingLine?: string;
  suggestionChips?: string[];
  placeholder?: string;
  disabledReason?: string | null;
  messages: ClaudeChatMessage[];
  running?: boolean;
  cost?: number;
  onSend: (text: string, chips?: ContextChip[]) => void | Promise<void>;
  onCancel?: () => void;
  onNewChat?: () => void;
  /** When provided, typing `@` in the input opens the context picker. */
  contextSearch?: (query: string) => Promise<ContextSuggestion[]>;
};

const KIND_ICON: Record<string, typeof FileText> = {
  file: FileText,
  folder: Folder,
  problems: AlertTriangle,
  terminal: SquareTerminal,
  "git-diff": GitBranch,
  note: StickyNote,
  code: Braces,
};

function PillIcon({ kind, size = 11 }: { kind: string; size?: number }) {
  const Icon = KIND_ICON[kind] ?? FileText;
  return <Icon size={size} />;
}

/** Receipts under a sent message — click to see exactly what was attached. */
function MessagePills({ pills }: { pills: ClaudeChatPill[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="ot-pills">
      <div className="ot-pills-row">
        {pills.map((p, i) => (
          <button
            key={`${p.kind}-${i}`}
            type="button"
            className={`ot-pill${expanded === i ? " open" : ""}`}
            title={`${p.chars.toLocaleString()} chars attached${p.truncated ? " (truncated)" : ""}`}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <PillIcon kind={p.kind} />
            <span className="ot-pill-label">{p.label}</span>
            <span className="ot-pill-chars">
              {p.chars >= 1000 ? `${Math.round(p.chars / 1000)}k` : p.chars}
            </span>
          </button>
        ))}
      </div>
      {expanded !== null && pills[expanded] && (
        <pre className="ot-pill-preview">
          {pills[expanded].preview}
          {pills[expanded].chars > pills[expanded].preview.length ? "\n…" : ""}
        </pre>
      )}
    </div>
  );
}

/** The `@token` under the caret, if any. Exported for tests. */
export function detectAtToken(value: string, caret: number): { at: number; query: string } | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/[\s([{'"`]/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { at, query };
}

function MessageBody({ content }: { content: ReactNode | string }) {
  if (typeof content !== "string") return <>{content}</>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
    >
      {content}
    </ReactMarkdown>
  );
}

export function ClaudeChat(props: ClaudeChatProps) {
  const {
    name,
    subtitle,
    accentColor,
    openingLine,
    suggestionChips,
    placeholder,
    disabledReason,
    messages,
    running,
    cost,
    onSend,
    onCancel,
    onNewChat,
  } = props;

  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [picker, setPicker] = useState<{
    query: string;
    results: ContextSuggestion[];
    hi: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const inputElRef = useRef<HTMLTextAreaElement>(null);
  const searchSeq = useRef(0);

  const closePicker = () => setPicker(null);

  const refreshPicker = (value: string, caret: number) => {
    if (!props.contextSearch) return;
    const tok = detectAtToken(value, caret);
    if (!tok) {
      closePicker();
      return;
    }
    const seq = ++searchSeq.current;
    setPicker((cur) => ({ query: tok.query, results: cur?.results ?? [], hi: 0 }));
    void props.contextSearch(tok.query).then((results) => {
      if (searchSeq.current !== seq) return;
      setPicker((cur) =>
        cur ? { query: tok.query, results, hi: Math.min(cur.hi, Math.max(0, results.length - 1)) } : cur,
      );
    });
  };

  const pickSuggestion = (s: ContextSuggestion) => {
    setChips((cur) =>
      cur.some((c) => c.kind === s.chip.kind && c.detail === s.chip.detail && c.label === s.chip.label)
        ? cur
        : [...cur, s.chip],
    );
    setInput((cur) => {
      const caret = inputElRef.current?.selectionStart ?? cur.length;
      const tok = detectAtToken(cur, caret);
      if (!tok) return cur;
      return cur.slice(0, tok.at) + cur.slice(caret);
    });
    closePicker();
    setTimeout(() => inputElRef.current?.focus(), 0);
  };

  // Append a `@<path>` reference to the input so the CLI streams the file
  // along with the next turn. Path-only — quoting handled by the user.
  const attachAssetPath = (path: string) => {
    const ref = `@${path}`;
    setInput((cur) => (cur ? `${cur.trimEnd()} ${ref} ` : `${ref} `));
  };

  // Finder/native drops are intercepted by Tauri before DOM `onDrop` fires —
  // they come through the orchestrator. Drop a file from Finder onto the
  // chat input and it gets attached as `@<abspath>` for the next turn, same
  // as the internal asset-drag-and-drop above.
  useFileDropZone(inputWrapRef, `claude-chat-input-${props.appId}`, (e) => {
    if (e.type === "enter") setDragOver(true);
    else if (e.type === "leave") setDragOver(false);
    else {
      setDragOver(false);
      for (const p of e.paths) attachAssetPath(p);
    }
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, running]);

  const send = async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || running || disabledReason) return;
    const attached = chips;
    setInput("");
    setChips([]);
    closePicker();
    await onSend(value, attached.length > 0 ? attached : undefined);
  };

  const orbStyle = {
    background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6), transparent 50%),
                 radial-gradient(circle at 70% 70%, ${accentColor}, transparent 60%),
                 radial-gradient(circle at 30% 70%, var(--neon-cyan), transparent 60%)`,
    boxShadow: `0 0 16px ${accentColor}66, inset 0 0 8px rgba(0,224,255,0.4)`,
  } as const;

  const showOpening = messages.length === 0 && openingLine;
  const showSuggest = !!suggestionChips?.length && messages.length < 2;

  return (
    <aside className="ot-claude-rail">
      <div className="ot-claude-header">
        <div className="ot-claude-orb" style={orbStyle} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ot-claude-name">{name}</div>
          <div className="ot-claude-sub">{subtitle}</div>
        </div>
        <ModelSelect surface={props.appId} />
        {onNewChat ? (
          <button
            type="button"
            onClick={onNewChat}
            title="New chat"
            style={{
              background: "none",
              border: 0,
              color: "var(--t-tertiary)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Plus size={14} />
          </button>
        ) : (
          <MoreHorizontal size={14} color="var(--t-tertiary)" />
        )}
      </div>

      <div ref={scrollRef} className="ot-claude-messages scroll">
        {messages.length === 0 && !openingLine && (
          <div className="ot-claude-empty">
            <div className="sparkle">
              <Sparkles size={20} color={accentColor} />
            </div>
            <div>Ready when you are.</div>
          </div>
        )}
        {showOpening && (
          <div className="ot-msg assistant">{openingLine}</div>
        )}
        {messages.map((m) => {
          const userStyle =
            m.role === "user"
              ? {
                  background: `${accentColor}1a`,
                  border: `1px solid ${accentColor}40`,
                }
              : undefined;
          return (
            <div
              key={m.id}
              className={`ot-msg ${m.role}${m.pending ? " thinking" : ""}`}
              style={userStyle}
            >
              <MessageBody content={m.content} />
              {m.pills && m.pills.length > 0 && <MessagePills pills={m.pills} />}
            </div>
          );
        })}
        {running && <div className="ot-msg assistant thinking">thinking</div>}
      </div>

      {showSuggest && (
        <div className="ot-claude-suggest">
          {suggestionChips!.map((s) => (
            <button
              type="button"
              key={s}
              className="chip"
              style={{
                background: `${accentColor}10`,
                borderColor: `${accentColor}40`,
                color: accentColor,
              }}
              onClick={() => send(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div
        ref={inputWrapRef}
        className={`ot-claude-input${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          // Ignore inner-element transitions (e.g. enter the textarea).
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
          e.preventDefault();
          const path = e.dataTransfer.getData(ASSET_DRAG_MIME);
          if (path) attachAssetPath(path);
          setDragOver(false);
        }}
      >
        {picker && (
          <div className="ot-ctxpick">
            {picker.results.length === 0 ? (
              <div className="ot-ctxpick-empty">
                {picker.query
                  ? "no matches"
                  : "type to search files, folders & notes"}
              </div>
            ) : (
              picker.results.map((s, i) => (
                <button
                  key={`${s.kind}-${s.label}-${i}`}
                  type="button"
                  className={`ot-ctxpick-row${i === picker.hi ? " hi" : ""}`}
                  onMouseEnter={() =>
                    setPicker((cur) => (cur ? { ...cur, hi: i } : cur))
                  }
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(s);
                  }}
                >
                  <PillIcon kind={s.kind} size={12} />
                  <span className="ot-ctxpick-label">{s.label}</span>
                  {s.detail && (
                    <span className="ot-ctxpick-detail">{s.detail}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
        {chips.length > 0 && (
          <div className="ot-ctxchips">
            {chips.map((c) => (
              <span key={c.id} className="ot-ctxchip">
                <PillIcon kind={c.kind} />
                <span className="ot-ctxchip-label">{c.label}</span>
                <button
                  type="button"
                  className="ot-ctxchip-x"
                  aria-label={`Remove ${c.label}`}
                  onClick={() =>
                    setChips((cur) => cur.filter((x) => x.id !== c.id))
                  }
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputElRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            refreshPicker(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          placeholder={
            disabledReason ??
            placeholder ??
            (props.contextSearch ? "Ask Claude… (@ to attach context)" : "Ask Claude…")
          }
          disabled={!!disabledReason || running}
          onKeyDown={(e) => {
            if (picker) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const dir = e.key === "ArrowDown" ? 1 : -1;
                setPicker((cur) => {
                  if (!cur || cur.results.length === 0) return cur;
                  const n = cur.results.length;
                  return { ...cur, hi: (cur.hi + dir + n) % n };
                });
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && picker.results[picker.hi]) {
                e.preventDefault();
                pickSuggestion(picker.results[picker.hi]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                closePicker();
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {running ? (
          <button
            type="button"
            className="send"
            style={{
              background: "rgba(255, 94, 94, 0.15)",
              color: "#ff8a8a",
            }}
            onClick={onCancel}
            title="Cancel (⌘.)"
          >
            <StopCircle size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="send"
            style={{
              background: `linear-gradient(135deg, ${accentColor}, var(--neon-cyan))`,
            }}
            onClick={() => void send()}
            disabled={!input.trim() || !!disabledReason}
            title="Send (↵)"
          >
            <Send size={14} />
          </button>
        )}
      </div>
      {typeof cost === "number" && cost > 0 ? (
        <div className="ot-claude-cost">${cost.toFixed(4)}</div>
      ) : null}
    </aside>
  );
}
