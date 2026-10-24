import { useEffect, useRef, useState } from "react";
import { runPhotoCommand } from "./runtime";
import { useFontFamilies } from "./fontFamilies";
import { NumberField, ToggleButton, TypeEmpty, useTypeTarget } from "./typePanelFields";
import type { PhotoLayer } from "./types";

type Face = { weight: number; italic: boolean };
const WEIGHTS: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
export const faceName = ({ weight, italic }: Face) => {
  const name = WEIGHTS[Math.round(weight / 100) * 100] ?? String(weight);
  return italic ? (name === "Regular" ? "Italic" : `${name} Italic`) : name;
};
// Each button runs the engine command that owns its feature; the two ligature kinds have dedicated style fields instead of feature tags.
const OPEN_TYPE = [
  { command: "standardLigatures", label: "Standard Ligatures", glyph: "fi", field: "ligatures" },
  { command: "contextualAlternates", label: "Contextual Alternates", glyph: "ct", tag: "calt" },
  { command: "discretionaryLigatures", label: "Discretionary Ligatures", glyph: "ad", field: "discretionaryLigatures" },
  { command: "swash", label: "Swash", glyph: "𝒜", tag: "swsh" },
  { command: "oldstyle", label: "Oldstyle", glyph: "12", tag: "onum" },
  { command: "stylisticAlternates", label: "Stylistic Alternates", glyph: "aA", tag: "salt" },
  { command: "titlingAlternates", label: "Titling Alternates", glyph: "T", tag: "titl" },
  { command: "ornaments", label: "Ornaments", glyph: "❦", tag: "ornm" },
  { command: "ordinals", label: "Ordinals", glyph: "1st", tag: "ordn" },
  { command: "fractions", label: "Fractions", glyph: "½", tag: "frac" },
] as const;
const ANTIALIAS = [["none", "None"], ["sharp", "Sharp"], ["crisp", "Crisp"], ["strong", "Strong"], ["smooth", "Smooth"], ["windowsLcd", "Windows LCD"], ["windows", "Windows"]] as const;

