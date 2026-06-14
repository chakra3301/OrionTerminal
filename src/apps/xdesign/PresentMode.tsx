import { useEffect, useRef, useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { useXDesign } from "@/apps/xdesign/store";
import { usePresentMode } from "@/apps/xdesign/presentStore";
import { buildExportSVG } from "@/apps/xdesign/exportXD";
import {
  computeFit,
  hotspotsForScreen,
  type ProtoLink,
} from "@/apps/xdesign/prototype";

/** Full-cover present overlay. Renders the active screen (a top-level frame)
 * via the existing SVG export, fitted to the stage, with transparent clickable
 * hotspots laid over prototyped shapes. Esc exits, ← goes back. */
export function PresentMode() {
  const active = usePresentMode((s) => s.active);
  const screenId = usePresentMode((s) => s.screenId);
  const transition = usePresentMode((s) => s.transition);
  const navSeq = usePresentMode((s) => s.navSeq);
  const exit = usePresentMode((s) => s.exit);
  const navigate = usePresentMode((s) => s.navigate);
  const back = usePresentMode((s) => s.back);
  const history = usePresentMode((s) => s.history);
  const shapes = useXDesign((s) => s.shapes);

  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [svg, setSvg] = useState<string | null>(null);

  const screen = screenId ? shapes.find((s) => s.id === screenId) : null;

  useEffect(() => {
    if (!active) return;
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // Rebuild the screen SVG whenever the active frame (or the doc) changes.
  useEffect(() => {
    if (!active || !screen) {
      setSvg(null);
      return;
    }
    setSvg(
      buildExportSVG({ x: screen.x, y: screen.y, w: screen.w, h: screen.h }),
    );
  }, [active, screenId, screen?.x, screen?.y, screen?.w, screen?.h, shapes]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exit();
      } else if (e.key === "ArrowLeft") {
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, exit, back]);

  if (!active) return null;

  if (!screen) {
    return (
      <div className="xd-present">
        <div className="xd-present-empty">
          No frames to present — create a frame first.
        </div>
        <button
          type="button"
          className="xd-present-close"
          onClick={exit}
          title="Exit (Esc)"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const fit = computeFit(
    screen.w,
    screen.h,
    size.w || screen.w,
    size.h || screen.h,
  );
  const hotspots = hotspotsForScreen(shapes, screen.id);

  const onHotspot = (link: ProtoLink) => {
    if (link.action === "back") back();
    else if (link.target) navigate(link.target, link.transition);
  };

  return (
    <div className="xd-present" ref={stageRef}>
      <div
        key={navSeq}
        className={`xd-present-screen xd-present-anim-${transition}`}
        style={{
          left: fit.offsetX,
          top: fit.offsetY,
          width: screen.w,
          height: screen.h,
          transform: `scale(${fit.scale})`,
          transformOrigin: "top left",
        }}
      >
        {svg && (
          <div
            className="xd-present-svg"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        {hotspots.map((h) => (
          <button
            key={h.id}
            type="button"
            className="xd-present-hotspot"
            style={{
              left: h.x - screen.x,
              top: h.y - screen.y,
              width: h.w,
              height: h.h,
            }}
            onClick={() => onHotspot(h.prototype!)}
            title={h.prototype!.action === "back" ? "Back" : "Navigate"}
          />
        ))}
      </div>
      <div className="xd-present-bar">
        {history.length > 0 && (
          <button
            type="button"
            className="xd-present-barbtn"
            onClick={back}
            title="Back (←)"
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <span className="xd-present-name">{screen.name}</span>
        <button
          type="button"
          className="xd-present-barbtn"
          onClick={exit}
          title="Exit (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
