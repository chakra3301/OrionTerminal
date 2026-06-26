import { create } from "zustand";

/** Screen rectangle (CSS px, top-left origin) of the login card, published by
 * the DOM card and consumed by the WebGL liquid-glass post pass so it can
 * refract the energy core exactly under the card. null ⇒ no glass panel. */
export type GlassRect = {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
};

type GlassRectState = {
  rect: GlassRect | null;
  setRect: (rect: GlassRect | null) => void;
};

export const useGlassRect = create<GlassRectState>((set) => ({
  rect: null,
  setRect: (rect) => set({ rect }),
}));
