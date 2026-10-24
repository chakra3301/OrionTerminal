import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArchivesMediaPlayer } from "./MediaPlayer";
import {
  X,
  ExternalLink,
  Trash2,
  FileText,
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
  const modal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!asset) return;
    const previous = document.activeElement;
    const node = modal.current;
    node?.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab" && node) {
        const targets = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),video,audio,[href],input,select,[tabindex="0"]')];
        const first = targets[0], last = targets.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [asset?.id]);

  if (!asset) return null;

  const src = asset.filePath ? convertFileSrc(asset.filePath) : "";

  const handleOpenExternal = async () => {
    if (!asset.filePath) return;
    try {
      await openPath(asset.filePath);
    } catch (e) {
      log.warn("open external failed", e);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmDialog(
      `Delete "${asset.title}"? This removes the file from your Archives.`,
      { title: "Delete asset", kind: "warning" },
    );
    if (!ok || useArchives.getState().previewingAssetId !== asset.id) return;
    await removeAsset(asset.id);
    if (useArchives.getState().previewingAssetId === asset.id) close();
  };

  return (
    <div
      className="ar-asset-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={modal} className="ar-asset-preview-modal" role="dialog" aria-modal="true" aria-label={asset.title} onMouseDown={(e) => e.stopPropagation()}>
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
            aria-label="Open in default app"
          >
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            className="icon-btn ar-notes-danger"
            onClick={() => void handleDelete()}
            title="Delete"
            aria-label="Delete asset"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            title="Close (Esc)"
            aria-label="Close preview"
          >
            <X size={14} />
          </button>
        </header>

        <div className={`ar-asset-preview-body kind-${asset.kind}`}>
          <AssetPreviewSurface key={asset.id} asset={asset} src={src} onOpenExternal={() => void handleOpenExternal()} />
        </div>
      </div>
    </div>
  );
}

function AssetPreviewSurface({ asset, src, onOpenExternal }: { asset: Asset; src: string; onOpenExternal: () => void }) {
  if (!src) return <NoSourceState />;

  if (asset.kind === "image") {
    return <img src={src} alt={asset.title} className="ar-asset-preview-image" />;
  }

  if (asset.kind === "video" || asset.kind === "audio") {
    return <ArchivesMediaPlayer asset={asset} src={src} onOpenExternal={onOpenExternal} />;
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
