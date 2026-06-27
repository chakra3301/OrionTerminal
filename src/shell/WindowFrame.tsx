import { useCallback, useRef, type ReactNode } from "react";
import { useShell, type WindowState } from "@/shell/store/useShell";
import { useDraggable } from "@/shell/useDraggable";

type WindowFrameProps = {
  window: WindowState;
  focused: boolean;
  title: string;
  subtitle?: string;
  occluded?: boolean;
  children: ReactNode;
};

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Match the visual min in tokens.css `.ot-window { min-width / min-height }`.
const MIN_W = 480;
const MIN_H = 320;
const MENUBAR_H = 44;

export function WindowFrame({
  window: w,
  focused,
  title,
  subtitle,
  occluded,
  children,
}: WindowFrameProps) {
  const moveWindow = useShell((s) => s.moveWindow);
  const resizeWindow = useShell((s) => s.resizeWindow);
  const focusWindow = useShell((s) => s.focusWindow);
  const minimizeWindow = useShell((s) => s.minimizeWindow);
  const toggleMaximize = useShell((s) => s.toggleMaximize);
  const toggleFullscreen = useShell((s) => s.toggleFullscreen);

  const startRef = useRef<{ x: number; y: number }>({ x: w.x, y: w.y });

  const { onMouseDown } = useDraggable({
    onStart: () => {
      startRef.current = { x: w.x, y: w.y };
      focusWindow(w.id);
    },
    onDrag: (dx, dy) => {
      if (w.maximized) return;
      moveWindow(w.id, startRef.current.x + dx, startRef.current.y + dy);
    },
  });

  const startResize = useCallback(
    (direction: ResizeDirection) => (e: React.MouseEvent) => {
      if (w.maximized) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      focusWindow(w.id);

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = w.w;
      const startH = w.h;
      const startWinX = w.x;
      const startWinY = w.y;

      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let nextW = startW;
        let nextH = startH;
        let nextX = startWinX;
        let nextY = startWinY;

        if (direction.includes("e")) {
          nextW = Math.max(MIN_W, startW + dx);
        }
        if (direction.includes("w")) {
          // Keep the RIGHT edge fixed. Compute new width, then derive x so
          // (x + w) is constant relative to the start.
          const proposedW = Math.max(MIN_W, startW - dx);
          nextW = proposedW;
          nextX = startWinX + startW - proposedW;
        }
        if (direction.includes("s")) {
          nextH = Math.max(MIN_H, startH + dy);
        }
        if (direction.includes("n")) {
          // Keep the BOTTOM edge fixed.
          const proposedH = Math.max(MIN_H, startH - dy);
          nextH = proposedH;
          // Don't allow the title bar to slide under the menubar.
          nextY = Math.max(MENUBAR_H, startWinY + startH - proposedH);
          // If the menubar clamp shrunk our budget, claw the height back so
          // the bottom edge holds steady.
          const consumed = nextY - (startWinY + startH - proposedH);
          if (consumed > 0) nextH = Math.max(MIN_H, proposedH - consumed);
        }

        if (nextX !== w.x || nextY !== w.y) {
          moveWindow(w.id, nextX, nextY);
        }
        if (nextW !== w.w || nextH !== w.h) {
          resizeWindow(w.id, nextW, nextH);
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = prevUserSelect;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [w.id, w.maximized, w.w, w.h, w.x, w.y, focusWindow, moveWindow, resizeWindow],
  );

  const style: React.CSSProperties = w.fullscreen
    ? { zIndex: 1700 }
    : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z };

  return (
    <div
      className={`ot-window${focused ? "" : " unfocused"}${w.fullscreen ? " fullscreen" : ""}`}
      style={style}
      onMouseDown={() => focusWindow(w.id)}
    >
      <div
        className="ot-titlebar"
        onMouseDown={w.fullscreen ? undefined : onMouseDown}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
          toggleFullscreen(w.id);
        }}
      >
        <div className="ot-traffic" data-no-drag>
          <button
            type="button"
            className="light close"
            title="Close"
            onClick={(e) => {
              e.stopPropagation();
              minimizeWindow(w.id);
            }}
          />
          <button
            type="button"
            className="light min"
            title="Minimize"
            onClick={(e) => {
              e.stopPropagation();
              minimizeWindow(w.id);
            }}
          />
          <button
            type="button"
            className="light max"
            title="Maximize"
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximize(w.id);
            }}
          />
        </div>
        <div className="ot-window-title">
          <span className="accent">{title}</span>
          {subtitle ? <span> · {subtitle}</span> : null}
        </div>
        <div className="ot-window-tools" data-no-drag>
          <button
            type="button"
            className="ot-fs-btn"
            title={w.fullscreen ? "Exit Full Screen (Esc)" : "Enter Full Screen"}
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen(w.id);
            }}
          >
            {w.fullscreen ? "⤬" : "⤢"}
          </button>
          <span className="kbd">⌘K</span>
        </div>
      </div>
      <div
        className="ot-window-body"
        style={occluded ? { contentVisibility: "hidden" } : undefined}
      >
        {children}
      </div>

      {!w.maximized && !w.fullscreen && (
        <>
          <div className="ot-rh n" onMouseDown={startResize("n")} />
          <div className="ot-rh s" onMouseDown={startResize("s")} />
          <div className="ot-rh e" onMouseDown={startResize("e")} />
          <div className="ot-rh w" onMouseDown={startResize("w")} />
          <div className="ot-rh ne" onMouseDown={startResize("ne")} />
          <div className="ot-rh nw" onMouseDown={startResize("nw")} />
          <div className="ot-rh se" onMouseDown={startResize("se")} />
          <div className="ot-rh sw" onMouseDown={startResize("sw")} />
        </>
      )}
    </div>
  );
}
