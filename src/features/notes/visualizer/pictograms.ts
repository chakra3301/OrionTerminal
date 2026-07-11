/** Wireframe pictogram library for the blueprint visualizer. When a concept
 * matches a known object ("tree", "rocket", "coffee"…) the drafting layer
 * draws that actual object in blueprint linework instead of an abstract
 * module. Every pictogram is stroke-only, centered at (0,0) inside a
 * half-extent `s` box, so the pen-plotter dash draw-in and glow treatment
 * apply unchanged. `spin` animates the few that want motion (clock hands,
 * gear). Matching is synonym-based with light plural stemming; multi-word
 * entities match on their head noun ("golden gate bridge" → bridge). */

export type PictogramFn = (
  ctx: CanvasRenderingContext2D,
  s: number,
  spin: number,
) => void;

const TAU = Math.PI * 2;

// ── tiny drawing helpers (normalized -1..1 coords, scaled by s) ─────────
function lines(ctx: CanvasRenderingContext2D, s: number, segs: number[][][]) {
  ctx.beginPath();
  for (const seg of segs) {
    ctx.moveTo(seg[0]![0]! * s, seg[0]![1]! * s);
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i]![0]! * s, seg[i]![1]! * s);
  }
  ctx.stroke();
}
function poly(ctx: CanvasRenderingContext2D, s: number, pts: number[][], close = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0]! * s, p[1]! * s) : ctx.lineTo(p[0]! * s, p[1]! * s)));
  if (close) ctx.closePath();
  ctx.stroke();
}
function circle(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, 0, TAU);
  ctx.stroke();
}
function arc(
  ctx: CanvasRenderingContext2D,
  s: number,
  x: number,
  y: number,
  r: number,
  a0: number,
  a1: number,
) {
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, a0, a1);
  ctx.stroke();
}
function rect(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, w: number, h: number) {
  ctx.strokeRect(x * s, y * s, w * s, h * s);
}
function dot(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, r = 0.035) {
  ctx.beginPath();
  ctx.arc(x * s, y * s, Math.max(1, r * s), 0, TAU);
  ctx.fill();
}

// ── the library ─────────────────────────────────────────────────────────

const tree: PictogramFn = (ctx, s) => {
  lines(ctx, s, [[[0, 0.95], [0, 0.55]]]);
  poly(ctx, s, [[-0.55, 0.55], [0.55, 0.55], [0, -0.05]]);
  poly(ctx, s, [[-0.44, 0.1], [0.44, 0.1], [0, -0.45]]);
  poly(ctx, s, [[-0.32, -0.28], [0.32, -0.28], [0, -0.85]]);
};

const flower: PictogramFn = (ctx, s) => {
  lines(ctx, s, [[[0, 0.95], [0, 0.1]]]);
  ctx.beginPath();
  ctx.ellipse(0.22 * s, 0.6 * s, 0.2 * s, 0.08 * s, -0.5, 0, TAU);
  ctx.stroke();
  const cy = -0.35;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(a) * 0.26 * s,
      (cy + Math.sin(a) * 0.26) * s,
      0.2 * s,
      0.09 * s,
      a,
      0,
      TAU,
    );
    ctx.stroke();
  }
  circle(ctx, s, 0, cy, 0.12);
};

const mountain: PictogramFn = (ctx, s) => {
  poly(ctx, s, [[-0.95, 0.6], [-0.3, -0.4], [0.05, 0.1], [0.45, -0.7], [0.95, 0.6]], false);
  lines(ctx, s, [
    [[-0.95, 0.6], [0.95, 0.6]],
    [[0.31, -0.42], [0.39, -0.52], [0.45, -0.44], [0.52, -0.55], [0.59, -0.42]],
  ]);
};

const sun: PictogramFn = (ctx, s) => {
  circle(ctx, s, 0, 0, 0.42);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.moveTo(Math.cos(a) * 0.58 * s, Math.sin(a) * 0.58 * s);
    ctx.lineTo(Math.cos(a) * 0.85 * s, Math.sin(a) * 0.85 * s);
  }
  ctx.stroke();
};

