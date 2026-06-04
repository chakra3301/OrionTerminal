import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { listTagsWithCounts } from "@/lib/db";
import { useArchives } from "@/apps/archives/useArchives";
import { useAssetsStore } from "@/store/assetsStore";
import { log } from "@/lib/log";

export function SidebarTags() {
  const selected = useArchives((s) => s.selectedTag);
  const setSelected = useArchives((s) => s.setSelectedTag);
  // Re-fetch when assets change (auto-tagging mutates the tag set in the
  // background). Subscribing to `assets` is cheap — we only re-render when
  // the map identity changes (i.e., a new asset arrives), not per-keystroke.
  const assets = useAssetsStore((s) => s.assets);
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    listTagsWithCounts(20)
      .then((rows) => {
        if (!cancelled) setTags(rows);
      })
      .catch((e) => log.warn("listTagsWithCounts failed", e));
    return () => {
      cancelled = true;
    };
  }, [assets]);

  if (tags.length === 0) {
    return (
      <>
        <div className="ar-section">Tags</div>
        <div className="ar-tag-cloud-empty">
          Add assets or notes — Claude tags them automatically.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ar-section">Tags</div>
      <div className="ar-tag-cloud">
        {tags.map((t) => {
          const active = selected === t.name;
          return (
            <button
              type="button"
              key={t.name}
              className={`ar-pill ar-pill-btn${active ? " active" : ""}`}
              onClick={() => setSelected(active ? null : t.name)}
              title={`${t.count} ${t.count === 1 ? "item" : "items"}`}
            >
              <Tag size={9} />#{t.name}
              <span className="ar-pill-count">{t.count}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
