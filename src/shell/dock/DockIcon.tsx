import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { canvas, drawIcon, loadMask, prep, type IconCanvas } from "./iconCanvas";

export function DockIcon({ glyph, Icon, utility = false, lifted, reduced }: {
  glyph?: string; Icon: LucideIcon; utility?: boolean; lifted: boolean; reduced: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null), sourceRef = useRef<SVGSVGElement>(null);
  const reveal = useRef<((lifted: boolean) => void) | null>(null);
  const current = useRef(lifted); current.current = lifted;
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const cv = ref.current, host = cv?.parentElement, x = cv?.getContext("2d");
    if (!cv || !host || !x) { setFallback(true); return; }
    let disposed = false, frame = 0, cleanup = () => {};
    const src = glyph ?? `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(sourceRef.current!))}`;
    void loadMask(src).then((mask) => {
      if (disposed) return;
      const q = Math.min(window.devicePixelRatio || 1, 2) * 1.6, S = 48, pad = Math.round(S * 0.3), P = Math.round((S + 2 * pad) * q);
      cv.width = cv.height = P;
      const ic: IconCanvas = { P, s: S * q, q, o: pad * q, frac: utility ? 0.44 : 0.8,
        color: getComputedStyle(cv).getPropertyValue("--dock-color").trim(), g: mask, h: 0, r: 0, px: 0, py: 0, scratch: canvas(P) };
      const layers = prep(ic);
      let ht = 0, rt = current.current ? 1 : 0, gx = 0, gy = 0, from = 0, since = performance.now();
      const approach = (value: number, target: number, rate: number) => Math.abs(target - value) < 0.002 ? target : value + (target - value) * rate;
      const draw = (now: number) => {
        frame = 0;
        ic.h = approach(ic.h, ht, 0.14); ic.px = approach(ic.px, gx, 0.14); ic.py = approach(ic.py, gy, 0.14);
        ic.r = reduced ? from + (rt - from) * Math.min(1, (now - since) / 120) : approach(ic.r, rt, 0.16);
        cv.style.transform = `perspective(${S * 5}px) rotateX(${-ic.py * 7 * ic.h}deg) rotateY(${ic.px * 7 * ic.h}deg)`;
        drawIcon(ic, x, layers);
        if (ic.h !== ht || ic.r !== rt || ic.px !== gx || ic.py !== gy) wake();
      };
      const wake = () => { if (!frame && !disposed) frame = requestAnimationFrame(draw); };
      reveal.current = (value) => { from = ic.r; since = performance.now(); rt = value ? 1 : 0; wake(); };
      const move = (event: PointerEvent) => {
        if (reduced || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        const rect = host.getBoundingClientRect();
        gx = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
        gy = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1)); ht = 1; wake();
      };
      const leave = () => { ht = gx = gy = 0; wake(); };
      host.addEventListener("pointermove", move); host.addEventListener("pointerleave", leave);
      cleanup = () => { host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); };
      draw(performance.now());
    }).catch(() => { if (!disposed) setFallback(true); });
    return () => { disposed = true; cancelAnimationFrame(frame); reveal.current = null; cleanup(); };
  }, [glyph, Icon, utility, reduced]);
  useEffect(() => { reveal.current?.(lifted); }, [lifted]);
  return <>
    <canvas ref={ref} className="ot-dock-icon" aria-hidden="true" hidden={fallback} />
    <Icon ref={sourceRef} size={24} color="#fff" strokeWidth={2} className={fallback ? "ot-dock-icon-fallback" : "ot-dock-mask-source"} aria-hidden="true" />
  </>;
}