const moon: PictogramFn = (ctx, s) => {
  arc(ctx, s, 0, 0, 0.6, -Math.PI * 0.62, Math.PI * 0.62);
  arc(ctx, s, 0.28, 0, 0.44, -Math.PI * 0.72, Math.PI * 0.72);
  dot(ctx, s, -0.5, -0.55);
  dot(ctx, s, -0.7, 0.1);
};

const star: PictogramFn = (ctx, s) => {
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.85 : 0.34;
    const a = (i / 10) * TAU - Math.PI / 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  poly(ctx, s, pts);
};

const cloud: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(-0.55 * s, 0.28 * s);
  ctx.bezierCurveTo(-0.9 * s, 0.28 * s, -0.82 * s, -0.18 * s, -0.42 * s, -0.16 * s);
  ctx.bezierCurveTo(-0.38 * s, -0.52 * s, 0.14 * s, -0.56 * s, 0.22 * s, -0.26 * s);
  ctx.bezierCurveTo(0.66 * s, -0.4 * s, 0.86 * s, 0.1 * s, 0.52 * s, 0.28 * s);
  ctx.closePath();
  ctx.stroke();
};

const rain: PictogramFn = (ctx, s) => {
  ctx.save();
  ctx.translate(0, -0.25 * s);
  cloud(ctx, s * 0.8, 0);
  ctx.restore();
  lines(ctx, s, [
    [[-0.35, 0.35], [-0.47, 0.7]],
    [[0, 0.35], [-0.12, 0.7]],
    [[0.35, 0.35], [0.23, 0.7]],
  ]);
};

const snow: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * 0.75 * s, cy * 0.75 * s);
    // chevron tick partway out
    const px = cx * 0.45 * s;
    const py = cy * 0.45 * s;
    const ox = Math.cos(a + Math.PI / 2) * 0.12 * s;
    const oy = Math.sin(a + Math.PI / 2) * 0.12 * s;
    ctx.moveTo(px + ox - cx * 0.12 * s, py + oy - cy * 0.12 * s);
    ctx.lineTo(px, py);
    ctx.lineTo(px - ox - cx * 0.12 * s, py - oy - cy * 0.12 * s);
  }
  ctx.stroke();
};

const fire: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(0, -0.75 * s);
  ctx.bezierCurveTo(0.55 * s, -0.15 * s, 0.5 * s, 0.5 * s, 0, 0.8 * s);
  ctx.bezierCurveTo(-0.5 * s, 0.5 * s, -0.55 * s, -0.15 * s, 0, -0.75 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -0.15 * s);
  ctx.bezierCurveTo(0.25 * s, 0.15 * s, 0.22 * s, 0.45 * s, 0, 0.6 * s);
  ctx.bezierCurveTo(-0.22 * s, 0.45 * s, -0.25 * s, 0.15 * s, 0, -0.15 * s);
  ctx.stroke();
};

const wave: PictogramFn = (ctx, s) => {
  for (const y of [-0.15, 0.3]) {
    ctx.beginPath();
    ctx.moveTo(-0.9 * s, y * s);
    ctx.bezierCurveTo(-0.6 * s, (y - 0.4) * s, -0.3 * s, (y + 0.4) * s, 0, y * s);
    ctx.bezierCurveTo(0.3 * s, (y - 0.4) * s, 0.6 * s, (y + 0.4) * s, 0.9 * s, y * s);
    ctx.stroke();
  }
};

const leaf: PictogramFn = (ctx, s) => {
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  ctx.beginPath();
  ctx.moveTo(0, -0.8 * s);
  ctx.bezierCurveTo(0.55 * s, -0.3 * s, 0.5 * s, 0.4 * s, 0, 0.8 * s);
  ctx.bezierCurveTo(-0.5 * s, 0.4 * s, -0.55 * s, -0.3 * s, 0, -0.8 * s);
  ctx.stroke();
  lines(ctx, s, [
    [[0, -0.7], [0, 0.8]],
    [[0, -0.2], [0.28, -0.38]],
    [[0, 0.15], [-0.28, -0.03]],
  ]);
  ctx.restore();
};

