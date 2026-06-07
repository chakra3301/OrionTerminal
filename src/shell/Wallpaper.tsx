import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useWallpaperStore } from "@/store/wallpaperStore";
import { useShell } from "@/shell/store/useShell";

const stars: Array<{ x: number; y: number; bright?: boolean }> = [
  { x: 30, y: 20, bright: true },
  { x: 170, y: 50, bright: true },
  { x: 95, y: 110 },
  { x: 110, y: 130, bright: true },
  { x: 130, y: 150 },
  { x: 50, y: 220, bright: true },
  { x: 180, y: 240 },
];

const constellationLines: Array<[number, number]> = [
  [0, 2],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 5],
  [2, 6],
];

export function Wallpaper() {
  const mode = useWallpaperStore((s) => s.mode);
  const customPath = useWallpaperStore((s) => s.customPath);
  const overlay = useWallpaperStore((s) => s.overlay);
  const overlayIntensity = useWallpaperStore((s) => s.overlayIntensity);
  const hasCustom = mode === "custom" && !!customPath;
  const customUrl = hasCustom ? convertFileSrc(customPath!) : null;

  return (
    <div
      className="ot-wallpaper"
      aria-hidden
      data-custom={hasCustom ? "1" : "0"}
      data-overlay={overlay}
    >
      {customUrl && (
        <div
          className="ot-wp-custom"
          style={{ backgroundImage: `url("${customUrl}")` }}
        />
      )}
      <div
        className="ot-wp-overlay"
        style={{ opacity: hasCustom ? overlayIntensity : 1 }}
      >
        {overlay === "aurora" && <AuroraLayers />}
        {overlay === "matrix" && <MatrixCanvas />}
        {overlay === "stars" && <StarsLayers />}
      </div>
    </div>
  );
}

function AuroraLayers() {
  return (
    <>
      <div className="ot-wp-aurora a1" />
      <div className="ot-wp-aurora a2" />
      <div className="ot-wp-aurora a3" />
      <div className="ot-wp-stars" />
      <div className="ot-wp-grid" />
      <div className="ot-wp-horizon" />
      <Constellation />
    </>
  );
}

function StarsLayers() {
  return (
    <>
      <div className="ot-wp-stars-deep" />
      <div className="ot-wp-stars-mid" />
      <div className="ot-wp-stars-near" />
      <Constellation />
    </>
  );
}

function Constellation() {
  return (
    <div className="ot-wp-constellation">
      <svg viewBox="0 0 220 280">
        {constellationLines.map(([a, b], i) => {
          const sa = stars[a];
          const sb = stars[b];
          if (!sa || !sb) return null;
          return (
            <line
              key={i}
              x1={sa.x + 2}
              y1={sa.y + 2}
              x2={sb.x + 2}
              y2={sb.y + 2}
            />
          );
        })}
      </svg>
      {stars.map((s, i) => (
        <div
          key={i}
          className={`star${s.bright ? " bright" : ""}`}
          style={{ left: s.x, top: s.y }}
        />
      ))}
    </div>
  );
}

// Half-width katakana + full-width katakana + digits + a few latin chars,
// roughly mimicking the original Matrix glyph soup. Picked deliberately so
// each frame has visual variety without long Unicode tables.
const MATRIX_CHARS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ" +
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ" +
  "0123456789ABCDEF{}<>+=/*";

function MatrixCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const fontSize = 16;
    const lineHeight = fontSize + 2;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let cssW = 0;
    let cssH = 0;
    let drops: number[] = [];

    const setupCanvas = () => {
      cssW = window.innerWidth;
      cssH = window.innerHeight;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#03060a";
      ctx.fillRect(0, 0, cssW, cssH);

      const cols = Math.ceil(cssW / fontSize);
      drops = Array.from({ length: cols }, () =>
        Math.floor(Math.random() * -cssH / lineHeight),
      );
    };

    setupCanvas();

    let raf = 0;
    let running = false;
    let last = performance.now();
    const FRAME_INTERVAL = reduceMotion ? 200 : 1000 / 22;

    // The matrix rain is pure decoration — pause it whenever it can't be seen:
    // the OS window is hidden/minimized, or a maximized window fully covers the
    // desktop. Stops a constant repaint (with per-glyph shadowBlur) for nothing.
    const occluded = () =>
      useShell.getState().windows.some((w) => w.maximized && !w.minimized);
    const paused = () => document.hidden || occluded();

    const draw = (now: number) => {
      if (paused()) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_INTERVAL) return;
      last = now;

      ctx.fillStyle = "rgba(3, 6, 10, 0.085)";
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.font = `${fontSize}px "JetBrains Mono", "SF Mono", monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < drops.length; i++) {
        const row = drops[i] ?? 0;
        const x = i * fontSize;
        const y = row * lineHeight;
        const head = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];

        ctx.fillStyle = "rgba(220, 255, 230, 0.95)";
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(57, 255, 136, 0.85)";
        ctx.fillText(head ?? "", x, y);

        if (row > 1) {
          const trail =
            MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(57, 255, 136, 0.55)";
          ctx.fillText(trail ?? "", x, y - lineHeight);
        }

        drops[i] = y > cssH && Math.random() > 0.975 ? 0 : row + 1;
      }
      ctx.shadowBlur = 0;
    };

    const resume = () => {
      if (running || paused()) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };

    resume();

    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", resume);
    // Restart when a window un-maximizes / closes (desktop visible again).
    const unsubShell = useShell.subscribe(resume);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", resume);
      unsubShell();
    };
  }, []);

  return <canvas ref={ref} className="ot-wp-matrix" />;
}