export function CharacterPanel({ layer }: { layer: PhotoLayer | undefined }) {
  const { off, value, update, error, setError } = useTypeTarget(layer), fonts = useFontFamilies();
  const family = typeof value("font") === "string" ? String(value("font")) : "";
  const [faces, setFaces] = useState<Face[]>([]), loaded = useRef("");
  // Styles come from the engine's face list; reading waits for an idle workspace so it never collides with an edit.
  useEffect(() => {
    if (!family || off || loaded.current === family) return;
    loaded.current = family;
    void runPhotoCommand("type.fonts", { family }).then(result => {
      const list = (result as { faces?: Face[] } | undefined)?.faces;
      setFaces(Array.isArray(list) ? list.filter(face => typeof face.weight === "number") : []);
    }).catch(() => { loaded.current = ""; });
  }, [family, off]);
  if (!layer?.text) return <div className="xd-type-panel" role="group" aria-label="Character"><TypeEmpty what="characters"/></div>;
  const weight = value("weight"), italic = value("italic"), mixedStyle = typeof weight !== "number" || typeof italic !== "boolean";
  const known = [...faces]; if (!mixedStyle && !known.some(face => face.weight === weight && face.italic === italic)) known.push({ weight, italic });
  const styleKey = (face: Face) => `${face.weight}/${face.italic}`;
  const flag = (field: string) => value(field) === true, caps = value("caps"), leading = value("leading"), kerning = value("kerning"), color = value("color");
  const openType = (item: typeof OPEN_TYPE[number]) => "tag" in item ? featureOn(layer.text?.runs, item.tag) : value(item.field) === true;
  return <fieldset className="xd-type-panel" aria-label="Character" disabled={off}>
    <div className="xd-type-grid">
      <label className="xd-type-field wide">Font{fonts.list}<input aria-label="Font family" list={fonts.listId} placeholder="Mixed" disabled={off} key={family} defaultValue={family}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={event => { if (event.target.value && event.target.value !== family) update({ font: event.target.value }); }}/></label>
      <label className="xd-type-field wide">Style<select aria-label="Font style" disabled={off || mixedStyle && !known.length} value={mixedStyle ? "" : styleKey({ weight, italic })}
        onChange={event => { const face = known.find(item => styleKey(item) === event.target.value); if (face) update({ weight: face.weight, italic: face.italic }); }}>
        {mixedStyle && <option value="" disabled>Mixed</option>}{known.map(face => <option key={styleKey(face)} value={styleKey(face)}>{faceName(face)}</option>)}</select></label>
      <NumberField label="Font size" field="size" current={value("size")} min={.1} max={10000} update={update} off={off} unit="pt"/>
      <label className="xd-type-field">Leading<input aria-label="Leading" key={String(leading)} placeholder="Mixed" disabled={off} defaultValue={typeof leading === "number" ? leading : leading === "auto" ? "Auto" : ""}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onBlur={event => { const input = event.target.value.trim().toLowerCase(), next = input === "auto" ? "auto" : Number(input); if (input && (next === "auto" ? leading !== "auto" : Number.isFinite(next) && next > 0 && next !== leading)) update({ leading: next }); }}/><span className="xd-type-unit">pt</span></label>
      <label className="xd-type-field">Kerning<select aria-label="Kerning" disabled={off} value={typeof kerning === "string" ? kerning : typeof kerning === "number" ? "manual" : ""}
        onChange={event => update({ kerning: event.target.value })}>
        {typeof kerning !== "string" && typeof kerning !== "number" && <option value="" disabled>Mixed</option>}{typeof kerning === "number" && <option value="manual" disabled>{kerning}</option>}
        <option value="metrics">Metrics</option><option value="optical">Optical</option><option value="off">0</option></select></label>
      <NumberField label="Tracking" field="tracking" current={value("tracking")} min={-1000} max={10000} update={update} off={off}/>
      <NumberField label="Vertical scale" field="verticalScale" current={value("verticalScale")} min={1} max={1000} update={update} off={off} unit="%"/>
      <NumberField label="Horizontal scale" field="horizontalScale" current={value("horizontalScale")} min={1} max={1000} update={update} off={off} unit="%"/>
      <NumberField label="Baseline shift" field="baselineShift" current={value("baselineShift")} min={-10000} max={10000} update={update} off={off} unit="pt"/>
      <label className="xd-type-field">Color<input aria-label="Text color" type="color" disabled={off} key={String(color)} defaultValue={typeof color === "string" ? color.slice(0, 7) : "#000000"}
        onChange={event => { event.currentTarget.dataset.changed = "true"; }}
        onBlur={event => { if (event.currentTarget.dataset.changed) update({ color: event.target.value + (typeof color === "string" && color.length === 9 ? color.slice(7) : "") }); }}/></label>
    </div>
    <div className="xd-type-buttons" role="group" aria-label="Type styles">
      <ToggleButton label="Faux Bold" pressed={flag("fauxBold")} off={off} run={() => update({ fauxBold: !flag("fauxBold") })}><b>T</b></ToggleButton>
      <ToggleButton label="Faux Italic" pressed={flag("fauxItalic")} off={off} run={() => update({ fauxItalic: !flag("fauxItalic") })}><i>T</i></ToggleButton>
      <ToggleButton label="All Caps" pressed={caps === "all"} off={off} run={() => update({ caps: caps === "all" ? "normal" : "all" })}>TT</ToggleButton>
      <ToggleButton label="Small Caps" pressed={caps === "small"} off={off} run={() => update({ caps: caps === "small" ? "normal" : "small" })}>Tt</ToggleButton>
      <ToggleButton label="Underline" pressed={flag("underline")} off={off} run={() => update({ underline: !flag("underline") })}><u>T</u></ToggleButton>
      <ToggleButton label="Strikethrough" pressed={flag("strikethrough")} off={off} run={() => update({ strikethrough: !flag("strikethrough") })}><s>T</s></ToggleButton>
    </div>
    <div className="xd-type-buttons" role="group" aria-label="OpenType features">
      {OPEN_TYPE.map(item => { const on = openType(item); return <ToggleButton key={item.command} label={item.label} pressed={on} off={off}
        run={() => { setError(null); void runPhotoCommand(`type.openType.${item.command}`, { layer: layer.id, on: !on }).catch(reason => setError(String(reason))); }}>{item.glyph}</ToggleButton>; })}
    </div>
    <label className="xd-type-field">Anti-aliasing<select aria-label="Anti-aliasing" disabled={off} value={ANTIALIAS.find(([id]) => id.toLowerCase() === (layer.text?.antialias ?? "smooth"))?.[0] ?? "smooth"}
      onChange={event => { setError(null); void runPhotoCommand(`type.antiAlias.${event.target.value}`, { layer: layer.id }).catch(reason => setError(String(reason))); }}>
      {ANTIALIAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {error && <p className="xd-type-error" role="alert">{error}</p>}
  </fieldset>;
}

// A feature is on when every run has it; mixed or absent reads as off, so the next click turns it on everywhere.
function featureOn(runs: NonNullable<PhotoLayer["text"]>["runs"], tag: string) {
  return !!runs?.length && runs.every(run => Number((run.style.features as Record<string, number> | undefined)?.[tag] ?? 0) > 0);
}