const person: PictogramFn = (ctx, s) => {
  circle(ctx, s, 0, -0.55, 0.22);
  lines(ctx, s, [
    [[0, -0.33], [0, 0.25]],
    [[-0.4, -0.05], [0.4, -0.05]],
    [[0, 0.25], [-0.32, 0.85]],
    [[0, 0.25], [0.32, 0.85]],
  ]);
};

const heart: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(0, 0.6 * s);
  ctx.bezierCurveTo(-0.95 * s, -0.05 * s, -0.38 * s, -0.7 * s, 0, -0.25 * s);
  ctx.bezierCurveTo(0.38 * s, -0.7 * s, 0.95 * s, -0.05 * s, 0, 0.6 * s);
  ctx.stroke();
};

const dog: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.65, -0.2, 1.0, 0.4);
  lines(ctx, s, [
    [[-0.55, 0.2], [-0.55, 0.65]],
    [[-0.35, 0.2], [-0.35, 0.65]],
    [[0.15, 0.2], [0.15, 0.65]],
    [[0.32, 0.2], [0.32, 0.65]],
    [[-0.65, -0.2], [-0.9, -0.5]],
    [[0.42, -0.42], [0.48, -0.2]],
  ]);
  circle(ctx, s, 0.52, -0.28, 0.22);
  dot(ctx, s, 0.6, -0.32);
};

const cat: PictogramFn = (ctx, s) => {
  circle(ctx, s, 0, 0.05, 0.5);
  poly(ctx, s, [[-0.42, -0.2], [-0.52, -0.75], [-0.12, -0.44]]);
  poly(ctx, s, [[0.42, -0.2], [0.52, -0.75], [0.12, -0.44]]);
  dot(ctx, s, -0.2, -0.02);
  dot(ctx, s, 0.2, -0.02);
  lines(ctx, s, [
    [[-0.5, 0.15], [-0.9, 0.08]],
    [[-0.5, 0.25], [-0.88, 0.28]],
    [[0.5, 0.15], [0.9, 0.08]],
    [[0.5, 0.25], [0.88, 0.28]],
  ]);
};

const bird: PictogramFn = (ctx, s) => {
  arc(ctx, s, -0.45, -0.1, 0.3, Math.PI * 1.15, Math.PI * 1.85);
  arc(ctx, s, 0.05, -0.1, 0.3, Math.PI * 1.15, Math.PI * 1.85);
  arc(ctx, s, 0.15, 0.35, 0.24, Math.PI * 1.15, Math.PI * 1.85);
  arc(ctx, s, 0.55, 0.35, 0.24, Math.PI * 1.15, Math.PI * 1.85);
};

const fish: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.ellipse(-0.1 * s, 0, 0.52 * s, 0.3 * s, 0, 0, TAU);
  ctx.stroke();
  poly(ctx, s, [[0.38, 0], [0.75, -0.28], [0.75, 0.28]]);
  dot(ctx, s, -0.4, -0.08);
};

const eye: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(-0.85 * s, 0);
  ctx.quadraticCurveTo(0, -0.7 * s, 0.85 * s, 0);
  ctx.quadraticCurveTo(0, 0.7 * s, -0.85 * s, 0);
  ctx.closePath();
  ctx.stroke();
  circle(ctx, s, 0, 0, 0.26);
  dot(ctx, s, 0, 0, 0.07);
};

const brain: PictogramFn = (ctx, s) => {
  circle(ctx, s, 0, 0, 0.55);
  lines(ctx, s, [[[0, -0.55], [0, 0.55]]]);
  arc(ctx, s, -0.25, -0.15, 0.14, 0, Math.PI * 1.4);
  arc(ctx, s, -0.22, 0.22, 0.13, Math.PI * 0.6, Math.PI * 1.9);
  arc(ctx, s, 0.25, -0.12, 0.14, Math.PI * 0.8, TAU);
  arc(ctx, s, 0.24, 0.25, 0.12, Math.PI * 1.2, Math.PI * 2.6);
};

