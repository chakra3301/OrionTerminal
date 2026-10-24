import { useEffect, useId, useRef, useState } from "react";
import { Star } from "lucide-react";
import { useAssetsStore, type Asset } from "@/store/assetsStore";
import { bytesLabel } from "./downloadTypes";
import "./libraryDetails.css";

export function LibraryDetails({ asset }: { asset: Asset }) {
  const [title, setTitle] = useState(asset.title);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const id = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setTitle(asset.title); }, [asset.title]);
  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true); setMessage(null);
    try { await work(); if (alive.current) setMessage(success); }
    catch (error) { if (alive.current) setMessage(String(error)); }
    finally { if (alive.current) setBusy(false); }
  };
  const source = (() => { try { const u = new URL(asset.sourceUrl ?? ""); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } })();
  return <details className="dl-library-details">
    <summary>Library details</summary>
    <p>{asset.sourceCreator ? `${asset.sourceCreator} · ` : ""}{bytesLabel(asset.sizeBytes)} · {asset.mimeType}</p>
    <p className="dl-library-filename">Original file: {asset.originalName}</p>
    <form onSubmit={(e) => { e.preventDefault(); void run(() => useAssetsStore.getState().rename(asset.id, title), "Library title saved. Original filename kept."); }}>
      <label htmlFor={id}>Library title</label><input id={id} maxLength={300} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      <div className="dl-library-actions"><button type="submit" disabled={busy || !title.trim() || title.trim() === asset.title}>Save title</button>
      <button type="button" disabled={busy} aria-pressed={asset.favorite} onClick={() => void run(() => useAssetsStore.getState().toggleFavorite(asset.id), asset.favorite ? "Removed from favorites." : "Added to favorites.")}><Star size={13} />{asset.favorite ? "Unfavorite" : "Favorite"}</button>
      {source && <button type="button" disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(source), "Source link copied.")}>Copy source link</button>}</div>
    </form>
    {asset.sourceDescription && <p className="dl-library-description">{asset.sourceDescription.slice(0, 2000)}</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
