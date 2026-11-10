import { useEffect, useMemo, useRef, useState } from "react";
import { orbModel, particlePhysics } from "@/shell/dock/orbModel";
import { drawOrb, type OrbCanvas } from "@/shell/dock/orbCanvas";
import { generateGlyph } from "./glyph";
import { spatialIdentity } from "./spatialIdentity";
import { subscribeOrb } from "./orbFrames";
import { identityAccent } from "./color";
import { particleSurface, surfaceKind } from "./particleSurface";

const MODEL = orbModel();
export const orbAccent = (value: string, identity?: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : identity ? identityAccent(identity) : "#00e0ff";
const coreAccent = (color: string) => `#${[1, 3, 5].map((i) => Math.round(parseInt(color.slice(i, i + 2), 16) * .38 + 255 * .62).toString(16).padStart(2, "0")).join("")}`;

export function ParticleOrb({ identity, accent, size = 64, reduced: override, showField = true }: { identity: string; accent: string; size?: number; reduced?: boolean; showField?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [prefersReduced, setPrefersReduced] = useState(() => typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = override ?? prefersReduced;
  const glyph = useMemo(() => generateGlyph(identity), [identity]);
  const spatial = useMemo(() => spatialIdentity(identity), [identity]);
  const color = orbAccent(accent, identity);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"), change = () => setPrefersReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const cv = ref.current, x = cv?.getContext("2d");
    setReady(false);
    if (!cv || !x) return;
    let disposed = false, onscreen = true, stop: (() => void) | undefined;
    const q = Math.min(window.devicePixelRatio || 1, 2) * 1.25, P = Math.round(size * q);
    cv.width = cv.height = P;
    const orb: OrbCanvas = {
      x, P, R: size * .375 * q, q, model: MODEL, color, coreColor: coreAccent(color), m: null, last: null,
      st: { shell: particlePhysics(MODEL.shell), nodes: particlePhysics(MODEL.nodes), spikes: particlePhysics(MODEL.spikes), core: particlePhysics(MODEL.core) },
      nodeXY: new Float32Array(MODEL.nodes.pts.length * 3),
    };
    const since = performance.now(), phase = glyph.seed % 1000 / 100;
    let loaded = false, lastDraw = -Infinity;
    const draw = (now: number) => {
      if (!reduced && now - lastDraw < 1000 / 30) return;
      lastDraw = now;
      drawOrb(orb, reduced ? 0 : (now - since) / 1000 + phase, reduced);
      if (reduced && !orb.m) {
        const states = [...Object.values(orb.st), ...(orb.glyph ? [orb.glyph.state, ...(orb.glyph.surface ? [orb.glyph.surface.state] : [])] : [])];
        const moving = states.some((s) => s.ox.some((v, i) => Math.abs(v) + Math.abs(s.oy[i]!) + Math.abs(s.vx[i]!) + Math.abs(s.vy[i]!) > .02));
        if (!moving) { stop?.(); stop = undefined; }
      }
    };
    const wake = () => {
      if (loaded && !disposed && onscreen && !document.hidden && !stop) stop = subscribeOrb(draw);
    };
    const pause = () => { stop?.(); stop = undefined; orb.m = orb.last = null; };
    const visibility = () => {
      pause();
      if (!document.hidden && onscreen && loaded) { if (reduced) drawOrb(orb, 0, true); wake(); }
    };
    const move = (event: PointerEvent) => {
      if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches || event.pointerType === "touch") return;
      const r = cv.getBoundingClientRect();
      orb.m = { x: (event.clientX - r.left) * P / r.width, y: (event.clientY - r.top) * P / r.height };
      wake();
    };
    const leave = () => { orb.m = orb.last = null; wake(); };
    const host = cv.parentElement!;
    host.addEventListener("pointermove", move); host.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onscreen = entry?.isIntersecting ?? false; visibility();
    });
    observer?.observe(cv);
    const ink = () => getComputedStyle(document.documentElement).getPropertyValue("--t-primary").trim() || "#ffffff";
    const themeObserver = new MutationObserver(() => {
      if (!orb.glyph) return;
      orb.glyph.ink = ink();
      if (loaded && !stop && onscreen && !document.hidden) drawOrb(orb, reduced ? 0 : (performance.now() - since) / 1000 + phase, reduced);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-color-mode", "style"] });
    orb.glyph = { spatial, state: particlePhysics(spatial.group), showField, ink: ink(), surface: showField ? particleSurface(identity, size, spatial.kind) : undefined };
    loaded = true; setReady(true); drawOrb(orb, reduced ? 0 : phase, reduced); wake();
    return () => {
      disposed = true; pause(); observer?.disconnect(); themeObserver.disconnect();
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [glyph, spatial, color, size, reduced, showField]);
  return <span className="identity-orb" data-identity={identity} data-form={spatial.kind} data-field={showField ? surfaceKind(identity, spatial.kind) : "none"} aria-hidden="true" style={{ display: "inline-block", position: "relative", width: size, height: size, flexShrink: 0, color }}>
    <canvas ref={ref} style={{ display: "block", width: size, height: size, visibility: ready ? "visible" : "hidden" }} />
    {!ready && <svg viewBox="0 0 64 64" style={{ position: "absolute", inset: "20%", width: "60%", height: "60%" }}><path d={glyph.path} fill="currentColor" fillRule="evenodd" /></svg>}
  </span>;
}