const house: PictogramFn = (ctx, s) => {
  poly(ctx, s, [[-0.55, 0.7], [-0.55, -0.05], [0, -0.6], [0.55, -0.05], [0.55, 0.7]]);
  rect(ctx, s, -0.12, 0.28, 0.24, 0.42);
  rect(ctx, s, 0.2, 0.1, 0.22, 0.22);
};

const city: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.7, -0.3, 0.5, 1.0);
  rect(ctx, s, -0.05, -0.7, 0.6, 1.4);
  ctx.beginPath();
  for (const [bx, by, rows] of [[-0.58, -0.15, 3], [0.08, -0.55, 5]] as const) {
    for (let i = 0; i < rows; i++) {
      ctx.moveTo(bx * s, (by + i * 0.28) * s);
      ctx.lineTo((bx + 0.26) * s, (by + i * 0.28) * s);
    }
  }
  ctx.stroke();
};

const car: PictogramFn = (ctx, s) => {
  poly(
    ctx,
    s,
    [
      [-0.85, 0.25], [-0.85, 0.0], [-0.5, 0.0], [-0.28, -0.32], [0.3, -0.32],
      [0.5, 0.0], [0.85, 0.0], [0.85, 0.25],
    ],
    false,
  );
  lines(ctx, s, [[[-0.28, 0.25], [0.28, 0.25]]]);
  circle(ctx, s, -0.5, 0.28, 0.17);
  circle(ctx, s, 0.5, 0.28, 0.17);
};

const bike: PictogramFn = (ctx, s) => {
  circle(ctx, s, -0.48, 0.28, 0.3);
  circle(ctx, s, 0.48, 0.28, 0.3);
  poly(ctx, s, [[-0.48, 0.28], [-0.1, -0.22], [0.48, 0.28]], false);
  lines(ctx, s, [
    [[-0.1, -0.22], [-0.32, -0.22]],
    [[0.3, -0.42], [0.48, 0.28]],
    [[0.18, -0.42], [0.42, -0.42]],
  ]);
};

const boat: PictogramFn = (ctx, s) => {
  poly(ctx, s, [[-0.7, 0.3], [0.7, 0.3], [0.42, 0.6], [-0.42, 0.6]]);
  lines(ctx, s, [[[0, 0.3], [0, -0.75]]]);
  poly(ctx, s, [[0.05, -0.7], [0.55, 0.15], [0.05, 0.15]]);
};

const plane: PictogramFn = (ctx, s) => {
  lines(ctx, s, [
    [[0, -0.8], [0, 0.6]],
    [[0, -0.15], [-0.75, 0.3]],
    [[0, -0.15], [0.75, 0.3]],
    [[0, 0.5], [-0.3, 0.78]],
    [[0, 0.5], [0.3, 0.78]],
  ]);
  circle(ctx, s, 0, -0.8, 0.06);
};

const rocket: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(0, -0.85 * s);
  ctx.bezierCurveTo(0.32 * s, -0.5 * s, 0.28 * s, -0.05 * s, 0.24 * s, 0.35 * s);
  ctx.lineTo(-0.24 * s, 0.35 * s);
  ctx.bezierCurveTo(-0.28 * s, -0.05 * s, -0.32 * s, -0.5 * s, 0, -0.85 * s);
  ctx.stroke();
  poly(ctx, s, [[0.24, 0.35], [0.48, 0.62], [0.2, 0.55]], false);
  poly(ctx, s, [[-0.24, 0.35], [-0.48, 0.62], [-0.2, 0.55]], false);
  circle(ctx, s, 0, -0.3, 0.12);
  lines(ctx, s, [
    [[-0.08, 0.62], [-0.12, 0.85]],
    [[0.08, 0.62], [0.12, 0.85]],
  ]);
};

const train: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.65, -0.5, 1.3, 0.85);
  rect(ctx, s, -0.45, -0.32, 0.35, 0.3);
  rect(ctx, s, 0.1, -0.32, 0.35, 0.3);
  circle(ctx, s, -0.35, 0.5, 0.12);
  circle(ctx, s, 0, 0.5, 0.12);
  circle(ctx, s, 0.35, 0.5, 0.12);
  lines(ctx, s, [[[-0.8, 0.72], [0.8, 0.72]]]);
};

