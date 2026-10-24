import type { PhotoAction } from "./controls";

export type BlurGeometryMode = "field" | "iris" | "spin" | "paths" | "tilt";
export type BlurGeometryTarget = {
  item: number;
  kind: "center" | "radiusX" | "radiusY" | "angle" | "feather" | "strength" | "point" | "focus" | "transition";
  point?: number;
};
export type BlurGeometryRow = Record<string, unknown> & { x: number; y: number; points?: [number, number][] };

const MAX_ITEMS = 256;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const within = (value: unknown, min: number, max: number): value is number => finite(value) && value >= min && value <= max;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const measured = (value: number) => Number(value.toPrecision(15));
const tiltAngle = (value: number) => ((value + 90) % 180 + 180) % 180 - 90;
const clone = <T,>(value: T): T => structuredClone(value);
const valueOr = (values: Record<string, unknown>, key: string, fallback: number) => finite(values[key]) ? values[key] as number : fallback;
const scalarValid = (values: Record<string, unknown>, key: string, min: number, max: number) => values[key] === undefined || within(values[key], min, max);
const pointValid = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && within(value[0], 0, 1) && within(value[1], 0, 1);
const rowValid = (mode: Exclude<BlurGeometryMode, "paths" | "tilt">, value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value) || (value.x !== undefined && !within(value.x, 0, 1)) || (value.y !== undefined && !within(value.y, 0, 1))) return false;
  if (mode === "field") return value.blur === undefined || within(value.blur, 0, 500);
  if (mode === "iris") return (value.radiusX === undefined || within(value.radiusX, 0.001, 1)) && (value.radiusY === undefined || within(value.radiusY, 0.001, 1)) && (value.angle === undefined || within(value.angle, -180, 180)) && (value.feather === undefined || within(value.feather, 0, 0.99)) && (value.roundness === undefined || within(value.roundness, 0, 100)) && (value.blur === undefined || within(value.blur, 0, 500));
  return (value.radiusX === undefined || within(value.radiusX, 0.001, 1)) && (value.radiusY === undefined || within(value.radiusY, 0.001, 1)) && (value.angle === undefined || within(value.angle, -180, 180)) && (value.blurAngle === undefined || within(value.blurAngle, 0, 360));
};

export function blurGeometryMode(action: PhotoAction): BlurGeometryMode | undefined {
  if (action.id === "filter.blurGallery.tiltShift") return "tilt";
  return action.structured === "field" || action.structured === "iris" || action.structured === "spin" || action.structured === "paths" ? action.structured : undefined;
}

function defaultPin(mode: "field" | "iris" | "spin", values: Record<string, unknown>): BlurGeometryRow {
  const base: BlurGeometryRow = { ...clone(values), x: valueOr(values, "centerX", 0.5), y: valueOr(values, "centerY", 0.5) };
  if (mode === "field") base.blur = valueOr(values, "blur", 15);
  else if (mode === "iris") Object.assign(base, { radiusX: valueOr(values, "radiusX", 0.35), radiusY: valueOr(values, "radiusY", 0.25), angle: valueOr(values, "angle", 0), roundness: valueOr(values, "roundness", 0), feather: valueOr(values, "feather", 0.5), blur: valueOr(values, "blur", 15) });
  else Object.assign(base, { radiusX: valueOr(values, "radiusX", 0.3), radiusY: valueOr(values, "radiusY", 0.3), angle: valueOr(values, "angle", 0), blurAngle: valueOr(values, "blurAngle", 15) });
  return base;
}

