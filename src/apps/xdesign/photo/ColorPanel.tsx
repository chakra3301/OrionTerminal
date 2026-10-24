import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeftRight, Box, FilePlus } from "lucide-react";
import type { MenuEntry } from "../menuModel";
import {
  HUE_STRIP_BACKGROUND, SPECTRUM_BACKGROUND, brightnessFieldBackground, brightnessStripBackground, clamp, cmykFor, cmykToRgb, grayHex, grayPercent, hexToRgb, hsbPreserving, hsbToRgb, hueFieldBackground,
  isWebSafe, labFor, labToRgb, nearestWebSafe, normalizeHex, rgbToHex, rgbToHsb, snapWebChannel, spectrumColor, type Cmyk, type Hsb, type Lab, type Rgb,
} from "./colorModel";
import "./colorPanel.css";

export type ColorPanelMode = "hueCube" | "brightnessCube" | "colorWheel" | "grayscale" | "rgb" | "hsb" | "cmyk" | "lab" | "web";
type Key = "foreground" | "background";

const copy = (text: string) => {
  try { void navigator.clipboard?.writeText(text)?.catch(() => {}); } catch { /* clipboard unavailable: nothing to copy to */ }
};

export function colorPanelMenu(mode: ColorPanelMode, setMode: (mode: ColorPanelMode) => void, color: string): MenuEntry[] {
  const hex = color.toLowerCase();
  const radio = (label: string, value: ColorPanelMode): MenuEntry => ({ label, radio: true, checked: mode === value, run: () => setMode(value) });
  return [
    radio("Hue Cube", "hueCube"), radio("Brightness Cube", "brightnessCube"), radio("Color Wheel", "colorWheel"), radio("Grayscale Slider", "grayscale"),
    radio("RGB Sliders", "rgb"), radio("HSB Sliders", "hsb"), radio("CMYK Sliders", "cmyk"), radio("Lab Sliders", "lab"), radio("Web Color Sliders", "web"),
    "-",
    { label: "Copy Color as HTML", run: () => copy(`color="${hex}"`) },
    { label: "Copy Color's Hex Code", run: () => copy(hex.replace("#", "")) },
  ];
}

/** Pointer capture keeps a drag alive outside the control; points arrive as 0-1 fractions, y from the top. */
export function usePointerDrag(onPoint: (x: number, y: number) => void, disabled: boolean) {
  const dragging = useRef(false);
  const at = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onPoint(clamp((event.clientX - box.left) / (box.width || 1), 0, 1), clamp((event.clientY - box.top) / (box.height || 1), 0, 1));
  };
  const stop = () => { dragging.current = false; };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.button > 0) return;
      dragging.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.focus?.();
      at(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (dragging.current) at(event); },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}

/** Arrow keys as [dx, dy] with dy up-positive; Shift steps by 10. */
export function arrowStep(event: KeyboardEvent): [number, number] | null {
  const step = event.shiftKey ? 10 : 1;
  const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
  const dy = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
  return dx || dy ? [dx, dy] : null;
}

