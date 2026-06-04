import { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Image as ImageIcon } from "lucide-react";
import {
  useMoodBoardsStore,
  sortBoardsDesc,
  type MoodBoard,
} from "@/store/moodBoardsStore";
import { log } from "@/lib/log";

export function PickBoardModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (boardId: string) => void | Promise<void>;
}) {
  const boardsMap = useMoodBoardsStore((s) => s.boards);
  const members = useMoodBoardsStore((s) => s.members);
  const create = useMoodBoardsStore((s) => s.create);

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) draftRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const boards = useMemo(() => {
    const list = sortBoardsDesc(boardsMap);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((b) => b.title.toLowerCase().includes(q));
  }, [boardsMap, query]);

  const handleCreate = async () => {
    const title = draft.trim();
    setCreating(false);
    setDraft("");
    if (!title) return;
    try {
      const b = await create(title);
      await onPick(b.id);
    } catch (e) {
      log.error("create board failed", e);
    }
  };

  return (
    <div
      className="ar-asset-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ar-pick-board"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ar-pick-board-header">
          <div className="title">Add to mood board</div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={13} />
          </button>
        </header>
        <div className="ar-pick-board-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter boards…"
            autoFocus
          />
        </div>

        <div className="ar-pick-board-list scroll">
          {boards.length === 0 ? (
            <div className="ar-empty-state">
              <ImageIcon size={20} color="var(--neon-magenta)" />
              <div className="title">No boards yet.</div>
              <div className="hint">Create one below.</div>
            </div>
          ) : (
            boards.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                count={members.get(b.id)?.length ?? 0}
                onPick={() => void onPick(b.id)}
              />
            ))
          )}
        </div>

        <footer className="ar-pick-board-footer">
          {creating ? (
            <div className="ar-pick-board-new">
              <input
                ref={draftRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Name this board…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setDraft("");
                  }
                }}
              />
              <button
                type="button"
                className="ar-new-btn"
                onClick={() => void handleCreate()}
                disabled={!draft.trim()}
              >
                Create + Add
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setCreating(false);
                  setDraft("");
                }}
                title="Cancel"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="ar-new-btn"
              onClick={() => setCreating(true)}
            >
              <Plus size={12} /> New board
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function BoardRow({
  board,
  count,
  onPick,
}: {
  board: MoodBoard;
  count: number;
  onPick: () => void;
}) {
  return (
    <button type="button" className="ar-pick-board-row" onClick={onPick}>
      <div className="title">{board.title}</div>
      <div className="meta">
        {count} {count === 1 ? "item" : "items"}
      </div>
    </button>
  );
}
