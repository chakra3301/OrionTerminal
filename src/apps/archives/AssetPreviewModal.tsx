import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  X,
  ExternalLink,
  Trash2,
  FileText,
  Music,
  Film as FilmIcon,
  FileQuestion,
} from "lucide-react";
import { useAssetsStore, type Asset } from "@/store/assetsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { log } from "@/lib/log";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function AssetPreviewModal() {
  const previewingId = useArchives((s) => s.previewingAssetId);
  const close = () => useArchives.getState().setPreviewingAssetId(null);
  const assets = useAssetsStore((s) => s.assets);
  const removeAsset = useAssetsStore((s) => s.remove);
  const asset = previewingId ? assets.get(previewingId) ?? null : null;

  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset]);

  if (!asset) return null;

  const src = asset.filePath ? convertFileSrc(asset.filePath) : "";

  const handleOpenExternal = async () => {
    if (!asset.filePath) return;
    try {
      // openUrl handles file:// paths on all platforms via the OS handler.
      await openUrl(`file://${asset.filePath}`);
    } catch (e) {
      log.warn("open external failed", e);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmDialog(
      `Delete "${asset.title}"? This removes the file from your Archives.`,
      { title: "Delete asset", kind: "warning" },
    );
    if (!ok) return;
    await removeAsset(asset.id);
    close();
  };

  return (
    <div
      className="ar-asset-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="ar-asset-preview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="ar-asset-preview-header">
          <div className="title">
            <span>{asset.title}</span>
            <span className="meta">
              · {asset.kind} · {formatBytes(asset.sizeBytes)}
            </span>
          </div>
          {asset.tags.length > 0 && (
            <div className="ar-asset-preview-tags">
              {asset.tags.map((t) => (
                <span key={t} className="ar-media-tag">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="icon-btn"
            onClick={() => void handleOpenExternal()}
            title="Open in default app"
          >
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            className="icon-btn ar-notes-danger"
            onClick={() => void handleDelete()}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </header>

        <div className={`ar-asset-preview-body kind-${asset.kind}`}>
          <AssetPreviewSurface asset={asset} src={src} />
        </div>
      </div>
    </div>
  );
}

function AssetPreviewSurface({ asset, src }: { asset: Asset; src: string }) {
  if (!src) return <NoSourceState />;

  if (asset.kind === "image") {
    return <img src={src} alt={asset.title} className="ar-asset-preview-image" />;
  }

  if (asset.kind === "video") {
    return (
      <video
        key={asset.id}
        src={src}
        controls
        autoPlay
        playsInline
        className="ar-asset-preview-video"
      />
    );
  }

  if (asset.kind === "audio") {
    return (
      <div className="ar-asset-preview-audio">
        <div className="ar-asset-preview-audio-icon">
          <Music size={36} color="var(--neon-green)" />
        </div>
        <div className="ar-asset-preview-audio-name">{asset.title}</div>
        <audio
          key={asset.id}
          src={src}
          controls
          autoPlay
          className="ar-asset-preview-audio-player"
        />
      </div>
    );
  }

  return <GenericFileState asset={asset} />;
}

function GenericFileState({ asset }: { asset: Asset }) {
  const Icon =
    asset.kind === "doc" ? FileText : asset.kind === "video" ? FilmIcon : FileQuestion;
  return (
    <div className="ar-asset-preview-generic">
      <Icon size={48} color="var(--t-secondary)" />
      <div className="ar-asset-preview-generic-name">{asset.title}</div>
      <div className="ar-asset-preview-generic-hint">
        No inline preview for this type. Use “Open in default app” above to
        view it.
      </div>
    </div>
  );
}

function NoSourceState() {
  return (
    <div className="ar-asset-preview-generic">
      <FileQuestion size={48} color="var(--t-tertiary)" />
      <div className="ar-asset-preview-generic-name">No file path</div>
      <div className="ar-asset-preview-generic-hint">
        This asset was created without an on-disk file.
      </div>
    </div>
  );
}
