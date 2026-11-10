import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { fontCodepoints, UNICODE_BLOCKS } from "./fontCmap";
import { useFontFamilies } from "./fontFamilies";
import { TYPE_STYLES } from "./toolBars";
import "./typePanels.css";

const RECENT_KEY = "xdesign.glyphs.recent", PAGE = 512;
const readRecent = (): string[] => {
  try { const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string").slice(0, 12) : []; } catch { return []; }
};
let faces = 0;
type Loaded = { family: string; codes: number[] } | "loading" | "unreadable" | "desktop";

/** Window › Glyphs: every glyph the chosen face maps, double-click to insert at the type caret. */
export function GlyphsPanel({ family, style, insert }: { family: string; style: string; insert: ((text: string, family: string, style: string) => void) | null }) {
  const fonts = useFontFamilies();
  const [font, setFont] = useState(family), [face, setFace] = useState(style), [loaded, setLoaded] = useState<Loaded>(isTauri() ? "loading" : "desktop");
  const [show, setShow] = useState("Entire Font"), [size, setSize] = useState(28), [limit, setLimit] = useState(PAGE), [recent, setRecent] = useState(readRecent);
  useEffect(() => { setFont(family); setFace(style); }, [family, style]);
  useEffect(() => {
    if (!isTauri() || !font.trim()) return;
    let alive = true;
    setLoaded("loading");
    void invoke<string | null>("xdesign_font_load", { family: font, style: face }).then(async encoded => {
      if (!encoded) { if (alive) setLoaded("unreadable"); return; }
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), codes = fontCodepoints(bytes);
      if (!codes.length) { if (alive) setLoaded("unreadable"); return; }
      const name = `xd-glyphs-${++faces}`;
      // The grid draws with the exact face the engine will use, not whatever WebKit substitutes for the family name.
      if (typeof FontFace === "function") { const loadedFace = await new FontFace(name, bytes).load(); document.fonts.add(loadedFace); }
      if (alive) { setLoaded({ family: typeof FontFace === "function" ? name : font, codes }); setLimit(PAGE); }
    }).catch(() => { if (alive) setLoaded("unreadable"); });
    return () => { alive = false; };
  }, [font, face]);
  const ready = typeof loaded === "object" ? loaded : null;
  const blocks = useMemo(() => ready ? UNICODE_BLOCKS.filter(([, start, end]) => ready.codes.some(code => code >= start && code <= end)) : [], [ready]);
  const block = UNICODE_BLOCKS.find(([name]) => name === show);
  const shown = ready ? (block ? ready.codes.filter(code => code >= block[1] && code <= block[2]) : ready.codes) : [];
  const use = (text: string) => {
    if (!insert) return;
    insert(text, font, face);
    const next = [text, ...recent.filter(item => item !== text)].slice(0, 12);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: the row still updates for this session */ }
  };
  const glyph = (text: string, key: string) => (
    <button key={key} type="button" className="xd-glyph" title={`U+${text.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`} aria-label={`Glyph ${text}`} style={{ fontFamily: ready ? `"${ready.family}"` : undefined, fontSize: size * .6, width: size, height: size }} onDoubleClick={() => use(text)} onKeyDown={event => { if (event.key === "Enter") use(text); }}>{text}</button>
  );
  return (
    <div className="xd-glyphs">
      <div className="xd-glyphs-recent" role="group" aria-label="Recently used glyphs">{recent.map(text => glyph(text, `recent-${text}`))}</div>
      <div className="xd-glyphs-font">
        <input aria-label="Glyphs font family" list={fonts.listId} value={font} onChange={event => setFont(event.target.value)} />{fonts.list}
        <select aria-label="Glyphs font style" value={face} onChange={event => setFace(event.target.value)}>{[...new Set([face, ...TYPE_STYLES])].map(name => <option key={name}>{name}</option>)}</select>
      </div>
      <label className="xd-glyphs-show">Show<select aria-label="Show" value={show} onChange={event => { setShow(event.target.value); setLimit(PAGE); }}><option>Entire Font</option>{blocks.map(([name]) => <option key={name}>{name}</option>)}</select></label>
      {!insert && <p className="xd-type-empty">Select a type layer to insert glyphs.</p>}
      {loaded === "desktop" ? <p className="xd-type-empty">Font glyphs are read in the desktop app.</p>
        : loaded === "unreadable" ? <p className="xd-type-empty">This font's glyphs could not be read.</p>
        : loaded === "loading" ? <p className="xd-type-empty">Reading glyphs…</p>
        : <div className="xd-glyphs-grid" role="group" aria-label="Glyphs" onScroll={event => { const el = event.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - size * 4) setLimit(value => value + PAGE); }}>{shown.slice(0, limit).map(code => glyph(String.fromCodePoint(code), String(code)))}</div>}
      <label className="xd-glyphs-size">Glyph size<input type="range" min={16} max={56} step={4} value={size} onChange={event => setSize(Number(event.target.value))} /></label>
    </div>
  );
}
