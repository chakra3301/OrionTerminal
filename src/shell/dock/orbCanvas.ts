import { particlePhysics, type orbModel, type Pointer } from "./orbModel";

import type { SpatialIdentity } from "@/identity/spatialIdentity";
import type { ParticleSurface } from "@/identity/particleSurface";
import { drawSpatialOrb } from "@/identity/drawSpatialOrb";
import { drawRosieField } from "./rosieField";

type Model = ReturnType<typeof orbModel>;
export type OrbCanvas = {
  x: CanvasRenderingContext2D; P: number; R: number; q: number;
  model: Model; color: string; coreColor: string;
  m: Pointer | null; last: Pointer | null;
  st: Record<"shell" | "nodes" | "spikes" | "core", ReturnType<typeof particlePhysics>>;
  nodeXY: Float32Array;
  glyph?: { spatial: SpatialIdentity; state: ReturnType<typeof particlePhysics>; showField: boolean; ink?: string; surface?: ParticleSurface };
};

export function drawOrb(o: OrbCanvas, t: number, reduced: boolean) {
  if (o.glyph) { drawSpatialOrb(o, t, reduced); return; }
  drawRosieField(o, t, reduced);
}
