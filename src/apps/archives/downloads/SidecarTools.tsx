import { useEffect, useId, useRef, useState } from "react";
import { ulid } from "ulid";
import { FileText, Search, Subtitles } from "lucide-react";
import { useArchiveSearchRevision } from "@/lib/archiveSearchRevision";
import { withArchivesActivity } from "../runtimeActivity";
import { routeToSearchHit } from "../searchNav";
import { sidecarApi, type AssetExtras, type CaptionSearchResult, type SidecarKind } from "./sidecarTypes";
import "./sidecars.css";

export function SidecarTools({ assetId, onSeek }: { assetId: string; onSeek?: (seconds: number) => void }) {
  const [details, setDetails] = useState<AssetExtras | null>(null);
  const [track, setTrack] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CaptionSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexUnknown, setIndexUnknown] = useState(false);
  const context = useRef({ assetId, epoch: 0, alive: true });
  const operation = useRef<string | null>(null);
  const searchVersion = useRef(0);
  const searchRevision = useArchiveSearchRevision((s) => s.revision);
  const ownRevision = useRef(searchRevision);
  const field = useId();
  if (context.current.assetId !== assetId) {
    context.current = { assetId, epoch: context.current.epoch + 1, alive: true };
  }
  useEffect(() => {
    context.current.alive = true;
    setDetails(null); setTrack(""); setError(null); setNotice(null); setQuery(""); setResults(null); setSearching(false); setIndexUnknown(false);
    return () => {
      context.current.alive = false;
      context.current.epoch++;
      searchVersion.current++;
      if (operation.current) void sidecarApi.cancel(operation.current).catch(() => undefined);
    };
  }, [assetId]);
  useEffect(() => {
    setResults(null); setSearching(false); searchVersion.current++;
    const changedAsset = useArchiveSearchRevision.getState().assetId;
    if (ownRevision.current !== searchRevision) {
      if (!changedAsset || changedAsset === assetId) setIndexUnknown(true);
      setNotice("Caption index changed elsewhere. Search again for current results.");
    }
  }, [searchRevision, assetId]);
  const current = details?.assetId === assetId ? details : null;
  const selected = current?.tracks.find((t) => String(t.index) === track && t.supported);
  const run = async (label: string, work: (id: string, valid: () => boolean) => Promise<void>) => {
    if (operation.current) return;
    const id = ulid(); const epoch = context.current.epoch; const source = assetId;
    const valid = () => context.current.alive && context.current.assetId === source && context.current.epoch === epoch;
    operation.current = id; setPending(label); setError(null); setNotice(null);
    try {
      await withArchivesActivity("media-sidecars", "A local caption/sidecar operation is running. Finish or cancel it before disabling Archives.", () => work(id, valid));
    } catch (e) { if (valid()) setError(String(e)); }
    finally { if (operation.current === id) operation.current = null; if (context.current.alive) setPending(null); }
  };
  const inspect = () => run("Inspecting the saved file…", async (id, valid) => {
    const next = await sidecarApi.inspect(id, assetId);
    if (!valid() || next.assetId !== assetId) return;
    setDetails(next); setIndexUnknown(false); setTrack(String(next.tracks.find((t) => t.supported)?.index ?? ""));
  });
  const exportSidecar = (kind: SidecarKind) => {
    if (!current) return;
    void run("Exporting locally · complete the Save dialog first…", async (id, valid) => {
      const saved = await sidecarApi.export(id, current.reviewId, kind, selected?.index);
      if (valid()) setNotice(saved ? "Sidecar saved. Original media unchanged." : "Save canceled. No sidecar or search-index change.");
    });
  };
  const index = () => {
    if (!current || !selected) return;
    void run("Extracting and indexing this caption track…", async (id, valid) => {
      const indexed = await sidecarApi.index(id, current.reviewId, selected.index);
      ownRevision.current = useArchiveSearchRevision.getState().changed(assetId);
      if (valid()) { setDetails({ ...current, indexed }); setIndexUnknown(false); setNotice(`${indexed.cues} cues indexed locally. This replaces any previously indexed track for this asset.`); }
    });
  };
  const clear = () => {
    if (!current) return;
    void run("Clearing indexed caption text…", async (id, valid) => {
      await sidecarApi.clear(id, assetId); ownRevision.current = useArchiveSearchRevision.getState().changed(assetId);
      if (valid()) { setDetails({ ...current, indexed: null }); setIndexUnknown(false); setNotice("Caption search text cleared. Original media and exports kept."); }
    });
  };
  const cancel = async () => {
    const id = operation.current; if (!id) return;
    const epoch = context.current.epoch; const source = assetId;
    const valid = () => context.current.alive && context.current.epoch === epoch && context.current.assetId === source && operation.current === id;
    try { await sidecarApi.cancel(id); if (valid()) setNotice("Cancel requested. Close the Save dialog too if it is open."); }
    catch (e) { if (valid()) setError(String(e)); }
  };
  const search = async () => {
    const version = ++searchVersion.current; const epoch = context.current.epoch;
    setSearching(true); setError(null);
    try {
      const hits = await sidecarApi.search(query);
      if (context.current.alive && context.current.epoch === epoch && searchVersion.current === version) setResults(hits);
    } catch (e) { if (context.current.alive && searchVersion.current === version) setError(String(e)); }
    finally { if (context.current.alive && searchVersion.current === version) setSearching(false); }
  };
  return <details className="ar-sidecars">
    <summary><Subtitles size={14} />Captions & sidecars</summary>
    <p>Read captions and chapters already inside this saved file. No remote access, cookies, AI or original-file changes. This cannot recover extras that were never saved.</p>
    <button type="button" disabled={!!pending} onClick={() => void inspect()}><FileText size={13} />{current ? "Inspect saved file again" : "Inspect saved file"}</button>
    {current && <>
      <p>{current.tracks.length} saved subtitle tracks · {current.chapters.length} chapters. Bitmap subtitles cannot be converted to text here.</p>
      {!!onSeek && !!current.chapters.length && <details className="ar-sidecar-chapters"><summary>Jump to chapter</summary><div className="ar-sidecar-actions">{current.chapters.map((chapter, index) => <button type="button" key={index} disabled={!!pending} onClick={() => onSeek(chapter.start)}>{chapter.title || `Chapter ${index + 1}`}</button>)}</div></details>}
      <label htmlFor={`${field}-track`}>Actual saved caption track</label>
      <select id={`${field}-track`} value={track} disabled={!!pending || !current.tracks.some((t) => t.supported)} onChange={(e) => setTrack(e.target.value)}>
        {!current.tracks.some((t) => t.supported) && <option value="">No supported text captions in this file</option>}
        {current.tracks.map((t) => <option key={t.index} value={t.index} disabled={!t.supported}>Track {t.index} · {t.language === "und" ? "Unknown language" : t.language} · {t.codec}{t.title ? ` · ${t.title}` : ""}{!t.supported ? " · text extraction unavailable" : ""}</option>)}
      </select>
      <div className="ar-sidecar-actions">
        <button type="button" disabled={!!pending || !selected} onClick={() => exportSidecar("vtt")}>Export VTT…</button>
        <button type="button" disabled={!!pending || !selected} onClick={() => exportSidecar("srt")}>Export SRT…</button>
        <button type="button" disabled={!!pending || !current.chapters.length} onClick={() => exportSidecar("chapters")}>Chapter JSON…</button>
        <button type="button" disabled={!!pending} onClick={() => exportSidecar("metadata")}>Metadata JSON…</button>
      </div>
      <p>Exports use a native Save dialog and never overwrite existing files. Metadata JSON contains bounded source text and actual file facts, with no raw transfer-URL or native-path fields.</p>
      <div className="ar-sidecar-index">
        <p>Index one selected track for Archives keyword search and authorized archive-search tools. Indexing uses no AI or network. A new track replaces the old index; exported files are independent.</p>
        {indexUnknown && <p>Caption index changed elsewhere. Inspect again for the current status, or clear it here.</p>}
        {!indexUnknown && current.indexed && <p>{current.indexed.stale ? "Stale index — reindex or clear" : `${current.indexed.cues} indexed cues · ${current.indexed.language}`} · track {current.indexed.streamIndex}</p>}
        <div className="ar-sidecar-actions"><button type="button" disabled={!!pending || !selected} onClick={index}>Index selected captions</button><button type="button" disabled={!!pending || (!current.indexed && !indexUnknown)} onClick={clear}>Clear caption index</button></div>
      </div>
    </>}
    {pending && <div className="ar-sidecar-actions" role="status"><span>{pending}</span><button type="button" onClick={() => void cancel()}>Cancel operation</button></div>}
    <form className="ar-sidecar-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
      <label htmlFor={`${field}-search`}><Search size={13} />Search caption-indexed media · keyword only, no AI</label>
      <div className="ar-sidecar-actions"><input id={`${field}-search`} value={query} maxLength={256} placeholder="Words in indexed captions…" onChange={(e) => { setQuery(e.target.value); setResults(null); setSearching(false); searchVersion.current++; }} /><button type="submit" disabled={searching || !query.trim()}>Search</button></div>
      {searching && <p role="status">Searching the local keyword index…</p>}
      {results && <div className="ar-sidecar-results">{results.length ? results.map((hit) => <button type="button" key={hit.assetId} onClick={() => void routeToSearchHit({ entityId: hit.assetId, entityType: "asset", title: hit.title, snippet: hit.snippet })}><strong>{hit.title}</strong><span>{hit.snippet}</span></button>) : <p>No current indexed media matches.</p>}</div>}
    </form>
    {notice && <p role="status">{notice}</p>}{error && <p className="ar-sidecar-error" role="alert">{error}</p>}
  </details>;
}
