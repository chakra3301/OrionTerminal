import type { Dispatch, ReactNode, SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { choiceLabel, COLOR_LOOKS, humanize, type FilterOption, type NumberControl, type PhotoAction } from "./controls";
import { IDENTITY_CURVE, PHOTO_FILTER_PRESETS, SELECTIVE_RANGES, toneChannels } from "./adjustmentSettings";
import type { PhotoLayer } from "./types";
import { autoLevels, channelColor, CurveEditor, histogramIndex, histogramSpace, LevelsEditor, ThresholdEditor, useHistogram, type CurvePoint, type HistogramSource } from "./toneControls";
import { ToneAdjustment } from "./ToneTools";
import { smoothCurve } from "./curveTools";
import { balanceSlider, blackWhiteTrack, hueSaturationTrack, PhotoFilterUse, trackStyle } from "./colorControls";
import { HueSaturationLayout } from "./hueSaturationControls";
import { BlackWhiteLayout } from "./blackWhiteControls";
import { psSlider, psTrack } from "./psSliders";
import { bakeGradient, GRADIENT_METHODS } from "./gradientMethod";
import { AngleDial, AutoBrightnessContrast, ExposureEyedroppers, GradientMapGradient, MIXER_SWATCHES, SELECTIVE_SWATCHES, SwatchRow } from "./psAdjustControls";
import "./actionControls.css";

export { CurveEditor };
export type Settings = Record<string, unknown>;
const object = (value: unknown): Settings => value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {};

export const rgbHex = (value: unknown, fallback: string): string => Array.isArray(value) && value.length >= 3
  ? "#" + value.slice(0, 3).map(number => Math.round(Math.max(0, Math.min(1, Number(number))) * 255).toString(16).padStart(2, "0")).join("")
  : typeof value === "string" && /^#[\da-f]{6}/i.test(value) ? value.slice(0, 7) : fallback;

// One renderer for the modal dialog and the Properties editor, so labels and aria names cannot drift apart.
export function controlKit({ action, values, change, locked, anyStep = false, ps = false }: { action: PhotoAction; values: Settings; change: (key: string, value: unknown) => void; locked: boolean; anyStep?: boolean; ps?: boolean }) {
  const parameterLabel = action.id.startsWith("filter.") ? "Filter" : "Adjustment";
  const number = (field: NumberControl, value: unknown, commit: (value: number) => void, { track, ends, aside }: { track?: string; ends?: [string, string]; aside?: ReactNode } = {}) => {
    const step = anyStep ? 'any' : field.step ?? 1, finiteValue = typeof value === "number" && Number.isFinite(value);
    const box = <input aria-label={`${parameterLabel} ${field.label}`} type="number" required min={field.min} max={field.max} step={step} value={finiteValue ? value : ""} disabled={locked} onChange={event => commit(event.target.valueAsNumber)}/>;
    const shape = ps && !ends ? psSlider(action.id, field, finiteValue ? value : field.value, step, track) : null;
    const slider = shape ? <input aria-label={`${parameterLabel} ${field.label} slider`} type="range" className={shape.className} style={shape.style} min={shape.min} max={shape.max} step={shape.step} value={shape.position} disabled={locked} onChange={event => commit(shape.toValue(event.target.valueAsNumber))}/>
      : <input aria-label={`${parameterLabel} ${field.label} slider`} type="range" className={track ? "has-track" : undefined} style={track ? trackStyle(track) : undefined} min={field.min} max={field.max} step={step} value={finiteValue ? value : field.value} disabled={locked} onChange={event => commit(event.target.valueAsNumber)}/>;
    return ends ? <div key={field.key} className="xd-photo-balance-row"><span>{ends[0]}</span><span>{ends[1]}</span>{box}{slider}</div>
      : aside ? <div key={field.key} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{field.text ?? field.label}{ps ? "" : ":"}</span>{box}</label><span className="xd-ps-dialog-unit xd-photo-unit-aside">{field.unit}{aside}</span></div>
      : <div key={field.key} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{field.text ?? field.label}{ps ? "" : ":"}</span>{box}{field.unit && <span className="xd-ps-dialog-unit">{field.unit}</span>}</label>{slider}</div>;
  };
  const numericFields = (settings: Settings, update: (key: string, value: unknown) => void, entries: NumberControl[] = action.fields ?? [], track?: (field: NumberControl) => string | undefined) => {
    let group: string | undefined;
    return entries.flatMap(field => {
      const heading = field.group && field.group !== group ? [<p key={`${field.key}-group`} className="xd-ps-dialog-subhead">{field.group}</p>] : [];
      group = field.group;
      return [...heading, number(field, settings[field.key] ?? field.value, value => update(field.key, value), { track: track?.(field) })];
    });
  };
  const toggle = (key: string, label: string, commit = (value: boolean) => change(key, value), text = label) => <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label={`${parameterLabel} ${label}`} type="checkbox" disabled={locked} checked={values[key] === true} onChange={event => commit(event.target.checked)}/>{text}</label></div>;
  const color = (key: string, label: string, fallback: string, text = label) => <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{text}:</span><input aria-label={`${parameterLabel} ${label}`} type="color" disabled={locked} value={rgbHex(values[key], fallback)} onChange={event => change(key, event.target.value)}/></label></div>;
  const selector = (label: string, selected: string, options: string[], commit: (value: string) => void, { show = humanize, radios = false, text = label }: { show?: (value: string) => string; radios?: boolean; text?: string } = {}) => radios
    ? <fieldset className="xd-ps-dialog-group"><legend>{text}</legend><div role="radiogroup" aria-label={`${parameterLabel} ${label}`} className="xd-ps-dialog-radios">{options.map(value => <label key={value} className="xd-ps-dialog-check"><input type="radio" name={`${action.id}.${label}`} value={value} disabled={locked} checked={selected === value} onChange={() => commit(value)}/>{show(value)}</label>)}</div></fieldset>
    : <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{text}:</span><select aria-label={`${parameterLabel} ${label}`} disabled={locked} value={selected} onChange={event => commit(event.target.value)}>{options.map(value => <option key={value} value={value}>{show(value)}</option>)}</select></label></div>;
  const enumeration = (option: FilterOption, choices: string[]) => selector(option.label, String(values[option.key] ?? option.value), choices, value => change(option.key, value), { show: value => choiceLabel(option, value), radios: option.radios, text: option.text });
  return { number, numericFields, toggle, color, selector, enumeration };
}

export type AdjustmentControlsProps = {
  action: PhotoAction; values: Settings; setValues: Dispatch<SetStateAction<Settings>>; change: (key: string, value: unknown) => void; locked: boolean;
  mode: string; layer?: PhotoLayer; fields?: NumberControl[]; anyStep?: boolean;
  channel: string; setChannel: (value: string) => void; range: string; setRange: (value: string) => void;
  loadingFile: boolean; setLoadingFile: (value: boolean) => void; setLocalError: (value: string) => void;
  /** The pixels the histograms describe; without it Levels, Curves and Threshold draw no histogram. */
  source?: HistogramSource;
  /** The document image on the canvas, for the Levels and Curves eyedroppers. */
  canvas?: HTMLElement | null;
  /** A dialog's button column, where Photoshop puts Auto, Options… and the Levels eyedroppers. */
  toolSlot?: HTMLElement | null;
  /** Photoshop 2026's slider layout; Properties keeps the compact one. */
  psSliders?: boolean;
  /** Properties holds its commit while a modal editor such as the Gradient Editor is open. */
  hold?: (state: "open" | "ok" | "cancel") => void;
};
export function AdjustmentControls({ action, values, setValues, change, locked, mode, layer, fields = action.fields ?? [], anyStep, channel, setChannel, range, setRange, loadingFile, setLoadingFile, setLocalError, source, canvas, toolSlot, psSliders = false, hold }: AdjustmentControlsProps): ReactNode {
  const { number, numericFields, toggle, selector } = controlKit({ action, values, change, locked, anyStep, ps: psSliders });
  const channels = toneChannels(mode, values), toneChannel = channel || (channels[0] === "lightness" ? "lightness" : "composite");
  const tones = toneChannel === "composite" ? values : object(values[toneChannel]);
  const patchTone = (patch: Settings) => toneChannel === "composite" ? Object.entries(patch).forEach(([key, value]) => change(key, value)) : change(toneChannel, { ...tones, ...patch });
  const histograms = useHistogram(["levels", "curves", "threshold"].includes(action.id) ? source : undefined, action.id === "threshold" ? "luminosity" : histogramSpace(channels));
  const bins = histograms?.[histogramIndex(channels, toneChannel)], tint = channelColor(toneChannel), autoRange = bins && autoLevels(bins);
  const row = (values[action.id === "channelMixer" ? values.monochrome ? "gray" : channel || "red" : range] as number[] | undefined) ?? (action.id === "channelMixer" ? values.monochrome ? [40, 40, 20, 0] : channel === "green" ? [0, 100, 0, 0] : channel === "blue" ? [0, 0, 100, 0] : [100, 0, 0, 0] : Array(fields.length).fill(0));
  const rowKey = action.id === "channelMixer" ? values.monochrome ? "gray" : channel || "red" : range;
  const curveKey = toneChannel === "composite" ? "points" : toneChannel;
  const curve = (values[curveKey] as CurvePoint[] | undefined) ?? IDENTITY_CURVE;
  const hue = range === "master" ? values : object(values[range]);
  const hueFields = fields.map(field => field.key === "hue" && values.colorize && range === "master" ? { ...field, min: 0, max: 360 } : field.key === "saturation" && values.colorize && range === "master" ? { ...field, min: 0 } : field);
  const lookup = typeof values.file === "string" ? "file" : typeof values.lut === "string" ? values.lut : "current";
  const nativeLookup = object(layer?.adjustment?.ColorLookup);
  const loadLookup = () => { setLoadingFile(true); setLocalError(""); void open({ multiple: false, filters: [{ name: "Color lookup tables", extensions: ["cube", "3dl", "look"] }] }).then(file => { if (typeof file === "string") setValues(current => { const next: Settings = { ...current, file }; delete next.lut; delete next.data; return next; }); }).catch(error => setLocalError(String(error))).finally(() => setLoadingFile(false)); };
  const stops = (values.stops as [number, string][] | undefined) ?? [[0, "#000000"], [1, "#ffffff"]];
  let controls: ReactNode;
  if (action.id === "levels" || action.id === "curves") {
    // Grayscale, Duotone and Bitmap documents have one tonal channel, which Photoshop calls Gray.
    const gray = ["grayscale", "duotone", "bitmap"].includes(mode.toLowerCase()), composite = gray ? "Gray" : channels[0] === "cyan" ? "CMYK" : "RGB";
    const overlays = toneChannel === "composite" ? channels.filter(key => Array.isArray(values[key]) && JSON.stringify(values[key]) !== JSON.stringify(IDENTITY_CURVE)).map(key => ({ color: channelColor(key) ?? "var(--xd-text-2)", points: values[key] as CurvePoint[] })) : [];
    const channelAuto = autoRange ? () => { if (action.id === "levels") patchTone({ inBlack: autoRange[0], inWhite: autoRange[1], gamma: 1 }); else change(curveKey, [[autoRange[0], 0], [autoRange[1], 255]]); } : null;
    controls = <ToneAdjustment kind={action.id === "levels" ? "levels" : "curves"} values={values} setValues={setValues} channel={toneChannel} rgb={channels[0] === "red"} gray={gray} pigmentDefault={gray || channels[0] === "cyan"} smooth={() => change(curveKey, smoothCurve(curve))} histograms={histograms} channelAuto={channelAuto} locked={locked} source={source} canvas={canvas} slot={toolSlot} fail={setLocalError}
      head={selector("Channel", toneChannel, gray ? ["composite"] : channels[0] === "lightness" ? channels : ["composite", ...channels], setChannel, { show: value => value === "composite" ? composite : humanize(value) })}
      editor={action.id === "levels" ? view => <LevelsEditor tones={tones} fields={fields} bins={bins} color={tint} locked={locked} anyStep={anyStep} prefix="Adjustment" patch={patchTone} clip={view.clip}/> : view => <CurveEditor key={curveKey} points={curve} disabled={locked} change={points => change(curveKey, points)} bins={bins} color={tint} overlays={overlays} {...view}/>}/>;
  }
  else if (action.id === "threshold" && fields.some(field => field.key === "level")) controls = <ThresholdEditor field={fields.find(field => field.key === "level")!} value={values.level} bins={bins} locked={locked} anyStep={anyStep} prefix="Adjustment" commit={value => change("level", value)}/>;
  else if (["colorBalance", "channelMixer", "selectiveColor"].includes(action.id)) {
    const sliders = fields.map((field, index) => number(field, row[index] ?? field.value, value => change(rowKey, row.map((number, at) => at === index ? value : number)), action.id === "colorBalance" ? balanceSlider(field.label) : psSliders ? { track: psTrack(action.id, field.key) } : undefined));
    const total = row.slice(0, 3).reduce((a, b) => a + b, 0);
    controls = <>
      {action.id === "colorBalance" ? selector("Tone range", range, ["shadows", "midtones", "highlights"], setRange, { text: "Tone Balance", radios: true }) : action.id === "selectiveColor" ? (psSliders ? <SwatchRow label="Adjustment Color range" text="Colors" name="Color range" swatches={SELECTIVE_SWATCHES} selected={range} locked={locked} commit={setRange}/> : selector("Color range", range, SELECTIVE_RANGES, setRange, { text: "Colors" })) : <>
        {!values.monochrome && (psSliders ? <SwatchRow label="Adjustment Output channel" text="Output Channel" name="Output channel" swatches={MIXER_SWATCHES} selected={channel || "red"} locked={locked} commit={setChannel}/> : selector("Output channel", channel || "red", ["red", "green", "blue"], setChannel, { text: "Output Channel" }))}
        {toggle("monochrome", "Monochrome", value => setValues(current => ({ ...current, monochrome: value, ...(value && !current.monochrome ? { gray: current.gray ?? [40, 40, 20, 0] } : {}) })))}
        <p className="xd-ps-dialog-subhead">Source Channels</p>
      </>}
      {action.id === "channelMixer" ? <>{sliders.slice(0, 3)}<p className="xd-photo-mixer-total">Total: <output aria-label="Channel total">{total > 0 ? "+" : ""}{Math.round(total)}%</output>{total > 100 && <span className="xd-photo-mixer-warning" role="img" aria-label="Total is above 100%" title="Total is above 100%">⚠</span>}</p>{sliders.slice(3)}</> : sliders}
      {action.id === "colorBalance" && toggle("preserveLuminosity", "Preserve luminosity", undefined, "Preserve Luminosity")}
      {action.id === "selectiveColor" && selector("Method", String(values.method), ["relative", "absolute"], value => change("method", value), { radios: true })}
    </>;
  }
  else if (action.id === "hueSaturation") controls = <HueSaturationLayout values={values} change={change} range={range} setRange={setRange} locked={locked} anyStep={anyStep} source={source} canvas={canvas} fail={setLocalError}
    sliders={numericFields(hue, (key, value) => range === "master" ? change(key, value) : change(range, { ...hue, [key]: value }), hueFields, field => hueSaturationTrack(field.key, values, range))}
    colorize={toggle("colorize", "Colorize", value => { setRange("master"); setValues(current => ({ ...current, colorize: value, hue: value ? (Number(current.hue) % 360 + 360) % 360 : Math.max(-180, Math.min(180, Number(current.hue))), saturation: value ? Math.max(0, Number(current.saturation)) : current.saturation })); })}/>;
  else if (action.id === "gradientMap") {
    const method = GRADIENT_METHODS.find(([id]) => id === values.method)?.[0] ?? "classic";
    const hexStops = stops.map(([at, color]): [number, string] => [at, rgbHex(color, "#000000")]);
    const gradient = <GradientMapGradient stops={stops} shown={method === "classic" ? hexStops : bakeGradient(hexStops, method)} hex={value => rgbHex(value, "#000000")} locked={locked} change={next => change("stops", next)} hold={hold}/>;
    const options = <>{toggle("dither", "Dither")}{toggle("reverse", "Reverse")}{selector("Method", method, GRADIENT_METHODS.map(([id]) => id), value => change("method", value), { show: value => GRADIENT_METHODS.find(([id]) => id === value)![1] })}</>;
    controls = psSliders ? <><fieldset className="xd-ps-dialog-group"><legend>Gradient Used for Grayscale Mapping</legend>{gradient}</fieldset><fieldset className="xd-ps-dialog-group"><legend>Gradient Options</legend>{options}</fieldset></> : <>{gradient}{options}</>;
  }
  else if (action.id === "colorLookup") controls = <><div role="radiogroup" aria-label="Lookup type" className="xd-photo-lookup">
    <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input type="radio" name="colorLookup.type" aria-label="3DLUT File" checked readOnly disabled={locked}/>3DLUT File</label><select aria-label="Adjustment Look" disabled={locked || loadingFile} value={lookup} onChange={event => event.target.value === "load" ? loadLookup() : setValues(current => { const next = { ...current }; delete next.file; delete next.data; delete next.fileName; if (event.target.value === "current") delete next.lut; else next.lut = event.target.value; return next; })}>{layer && <option value="current">Current embedded look{nativeLookup.name ? ` · ${String(nativeLookup.name)}` : ""}</option>}{lookup === "file" && <option value="file">{String(values.file).split(/[\\/]/).at(-1)}</option>}{COLOR_LOOKS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="load">{loadingFile ? "Loading…" : "Load 3D LUT…"}</option></select></div>
    {["Abstract", "Device Link"].map(name => <div key={name} className="xd-ps-dialog-row" title="Not supported by the image engine"><label className="xd-ps-dialog-check"><input type="radio" name="colorLookup.type" aria-label={name} checked={false} readOnly disabled/>{name}</label><select aria-label={`${name} profile`} disabled value=""><option value="">Load {name} Profile…</option></select></div>)}
  </div>{selector("Interpolation", String(values.interpolation), ["trilinear", "tetrahedral"], value => change("interpolation", value))}{toggle("dither", "Dither")}</>;
  else if (action.id === "blackWhite") controls = <BlackWhiteLayout values={values} change={change} setValues={setValues} locked={locked} dialog={psSliders} tint={toggle("tint", "Tint")} tintColor={rgbHex(values.tintColor, "#e1d3b3")} slot={toolSlot} source={source} canvas={canvas} fail={setLocalError}
    sliders={numericFields(values, change, fields, field => blackWhiteTrack(field.key))} slider={(field, value, commit, track) => number(field, value, commit, { track })}/>;
  else controls = <>{action.id === "photoFilter" && <PhotoFilterUse color={rgbHex(values.color, "#ec8a00")} presets={PHOTO_FILTER_PRESETS} locked={locked} change={value => change("color", value)}/>}{action.id === "filter.blur.motionBlur" ? fields.map(field => number(field, values[field.key] ?? field.value, value => change(field.key, value), field.key === "angle" ? { aside: <AngleDial label="Angle" value={Number(values.angle)} disabled={locked} change={value => change("angle", value)}/> } : {})) : numericFields(values, change, fields.map(field => action.id === "brightnessContrast" && field.key === "contrast" && values.legacy ? { ...field, min: -100, max: 99 } : field))}{action.id === "brightnessContrast" && toggle("legacy", "Use legacy", value => setValues(current => ({ ...current, legacy: value, contrast: Math.max(value ? -100 : -50, Math.min(value ? 99 : 100, Number(current.contrast) || 0)) })), "Use Legacy")}{action.id === "brightnessContrast" && psSliders && <AutoBrightnessContrast slot={toolSlot} source={source} legacy={values.legacy === true} locked={locked} setValues={setValues}/>}{action.id === "exposure" && psSliders && <ExposureEyedroppers slot={toolSlot} source={source} canvas={canvas} mode={mode} locked={locked} setValues={setValues} fail={setLocalError}/>}{action.id === "photoFilter" && toggle("preserveLuminosity", "Preserve luminosity", undefined, "Preserve Luminosity")}{action.id === "invert" && <p className="xd-photo-section-help">Invert the colors of this layer.</p>}</>;
  return controls;
}
