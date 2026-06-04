import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * One row in a context menu / dropdown. A `separator` renders a divider; an
 * item renders a clickable row. `danger` tints the row red, `checked` shows a
 * check mark, `disabled` greys it out and swallows the click.
 */
export type MenuItem =
  | { type: "separator" }
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      hint?: string;
    };

type MenuState = {
  x: number;
  y: number;
  items: MenuItem[];
  /** "left" = grow right from x (cursor menus); "right" = right-align to x
   * (button dropdowns, so the menu hangs under the button's right edge). */
  align: "left" | "right";
};

/**
 * Reusable context-menu / dropdown controller. One instance per surface that
 * needs menus — call `openAt(event, items)` from an `onContextMenu` handler, or
 * `openFromButton(el, items)` to hang a dropdown under a toolbar button. Render
 * the returned `menu` node once anywhere in the tree (it portals to <body>).
 */
export function useContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);

  const openAt = useCallback(
    (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => {
      e.preventDefault();
      if (items.length === 0) return;
      setState({ x: e.clientX, y: e.clientY, items, align: "left" });
    },
    [],
  );

  const openFromButton = useCallback((el: HTMLElement, items: MenuItem[]) => {
    if (items.length === 0) return;
    const r = el.getBoundingClientRect();
    setState({ x: r.right, y: r.bottom + 4, items, align: "right" });
  }, []);

  const close = useCallback(() => setState(null), []);

  const menu = state ? (
    <ContextMenuView state={state} onClose={close} />
  ) : null;

  return { openAt, openFromButton, close, menu, isOpen: state !== null };
}

function ContextMenuView({
  state,
  onClose,
}: {
  state: MenuState;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure then clamp/flip so the menu never spills off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = state.align === "right" ? state.x - width : state.x;
    let top = state.y;
    if (left + width > vw - 8) left = vw - 8 - width;
    if (left < 8) left = 8;
    if (top + height > vh - 8) {
      // Flip above the anchor point.
      top = state.y - height - (state.align === "right" ? 4 : 0);
      if (top < 8) top = Math.max(8, vh - 8 - height);
    }
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [state]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ot-ctx-menu"
      role="menu"
      style={{
        top: pos?.top ?? state.y,
        left: pos?.left ?? state.x,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item, i) => {
        if (item.type === "separator") {
          return <div key={i} className="ot-ctx-sep" role="separator" />;
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ot-ctx-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick();
            }}
          >
            <span className="ot-ctx-icon" aria-hidden>
              {item.checked ? "✓" : item.icon}
            </span>
            <span className="ot-ctx-label">{item.label}</span>
            {item.hint && <span className="ot-ctx-hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
