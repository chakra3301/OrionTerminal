import { useEffect, useState, type CSSProperties } from "react";
import { useThemeStore, type ThemeName } from "@/store/themeStore";
import "./themeSphere.css";

export function ThemeSphere({ theme }: { theme: ThemeName }) {
  const [src, setSrc] = useState<string>();
  const customs = useThemeStore(s => s.customThemes);
  const tint = customs.find(t => t.id === theme)?.colors.accent;
  useEffect(() => {
    let cancelled = false;
    void import("./renderThemeSpheres").then((m) => m.themeSphereImages()).then((images) => {
      if (!cancelled) setSrc(images[theme]);
    }).catch(() => { /* Keep a static material swatch if WebGL is unavailable. */ });
    return () => { cancelled = true; };
  }, [theme, customs]);
  return <span className="ot-theme-sphere" style={tint ? { "--sphere-tint": tint } as CSSProperties : undefined} data-material={theme} aria-hidden="true" data-rendered={!!src}>
    {src && <img src={src} alt="" width={64} height={64} draggable={false} />}
  </span>;
}
