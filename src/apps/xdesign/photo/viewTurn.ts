import { create } from "zustand";

/** Rotate View and View › Flip Horizontal turn only the view, per document and for the session, as in Photoshop. */
export type ViewTurn = { angle: number; flip: boolean };
export const NO_TURN: ViewTurn = { angle: 0, flip: false };

export const normalAngle = (angle: number) => { const turned = ((Math.round(angle) % 360) + 540) % 360 - 180; return turned === -180 ? 180 : turned; };

export const useViewTurn = create<{ turns: Record<string, ViewTurn>; turn: (document: string, change: Partial<ViewTurn>) => void }>(set => ({
  turns: {},
  turn: (document, change) => set(state => {
    const next = { ...(state.turns[document] ?? NO_TURN), ...change };
    return { turns: { ...state.turns, [document]: { angle: normalAngle(next.angle), flip: next.flip } } };
  }),
}));

export const turnTransform = ({ angle, flip }: ViewTurn) => [angle ? `rotate(${angle}deg)` : "", flip ? "scaleX(-1)" : ""].filter(Boolean).join(" ");

/** The screen box a width × height surface fills once turned, which the scroll area has to hold. */
export function turnedSize(width: number, height: number, angle: number): [number, number] {
  const radians = angle * Math.PI / 180, cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  return [width * cos + height * sin, width * sin + height * cos];
}

/** A screen offset from the surface centre in the surface's own unturned axes. */
export function unturn(dx: number, dy: number, { angle, flip }: ViewTurn): [number, number] {
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians), x = dx * cos + dy * sin;
  return [flip ? -x : x, -dx * sin + dy * cos];
}

/** The inverse of unturn. */
export function returnTurn(x: number, y: number, { angle, flip }: ViewTurn): [number, number] {
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians), across = flip ? -x : x;
  return [across * cos - y * sin, across * sin + y * cos];
}

export const turnedSurface = (element: Element) => {
  const surface = element.closest<HTMLElement>(".xd-photo-image"), angle = Number(surface?.dataset.viewAngle) || 0, flip = surface?.dataset.viewFlip !== undefined;
  return surface && (angle || flip) ? { surface, turn: { angle, flip } } : null;
};

// The helpers below take an element covering the whole image surface (the overlay canvas or an overlay svg). A turned
// surface's bounding box is the box around the turned image, so it no longer tells where a point is on the image.

/** The element's unturned size on screen. */
export function surfaceSize(element: Element): [number, number] {
  const turned = turnedSurface(element);
  if (turned) return [turned.surface.offsetWidth, turned.surface.offsetHeight];
  const box = element.getBoundingClientRect(); return [box.width, box.height];
}

/** Where a client point falls on the element, in screen pixels from its unturned top left. */
export function surfaceOffset(element: Element, clientX: number, clientY: number): [number, number] {
  const box = element.getBoundingClientRect(), turned = turnedSurface(element);
  if (!turned) return [clientX - box.left, clientY - box.top];
  const [x, y] = unturn(clientX - box.left - box.width / 2, clientY - box.top - box.height / 2, turned.turn);
  return [turned.surface.offsetWidth / 2 + x, turned.surface.offsetHeight / 2 + y];
}

/** Where a client point falls on the element, as fractions of its width and height. */
export function surfaceFraction(element: Element, clientX: number, clientY: number): [number, number] {
  const [width, height] = surfaceSize(element), [x, y] = surfaceOffset(element, clientX, clientY);
  return [x / width, y / height];
}

/** The inverse of surfaceOffset. */
export function surfaceClient(element: Element, x: number, y: number): [number, number] {
  const box = element.getBoundingClientRect(), turned = turnedSurface(element);
  if (!turned) return [box.left + x, box.top + y];
  const [dx, dy] = returnTurn(x - turned.surface.offsetWidth / 2, y - turned.surface.offsetHeight / 2, turned.turn);
  return [box.left + box.width / 2 + dx, box.top + box.height / 2 + dy];
}

/** The document area under the scroller's viewport, unclipped; turned, the box around it. */
export function visibleArea(scroller: HTMLElement, surface: HTMLElement, zoom: number, width: number, height: number) {
  const frame = scroller.getBoundingClientRect(), box = surface.getBoundingClientRect(), turned = turnedSurface(surface);
  if (!turned) return { x: (frame.left - box.left) / zoom, y: (frame.top - box.top) / zoom, width: scroller.clientWidth / zoom, height: scroller.clientHeight / zoom };
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2, xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const [ux, uy] = unturn(frame.left + x * scroller.clientWidth - cx, frame.top + y * scroller.clientHeight - cy, turned.turn);
    xs.push(width / 2 + ux / zoom); ys.push(height / 2 + uy / zoom);
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
