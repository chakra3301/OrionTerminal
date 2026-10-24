import type { CSSProperties } from "react";

/** Photoshop's Show Sampling Ring: the colour being picked over the previous one, around the cursor. */
export function SamplingRing({ x, y, color, previous }: { x: number; y: number; color: string; previous: string }) {
  return <div className="xd-photo-sampling-ring" aria-hidden="true" style={{ left: x, top: y, "--ring-new": color, "--ring-old": previous } as CSSProperties} />;
}
