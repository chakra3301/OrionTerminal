import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Box } from "lucide-react";
import { useDesignDialog } from "../useDesignDialog";
import { CommitField, arrowStep, usePointerDrag } from "./ColorPanel";
import {
  HUE_STRIP_BACKGROUND, clamp, cmykFor, cmykToRgb, hexToRgb, hsbPreserving, hsbToRgb, hueFieldBackground, isWebSafe, labFor, labToRgb, nearestWebSafe, normalizeHex, rgbToHex, rgbToHsb,
  type Cmyk, type Hsb, type Lab, type Rgb,
} from "./colorModel";
import { PhotoDialog } from "./photoDialog";
import "./colorPanel.css";

type Channel = "h" | "s" | "v" | "r" | "g" | "b" | "l" | "la" | "lb" | "c" | "m" | "y" | "k";
type Space = "hsb" | "rgb" | "lab" | "cmyk";
/** Lab and CMYK keep the typed values as long as they still map to the draft's hex; 8-bit hex alone would make them drift on every edit. */
type Draft = { hsb: Hsb; hex: string; cmyk?: Cmyk; lab?: Lab };

const SIZE = 256;
const meta = (letter: string, name: string, min: number, max: number, unit: string, space: Space, index: number) => ({ letter, name, min, max, unit, space, index });
const CHANNELS: Record<Channel, ReturnType<typeof meta>> = {
  h: meta("H", "Hue", 0, 360, "°", "hsb", 0),
  s: meta("S", "Saturation", 0, 100, "%", "hsb", 1),
  v: meta("B", "Brightness", 0, 100, "%", "hsb", 2),
  r: meta("R", "Red", 0, 255, "", "rgb", 0),
  g: meta("G", "Green", 0, 255, "", "rgb", 1),
  b: meta("B", "Blue", 0, 255, "", "rgb", 2),
  l: meta("L", "Lightness", 0, 100, "", "lab", 0),
  la: meta("a", "Lab a", -128, 127, "", "lab", 1),
  lb: meta("b", "Lab b", -128, 127, "", "lab", 2),
  c: meta("C", "Cyan", 0, 100, "%", "cmyk", 0),
  m: meta("M", "Magenta", 0, 100, "%", "cmyk", 1),
  y: meta("Y", "Yellow", 0, 100, "%", "cmyk", 2),
  k: meta("K", "Black", 0, 100, "%", "cmyk", 3),
};
/** Photoshop lays the fields out H/S/B, R/G/B, L/a/b with radios, then C/M/Y/K without. */
const ORDER: Channel[] = ["h", "s", "v", "r", "g", "b", "l", "la", "lb"];
const CMYK_ORDER: Channel[] = ["c", "m", "y", "k"];
/** [x, y] of the field for each strip channel, as in Photoshop. */
const AXES: Partial<Record<Channel, [Channel, Channel]>> = { h: ["s", "v"], s: ["h", "v"], v: ["h", "s"], r: ["b", "g"], g: ["b", "r"], b: ["r", "g"], l: ["la", "lb"], la: ["lb", "l"], lb: ["la", "l"] };
const axesOf = (channel: Channel) => AXES[channel]!;
const span = (channel: Channel) => CHANNELS[channel].max - CHANNELS[channel].min;
const fraction = (channel: Channel, value: number) => (value - CHANNELS[channel].min) / span(channel);
const fromFraction = (channel: Channel, f: number) => CHANNELS[channel].min + f * span(channel);

const spaceValues = (draft: Draft, space: Space): number[] =>
  space === "hsb" ? draft.hsb : space === "rgb" ? hexToRgb(draft.hex) : space === "lab" ? labFor(draft.hex, draft.lab) : cmykFor(draft.hex, draft.cmyk);
const valueOf = (draft: Draft, channel: Channel) => spaceValues(draft, CHANNELS[channel].space)[CHANNELS[channel].index]!;
const spaceToRgb = (space: Space, values: number[]): Rgb =>
  space === "hsb" ? hsbToRgb(values as Hsb) : space === "lab" ? labToRgb(values as Lab) : space === "cmyk" ? cmykToRgb(values as Cmyk) : values as Rgb;

function fromRgb(rgb: Rgb, previous: Hsb, webOnly: boolean): Draft {
  let hex = rgbToHex(rgb);
  if (webOnly) hex = nearestWebSafe(hex);
  return { hsb: hsbPreserving(hexToRgb(hex), previous), hex };
}

