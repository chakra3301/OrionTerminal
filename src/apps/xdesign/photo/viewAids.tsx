import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { EMPTY_LAYOUT, RULER_SIZE, documentGuides, gridSteps, gridVisible, guidesVisible, layoutGuides, rulerTicks, snapContext, snapValue, useViewAids, type Guide, type GuideAxis, type GuideLayout } from "./viewGuides";
import { NO_TURN, turnedSize, useViewTurn, type ViewTurn } from "./viewTurn";
import { unitsPerPixel, usePreferences, type GridStyle, type Preferences } from "./preferences";
import "./viewAids.css";

type View = { ox: number; oy: number; w: number; h: number; sx: number; sy: number };
type Drag = { id: number; axis: GuideAxis; pointer: number };
const NO_GUIDES: Guide[] = [];
// Guide and grid colours come from Preferences and are content colours, not chrome: they must read on any photo, so
// they ignore the theme. Subdivisions are the gridline colour, fainter.
const GRID_MAJOR = .6, GRID_MINOR = .28;
const DASHES: Record<GridStyle, number[]> = { lines: [], dashed: [4, 4], dots: [1, 3] };

function prepare(canvas: HTMLCanvasElement | null, width: number, height: number) {
  if (!canvas) return null;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  return ctx;
}

