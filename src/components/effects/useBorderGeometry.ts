import { useLayoutEffect, useState, type RefObject } from "react";

export type BorderGeometry = { radius: number; top: number; right: number; bottom: number; left: number };
const px = (value: string) => Math.max(0, parseFloat(value) || 0);
export function borderGeometry(parent: HTMLElement): BorderGeometry {
  const style = getComputedStyle(parent);
  const top = px(style.borderTopWidth), right = px(style.borderRightWidth);
  const bottom = px(style.borderBottomWidth), left = px(style.borderLeftWidth);
  const width = parent.clientWidth + left + right, height = parent.clientHeight + top + bottom;
  const raw = style.borderTopLeftRadius;
  const radius = raw.endsWith("%") ? Math.min(width, height) * px(raw) / 100 : px(raw);
  return { radius: Math.min(radius, width / 2, height / 2), top: -top, right: -right, bottom: -bottom, left: -left };
}

export function useBorderGeometry(ref: RefObject<HTMLElement | null>, theme: string) {
  const [geometry, setGeometry] = useState<BorderGeometry>();
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const next = borderGeometry(parent);
      setGeometry(previous => previous && Object.keys(next).every(key => next[key as keyof BorderGeometry] === previous[key as keyof BorderGeometry]) ? previous : next);
    };
    measure();
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resize?.observe(parent, { box: "border-box" });
    // Radius can change on maximize/theme/class changes without a size change.
    const attributes = new MutationObserver(measure);
    attributes.observe(parent, { attributes: true, attributeFilter: ["class", "style"] });
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => { resize?.disconnect(); attributes.disconnect(); };
  }, [ref, theme]);
  return geometry;
}
