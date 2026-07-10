/** Blueprint visualizer — a live wireframe drafting layer behind the note
 * editor. As you write, the significant concepts in the text materialize as
 * schematic modules (part numbers, gyro rings, trusses, dimension lines)
 * that draw themselves in stroke-by-stroke, drift gently, link up by
 * co-occurrence, and fade away when the text moves on. Pure canvas, additive
 * strokes, pointer-events none — the glass note card blurs it into a soft
 * glow under the text and leaves it crisp in the margins. */
import { useEffect, useRef } from "react";
import type { NoteKind } from "@/store/notesStore";
import {
  extractConcepts,
  type ConceptMap,
} from "@/features/notes/visualizer/conceptExtract";

const ANALYZE_MS = 350;
const TAU = Math.PI * 2;

const KIND_RGB: Record<NoteKind, [number, number, number]> = {
  note: [57, 255, 136],
  journal: [230, 255, 58],
  project: [0, 224, 255],
};

type Glyph = {
  term: string;
  shape: number;
  phase: number;
  index: number; // stable part number
  x: number;
  y: number;
  tx: number;
  ty: number;
  size: number;
  tsize: number;
  alpha: number;
  talpha: number;
  appear: number; // 0..1 — dash draw-in progress
  weight: number;
  recent: boolean;
};

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Schematic module shapes ─────────────────────────────────────────────
// Each draws centered at (0,0) with half-extent s on a pre-translated ctx.

function shapeBox(ctx: CanvasRenderingContext2D, s: number) {
  ctx.strokeRect(-s, -s * 0.7, s * 2, s * 1.4);
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.7);
  ctx.lineTo(s, s * 0.7);
  ctx.moveTo(s, -s * 0.7);
  ctx.lineTo(-s, s * 0.7);
  ctx.stroke();
}

function shapeGyro(ctx: CanvasRenderingContext2D, s: number, spin: number) {
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, s, s * 0.34, spin, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, 0);
  ctx.lineTo(s * 0.35, 0);
  ctx.moveTo(0, -s * 0.35);
  ctx.lineTo(0, s * 0.35);
  ctx.stroke();
}

function shapeHex(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    const x = Math.cos(a) * s;
    const y = Math.sin(a) * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.45, 0, TAU);
  ctx.stroke();
}

function shapeTruss(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s, s * 0.75);
  ctx.lineTo(-s, s * 0.75);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(0, s * 0.75);
  ctx.moveTo(-s * 0.5, -s * 0.12);
  ctx.lineTo(s * 0.5, -s * 0.12);
  ctx.stroke();
}

function shapeDiamond(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(-s, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 1.3, 0);
  ctx.lineTo(s * 1.3, 0);
  ctx.moveTo(0, -s * 1.3);
  ctx.lineTo(0, s * 1.3);
  ctx.stroke();
}

function shapeModule(ctx: CanvasRenderingContext2D, s: number) {
  ctx.strokeRect(-s, -s * 0.6, s * 2, s * 1.2);
  ctx.beginPath();
  ctx.moveTo(-s * 0.33, -s * 0.6);
  ctx.lineTo(-s * 0.33, s * 0.6);
  ctx.moveTo(s * 0.33, -s * 0.6);
  ctx.lineTo(s * 0.33, s * 0.6);
  ctx.stroke();
  // Side pins.
  ctx.beginPath();
  for (const y of [-s * 0.3, 0, s * 0.3]) {
    ctx.moveTo(-s, y);
    ctx.lineTo(-s - s * 0.25, y);
    ctx.moveTo(s, y);
    ctx.lineTo(s + s * 0.25, y);
  }
  ctx.stroke();
}

type ShapeFn = (ctx: CanvasRenderingContext2D, s: number, spin: number) => void;
const SHAPES: ShapeFn[] = [shapeBox, shapeGyro, shapeHex, shapeTruss, shapeDiamond, shapeModule];

