import { create } from "zustand";
import { holdImageGesture, runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { identityTransform, layerFrame, transformMatrix, type Bounds, type Quad, type TransformSettings } from "./transformMath";
import type { PhotoDocument, PhotoLayer } from "./types";

export type { Quad };
/** Edit ▸ Transform entries; Free Transform (⌘T) is "free". */
export type TransformMode = "free" | "scale" | "rotate" | "skew" | "distort" | "perspective";
export type Interpolation = "bicubic" | "bilinear" | "nearest";
export const INTERPOLATIONS: [Interpolation, string][] = [["nearest", "Nearest Neighbor"], ["bilinear", "Bilinear"], ["bicubic", "Bicubic"]];
export type FreeTransformSession = { documentId: string; layerId: number; version: string; viewKey: string | undefined; mode: TransformMode; bounds: Bounds; settings: TransformSettings; quad: Quad | null; interpolation: Interpolation; linked: boolean; preview: string | null };
export const useFreeTransform = create<{ session: FreeTransformSession | null; held: string | null }>(() => ({ session: null, held: null }));
let release: (() => void) | null = null;

/** The gesture hold stays for the whole session so nothing else edits the document meanwhile. */
export function beginFreeTransform(document: PhotoDocument, layer: PhotoLayer, viewKey: string | undefined, mode: TransformMode = "free"): boolean {
  const current = useFreeTransform.getState().session;
  if (current) {
    if (current.documentId !== document.id || current.layerId !== layer.id) return false;
    // Picking another Transform entry mid-session only changes how the handles behave; the pending shape stays.
    if (current.mode !== mode) useFreeTransform.setState({ session: { ...current, mode } });
    return true;
  }
  if (usePhotoWorkspace.getState().busy) return false;
  const bounds = layerFrame(document, layer);
  release = holdImageGesture("Commit or cancel the free transform before switching projects.");
  useFreeTransform.setState({ session: { documentId: document.id, layerId: layer.id, version: document.version, viewKey, mode, bounds, settings: identityTransform(bounds), quad: null, interpolation: "bicubic", linked: true, preview: null } });
  return true;
}
export const patchFreeTransform = (patch: Partial<Pick<FreeTransformSession, "settings" | "quad" | "interpolation" | "linked" | "preview" | "mode">>) =>
  useFreeTransform.setState(state => state.session ? { session: { ...state.session, ...patch } } : state);
export function cancelFreeTransform() {
  release?.(); release = null;
  if (useFreeTransform.getState().session) useFreeTransform.setState({ session: null });
}
export const freeTransformChanged = (session: FreeTransformSession) => !!session.quad || JSON.stringify(session.settings) !== JSON.stringify(identityTransform(session.bounds));
export function freeTransformParams(session: FreeTransformSession) {
  const [x, y, width, height] = session.bounds, { interpolation } = session;
  return session.quad ? { layer: session.layerId, rect: [x, y, x + width, y + height], quad: session.quad, interpolation } : { layer: session.layerId, matrix: transformMatrix(session.bounds, session.settings), interpolation };
}
/** One `edit.transform` for the whole session. The preview stays up until the committed image is shown. */
export function commitFreeTransform(untilShown: (work: Promise<unknown>) => Promise<unknown>): Promise<unknown> | null {
  const session = useFreeTransform.getState().session;
  if (!session) return null;
  if (!freeTransformChanged(session)) { cancelFreeTransform(); return null; }
  const params = freeTransformParams(session);
  // Released first: the commit would otherwise wait for its own hold.
  release?.(); release = null;
  const work = runPhotoCommand("edit.transform", params);
  useFreeTransform.setState({ session: null, held: session.preview });
  void untilShown(work).catch(() => {}).then(() => useFreeTransform.setState({ held: null }));
  return work;
}

const RANGES = { x: [-1_000_000, 1_000_000], y: [-1_000_000, 1_000_000], width: [1, 1000], height: [1, 1000], angle: [-3600, 3600], skewX: [-85, 85], skewY: [-85, 85] } as const;
export type FreeTransformField = keyof typeof RANGES;
export const freeTransformRange = (field: FreeTransformField) => RANGES[field];
/** Applies a typed value; the link keeps the current W:H ratio. */
export function setFreeTransformField(field: FreeTransformField, value: number): boolean {
  const session = useFreeTransform.getState().session;
  if (!session || session.quad || !Number.isFinite(value) || value < RANGES[field][0] || value > RANGES[field][1]) return false;
  const { settings, linked } = session, next = { ...settings, [field]: value };
  if (linked && (field === "width" || field === "height")) {
    const other = field === "width" ? "height" : "width", scaled = settings[other] * value / settings[field];
    if (scaled < 1 || scaled > 1000) return false;
    next[other] = scaled;
  }
  patchFreeTransform({ settings: next });
  return true;
}
