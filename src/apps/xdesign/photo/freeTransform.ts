import { create } from "zustand";
import { holdImageGesture, runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { identityTransform, layerFrame, pivotTransform, transformHandle, transformMatrix, type Bounds, type Quad, type TransformSettings } from "./transformMath";
import type { PhotoDocument, PhotoLayer } from "./types";
import { historyId } from "./selectAndMask";

export type { Quad };
/** Edit ▸ Transform entries; Free Transform (⌘T) is "free". */
export type TransformMode = "free" | "scale" | "rotate" | "skew" | "distort" | "perspective";
export type Interpolation = "bicubic" | "bilinear" | "nearest";
export const INTERPOLATIONS: [Interpolation, string][] = [["nearest", "Nearest Neighbor"], ["bilinear", "Bilinear"], ["bicubic", "Bicubic"]];
/** A box point in -1..1 per axis; [0, 0] is the centre. */
export type ReferencePoint = [number, number];
/** Earlier steps of one transform session that its commit merges into one History step. */
export type HistoryFold = { fromId: string; label: string };
export type FreeTransformSession = { documentId: string; layerId: number; version: string; viewKey: string | undefined; mode: TransformMode; bounds: Bounds; settings: TransformSettings; quad: Quad | null; interpolation: Interpolation; linked: boolean; preview: string | null; reference: ReferencePoint; fold?: HistoryFold };
export const TRANSFORM_REFERENCE_KEY = "orion.xdesign.transform-reference-point.v1";
export function loadShowReference(): boolean {
  try { return localStorage.getItem(TRANSFORM_REFERENCE_KEY) === "1"; } catch { return false; }
}
/** `held` is the committed session while its preview stands in for the image, so the box stays where it was dropped. */
export const useFreeTransform = create<{ session: FreeTransformSession | null; held: FreeTransformSession | null; showReference: boolean }>(() => ({ session: null, held: null, showReference: loadShowReference() }));
let release: (() => void) | null = null;

/** The gesture hold stays for the whole session so nothing else edits the document meanwhile. */
export function beginFreeTransform(document: PhotoDocument, layer: PhotoLayer, viewKey: string | undefined, mode: TransformMode = "free", fold?: HistoryFold): boolean {
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
  useFreeTransform.setState({ session: { documentId: document.id, layerId: layer.id, version: document.version, viewKey, mode, bounds, settings: identityTransform(bounds), quad: null, interpolation: "bicubic", linked: true, preview: null, reference: [0, 0], fold } });
  return true;
}
export const patchFreeTransform = (patch: Partial<Pick<FreeTransformSession, "settings" | "quad" | "interpolation" | "linked" | "preview" | "mode" | "reference">>) =>
  useFreeTransform.setState(state => state.session ? { session: { ...state.session, ...patch } } : state);
export function cancelFreeTransform() {
  release?.(); release = null;
  if (useFreeTransform.getState().session) useFreeTransform.setState({ session: null });
}
/** Esc and Cancel end the whole session, so a Warp applied within it is undone too. */
export function discardFreeTransform() {
  const fold = useFreeTransform.getState().session?.fold;
  cancelFreeTransform();
  if (fold && historyId(usePhotoWorkspace.getState().state) !== fold.fromId) void runPhotoCommand("history.select", { id: fold.fromId, discardRedo: true }).catch(() => {});
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
  const work = runPhotoCommand("edit.transform", params).then(result => session.fold ? runPhotoCommand("history.fold", session.fold) : result);
  useFreeTransform.setState({ session: null, held: session.preview ? session : null });
  void untilShown(work).catch(() => {}).then(() => useFreeTransform.setState({ held: null }));
  return work;
}

/** Photoshop's switch to Warp: a changed box is committed first and Warp opens on the shown result; a failed commit stays out of Warp. */
export function switchFreeTransformToWarp(untilShown: (work: Promise<unknown>) => Promise<unknown>, warp: (fold?: HistoryFold) => void): Promise<void> {
  const fold = useFreeTransform.getState().session?.fold, id = historyId(usePhotoWorkspace.getState().state);
  const work = commitFreeTransform(untilShown);
  if (!work) { warp(fold); return Promise.resolve(); }
  const next = fold ?? (id === null ? undefined : { fromId: id, label: "Free Transform" });
  return work.then(() => untilShown(work)).then(() => warp(next), () => {});
}

export function setShowReference(on: boolean) {
  useFreeTransform.setState({ showReference: on });
  try { localStorage.setItem(TRANSFORM_REFERENCE_KEY, on ? "1" : "0"); } catch { /* The choice stays for this session when storage is unavailable. */ }
}
/** Where the box pivots: the chosen reference point while it is shown, else the centre. A distorted box has no settings to pivot. */
export const referencePoint = (session: FreeTransformSession, shown: boolean): ReferencePoint => shown && !session.quad ? session.reference : [0, 0];
/** X and Y read and place the reference point, as in Photoshop. */
export function freeTransformValue(session: FreeTransformSession, shown: boolean, field: FreeTransformField): number {
  if (field !== "x" && field !== "y") return session.settings[field];
  const [rx, ry] = referencePoint(session, shown);
  return transformHandle(session.bounds, session.settings, rx, ry)[field === "x" ? 0 : 1];
}

const RANGES = { x: [-1_000_000, 1_000_000], y: [-1_000_000, 1_000_000], width: [1, 1000], height: [1, 1000], angle: [-3600, 3600], skewX: [-85, 85], skewY: [-85, 85] } as const;
export type FreeTransformField = keyof typeof RANGES;
export const freeTransformRange = (field: FreeTransformField) => RANGES[field];
/** Applies a typed value about the reference point; the link keeps the current W:H ratio. */
export function setFreeTransformField(field: FreeTransformField, value: number): boolean {
  const { session, showReference } = useFreeTransform.getState();
  if (!session || session.quad || !Number.isFinite(value) || value < RANGES[field][0] || value > RANGES[field][1]) return false;
  const { settings, linked } = session;
  if (field === "x" || field === "y") {
    patchFreeTransform({ settings: { ...settings, [field]: settings[field] + value - freeTransformValue(session, showReference, field) } });
    return true;
  }
  const next = { ...settings, [field]: value };
  if (linked && (field === "width" || field === "height")) {
    const other = field === "width" ? "height" : "width", scaled = settings[other] * value / settings[field];
    if (scaled < 1 || scaled > 1000) return false;
    next[other] = scaled;
  }
  patchFreeTransform({ settings: pivotTransform(session.bounds, settings, next, referencePoint(session, showReference)) });
  return true;
}