function withChannels(draft: Draft, changes: [Channel, number][], webOnly: boolean): Draft {
  const { space } = CHANNELS[changes[0]![0]];
  const values = [...spaceValues(draft, space)];
  for (const [channel, value] of changes) values[CHANNELS[channel].index] = clamp(value, CHANNELS[channel].min, CHANNELS[channel].max);
  const rgb = spaceToRgb(space, values);
  if (space === "hsb") return webOnly ? fromRgb(rgb, values as Hsb, true) : { hsb: values as Hsb, hex: rgbToHex(rgb) };
  const next = fromRgb(rgb, draft.hsb, webOnly);
  return space === "lab" ? { ...next, lab: values as Lab } : space === "cmyk" ? { ...next, cmyk: values as Cmyk } : next;
}

function stripBackground(channel: Channel, draft: Draft): string {
  if (channel === "h") return HUE_STRIP_BACKGROUND;
  const { space, index, min, max } = CHANNELS[channel];
  const values = [...spaceValues(draft, space)];
  const steps = space === "lab" ? 8 : 1;
  const stops = Array.from({ length: steps + 1 }, (_, i) => { values[index] = min + (max - min) * i / steps; return rgbToHex(spaceToRgb(space, values)); });
  return `linear-gradient(to top,${stops.join(",")})`;
}