function drawRuler(canvas: HTMLCanvasElement | null, horizontal: boolean, view: View, zoom: number, scale: number) {
  const ctx = prepare(canvas, horizontal ? view.w : RULER_SIZE, horizontal ? RULER_SIZE : view.h);
  if (!ctx || !canvas) return;
  const origin = horizontal ? view.ox : view.oy, length = horizontal ? view.w : view.h, color = getComputedStyle(canvas).color || "#999";
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.font = "9px sans-serif"; ctx.lineWidth = 1; ctx.textBaseline = "top";
  ctx.beginPath();
  for (const tick of rulerTicks(-origin / zoom, (length - origin) / zoom, zoom, scale)) {
    const at = Math.round(origin + tick.pos * zoom) + 0.5, size = tick.level === 0 ? RULER_SIZE : tick.level === 1 ? 9 : 5;
    if (horizontal) { ctx.moveTo(at, RULER_SIZE); ctx.lineTo(at, RULER_SIZE - size); } else { ctx.moveTo(RULER_SIZE, at); ctx.lineTo(RULER_SIZE - size, at); }
    if (tick.label) {
      if (horizontal) ctx.fillText(tick.label, at + 3, 1);
      else { ctx.save(); ctx.translate(1, at - 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = "left"; ctx.fillText(tick.label, 0, 0); ctx.restore(); }
    }
  }
  ctx.stroke();
}

function drawContent(canvas: HTMLCanvasElement | null, view: View, zoom: number, resolution: number, grid: boolean, guides: readonly Guide[], turn: ViewTurn, size: [number, number], preferences: Pick<Preferences, "grid" | "guides" | "pointSize">) {
  const ctx = prepare(canvas, view.w, view.h);
  if (!ctx) return;
  let ox = view.ox, oy = view.oy, from = 0, to: [number, number] = [view.w, view.h];
  if (turn.angle || turn.flip) {
    // Turned like the image: drawn from the document's own top left, over a span that still crosses the view either way.
    const width = size[0] * zoom, height = size[1] * zoom, [outerWidth, outerHeight] = turnedSize(width, height, turn.angle), reach = Math.hypot(view.w, view.h) + Math.hypot(width, height);
    ctx.translate(view.ox + outerWidth / 2, view.oy + outerHeight / 2); ctx.rotate(turn.angle * Math.PI / 180); if (turn.flip) ctx.scale(-1, 1); ctx.translate(-width / 2, -height / 2);
    ox = oy = 0; from = -reach; to = [reach, reach];
  }
  const line = (axis: GuideAxis, pos: number, color: string, style: GridStyle, alpha = 1) => {
    const at = Math.round((axis === "v" ? ox : oy) + pos * zoom) + 0.5;
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.setLineDash(DASHES[style]); ctx.beginPath();
    if (axis === "v") { ctx.moveTo(at, from); ctx.lineTo(at, to[1]); } else { ctx.moveTo(from, at); ctx.lineTo(to[0], at); }
    ctx.stroke();
  };
  if (grid) {
    const { major, minor } = gridSteps(zoom, resolution, preferences);
    for (const axis of ["v", "h"] as const) {
      const origin = axis === "v" ? ox : oy, length = axis === "v" ? to[0] : to[1], step = minor ?? major;
      for (let i = Math.ceil((from - origin) / zoom / step), n = 0; origin + i * step * zoom <= length && n < 4000; i++, n++) {
        const pos = i * step, onMajor = Math.abs(pos / major - Math.round(pos / major)) < 1e-6;
        line(axis, pos, preferences.grid.color, preferences.grid.style, onMajor ? GRID_MAJOR : GRID_MINOR);
      }
    }
  }
  for (const guide of guides) line(guide.axis, guide.pos, preferences.guides.color, preferences.guides.style);
}

export function ViewAids({ stage, image, docId, width, height, zoom, resolution = 72, moveTool, onRulerMenu, onRulerDoubleClick }: { stage: RefObject<HTMLDivElement | null>; image: RefObject<HTMLDivElement | null>; docId: string; width: number; height: number; zoom: number; resolution?: number; moveTool: boolean; onRulerMenu?: (at: { x: number; y: number }) => void; onRulerDoubleClick?: () => void }) {
  const flags = useViewAids(state => state.flags), guides = useViewAids(state => state.documents[docId]) ?? NO_GUIDES;
  const rulerUnit = usePreferences(state => state.rulerUnit), pointSize = usePreferences(state => state.pointSize), gridPreference = usePreferences(state => state.grid), guidePreference = usePreferences(state => state.guides);
  // Rulers stay square to the screen and guides can't be dragged on a turned view; its grid and guides turn with the image.
  const turn = useViewTurn(state => state.turns[docId]) ?? NO_TURN, turned = turn.angle !== 0 || turn.flip;
  const [view, setView] = useState<View>({ ox: 0, oy: 0, w: 0, h: 0, sx: 0, sy: 0 });
  const [command, setCommand] = useState(false);
  const top = useRef<HTMLCanvasElement>(null), left = useRef<HTMLCanvasElement>(null), content = useRef<HTMLCanvasElement>(null);
  const markX = useRef<HTMLDivElement>(null), markY = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), frame = useRef(0);
  const showGuides = guidesVisible(flags), showGrid = gridVisible(flags), movable = showGuides && !flags.lockGuides && (moveTool || command) && !turned;

  const measure = () => {
    const stageEl = stage.current, imageEl = image.current;
    if (!stageEl || !imageEl) return;
    const s = stageEl.getBoundingClientRect(), i = imageEl.getBoundingClientRect();
    const next = { ox: i.left - s.left, oy: i.top - s.top, w: stageEl.clientWidth, h: stageEl.clientHeight, sx: stageEl.offsetLeft, sy: stageEl.offsetTop };
    setView(current => Object.keys(next).every(key => current[key as keyof View] === next[key as keyof View]) ? current : next);
  };
  useLayoutEffect(measure, [zoom, width, height, docId, flags.rulers, turn]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measure(); }); };
    const moveMarker = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      if (markX.current) markX.current.style.transform = `translateX(${event.clientX - box.left}px)`;
      if (markY.current) markY.current.style.transform = `translateY(${event.clientY - box.top}px)`;
    };
    const observer = new ResizeObserver(schedule); observer.observe(el);
    el.addEventListener("scroll", schedule); el.addEventListener("pointermove", moveMarker);
    return () => { observer.disconnect(); el.removeEventListener("scroll", schedule); el.removeEventListener("pointermove", moveMarker); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [stage, docId]);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setCommand(event.metaKey || event.ctrlKey), clear = () => setCommand(false);
    window.addEventListener("keydown", sync); window.addEventListener("keyup", sync); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", sync); window.removeEventListener("keyup", sync); window.removeEventListener("blur", clear); };
  }, []);

  useLayoutEffect(() => {
    if (!flags.rulers) return;
    drawRuler(top.current, true, view, zoom, unitsPerPixel(rulerUnit, resolution, pointSize, width));
    drawRuler(left.current, false, view, zoom, unitsPerPixel(rulerUnit, resolution, pointSize, height));
  }, [flags.rulers, view, zoom, rulerUnit, resolution, pointSize, width, height]);
  useLayoutEffect(() => {
    drawContent(content.current, view, zoom, resolution, showGrid, showGuides ? guides : NO_GUIDES, turn, [width, height], { grid: gridPreference, guides: guidePreference, pointSize });
  }, [view, zoom, resolution, showGrid, showGuides, guides, turn, width, height, gridPreference, guidePreference, pointSize]);

  const docPosition = (event: ReactPointerEvent, axis: GuideAxis) => {
    const box = image.current?.getBoundingClientRect();
    return box ? ((axis === "h" ? event.clientY - box.top : event.clientX - box.left) / zoom) : 0;
  };
  const begin = (event: ReactPointerEvent, id: number, axis: GuideAxis) => {
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    drag.current = { id, axis, pointer: event.pointerId ?? 1 };
  };
  const move = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || current.pointer !== (event.pointerId ?? 1)) return;
    const raw = docPosition(event, current.axis), ctx = snapContext(docId, width, height, zoom, resolution);
    useViewAids.getState().moveGuide(docId, current.id, Math.round(ctx ? snapValue(current.axis, raw, { ...ctx, guides: documentGuides(docId) }, current.id) : raw));
  };
  const end = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || current.pointer !== (event.pointerId ?? 1)) return;
    drag.current = null;
    const box = stage.current?.getBoundingClientRect(), edge = flags.rulers ? RULER_SIZE : 0;
    // Releasing on a ruler, or outside the view, throws the guide away.
    if (box && (current.axis === "h" ? event.clientY < box.top + edge : event.clientX < box.left + edge)) useViewAids.getState().deleteGuide(docId, current.id);
  };
  const fromRuler = (event: ReactPointerEvent, horizontal: boolean) => {
    if (event.button !== 0 || flags.lockGuides || turned) return;
    // Alt switches orientation: the top ruler then yields a vertical guide.
    const axis: GuideAxis = horizontal !== event.altKey ? "h" : "v";
    begin(event, useViewAids.getState().newGuide(docId, axis, Math.round(docPosition(event, axis))), axis);
    move(event);
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  // As in Photoshop: right-click a ruler for its units, double-click it for Units & Rulers.
  const rulerHandlers = { onContextMenu: (event: ReactMouseEvent) => { event.preventDefault(); onRulerMenu?.({ x: event.clientX, y: event.clientY }); }, onDoubleClick: onRulerDoubleClick };

  return <div className="xd-view-aids" aria-hidden={!flags.rulers && !movable ? true : undefined}>
    <div className="xd-view-frame" style={{ left: view.sx, top: view.sy, width: view.w, height: view.h }}>
      <canvas ref={content} className="xd-view-content" style={{ width: view.w, height: view.h }}/>
      {movable && guides.map(guide => <div key={guide.id} className="xd-view-guide-hit" data-guide={guide.id} data-axis={guide.axis}
        style={guide.axis === "h" ? { left: 0, width: view.w, top: view.oy + guide.pos * zoom - 3, height: 7, cursor: "ns-resize" } : { top: 0, height: view.h, left: view.ox + guide.pos * zoom - 3, width: 7, cursor: "ew-resize" }}
        onPointerDown={event => { if (event.button === 0) begin(event, guide.id, guide.axis); }} {...handlers}/>)}
      {flags.rulers && <>
        <canvas ref={top} className="xd-view-ruler is-top" aria-label="Horizontal ruler" style={{ width: view.w, height: RULER_SIZE }} onPointerDown={event => fromRuler(event, true)} {...handlers} {...rulerHandlers}/>
        <canvas ref={left} className="xd-view-ruler is-left" aria-label="Vertical ruler" style={{ width: RULER_SIZE, height: view.h }} onPointerDown={event => fromRuler(event, false)} {...handlers} {...rulerHandlers}/>
        <div className="xd-view-corner" style={{ width: RULER_SIZE, height: RULER_SIZE }}/>
        <div ref={markX} className="xd-view-marker is-x" style={{ height: RULER_SIZE }}/>
        <div ref={markY} className="xd-view-marker is-y" style={{ width: RULER_SIZE }}/>
      </>}
    </div>
  </div>;
}