const coffee: PictogramFn = (ctx, s) => {
  poly(ctx, s, [[-0.38, -0.15], [0.38, -0.15], [0.3, 0.55], [-0.3, 0.55]]);
  arc(ctx, s, 0.44, 0.12, 0.17, -Math.PI / 2, Math.PI / 2);
  lines(ctx, s, [[[-0.5, 0.72], [0.5, 0.72]]]);
  for (const x of [-0.15, 0.12]) {
    ctx.beginPath();
    ctx.moveTo(x * s, -0.3 * s);
    ctx.bezierCurveTo((x + 0.1) * s, -0.45 * s, (x - 0.1) * s, -0.6 * s, x * s, -0.75 * s);
    ctx.stroke();
  }
};

const book: PictogramFn = (ctx, s) => {
  lines(ctx, s, [[[0, -0.4], [0, 0.5]]]);
  ctx.beginPath();
  ctx.moveTo(0, -0.4 * s);
  ctx.bezierCurveTo(-0.35 * s, -0.58 * s, -0.6 * s, -0.5 * s, -0.75 * s, -0.35 * s);
  ctx.lineTo(-0.75 * s, 0.42 * s);
  ctx.bezierCurveTo(-0.6 * s, 0.28 * s, -0.35 * s, 0.32 * s, 0, 0.5 * s);
  ctx.moveTo(0, -0.4 * s);
  ctx.bezierCurveTo(0.35 * s, -0.58 * s, 0.6 * s, -0.5 * s, 0.75 * s, -0.35 * s);
  ctx.lineTo(0.75 * s, 0.42 * s);
  ctx.bezierCurveTo(0.6 * s, 0.28 * s, 0.35 * s, 0.32 * s, 0, 0.5 * s);
  ctx.stroke();
  lines(ctx, s, [
    [[-0.55, -0.15], [-0.2, -0.05]],
    [[0.2, -0.05], [0.55, -0.15]],
  ]);
};

const music: PictogramFn = (ctx, s) => {
  ctx.beginPath();
  ctx.ellipse(-0.35 * s, 0.45 * s, 0.15 * s, 0.11 * s, -0.3, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0.35 * s, 0.32 * s, 0.15 * s, 0.11 * s, -0.3, 0, TAU);
  ctx.stroke();
  lines(ctx, s, [
    [[-0.22, 0.42], [-0.22, -0.5]],
    [[0.48, 0.28], [0.48, -0.62]],
    [[-0.22, -0.5], [0.48, -0.62]],
    [[-0.22, -0.32], [0.48, -0.44]],
  ]);
};

const camera: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.65, -0.3, 1.3, 0.85);
  poly(ctx, s, [[-0.2, -0.3], [-0.12, -0.5], [0.12, -0.5], [0.2, -0.3]], false);
  circle(ctx, s, 0, 0.12, 0.27);
  circle(ctx, s, 0, 0.12, 0.13);
  lines(ctx, s, [[[0.4, -0.12], [0.52, -0.12]]]);
};

const phone: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.3, -0.62, 0.6, 1.24);
  lines(ctx, s, [[[-0.1, -0.48], [0.1, -0.48]]]);
  circle(ctx, s, 0, 0.47, 0.06);
};

const computer: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.65, -0.55, 1.3, 0.85);
  lines(ctx, s, [
    [[0, 0.3], [0, 0.5]],
    [[-0.3, 0.5], [0.3, 0.5]],
    [[-0.25, -0.35], [-0.42, -0.12], [-0.25, 0.1]],
    [[0.25, -0.35], [0.42, -0.12], [0.25, 0.1]],
    [[0.08, -0.4], [-0.08, 0.15]],
  ]);
};