function readRows(mode: "field" | "iris" | "spin", values: Record<string, unknown>): BlurGeometryRow[] | undefined {
  if (values.pins === undefined) {
    const common = scalarValid(values, "centerX", 0, 1) && scalarValid(values, "centerY", 0, 1);
    const valid = mode === "field" ? common && scalarValid(values, "blur", 0, 500)
      : mode === "iris" ? common && scalarValid(values, "radiusX", 0.001, 1) && scalarValid(values, "radiusY", 0.001, 1) && scalarValid(values, "angle", -180, 180) && scalarValid(values, "roundness", 0, 100) && scalarValid(values, "feather", 0, 0.99) && scalarValid(values, "blur", 0, 500)
        : common && scalarValid(values, "radiusX", 0.001, 1) && scalarValid(values, "radiusY", 0.001, 1) && scalarValid(values, "angle", -180, 180) && scalarValid(values, "blurAngle", 0, 360);
    return valid ? [defaultPin(mode, values)] : undefined;
  }
  if (!Array.isArray(values.pins) || values.pins.length === 0 || values.pins.length > MAX_ITEMS || !values.pins.every(pin => rowValid(mode, pin))) return;
  return values.pins.map(pin => {
    const source = clone(pin), base = defaultPin(mode, {});
    return { ...base, ...source, x: valueOr(source, "x", 0.5), y: valueOr(source, "y", 0.5) };
  });
}

function readPaths(values: Record<string, unknown>): BlurGeometryRow[] | undefined {
  if (values.paths === undefined) {
    if (!scalarValid(values, "startX", 0, 1) || !scalarValid(values, "startY", 0, 1) || !scalarValid(values, "endX", 0, 1) || !scalarValid(values, "endY", 0, 1) || !scalarValid(values, "speed", 0, 500) || !scalarValid(values, "taper", 0, 100)) return;
    const start: [number, number] = [valueOr(values, "startX", 0.2), valueOr(values, "startY", 0.5)];
    const end: [number, number] = [valueOr(values, "endX", 0.8), valueOr(values, "endY", 0.5)];
    return [{ ...clone(values), x: start[0], y: start[1], points: [start, end], speed: valueOr(values, "speed", 50), taper: valueOr(values, "taper", 0) }];
  }
  if (!Array.isArray(values.paths) || values.paths.length === 0 || values.paths.length > MAX_ITEMS) return;
  const rows: BlurGeometryRow[] = [];
  for (const path of values.paths) {
    const source = clone(path);
    if (!isRecord(source) || (source.points !== undefined && (!Array.isArray(source.points) || source.points.length < 2 || source.points.length > MAX_ITEMS || !source.points.every(pointValid))) || (source.speed !== undefined && !within(source.speed, 0, 500)) || (source.taper !== undefined && !within(source.taper, 0, 100))) return;
    const points = (source.points ?? [[0.2, 0.5], [0.8, 0.5]]) as [number, number][];
    rows.push({ ...source, x: points[0]![0], y: points[0]![1], points: clone(points), speed: valueOr(source, "speed", 50), taper: valueOr(source, "taper", 0) });
  }
  return rows;
}

function validTilt(values: Record<string, unknown>): BlurGeometryRow[] | undefined {
  if (!scalarValid(values, "centerX", 0, 1) || !scalarValid(values, "centerY", 0, 1) || !scalarValid(values, "angle", -180, 180) || !scalarValid(values, "blur", 0, 500) || !scalarValid(values, "focus", 0, 1) || !scalarValid(values, "transition", 0.01, 1)) return;
  const x = valueOr(values, "centerX", 0.5), y = valueOr(values, "centerY", 0.5), angle = valueOr(values, "angle", 0), blur = valueOr(values, "blur", 15), focus = valueOr(values, "focus", 0.1), transition = valueOr(values, "transition", 0.15);
  if (!within(x, 0, 1) || !within(y, 0, 1) || !within(angle, -180, 180) || !within(blur, 0, 500) || !within(focus, 0, 1) || !within(transition, 0.01, 1)) return;
  return [{ ...clone(values), x, y, angle, blur, focus, transition }];
}

export function readBlurGeometry(mode: BlurGeometryMode, values: Record<string, unknown>): BlurGeometryRow[] | undefined {
  if (!isRecord(values)) return;
  if (mode === "field" || mode === "iris" || mode === "spin") return readRows(mode, values);
  if (mode === "paths") return readPaths(values);
  return validTilt(values);
}

