/** Brain — the automatic knowledge graph over everything in Orion Terminal.
 * Notes, journal entries, projects, chats, media, mood boards, tags and
 * collections become nodes; wikilinks, hierarchy, tags, board membership,
 * title mentions and semantic-embedding similarity become edges — no manual
 * linking required. Custom canvas force layout (60fps, locked dep list).
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
  tag: "#5a706a",
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

  // ── Mutable sim + view state (refs — the rAF loop owns them) ────────
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<{
    nodes: LayoutNode[];
    edges: LayoutEdge[];
    byId: Map<string, number>;
  }>({ nodes: [], edges: [], byId: new Map() });
  const alphaRef = useRef(1);
  const viewRef = useRef({ x: 0, y: 0, zoom: 1, sized: false });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<
    | { mode: "pan"; sx: number; sy: number; ox: number; oy: number }
    | { mode: "node"; index: number; moved: boolean }
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
      return { id: n.id, x: p.x, y: p.y, vx: 0, vy: 0, r: radiusFor(n), fx: null, fy: null };
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
      if (!viewRef.current.sized) {
        viewRef.current = { x: w / 2, y: h / 2, zoom: 1, sized: true };
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      if (alphaRef.current > 0.02) {
        stepLayout(simRef.current.nodes, simRef.current.edges, alphaRef.current);
        alphaRef.current *= 0.985;
      }
      const { nodes, byId } = simRef.current;
      const view = viewRef.current;
      const g = visibleRef.current;
      const hover = hoverRef.current;
      const selected = selectedRef.current;
      const matches = matchRef.current;

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
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.zoom, view.zoom);

      // Edges.
      for (const e of g.edges) {
        const ia = byId.get(e.a);
        const ib = byId.get(e.b);
        if (ia == null || ib == null) continue;
        const a = nodes[ia]!;
        const b = nodes[ib]!;
        const inFocus = focusSet ? focusSet.has(e.a) && focusSet.has(e.b) : true;
        const dimmed =
          (focusSet && !inFocus) ||
          (matches && !(matches.has(e.a) && matches.has(e.b)));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (e.kind === "semantic") {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = dimmed
            ? "rgba(177, 76, 255, 0.05)"
            : `rgba(177, 76, 255, ${0.16 + e.weight * 0.25})`;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = dimmed
            ? "rgba(154, 176, 168, 0.04)"
            : e.kind === "wikilink" || e.kind === "parent"
              ? "rgba(57, 255, 136, 0.28)"
              : "rgba(154, 176, 168, 0.14)";
        }
        ctx.lineWidth = (inFocus && focusSet ? 1.6 : 1) / view.zoom;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes.
      for (const n of g.nodes) {
        const i = byId.get(n.id);
        if (i == null) continue;
        const p = nodes[i]!;
        const color = TYPE_COLOR[n.type];
        const isFocus = n.id === focus;
        const dimmed =
          (focusSet && !focusSet.has(n.id)) || (matches && !matches.has(n.id));
        ctx.globalAlpha = dimmed ? 0.15 : 1;
        if (isFocus || (matches && matches.has(n.id))) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 16;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (n.id === selected) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 3.5 / view.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4 / view.zoom;
          ctx.stroke();
        }

        // Labels — zoomed-in enough, or focused / matched.
        const showLabel =
          !dimmed &&
          (isFocus ||
            n.id === selected ||
            (matches && matches.has(n.id)) ||
            view.zoom * p.r >= 7);
        if (showLabel) {
          const size = Math.max(9, 11 / view.zoom);
          ctx.font = `${size}px "JetBrains Mono", monospace`;
          ctx.fillStyle = isFocus ? "#e6f4ec" : "rgba(154, 176, 168, 0.9)";
          ctx.textAlign = "center";
          const label =
            n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
          ctx.fillText(label, p.x, p.y + p.r + size + 2 / view.zoom);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ── Interaction ───────────────────────────────────────────────────
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      return {
        x: (clientX - rect.left - view.x) / view.zoom,
        y: (clientY - rect.top - view.y) / view.zoom,
      };
    };
    const hitTest = (clientX: number, clientY: number): number => {
      const p = toWorld(clientX, clientY);
      const { nodes } = simRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]!;
        const dx = p.x - n.x;
        const dy = p.y - n.y;
        const r = n.r + 3;
        if (dx * dx + dy * dy <= r * r) return i;
      }
      return -1;
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const hit = hitTest(e.clientX, e.clientY);
      if (hit >= 0) {
        dragRef.current = { mode: "node", index: hit, moved: false };
        const n = simRef.current.nodes[hit]!;
        n.fx = n.x;
        n.fy = n.y;
      } else {
        const view = viewRef.current;
        dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
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
      if (drag.mode === "pan") {
        viewRef.current.x = drag.ox + (e.clientX - drag.sx);
        viewRef.current.y = drag.oy + (e.clientY - drag.sy);
      } else {
        const p = toWorld(e.clientX, e.clientY);
        const n = simRef.current.nodes[drag.index]!;
        n.fx = p.x;
        n.fy = p.y;
        drag.moved = true;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.mode === "node") {
        const n = simRef.current.nodes[drag.index]!;
        n.fx = null;
        n.fy = null;
        if (!drag.moved) setSelectedId(n.id);
      } else if (
        Math.abs(e.clientX - drag.sx) < 3 &&
        Math.abs(e.clientY - drag.sy) < 3
      ) {
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
      const view = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const next = Math.min(4, Math.max(0.15, view.zoom * factor));
      // Zoom about the cursor.
      view.x = mx - ((mx - view.x) / view.zoom) * next;
      view.y = my - ((my - view.y) / view.zoom) * next;
      view.zoom = next;
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
