import { useState } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { LINE_COLORS, RULER_UNITS, currentPreferences, previewPreferences, savePreferences, usePreferences, type GridStyle, type GridUnit, type Preferences, type RulerUnit } from "./preferences";

export type PreferencesSection = "units" | "guides";
const SECTIONS: [PreferencesSection, string][] = [["units", "Units & Rulers"], ["guides", "Guides, Grid & Slices"]];
const GRID_UNITS = RULER_UNITS.filter(([unit]) => unit !== "percent");

/** Photoshop's named colours, then Custom with its swatch. */
function ColorChoice({ label, value, change }: { label: string; value: string; change: (color: string) => void }) {
  const named = LINE_COLORS.find(([, hex]) => hex === value);
  return <div className="xd-ps-dialog-row">
    <label className="xd-ps-dialog-field"><span>Color:</span><select aria-label={`${label} color`} value={named ? value : "custom"} onChange={event => { if (event.target.value !== "custom") change(event.target.value); }}>
      {LINE_COLORS.map(([name, hex]) => <option key={name} value={hex}>{name}</option>)}<option value="custom">Custom</option></select></label>
    <input type="color" aria-label={`${label} custom color`} value={value} onChange={event => change(event.target.value)}/>
  </div>;
}

/** Edit › Preferences. Every change shows on the document at once, as in Photoshop; Cancel puts the old values back. */
export function PreferencesDialog({ section: opening, close }: { section: PreferencesSection; close: () => void }) {
  const [original] = useState(currentPreferences), [draft, setDraft] = useState(original), [section, setSection] = useState(opening);
  const [text, setText] = useState({ screenResolution: String(original.screenResolution), every: String(original.grid.every), subdivisions: String(original.grid.subdivisions) });
  const [notice, setNotice] = useState(() => usePreferences.getState().notice);
  const cancel = () => { previewPreferences(original); close(); };
  const dialog = useDesignDialog<HTMLFormElement>(cancel);
  const update = (next: Preferences) => { setDraft(next); previewPreferences(next); };
  const resolution = Number(text.screenResolution), every = Number(text.every), subdivisions = Number(text.subdivisions);
  const valid = { screenResolution: text.screenResolution.trim() !== "" && resolution >= 1 && resolution <= 9999, every: text.every.trim() !== "" && every >= 0.01 && every <= 99999, subdivisions: Number.isInteger(subdivisions) && subdivisions >= 1 && subdivisions <= 100 };
  // Typed numbers apply once they are in range; until then the last valid value stays on the document.
  const number = (field: keyof typeof text, value: string) => {
    setText(current => ({ ...current, [field]: value }));
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return;
    if (field === "screenResolution" && n >= 1 && n <= 9999) update({ ...draft, screenResolution: n });
    if (field === "every" && n >= 0.01 && n <= 99999) update({ ...draft, grid: { ...draft.grid, every: n } });
    if (field === "subdivisions" && Number.isInteger(n) && n >= 1 && n <= 100) update({ ...draft, grid: { ...draft.grid, subdivisions: n } });
  };
  const index = SECTIONS.findIndex(([id]) => id === section);
  return <PhotoDialog dialog={dialog} title="Preferences" className="xd-pref-dialog" close={cancel} okDisabled={!Object.values(valid).every(Boolean)}
    onSubmit={event => { event.preventDefault(); const failed = savePreferences(draft); if (failed) setNotice(failed); else close(); }}
    buttons={<>
      <button type="button" disabled={index === 0} onClick={() => setSection(SECTIONS[index - 1]![0])}>Prev</button>
      <button type="button" disabled={index === SECTIONS.length - 1} onClick={() => setSection(SECTIONS[index + 1]![0])}>Next</button>
    </>}>
    <div className="xd-photo-style-pages">
      <nav aria-label="Preferences sections">
        {SECTIONS.map(([id, label]) => <button type="button" key={id} aria-pressed={id === section} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      {section === "units" ? <div className="xd-pref-pane" role="group" aria-label="Units & Rulers">
        <fieldset className="xd-ps-dialog-group"><legend>Units</legend><div className="xd-ps-dialog-grid">
          <label className="xd-ps-dialog-field"><span>Rulers:</span><select aria-label="Ruler units" value={draft.rulerUnit} onChange={event => update({ ...draft, rulerUnit: event.target.value as RulerUnit })}>
            {RULER_UNITS.map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select></label>
        </div></fieldset>
        <fieldset className="xd-ps-dialog-group"><legend>New Document Preset Resolutions</legend><div className="xd-ps-dialog-grid">
          <label className="xd-ps-dialog-field"><span>Screen Resolution:</span><input type="number" aria-label="Screen resolution" min={1} max={9999} step="any" value={text.screenResolution} onChange={event => number("screenResolution", event.target.value)}/><span className="xd-ps-dialog-unit">Pixels/Inch</span></label>
        </div></fieldset>
        <fieldset className="xd-ps-dialog-group"><legend>Point/Pica Size</legend><div className="xd-ps-dialog-radios is-column" role="radiogroup" aria-label="Point/Pica Size">
          {([["postscript", "PostScript (72 Points/Inch)"], ["traditional", "Traditional (72.27 Points/Inch)"]] as const).map(([value, label]) =>
            <label key={value} className="xd-ps-dialog-check"><input type="radio" name="xd-pref-points" checked={draft.pointSize === value} onChange={() => update({ ...draft, pointSize: value })}/>{label}</label>)}
        </div></fieldset>
      </div> : <div className="xd-pref-pane" role="group" aria-label="Guides, Grid & Slices">
        <fieldset className="xd-ps-dialog-group"><legend>Guides</legend><div className="xd-ps-dialog-grid">
          <ColorChoice label="Guides" value={draft.guides.color} change={color => update({ ...draft, guides: { ...draft.guides, color } })}/>
          <label className="xd-ps-dialog-field"><span>Style:</span><select aria-label="Guides style" value={draft.guides.style} onChange={event => update({ ...draft, guides: { ...draft.guides, style: event.target.value as "lines" | "dashed" } })}>
            <option value="lines">Lines</option><option value="dashed">Dashed Lines</option></select></label>
        </div></fieldset>
        <fieldset className="xd-ps-dialog-group"><legend>Smart Guides</legend><div className="xd-ps-dialog-grid">
          <ColorChoice label="Smart guides" value={draft.smartGuides.color} change={color => update({ ...draft, smartGuides: { color } })}/>
        </div></fieldset>
        <fieldset className="xd-ps-dialog-group"><legend>Grid</legend><div className="xd-ps-dialog-grid">
          <ColorChoice label="Grid" value={draft.grid.color} change={color => update({ ...draft, grid: { ...draft.grid, color } })}/>
          <label className="xd-ps-dialog-field"><span>Style:</span><select aria-label="Grid style" value={draft.grid.style} onChange={event => update({ ...draft, grid: { ...draft.grid, style: event.target.value as GridStyle } })}>
            <option value="lines">Lines</option><option value="dashed">Dashed Lines</option><option value="dots">Dots</option></select></label>
          <div className="xd-ps-dialog-row">
            <label className="xd-ps-dialog-field"><span>Gridline Every:</span><input type="number" aria-label="Gridline every" min={0.01} max={99999} step="any" value={text.every} onChange={event => number("every", event.target.value)}/></label>
            <select aria-label="Gridline units" value={draft.grid.unit} onChange={event => update({ ...draft, grid: { ...draft.grid, unit: event.target.value as GridUnit } })}>
              {GRID_UNITS.map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select>
          </div>
          <label className="xd-ps-dialog-field"><span>Subdivisions:</span><input type="number" aria-label="Grid subdivisions" min={1} max={100} step={1} value={text.subdivisions} onChange={event => number("subdivisions", event.target.value)}/></label>
        </div></fieldset>
        <fieldset className="xd-ps-dialog-group"><legend>Slices</legend><div className="xd-ps-dialog-grid">
          <ColorChoice label="Slices line" value={draft.slices.color} change={color => update({ ...draft, slices: { ...draft.slices, color } })}/>
          <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check xd-ps-dialog-indent"><input type="checkbox" aria-label="Show slice numbers" checked={draft.slices.numbers} onChange={event => update({ ...draft, slices: { ...draft.slices, numbers: event.target.checked } })}/>Show Slice Numbers</label></div>
        </div></fieldset>
      </div>}
    </div>
    {notice && <p role="alert">{notice}</p>}
  </PhotoDialog>;
}