function validDimensions(width: number, height: number): boolean { return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0; }
function targetIndex(rows: BlurGeometryRow[], item: number): boolean { return Number.isInteger(item) && item >= 0 && item < rows.length; }
function geometryValue(mode: BlurGeometryMode, rows: BlurGeometryRow[], target: BlurGeometryTarget, point: [number, number], width: number, height: number, radiusMinimum: number): Record<string, unknown> | undefined {
  if (!validDimensions(width, height) || !Array.isArray(point) || point.length !== 2 || !finite(point[0]) || !finite(point[1]) || !targetIndex(rows, target.item)) return;
  const row = rows[target.item]!;
  if (target.kind === "center") return { x: measured(clamp(point[0], 0, 1)), y: measured(clamp(point[1], 0, 1)) };
  if ((target.kind === "radiusX" || target.kind === "radiusY") && (mode === "iris" || mode === "spin")) {
    const angle = (row.angle as number) * Math.PI / 180, dx = (point[0] - row.x) * width, dy = (point[1] - row.y) * height;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const delta = target.kind === "radiusX" ? Math.abs(localX) : Math.abs(localY);
    return { [target.kind]: measured(clamp(delta / Math.min(width, height), radiusMinimum, 1)) };
  }
  if (target.kind === "angle" && (mode === "iris" || mode === "spin" || mode === "tilt")) {
    const dx = (point[0] - row.x) * width, dy = (point[1] - row.y) * height;
    if (dx === 0 && dy === 0) return;
    const direction = Math.atan2(dy, dx) * 180 / Math.PI;
    return { angle: measured(mode === "tilt" ? tiltAngle(-direction) : clamp(direction, -180, 180)) };
  }
  if (target.kind === "feather" && mode === "iris") {
    const angle = (row.angle as number) * Math.PI / 180, dx = (point[0] - row.x) * width, dy = (point[1] - row.y) * height;
    const u = (dx * Math.cos(angle) + dy * Math.sin(angle)) / ((row.radiusX as number) * Math.min(width, height));
    const v = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / ((row.radiusY as number) * Math.min(width, height));
    const exponent = 2 + (Number(row.roundness ?? 0) / 100) * 6;
    return { feather: measured(clamp((Math.abs(u) ** exponent + Math.abs(v) ** exponent) ** (1 / exponent), 0, 0.99)) };
  }
  if (mode === "paths" && target.kind === "point" && Number.isInteger(target.point) && target.point! >= 0 && target.point! < (row.points?.length ?? 0)) return { points: row.points!.map((entry, index) => index === target.point ? [measured(clamp(point[0], 0, 1)), measured(clamp(point[1], 0, 1))] : entry) };
  if (mode === "tilt" && (target.kind === "focus" || target.kind === "transition")) {
    const angle = (row.angle as number) * Math.PI / 180, normalDistance = Math.abs(((point[0] - row.x) * width * Math.sin(angle) + (point[1] - row.y) * height * Math.cos(angle)) / Math.min(width, height));
    return target.kind === "focus" ? { focus: measured(clamp(normalDistance, 0, 1)) } : { transition: measured(clamp(normalDistance - (row.focus as number), 0.01, 1)) };
  }
  return;
}

export function updateBlurGeometry(mode: BlurGeometryMode, values: Record<string, unknown>, target: BlurGeometryTarget, point: [number, number], width: number, height: number): Record<string, unknown> | undefined {
  const rows = readBlurGeometry(mode, values);
  if (!rows || !targetIndex(rows, target.item)) return;
  const update = geometryValue(mode, rows, target, point, width, height, Array.isArray(values.pins) ? .001 : .01);
  if (!update) return;
  if (mode === "tilt") return Object.fromEntries(Object.entries(update).map(([key, value]) => [key === "x" ? "centerX" : key === "y" ? "centerY" : key, value]));
  if (mode === "paths") {
    if (Array.isArray(values.paths)) return { paths: (values.paths as Record<string, unknown>[]).map((path, index) => index === target.item ? { ...clone(path), points: clone(update.points ?? path.points) } : clone(path)) };
    const points = update.points as [number, number][] | undefined;
    if (points && target.point === 0) return { startX: points[0]![0], startY: points[0]![1] };
    if (points && target.point === 1) return { endX: points[1]![0], endY: points[1]![1] };
    return;
  }
  if (Array.isArray(values.pins)) return { pins: (values.pins as Record<string, unknown>[]).map((pin, index) => index === target.item ? { ...clone(pin), ...clone(update) } : clone(pin)) };
  return Object.fromEntries(Object.entries(update).map(([key, value]) => [key === "x" ? "centerX" : key === "y" ? "centerY" : key, value]));
}

