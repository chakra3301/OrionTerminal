export const canvas = (size: number): HTMLCanvasElement => {
  const c = document.createElement("canvas"); c.width = c.height = size; return c;
};
export const context = (c: HTMLCanvasElement) => c.getContext("2d")!;
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const rgba = (color: string, alpha: number) => `rgba(${[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(",")},${alpha})`;

type Mask = { img: HTMLCanvasElement; box: { x: number; y: number; w: number; h: number } };
const masks = new Map<string, Promise<Mask>>();
export function loadMask(src: string): Promise<Mask> {
  let pending = masks.get(src);
  if (!pending) {
    pending = (async () => {
      const image = new Image(); image.src = src; await image.decode();
      const c = canvas(512), x = context(c); x.drawImage(image, 0, 0, 512, 512);
      const data = x.getImageData(0, 0, 512, 512).data;
      let x0 = 512, y0 = 512, x1 = -1, y1 = -1;
      for (let y = 0; y < 512; y++) for (let i = 0; i < 512; i++) if (data[(y * 512 + i) * 4 + 3]! > 8) {
        x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x1 < x0) throw new Error("Empty dock glyph");
      return { img: c, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
    })();
    masks.set(src, pending);
    void pending.catch(() => masks.delete(src));
  }
  return pending;
}

function glyph(g: Mask, P: number, s: number, frac: number, grow = 1) {
  const c = canvas(P), x = context(c), b = g.box, k = (frac * s * grow) / Math.max(b.w, b.h);
  x.imageSmoothingQuality = "high";
  x.drawImage(g.img, b.x, b.y, b.w, b.h, P / 2 - b.w * k / 2, P / 2 - b.h * k / 2, b.w * k, b.h * k);
  return c;
}
function tint(src: HTMLCanvasElement, color: string) {
  const c = canvas(src.width), x = context(c); x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.width); return c;
}
function glow(src: HTMLCanvasElement, color: string, radius: number) {
  const c = canvas(src.width), x = context(c), off = c.width * 2;
  // Off-canvas source drawing keeps just the shadow, including on WebKit without canvas filters.
  x.shadowColor = color; x.shadowBlur = radius; x.shadowOffsetX = off; x.drawImage(src, -off, 0); return c;
}
function innerRing(src: HTMLCanvasElement, width: number) {
  const e = canvas(src.width), ex = context(e); ex.drawImage(src, 0, 0); ex.globalCompositeOperation = "destination-in";
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; ex.drawImage(src, Math.cos(a) * width, Math.sin(a) * width); }
  const c = canvas(src.width), x = context(c); x.drawImage(src, 0, 0); x.globalCompositeOperation = "destination-out"; x.drawImage(e, 0, 0); return c;
}
function rim(mask: HTMLCanvasElement, dy: number) {
  const c = canvas(mask.width), x = context(c); x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = "destination-out"; x.drawImage(mask, 0, dy); return c;
}
let noise: HTMLCanvasElement | undefined;
function grain() {
  if (!noise) {
    noise = canvas(96); const x = context(noise), data = x.createImageData(96, 96);
    for (let i = 0; i < data.data.length; i += 4) {
      const value = Math.random() * 255; data.data[i] = data.data[i + 1] = data.data[i + 2] = value; data.data[i + 3] = 255;
    }
    x.putImageData(data, 0, 0);
  }
  return noise;
}

export type IconCanvas = {
  P: number; s: number; q: number; o: number; frac: number; color: string; g: Mask;
  h: number; r: number; px: number; py: number; scratch: HTMLCanvasElement;
};
function emboss(ic: IconCanvas, mask: HTMLCanvasElement) {
  const d = (ic.frac < 0.6 ? 0.6 : 1.1) * ic.q, c = canvas(ic.P), x = context(c);
  const layer = (src: HTMLCanvasElement, color: string, alpha: number) => { x.globalAlpha = alpha; x.drawImage(tint(src, color), 0, 0); };
  x.globalAlpha = 0.45; x.drawImage(glow(mask, "#000", ic.s * 0.04), 0, d * 1.5);
  x.globalAlpha = 1; x.globalCompositeOperation = "destination-out"; x.drawImage(mask, 0, 0); x.globalCompositeOperation = "source-over";
  layer(mask, "#fff", 0.07); layer(rim(mask, d), "#fff", 0.55); layer(rim(mask, -d), "#000", 0.45);
  x.globalAlpha = 1; return c;
}
export function prep(ic: IconCanvas) {
  const { P, s, q, color } = ic, m = glyph(ic.g, P, s, ic.frac), span = ic.frac * s, top = P / 2 - span / 2;
  const body = canvas(P), bx = context(body);
  bx.drawImage(m, 0, 0); bx.globalCompositeOperation = "source-in";
  const v = bx.createLinearGradient(0, top, 0, top + span); v.addColorStop(0, "rgba(255,255,255,.72)"); v.addColorStop(1, "rgba(255,255,255,.3)");
  bx.fillStyle = v; bx.fillRect(0, 0, P, P); bx.globalCompositeOperation = "source-atop";
  bx.globalAlpha = 0.64; bx.fillStyle = color; bx.fillRect(0, 0, P, P);
  bx.globalAlpha = 0.12; bx.fillStyle = bx.createPattern(grain(), "repeat")!; bx.fillRect(0, 0, P, P);
  const edge = tint(innerRing(m, q), "#fff"), rx = context(edge), rg = rx.createLinearGradient(0, top, 0, top + span);
  rg.addColorStop(0, "#000"); rg.addColorStop(1, "rgba(0,0,0,.2)");
  rx.globalCompositeOperation = "destination-in"; rx.fillStyle = rg; rx.fillRect(0, 0, P, P);
  bx.globalAlpha = 0.9; bx.drawImage(edge, 0, 0);
  return { m, body, emb: emboss(ic, m), drop: glow(m, "#000", s * 0.05), bloom: glow(glyph(ic.g, P, s, ic.frac, 1.15), color, s * 0.2) };
}
export function drawIcon(ic: IconCanvas, x: CanvasRenderingContext2D, layers: ReturnType<typeof prep>) {
  const { s, h, px, py, P, o, r } = ic;
  x.clearRect(0, 0, P, P);
  if (r < 0.99) { x.globalAlpha = 1 - r; x.drawImage(layers.emb, 0, 0); }
  if (r < 0.01) { x.globalAlpha = 1; return; }
  x.globalAlpha = 0.55 * r; x.drawImage(layers.drop, 0, s * 0.035);
  x.globalCompositeOperation = "lighter"; x.globalAlpha = (0.68 + 0.3 * h) * r; x.drawImage(layers.bloom, px * s * 0.06, py * s * 0.06);
  x.globalCompositeOperation = "source-over"; x.globalAlpha = r; x.drawImage(layers.body, 0, 0);
  if (h > 0.01) {
    const k = context(ic.scratch);
    k.globalCompositeOperation = "source-over"; k.clearRect(0, 0, P, P); k.drawImage(layers.m, 0, 0); k.globalCompositeOperation = "source-in";
    const center = 0.5 + px * 0.35, g = k.createLinearGradient(o, o, o + s, o + s);
    g.addColorStop(clamp01(center - 0.16), "rgba(255,255,255,0)"); g.addColorStop(clamp01(center), `rgba(255,255,255,${0.6 * h * r})`); g.addColorStop(clamp01(center + 0.16), "rgba(255,255,255,0)");
    k.fillStyle = g; k.fillRect(0, 0, P, P); x.drawImage(ic.scratch, 0, 0);
  }
  x.globalAlpha = 1;
}