function paintField(canvas: HTMLCanvasElement, channel: Channel, draft: Draft) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(SIZE, SIZE);
  const [cx, cy] = axesOf(channel), { space } = CHANNELS[channel];
  const channelValues = [...spaceValues(draft, space)];
  const xi = CHANNELS[cx].index, yi = CHANNELS[cy].index;
  for (let y = 0; y < SIZE; y++) {
    channelValues[yi] = fromFraction(cy, 1 - y / (SIZE - 1));
    for (let x = 0; x < SIZE; x++) {
      channelValues[xi] = fromFraction(cx, x / (SIZE - 1));
      const [r, g, b] = spaceToRgb(space, channelValues);
      image.data.set([r, g, b, 255], (y * SIZE + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
}

const parseInteger = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) ? Math.round(Number(text)) : null;

export function ColorPickerDialog({ title, color, close, choose, addToSwatches }: {
  title: string; color: string; close: () => void; choose: (hex: string) => void; addToSwatches?: (hex: string) => void;
}) {
  const original = useRef(color);
  const start = (): Draft => ({ hsb: rgbToHsb(hexToRgb(original.current)), hex: original.current });
  const [draft, setDraft] = useState(start);
  const [channel, setChannel] = useState<Channel>("h");
  const [webOnly, setWebOnly] = useState(false);
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const canvas = useRef<HTMLCanvasElement>(null);

  const [cx, cy] = axesOf(channel), info = CHANNELS[channel];
  const fixed = valueOf(draft, channel);
  useEffect(() => { if (channel !== "h" && canvas.current) paintField(canvas.current, channel, draft); }, [channel, fixed]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (changes: [Channel, number][]) => setDraft(current => withChannels(current, changes, webOnly));
  const setHex = (hex: string) => setDraft(current => fromRgb(hexToRgb(hex), current.hsb, webOnly));
  const field = usePointerDrag((x, y) => edit([[cx, fromFraction(cx, x)], [cy, fromFraction(cy, 1 - y)]]), false);
  const strip = usePointerDrag((_, y) => edit([[channel, fromFraction(channel, 1 - y)]]), false);

  const fieldKeys = (event: KeyboardEvent) => {
    const step = arrowStep(event); if (!step) return;
    event.preventDefault();
    edit([[cx, Math.round(valueOf(draft, cx)) + step[0]], [cy, Math.round(valueOf(draft, cy)) + step[1]]]);
  };
  const stripKeys = (event: KeyboardEvent) => {
    const step = arrowStep(event); if (!step) return;
    event.preventDefault();
    edit([[channel, Math.round(fixed) + (step[1] || step[0])]]);
  };

  const revert = (exact: boolean) => {
    const base = start();
    setDraft(exact ? base : fromRgb(hexToRgb(base.hex), base.hsb, webOnly));
    if (exact) setWebOnly(false);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); choose(draft.hex); };
  // Sliders are not text inputs, so Enter does not submit the form natively.
  const enterOnSlider = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.target as HTMLElement).getAttribute("role") === "slider") { event.preventDefault(); choose(draft.hex); }
  };

  const [xValue, yValue] = [Math.round(valueOf(draft, cx)), Math.round(valueOf(draft, cy))];
  const stripValue = Math.round(fixed);
  const snap = () => setDraft(current => fromRgb(hexToRgb(current.hex), current.hsb, true));

  return <PhotoDialog noValidate dialog={dialog} title={title} close={close} reset={() => revert(true)} scrim={{ onKeyDown: enterOnSlider }} onSubmit={submit}
    buttons={addToSwatches && <button type="button" onClick={() => addToSwatches(draft.hex)}>Add to Swatches</button>}>
    <div className="xd-color-dialog">
      <div className="xd-color-dialog-body">
        <div className="xd-color-picker">
          <div role="slider" tabIndex={0} className="xd-color-bigfield" aria-label="Color field" aria-valuemin={CHANNELS[cx].min} aria-valuemax={CHANNELS[cx].max} aria-valuenow={xValue}
            aria-valuetext={`${CHANNELS[cx].letter} ${xValue}${CHANNELS[cx].unit} ${CHANNELS[cy].letter} ${yValue}${CHANNELS[cy].unit}`}
            style={channel === "h" ? { background: hueFieldBackground(draft.hsb[0]) } : undefined} onKeyDown={fieldKeys} {...field}>
            {channel !== "h" && <canvas ref={canvas} width={SIZE} height={SIZE} aria-hidden="true" />}
            <span className="xd-color-ring" style={{ left: `${fraction(cx, valueOf(draft, cx)) * 100}%`, top: `${(1 - fraction(cy, valueOf(draft, cy))) * 100}%` }} />
          </div>
          <div className="xd-color-stripwrap">
            <div role="slider" tabIndex={0} className="xd-color-bigstrip" aria-label={`${info.name} strip`} aria-orientation="vertical" aria-valuemin={info.min} aria-valuemax={info.max} aria-valuenow={stripValue}
              style={{ background: stripBackground(channel, draft) }} onKeyDown={stripKeys} {...strip} />
            <span className="xd-color-tri xd-color-tri-left" style={{ top: `${(1 - fraction(channel, fixed)) * 100}%` }} />
            <span className="xd-color-tri xd-color-tri-right" style={{ top: `${(1 - fraction(channel, fixed)) * 100}%` }} />
          </div>
        </div>
        <div className="xd-color-swatches">
          <span>new</span>
          <div className="xd-color-new" aria-label="New color" role="img" style={{ background: draft.hex }} />
          <button type="button" className="xd-color-current" aria-label="Current color. Click to revert" title="Click to revert to the current color" style={{ background: original.current }} onClick={() => revert(false)} />
          <span>current</span>
          {!isWebSafe(draft.hex) && <button type="button" className="xd-color-warn" aria-label="Not a web color — snap to web safe" title="Warning: not a web safe color. Click to select web safe color" onClick={snap}>
            <Box size={13} /><span style={{ background: nearestWebSafe(draft.hex) }} />
          </button>}
        </div>
        <div className="xd-color-values">
          {[...ORDER, ...CMYK_ORDER].map(item => {
            const meta = CHANNELS[item];
            return <div key={item} className="xd-color-valuerow">
              {meta.space === "cmyk"
                ? <span className="xd-color-radiospace" />
                : <input type="radio" name="xd-color-channel" aria-label={`${meta.name} channel`} checked={channel === item} onChange={() => setChannel(item)} />}
              <span className="xd-color-letter">{meta.letter}:</span>
              <CommitField className="xd-color-num" label={meta.name} value={String(Math.round(valueOf(draft, item)))} maxLength={4}
                commit={text => { const value = parseInteger(text); if (value !== null) edit([[item, value]]); }} />
              <span className="xd-color-unit">{meta.unit}</span>
            </div>;
          })}
          <div className="xd-color-valuerow xd-color-hexrow">
            <span className="xd-color-letter">#</span>
            <CommitField className="xd-color-num xd-color-hex" label="Hex color" value={draft.hex.slice(1)} maxLength={6}
              commit={text => { const hex = normalizeHex(text); if (hex) setHex(hex); }} />
          </div>
        </div>
      </div>
      <label className="xd-ps-dialog-check xd-color-webonly"><input type="checkbox" checked={webOnly} onChange={event => { setWebOnly(event.target.checked); if (event.target.checked) snap(); }} />Only Web Colors</label>
    </div>
  </PhotoDialog>;
}
