import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { MenuButton } from "../EditorMenus";

/** `at` is where the bar was dragged to: its centre and top, in its container's pixels. */
export type TaskBarPlace = { hidden: boolean; pinned: boolean; at: [number, number] | null };
export const TASK_BAR_HOME: TaskBarPlace = { hidden: false, pinned: false, at: null };
const GAP = 8, MARGIN = 12, BOTTOM = 14;

/** Photoshop's Contextual Task Bar: a grip that drags it and a More options menu that hides, resets or pins it.
 * Until it is dragged it sits centred just under `anchor`, kept inside its container. */
export function ContextualTaskBar({ place, change, busy, anchor, children, trailing }: { place: TaskBarPlace; change: (patch: Partial<TaskBarPlace>) => void; busy: boolean; anchor?: () => Element | null | undefined; children: ReactNode; trailing?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; y: number; from: [number, number] } | null>(null), [spot, setSpot] = useState<[number, number] | null>(null);
  const follow = useRef(() => {});
  follow.current = () => {
    const element = bar.current, host = element?.parentElement, target = anchor?.();
    if (!element || !host || !target) return;
    const box = target.getBoundingClientRect(), area = host.getBoundingClientRect(), size = element.getBoundingClientRect(), half = size.width / 2;
    const x = Math.min(Math.max(box.left + box.width / 2 - area.left, half + MARGIN), area.width - half - MARGIN);
    const y = Math.max(Math.min(box.bottom - area.top + GAP, area.height - size.height - BOTTOM), MARGIN);
    setSpot(current => current?.[0] === x && current[1] === y ? current : [x, y]);
  };
  useLayoutEffect(() => follow.current());
  const following = !!anchor && !place.hidden;
  useEffect(() => {
    const host = bar.current?.parentElement;
    if (!following || !host) return;
    const update = () => follow.current(), resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    host.addEventListener("scroll", update, true); resize?.observe(host);
    return () => { host.removeEventListener("scroll", update, true); resize?.disconnect(); };
  }, [following]);
  if (place.hidden) return null;
  const shown = place.at ?? spot;
  return <div ref={bar} className="xd-ps-taskbar" role="toolbar" aria-label="Contextual Task Bar" inert={busy} style={shown ? { left: `${shown[0]}px`, top: `${shown[1]}px`, bottom: "auto" } : undefined}>
    <span className="xd-ps-taskbar-grip" aria-hidden="true"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const own = bar.current!.getBoundingClientRect(), area = bar.current!.parentElement!.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, from: place.at ?? [own.left + own.width / 2 - area.left, own.top - area.top] };
      }}
      onPointerMove={event => { const start = drag.current; if (start) change({ at: [start.from[0] + event.clientX - start.x, start.from[1] + event.clientY - start.y] }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}/>
    <div className="xd-ps-taskbar-items">{children}</div>
    <MenuButton label="More options" icon={Ellipsis} iconOnly align="end" items={[
      { label: "Hide bar", run: () => change({ hidden: true }) },
      { label: "Reset bar position", disabled: !place.at, run: () => change({ at: null }) },
      { label: "Pin bar position", checked: place.pinned, run: () => change({ pinned: !place.pinned }) },
    ]}/>
    {trailing}
  </div>;
}
