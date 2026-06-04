import { useEffect, useState } from "react";
import {
  Search,
  X as XIcon,
  FileText,
  StickyNote,
  BookOpen,
  FolderKanban,
  MessageSquare,
  Image as ImageIcon,
  Music,
  Film as FilmIcon,
  FileQuestion,
} from "lucide-react";
import { type SearchHit, type NoteKind } from "@/lib/db";
import { searchHybrid } from "@/lib/searchHybrid";
import { useArchives } from "@/apps/archives/useArchives";
import { useAssetsStore } from "@/store/assetsStore";
import { routeToSearchHit } from "@/apps/archives/searchNav";
import { log } from "@/lib/log";

const SEARCH_DEBOUNCE_MS = 140;

export function SidebarSearch() {
  const query = useArchives((s) => s.searchQuery);
  const setQuery = useArchives((s) => s.setSearchQuery);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, setPending] = useState(false);

  // Debounced search — re-runs whenever the input changes. Cancellation via
  // an effect-scoped `cancelled` flag keeps stale responses from clobbering
  // a newer search.
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setPending(false);
      return;
    }
    setPending(true);
    let cancelled = false;
    const t = setTimeout(() => {
      searchHybrid(query, 24)
        .then((rows) => {
          if (cancelled) return;
          setHits(rows);
        })
        .catch((e) => {
          log.warn("search failed", e);
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const close = () => {
    setQuery("");
    setHits([]);
  };

  const handlePick = (hit: SearchHit) => {
    void routeToSearchHit(hit);
    close();
  };

  const showDropdown = query.trim().length > 0;

  return (
    <div className="ar-search-wrap ar-sidebar-search">
      <input
        className="ar-search"
        placeholder="Search archives…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      />
      <Search size={12} color="var(--t-tertiary)" className="ar-search-icon" />
      {query && (
        <button
          type="button"
          className="ar-search-clear"
          onClick={close}
          title="Clear"
        >
          <XIcon size={11} />
        </button>
      )}
      {showDropdown && (
        <div className="ar-search-results">
          {pending && hits.length === 0 ? (
            <div className="ar-search-empty">searching…</div>
          ) : hits.length === 0 ? (
            <div className="ar-search-empty">no matches</div>
          ) : (
            hits.map((h) => (
              <button
                type="button"
                key={`${h.entityType}:${h.entityId}`}
                className="ar-search-hit"
                onClick={() => handlePick(h)}
              >
                <span className="hit-icon">
                  <HitIcon hit={h} />
                </span>
                <span className="hit-body">
                  <span className="hit-title">{h.title}</span>
                  {h.snippet && (
                    <span
                      className="hit-snippet"
                      // Snippet wraps matches in `〔...〕` per our snippet() call —
                      // dangerouslySetInnerHTML keeps the highlight cheap without
                      // needing a parser. The query escaping in db.ts means we
                      // never inject user-controlled HTML.
                      dangerouslySetInnerHTML={{
                        __html: highlightSnippet(h.snippet),
                      }}
                    />
                  )}
                </span>
                <span className="hit-kind">{kindLabel(h)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function HitIcon({ hit }: { hit: SearchHit }) {
  if (hit.entityType === "chat") {
    return <MessageSquare size={11} color="var(--neon-cyan)" />;
  }
  if (hit.entityType === "asset") {
    return <AssetKindIcon entityId={hit.entityId} />;
  }
  switch (hit.noteKind) {
    case "journal":
      return <BookOpen size={11} color="var(--neon-yellow)" />;
    case "project":
      return <FolderKanban size={11} color="var(--neon-cyan)" />;
    case "note":
      return <StickyNote size={11} color="var(--neon-green)" />;
    default:
      return <FileText size={11} color="var(--t-tertiary)" />;
  }
}

function AssetKindIcon({ entityId }: { entityId: string }) {
  const asset = useAssetsStore((s) => s.assets.get(entityId));
  if (!asset) return <FileQuestion size={11} color="var(--t-tertiary)" />;
  switch (asset.kind) {
    case "image":
      return <ImageIcon size={11} color="var(--neon-cyan)" />;
    case "video":
      return <FilmIcon size={11} color="var(--neon-magenta)" />;
    case "audio":
      return <Music size={11} color="var(--neon-green)" />;
    case "doc":
      return <FileText size={11} color="var(--neon-yellow)" />;
    default:
      return <FileQuestion size={11} color="var(--t-tertiary)" />;
  }
}

function kindLabel(h: SearchHit): string {
  if (h.entityType === "chat") return "chat";
  if (h.entityType === "asset") return "asset";
  return (h.noteKind as NoteKind) ?? "note";
}

function highlightSnippet(snip: string): string {
  // `snippet(search_index, 3, '〔', '〕', '…', 16)` wraps matches in the unusual
  // tortoise brackets — replace with <mark> for visual highlighting. Escape
  // any other HTML first to be safe (DB content can contain `<`/`>`).
  const escaped = snip
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/〔/g, '<mark>')
    .replace(/〕/g, "</mark>");
}
