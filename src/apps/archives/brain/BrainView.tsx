/** Brain — the automatic knowledge graph over everything in Orion Terminal.
 * Notes, journal entries, projects, chats, media, mood boards, tags and
 * collections become nodes; wikilinks, hierarchy, tags, board membership,
 * title mentions and semantic-embedding similarity become edges — no manual
 * linking required.
 *
 * Rendered as a monochrome annotation wireframe (owner reference, 2026-10-12):
 * hairline links ending in hollow junctions, mono labels in ruled boxes for
 * hubs, small type markers for everything else, faint construction geometry
 * behind. Ink follows the theme's text color — no neon, no glow. A 3D force
 * layout under a slow orbital camera gives depth. Drag empty space to orbit,
 * wheel to zoom, drag a node to move it. Click a node → detail rail with its
 * connections, Open, and Ask Claude (routes into the live Archives chat). */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RefreshCw, Search, Sparkles, ExternalLink, X } from "lucide-react";
import { useArchives } from "@/apps/archives/useArchives";
import { openChatById } from "@/apps/archives/searchNav";
import { sendToArchivesChat } from "@/apps/archives/chatBridge";
import { useBrainGraph } from "@/apps/archives/brain/useBrainGraph";
import {
  neighborsOf,
  type BrainGraph,
  type BrainNode,
  type BrainNodeType,
} from "@/apps/archives/brain/graphBuild";
import {
  initialPosition,
  stepLayout,
  type LayoutEdge,
  type LayoutNode,
} from "@/apps/archives/brain/forceLayout";
import { log } from "@/lib/log";

type MarkerShape = "circle" | "ring" | "square" | "diamond" | "dot";

/** Monochrome identity: type reads from marker shape and a mono suffix. */
const TYPE_MARKER: Record<BrainNodeType, MarkerShape> = {
  note: "circle",
  journal: "ring",
  project: "square",
  chat: "diamond",
  asset: "square",
  board: "square",
  tag: "dot",
  collection: "dot",
};

const TYPE_SUFFIX: Record<BrainNodeType, string> = {
  note: ".note",
  journal: ".journal",
  project: ".project",
  chat: ".chat",
  asset: ".media",
  board: ".board",
  tag: ".tag",
  collection: ".set",
};

const TYPE_LABEL: Record<BrainNodeType, string> = {
  note: "Notes",
  journal: "Journal",
  project: "Projects",
  chat: "Chats",
  asset: "Media",
  board: "Boards",
  tag: "Tags",
  collection: "Collections",
};

const ALL_TYPES: BrainNodeType[] = [
  "note",
  "journal",
  "project",
  "chat",
  "asset",
  "board",
  "tag",
  "collection",
];

const EDGE_SPRING: Record<string, number> = {
  wikilink: 1,
  parent: 1,
  board: 0.6,
  collection: 0.4,
  tag: 0.4,
  mention: 0.5,
  semantic: 0.55,
};

/** Perspective focal length — matches the core's tight fov feel. */
const FOCAL = 900;
const TAU = Math.PI * 2;

function radiusFor(n: BrainNode): number {
  const base = n.type === "tag" || n.type === "collection" ? 4 : 5.5;
  return base + Math.min(11, Math.sqrt(n.degree) * 1.9);
}

