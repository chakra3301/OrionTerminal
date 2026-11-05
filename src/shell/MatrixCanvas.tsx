import { useEffect } from "react";
import { useVisualActivity } from "@/components/effects/useVisualActivity";
import { useShell } from "@/shell/store/useShell";

const CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ABCDEF{}<>+=/*";

export function MatrixCanvas({ hue, preview = false }: { hue: number; preview?: boolean }) {
  const occluded = useShell((s) => s.windows.some((w) => w.maximized && !w.minimized));
  const { ref, active } = useVisualActivity<HTMLCanvasElement>(preview || !occluded);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const font = preview ? 10 : 16;
    const line = font + 2;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    let width = 0, height = 0, raf = 0, last = 0;
    let drops: number[] = [];
    const draw = () => {
      ctx.fillStyle = "rgba(3, 6, 10, 0.085)";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${font}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < drops.length; i++) {
        const row = drops[i] ?? 0;
        const y = row * line;
        ctx.fillStyle = `hsla(${hue}, 100%, 92%, .95)`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `hsla(${hue}, 100%, 60%, .85)`;
        ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)]!, i * font, y);
        if (row > 1) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = `hsla(${hue}, 100%, 60%, .55)`;
          ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)]!, i * font, y - line);
        }
        drops[i] = y > height && Math.random() > .975 ? 0 : row + 1;
      }
      ctx.shadowBlur = 0;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#03060a"; ctx.fillRect(0, 0, width, height);
      drops = Array.from({ length: Math.ceil(width / font) }, () => Math.floor(Math.random() * height / line) - 14);
      // A settled frame remains informative when reduced motion disables the loop.
      for (let i = 0; i < 14; i++) draw();
    };
    const tick = (now: number) => {
      if (now - last >= 1000 / 22) { draw(); last = now; }
      raf = requestAnimationFrame(tick);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (active) raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [active, hue, preview, ref]);
  return <canvas ref={ref} className="ot-wp-matrix" style={{ width: "100%", height: "100%" }} />;
}
