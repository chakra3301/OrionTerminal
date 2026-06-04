import { useEffect, useState } from "react";
import { Image as ImageIcon, Film, Music, FileText, AlertTriangle } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { ipc } from "@/lib/ipc";
import { mediaTypeForPath, type MediaKind } from "@/lib/mediaTypes";
import { log } from "@/lib/log";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// base64 → byte count (each 4 chars = 3 bytes, minus '=' padding).
function bytesOfBase64(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, (b64.length / 4) * 3 - padding);
}

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
};

/**
 * Renders an image / video / audio / pdf clicked from the file tree, instead of
 * shoving its bytes through Monaco (which fails with "stream did not contain
 * valid UTF-8"). The file is read as base64 over IPC and shown via a `data:`
 * URL — works for any project path without widening the asset-protocol scope.
 */
export function OrionMediaViewer({ path }: { path: string }) {
  const media = mediaTypeForPath(path);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setBytes(null);
    setDims(null);
    setError(null);
    if (!media) {
      setError("Unsupported media type.");
      return;
    }
    // PDFs render as an "open externally" card (macOS WKWebView blanks data:
    // PDFs in an iframe), so there's no need to read the bytes at all.
    if (media.kind === "pdf") return;
    ipc
      .readFileBase64(path)
      .then((b64) => {
        if (cancelled) return;
        setBytes(bytesOfBase64(b64));
        setDataUrl(`data:${media.mime};base64,${b64}`);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = String(e);
        const tooLarge = msg.match(/TOO_LARGE:(\d+)/);
        if (tooLarge) {
          setError(
            `This file is too large to preview (${humanSize(Number(tooLarge[1]))}). Open it in another app.`,
          );
        } else {
          log.error("readFileBase64 failed", e);
          setError(msg);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, media]);

  const KindIcon = media ? KIND_ICON[media.kind] : FileText;
  const openExternally = () => {
    openPath(path).catch((e) => log.warn("openPath failed", e));
  };

  return (
    <div className="or-media">
      <div className="or-media-bar">
        <KindIcon size={12} color="var(--neon-cyan)" />
        <span className="or-media-name" title={path}>
          {basename(path)}
        </span>
        <span className="or-media-meta">
          {media?.kind}
          {dims ? ` · ${dims.w}×${dims.h}` : ""}
          {bytes != null ? ` · ${humanSize(bytes)}` : ""}
        </span>
        <div style={{ flex: 1 }} />
        {media?.kind === "image" && dataUrl && (
          <button
            type="button"
            className="or-media-btn"
            onClick={() => setActualSize((v) => !v)}
            title={actualSize ? "Fit to window" : "Actual size (1:1)"}
          >
            {actualSize ? "Fit" : "1:1"}
          </button>
        )}
      </div>

      <div
        className={`or-media-stage${media?.kind === "image" ? " checker" : ""}${
          actualSize ? " scroll" : ""
        }`}
      >
        {error ? (
          <div className="or-media-msg error">
            <AlertTriangle size={20} />
            <span>{error}</span>
            <button type="button" className="or-media-open" onClick={openExternally}>
              Open externally
            </button>
          </div>
        ) : media?.kind === "pdf" ? (
          <div className="or-media-doc">
            <FileText size={30} color="var(--neon-cyan)" />
            <div className="or-media-audio-name">{basename(path)}</div>
            <button type="button" className="or-media-open" onClick={openExternally}>
              Open externally
            </button>
            <div className="or-media-hint">
              Inline PDF preview isn't supported — opens in your default app.
            </div>
          </div>
        ) : !dataUrl ? (
          <div className="or-media-msg">Loading…</div>
        ) : media?.kind === "image" ? (
          <img
            src={dataUrl}
            alt={basename(path)}
            className={actualSize ? "actual" : "fit"}
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            onError={() =>
              setError("Couldn't display this image — the file may be corrupt.")
            }
          />
        ) : media?.kind === "video" ? (
          <video
            src={dataUrl}
            controls
            className="fit"
            onError={() =>
              setError("Couldn't play this video — the codec may be unsupported.")
            }
          />
        ) : (
          <div className="or-media-audio">
            <Music size={28} color="var(--neon-cyan)" />
            <div className="or-media-audio-name">{basename(path)}</div>
            <audio
              src={dataUrl}
              controls
              onError={() =>
                setError("Couldn't play this audio — the format may be unsupported.")
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
