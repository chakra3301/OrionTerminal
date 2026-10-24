import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import { NumberField, ToggleButton, TypeEmpty, useTypeTarget } from "./typePanelFields";
import type { PhotoLayer } from "./types";

const ALIGN = [
  ["left", "Align left", AlignLeft], ["center", "Align center", AlignCenter], ["right", "Align right", AlignRight],
  ["justify", "Justify last left", AlignJustify], ["justifyCenter", "Justify last centered", AlignJustify], ["justifyRight", "Justify last right", AlignJustify], ["justifyAll", "Justify all", AlignJustify],
] as const;

export function ParagraphPanel({ layer }: { layer: PhotoLayer | undefined }) {
  const { off, value, update, error } = useTypeTarget(layer);
  if (!layer?.text) return <div className="xd-type-panel" role="group" aria-label="Paragraph"><TypeEmpty what="paragraphs"/></div>;
  const align = value("align", true), direction = value("direction", true), hyphenate = value("hyphenate", true);
  const field = (label: string, key: string, min: number, max: number) => <NumberField label={label} field={key} current={value(key, true)} min={min} max={max} update={update} off={off} unit="pt"/>;
  return <fieldset className="xd-type-panel" aria-label="Paragraph" disabled={off}>
    <div className="xd-type-buttons" role="group" aria-label="Alignment">
      {ALIGN.map(([id, label, Icon], index) => <ToggleButton key={id} label={label} pressed={align === id} off={off} run={() => update({ align: id })}><Icon size={14} strokeWidth={index > 3 ? 1.5 : 2}/></ToggleButton>)}
    </div>
    <div className="xd-type-grid">
      {field("Left indent", "startIndent", -10000, 10000)}{field("Right indent", "endIndent", -10000, 10000)}
      {field("First line indent", "firstLineIndent", -10000, 10000)}<span/>
      {field("Space before", "spaceBefore", 0, 10000)}{field("Space after", "spaceAfter", 0, 10000)}
      <label className="xd-type-field">Direction<select aria-label="Text direction" disabled={off} value={typeof direction === "string" ? direction : ""} onChange={event => update({ direction: event.target.value })}>
        {typeof direction !== "string" && <option value="" disabled>Mixed</option>}<option value="auto">Auto</option><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>
      <label className="xd-type-field"><input type="checkbox" aria-label="Hyphenate" disabled={off} checked={hyphenate === true} ref={element => { if (element) element.indeterminate = hyphenate === undefined; }} onChange={event => update({ hyphenate: event.target.checked })}/>Hyphenate</label>
    </div>
    {error && <p className="xd-type-error" role="alert">{error}</p>}
  </fieldset>;
}
