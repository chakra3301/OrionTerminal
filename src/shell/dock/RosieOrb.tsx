import { useEffect, useRef } from "react";
import { orbModel, particlePhysics } from "./orbModel";
import { drawOrb, type OrbCanvas } from "./orbCanvas";

const MODEL = orbModel();
export function RosieOrb({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, x = cv?.getContext("2d");
    if (!cv || !x) return;
    const q = Math.min(window.devicePixelRatio || 1, 2) * 1.25, P = Math.round(96 * q), style = getComputedStyle(cv);
    cv.width = cv.height = P;
    const orb: OrbCanvas = { x, P, R: 25 * q, q, model: MODEL,
      color: style.getPropertyValue("--dock-cyan").trim(), coreColor: style.getPropertyValue("--dock-orb-core").trim(), m: null, last: null,
      st: { shell: particlePhysics(MODEL.shell), nodes: particlePhysics(MODEL.nodes), spikes: particlePhysics(MODEL.spikes), core: particlePhysics(MODEL.core) },
      nodeXY: new Float32Array(MODEL.nodes.pts.length * 3) };
    const move = (event: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      orb.m = inside ? { x: (event.clientX - r.left) * P / r.width, y: (event.clientY - r.top) * P / r.height } : null;
    };
    const leave = () => { orb.m = orb.last = null; };
    let frame = 0;
    const start = performance.now();
    const draw = (now: number) => { drawOrb(orb, (now - start) / 1000, reduced); frame = requestAnimationFrame(draw); };
    const visibility = () => {
      cancelAnimationFrame(frame); leave();
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    window.addEventListener("pointermove", move); window.addEventListener("mouseleave", leave);
    document.addEventListener("visibilitychange", visibility); visibility();
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); window.removeEventListener("mouseleave", leave); document.removeEventListener("visibilitychange", visibility); };
  }, [reduced]);
  return <canvas ref={ref} className="ot-dock-orb" aria-hidden="true" />;
}
