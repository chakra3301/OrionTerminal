import type { PhotoLayer, PhotoState } from "./types";
const MODES: Record<string, string> = { rgb: "RGB", cmyk: "CMYK", lab: "Lab", grayscale: "Gray" };
// Photoshop's tab reads "RGB/8" for a lone Background, "Layer 1, RGB/8" otherwise, and "#" marks a document with no embedded profile; a targeted colour channel replaces the mode ("Layer 1, Red/8").
export function docTabDetail(state: Pick<PhotoState, "mode" | "depth" | "layers" | "colorProfile" | "channels"> | null | undefined, layer: PhotoLayer | null | undefined): string {
  const target = state?.channels?.target;
  const channel = target?.kind === "color" ? state?.channels?.colors?.[target.index]?.name : undefined;
  const mode = channel ?? MODES[(state?.mode ?? "RGB").toLowerCase()] ?? state?.mode ?? "RGB";
  const lone = state?.layers.length === 1 && layer?.name === "Background" && !layer.children;
  return `${layer && !lone ? `${layer.name}, ` : ""}${mode}/${state?.depth ?? 8}${state?.colorProfile && !state.colorProfile.embedded ? "#" : ""}`;
}
