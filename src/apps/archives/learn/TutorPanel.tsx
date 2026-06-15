// src/apps/archives/learn/TutorPanel.tsx
//
// Socratic streaming tutor panel — scoped to the open lesson node.
// Streams via the same ipc.claudeSend / claude:event mechanism the rails use,
// with its own per-node chatId so each node gets a fresh, independent thread.
// Does NOT touch the global appChatStore (which is keyed by AppId and has no
// "learn" slot); instead manages a lightweight local message list.

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { listen } from "@tauri-apps/api/event";
import { ulid } from "ulid";
import {
  Send,
  StopCircle,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageSquare,
  ZoomOut,
  ZoomIn,
} from "lucide-react";
import { ModelSelect } from "@/components/ModelSelect";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { useLearn } from "./useLearn";
import { tutorSystemPrompt } from "./pedagogy";
import { parseLesson } from "./learnTypes";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

// ── Types ─────────────────────────────────────────────────────────────────

type TutorMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

// ── Claude envelope shape (mirrors EventBridge) ───────────────────────────

type ContentBlock =
  | { type: "text"; text: string }
  | { type: string; [k: string]: unknown };

type ClaudeEnvelope = {
  chatId: string;
  event:
    | { type: "system"; subtype?: string; session_id?: string }
    | { type: "assistant"; message?: { content?: ContentBlock[] } }
    | { type: "result"; total_cost_usd?: number; is_error?: boolean }
    | { type: "stderr"; text?: string }
    | { type: string };
};

function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ── Markdown renderer — mirrors LessonView ────────────────────────────────

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {children}
    </ReactMarkdown>
  );
}

// ── Quick-action definitions ──────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Hint", icon: Lightbulb, prompt: "Give me a hint." },
  { label: "Explain back", icon: MessageSquare, prompt: "Let me explain it back to you: I think…" },
  { label: "Simpler", icon: ZoomOut, prompt: "Can you explain that more simply?" },
  { label: "Deeper", icon: ZoomIn, prompt: "Go deeper on that." },
] as const;

// ── Main component ────────────────────────────────────────────────────────

