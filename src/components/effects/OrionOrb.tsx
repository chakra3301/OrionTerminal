import { ThinkingOrb, type OrbState as ThinkingState } from "thinking-orbs";
import type { CSSProperties } from "react";
import "./effects.css";
import { isLightTheme, useThemeStore } from "@/store/themeStore";

export type OrbState = ThinkingState | "idle" | "thinking" | "error";

export function OrionOrb({ state = "idle", size = 20, label, speed = 1, paused = false }: {
  state?: OrbState;
  size?: number;
  label?: string;
  speed?: number;
  paused?: boolean;
  // Existing callers supply their app accent; the library stays monochrome.
  accent?: string;
}) {
  const light = useThemeStore(s => isLightTheme(s.theme));
  const orbSize = size >= 40 ? 64 : 20;
  const orbState: ThinkingState = state === "thinking" ? "solving" : state === "idle" || state === "error" ? "breathing" : state;
  return <span className="orion-orb" style={{ "--orb-size": `${orbSize}px` } as CSSProperties} aria-hidden={label ? undefined : true}>
    <ThinkingOrb state={orbState} size={orbSize} theme={light ? "light" : "dark"} speed={speed}
      paused={paused || state === "idle" || state === "error"} aria-label={label ?? (state === "idle" ? "Assistant" : state === "error" ? "Assistant error" : undefined)} />
  </span>;
}

export function AiActivity({ label = "thinking", working = false, state }: {
  label?: string;
  working?: boolean;
  state?: ThinkingState;
  accent?: string;
}) {
  return <span className="orion-ai-activity" role="status">
    <OrionOrb state={state ?? (working ? "working" : "thinking")} size={20} />
    <span>{label}</span>
  </span>;
}
