import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  Plus,
  ArrowLeft,
  Trash2,
  Image as ImageIcon,
  Sparkles,
  X as XIcon,
  Music,
  FileText,
  Film as FilmIcon,
  FileQuestion,
  Check,
  Minus,
  Star,
} from "lucide-react";
import {
  useMoodBoardsStore,
  sortBoardsDesc,
  type MoodBoard,
} from "@/store/moodBoardsStore";
import { useAssetsStore, type Asset } from "@/store/assetsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { SelectionBar } from "@/apps/archives/SelectionBar";
import { useContextMenu } from "@/components/ContextMenu";
import { boardMenuItems } from "@/apps/archives/itemMenus";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import { log } from "@/lib/log";

export function ArchivesMood() {
  const openBoardId = useArchives((s) => s.openBoardId);
  const boards = useMoodBoardsStore((s) => s.boards);
  const board = openBoardId ? boards.get(openBoardId) ?? null : null;

  if (board) return <MoodBoardDetail board={board} />;
  return <MoodBoardList />;
}

// ─────────────────────────────────────────────────────────────────
// List view
// ─────────────────────────────────────────────────────────────────

function MoodBoardList() {
  const boardsMap = useMoodBoardsStore((s) => s.boards);
  const members = useMoodBoardsStore((s) => s.members);
  const create = useMoodBoardsStore((s) => s.create);
  const setOpenBoardId = useArchives((s) => s.setOpenBoardId);

  const boards = useMemo(() => sortBoardsDesc(boardsMap), [boardsMap]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ctx = useContextMenu();

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const commit = async () => {
    const title = draft.trim();
    setCreating(false);
    setDraft("");
    if (!title) return;
    try {
      const board = await create(title);
      setOpenBoardId(board.id);
    } catch (e) {
      log.error("mood board create failed", e);
    }
  };

  return (
    <div className="ar-mood-list scroll">
      {ctx.menu}
      <header className="ar-mood-header">
        <div>
          <h2>Mood Boards</h2>
          <div className="ar-mood-subtitle">
            <Sparkles size={11} color="var(--neon-magenta)" />
            visual scratchpad · one board per project, idea, or mood
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!creating && (
          <button
            type="button"
            className="ar-new-btn"
            onClick={() => setCreating(true)}
          >
            <Plus size={12} /> New board
          </button>
        )}
      </header>

      {creating && (
        <div className="ar-mood-new-row">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Name this board…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                setCreating(false);
                setDraft("");
              }
            }}
          />
          <button
            type="button"
            className="ar-new-btn"
            onClick={() => void commit()}
            disabled={!draft.trim()}
          >
            Create
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
            <XIcon size={13} />
          </button>
        </div>
      )}

      {boards.length === 0 && !creating ? (
        <div className="ar-empty-state ar-mood-empty">
          <ImageIcon size={20} color="var(--neon-magenta)" />
          <div className="title">No mood boards yet.</div>
          <div className="hint">
            Make one per project, dream, or vibe. Drop any kind of asset onto
            it.
          </div>
          <button
            type="button"
            className="ar-new-btn"
            onClick={() => setCreating(true)}
          >
            <Plus size={12} /> New board
          </button>
        </div>
      ) : (
        <div className="ar-mood-board-grid">
          {boards.map((b) => (
            <MoodBoardCard
              key={b.id}
              board={b}
              count={members.get(b.id)?.length ?? 0}
              onOpen={() => setOpenBoardId(b.id)}
              onContextMenu={(e) =>
                ctx.openAt(
                  e,
                  boardMenuItems(b, {
                    onOpen: () => setOpenBoardId(b.id),
                    onDeleted: () => setOpenBoardId(null),
                  }),
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MoodBoardCard({
  board,
  count,
  onOpen,
  onContextMenu,
}: {
  board: MoodBoard;
  count: number;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const cover = useAssetsStore((s) =>
    board.coverAssetId ? s.assets.get(board.coverAssetId) ?? null : null,
  );

  return (
    <button
      type="button"
      className="ar-mood-board-card"
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className="cover">
        {board.favorite && (
          <div className="ar-media-fav" aria-hidden title="Favorite">
            <Star size={11} fill="currentColor" />
          </div>
        )}
        {cover && cover.filePath && cover.kind === "image" ? (
          <img src={convertFileSrc(cover.filePath)} alt={board.title} />
        ) : cover && cover.filePath && cover.kind === "video" ? (
          <video
            src={convertFileSrc(cover.filePath)}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              try {
                v.currentTime = Math.min(0.1, (v.duration || 1) * 0.05);
              } catch {
                /* ignore */
              }
            }}
          />
        ) : (
          <div className="cover-empty">
            <ImageIcon size={22} color="var(--t-tertiary)" />
          </div>
        )}
      </div>
      <div className="meta">
        <div className="title">{board.title}</div>
        <div className="row">
          <span>{count} {count === 1 ? "item" : "items"}</span>
          <span className="dot">·</span>
          <span>{relativeTime(board.updatedAt, Date.now())}</span>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Detail view
// ─────────────────────────────────────────────────────────────────

const BOARD_TILE_DRAG_MIME = "application/x-orion-board-tile";

function MoodBoardDetail({ board }: { board: MoodBoard }) {
  const members = useMoodBoardsStore((s) => s.members.get(board.id) ?? []);
  const removeAssetFromBoard = useMoodBoardsStore((s) => s.removeAsset);
  const renameBoard = useMoodBoardsStore((s) => s.rename);
  const deleteBoard = useMoodBoardsStore((s) => s.remove);
  const addAsset = useMoodBoardsStore((s) => s.addAsset);
  const reorderAssets = useMoodBoardsStore((s) => s.reorderAssets);
  const assetsMap = useAssetsStore((s) => s.assets);
  const removeAsset = useAssetsStore((s) => s.remove);
  const setOpenBoardId = useArchives((s) => s.setOpenBoardId);
  const setPreviewing = useArchives((s) => s.setPreviewingAssetId);

  const [picker, setPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);
  const titleRef = useRef<HTMLInputElement>(null);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);

  const sel = useMultiSelect<string>();

  const handleTileDrop = (targetAssetId: string) => {
    const sourceId = draggingAssetId;
    setDraggingAssetId(null);
    setDragOverAssetId(null);
    if (!sourceId || sourceId === targetAssetId) return;
    const ordered = [...members];
    const fromIdx = ordered.indexOf(sourceId);
    const toIdx = ordered.indexOf(targetAssetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, sourceId);
    void reorderAssets(board.id, ordered);
  };

  useEffect(() => {
    setTitleDraft(board.title);
  }, [board.title]);

  useEffect(() => {
    if (renaming) titleRef.current?.focus();
  }, [renaming]);

  const items = useMemo(
    () =>
      members
        .map((id) => assetsMap.get(id))
        .filter((a): a is Asset => Boolean(a)),
    [members, assetsMap],
  );
  const itemIds = useMemo(() => items.map((a) => a.id), [items]);

  // Esc clears selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sel.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  const bulkRemoveFromBoard = async () => {
    const ids = Array.from(sel.selected);
    if (ids.length === 0) return;
    for (const id of ids) {
      try {
        await removeAssetFromBoard(board.id, id);
      } catch (e) {
        log.warn("bulk remove-from-board failed", e);
      }
    }
    sel.clear();
  };

  const bulkDeleteAsset = async () => {
    const ids = Array.from(sel.selected);
    if (ids.length === 0) return;
    const ok = await confirmDialog(
      `Delete ${ids.length} ${ids.length === 1 ? "asset" : "assets"} entirely? Removed from this board AND your library.`,
      { title: "Delete assets", kind: "warning" },
    );
    if (!ok) return;
    await Promise.all(
      ids.map((id) =>
        removeAsset(id).catch((e) => log.warn("bulk delete failed", e)),
      ),
    );
    sel.clear();
  };

  const commitRename = () => {
    setRenaming(false);
    if (titleDraft.trim() && titleDraft !== board.title) {
      void renameBoard(board.id, titleDraft);
    } else {
      setTitleDraft(board.title);
    }
  };

  const handleDeleteBoard = async () => {
    const ok = await confirmDialog(
      `Delete board "${board.title}"? The assets stay in your library.`,
      { title: "Delete mood board", kind: "warning" },
    );
    if (!ok) return;
    await deleteBoard(board.id);
    setOpenBoardId(null);
  };

  // Note: native Finder drops are intercepted by Tauri at the webview level
  // — they go through the Archives-level `onDragDropEvent` handler, which
  // already routes ingested assets onto the open board. DOM drag events
  // don't fire for those, so there's nothing to wire here. Browser-style
  // in-app drags (none today) could add a DOM `onDrop` later if needed.

  return (
    <div className="ar-mood-detail">
      <header className="ar-mood-detail-bar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setOpenBoardId(null)}
          title="Back to boards"
        >
          <ArrowLeft size={14} />
        </button>
        {renaming ? (
          <input
            ref={titleRef}
            className="ar-mood-detail-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                setRenaming(false);
                setTitleDraft(board.title);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ar-mood-detail-title"
            onClick={() => setRenaming(true)}
            title="Rename"
          >
            {board.title}
          </button>
        )}
        <span className="ar-mood-detail-meta">
          · {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="ar-new-btn"
          onClick={() => setPicker(true)}
        >
          <Plus size={12} /> Add asset
        </button>
        <button
          type="button"
          className="icon-btn ar-notes-danger"
          onClick={() => void handleDeleteBoard()}
          title="Delete board"
        >
          <Trash2 size={13} />
        </button>
      </header>

      <SelectionBar
        count={sel.selected.size}
        noun="tile"
        onClear={sel.clear}
        actions={[
          {
            key: "remove-from-board",
            label: "Remove from board",
            Icon: Minus,
            onClick: () => void bulkRemoveFromBoard(),
          },
          {
            key: "delete-asset",
            label: "Delete asset",
            Icon: Trash2,
            onClick: () => void bulkDeleteAsset(),
            tone: "danger",
          },
        ]}
      />

      <div className="ar-mood-detail-body scroll">
        {items.length === 0 ? (
          <div className="ar-empty-state ar-mood-empty">
            <ImageIcon size={20} color="var(--neon-magenta)" />
            <div className="title">Empty board.</div>
            <div className="hint">
              Drag assets in, paste, or click "Add asset" to pick from your
              library.
            </div>
          </div>
        ) : (
          <div className="ar-mood-masonry">
            {items.map((a) => (
              <BoardTile
                key={a.id}
                asset={a}
                selected={sel.isSelected(a.id)}
                onClick={(e) => {
                  if (sel.handleClick(a.id, itemIds, e)) return;
                  setPreviewing(a.id);
                }}
                onRemove={() => void removeAssetFromBoard(board.id, a.id)}
                dragging={draggingAssetId === a.id}
                dragOver={dragOverAssetId === a.id}
                onDragStart={() => setDraggingAssetId(a.id)}
                onDragEnd={() => {
                  setDraggingAssetId(null);
                  setDragOverAssetId(null);
                }}
                onDragOverTile={() => setDragOverAssetId(a.id)}
                onDropTile={() => handleTileDrop(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {picker && (
        <AddAssetPicker
          excludeIds={new Set(members)}
          onClose={() => setPicker(false)}
          onPick={async (asset) => {
            await addAsset(board.id, asset.id);
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}

function BoardTile({
  asset,
  selected,
  onClick,
  onRemove,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOverTile,
  onDropTile,
}: {
  asset: Asset;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: () => void;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverTile: () => void;
  onDropTile: () => void;
}) {
  const src = asset.filePath ? convertFileSrc(asset.filePath) : null;
  return (
    <div
      className={[
        "ar-mood-tile",
        dragging ? "dragging" : "",
        dragOver ? "drag-over" : "",
        selected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BOARD_TILE_DRAG_MIME, asset.id);
        // Also publish the cross-app asset MIME so drops outside the board
        // (e.g. into a ClaudeChat) can pick up the file path. Both MIMEs
        // coexist; the receiver picks whichever it understands.
        if (asset.filePath) {
          e.dataTransfer.setData(ASSET_DRAG_MIME, asset.filePath);
        }
        e.dataTransfer.effectAllowed = "copyMove";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        // Only handle reorders. Don't intercept external file drags (those
        // go through Tauri's onDragDropEvent at the Archives level).
        if (!e.dataTransfer.types.includes(BOARD_TILE_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverTile();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(BOARD_TILE_DRAG_MIME)) return;
        e.preventDefault();
        onDropTile();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      {selected && (
        <div className="ar-media-check" aria-hidden>
          <Check size={11} />
        </div>
      )}
      {asset.kind === "image" && src ? (
        <img src={src} alt={asset.title} loading="lazy" />
      ) : asset.kind === "video" && src ? (
        <video
          src={src}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            try {
              v.currentTime = Math.min(0.1, (v.duration || 1) * 0.05);
            } catch {
              /* ignore */
            }
          }}
          className="ar-media-video-thumb"
        />
      ) : (
        <div className={`ar-mood-tile-icon kind-${asset.kind}`}>
          <KindIconLarge kind={asset.kind} />
          <div className="ar-mood-tile-icon-name">{asset.title}</div>
        </div>
      )}
      <div className="ar-mood-tile-overlay">
        <div className="name">{asset.title}</div>
        {asset.tags.length > 0 && (
          <div className="tags">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="ar-mood-tile-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove from board"
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}

function KindIconLarge({ kind }: { kind: Asset["kind"] }) {
  switch (kind) {
    case "doc":
      return <FileText size={28} color="var(--neon-yellow)" />;
    case "audio":
      return <Music size={28} color="var(--neon-green)" />;
    case "video":
      return <FilmIcon size={28} color="var(--neon-magenta)" />;
    default:
      return <FileQuestion size={28} color="var(--t-tertiary)" />;
  }
}

// ─────────────────────────────────────────────────────────────────
// Asset picker modal
// ─────────────────────────────────────────────────────────────────

function AddAssetPicker({
  excludeIds,
  onClose,
  onPick,
}: {
  excludeIds: Set<string>;
  onClose: () => void;
  onPick: (asset: Asset) => void | Promise<void>;
}) {
  const assetsMap = useAssetsStore((s) => s.assets);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const all = Array.from(assetsMap.values())
      .filter((a) => !excludeIds.has(a.id))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (!query.trim()) return all;
    const needle = query.toLowerCase();
    return all.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [assetsMap, excludeIds, query]);

  return (
    <div
      className="ar-asset-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ar-mood-picker"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ar-mood-picker-header">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter assets… (title or tag)"
            autoFocus
          />
          <button type="button" className="icon-btn" onClick={onClose}>
            <XIcon size={13} />
          </button>
        </header>
        <div className="ar-mood-picker-body scroll">
          {candidates.length === 0 ? (
            <div className="ar-empty-state">
              <div className="title">No assets to add.</div>
              <div className="hint">
                Drop or paste files into Archives to capture them, then come
                back here.
              </div>
            </div>
          ) : (
            <div className="ar-mood-picker-grid">
              {candidates.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="ar-mood-picker-tile"
                  onClick={() => void onPick(a)}
                  title={a.title}
                >
                  {a.kind === "image" && a.filePath ? (
                    <img
                      src={convertFileSrc(a.filePath)}
                      alt={a.title}
                      loading="lazy"
                    />
                  ) : a.kind === "video" && a.filePath ? (
                    <video
                      src={convertFileSrc(a.filePath)}
                      preload="metadata"
                      muted
                      playsInline
                    />
                  ) : (
                    <div className={`ar-mood-tile-icon kind-${a.kind}`}>
                      <KindIconLarge kind={a.kind} />
                    </div>
                  )}
                  <div className="ar-mood-picker-tile-name">{a.title}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}