export function BlueprintCanvas({ text, kind }: { text: string; kind: NoteKind }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glyphsRef = useRef<Map<string, Glyph>>(new Map());
  const linksRef = useRef<ConceptMap["links"]>([]);
  const lastMapRef = useRef<ConceptMap>({ concepts: [], links: [] });
  const partCounter = useRef(0);
  const sizeRef = useRef({ w: 800, h: 600 });
  const rgb = KIND_RGB[kind] ?? KIND_RGB.note;

  /** Compute layout targets for the current concept map: deterministic
   * hash placement for new glyphs, then a short relaxation that separates
   * overlaps and pulls co-occurring terms together. Existing glyphs keep
   * their spot (stability while typing). */
  const applyMap = (map: ConceptMap) => {
    lastMapRef.current = map;
    const glyphs = glyphsRef.current;
    const { w, h } = sizeRef.current;
    const pad = 80;
    const present = new Set(map.concepts.map((c) => c.term));

    for (const c of map.concepts) {
      const existing = glyphs.get(c.term);
      const size = 26 + c.weight * 34;
      if (existing) {
        existing.tsize = size;
        existing.talpha = 1;
        existing.weight = c.weight;
        existing.recent = c.recent;
      } else {
        const hsh = hash32(c.term);
        const tx = pad + ((hsh % 1000) / 1000) * (w - pad * 2);
        const ty = pad + (((hsh >>> 10) % 1000) / 1000) * (h - pad * 2);
        glyphs.set(c.term, {
          term: c.term,
          shape: hsh % SHAPES.length,
          phase: ((hsh >>> 20) % 628) / 100,
          index: ++partCounter.current,
          x: tx,
          y: ty,
          tx,
          ty,
          size: size * 0.6,
          tsize: size,
          alpha: 0,
          talpha: 1,
          appear: 0,
          weight: c.weight,
          recent: c.recent,
        });
      }
    }
    for (const g of glyphs.values()) {
      if (!present.has(g.term)) g.talpha = 0;
    }

    // Relax target positions (only the live ones).
    const live = [...glyphs.values()].filter((g) => g.talpha > 0);
    const idx = new Map(live.map((g, i) => [g.term, i]));
    for (let iter = 0; iter < 110; iter++) {
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i]!;
          const b = live[j]!;
          let dx = b.tx - a.tx;
          let dy = b.ty - a.ty;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d === 0) {
            dx = 1;
            dy = 0.5;
            d = 1;
          }
          const min = a.tsize + b.tsize + 66;
          if (d < min) {
            const push = ((min - d) / d) * 0.24;
            a.tx -= dx * push;
            a.ty -= dy * push;
            b.tx += dx * push;
            b.ty += dy * push;
          }
        }
      }
      for (const l of map.links) {
        const ia = idx.get(l.a);
        const ib = idx.get(l.b);
        if (ia == null || ib == null) continue;
        const a = live[ia]!;
        const b = live[ib]!;
        const dx = b.tx - a.tx;
        const dy = b.ty - a.ty;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = a.tsize + b.tsize + 120;
        if (d > rest) {
          const pull = ((d - rest) / d) * 0.045 * l.strength;
          a.tx += dx * pull;
          a.ty += dy * pull;
          b.tx -= dx * pull;
          b.ty -= dy * pull;
        }
      }
      for (const g of live) {
        g.tx = Math.max(pad, Math.min(w - pad, g.tx));
        g.ty = Math.max(pad, Math.min(h - pad, g.ty));
      }
    }
    linksRef.current = map.links;
  };
  const applyRef = useRef(applyMap);
  applyRef.current = applyMap;

  // ── Text → concepts (debounced) ─────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => {
      applyRef.current(extractConcepts(text));
    }, ANALYZE_MS);
    return () => clearTimeout(id);
  }, [text]);

  // ── Canvas + render loop ────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
      applyRef.current(lastMapRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const [r, g, b] = rgb;
    const col = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      const { w, h } = sizeRef.current;
      const glyphs = glyphsRef.current;

      ctx.clearRect(0, 0, w, h);

      // Drafting-sheet chrome: faint grid + corner marks.
      ctx.strokeStyle = col(0.028);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 48; x < w; x += 48) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 48; y < h; y += 48) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.strokeStyle = col(0.14);
      ctx.beginPath();
      const m = 14;
      const c = 16;
      for (const [cx, cy, dx, dy] of [
        [m, m, 1, 1],
        [w - m, m, -1, 1],
        [m, h - m, 1, -1],
        [w - m, h - m, -1, -1],
      ] as const) {
        ctx.moveTo(cx + c * dx, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + c * dy);
      }
      ctx.stroke();

      // Animate glyph state.
      let biggest: Glyph | null = null;
      for (const glyph of [...glyphs.values()]) {
        const k = 1 - Math.pow(0.0018, dt); // ~smooth lerp, frame-rate safe
        glyph.x += (glyph.tx - glyph.x) * k;
        glyph.y += (glyph.ty - glyph.y) * k;
        glyph.size += (glyph.tsize - glyph.size) * k;
        glyph.alpha += (glyph.talpha - glyph.alpha) * (k * 0.7);
        glyph.appear = reduced
          ? 1
          : Math.min(1, glyph.appear + dt / 0.9);
        if (glyph.talpha === 0 && glyph.alpha < 0.02) {
          glyphs.delete(glyph.term);
          continue;
        }
        if (!biggest || glyph.weight > biggest.weight) biggest = glyph;
      }

      // Links between co-occurring concepts.
      ctx.setLineDash([]);
      for (const l of linksRef.current) {
        const a = glyphs.get(l.a);
        const bg = glyphs.get(l.b);
        if (!a || !bg) continue;
        const alpha = Math.min(a.alpha, bg.alpha) * (0.05 + l.strength * 0.09);
        if (alpha < 0.01) continue;
        ctx.strokeStyle = col(alpha);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(bg.x, bg.y);
        ctx.stroke();
        // Joint dots.
        ctx.fillStyle = col(alpha * 1.6);
        for (const p of [a, bg]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.4, 0, TAU);
          ctx.fill();
        }
      }

      // Modules — draw big ones last so their labels win overlaps.
      const ordered = [...glyphs.values()].sort((x, y) => x.weight - y.weight);
      for (const glyph of ordered) {
        const float = reduced ? 0 : Math.sin(t * 0.55 + glyph.phase) * 4;
        const gx = glyph.x;
        const gy = glyph.y + float;
        const s = glyph.size;
        const pulse = glyph.recent && !reduced ? Math.sin(t * 2.6 + glyph.phase) * 0.06 : 0;
        const stroke = glyph.alpha * (0.15 + glyph.weight * 0.23 + pulse);
        if (stroke < 0.01) continue;

        ctx.save();
        ctx.translate(gx, gy);
        ctx.strokeStyle = col(stroke);
        ctx.lineWidth = 1;
        // Draw-in: the shape traces itself like a pen plotter.
        if (glyph.appear < 1) {
          const per = s * 8;
          ctx.setLineDash([per * glyph.appear, per]);
        } else {
          ctx.setLineDash([]);
        }
        const spin = reduced ? glyph.phase : t * 0.22 + glyph.phase;
        SHAPES[glyph.shape]!(ctx, s, spin);
        ctx.setLineDash([]);

        // Part number, top-left of the module.
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = "left";
        ctx.fillStyle = col(stroke * 0.9);
        ctx.fillText(
          `${kind === "project" ? "P" : kind === "journal" ? "J" : "N"}-${String(glyph.index % 100).padStart(2, "0")}`,
          -s,
          -s - 6,
        );

        // Label under the module.
        const label =
          glyph.term.length > 18 ? `${glyph.term.slice(0, 17)}…` : glyph.term;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillStyle = col(glyph.alpha * (0.3 + glyph.weight * 0.3));
        ctx.fillText(label.toUpperCase(), 0, s + 16);

        // "Live" marker on the concept currently being written about.
        if (glyph.recent && glyph.appear >= 1) {
          const ringR = s + 8 + (reduced ? 0 : Math.sin(t * 2.2 + glyph.phase) * 2);
          ctx.strokeStyle = col(stroke * 0.7);
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          ctx.arc(0, 0, ringR, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();

        // Dimension line under the dominant concept — pure drafting flourish.
        if (glyph === biggest && glyph.appear >= 1 && glyph.alpha > 0.5) {
          const y = gy + s + 26;
          const x0 = gx - s;
          const x1 = gx + s;
          ctx.strokeStyle = col(stroke * 0.8);
          ctx.beginPath();
          ctx.moveTo(x0, y - 4);
          ctx.lineTo(x0, y + 4);
          ctx.moveTo(x1, y - 4);
          ctx.lineTo(x1, y + 4);
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.textAlign = "center";
          ctx.fillStyle = col(stroke * 0.9);
          ctx.fillText(`${Math.round(s * 2)}`, gx, y - 3);
        }
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // rgb identity is derived from `kind` — safe to key the effect on it.
  }, [kind, rgb]);

  return (
    <div ref={hostRef} className="note-blueprint-layer" aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  );
}
