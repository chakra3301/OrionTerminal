import { useCallback, useEffect, useState } from "react";
import { FILL_MODES } from "./imageCommands";
import { DEFAULT_SHAPE_STYLE, sanitizeShapeStyle, type ShapeStyle } from "./shapeStyle";
import type { ShapeConstraint } from "./vectorGeometry";

export const VECTOR_TOOL_PREFERENCES_KEY = "orion.xdesign.vector-tools.v1";
const MAX_BYTES = 100 * 1024;
export const PATH_OP_VALUES = ["new", "combine", "subtract", "intersect", "exclude"] as const;
/** The shape tools share one style and mode, as do the pens; Pixels mode fills with `pixelMode`, `pixelOpacity` and `pixelAntiAlias`. */
export type VectorToolOptions = {
  shapeStyle: ShapeStyle; shapeMode: "shape" | "path" | "pixels"; penMode: "shape" | "path"; pixelMode: string; pixelOpacity: number; pixelAntiAlias: boolean; pathOp: typeof PATH_OP_VALUES[number];
  constraint: ShapeConstraint; radii: [number, number, number, number]; radiiLinked: boolean; polygonSides: number; starRatio: number; polygonRadius: number; lineWeight: number;
  arrowStart: boolean; arrowEnd: boolean; arrowWidth: number; arrowLength: number; arrowConcavity: number;
  rubberBand: boolean; autoAddDelete: boolean; curveFit: number;
  magnetic: boolean; magneticWidth: number; magneticContrast: number; magneticFrequency: number; magneticPressure: boolean;
  selectScope: "active" | "all"; alignTo: "selection" | "canvas"; sizeLinked: boolean;
};
export const DEFAULT_VECTOR_TOOL_OPTIONS: VectorToolOptions = {
  shapeStyle: DEFAULT_SHAPE_STYLE, shapeMode: "shape", penMode: "path", pixelMode: "Normal", pixelOpacity: 100, pixelAntiAlias: true, pathOp: "new",
  constraint: { kind: "unconstrained", width: 100, height: 100, fromCenter: false }, radii: [0, 0, 0, 0], radiiLinked: true, polygonSides: 5, starRatio: 100, polygonRadius: 0, lineWeight: 4,
  arrowStart: false, arrowEnd: false, arrowWidth: 500, arrowLength: 1000, arrowConcavity: 0,
  rubberBand: false, autoAddDelete: true, curveFit: 2,
  magnetic: false, magneticWidth: 10, magneticContrast: 10, magneticFrequency: 57, magneticPressure: false,
  selectScope: "active", alignTo: "selection", sizeLinked: false,
};
export const VECTOR_RANGES = { radius: [0, 10000], polygonSides: [3, 100], starRatio: [1, 100], lineWeight: [1, 1000], arrowWidth: [10, 1000], arrowLength: [10, 5000], arrowConcavity: [-50, 50], curveFit: [0.5, 10], magneticWidth: [1, 256], magneticContrast: [1, 100], magneticFrequency: [0, 100], pixelOpacity: [1, 100], constraint: [1, 300000] } as const;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const whole = (value: unknown, range: readonly [number, number], fallback: number) => Math.round(clamp(value, range, fallback));
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
const flag = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

