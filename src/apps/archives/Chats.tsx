import { useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  Search,
  Sparkles,
  X,
  SquareArrowOutUpRight,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  listAllChats,
  listProjects,
  renameChat,
  deleteChat,
  type ChatRow,
  type ProjectRow,
} from "@/lib/db";
import { openChatById } from "@/apps/archives/searchNav";
import { useContextMenu } from "@/components/ContextMenu";
import { promptText } from "@/components/PromptModal";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { log } from "@/lib/log";

type ChatPreview = {
  row: ChatRow;
  preview: string;
};

function parseFirstUserMessage(messagesJson: string): string {
  try {
    const arr = JSON.parse(messagesJson);
    if (!Array.isArray(arr)) return "";
    for (const m of arr) {
      if (m && typeof m === "object" && m.role === "user") {
        const c = typeof m.content === "string" ? m.content : "";
        return c.trim();
      }
    }
    return "";
  } catch {
    return "";
  }
}

function relativeTime(when: number, now: number): string {
  const delta = Math.max(0, now - when);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return new Date(when).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ArchivesChats() {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [projects, setProjects] = useState<Map<string, ProjectRow>>(new Map());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const ctx = useContextMenu();

  const handleRename = (row: ChatRow) => {
    void (async () => {
      const title = await promptText({
        title: "Rename conversation",
        initialValue: row.title,
        placeholder: "Title",
        confirmLabel: "Rename",
      });
      if (title == null) return;
      await renameChat(row.id, title);
      setChats((prev) =>
        prev.map((c) => (c.id === row.id ? { ...c, title } : c)),
      );
    })();
  };

  const handleDelete = (row: ChatRow) => {
    void (async () => {
      const ok = await confirmDialog(
        `Delete "${row.title || "this conversation"}"? This cannot be undone.`,
        { title: "Delete conversation", kind: "warning" },
      );
      if (!ok) return;
      await deleteChat(row.id);
      setChats((prev) => prev.filter((c) => c.id !== row.id));
    })();
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAllChats(500), listProjects()])
      .then(([rows, projs]) => {
        if (cancelled) return;
        setChats(rows);
        setProjects(new Map(projs.map((p) => [p.id, p])));
      })
      .catch((e) => log.error("ArchivesChats load failed", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const previews = useMemo<ChatPreview[]>(
    () =>
      chats.map((row) => ({
        row,
        preview: parseFirstUserMessage(row.messages_json),
      })),
    [chats],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return previews;
    return previews.filter(({ row, preview }) => {
      if (row.title.toLowerCase().includes(q)) return true;
      if (preview.toLowerCase().includes(q)) return true;
      if (row.searchable_text?.toLowerCase().includes(q)) return true;
      if (row.project_id) {
        const projName = projects.get(row.project_id)?.name?.toLowerCase() ?? "";
        if (projName.includes(q)) return true;
      }
      return false;
    });
  }, [previews, query, projects]);

  const now = Date.now();
  const total = chats.length;

  return (
    <div className="ar-chats">
      {ctx.menu}
      <header className="ar-chats-header">
        <div className="ar-chats-title">Past chats</div>
        <div className="ar-chats-subtitle">
          {total} {total === 1 ? "conversation" : "conversations"} · click to
          resume
        </div>
        <div className="ar-chats-search">
          <Search size={12} />
          <input
            type="text"
            placeholder="Search threads…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="ar-chats-clear"
              onClick={() => setQuery("")}
              title="Clear"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </header>

      <div className="ar-chats-list">
        {loading ? (
          <div className="ar-chats-empty">Loading…</div>
        ) : total === 0 ? (
          <div className="ar-chats-empty">
            <MessageSquare size={20} />
            <div className="title">No conversations yet</div>
            <div className="hint">
              Start a thread in Orion's Code Companion or the Archive
              Assistant. Replies land here.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ar-chats-empty">
            <div className="title">No matches</div>
            <div className="hint">Nothing matches "{query}".</div>
          </div>
        ) : (
          filtered.map(({ row, preview }) => {
            const origin: "orion" | "archives" = row.project_id
              ? "orion"
              : "archives";
            const project = row.project_id ? projects.get(row.project_id) : null;
            return (
              <button
                type="button"
                key={row.id}
                className="ar-chat-row"
                onClick={() =>
                  openChatById(row.id).catch((e) =>
                    log.warn("openChatById failed", e),
                  )
                }
                onContextMenu={(e) =>
                  ctx.openAt(e, [
                    {
                      label: "Open",
                      icon: <SquareArrowOutUpRight size={13} />,
                      onClick: () =>
                        void openChatById(row.id).catch((err) =>
                          log.warn("openChatById failed", err),
                        ),
                    },
                    {
                      label: "Rename",
                      icon: <Pencil size={13} />,
                      onClick: () => handleRename(row),
                    },
                    { type: "separator" },
                    {
                      label: "Delete",
                      icon: <Trash2 size={13} />,
                      danger: true,
                      onClick: () => handleDelete(row),
                    },
                  ])
                }
              >
                <div className={`ar-chat-icon ${origin}`} aria-hidden>
                  {origin === "orion" ? (
                    <Sparkles size={13} />
                  ) : (
                    <MessageSquare size={13} />
                  )}
                </div>
                <div className="ar-chat-body">
                  <div className="ar-chat-top">
                    <span className="ar-chat-title">
                      {row.title || "Untitled thread"}
                    </span>
                    <span className="ar-chat-when">
                      {relativeTime(row.updated_at, now)}
                    </span>
                  </div>
                  <div className="ar-chat-preview">
                    {preview || "(no messages)"}
                  </div>
                  <div className="ar-chat-meta">
                    <span className={`ar-chat-origin ${origin}`}>
                      {origin === "orion"
                        ? `#${project?.name ?? "orion"}`
                        : "#archives"}
                    </span>
                    {row.total_cost_usd > 0 && (
                      <span className="ar-chat-cost">
                        ${row.total_cost_usd.toFixed(3)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