const clock: PictogramFn = (ctx, s, spin) => {
  circle(ctx, s, 0, 0, 0.6);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    ctx.moveTo(Math.cos(a) * 0.5 * s, Math.sin(a) * 0.5 * s);
    ctx.lineTo(Math.cos(a) * 0.6 * s, Math.sin(a) * 0.6 * s);
  }
  // minute hand sweeps with the ambient spin — the sheet keeps time.
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(spin - Math.PI / 2) * 0.42 * s, Math.sin(spin - Math.PI / 2) * 0.42 * s);
  ctx.moveTo(0, 0);
  ctx.lineTo(0.22 * s, 0.1 * s);
  ctx.stroke();
};

const key: PictogramFn = (ctx, s) => {
  circle(ctx, s, -0.4, 0, 0.24);
  lines(ctx, s, [
    [[-0.16, 0], [0.65, 0]],
    [[0.35, 0], [0.35, 0.22]],
    [[0.55, 0], [0.55, 0.28]],
  ]);
};

const lightbulb: PictogramFn = (ctx, s) => {
  circle(ctx, s, 0, -0.2, 0.4);
  lines(ctx, s, [
    [[-0.16, 0.16], [-0.16, 0.5]],
    [[0.16, 0.16], [0.16, 0.5]],
    [[-0.16, 0.38], [0.16, 0.38]],
    [[-0.16, 0.52], [0.16, 0.52]],
    [[-0.12, 0.05], [0, -0.15], [0.12, 0.05]],
    [[-0.62, -0.62], [-0.48, -0.48]],
    [[0.62, -0.62], [0.48, -0.48]],
    [[0, -0.85], [0, -0.68]],
  ]);
};

const gear: PictogramFn = (ctx, s, spin) => {
  ctx.save();
  ctx.rotate(spin * 0.5);
  circle(ctx, s, 0, 0, 0.5);
  circle(ctx, s, 0, 0, 0.18);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.moveTo(Math.cos(a) * 0.5 * s, Math.sin(a) * 0.5 * s);
    ctx.lineTo(Math.cos(a) * 0.72 * s, Math.sin(a) * 0.72 * s);
  }
  ctx.stroke();
  ctx.restore();
};

const money: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.75, -0.4, 1.5, 0.8);
  circle(ctx, s, 0, 0, 0.22);
  ctx.font = `${Math.max(8, 0.3 * s)}px "JetBrains Mono", monospace`;
  ctx.textAlign = "center";
  ctx.fillText("$", 0, 0.1 * s);
  dot(ctx, s, -0.58, 0);
  dot(ctx, s, 0.58, 0);
};

const trophy: PictogramFn = (ctx, s) => {
  poly(ctx, s, [[-0.35, -0.65], [0.35, -0.65], [0.28, -0.05], [0, 0.15], [-0.28, -0.05]]);
  arc(ctx, s, -0.42, -0.42, 0.16, Math.PI * 0.5, Math.PI * 1.5);
  arc(ctx, s, 0.42, -0.42, 0.16, -Math.PI * 0.5, Math.PI * 0.5);
  lines(ctx, s, [[[0, 0.15], [0, 0.4]]]);
  rect(ctx, s, -0.28, 0.4, 0.56, 0.16);
};

const pencil: PictogramFn = (ctx, s) => {
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  rect(ctx, s, -0.55, -0.13, 0.9, 0.26);
  poly(ctx, s, [[0.35, -0.13], [0.62, 0], [0.35, 0.13]], false);
  lines(ctx, s, [
    [[-0.38, -0.13], [-0.38, 0.13]],
    [[0.5, -0.06], [0.55, 0.04]],
  ]);
  ctx.restore();
};

const envelope: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.7, -0.42, 1.4, 0.84);
  lines(ctx, s, [[[-0.7, -0.42], [0, 0.12], [0.7, -0.42]]]);
};

const umbrella: PictogramFn = (ctx, s) => {
  arc(ctx, s, 0, 0, 0.7, Math.PI, TAU);
  arc(ctx, s, -0.47, 0, 0.235, 0, Math.PI);
  arc(ctx, s, 0, 0, 0.235, 0, Math.PI);
  arc(ctx, s, 0.47, 0, 0.235, 0, Math.PI);
  lines(ctx, s, [[[0, -0.7], [0, -0.55]], [[0, 0.235], [0, 0.6]]]);
  arc(ctx, s, -0.12, 0.6, 0.12, 0, Math.PI);
};