export function sanitizeVectorToolOptions(value: unknown): VectorToolOptions {
  const v = record(value), d = DEFAULT_VECTOR_TOOL_OPTIONS, c = record(v.constraint), radii = Array.isArray(v.radii) && v.radii.length === 4 ? v.radii : d.radii;
  return {
    shapeStyle: sanitizeShapeStyle(v.shapeStyle ?? d.shapeStyle), shapeMode: oneOf(v.shapeMode, ["shape", "path", "pixels"], d.shapeMode), penMode: oneOf(v.penMode, ["shape", "path"], d.penMode),
    pixelMode: oneOf(v.pixelMode, FILL_MODES, d.pixelMode), pixelOpacity: whole(v.pixelOpacity, VECTOR_RANGES.pixelOpacity, d.pixelOpacity), pixelAntiAlias: flag(v.pixelAntiAlias, d.pixelAntiAlias), pathOp: oneOf(v.pathOp, PATH_OP_VALUES, d.pathOp),
    constraint: { kind: oneOf(c.kind, ["unconstrained", "square", "fixedSize", "proportional"], d.constraint.kind), width: clamp(c.width, VECTOR_RANGES.constraint, d.constraint.width), height: clamp(c.height, VECTOR_RANGES.constraint, d.constraint.height), fromCenter: flag(c.fromCenter, d.constraint.fromCenter) },
    radii: radii.map(radius => clamp(radius, VECTOR_RANGES.radius, 0)) as VectorToolOptions["radii"], radiiLinked: flag(v.radiiLinked, d.radiiLinked),
    polygonSides: whole(v.polygonSides, VECTOR_RANGES.polygonSides, d.polygonSides), starRatio: whole(v.starRatio, VECTOR_RANGES.starRatio, d.starRatio), polygonRadius: clamp(v.polygonRadius, VECTOR_RANGES.radius, d.polygonRadius), lineWeight: clamp(v.lineWeight, VECTOR_RANGES.lineWeight, d.lineWeight),
    arrowStart: flag(v.arrowStart, d.arrowStart), arrowEnd: flag(v.arrowEnd, d.arrowEnd), arrowWidth: whole(v.arrowWidth, VECTOR_RANGES.arrowWidth, d.arrowWidth), arrowLength: whole(v.arrowLength, VECTOR_RANGES.arrowLength, d.arrowLength), arrowConcavity: whole(v.arrowConcavity, VECTOR_RANGES.arrowConcavity, d.arrowConcavity),
    rubberBand: flag(v.rubberBand, d.rubberBand), autoAddDelete: flag(v.autoAddDelete, d.autoAddDelete), curveFit: clamp(v.curveFit, VECTOR_RANGES.curveFit, d.curveFit),
    magnetic: flag(v.magnetic, d.magnetic), magneticWidth: whole(v.magneticWidth, VECTOR_RANGES.magneticWidth, d.magneticWidth), magneticContrast: whole(v.magneticContrast, VECTOR_RANGES.magneticContrast, d.magneticContrast), magneticFrequency: whole(v.magneticFrequency, VECTOR_RANGES.magneticFrequency, d.magneticFrequency), magneticPressure: flag(v.magneticPressure, d.magneticPressure),
    selectScope: oneOf(v.selectScope, ["active", "all"], d.selectScope), alignTo: oneOf(v.alignTo, ["selection", "canvas"], d.alignTo), sizeLinked: flag(v.sizeLinked, d.sizeLinked),
  };
}

function readVectorToolPreferences(): { options: VectorToolOptions; writable: boolean; notice: string | null } {
  try {
    const raw = localStorage.getItem(VECTOR_TOOL_PREFERENCES_KEY);
    if (raw === null) return { options: DEFAULT_VECTOR_TOOL_OPTIONS, writable: true, notice: null };
    if (raw.length * 2 > MAX_BYTES) throw new Error("Vector tool preferences exceed the limit");
    const saved = record(JSON.parse(raw));
    if (saved.schemaVersion !== 1 || !saved.options || typeof saved.options !== "object" || Array.isArray(saved.options)) throw new Error("Unsupported vector tool preferences");
    return { options: sanitizeVectorToolOptions(saved.options), writable: true, notice: null };
  } catch {
    return { options: DEFAULT_VECTOR_TOOL_OPTIONS, writable: false, notice: "Saved shape and path tool settings could not be read. Current settings apply to this session." };
  }
}

export function useVectorToolPreferences() {
  const [initial] = useState(readVectorToolPreferences);
  const [current, setCurrent] = useState({ options: initial.options, revision: 0 });
  const [notice, setNotice] = useState(initial.notice);
  useEffect(() => {
    if (!current.revision || !initial.writable) return;
    try {
      const raw = JSON.stringify({ schemaVersion: 1, options: current.options });
      if (raw.length * 2 > MAX_BYTES) throw new Error("Vector tool preferences exceed the limit");
      localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY, raw);
      setNotice(null);
    } catch {
      setNotice("Shape and path tool settings could not be saved. Current settings apply to this session.");
    }
  }, [current, initial.writable]);
  const setOption = useCallback(<K extends keyof VectorToolOptions>(key: K, value: VectorToolOptions[K] | ((previous: VectorToolOptions[K]) => VectorToolOptions[K])) =>
    setCurrent(previous => ({ options: sanitizeVectorToolOptions({ ...previous.options, [key]: typeof value === "function" ? (value as (previous: VectorToolOptions[K]) => VectorToolOptions[K])(previous.options[key]) : value }), revision: previous.revision + 1 })), []);
  return { options: current.options, setOption, notice };
}