const Field = ({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) => <label className="xd-ps-dialog-field"><span>{label}:</span>{children}<span className="xd-ps-dialog-unit">{unit ?? ""}</span></label>;

function NewGuideDialog({ docId, width, height, close }: { docId: string; width: number; height: number; close: () => void }) {
  const [axis, setAxis] = useState<GuideAxis>("v"), [text, setText] = useState("0");
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const pos = Number(text), limit = axis === "v" ? width : height, valid = text.trim() !== "" && Number.isFinite(pos) && pos >= 0 && pos <= limit;
  return <PhotoDialog dialog={dialog} title="New Guide" close={close} okDisabled={!valid} onSubmit={event => { event.preventDefault(); if (!valid) return; useViewAids.getState().newGuide(docId, axis, pos); close(); }}>
    <fieldset className="xd-ps-dialog-group"><legend>Orientation</legend>
      <label className="xd-ps-dialog-check"><input type="radio" name="guide-orientation" aria-label="Horizontal" checked={axis === "h"} onChange={() => setAxis("h")}/>Horizontal</label>
      <label className="xd-ps-dialog-check"><input type="radio" name="guide-orientation" aria-label="Vertical" checked={axis === "v"} onChange={() => setAxis("v")}/>Vertical</label>
    </fieldset>
    <div className="xd-ps-dialog-grid"><Field label="Position" unit="px"><input type="number" step="any" aria-label="Position" value={text} onChange={event => setText(event.target.value)}/></Field></div>
  </PhotoDialog>;
}

type Draft = Record<string, string>;
const LAYOUT_KEYS = ["columns.number", "columns.size", "columns.gutter", "rows.number", "rows.size", "rows.gutter", "margin.top", "margin.left", "margin.bottom", "margin.right"] as const;

function LayoutDialog({ docId, width, height, close }: { docId: string; width: number; height: number; close: () => void }) {
  const [draft, setDraft] = useState<Draft>({}), [center, setCenter] = useState(false), [clear, setClear] = useState(false);
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const value = (key: string) => { const n = Number(draft[key]); return Number.isFinite(n) && n > 0 ? n : 0; };
  const layout: GuideLayout = { ...EMPTY_LAYOUT, columns: { number: value("columns.number"), size: value("columns.size"), gutter: value("columns.gutter") }, rows: { number: value("rows.number"), size: value("rows.size"), gutter: value("rows.gutter") }, margin: { top: value("margin.top"), left: value("margin.left"), bottom: value("margin.bottom"), right: value("margin.right") }, center, clear };
  const input = (key: (typeof LAYOUT_KEYS)[number], label: string) => <input type="number" min="0" step="any" aria-label={label} value={draft[key] ?? ""} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}/>;
  return <PhotoDialog dialog={dialog} title="New Guide Layout" close={close} onSubmit={event => { event.preventDefault(); useViewAids.getState().addGuides(docId, layoutGuides(layout, width, height), clear); close(); }}>
    <fieldset className="xd-ps-dialog-group"><legend>Columns</legend><div className="xd-ps-dialog-grid">
      <Field label="Number">{input("columns.number", "Columns number")}</Field><Field label="Width" unit="px">{input("columns.size", "Columns width")}</Field><Field label="Gutter" unit="px">{input("columns.gutter", "Columns gutter")}</Field>
    </div></fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Rows</legend><div className="xd-ps-dialog-grid">
      <Field label="Number">{input("rows.number", "Rows number")}</Field><Field label="Height" unit="px">{input("rows.size", "Rows height")}</Field><Field label="Gutter" unit="px">{input("rows.gutter", "Rows gutter")}</Field>
    </div></fieldset>
    <fieldset className="xd-ps-dialog-group"><legend>Margin</legend><div className="xd-ps-dialog-grid">
      <Field label="Top" unit="px">{input("margin.top", "Margin top")}</Field><Field label="Left" unit="px">{input("margin.left", "Margin left")}</Field><Field label="Bottom" unit="px">{input("margin.bottom", "Margin bottom")}</Field><Field label="Right" unit="px">{input("margin.right", "Margin right")}</Field>
    </div></fieldset>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Center Columns" checked={center} onChange={event => setCenter(event.target.checked)}/>Center Columns</label>
    <label className="xd-ps-dialog-check"><input type="checkbox" aria-label="Clear Existing Guides" checked={clear} onChange={event => setClear(event.target.checked)}/>Clear Existing Guides</label>
  </PhotoDialog>;
}

export function GuideDialogs({ docId, width, height }: { docId: string; width: number; height: number }) {
  const dialog = useViewAids(state => state.dialog), close = () => useViewAids.getState().setDialog(null);
  if (dialog === "new") return <NewGuideDialog key={docId} docId={docId} width={width} height={height} close={close}/>;
  if (dialog === "layout") return <LayoutDialog key={docId} docId={docId} width={width} height={height} close={close}/>;
  return null;
}
