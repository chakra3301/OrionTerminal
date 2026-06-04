import { useEffect, useMemo, useState } from "react";
import {
  Filter,
  Trash2,
  FileText,
  Music,
  Film as FilmIcon,
  FileQuestion,
  Plus,
  Check,
  Star,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  useAssetsStore,
  sortAssetsDesc,
  type Asset,
} from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { SelectionBar } from "@/apps/archives/SelectionBar";
import { PickBoardModal } from "@/apps/archives/PickBoardModal";
import { useContextMenu } from "@/components/ContextMenu";
import { assetMenuItems } from "@/apps/archives/itemMenus";
import type { AssetKind } from "@/lib/db";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import { log } from "@/lib/log";

const KIND_TABS: Array<{ key: AssetKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "doc", label: "Docs" },
  { key: "other", label: "Other" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function KindIcon({ kind }: { kind: AssetKind }) {
  const size = 22;
  switch (kind) {
    case "doc":
      return <FileText size={size} color="var(--neon-yellow)" />;
    case "audio":
      return <Music size={size} color="var(--neon-green)" />;
    case "video":
      return <FilmIcon size={size} color="var(--neon-magenta)" />;
    default:
      return <FileQuestion size={size} color="var(--t-tertiary)" />;
  }
}

export function ArchivesMedia() {
  const assetsMap = useAssetsStore((s) => s.assets);
  const removeAsset = useAssetsStore((s) => s.remove);
  const addAssetToBoard = useMoodBoardsStore((s) => s.addAsset);
  const selectedTag = useArchives((s) => s.selectedTag);
  const setSelectedTag = useArchives((s) => s.setSelectedTag);
  const [filter, setFilter] = useState<AssetKind | "all">("all");
  const [pickingBoard, setPickingBoard] = useState(false);
  const ctx = useContextMenu();

  const all = useMemo(() => sortAssetsDesc(assetsMap), [assetsMap]);
  const filtered = useMemo(() => {
    let out = filter === "all" ? all : all.filter((a) => a.kind === filter);
    if (selectedTag) {
      out = out.filter((a) => a.tags.includes(selectedTag));
    }
    return out;
  }, [all, filter, selectedTag]);

  const filteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);

  const sel = useMultiSelect<string>();

  // Esc clears selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sel.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  // If the underlying filtered list shrinks (e.g., the user changes the filter
  // or an asset is deleted), drop any orphan ids from the selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const valid = new Set(filteredIds);
    for (const id of sel.selected) {
      if (!valid.has(id)) sel.toggle(id);
    }
    // sel intentionally omitted — toggle is stable enough; we only react to filteredIds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIds]);

  const now = Date.now();

  const counts = useMemo(() => {
    const c: Record<AssetKind | "all", number> = {
      all: all.length,
      image: 0,
      video: 0,
      audio: 0,
      doc: 0,
      other: 0,
    };
    for (const a of all) c[a.kind]++;
    return c;
  }, [all]);

  const handleDelete = async (a: Asset) => {
    const ok = await confirmDialog(
      `Delete "${a.title}"? This removes the file from your Archives.`,
      { title: "Delete asset", kind: "warning" },
    );
    if (!ok) return;
    await removeAsset(a.id);
  };

  const bulkDelete = async () => {
    const ids = Array.from(sel.selected);
    if (ids.length === 0) return;
    const ok = await confirmDialog(
      `Delete ${ids.length} ${ids.length === 1 ? "asset" : "assets"}? This removes the files from your Archives.`,
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

  const bulkAddToBoard = async (boardId: string) => {
    const ids = Array.from(sel.selected);
    if (ids.length === 0) return;
    for (const id of ids) {
      try {
        await addAssetToBoard(boardId, id);
      } catch (e) {
        log.warn("bulk add-to-board failed", e);
      }
    }
    setPickingBoard(false);
    sel.clear();
  };

  // Right-click on a single tile: select just that asset for board ops, then
  // open the board picker (reuses the bulk add-to-board path).
  const addSingleToBoard = (id: string) => {
    sel.clear();
    sel.toggle(id);
    setPickingBoard(true);
  };

  return (
    <div className="ar-media scroll">
      {ctx.menu}
      {selectedTag && (
        <div className="ar-filter-banner">
          <span>
            Filtered by <span className="tag-name">#{selectedTag}</span>
          </span>
          <button
            type="button"
            className="ar-filter-clear"
            onClick={() => setSelectedTag(null)}
          >
            clear
          </button>
        </div>
      )}
      <div className="ar-media-toolbar">
        <div className="ar-media-tabs">
          {KIND_TABS.map((t) => {
            const n = counts[t.key];
            return (
              <button
                type="button"
                key={t.key}
                className={`ar-media-tab${filter === t.key ? " active" : ""}`}
                onClick={() => setFilter(t.key)}
              >
                <span>{t.label}</span>
                <span className="count">· {n}</span>
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <span className="ar-media-hint">
          <Filter size={11} />
          ⌘/⇧ click to multi-select · drag files in to capture
        </span>
      </div>

      <SelectionBar
        count={sel.selected.size}
        noun="asset"
        onClear={sel.clear}
        actions={[
          {
            key: "add-to-board",
            label: "Add to board…",
            Icon: Plus,
            onClick: () => setPickingBoard(true),
          },
          {
            key: "delete",
            label: "Delete",
            Icon: Trash2,
            onClick: () => void bulkDelete(),
            tone: "danger",
          },
        ]}
      />

      {filtered.length === 0 ? (
        <div className="ar-empty-state ar-media-empty">
          <div className="title">
            {all.length === 0 ? "Nothing captured yet." : "No matches."}
          </div>
          <div className="hint">
            {all.length === 0
              ? "Drop a file anywhere in this window — image, video, audio, or doc."
              : "Switch the filter or drop a file."}
          </div>
        </div>
      ) : (
        <div className="ar-media-grid">
          {filtered.map((a) => (
            <AssetTile
              key={a.id}
              asset={a}
              now={now}
              selected={sel.isSelected(a.id)}
              onClick={(e) => {
                if (sel.handleClick(a.id, filteredIds, e)) return;
                useArchives.getState().setPreviewingAssetId(a.id);
              }}
              onContextMenu={(e) =>
                ctx.openAt(
                  e,
                  assetMenuItems(a, {
                    onOpen: () =>
                      useArchives.getState().setPreviewingAssetId(a.id),
                    onAddToBoard: () => addSingleToBoard(a.id),
                  }),
                )
              }
              onDelete={() => void handleDelete(a)}
            />
          ))}
        </div>
      )}

      {pickingBoard && (
        <PickBoardModal
          onClose={() => setPickingBoard(false)}
          onPick={(boardId) => void bulkAddToBoard(boardId)}
        />
      )}
    </div>
  );
}

function AssetTile({
  asset,
  now,
  selected,
  onClick,
  onContextMenu,
  onDelete,
}: {
  asset: Asset;
  now: number;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  const src = asset.filePath ? convertFileSrc(asset.filePath) : null;

  return (
    <div
      className={`ar-media-tile${selected ? " selected" : ""}`}
      title={asset.title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        if (!asset.filePath) return;
        // Cross-app payload: any drop target (e.g. ClaudeChat) can read the
        // absolute file path and attach via the CLI's `@<path>` syntax.
        e.dataTransfer.setData(ASSET_DRAG_MIME, asset.filePath);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      <div className={`ar-media-preview kind-${asset.kind}`}>
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
                /* some codecs ignore seek before play — fine */
              }
            }}
            className="ar-media-video-thumb"
          />
        ) : (
          <KindIcon kind={asset.kind} />
        )}
        {selected && (
          <div className="ar-media-check" aria-hidden>
            <Check size={11} />
          </div>
        )}
        {asset.favorite && (
          <div className="ar-media-fav" aria-hidden title="Favorite">
            <Star size={11} fill="currentColor" />
          </div>
        )}
        <button
          type="button"
          className="ar-media-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="ar-media-meta">
        <div className="name">{asset.title}</div>
        <div className="row">
          <span className={`tag ${kindAccent(asset.kind)}`}>
            #{asset.kind}
          </span>
          <span className="size">{formatBytes(asset.sizeBytes)}</span>
          <span className="when">{formatRelative(asset.createdAt, now)}</span>
        </div>
        <AssetTagsRow assetId={asset.id} tags={asset.tags} />
      </div>
    </div>
  );
}

function AssetTagsRow({
  assetId,
  tags,
}: {
  assetId: string;
  tags: string[];
}) {
  const tagging = useAssetsStore((s) => s.taggingIds.has(assetId));
  if (tagging) {
    return (
      <div className="ar-media-tags pending">
        <span className="ar-media-tag-skel" />
        <span className="ar-media-tag-skel" />
      </div>
    );
  }
  if (tags.length === 0) return null;
  return (
    <div className="ar-media-tags">
      {tags.map((t) => (
        <span key={t} className="ar-media-tag">
          #{t}
        </span>
      ))}
    </div>
  );
}

function kindAccent(kind: AssetKind): string {
  switch (kind) {
    case "image":
      return "cyan";
    case "video":
      return "magenta";
    case "audio":
      return "green";
    case "doc":
      return "yellow";
    default:
      return "violet";
  }
}
