import { create } from "zustand";

/** A sampled pixel, in image pixels. */
export type ColorSampler = { x: number; y: number };
/** Photoshop's limit per image. */
export const MAX_COLOR_SAMPLERS = 10;
const NONE: ColorSampler[] = [];

type Store = {
  documents: Record<string, ColorSampler[]>;
  /** False when the image already has the most samplers. */
  add: (document: string, at: ColorSampler) => boolean;
  move: (document: string, index: number, to: ColorSampler) => void;
  remove: (document: string, index: number) => void;
  clear: (document: string) => void;
};

export const useColorSamplers = create<Store>((set, get) => {
  const edit = (document: string, change: (list: ColorSampler[]) => ColorSampler[]) => set(state => ({ documents: { ...state.documents, [document]: change(state.documents[document] ?? NONE) } }));
  return {
    documents: {},
    add: (document, at) => {
      if ((get().documents[document] ?? NONE).length >= MAX_COLOR_SAMPLERS) return false;
      edit(document, list => [...list, at]);
      return true;
    },
    move: (document, index, to) => edit(document, list => list.map((point, i) => i === index ? to : point)),
    remove: (document, index) => edit(document, list => list.filter((_, i) => i !== index)),
    clear: document => edit(document, () => NONE),
  };
});

export const useDocumentSamplers = (document: string) => useColorSamplers(state => state.documents[document] ?? NONE);
