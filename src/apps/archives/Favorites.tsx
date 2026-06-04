import { useMemo } from "react";
import {
  Star,
  StickyNote,
  BookOpen,
  FolderKanban,
  Image as ImageIcon,
  Film as FilmIcon,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useNotesStore } from "@/store/notesStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useContextMenu } from "@/components/ContextMenu";
import {
  noteMenuItems,
  assetMenuItems,
  boardMenuItems,
} from "@/apps/archives/itemMenus";

/**
 * One place to find everything you've starred — notes (incl. journal entries
 * + project pages), media assets, and mood boards. Click routes into the
 * native surface for that item; right-click opens the same menu as elsewhere.
 */
export function ArchivesFavorites() {
  const notes = useNotesStore((s) => s.notes);
  const assets = useAssetsStore((s) => s.assets);
  const boards = useMoodBoardsStore((s) => s.boards);
  const setView = useArchives((s) => s.setView);
  const ctx = useContextMenu();

  const favNotes = useMemo(
    () =>
      Array.from(notes.values())
        .filter((n) => n.favorite)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  );
  const favAssets = useMemo(
    () =>
      Array.from(assets.values())
        .filter((a) => a.favorite)
        .sort((a, b) => b.createdAt - a.createdAt),
    [assets],
  );
  const favBoards = useMemo(
    () =>
      Array.from(boards.values())
        .filter((b) => b.favorite)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [boards],
  );

  const total = favNotes.length + favAssets.length + favBoards.length;

  const openNote = (id: string, kind: string) => {
    if (kind === "journal") {
      setView("journal");
      useArchives.getState().setSelectedNoteId(id);
    } else if (kind === "project") {
      setView("projects");
      useArchives.getState().setOpenProjectId(id);
    } else {
      setView("notes");
      useArchives.getState().setOpenNoteId(id);
    }
  };

  const noteIcon = (kind: string) => {
    if (kind === "journal") return <BookOpen size={13} />;
    if (kind === "project") return <FolderKanban size={13} />;
    return <StickyNote size={13} />;
  };

  if (total === 0) {
    return (
      <div className="ar-empty-state" style={{ flex: 1 }}>
        <Star size={22} color="var(--neon-yellow)" />
        <div className="title">Nothing favorited yet.</div>
        <div className="hint">
          Right-click any note, entry, asset, or board → "Add to favorites", or
          hit the star in the toolbar while one's open.
        </div>
      </div>
    );
  }

  return (
    <div className="ar-fav-view scroll">
      {ctx.menu}

      {favNotes.length > 0 && (
        <div className="ar-fav-group">
          <div className="ar-fav-group-head">
            <Star size={11} fill="currentColor" color="var(--neon-yellow)" />
            Notes & pages <span className="count">· {favNotes.length}</span>
          </div>
          <div className="ar-notes-grid">
            {favNotes.map((n) => (
              <button
                type="button"
                key={n.id}
                className="ar-note-card"
                onClick={() => openNote(n.id, n.kind)}
                onContextMenu={(e) =>
                  ctx.openAt(
                    e,
                    noteMenuItems(n, { onOpen: () => openNote(n.id, n.kind) }),
                  )
                }
                title={n.title || "Untitled"}
              >
                <div className="row">
                  <span className="tag green">{noteIcon(n.kind)}</span>
                  <span className="ar-fav-badge">
                    <Star size={11} fill="currentColor" />
                  </span>
                </div>
                <div className="title">{n.title.trim() || "Untitled"}</div>
                <div className="preview">
                  {n.plaintext.slice(0, 200) || (
                    <span style={{ color: "var(--t-faint)", fontStyle: "italic" }}>
                      (empty)
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {favBoards.length > 0 && (
        <div className="ar-fav-group">
          <div className="ar-fav-group-head">
            <ImageIcon size={11} color="var(--neon-magenta)" />
            Mood boards <span className="count">· {favBoards.length}</span>
          </div>
          <div className="ar-mood-board-grid">
            {favBoards.map((b) => {
              const cover = b.coverAssetId
                ? assets.get(b.coverAssetId) ?? null
                : null;
              return (
                <button
                  type="button"
                  key={b.id}
                  className="ar-mood-board-card"
                  onClick={() => {
                    setView("mood");
                    useArchives.getState().setOpenBoardId(b.id);
                  }}
                  onContextMenu={(e) =>
                    ctx.openAt(
                      e,
                      boardMenuItems(b, {
                        onOpen: () => {
                          setView("mood");
                          useArchives.getState().setOpenBoardId(b.id);
                        },
                      }),
                    )
                  }
                >
                  <div className="cover">
                    {cover && cover.filePath && cover.kind === "image" ? (
                      <img src={convertFileSrc(cover.filePath)} alt={b.title} />
                    ) : (
                      <div className="cover-empty">
                        <ImageIcon size={22} color="var(--t-tertiary)" />
                      </div>
                    )}
                  </div>
                  <div className="meta">
                    <div className="title">{b.title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {favAssets.length > 0 && (
        <div className="ar-fav-group">
          <div className="ar-fav-group-head">
            <FilmIcon size={11} color="var(--neon-cyan)" />
            Media <span className="count">· {favAssets.length}</span>
          </div>
          <div className="ar-media-grid">
            {favAssets.map((a) => {
              const src = a.filePath ? convertFileSrc(a.filePath) : null;
              return (
                <div
                  key={a.id}
                  className="ar-media-tile"
                  title={a.title}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setView("media");
                    useArchives.getState().setPreviewingAssetId(a.id);
                  }}
                  onContextMenu={(e) =>
                    ctx.openAt(
                      e,
                      assetMenuItems(a, {
                        onOpen: () => {
                          setView("media");
                          useArchives.getState().setPreviewingAssetId(a.id);
                        },
                      }),
                    )
                  }
                >
                  <div className={`ar-media-preview kind-${a.kind}`}>
                    {a.kind === "image" && src ? (
                      <img src={src} alt={a.title} loading="lazy" />
                    ) : (
                      <FilmIcon size={22} color="var(--t-tertiary)" />
                    )}
                    <div className="ar-media-fav" aria-hidden>
                      <Star size={11} fill="currentColor" />
                    </div>
                  </div>
                  <div className="ar-media-meta">
                    <div className="name">{a.title}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