export function TutorPanel() {
  const openNodeId  = useLearn((s) => s.openNodeId);
  const openTopicId = useLearn((s) => s.openTopicId);
  const topics      = useLearn((s) => s.topics);
  const nodes       = useLearn((s) => s.nodes);
  const recentMisses = useLearn((s) => s.recentMisses);

  // Per-node chatId — fresh conversation when node changes.
  const [chatId, setChatId]       = useState<string>(() => ulid());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages]   = useState<TutorMsg[]>([]);
  const [running, setRunning]     = useState(false);
  const [input, setInput]         = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  // Pending assistant message id for streaming updates
  const pendingIdRef = useRef<string | null>(null);

  // Reset conversation when the node changes
  useEffect(() => {
    setChatId(ulid());
    setSessionId(null);
    setMessages([]);
    setRunning(false);
    setInput("");
    pendingIdRef.current = null;
  }, [openNodeId]);

  // Subscribe to claude:event and filter by our chatId
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<ClaudeEnvelope>("claude:event", (e) => {
        const env = e.payload;
        if (env.chatId !== chatId) return;

        const ev = env.event;

        if (ev.type === "system") {
          const sysEv = ev as { type: "system"; subtype?: string; session_id?: string };
          if (sysEv.subtype === "init" && sysEv.session_id) {
            setSessionId(sysEv.session_id);
          }
          return;
        }

        if (ev.type === "assistant") {
          const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
          if (msg && Array.isArray(msg.content)) {
            const text = extractText(msg.content);
            if (text) {
              setMessages((prev) => {
                const pid = pendingIdRef.current;
                if (!pid) return prev;
                return prev.map((m) =>
                  m.id === pid ? { ...m, content: text } : m,
                );
              });
            }
          }
          return;
        }

        if (ev.type === "result") {
          const pid = pendingIdRef.current;
          if (pid) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === pid ? { ...m, pending: false } : m,
              ),
            );
          }
          pendingIdRef.current = null;
          setRunning(false);
          return;
        }

        if (ev.type === "stderr") {
          log.warn("[tutor stderr]", (ev as { text?: string }).text);
        }
      });
    };

    setup().catch((err) => log.error("tutor listen setup failed", err));
    return () => {
      if (unlisten) unlisten();
    };
  }, [chatId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, running]);

  // Build system prompt from the open node
  const buildSystemPrompt = useCallback((): string => {
    if (!openNodeId) return "";
    const node  = nodes[openNodeId];
    const topic = openTopicId ? topics[openTopicId] : null;
    if (!node) return "";

    let lessonSummary = node.objective ?? "";
    if (node.lesson_json) {
      try {
        const lesson = parseLesson(node.lesson_json);
        const tags = lesson.concept_chunks.map((c) => c.tag).filter(Boolean).join(", ");
        lessonSummary = node.objective
          ? `${node.objective}. Concepts covered: ${tags || "(see lesson)"}.`
          : tags || "(see lesson)";
      } catch {
        // fall through to objective-only summary
      }
    }

    return tutorSystemPrompt({
      topic:         topic?.title ?? "",
      nodeTitle:     node.title,
      objective:     node.objective ?? "",
      lessonSummary,
      recentMisses,
    });
  }, [openNodeId, nodes, topics, openTopicId, recentMisses]);

  const send = useCallback(async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || running || !openNodeId) return;
    setInput("");

    // Append user message
    const userId = ulid();
    setMessages((prev) => [...prev, { id: userId, role: "user", content: value }]);

    // Append pending assistant placeholder
    const assistId = ulid();
    pendingIdRef.current = assistId;
    setMessages((prev) => [...prev, { id: assistId, role: "assistant", content: "", pending: true }]);
    setRunning(true);

    try {
      const model = useModelPrefs.getState().modelFor("learn");
      const isFirst = !sessionId;
      // On the first turn, prepend the system prompt as a leading context block
      // (same pattern as ArchivesApp.handleSend).
      const prompt = isFirst ? `${buildSystemPrompt()}\n\n---\n\n${value}` : value;
      await ipc.claudeSend(chatId, prompt, null, sessionId, null, model);
    } catch (err) {
      log.error("tutor send failed", err);
      // Remove the pending placeholder on error
      setMessages((prev) => prev.filter((m) => m.id !== pendingIdRef.current));
      pendingIdRef.current = null;
      setRunning(false);
    }
  }, [input, running, openNodeId, sessionId, chatId, buildSystemPrompt]);

  const cancel = useCallback(() => {
    void ipc.claudeCancel(chatId);
  }, [chatId]);

  if (!openNodeId) return null;

  const node  = nodes[openNodeId];
  const scope = node?.title ?? "";

  return (
    <aside className={`learn-tutor-panel${collapsed ? " learn-tutor-panel--collapsed" : ""}`}>
      {/* ── Collapsed strip ─────────────────────────────────────── */}
      <div className="learn-tutor-collapsed-strip">
        <button
          type="button"
          className="learn-tutor-expand-btn"
          aria-label="Expand tutor"
          onClick={() => setCollapsed(false)}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="learn-tutor-collapsed-label">Tutor</span>
      </div>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="learn-tutor-header">
        <div className="learn-tutor-orb" aria-hidden />
        <div className="learn-tutor-title-wrap">
          <span className="learn-tutor-name">Tutor</span>
          {scope && <span className="learn-tutor-scope">{scope}</span>}
        </div>
        <ModelSelect surface="learn" />
        <button
          type="button"
          className="learn-tutor-collapse-btn"
          aria-label="Collapse tutor"
          title="Collapse"
          onClick={() => setCollapsed(true)}
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* ── Messages ────────────────────────────────────────────── */}
      <div ref={scrollRef} className="learn-tutor-messages scroll">
        {messages.length === 0 && (
          <div className="learn-tutor-empty">
            <div className="learn-tutor-empty-orb" aria-hidden />
            <p className="learn-tutor-empty-text">
              Ask me anything about this lesson — I&apos;ll guide you Socratically.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`learn-tutor-msg ${m.role}${m.pending ? " thinking" : ""}`}
          >
            <div className="learn-tutor-msg-bubble">
              {m.role === "user" ? (
                m.content
              ) : m.pending && !m.content ? (
                <span>thinking</span>
              ) : (
                <Markdown>{m.content}</Markdown>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Divider ─────────────────────────────────────────────── */}
      <div className="learn-tutor-divider" aria-hidden />

      {/* ── Quick actions ───────────────────────────────────────── */}
      <div className="learn-tutor-quick-actions">
        {QUICK_ACTIONS.map(({ label, icon: Icon, prompt }) => (
          <button
            key={label}
            type="button"
            className="learn-tutor-qa-btn"
            disabled={running}
            onClick={() => void send(prompt)}
            title={prompt}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Input ───────────────────────────────────────────────── */}
      <div className="learn-tutor-input-wrap">
        <textarea
          ref={inputRef}
          className="learn-tutor-textarea"
          rows={1}
          value={input}
          placeholder="Ask the tutor…"
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
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
            className="learn-tutor-send-btn learn-tutor-send-btn--cancel"
            onClick={cancel}
            title="Cancel"
            aria-label="Cancel response"
          >
            <StopCircle size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="learn-tutor-send-btn"
            disabled={!input.trim()}
            onClick={() => void send()}
            title="Send (↵)"
            aria-label="Send message"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}