/** Commits on Enter or blur only; an Enter with an edit pending does not also submit an enclosing form. */
export function CommitField({ value, label, disabled, maxLength, className, commit }: {
  value: string; label: string; disabled?: boolean; maxLength: number; className?: string; commit: (text: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const done = () => { if (text !== null) commit(text); setText(null); };
  return <input type="text" className={className} aria-label={label} disabled={disabled} maxLength={maxLength} spellCheck={false} autoComplete="off" value={text ?? value}
    onChange={event => setText(event.target.value)} onBlur={done}
    onKeyDown={event => {
      if (text === null) return;
      if (event.key === "Enter") { event.preventDefault(); done(); }
      else if (event.key === "Escape") setText(null);
    }} />;
}

const parseInteger = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) ? Math.round(Number(text)) : null;
const parseWebHex = (text: string) => /^[0-9a-f]{1,2}$/i.test(text.trim()) ? snapWebChannel(parseInt(text, 16)) : null;
const gradient = (...stops: string[]) => `linear-gradient(to right,${stops.join(",")})`;
const hsbHex = (hsb: Hsb) => rgbToHex(hsbToRgb(hsb));
const labHex = (lab: Lab) => rgbToHex(labToRgb(lab));
const cmykHex = (cmyk: Cmyk) => rgbToHex(cmykToRgb(cmyk));
const range = (from: number, to: number, steps: number) => Array.from({ length: steps + 1 }, (_, i) => from + (to - from) * i / steps);
const WHEEL_BACKGROUND = `conic-gradient(${[0, 60, 120, 180, 240, 300, 360].map(h => hsbHex([h, 100, 100])).join(",")})`;
/** The wheel's inner saturation/brightness square, as fractions of the wheel box. */
const SQUARE_FROM = 0.29, SQUARE_SIZE = 0.42;

type Row = { letter: string; name: string; min?: number; max: number; step: number; value: number; unit: string; ramp: string; text?: string; parse: (text: string) => number | null; set: (value: number) => void };

function SliderRow({ row, disabled }: { row: Row; disabled: boolean }) {
  return <div className="xd-color-row">
    <span className="xd-color-letter">{row.letter}</span>
    <div className="xd-color-track">
      <div className="xd-color-bar" style={{ background: row.ramp }} />
      <input type="range" aria-label={row.name} min={row.min ?? 0} max={row.max} step={row.step} value={row.value} disabled={disabled} onChange={event => row.set(Number(event.target.value))} />
    </div>
    <CommitField className="xd-color-num" label={`${row.name} value`} value={row.text ?? String(row.value)} maxLength={4} disabled={disabled}
      commit={text => { const value = row.parse(text); if (value !== null) row.set(clamp(value, row.min ?? 0, row.max)); }} />
    <span className="xd-color-unit">{row.unit}</span>
  </div>;
}

export function ColorPanel({ foreground, background, disabled, mode, change, swap, reset, openPicker, addToSwatches }: {
  foreground: string; background: string; disabled: boolean; mode: ColorPanelMode;
  change: (key: Key, hex: string) => void; swap: () => void; reset: () => void; openPicker: (key: Key) => void; addToSwatches?: (hex: string) => void;
}) {
  const [active, setActive] = useState<Key>("foreground");
  const color = active === "foreground" ? foreground : background;
  const fresh = (hex: string): { hsb: Hsb; hex: string; seen: string; cmyk?: Cmyk; lab?: Lab } => ({ hsb: rgbToHsb(hexToRgb(hex)), hex, seen: hex });
  const [stored, setDraft] = useState(() => fresh(color));
  // Resync only when the prop changed to something other than what we just sent, so a lagging parent cannot reset the hue.
  let draft = stored;
  if (color !== draft.seen) { draft = color === draft.hex ? { ...draft, seen: color } : fresh(color); setDraft(draft); }
  const [h, s, b] = draft.hsb;
  const put = (hsb: Hsb, hex: string, typed: { cmyk?: Cmyk; lab?: Lab } = {}) => { setDraft({ hsb, hex, seen: draft.seen, ...typed }); change(active, hex); };
  const setHsb = (hsb: Hsb) => put(hsb, hsbHex(hsb));
  const setRgb = (rgb: Rgb) => put(hsbPreserving(rgb, draft.hsb), rgbToHex(rgb));
  const rgb = hexToRgb(color);
  const cmyk = cmykFor(color, draft.cmyk), lab = labFor(color, draft.lab);
  const setCmyk = (next: Cmyk) => { const from = cmykToRgb(next); put(hsbPreserving(from, draft.hsb), rgbToHex(from), { cmyk: next }); };
  const setLab = (next: Lab) => { const from = labToRgb(next); put(hsbPreserving(from, draft.hsb), rgbToHex(from), { lab: next }); };

  const bright = mode === "brightnessCube";
  const field = usePointerDrag((x, y) => setHsb(bright ? [x * 360, (1 - y) * 100, b] : [h, x * 100, (1 - y) * 100]), disabled);
  const strip = usePointerDrag((_, y) => setHsb(bright ? [h, s, (1 - y) * 100] : [(1 - y) * 360, s, b]), disabled);
  const ringZone = useRef(true);
  const wheelDrag = usePointerDrag((x, y) => ringZone.current
    ? setHsb([(Math.atan2(x - 0.5, 0.5 - y) * 180 / Math.PI + 360) % 360, s, b])
    : setHsb([h, clamp((x - SQUARE_FROM) / SQUARE_SIZE, 0, 1) * 100, (1 - clamp((y - SQUARE_FROM) / SQUARE_SIZE, 0, 1)) * 100]), disabled);
  const wheel = { ...wheelDrag, onPointerDown: (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    ringZone.current = Math.abs((event.clientX - box.left) / (box.width || 1) - 0.5) > SQUARE_SIZE / 2 || Math.abs((event.clientY - box.top) / (box.height || 1) - 0.5) > SQUARE_SIZE / 2;
    wheelDrag.onPointerDown(event);
  } };
  const spectrum = usePointerDrag((x, y) => setRgb(hexToRgb(spectrumColor(x, y))), disabled);

  const fieldKeys = (event: KeyboardEvent) => {
    const step = arrowStep(event); if (!step) return;
    event.preventDefault();
    if (bright) setHsb([clamp(Math.round(h) + step[0], 0, 360), clamp(Math.round(s) + step[1], 0, 100), b]);
    else setHsb([h, clamp(Math.round(s) + step[0], 0, 100), clamp(Math.round(b) + step[1], 0, 100)]);
  };
  const stripKeys = (event: KeyboardEvent) => {
    const step = arrowStep(event); if (!step) return;
    event.preventDefault();
    const delta = step[1] || step[0];
    setHsb(bright ? [h, s, clamp(Math.round(b) + delta, 0, 100)] : [clamp(Math.round(h) + delta, 0, 360), s, b]);
  };

  const rgbRows = (web: boolean): Row[] => ["R", "G", "B"].map((letter, i) => {
    const low = [...rgb] as Rgb, high = [...rgb] as Rgb; low[i] = 0; high[i] = 255;
    return {
      letter, name: ["Red", "Green", "Blue"][i]!, max: 255, step: web ? 51 : 1, value: rgb[i]!, unit: "", ramp: gradient(rgbToHex(low), rgbToHex(high)),
      text: web ? rgb[i]!.toString(16).padStart(2, "0") : undefined, parse: web ? parseWebHex : parseInteger,
      set: value => { const next = [...rgb] as Rgb; next[i] = web ? snapWebChannel(value) : value; setRgb(next); },
    };
  });
  const hsbRows: Row[] = [
    { letter: "H", name: "Hue", max: 360, step: 1, value: Math.round(h), unit: "°", ramp: gradient(...[0, 60, 120, 180, 240, 300, 360].map(hue => hsbHex([hue, s, b]))), parse: parseInteger, set: value => setHsb([value, s, b]) },
    { letter: "S", name: "Saturation", max: 100, step: 1, value: Math.round(s), unit: "%", ramp: gradient(hsbHex([h, 0, b]), hsbHex([h, 100, b])), parse: parseInteger, set: value => setHsb([h, value, b]) },
    { letter: "B", name: "Brightness", max: 100, step: 1, value: Math.round(b), unit: "%", ramp: gradient(hsbHex([h, s, 0]), hsbHex([h, s, 100])), parse: parseInteger, set: value => setHsb([h, s, value]) },
  ];
  const grayRows: Row[] = [{ letter: "K", name: "Black", max: 100, step: 1, value: grayPercent(color), unit: "%", ramp: gradient("#ffffff", "#000000"), parse: parseInteger, set: value => setRgb(hexToRgb(grayHex(value))) }];
  const cmykRows: Row[] = ["C", "M", "Y", "K"].map((letter, i) => {
    const low = [...cmyk] as Cmyk, high = [...cmyk] as Cmyk; low[i] = 0; high[i] = 100;
    return { letter, name: ["Cyan", "Magenta", "Yellow", "Black"][i]!, max: 100, step: 1, value: Math.round(cmyk[i]!), unit: "%", ramp: gradient(cmykHex(low), cmykHex(high)), parse: parseInteger,
      set: value => { const next = [...cmyk] as Cmyk; next[i] = value; setCmyk(next); } };
  });
  const labRows: Row[] = ["L", "a", "b"].map((letter, i) => {
    const [min, max] = i ? [-128, 127] : [0, 100];
    const stops = range(min, max, i ? 8 : 4).map(v => { const at = [...lab] as Lab; at[i] = v; return labHex(at); });
    return { letter, name: ["Lightness", "Lab a", "Lab b"][i]!, min, max, step: 1, value: Math.round(lab[i]!), unit: "", ramp: gradient(...stops), parse: parseInteger,
      set: value => { const next = [...lab] as Lab; next[i] = value; setLab(next); } };
  });
  const rows = mode === "cmyk" ? cmykRows : mode === "lab" ? labRows : mode === "rgb" ? rgbRows(false) : mode === "web" ? rgbRows(true) : mode === "hsb" ? hsbRows : mode === "grayscale" ? grayRows : [];

  const chip = (key: Key, label: string, hex: string) =>
    <button type="button" className={`xd-color-chip xd-color-${key}`} aria-label={label} aria-pressed={active === key} title={label} disabled={disabled} style={{ background: hex }}
      onClick={() => active === key ? openPicker(key) : setActive(key)} />;
  const showWebWarning = mode === "web" && !isWebSafe(color);

  return <div className="xd-color-panel" role="group" aria-label="Color">
    <div className="xd-color-main">
      <div className="xd-color-side">
        <div className="xd-color-chips">
          {chip("background", "Background color", background)}
          {chip("foreground", "Foreground color", foreground)}
          <button type="button" className="xd-color-mini xd-color-swap" aria-label="Swap foreground and background colors" title="Switch foreground and background colors" disabled={disabled} onClick={swap}><ArrowLeftRight size={10} /></button>
          <button type="button" className="xd-color-mini xd-color-default" aria-label="Default foreground and background colors" title="Default foreground and background colors" disabled={disabled} onClick={reset}><span /><span /></button>
        </div>
        {showWebWarning && <button type="button" className="xd-color-warn" aria-label="Not a web color — snap to web safe" title="Warning: not a web safe color. Click to select web safe color" disabled={disabled} onClick={() => setRgb(hexToRgb(nearestWebSafe(color)))}>
          <Box size={13} /><span style={{ background: nearestWebSafe(color) }} />
        </button>}
      </div>
      {mode === "hueCube" || bright
        ? <div className="xd-color-cube">
          <div role="slider" tabIndex={disabled ? -1 : 0} className="xd-color-sb" aria-label={bright ? "Hue and saturation" : "Saturation and brightness"} aria-disabled={disabled} aria-valuemin={0} aria-valuemax={bright ? 360 : 100} aria-valuenow={Math.round(bright ? h : s)}
            aria-valuetext={bright ? `H ${Math.round(h)}° S ${Math.round(s)}%` : `S ${Math.round(s)}% B ${Math.round(b)}%`} style={{ background: bright ? brightnessFieldBackground(b) : hueFieldBackground(h) }} onKeyDown={disabled ? undefined : fieldKeys} {...field}>
            <span className="xd-color-ring" style={{ left: `${bright ? h / 3.6 : s}%`, top: `${100 - (bright ? s : b)}%` }} />
          </div>
          <div role="slider" tabIndex={disabled ? -1 : 0} className="xd-color-hue" aria-label={bright ? "Brightness" : "Hue"} aria-orientation="vertical" aria-disabled={disabled} aria-valuemin={0} aria-valuemax={bright ? 100 : 360} aria-valuenow={Math.round(bright ? b : h)}
            style={{ background: bright ? brightnessStripBackground(h, s) : HUE_STRIP_BACKGROUND }} onKeyDown={disabled ? undefined : stripKeys} {...strip}>
            <span className="xd-color-marker" style={{ top: `${100 - (bright ? b : h / 3.6)}%` }} />
          </div>
        </div>
        : mode === "colorWheel"
        ? <div className="xd-color-wheelbox">
          <div role="slider" tabIndex={disabled ? -1 : 0} className="xd-color-wheel" aria-label="Color wheel" aria-disabled={disabled} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(h)}
            aria-valuetext={`H ${Math.round(h)}° S ${Math.round(s)}% B ${Math.round(b)}%`} onKeyDown={disabled ? undefined : fieldKeys} {...wheel}>
            <div className="xd-color-wheel-ring" style={{ background: WHEEL_BACKGROUND }} />
            <div className="xd-color-wheel-sb" style={{ background: hueFieldBackground(h) }} />
            <span className="xd-color-ring" style={{ left: `${50 + 41 * Math.sin(h * Math.PI / 180)}%`, top: `${50 - 41 * Math.cos(h * Math.PI / 180)}%` }} />
            <span className="xd-color-ring" style={{ left: `${(SQUARE_FROM + SQUARE_SIZE * s / 100) * 100}%`, top: `${(SQUARE_FROM + SQUARE_SIZE * (1 - b / 100)) * 100}%` }} />
          </div>
          {addToSwatches && <button type="button" className="xd-color-newswatch" aria-label="Add a new swatch for this color" title="Add a new swatch for this color" disabled={disabled} onClick={() => addToSwatches(color)}><FilePlus size={14} /></button>}
        </div>
        : <div className="xd-color-sliders">
          {rows.map(row => <SliderRow key={row.name} row={row} disabled={disabled} />)}
          {(mode === "rgb" || mode === "web") && <div className="xd-color-row xd-color-hexrow">
            <span className="xd-color-letter">#</span>
            <CommitField className="xd-color-num xd-color-hex" label="Hex color" value={color.slice(1)} maxLength={6} disabled={disabled}
              commit={text => { const hex = normalizeHex(text); if (hex) setRgb(hexToRgb(hex)); }} />
          </div>}
        </div>}
    </div>
    <div role="button" aria-label="Click to sample color" aria-disabled={disabled} title="Click to sample color" className="xd-color-spectrum" style={{ background: SPECTRUM_BACKGROUND }} {...spectrum} />
  </div>;
}
