import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { Sparkles, Send, StopCircle, MoreHorizontal, Plus } from "lucide-react";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import { useFileDropZone } from "@/lib/fileDrop";

export type ClaudeChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: ReactNode | string;
  pending?: boolean;
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
  onSend: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  onNewChat?: () => void;
};

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);

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
    setInput("");
    await onSend(value);
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
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            disabledReason ?? placeholder ?? "Ask Claude…"
          }
          disabled={!!disabledReason || running}
          onKeyDown={(e) => {
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
