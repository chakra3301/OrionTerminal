import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Image as ImageIcon, X } from "lucide-react";
import { useAssetsStore, type Asset } from "@/store/assetsStore";

export function XDesignImagePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (asset: Asset) => void;
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
    const list = Array.from(assetsMap.values())
      .filter((a) => a.kind === "image" && !!a.filePath)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [assetsMap, query]);

  return (
    <div
      className="ar-asset-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="xd-image-picker"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Place image from Archives"
      >
        <header className="xd-image-picker-header">
          <ImageIcon size={13} color="var(--neon-magenta)" />
          <span className="title">Place image · from Archives</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={13} />
          </button>
        </header>
        <div className="xd-image-picker-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter images… (title or tag)"
            autoFocus
            spellCheck={false}
          />
        </div>
        <div className="xd-image-picker-body scroll">
          {candidates.length === 0 ? (
            <div className="ar-empty-state">
              <ImageIcon size={20} color="var(--neon-magenta)" />
              <div className="title">No images in your library.</div>
              <div className="hint">
                Drop or paste an image into Archives → Media, then come back.
              </div>
            </div>
          ) : (
            <div className="xd-image-picker-grid">
              {candidates.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="xd-image-picker-tile"
                  title={a.title}
                  onClick={() => onPick(a)}
                >
                  {a.filePath && (
                    <img src={convertFileSrc(a.filePath)} alt={a.title} loading="lazy" />
                  )}
                  <div className="xd-image-picker-name">{a.title}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