/** Route "open this node" to the right surface, same rules as global search. */
function openNode(n: BrainNode) {
  const a = useArchives.getState();
  switch (n.type) {
    case "journal":
      a.setView("journal");
      a.setSelectedNoteId(n.refId);
      break;
    case "project":
      a.setView("projects");
      a.setOpenProjectId(n.refId);
      break;
    case "note":
      a.setView("notes");
      a.setOpenNoteId(n.refId);
      break;
    case "chat":
      void openChatById(n.refId).catch((e) => log.warn("brain openChat failed", e));
      break;
    case "asset":
      a.setView("media");
      a.setPreviewingAssetId(n.refId);
      break;
    case "board":
      a.setView("mood");
      a.setOpenBoardId(n.refId);
      break;
    case "tag":
      a.setSelectedTag(n.refId);
      a.setView("notes");
      break;
    case "collection":
      a.setSelectedCollectionId(n.refId);
      a.setView("notes");
      break;
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  s: number,
) {
  ctx.beginPath();
  switch (shape) {
    case "circle":
      ctx.arc(x, y, s, 0, TAU);
      ctx.stroke();
      return;
    case "ring":
      ctx.arc(x, y, s, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.7, s * 0.32), 0, TAU);
      ctx.fill();
      return;
    case "square":
      ctx.rect(Math.round(x - s) + 0.5, Math.round(y - s) + 0.5, Math.round(s * 2), Math.round(s * 2));
      ctx.stroke();
      return;
    case "diamond":
      ctx.moveTo(x, y - s * 1.2);
      ctx.lineTo(x + s * 1.2, y);
      ctx.lineTo(x, y + s * 1.2);
      ctx.lineTo(x - s * 1.2, y);
      ctx.closePath();
      ctx.stroke();
      return;
    case "dot":
      ctx.arc(x, y, Math.max(1, s * 0.55), 0, TAU);
      ctx.fill();
      return;
  }
}

/** Where the segment from a box's center toward (tx, ty) leaves the box. */
function exitPoint(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  tx: number,
  ty: number,
): [number, number] | null {
  const dx = tx - cx;
  const dy = ty - cy;
  const t = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );
  if (t >= 1) return null;
  return [cx + dx * t, cy + dy * t];
}

