import { useEffect, useRef, useState, type PointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PhotoDocument } from "./types";
import type { PaintOptions } from "./PaintToolOptions";
import { MagneticDraft, magneticWidth, type MagneticPoint, type MagneticSettings, type MagneticSnapshot, type MagneticTrace } from "./magneticLasso";
import { selectionGestureMode, type SelectionMode } from "./selectionGesture";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { beginXDesignActivity } from "../runtimeActivity";
import { isDesignDialogOpen } from "../useDesignDialog";

const empty: MagneticSnapshot = { points: [], anchors: [], pending: false, snapped: false, error: null };
type Key = {key: string; target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void; isComposing?: boolean; nativeEvent?: {isComposing: boolean}};
export function MagneticLassoOverlay({ document, projectId, viewKey, options, mode, zoom, ready, changeWidth }: { document: PhotoDocument; projectId: string | null; viewKey?: string; options: PaintOptions; mode: string; zoom: number; ready: boolean; changeWidth: (width: number) => void }) {
  const supported = usePhotoWorkspace(s => s.state?.features?.magneticLasso === true);
  const svg = useRef<SVGSVGElement>(null), draft = useRef<MagneticDraft | null>(null), end = useRef<(() => void) | null>(null);
  const selectedMode = useRef<SelectionMode>("replace"), alive = useRef(true), closing = useRef(false);
  const action = useRef<Promise<void> | null>(null), altDrag = useRef<{ id: number; points: MagneticPoint[] } | null>(null);
  const [snapshot, setSnapshot] = useState(empty), [cursor, setCursor] = useState<MagneticPoint | null>(null), [showWidth, setShowWidth] = useState(false), [applying, setApplying] = useState(false);
  const keyHandler = useRef<(event: Key) => void>(() => {});
  const settings = (pressure = 0): MagneticSettings => ({ width: magneticWidth(Number(options.width ?? 10), pressure, options.stylusPressure === true), contrast: Number(options.contrast ?? 10), frequency: Number(options.frequency ?? 57) });
  useEffect(() => { draft.current?.configure(settings()); }, [options.width, options.contrast, options.frequency, options.stylusPressure]);
  const release = () => { const finish = end.current; end.current = null; finish?.(); };
  const reset = () => { draft.current?.dispose(); draft.current = null; altDrag.current = null; action.current = null; release(); if (alive.current) setSnapshot(empty); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; reset(); }; }, []);
  const point = (event: { clientX: number; clientY: number }): MagneticPoint | null => {
    const bounds = svg.current?.getBoundingClientRect(); if (!bounds?.width || !bounds.height) return null;
    return [Math.max(0, Math.min(document.width, (event.clientX - bounds.left) * document.width / bounds.width)), Math.max(0, Math.min(document.height, (event.clientY - bounds.top) * document.height / bounds.height))];
  };
  const manual = (p: MagneticPoint, points?: MagneticPoint[]) => {
    const current = draft.current; if (!current || closing.current) return;
    const pending = current.fasten(p, points); action.current = pending;
    void pending.finally(() => { if (action.current === pending) action.current = null; });
  };
  const finish = async () => {
    if (closing.current || !draft.current || altDrag.current) return;
    closing.current = true; setApplying(true);
    try {
      await action.current;
      const current = draft.current; if (!current || !alive.current) return;
      const points = await current.outline();
      if (!points || !alive.current || current !== draft.current) return;
      const workspace = usePhotoWorkspace.getState();
      if (workspace.documentId !== document.id || workspace.stateVersion !== document.version || workspace.state?.viewKey !== viewKey) throw new Error("The image view changed; cancel this outline and trace the current image.");
      try { await runPhotoCommand("select.xdesignMagneticLasso", { points, mode: selectedMode.current, feather: options.feather ?? 0, antiAlias: options.antiAlias !== false }); reset(); }
      catch (error) { if (alive.current && draft.current) setSnapshot(s => ({ ...s, error: String(error) })); }
    } catch (error) { if (alive.current) setSnapshot(s => ({ ...s, error: String(error) })); }
    finally { closing.current = false; if (alive.current) setApplying(false); }
  };
  const key = (event: Key) => {
    if (isDesignDialogOpen() || event.nativeEvent?.isComposing || event.isComposing || (event.target as HTMLElement).closest?.("input,select,textarea,[contenteditable]")) return;
    if (event.key === "Enter" && (event.target as HTMLElement).closest?.("button")) return;
    if (!["Escape", "Enter", "Backspace", "Delete", "[", "]", "CapsLock"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (closing.current) return;
    if (event.key === "Escape") { reset(); return; }
    if (event.key === "Enter") { void finish(); return; }
    if (event.key === "Backspace" || event.key === "Delete") { draft.current?.undo(); return; }
    if (event.key === "CapsLock") { if (!draft.current) setShowWidth(v => !v); return; }
    changeWidth(Math.max(1, Math.min(256, Number(options.width ?? 10) + (event.key === "]" ? 1 : -1))));
  };
  keyHandler.current = key;
  useEffect(() => {
    const editor = svg.current?.closest(".xd-photo");
    const listener = (event: Event) => { if (draft.current) keyHandler.current(event as globalThis.KeyboardEvent); };
    editor?.addEventListener("keydown", listener, true);
    return () => editor?.removeEventListener("keydown", listener, true);
  }, []);
  const begin = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    if (event.button !== 0 || isDesignDialogOpen() || !supported || !ready || !viewKey || !projectId || !isTauri() || closing.current) return;
    const p = point(event); if (!p) return; setCursor(p);
    if (!draft.current) {
      if (usePhotoWorkspace.getState().busy) return;
      selectedMode.current = selectionGestureMode(mode, event, "magneticLasso");
      draft.current = new MagneticDraft(p, settings(event.pointerType === "pen" ? event.pressure : 0), request => invoke<MagneticTrace>("xdesign_photo_magnetic_trace", { projectId, photoId: document.id, version: document.version, viewKey, params: request }), setSnapshot);
      end.current = beginXDesignActivity("photo-operation", "Close or cancel the magnetic selection before switching projects."); setSnapshot(draft.current.snapshot); return;
    }
    if (draft.current.locked) return;
    const first = draft.current.snapshot.anchors[0]!;
    if (event.ctrlKey || event.metaKey) { manual(p, event.altKey ? [p] : undefined); void finish(); return; }
    if (draft.current.snapshot.points.length >= 3 && Math.hypot((p[0] - first[0]) * zoom, (p[1] - first[1]) * zoom) <= 6) { manual(first, event.altKey ? [first] : undefined); void finish(); return; }
    if (event.altKey) { altDrag.current = { id: event.pointerId, points: [p] }; draft.current.previewManual([p]); event.currentTarget.setPointerCapture?.(event.pointerId); return; }
    manual(p);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    event.stopPropagation(); const p = point(event); if (!p) return; setCursor(p);
    const current = draft.current; if (!current || current.locked || closing.current || isDesignDialogOpen()) return;
    if (altDrag.current?.id === event.pointerId) {
      const drag = altDrag.current;
      const samples = event.nativeEvent.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event.nativeEvent]) { const next = point(sample); if (next && drag.points.length < 8192) drag.points.push(next); }
      current.previewManual(drag.points); return;
    }
    if (event.altKey) { current.previewManual([p]); return; }
    current.configure(settings(event.pointerType === "pen" ? event.pressure : 0));
    const samples = event.nativeEvent.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event.nativeEvent]) { const next = point(sample); if (next) current.move(next); }
  };
  const up = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const drag = altDrag.current; if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); altDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) draft.current?.previewManual([]); else { const p = point(event) ?? drag.points.at(-1)!; manual(p, drag.points); }
  };
  const path = snapshot.points.map(p => p.join(",")).join(" ");
  return <div className="xd-photo-magnetic-overlay" onKeyDown={key}>
    <svg ref={svg} role="img" aria-label="Magnetic lasso canvas" tabIndex={0} className={showWidth ? "xd-photo-magnetic-canvas precise" : "xd-photo-magnetic-canvas"} viewBox={`0 0 ${document.width} ${document.height}`} onPointerDown={begin} onPointerMove={move} onPointerUp={event => up(event)} onPointerCancel={event => up(event, true)} onLostPointerCapture={event => { if (altDrag.current?.id === event.pointerId) up(event, true); }} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); void finish(); }}>
      <polyline className="xd-photo-magnetic-outline" points={path} fill="none" vectorEffect="non-scaling-stroke" />
      {snapshot.anchors.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3 / zoom} className="xd-photo-magnetic-anchor" vectorEffect="non-scaling-stroke" />)}
      {cursor && showWidth && <circle cx={cursor[0]} cy={cursor[1]} r={Number(options.width ?? 10) / 2} className="xd-photo-magnetic-width" fill="none" vectorEffect="non-scaling-stroke" />}
    </svg>
    <div className="xd-photo-magnetic-controls" role="toolbar" aria-label="Magnetic lasso draft">
      {!supported || !isTauri() ? <span role="alert">Magnetic lasso requires an updated native engine.</span> : !snapshot.anchors.length ? <span>Click to start. Trace an edge; click to anchor. Alt-drag draws freely.</span> : <>
        <span role="status">{applying ? "Closing selection…" : snapshot.pending ? "Following edge…" : snapshot.snapped ? "Edge found" : "Trace the outline"} · {snapshot.anchors.length} anchors</span>
        <button type="button" disabled={applying} onClick={() => draft.current?.undo()}>Remove anchor</button><button type="button" disabled={applying} onClick={reset}>Cancel</button><button type="button" disabled={applying || snapshot.points.length < 3} onClick={() => { void finish(); }}>Close selection</button>
      </>}
      {snapshot.error && <span role="alert">{snapshot.error}</span>}
    </div>
  </div>;
}
