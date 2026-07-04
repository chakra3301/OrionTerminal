/**
 * Effect browser — the Unicorn-style picker: search, category rail, and a
 * scrollable grid of cards with live-rendered previews of every effect.
 * Replaces the old cramped dropdown (which clipped at the panel edge).
 */

import { useEffect, useMemo, useState } from "react";
import { X, ImageIcon } from "lucide-react";
import { useFxStore } from "./fxStore";
import { FX_EFFECTS } from "./fxRegistry";
import { getEffectThumbs } from "./fxThumbs";
import type { FxEffectSpec } from "./fxModel";

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "source", label: "Sources" },
  { id: "generator", label: "Generators" },
  { id: "effect", label: "Effects" },
] as const;

type CatId = (typeof CATEGORIES)[number]["id"];

function matches(spec: FxEffectSpec, q: string): boolean {
  if (!q) return true;
  const hay = `${spec.label} ${spec.description} ${spec.id}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export function FxEffectBrowser({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CatId>("all");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getEffectThumbs().then((t) => {
      if (!cancelled) setThumbs(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(
    () =>
      FX_EFFECTS.filter(
        (s) => (cat === "all" || s.category === cat) && matches(s, query),
      ),
    [cat, query],
  );

  const add = (spec: FxEffectSpec) => {
    useFxStore.getState().addLayer(spec.id);
    onClose();
  };

  return (
    <div className="xd-fx-modal-scrim" onClick={onClose}>
      <div className="xd-fx-browser" onClick={(e) => e.stopPropagation()}>
        <div className="xd-fx-browser-top">
          <input
            type="text"
            className="xd-fx-browser-search"
            placeholder="Search effects"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="xd-fx-browser-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div className="xd-fx-browser-body">
          <nav className="xd-fx-browser-rail">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={cat === c.id ? "active" : ""}
                onClick={() => setCat(c.id)}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <div className="xd-fx-browser-grid-wrap">
            {shown.length === 0 ? (
              <div className="xd-fx-browser-empty">
                Nothing matches “{query}”.
              </div>
            ) : (
              <div className="xd-fx-browser-grid">
                {shown.map((spec) => (
                  <button
                    key={spec.id}
                    type="button"
                    className="xd-fx-card"
                    onClick={() => add(spec)}
                    title={spec.description}
                  >
                    <span className="xd-fx-card-thumb">
                      {thumbs[spec.id] ? (
                        <img src={thumbs[spec.id]} alt="" draggable={false} />
                      ) : spec.id === "srcImage" ? (
                        <span className="xd-fx-card-fallback">
                          <ImageIcon size={22} />
                        </span>
                      ) : (
                        <span className="xd-fx-card-loading" />
                      )}
                    </span>
                    <span className="xd-fx-card-meta">
                      <span className="xd-fx-card-name">{spec.label}</span>
                      <span className="xd-fx-card-desc">{spec.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
