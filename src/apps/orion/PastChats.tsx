import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { listChatsForProject, type ChatRow } from "@/lib/db";
import { useChatStore, type Chat } from "@/store/chatStore";
import { relativeTime } from "@/lib/time";
import { log } from "@/lib/log";

export function chatFromRow(row: ChatRow): Chat {
  let messages: unknown = [];
  try {
    messages = JSON.parse(row.messages_json);
  } catch {
    messages = [];
  }
  return {
    id: row.id,
    title: row.title,
    sessionId: row.session_id,
    projectId: row.project_id,
    messages: Array.isArray(messages) ? (messages as Chat["messages"]) : [],
    totalCostUsd: row.total_cost_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The project's saved chats, newest first. Reloads when `projectId` or `seq` changes. */
export function usePastChats(projectId: string | null, seq = 0): ChatRow[] {
  const [rows, setRows] = useState<ChatRow[]>([]);
  useEffect(() => {
    let live = true;
    listChatsForProject(projectId)
      .then((r) => { if (live) setRows(r.filter((c) => c.messages_json && c.messages_json !== "[]")); })
      .catch((e) => log.warn("past chats unavailable", e));
    return () => { live = false; };
  }, [projectId, seq]);
  return rows;
}

/** Cursor's "Past Chats" list under an empty agent composer. */
export function PastChats({ projectId, limit = 5 }: { projectId: string | null; limit?: number }) {
  const rows = usePastChats(projectId).slice(0, limit);
  const running = useChatStore((s) => s.running);
  if (rows.length === 0) return null;
  const now = Date.now();
  return (
    <div className="ot-agent-past">
      <div className="ot-agent-past-head">Past Chats</div>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="ot-agent-past-row"
          disabled={running}
          onClick={() => useChatStore.getState().setActive(chatFromRow(row))}
        >
          <MessageSquare size={13} />
          <span className="t">{row.title || "Untitled chat"}</span>
          <span className="d">{relativeTime(row.updated_at, now)}</span>
        </button>
      ))}
    </div>
  );
}