const bed: PictogramFn = (ctx, s) => {
  lines(ctx, s, [
    [[-0.75, -0.35], [-0.75, 0.45]],
    [[0.72, 0.1], [0.72, 0.45]],
  ]);
  rect(ctx, s, -0.75, 0.1, 1.47, 0.28);
  rect(ctx, s, -0.62, -0.12, 0.35, 0.2);
  ctx.font = `${Math.max(8, 0.26 * s)}px "JetBrains Mono", monospace`;
  ctx.textAlign = "center";
  ctx.fillText("z", 0.3 * s, -0.35 * s);
  ctx.fillText("z", 0.48 * s, -0.55 * s);
};

const dumbbell: PictogramFn = (ctx, s) => {
  lines(ctx, s, [[[-0.45, 0], [0.45, 0]]]);
  rect(ctx, s, -0.62, -0.32, 0.16, 0.64);
  rect(ctx, s, 0.46, -0.32, 0.16, 0.64);
  rect(ctx, s, -0.82, -0.2, 0.14, 0.4);
  rect(ctx, s, 0.68, -0.2, 0.14, 0.4);
};

const calendar: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.6, -0.5, 1.2, 1.05);
  lines(ctx, s, [
    [[-0.6, -0.22], [0.6, -0.22]],
    [[-0.3, -0.65], [-0.3, -0.4]],
    [[0.3, -0.65], [0.3, -0.4]],
  ]);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) dot(ctx, s, -0.32 + c * 0.32, 0.02 + r * 0.26);
};

const chart: PictogramFn = (ctx, s) => {
  lines(ctx, s, [
    [[-0.65, -0.55], [-0.65, 0.55], [0.7, 0.55]],
    [[-0.5, 0.3], [-0.15, -0.02], [0.1, 0.15], [0.55, -0.35]],
    [[0.38, -0.35], [0.55, -0.35], [0.55, -0.18]],
  ]);
};

const bridge: PictogramFn = (ctx, s) => {
  lines(ctx, s, [[[-0.9, 0.15], [0.9, 0.15]]]);
  arc(ctx, s, 0, 0.15, 0.55, Math.PI, TAU);
  ctx.beginPath();
  for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const y = 0.15 - Math.sqrt(Math.max(0, 0.55 * 0.55 - x * x));
    ctx.moveTo(x * s, y * s);
    ctx.lineTo(x * s, 0.15 * s);
  }
  ctx.stroke();
  lines(ctx, s, [[[-0.9, 0.4], [0.9, 0.4]]]);
};

const food: PictogramFn = (ctx, s) => {
  lines(ctx, s, [
    [[-0.35, 0.7], [-0.35, -0.1]],
    [[-0.5, -0.65], [-0.5, -0.25]],
    [[-0.35, -0.65], [-0.35, -0.25]],
    [[-0.2, -0.65], [-0.2, -0.25]],
  ]);
  arc(ctx, s, -0.35, -0.25, 0.15, 0, Math.PI);
  lines(ctx, s, [[[0.35, 0.7], [0.35, -0.05]]]);
  ctx.beginPath();
  ctx.moveTo(0.35 * s, -0.05 * s);
  ctx.bezierCurveTo(0.15 * s, -0.25 * s, 0.15 * s, -0.55 * s, 0.35 * s, -0.68 * s);
  ctx.lineTo(0.35 * s, -0.05 * s);
  ctx.stroke();
};

const gift: PictogramFn = (ctx, s) => {
  rect(ctx, s, -0.5, -0.1, 1.0, 0.72);
  rect(ctx, s, -0.58, -0.32, 1.16, 0.22);
  lines(ctx, s, [[[0, -0.32], [0, 0.62]]]);
  arc(ctx, s, -0.16, -0.45, 0.14, Math.PI * 0.4, Math.PI * 1.7);
  arc(ctx, s, 0.16, -0.45, 0.14, Math.PI * 1.3, Math.PI * 2.6);
};

