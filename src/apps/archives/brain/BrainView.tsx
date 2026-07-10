/** Brain — the automatic knowledge graph over everything in Orion Terminal.
 * Notes, journal entries, projects, chats, media, mood boards, tags and
 * collections become nodes; wikilinks, hierarchy, tags, board membership,
 * title mentions and semantic-embedding similarity become edges — no manual
 * linking required.
 *
 * Rendered in the energy-core visual language: a 3D force layout projected
 * with a slow orbital camera, additive-blended glowing wireframe spheres for
 * nodes (gyroscope rings, hot center) and luminous link lines — not flat
 * dots. Drag empty space to orbit, wheel to zoom, drag a node to move it.
 * Click a node → detail rail with its connections, Open, and Ask Claude
 * (routes into the live Archives chat). */
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

const TYPE_COLOR: Record<BrainNodeType, string> = {
  note: "#39ff88",
  journal: "#e6ff3a",
  project: "#00e0ff",
  chat: "#b14cff",
  asset: "#ff3ea5",
  board: "#ff8a3c",
  tag: "#4d6a5f",
  collection: "#9ab0a8",
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

function hashPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 628) / 100;
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

/** Wireframe-sphere node glyph — outline + two gyroscope ellipses + hot
 * center. Reads as a tiny energy core under additive blending. */
function drawNodeGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  spin: number,
  detailed: boolean,
) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  if (detailed) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.36, spin, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.36, r, spin * 0.6 + 1.1, 0, TAU);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.8, r * 0.2), 0, TAU);
  ctx.fill();
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
    phases: Float32Array;
  }>({ nodes: [], edges: [], byId: new Map(), phases: new Float32Array(0) });
  const alphaRef = useRef(1);
  const camRef = useRef({ rx: -0.28, ry: 0.4, zoom: 1, lastInteract: 0 });
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
    const phases = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) phases[i] = hashPhase(nodes[i]!.id);
    const edges: LayoutEdge[] = [];
    for (const e of visible.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (a == null || b == null) continue;
      edges.push({ a, b, weight: EDGE_SPRING[e.kind] ?? 0.5 });
    }
    simRef.current = { nodes, edges, byId, phases };
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

    const draw = (nowMs: number) => {
      if (alphaRef.current > 0.02) {
        stepLayout(simRef.current.nodes, simRef.current.edges, alphaRef.current);
        alphaRef.current *= 0.985;
      }
      const t = nowMs / 1000;
      const { byId, phases } = simRef.current;
      const g = visibleRef.current;
      const hover = hoverRef.current;
      const selected = selectedRef.current;
      const matches = matchRef.current;

      // Slow auto-orbit — the core's idle spin. Pauses while the user is
      // interacting so hover targets stay put.
      const idle =
        !dragRef.current && !hover && nowMs - cam.lastInteract > 2000;
      if (idle) cam.ry += 0.0016;

      projectAll();

      // Neighborhood of the focused (hover-or-selected) node.
      const focus = hover ?? selected;
      let focusSet: Set<string> | null = null;
      if (focus) {
        focusSet = new Set([focus]);
        for (const e of g.edges) {
          if (e.a === focus) focusSet.add(e.b);
          else if (e.b === focus) focusSet.add(e.a);
        }
      }

      ctx.clearRect(0, 0, w, h);
      // Everything glows: additive blending, exactly like the core's shells.
      ctx.globalCompositeOperation = "lighter";

      // Edges.
      ctx.lineWidth = 1;
      for (const e of g.edges) {
        const ia = byId.get(e.a);
        const ib = byId.get(e.b);
        if (ia == null || ib == null) continue;
        const ax = proj[ia * 3]!;
        const ay = proj[ia * 3 + 1]!;
        const bx = proj[ib * 3]!;
        const by = proj[ib * 3 + 1]!;
        const depth = depthT((proj[ia * 3 + 2]! + proj[ib * 3 + 2]!) / 2);
        const inFocus = focusSet ? focusSet.has(e.a) && focusSet.has(e.b) : true;
        const dimmed =
          (focusSet && !inFocus) ||
          (matches && !(matches.has(e.a) && matches.has(e.b)));
        let base: number;
        if (dimmed) base = 0.025;
        else base = (0.08 + depth * 0.16) * (inFocus && focusSet ? 2.2 : 1);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        if (e.kind === "semantic") {
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = `rgba(177, 76, 255, ${Math.min(1, base * (0.8 + e.weight))})`;
        } else if (e.kind === "wikilink" || e.kind === "parent") {
          ctx.setLineDash([]);
          ctx.strokeStyle = `rgba(57, 255, 136, ${base})`;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = `rgba(120, 180, 160, ${base * 0.8})`;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes — glowing wireframe spheres, depth-faded and depth-scaled.
      for (const n of g.nodes) {
        const i = byId.get(n.id);
        if (i == null) continue;
        const sx = proj[i * 3]!;
        const sy = proj[i * 3 + 1]!;
        const persp = proj[i * 3 + 2]!;
        const depth = depthT(persp);
        const r = simRef.current.nodes[i]!.r * persp * cam.zoom;
        const color = TYPE_COLOR[n.type];
        const isFocus = n.id === focus;
        const isMatch = matches ? matches.has(n.id) : false;
        const dimmed = (focusSet && !focusSet.has(n.id)) || (matches && !isMatch);

        ctx.globalAlpha = dimmed ? 0.07 : 0.32 + depth * 0.68;
        if (isFocus || isMatch) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 18;
          ctx.globalAlpha = 1;
        }
        const spin = t * 0.6 + phases[i]!;
        ctx.lineWidth = isFocus ? 1.4 : 1;
        drawNodeGlyph(ctx, sx, sy, r, color, spin, r >= 5 && !dimmed);
        ctx.shadowBlur = 0;

        if (n.id === selected) {
          // Selection halo — a slow-pulsing outer ring.
          const pulse = 1 + Math.sin(t * 2.4) * 0.08;
          ctx.beginPath();
          ctx.arc(sx, sy, (r + 5) * pulse, 0, TAU);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Labels — normal compositing so text stays crisp.
      ctx.globalCompositeOperation = "source-over";
      for (const n of g.nodes) {
        const i = byId.get(n.id);
        if (i == null) continue;
        const persp = proj[i * 3 + 2]!;
        const r = simRef.current.nodes[i]!.r * persp * cam.zoom;
        const isFocus = n.id === focus;
        const isMatch = matches ? matches.has(n.id) : false;
        const dimmed = (focusSet && !focusSet.has(n.id)) || (matches && !isMatch);
        const show =
          !dimmed && (isFocus || n.id === selected || isMatch || r >= 8.5);
        if (!show) continue;
        const sx = proj[i * 3]!;
        const sy = proj[i * 3 + 1]!;
        const size = Math.max(9, Math.min(12, 10 * persp * cam.zoom));
        ctx.font = `${size}px "JetBrains Mono", monospace`;
        ctx.textAlign = "center";
        ctx.globalAlpha = isFocus || isMatch ? 1 : 0.35 + depthT(persp) * 0.5;
        ctx.fillStyle = isFocus ? "#e6f4ec" : TYPE_COLOR[n.type];
        const label = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        ctx.fillText(label, sx, sy + r + size + 3);
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ── Interaction ───────────────────────────────────────────────────
    const hitTest = (clientX: number, clientY: number): number => {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { nodes } = simRef.current;
      let best = -1;
      let bestPersp = -Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const sx = proj[i * 3]!;
        const sy = proj[i * 3 + 1]!;
        const persp = proj[i * 3 + 2]!;
        const r = nodes[i]!.r * persp * cam.zoom + 3;
        const dx = mx - sx;
        const dy = my - sy;
        if (dx * dx + dy * dy <= r * r && persp > bestPersp) {
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
      if (hit < 0) return;
      const id = simRef.current.nodes[hit]!.id;
      const node = visibleRef.current.nodes.find((n) => n.id === id);
      if (node) openNode(node);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.lastInteract = performance.now();
      const factor = Math.exp(-e.deltaY * 0.0016);
      cam.zoom = Math.min(4, Math.max(0.25, cam.zoom * factor));
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
                <span className="dot" style={{ background: TYPE_COLOR[t] }} />
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
            <span className="dot" style={{ background: TYPE_COLOR[selected.type] }} />
            <div className="titles">
              <div className="title" title={selected.label}>
                {selected.label}
              </div>
              <div className="sub">
                {TYPE_LABEL[selected.type]} · {selected.degree}{" "}
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
                    <span className="dot" style={{ background: TYPE_COLOR[n.type] }} />
                    <span className="lbl">{n.label}</span>
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