const valueRange = (mode: BlurGeometryMode, key: string): [number, number] | undefined => {
  if (key === "strength") key = mode === "spin" ? "blurAngle" : mode === "paths" ? "speed" : "blur";
  if (key === "blur" && (mode === "field" || mode === "iris" || mode === "tilt")) return [0, 500];
  if (key === "blurAngle" && mode === "spin") return [0, 360];
  if (key === "speed" && mode === "paths") return [0, 500];
  if (key === "taper" && mode === "paths") return [0, 100];
  if (key === "feather" && mode === "iris") return [0, 0.99];
  if (key === "roundness" && mode === "iris") return [0, 100];
  if (key === "focus" && mode === "tilt") return [0, 1];
  if (key === "transition" && mode === "tilt") return [0.01, 1];
  if (key === "angle" && (mode === "iris" || mode === "spin" || mode === "tilt")) return [-180, 180];
  if (key === "radiusX" || key === "radiusY") return mode === "iris" || mode === "spin" ? [0.001, 1] : undefined;
  if ((key === "x" || key === "centerX") && mode !== "paths") return [0, 1];
  if ((key === "y" || key === "centerY") && mode !== "paths") return [0, 1];
  return;
};

export function setBlurGeometryValue(mode: BlurGeometryMode, values: Record<string, unknown>, item: number, key: string, value: number): Record<string, unknown> | undefined {
  const range = valueRange(mode, key), rows = readBlurGeometry(mode, values);
  if (!range || !rows || !Number.isInteger(item) || item < 0 || item >= rows.length || !finite(value)) return;
  const storageKey = key === "strength" ? mode === "spin" ? "blurAngle" : mode === "paths" ? "speed" : "blur" : key;
  const minimum = (key === 'radiusX' || key === 'radiusY') && !Array.isArray(values.pins) ? .01 : range[0];
  const next = key === 'angle' && mode === 'tilt' ? tiltAngle(value) : clamp(value, minimum, range[1]);
  if (mode === "paths") {
    if (Array.isArray(values.paths)) return { paths: (values.paths as Record<string, unknown>[]).map((path, index) => index === item ? { ...clone(path), [storageKey]: next } : clone(path)) };
    return { [storageKey]: next };
  }
  if (mode === "tilt") return { [storageKey === "x" ? "centerX" : storageKey === "y" ? "centerY" : storageKey]: next };
  if (Array.isArray(values.pins)) return { pins: (values.pins as Record<string, unknown>[]).map((pin, index) => index === item ? { ...clone(pin), [storageKey]: next } : clone(pin)) };
  return { [storageKey === "x" ? "centerX" : storageKey === "y" ? "centerY" : storageKey]: next };
}

function scalarPin(mode: Exclude<BlurGeometryMode, "paths" | "tilt">, values: Record<string, unknown>): Record<string, unknown> {
  const row = readBlurGeometry(mode, values)![0]!;
  const fields = mode === "field" ? ["x", "y", "blur"]
    : mode === "iris" ? ["x", "y", "radiusX", "radiusY", "angle", "roundness", "feather", "blur"]
      : ["x", "y", "radiusX", "radiusY", "angle", "blurAngle"];
  return Object.fromEntries(fields.map(key => [key, row[key]]));
}

function normalizedPoint(point: [number, number]): [number, number] | undefined {
  return Array.isArray(point) && point.length === 2 && finite(point[0]) && finite(point[1]) ? [measured(clamp(point[0], 0, 1)), measured(clamp(point[1], 0, 1))] : undefined;
}

