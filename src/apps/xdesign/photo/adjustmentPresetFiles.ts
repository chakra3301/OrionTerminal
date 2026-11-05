import { HUE_RANGES, IDENTITY_CURVE, SELECTIVE_RANGES, toneChannels } from "./adjustmentSettings";

type Values = Record<string, unknown>;
type Curve = [number, number][];

/** Photoshop's own preset formats (big-endian), keyed by XDesign adjustment id. */
export const PRESET_FILE_TYPES: Record<string, { extension: string; name: string }> = {
  levels: { extension: "alv", name: "Levels Presets" },
  curves: { extension: "acv", name: "Curves Presets" },
  exposure: { extension: "eap", name: "Exposure Presets" },
  hueSaturation: { extension: "ahu", name: "Hue/Saturation Presets" },
  blackWhite: { extension: "blw", name: "Black & White Presets" },
  channelMixer: { extension: "cha", name: "Channel Mixer Presets" },
  selectiveColor: { extension: "asv", name: "Selective Color Presets" },
};
const LABELS: Record<string, string> = { levels: "Levels", curves: "Curves", exposure: "Exposure", hueSaturation: "Hue/Saturation", blackWhite: "Black & White", channelMixer: "Channel Mixer", selectiveColor: "Selective Color" };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const rec = (value: unknown): Values => value && typeof value === "object" && !Array.isArray(value) ? value as Values : {};
const row = (value: unknown, fallback: number[]) => fallback.map((item, index) => num(Array.isArray(value) ? value[index] : undefined, item));
const wrap = (degrees: number) => ((Math.round(degrees) % 360) + 360) % 360;
const bad = () => { throw new Error("bad preset"); };
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

class Writer {
  private bytes: number[] = [];
  private put(size: number, write: (view: DataView) => void) {
    const view = new DataView(new ArrayBuffer(size));
    write(view);
    this.bytes.push(...new Uint8Array(view.buffer));
  }
  u8(value: number) { this.bytes.push(value & 255); }
  u16(value: number) { this.put(2, v => v.setUint16(0, value)); }
  i16(value: number) { this.put(2, v => v.setInt16(0, clamp(Math.round(value), -32768, 32767))); }
  i32(value: number) { this.put(4, v => v.setInt32(0, value)); }
  u32(value: number) { this.put(4, v => v.setUint32(0, value)); }
  f32(value: number) { this.put(4, v => v.setFloat32(0, value)); }
  f64(value: number) { this.put(8, v => v.setFloat64(0, value)); }
  ascii(text: string) { for (const char of text) this.u8(char.charCodeAt(0)); }
  done() { return Uint8Array.from(this.bytes); }
}

// Descriptor values: long -> number, bool -> boolean, doub -> number, Objc -> Descriptor, TEXT -> string.
type Descriptor = Map<string, number | boolean | string | Descriptor>;

function readDescriptor(data: DataView, start: number): [Descriptor, number] {
  let at = start;
  const u32 = () => { const value = data.getUint32(at); at += 4; return value; };
  const text = (length: number) => { let out = ""; for (let i = 0; i < length; i++, at++) out += String.fromCharCode(data.getUint8(at)); return out; };
  const unicode = () => { const length = u32(); let out = ""; for (let i = 0; i < length; i++, at += 2) out += String.fromCharCode(data.getUint16(at)); return out.replace(/\0+$/, ""); };
  const id = () => text(u32() || 4);
  unicode(); id();
  const items: Descriptor = new Map();
  for (let count = u32(); count > 0; count--) {
    const key = id(), type = text(4);
    if (type === "long") { items.set(key, data.getInt32(at)); at += 4; }
    else if (type === "bool") { items.set(key, data.getUint8(at++) !== 0); }
    else if (type === "doub") { items.set(key, data.getFloat64(at)); at += 8; }
    else if (type === "TEXT") items.set(key, unicode());
    else if (type === "Objc") { const [nested, end] = readDescriptor(data, at); items.set(key, nested); at = end; }
    else bad();
  }
  return [items, at];
}