/** Resolve any CSS color the theme hands us to an "r, g, b" triplet. */
function inkTriplet(ctx: CanvasRenderingContext2D, css: string): string {
  ctx.fillStyle = "#000";
  ctx.fillStyle = css.trim() || "#e6f4ec";
  const v = ctx.fillStyle;
  if (v.startsWith("#")) {
    const n = parseInt(v.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const m = v.match(/[\d.]+/g);
  return m && m.length >= 3 ? `${m[0]}, ${m[1]}, ${m[2]}` : "230, 244, 236";
}

export function BrainView() {
  const { graph, loading, refresh } = useBrainGraph();
  const [query, setQuery] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<BrainNodeType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Filtered graph (type chips) ─────────────────────────────────────
  const visible = useMemo<BrainGraph>(() => {
    if (hiddenTypes.size === 0) return graph;
    const nodes = graph.nodes.filter((n) => !hiddenTypes.has(n.type));
    const keep = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => keep.has(e.a) && keep.has(e.b));
    return { nodes, edges };
  }, [graph, hiddenTypes]);

  const nodeById = useMemo(
    () => new Map(visible.nodes.map((n) => [n.id, n])),
    [visible],
  );

  const matchIds = useMemo<Set<string> | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      visible.nodes
        .filter((n) => n.label.toLowerCase().includes(q))
        .map((n) => n.id),
    );
  }, [visible, query]);

  // ── Mutable sim + camera state (refs — the rAF loop owns them) ──────
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<{
    nodes: LayoutNode[];
    edges: LayoutEdge[];
    byId: Map<string, number>;
  }>({ nodes: [], edges: [], byId: new Map() });
  const alphaRef = useRef(1);
  const camRef = useRef({ rx: -0.28, ry: 0.4, zoom: 1, lastInteract: 0, userZoomed: false });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<
    | { mode: "orbit"; sx: number; sy: number; orx: number; ory: number; moved: boolean }
    | { mode: "node"; index: number; camZ: number; moved: boolean }
    | null
  >(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const matchRef = useRef<Set<string> | null>(null);
  matchRef.current = matchIds;
  const boxesRef = useRef<Float32Array>(new Float32Array(0));
  const hubOrder = useMemo(
    () => [...visible.nodes].sort((a, b) => b.degree - a.degree).map((n) => n.id),
    [visible],
  );
  const hubOrderRef = useRef(hubOrder);
  hubOrderRef.current = hubOrder;
  const nodeIndexRef = useRef(nodeById);
  nodeIndexRef.current = nodeById;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // ── Sync graph → sim (preserve positions across rebuilds) ───────────
  useEffect(() => {
    const sim = simRef.current;
    const prev = new Map(sim.nodes.map((n) => [n.id, n]));
    const nodes: LayoutNode[] = visible.nodes.map((n) => {
      const old = prev.get(n.id);
      if (old) return { ...old, r: radiusFor(n) };
      const p = initialPosition(n.id);
      return {
        id: n.id,
        x: p.x,
        y: p.y,
        z: p.z,
        vx: 0,
        vy: 0,
        vz: 0,
        r: radiusFor(n),
        fx: null,
        fy: null,
        fz: null,
      };
    });
    const byId = new Map(nodes.map((n, i) => [n.id, i]));
    const edges: LayoutEdge[] = [];
    for (const e of visible.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (a == null || b == null) continue;
      edges.push({ a, b, weight: EDGE_SPRING[e.kind] ?? 0.5 });
    }
    simRef.current = { nodes, edges, byId };
    alphaRef.current = Math.max(alphaRef.current, 0.6);
  }, [visible]);

  // ── Render + simulation loop ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    // Projected scratch buffer: [sx, sy, persp] per node.
    let proj = new Float32Array(0);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    /** World → camera space (rotate Y then X). Returns [x1, y2, z2]. */
    const cam = camRef.current;
    const toCamera = (
      x: number,
      y: number,
      z: number,
      out: [number, number, number],
    ) => {
      const cy = Math.cos(cam.ry);
      const sy = Math.sin(cam.ry);
      const cx = Math.cos(cam.rx);
      const sx = Math.sin(cam.rx);
      const x1 = cy * x + sy * z;
      const z1 = -sy * x + cy * z;
      out[0] = x1;
      out[1] = cx * y - sx * z1;
      out[2] = sx * y + cx * z1;
    };
    /** Camera space → world (inverse rotations). */
    const toWorldFromCamera = (
      x1: number,
      y2: number,
      z2: number,
      out: [number, number, number],
    ) => {
      const cy = Math.cos(cam.ry);
      const sy = Math.sin(cam.ry);
      const cx = Math.cos(cam.rx);
      const sx = Math.sin(cam.rx);
      const y = cx * y2 + sx * z2;
      const z1 = -sx * y2 + cx * z2;
      out[0] = cy * x1 - sy * z1;
      out[1] = y;
      out[2] = sy * x1 + cy * z1;
    };

    const scratch: [number, number, number] = [0, 0, 0];
    const projectAll = () => {
      const { nodes } = simRef.current;
      if (proj.length < nodes.length * 3) proj = new Float32Array(nodes.length * 3);
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i]!;
        toCamera(nd.x, nd.y, nd.z, scratch);
        const persp = FOCAL / Math.max(80, FOCAL + scratch[2]);
        proj[i * 3] = w / 2 + scratch[0] * persp * cam.zoom;
        proj[i * 3 + 1] = h / 2 + scratch[1] * persp * cam.zoom;
        proj[i * 3 + 2] = persp;
      }
    };

    /** Depth cue 0..1 from perspective scale. */
    const depthT = (persp: number) =>
      Math.min(1, Math.max(0, (persp - 0.68) / 0.75));

    // Ink follows the theme; re-read about once a second so theme switches land.
    const readInk = () => {
      const cs = getComputedStyle(container);
      ink = inkTriplet(ctx, cs.getPropertyValue("--t-primary"));
      paper = inkTriplet(ctx, cs.getPropertyValue("--bg-0"));
    };
    let ink = "";
    let paper = "";
    readInk();
    let inkReadAt = 0;
    const stroke = (a: number) => `rgba(${ink}, ${a})`;

    // Label boxes per node index: [cx, cy, halfW, halfH]; halfW < 0 = no box.
    let boxes = new Float32Array(0);
    const textWidth = new Map<string, number>();
    const measure = (font: string, text: string) => {
      const key = `${font}|${text}`;
      let v = textWidth.get(key);
      if (v == null) {
        ctx.font = font;
        v = ctx.measureText(text).width;
        if (textWidth.size > 4000) textWidth.clear();
        textWidth.set(key, v);
      }
      return v;
    };

    /** Faint drafting geometry, fixed to the viewport like a printed sheet. */
    const drawConstruction = () => {
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke(0.07);
      ctx.beginPath();
      ctx.arc(w * 0.8, h * 0.08, Math.max(w, h) * 0.3, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = stroke(0.05);
      ctx.beginPath();
      ctx.arc(w * 0.06, h * 1.02, Math.min(w, h) * 0.52, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, h * 0.22);
      ctx.lineTo(w, -h * 0.04);
      ctx.moveTo(w * 0.1, h);
      ctx.lineTo(w * 0.78, 0);
      ctx.stroke();
      ctx.fillStyle = stroke(0.16);
      for (const [x, y] of [[w * 0.8, h * 0.08], [w * 0.06, h * 1.02]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, TAU);
        ctx.fill();
      }
    };

    const drawBrackets = (cx: number, cy: number, hw: number, hh: number, a: number) => {
      const l = Math.round(cx - hw) - 3.5;
      const r = Math.round(cx + hw) + 3.5;
      const t = Math.round(cy - hh) - 3.5;
      const b = Math.round(cy + hh) + 3.5;
      const k = 5;
      ctx.strokeStyle = stroke(a);
      ctx.beginPath();
      ctx.moveTo(l, t + k); ctx.lineTo(l, t); ctx.lineTo(l + k, t);
      ctx.moveTo(r - k, t); ctx.lineTo(r, t); ctx.lineTo(r, t + k);
      ctx.moveTo(r, b - k); ctx.lineTo(r, b); ctx.lineTo(r - k, b);
      ctx.moveTo(l + k, b); ctx.lineTo(l, b); ctx.lineTo(l, b - k);
      ctx.stroke();
    };

    const drawReadout = (i: number, cx: number, cy: number, hw: number, hh: number) => {
      const nd = simRef.current.nodes[i]!;
      const text = `${nd.x.toFixed(2)}, ${(-nd.y).toFixed(2)}`;
      const x0 = Math.round(cx + hw) + 0.5;
      const y0 = Math.round(cy - hh) + 0.5;
      const x1 = x0 + 14;
      const y1 = y0 - 14;
      ctx.strokeStyle = stroke(0.45);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.fillStyle = stroke(0.6);
      ctx.beginPath();
      ctx.arc(x1, y1, 1.6, 0, TAU);
      ctx.fill();
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = stroke(0.55);
      ctx.fillText(text, x1 + 5, y1);
    };

    const draw = (nowMs: number) => {
      if (alphaRef.current > 0.02) {
        stepLayout(simRef.current.nodes, simRef.current.edges, alphaRef.current);
        alphaRef.current *= 0.985;
      }
      if (nowMs - inkReadAt > 1000) {
        inkReadAt = nowMs;
        readInk();
      }
      const { byId, nodes: simNodes } = simRef.current;
      const g = visibleRef.current;
      const hover = hoverRef.current;
      const selected = selectedRef.current;
      const matches = matchRef.current;

      // Slow drift so depth reads; pauses while the user is interacting.
      const idle =
        !dragRef.current && !hover && nowMs - cam.lastInteract > 2000;
      if (idle) cam.ry += 0.0007;

      projectAll();

      // Fit the graph to the sheet until the user zooms by hand.
      if (!cam.userZoomed && simNodes.length > 0) {
        let maxR = 1;
        for (let i = 0; i < simNodes.length; i++) {
          const d = Math.hypot(proj[i * 3]! - w / 2, proj[i * 3 + 1]! - h / 2) / cam.zoom;
          if (d > maxR) maxR = d;
        }
        const fit = Math.min(4, Math.max(0.25, (0.4 * Math.min(w, h)) / maxR));
        if (Math.abs(fit - cam.zoom) > 0.002) {
          cam.zoom += (fit - cam.zoom) * 0.08;
          projectAll();
        }
      }

      const focus = hover ?? selected;
      let focusSet: Set<string> | null = null;
      if (focus) {
        focusSet = new Set([focus]);
        for (const e of g.edges) {
          if (e.a === focus) focusSet.add(e.b);
          else if (e.b === focus) focusSet.add(e.a);
        }
      }
      const isDimmed = (id: string) =>
        (!!focusSet && !focusSet.has(id)) || (!!matches && !matches.has(id));

      // Ruled label boxes, in priority order: the interaction set, then hubs
      // by degree. A candidate that would overlap a placed box stays a marker,
      // so labels never pile up; focus and selection always place.
      const candidates: string[] = [];
      if (selected) candidates.push(selected);
      if (focus && focus !== selected) candidates.push(focus);
      if (matches) candidates.push(...matches);
      if (focusSet) candidates.push(...focusSet);
      candidates.push(...hubOrderRef.current);
      const hubBudget = Math.round(10 * Math.pow(cam.zoom, 1.4));

      if (boxes.length < simNodes.length * 4) boxes = new Float32Array(simNodes.length * 4);
      boxes.fill(-1);
      const placed: number[] = [];
      let hubs = 0;
      for (const id of candidates) {
        const i = byId.get(id);
        if (i == null || boxes[i * 4 + 2]! > 0) continue;
        const forced = id === selected || id === focus;
        if (!forced && isDimmed(id)) continue;
        const n = nodeIndexRef.current.get(id);
        if (!n) continue;
        const persp = proj[i * 3 + 2]!;
        const size = Math.round(Math.max(9, Math.min(11, 10 * persp * Math.sqrt(cam.zoom))));
        const font = `${size}px "JetBrains Mono", monospace`;
        const label = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
        const hw = (measure(font, label) + measure(font, ` ${TYPE_SUFFIX[n.type]}`)) / 2 + 7;
        const hh = size / 2 + 5;
        const cx = proj[i * 3]!;
        const cy = proj[i * 3 + 1]!;
        let clear = true;
        for (let k = 0; k < placed.length && !forced; k += 4) {
          if (
            Math.abs(cx - placed[k]!) < hw + placed[k + 2]! + 6 &&
            Math.abs(cy - placed[k + 1]!) < hh + placed[k + 3]! + 6
          ) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        const isHub = !forced && !(matches?.has(id)) && !(focusSet?.has(id));
        if (isHub) {
          if (hubs >= hubBudget) continue;
          hubs++;
        }
        boxes[i * 4] = cx;
        boxes[i * 4 + 1] = cy;
        boxes[i * 4 + 2] = hw;
        boxes[i * 4 + 3] = hh;
        placed.push(cx, cy, hw, hh);
      }
      boxesRef.current = boxes;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      drawConstruction();

      // Links — straight hairlines from box edge (or marker rim) to box edge.
      ctx.lineWidth = 1;
      const junctions: number[] = [];
      for (const e of g.edges) {
        const ia = byId.get(e.a);
        const ib = byId.get(e.b);
        if (ia == null || ib == null) continue;
        let ax = proj[ia * 3]!;
        let ay = proj[ia * 3 + 1]!;
        let bx = proj[ib * 3]!;
        let by = proj[ib * 3 + 1]!;
        const ahw = boxes[ia * 4 + 2]!;
        const bhw = boxes[ib * 4 + 2]!;
        const aBox = ahw > 0;
        const bBox = bhw > 0;
        if (aBox) {
          const p = exitPoint(ax, ay, ahw, boxes[ia * 4 + 3]!, bx, by);
          if (!p) continue;
          [ax, ay] = p;
        }
        if (bBox) {
          const p = exitPoint(bx, by, bhw, boxes[ib * 4 + 3]!, ax, ay);
          if (!p) continue;
          [bx, by] = p;
        }
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 4) continue;
        // Unboxed ends stop at the marker rim so hollow markers stay clean.
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        if (!aBox) {
          const s = markerSize(ia);
          ax += ux * (s + 1.5);
          ay += uy * (s + 1.5);
        }
        if (!bBox) {
          const s = markerSize(ib);
          bx -= ux * (s + 1.5);
          by -= uy * (s + 1.5);
        }
        const depth = depthT((proj[ia * 3 + 2]! + proj[ib * 3 + 2]!) / 2);
        const inFocus = !!focusSet && focusSet.has(e.a) && focusSet.has(e.b);
        const dimmed =
          (focusSet && !inFocus) ||
          (matches && !(matches.has(e.a) && matches.has(e.b)));
        let a = dimmed ? 0.035 : inFocus ? 0.62 : 0.09 + depth * 0.17;
        if (e.kind === "semantic") ctx.setLineDash([3, 4]);
        else if (e.kind === "mention") ctx.setLineDash([1, 3]);
        else {
          ctx.setLineDash([]);
          if (e.kind !== "wikilink" && e.kind !== "parent") a *= 0.75;
        }
        ctx.strokeStyle = stroke(a);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (!dimmed) {
          if (aBox) junctions.push(ax, ay, a);
          if (bBox) junctions.push(bx, by, a);
        }
      }
      ctx.setLineDash([]);

      // Hollow junction circles where links meet a box.
      for (let k = 0; k < junctions.length; k += 3) {
        ctx.strokeStyle = stroke(Math.min(0.85, junctions[k + 2]! + 0.2));
        ctx.beginPath();
        ctx.arc(junctions[k]!, junctions[k + 1]!, 2.2, 0, TAU);
        ctx.stroke();
      }

      // Markers for unboxed nodes.
      for (const n of g.nodes) {
        const i = byId.get(n.id);
        if (i == null || boxes[i * 4 + 2]! > 0) continue;
        const depth = depthT(proj[i * 3 + 2]!);
        const a = isDimmed(n.id) ? 0.08 : 0.3 + depth * 0.5;
        ctx.strokeStyle = stroke(a);
        ctx.fillStyle = stroke(a);
        drawMarker(ctx, TYPE_MARKER[n.type], proj[i * 3]!, proj[i * 3 + 1]!, markerSize(i));
      }

      // Ruled label boxes.
      for (const n of g.nodes) {
        const i = byId.get(n.id);
        if (i == null) continue;
        const hw = boxes[i * 4 + 2]!;
        if (hw <= 0) continue;
        const cx = boxes[i * 4]!;
        const cy = boxes[i * 4 + 1]!;
        const hh = boxes[i * 4 + 3]!;
        const depth = depthT(proj[i * 3 + 2]!);
        const isFocus = n.id === focus;
        const isSel = n.id === selected;
        const isMatch = !!matches && matches.has(n.id);
        const strong = isFocus || isSel || isMatch;
        const base = strong ? 0.9 : 0.4 + depth * 0.4;
        const x = Math.round(cx - hw) + 0.5;
        const y = Math.round(cy - hh) + 0.5;
        const bw = Math.round(hw * 2);
        const bh = Math.round(hh * 2);
        // Paper fill occludes links passing beneath, like a printed callout.
        ctx.fillStyle = `rgba(${paper}, 0.94)`;
        ctx.fillRect(x, y, bw, bh);
        if (isSel || isFocus) {
          ctx.fillStyle = stroke(isSel ? 0.1 : 0.06);
          ctx.fillRect(x, y, bw, bh);
        }
        ctx.strokeStyle = stroke(base * 0.75);
        ctx.strokeRect(x, y, bw, bh);
        const size = Math.round((hh - 5) * 2);
        ctx.font = `${size}px "JetBrains Mono", monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const label = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
        const tx = x + 6.5;
        ctx.fillStyle = stroke(base);
        ctx.fillText(label, tx, cy + 0.5);
        ctx.fillStyle = stroke(base * 0.45);
        ctx.fillText(` ${TYPE_SUFFIX[n.type]}`, tx + measure(ctx.font, label), cy + 0.5);
        if (isSel) drawBrackets(cx, cy, hw, hh, 0.8);
        if (isSel || isFocus) drawReadout(i, cx, cy, hw, hh);
      }

      raf = requestAnimationFrame(draw);
    };
    const markerSize = (i: number) => {
      const r = simRef.current.nodes[i]!.r * proj[i * 3 + 2]! * cam.zoom;
      return Math.max(1.8, Math.min(5, r * 0.36));
    };
    raf = requestAnimationFrame(draw);

    // ── Interaction ───────────────────────────────────────────────────
    const hitTest = (clientX: number, clientY: number): number => {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { nodes } = simRef.current;
      const bx = boxesRef.current;
      let best = -1;
      let bestPersp = -Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const persp = proj[i * 3 + 2]!;
        const hw = bx.length > i * 4 + 3 ? bx[i * 4 + 2]! : -1;
        let hit: boolean;
        if (hw > 0) {
          hit =
            Math.abs(mx - bx[i * 4]!) <= hw + 2 &&
            Math.abs(my - bx[i * 4 + 1]!) <= bx[i * 4 + 3]! + 2;
        } else {
          const r = markerSize(i) + 5;
          const dx = mx - proj[i * 3]!;
          const dy = my - proj[i * 3 + 1]!;
          hit = dx * dx + dy * dy <= r * r;
        }
        if (hit && persp > bestPersp) {
          best = i;
          bestPersp = persp;
        }
      }
      return best;
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      cam.lastInteract = performance.now();
      const hit = hitTest(e.clientX, e.clientY);
      if (hit >= 0) {
        const n = simRef.current.nodes[hit]!;
        toCamera(n.x, n.y, n.z, scratch);
        dragRef.current = { mode: "node", index: hit, camZ: scratch[2], moved: false };
        n.fx = n.x;
        n.fy = n.y;
        n.fz = n.z;
      } else {
        dragRef.current = {
          mode: "orbit",
          sx: e.clientX,
          sy: e.clientY,
          orx: cam.rx,
          ory: cam.ry,
          moved: false,
        };
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        const hit = hitTest(e.clientX, e.clientY);
        const id = hit >= 0 ? simRef.current.nodes[hit]!.id : null;
        hoverRef.current = id;
        canvas.style.cursor = id ? "pointer" : "grab";
        return;
      }
      cam.lastInteract = performance.now();
      if (drag.mode === "orbit") {
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        cam.ry = drag.ory + dx * 0.005;
        cam.rx = Math.max(-1.3, Math.min(1.3, drag.orx + dy * 0.005));
      } else {
        const rect = canvas.getBoundingClientRect();
        const persp = FOCAL / Math.max(80, FOCAL + drag.camZ);
        const x1 = (e.clientX - rect.left - w / 2) / (persp * cam.zoom);
        const y2 = (e.clientY - rect.top - h / 2) / (persp * cam.zoom);
        toWorldFromCamera(x1, y2, drag.camZ, scratch);
        const n = simRef.current.nodes[drag.index]!;
        n.fx = scratch[0];
        n.fy = scratch[1];
        n.fz = scratch[2];
        drag.moved = true;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
      }
    };
    const onPointerUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.mode === "node") {
        const n = simRef.current.nodes[drag.index]!;
        n.fx = null;
        n.fy = null;
        n.fz = null;
        if (!drag.moved) setSelectedId(n.id);
      } else if (!drag.moved) {
        setSelectedId(null);
      }
    };
    const onDoubleClick = (e: MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit < 0) {
        cam.userZoomed = false;
        return;
      }
      const id = simRef.current.nodes[hit]!.id;
      const node = visibleRef.current.nodes.find((n) => n.id === id);
      if (node) openNode(node);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.lastInteract = performance.now();
      const factor = Math.exp(-e.deltaY * 0.0016);
      cam.zoom = Math.min(4, Math.max(0.25, cam.zoom * factor));
      cam.userZoomed = true;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  const toggleType = useCallback((t: BrainNodeType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedNeighbors = useMemo(() => {
    if (!selected) return [];
    return neighborsOf(visible, selected.id)
      .map((id) => nodeById.get(id))
      .filter((n): n is BrainNode => !!n)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 24);
  }, [selected, visible, nodeById]);

  const autoLinked = useMemo(
    () => graph.edges.filter((e) => e.kind === "semantic" || e.kind === "mention").length,
    [graph],
  );

  const askClaude = (n: BrainNode) => {
    const links = selectedNeighbors.map((x) => `"${x.label}" (${x.type})`).join(", ");
    const prompt =
      `From my Brain graph: tell me about "${n.label}" (${n.type}) in my archive.` +
      (links ? ` It's connected to: ${links}.` : "") +
      ` Summarize what I have on it and suggest connections or gaps I might be missing.`;
    if (!sendToArchivesChat(prompt)) log.warn("brain: archives chat not mounted");
  };

  const typeCounts = useMemo(() => {
    const counts = new Map<BrainNodeType, number>();
    for (const n of graph.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [graph]);

  return (
    <div className="ar-brain" ref={containerRef}>
      <canvas ref={canvasRef} className="ar-brain-canvas" />

      <div className="ar-brain-topbar">
        <div className="ar-brain-search">
          <Search size={12} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in brain…"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} title="Clear">
              <X size={11} />
            </button>
          )}
        </div>
        <div className="ar-brain-chips">
          {ALL_TYPES.map((t) => {
            const count = typeCounts.get(t) ?? 0;
            if (count === 0) return null;
            const off = hiddenTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                className={`ar-brain-chip${off ? " off" : ""}`}
                onClick={() => toggleType(t)}
                title={`${off ? "Show" : "Hide"} ${TYPE_LABEL[t].toLowerCase()}`}
              >
                <TypeGlyph type={t} />
                {TYPE_LABEL[t]}
                <span className="n">{count}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="ar-brain-refresh"
          onClick={refresh}
          title="Rebuild graph"
        >
          <RefreshCw size={12} className={loading ? "spin" : undefined} />
        </button>
      </div>

      <div className="ar-brain-status">
        {visible.nodes.length} nodes · {visible.edges.length} links ·{" "}
        <span className="auto">{autoLinked} auto-linked</span>
        {loading ? " · indexing…" : ""}
      </div>

      {graph.nodes.length === 0 && !loading && (
        <div className="ar-brain-empty">
          <div className="title">Your brain is empty</div>
          <div className="hint">
            Everything you create in Orion Terminal — notes, journal entries,
            projects, chats, media — appears here and links itself
            automatically.
          </div>
        </div>
      )}

      {selected && (
        <div className="ar-brain-detail">
          <div className="ar-brain-detail-head">
            <TypeGlyph type={selected.type} />
            <div className="titles">
              <div className="title" title={selected.label}>
                {selected.label}
              </div>
              <div className="sub">
                {TYPE_SUFFIX[selected.type]} · {selected.degree}{" "}
                {selected.degree === 1 ? "link" : "links"}
              </div>
            </div>
            <button
              type="button"
              className="close"
              onClick={() => setSelectedId(null)}
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
          <div className="ar-brain-detail-actions">
            <button type="button" onClick={() => openNode(selected)}>
              <ExternalLink size={11} /> Open
            </button>
            <button type="button" className="ask" onClick={() => askClaude(selected)}>
              <Sparkles size={11} /> Ask Claude
            </button>
          </div>
          {selectedNeighbors.length > 0 && (
            <>
              <div className="ar-brain-detail-section">Connections</div>
              <div className="ar-brain-detail-links scroll">
                {selectedNeighbors.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="link"
                    onClick={() => setSelectedId(n.id)}
                    onDoubleClick={() => openNode(n)}
                    title={n.label}
                  >
                    <TypeGlyph type={n.type} />
                    <span className="lbl">{n.label}</span>
                    <span className="kind">{TYPE_SUFFIX[n.type]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TypeGlyph({ type }: { type: BrainNodeType }) {
  return <span className="ar-brain-glyph" data-shape={TYPE_MARKER[type]} aria-hidden />;
}
