import { selectionGestureMode, type GestureModifiers, type SelectionMode } from "./selectionGesture";

export type PatchPoint = readonly [number, number];
export type PatchBounds = readonly [number, number, number, number];

/** What a Patch press does, as in Photoshop: Shift, Alt or Alt+Shift, no selection, or a press outside it draws a selection; a plain press inside drags the patch. `bounds` stands in for the selection, as the state has no mask to hit-test. */
export function patchPress(at: PatchPoint, bounds: PatchBounds | null, modifiers: GestureModifiers): SelectionMode | "patch" {
  if (modifiers.shiftKey || modifiers.altKey) return selectionGestureMode("replace", modifiers, "select.lasso");
  if (!bounds) return "replace";
  const [x, y, width, height] = bounds;
  return at[0] >= x && at[0] < x + width && at[1] >= y && at[1] < y + height ? "patch" : "replace";
}

export function patchOffset(start: PatchPoint, end: PatchPoint): [number, number] | null {
  if (![...start, ...end].every(value => Number.isFinite(value) && Math.abs(value) <= 268_435_456)) return null;
  const roundAwayFromZero=(value:number)=>{const rounded=Math.sign(value)*Math.round(Math.abs(value));return rounded===0?0:rounded;};
  const dx = roundAwayFromZero(end[0] - start[0]);
  const dy = roundAwayFromZero(end[1] - start[1]);
  return dx === 0 && dy === 0 || !Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)
    || Math.abs(dx) >= 10_000_000 || Math.abs(dy) >= 10_000_000 ? null : [dx, dy];
}

export function patchOffsetFitsCanvas(offset: PatchPoint, bounds: PatchBounds | null, width: number, height: number): boolean {
  if (![...offset, width, height].every(Number.isFinite) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > 268_435_456 || height > 268_435_456
    || !offset.every(Number.isSafeInteger) || offset.some(value => Math.abs(value) >= 10_000_000)
    || offset[0] === 0 && offset[1] === 0 || !bounds) return false;
  const [x, y, w, h] = bounds;
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) return false;
  return x + offset[0] >= 0 && y + offset[1] >= 0
    && x + w + offset[0] <= width && y + h + offset[1] <= height;
}

export function patchPreviewScale(x:number,y:number,width:number,height:number,startScale:number,maxTiles=8):number|null {
  if(![x,y,width,height,maxTiles].every(Number.isSafeInteger)||x<0||y<0||width<1||height<1||!Number.isSafeInteger(startScale)||startScale<1||startScale>64||(startScale&(startScale-1))!==0||maxTiles<1||!Number.isSafeInteger(x+width)||!Number.isSafeInteger(y+height))return null;
  let scale=startScale;
  const count=()=>{
    const columns=Math.floor((x+width-1)/(512*scale))-Math.floor(x/(512*scale))+1;
    const rows=Math.floor((y+height-1)/(512*scale))-Math.floor(y/(512*scale))+1;
    return columns*rows;
  };
  while(count()>maxTiles&&scale<64)scale*=2;
  return count()<=maxTiles?scale:null;
}

export function patchTarget({
  layer,
  mask,
  quickMask,
  channel,
}: {
  layer: number | null;
  mask: boolean;
  quickMask: boolean;
  channel?: { kind: "composite" } | { kind: "color" | "alpha"; index: number };
}): Record<string, unknown> {
  if (mask && layer !== null) return { layer, target: "mask" };
  if (quickMask) return { target: "quickMask" };
  if (channel?.kind === "alpha") return { target: { channel: channel.index } };
  if (layer !== null) return { layer, target: "pixels" };
  return {};
}

/** The Patch options to send: none for the native patch (Normal, Diffusion 5), which also serves masks, channels and Quick Mask; the engine takes the rest on layer pixels only. */
export function patchOptions(options: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  if (target.target !== "pixels") return {};
  if (options.type === "contentAware") return { type: "contentAware", structure: options.structure, colorAdaptation: options.colorAdaptation, sampleAllLayers: options.sampleAllLayers };
  return options.diffusion === 5 ? {} : { type: "normal", diffusion: options.diffusion };
}
