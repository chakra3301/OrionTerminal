import { useCallback, useRef, useState, type MouseEvent } from "react";

export type MultiSelect<T extends string> = {
  selected: Set<T>;
  isSelected: (id: T) => boolean;
  toggle: (id: T) => void;
  rangeTo: (id: T, allIds: T[]) => void;
  replace: (id: T) => void;
  clear: () => void;
  /**
   * Handle a tile click. Returns true when the click was consumed by
   * selection (caller should skip its default open behavior); false when the
   * click had no modifiers and the caller should run its default action.
   */
  handleClick: (id: T, allIds: T[], e: MouseEvent) => boolean;
};

export function useMultiSelect<T extends string>(): MultiSelect<T> {
  const [selected, setSelected] = useState<Set<T>>(new Set());
  const anchorRef = useRef<T | null>(null);

  const toggle = useCallback((id: T) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const rangeTo = useCallback((id: T, allIds: T[]) => {
    const anchor = anchorRef.current;
    if (!anchor) {
      setSelected(new Set([id]));
      anchorRef.current = id;
      return;
    }
    const startIdx = allIds.indexOf(anchor);
    const endIdx = allIds.indexOf(id);
    if (startIdx < 0 || endIdx < 0) {
      setSelected(new Set([id]));
      anchorRef.current = id;
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    setSelected((cur) => {
      const next = new Set(cur);
      for (let i = lo; i <= hi; i++) {
        const v = allIds[i];
        if (v) next.add(v);
      }
      return next;
    });
  }, []);

  const replace = useCallback((id: T) => {
    setSelected(new Set([id]));
    anchorRef.current = id;
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const handleClick = useCallback(
    (id: T, allIds: T[], e: MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        rangeTo(id, allIds);
        return true;
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
        return true;
      }
      return false;
    },
    [toggle, rangeTo],
  );

  return {
    selected,
    isSelected: (id) => selected.has(id),
    toggle,
    rangeTo,
    replace,
    clear,
    handleClick,
  };
}
