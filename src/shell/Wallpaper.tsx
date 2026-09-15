import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { STOCK_WALLPAPER_URL, useWallpaperStore } from "@/store/wallpaperStore";
import { useShell } from "@/shell/store/useShell";
import { CoreOverlay } from "@/shell/CoreOverlay";

export function Wallpaper() {
  const mode = useWallpaperStore((s) => s.mode);
  const customPath = useWallpaperStore((s) => s.customPath);
  const overlay = useWallpaperStore((s) => s.overlay);
  const overlayIntensity = useWallpaperStore((s) => s.overlayIntensity);
  const matrixHue = useWallpaperStore((s) => s.matrixHue);
  const hasCustom = mode === "custom" && !!customPath;
  const customUrl = hasCustom ? convertFileSrc(customPath!) : null;

  return (
    <div
      className="ot-wallpaper"
      aria-hidden
      data-custom={hasCustom ? "1" : "0"}
      data-overlay={overlay}
    >
      <div
        className="ot-wp-custom"
        style={{ backgroundImage: `url("${customUrl ?? STOCK_WALLPAPER_URL}")` }}
      />
      {overlay !== "none" && <div
        className="ot-wp-overlay"
        style={{ opacity: overlayIntensity }}
      >
        {/* Add new overlays here as `overlay === "..."` branches. */}
        {overlay === "matrix" && <MatrixCanvas hue={matrixHue} />}
        {overlay === "core" && <CoreOverlay />}
      </div>}
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

function MatrixCanvas({ hue }: { hue: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef(hue);
  hueRef.current = hue;

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
        const h = hueRef.current;

        ctx.fillStyle = `hsla(${h}, 100%, 92%, 0.95)`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `hsla(${h}, 100%, 60%, 0.85)`;
        ctx.fillText(head ?? "", x, y);

        if (row > 1) {
          const trail =
            MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
          ctx.shadowBlur = 0;
          ctx.fillStyle = `hsla(${h}, 100%, 60%, 0.55)`;
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
