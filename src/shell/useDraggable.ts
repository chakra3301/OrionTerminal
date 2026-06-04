import { useCallback, useRef } from "react";

type DragOptions = {
  onDrag: (dx: number, dy: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

export function useDraggable(opts: DragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    optsRef.current.onStart?.();

    const move = (ev: MouseEvent) => {
      optsRef.current.onDrag(ev.clientX - startX, ev.clientY - startY);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevUserSelect;
      optsRef.current.onEnd?.();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  return { onMouseDown };
}