export function addBlurPin(mode: "field" | "iris" | "spin", values: Record<string, unknown>, selectedItem: number, point: [number, number]): { patch: Record<string, unknown>; selected: number } | undefined {
  const rows = readBlurGeometry(mode, values), nextPoint = normalizedPoint(point);
  if (!rows || !nextPoint || !Number.isInteger(selectedItem) || selectedItem < 0 || selectedItem >= rows.length) return;
  if (Array.isArray(values.pins)) {
    if (values.pins.length >= MAX_ITEMS) return;
    const source = values.pins as Record<string, unknown>[];
    const copy = { ...clone(source[selectedItem]!), x: nextPoint[0], y: nextPoint[1] };
    return { patch: { pins: [...clone(source), copy] }, selected: source.length };
  }
  if (selectedItem !== 0) return;
  const pin = scalarPin(mode, values);
  return { patch: { pins: [pin, { ...clone(pin), x: nextPoint[0], y: nextPoint[1] }] }, selected: 1 };
}

export function removeBlurPin(mode: "field" | "iris" | "spin", values: Record<string, unknown>, item: number): { patch: Record<string, unknown>; selected: number } | undefined {
  if (!Array.isArray(values.pins)) return;
  const rows = readBlurGeometry(mode, values), pins = values.pins as Record<string, unknown>[];
  if (!rows || pins.length <= 1 || !Number.isInteger(item) || item < 0 || item >= pins.length) return;
  const remaining = pins.filter((_, index) => index !== item).map(clone);
  return { patch: { pins: remaining }, selected: Math.min(item, remaining.length - 1) };
}

function scalarPath(values: Record<string, unknown>): Record<string, unknown> {
  const row = readBlurGeometry("paths", values)![0]!;
  return { ...clone(values), points: clone(row.points!), speed: row.speed, taper: row.taper };
}

export function insertBlurPathPoint(values: Record<string, unknown>, item: number, point: [number, number], width: number, height: number): { patch: Record<string, unknown>; point: number } | undefined {
  if (!validDimensions(width, height)) return;
  const rows = readBlurGeometry("paths", values), nextPoint = normalizedPoint(point);
  if (!rows || !nextPoint || !Number.isInteger(item) || item < 0 || item >= rows.length) return;
  const scalar = !Array.isArray(values.paths), rawPaths = scalar ? [scalarPath(values)] : values.paths as Record<string, unknown>[];
  const pathRows = rows[item]!, points = pathRows.points!;
  if (rawPaths.length > MAX_ITEMS || points.length >= MAX_ITEMS) return;
  const px = nextPoint[0] * width, py = nextPoint[1] * height;
  let closest = -1, closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index++) {
    const [axn, ayn] = points[index]!, [bxn, byn] = points[index + 1]!;
    const ax = axn * width, ay = ayn * height, dx = (bxn - axn) * width, dy = (byn - ayn) * height;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
    const distanceX = px - (ax + t * dx), distanceY = py - (ay + t * dy), distance = distanceX * distanceX + distanceY * distanceY;
    if (distance < closestDistance) { closest = index; closestDistance = distance; }
  }
  if (closest < 0) return;
  const inserted = closest + 1, nextPoints = points.map(clone);
  nextPoints.splice(inserted, 0, nextPoint);
  const paths = rawPaths.map((path, index) => index === item ? { ...clone(path), points: nextPoints } : clone(path));
  return { patch: { paths }, point: inserted };
}

export function removeBlurPathPoint(values: Record<string, unknown>, item: number, point: number): Record<string, unknown> | undefined {
  if (!Array.isArray(values.paths)) return;
  const rows = readBlurGeometry("paths", values), paths = values.paths as Record<string, unknown>[];
  if (!rows || !Number.isInteger(item) || item < 0 || item >= paths.length || !Number.isInteger(point)) return;
  const current = rows[item]!.points!;
  if (current.length <= 2 || point < 0 || point >= current.length) return;
  return { paths: paths.map((path, index) => index === item ? { ...clone(path), points: current.filter((_, at) => at !== point).map(clone) } : clone(path)) };
}