// ── word → pictogram index ──────────────────────────────────────────────

const LIBRARY: Array<[PictogramFn, string]> = [
  [tree, "tree forest pine oak woods jungle"],
  [flower, "flower rose garden bloom tulip daisy"],
  [mountain, "mountain hill peak alps hike hiking climb climbing summit"],
  [sun, "sun sunny sunshine summer sunrise sunset"],
  [moon, "moon night lunar midnight"],
  [star, "star stars galaxy"],
  [cloud, "cloud sky fog weather"],
  [rain, "rain rainy storm drizzle thunderstorm"],
  [snow, "snow winter snowflake ice frost"],
  [fire, "fire flame burn campfire bonfire"],
  [wave, "ocean sea wave beach surf surfing water lake river swim swimming pool"],
  [leaf, "leaf plant autumn spring"],
  [person, "person people friend family human crowd team"],
  [heart, "love heart romance valentine wedding"],
  [dog, "dog puppy pet"],
  [cat, "cat kitten kitty"],
  [bird, "bird wings sparrow crow"],
  [fish, "fish fishing salmon aquarium"],
  [eye, "eye eyes vision sight watch"],
  [brain, "brain mind memory think thinking thought dream dreams idea"],
  [house, "house home cabin cottage"],
  [city, "city building downtown skyline apartment office"],
  [car, "car drive driving road roadtrip traffic taxi"],
  [bike, "bike bicycle cycling ride"],
  [boat, "boat sail sailing ship ferry yacht"],
  [plane, "plane flight fly airport travel trip vacation airline"],
  [rocket, "rocket launch space mars orbit nasa spaceship"],
  [train, "train subway metro railway station"],
  [coffee, "coffee tea cafe latte espresso mug cappuccino"],
  [book, "book read reading novel study studying library chapter"],
  [music, "music song concert playlist album melody band piano guitar"],
  [camera, "camera photo photography picture movie video film"],
  [phone, "phone call text iphone"],
  [computer, "computer laptop code coding programming software app website developer"],
  [clock, "clock time hour schedule deadline meeting"],
  [key, "key unlock secret password"],
  [lightbulb, "lightbulb inspiration insight eureka"],
  [gear, "gear machine engine mechanic factory tool tools settings system"],
  [money, "money cash budget salary pay price cost rent dollar invoice finance"],
  [trophy, "goal win winning trophy achievement success prize victory champion"],
  [pencil, "write writing pencil pen draw drawing sketch essay poem"],
  [envelope, "email mail letter message inbox newsletter"],
  [umbrella, "umbrella"],
  [bed, "sleep sleeping bed tired nap rest insomnia"],
  [dumbbell, "gym workout exercise training fitness lift run running"],
  [calendar, "calendar week month plan plans planning date event appointment"],
  [chart, "growth progress stats data chart graph revenue sales metric metrics"],
  [bridge, "bridge"],
  [food, "dinner lunch breakfast food meal restaurant cook cooking recipe kitchen"],
  [gift, "gift present birthday christmas holiday anniversary"],
];

const INDEX = new Map<string, PictogramFn>();
for (const [fn, words] of LIBRARY) {
  for (const word of words.split(/\s+/)) INDEX.set(word, fn);
}

function lookup(word: string): PictogramFn | null {
  const direct = INDEX.get(word);
  if (direct) return direct;
  if (word.endsWith("es")) {
    const f = INDEX.get(word.slice(0, -2));
    if (f) return f;
  }
  if (word.endsWith("s")) {
    const f = INDEX.get(word.slice(0, -1));
    if (f) return f;
  }
  return null;
}

/** Find a pictogram for a concept term. Multi-word entities match on their
 * head noun first ("golden gate bridge" → bridge). Returns null when the
 * term has no drawing — caller falls back to abstract schematic modules. */
export function pictogramFor(term: string): PictogramFn | null {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  const words = t.split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const f = lookup(words[i]!);
    if (f) return f;
  }
  return null;
}

/** Exposed for tests. */
export const PICTOGRAM_WORD_COUNT = INDEX.size;