const hex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
const unhex = (color: unknown) => { const match = /^#([\da-f]{6})$/i.exec(String(color)); return match ? [0, 2, 4].map(i => parseInt(match[1]!.slice(i, i + 2), 16)) : [225, 211, 179]; };

function writeDescriptor(out: Writer, className: string, classId: string, items: [string, "long" | "bool" | "doub" | "TEXT" | "Objc", unknown][]) {
  const id = (value: string) => { if (value.length === 4) out.u32(0); else out.u32(value.length); out.ascii(value); };
  out.u32(className.length + 1); for (const char of className) out.u16(char.charCodeAt(0)); out.u16(0);
  id(classId);
  out.u32(items.length);
  for (const [key, type, value] of items) {
    id(key); out.ascii(type);
    if (type === "long") out.i32(value as number);
    else if (type === "bool") out.u8(value ? 1 : 0);
    else if (type === "doub") out.f64(value as number);
    else if (type === "TEXT") { out.u32(1); out.u16(0); }
    else { const [name, id4, nested] = value as [string, string, [string, "doub", number][]]; writeDescriptor(out, name, id4, nested); }
  }
}

const BW_KEYS: [string, string][] = [["Rd  ", "reds"], ["Yllw", "yellows"], ["Grn ", "greens"], ["Cyn ", "cyans"], ["Bl  ", "blues"], ["Mgnt", "magentas"]];

const LEVELS_RECORDS = 29;
const levelsRecord = (data: DataView, at: number) => ({
  inBlack: clamp(data.getInt16(at), 0, 253), inWhite: clamp(data.getInt16(at + 2), 2, 255),
  outBlack: clamp(data.getInt16(at + 4), 0, 255), outWhite: clamp(data.getInt16(at + 6), 0, 255),
  gamma: clamp(data.getInt16(at + 8) / 100, 0.01, 9.99),
});

function readCurve(data: DataView, at: number): [Curve, number] {
  const count = data.getUint16(at);
  const byInput = new Map<number, number>();
  for (let i = 0; i < count; i++) byInput.set(clamp(data.getInt16(at + 2 + i * 4 + 2), 0, 255), clamp(data.getInt16(at + 2 + i * 4), 0, 255));
  const points = [...byInput].sort((a, b) => a[0] - b[0]).slice(0, 19) as Curve;
  return [points, at + 2 + count * 4];
}

const DECODERS: Record<string, (data: DataView, mode: string) => Values> = {
  levels(data, mode) {
    if (data.getUint16(0) !== 2 || data.byteLength < 2 + LEVELS_RECORDS * 10) bad();
    const values: Values = levelsRecord(data, 2);
    toneChannels(mode, {}).forEach((key, index) => { values[key] = levelsRecord(data, 12 + index * 10); });
    return values;
  },
  curves(data, mode) {
    const version = data.getUint16(0), count = data.getUint16(2);
    if ((version !== 1 && version !== 4) || count < 1) bad();
    const curves: Curve[] = [];
    let at = 4;
    for (let i = 0; i < count; i++) { const [points, end] = readCurve(data, at); if (points.length < 2) bad(); curves.push(points); at = end; }
    const values: Values = { points: curves[0] };
    toneChannels(mode, {}).forEach((key, index) => { if (curves[index + 1]) values[key] = curves[index + 1]; });
    return values;
  },
  exposure(data) {
    if (data.getUint16(0) !== 1) bad();
    const exposure = data.getFloat32(2), offset = data.getFloat32(6), gamma = data.getFloat32(10);
    if (![exposure, offset, gamma].every(Number.isFinite)) bad();
    return { exposure: clamp(exposure, -20, 20), offset: clamp(offset, -0.5, 0.5), gamma: clamp(gamma, 0.01, 9.99) };
  },
  hueSaturation(data) {
    if (data.getUint16(0) !== 2 || data.byteLength < 16 + 6 * 14) bad();
    const colorize = data.getUint8(2) === 1, at = colorize ? 4 : 10;
    const hue = data.getInt16(at), saturation = data.getInt16(at + 2), lightness = data.getInt16(at + 4);
    const values: Values = colorize
      ? { colorize, hue: wrap(clamp(hue, -180, 180)), saturation: clamp(saturation, 0, 100), lightness: clamp(lightness, -100, 100) }
      : { colorize, hue: clamp(hue, -180, 180), saturation: clamp(saturation, -100, 100), lightness: clamp(lightness, -100, 100) };
    HUE_RANGES.forEach((key, index) => {
      const base = 16 + index * 14, centre = index * 60;
      values[key] = {
        hue: clamp(data.getInt16(base + 8), -180, 180), saturation: clamp(data.getInt16(base + 10), -100, 100), lightness: clamp(data.getInt16(base + 12), -100, 100),
        range: [0, 2, 4, 6].map(i => ((((data.getInt16(base + i) - centre + 180) % 360) + 360) % 360) - 180 + centre),
      };
    });
    return values;
  },
  blackWhite(data) {
    if (data.getUint32(0) !== 16) bad();
    const [items] = readDescriptor(data, 4);
    const values: Values = {};
    for (const [id, key] of BW_KEYS) { const value = items.get(id); if (typeof value === "number") values[key] = clamp(value, -200, 300); }
    if (!Object.keys(values).length) bad();
    if (typeof items.get("useTint") === "boolean") values.tint = items.get("useTint");
    const colour = items.get("tintColor");
    if (colour instanceof Map) {
      const channels = ["Rd  ", "Grn ", "Bl  "].map(id => colour.get(id));
      if (channels.every(value => typeof value === "number")) values.tintColor = `#${channels.map(value => hex(value as number)).join("")}`;
    }
    return values;
  },
  channelMixer(data) {
    const mono = data.getUint16(2) === 1;
    if (data.getUint16(0) !== 1 || data.byteLength < 4 + (mono ? 10 : 30)) bad();
    const read = (index: number) => [0, 1, 2, 4].map(i => clamp(data.getInt16(4 + index * 10 + i * 2), -200, 200));
    return mono ? { monochrome: true, gray: read(0) } : { monochrome: false, red: read(0), green: read(1), blue: read(2) };
  },
  selectiveColor(data) {
    if (data.getUint16(0) !== 1 || data.byteLength < 4 + 10 * 8) bad();
    const values: Values = { method: data.getUint16(2) === 1 ? "absolute" : "relative" };
    SELECTIVE_RANGES.forEach((key, index) => { values[key] = [0, 1, 2, 3].map(i => clamp(data.getInt16(4 + (index + 1) * 8 + i * 2), -100, 100)); });
    return values;
  },
};

export function decodeAdjustmentPreset(kind: string, bytes: Uint8Array, mode: string): Record<string, unknown> {
  const decode = DECODERS[kind];
  if (!decode) throw new Error("Presets are not supported for this adjustment.");
  try { return decode(view(bytes), mode); } catch { throw new Error(`This is not a ${LABELS[kind]} preset file.`); }
}

const IDENTITY_TONE = { inBlack: 0, inWhite: 255, outBlack: 0, outWhite: 255, gamma: 1 };
function writeTone(out: Writer, value: unknown) {
  const tone = rec(value);
  for (const key of ["inBlack", "inWhite", "outBlack", "outWhite"] as const) out.i16(num(tone[key], IDENTITY_TONE[key]));
  out.i16(num(tone.gamma, 1) * 100);
}
function writeCurve(out: Writer, value: unknown) {
  const points = Array.isArray(value) && value.length >= 2 ? value as Curve : IDENTITY_CURVE;
  out.u16(points.length);
  for (const [input, output] of points) { out.i16(output); out.i16(input); }
}

const ENCODERS: Record<string, (out: Writer, values: Values, mode: string) => void> = {
  levels(out, values, mode) {
    const channels = toneChannels(mode, values);
    out.u16(2);
    for (let i = 0; i < LEVELS_RECORDS; i++) writeTone(out, i === 0 ? values : i <= channels.length ? values[channels[i - 1]!] : undefined);
  },
  curves(out, values, mode) {
    const channels = toneChannels(mode, values);
    out.u16(4); out.u16(Math.max(5, channels.length + 1));
    writeCurve(out, values.points);
    channels.forEach(key => writeCurve(out, values[key]));
    for (let i = channels.length + 1; i < 5; i++) writeCurve(out, undefined);
  },
  exposure(out, values) { out.u16(1); out.f32(num(values.exposure, 0)); out.f32(num(values.offset, 0)); out.f32(num(values.gamma, 1)); },
  hueSaturation(out, values) {
    const colorize = values.colorize === true;
    const hue = num(values.hue, 0), saturation = num(values.saturation, 0), lightness = num(values.lightness, 0);
    out.u16(2); out.u8(colorize ? 1 : 0); out.u8(0);
    for (const value of colorize ? [hue > 180 ? hue - 360 : hue, saturation, lightness] : [0, 25, 0]) out.i16(value);
    for (const value of colorize ? [0, 0, 0] : [hue, saturation, lightness]) out.i16(value);
    HUE_RANGES.forEach((key, index) => {
      const range = rec(values[key]), centre = index * 60;
      row(range.range, [-45, -15, 15, 45].map(value => value + centre)).forEach(value => out.i16(wrap(value)));
      out.i16(num(range.hue, 0)); out.i16(num(range.saturation, 0)); out.i16(num(range.lightness, 0));
    });
  },
  blackWhite(out, values) {
    out.u32(16);
    const [r, g, b] = unhex(values.tintColor);
    writeDescriptor(out, "", "null", [
      ...BW_KEYS.map(([id, key], index) => [id, "long", Math.round(num(values[key], [40, 60, 40, 60, 20, 80][index]!))] as [string, "long", number]),
      ["useTint", "bool", values.tint === true],
      ["tintColor", "Objc", ["", "RGBC", [["Rd  ", "doub", r], ["Grn ", "doub", g], ["Bl  ", "doub", b]]]],
      ["bwPresetKind", "long", 3],
      ["blackAndWhitePresetFileName", "TEXT", ""],
    ]);
  },
  channelMixer(out, values) {
    const mono = values.monochrome === true;
    out.u16(1); out.u16(mono ? 1 : 0);
    const rows = mono ? [row(values.gray, [40, 40, 20, 0])] : [row(values.red, [100, 0, 0, 0]), row(values.green, [0, 100, 0, 0]), row(values.blue, [0, 0, 100, 0])];
    for (let i = 0; i < 4; i++) {
      const [r, g, b, constant] = rows[i] ?? [0, 0, 0, 0];
      [r, g, b, 0, constant].forEach(value => out.i16(value!));
    }
  },
  selectiveColor(out, values) {
    out.u16(1); out.u16(values.method === "absolute" ? 1 : 0);
    for (let i = 0; i < 4; i++) out.i16(0);
    for (const key of SELECTIVE_RANGES) row(values[key], [0, 0, 0, 0]).forEach(value => out.i16(value));
  },
};

export function encodeAdjustmentPreset(kind: string, values: Record<string, unknown>, mode: string): Uint8Array {
  const encode = ENCODERS[kind];
  if (!encode) throw new Error("Presets are not supported for this adjustment.");
  const out = new Writer();
  encode(out, values, mode);
  return out.done();
}
