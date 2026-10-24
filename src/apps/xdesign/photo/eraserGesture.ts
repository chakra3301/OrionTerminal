export type EraserTargetState={activeLayer:number|null;layerKind:string|null;channelKind:string|null;maskView:boolean;quickMask:boolean;paintingMask:boolean};
export type EraserGestureContext={projectId:string;photoId:string;version:string;viewKey:string;layerId:number;target:EraserTargetState};
export const BACKGROUND_ERASER_PREVIEW_SAMPLES=4096;
export const BACKGROUND_ERASER_PREVIEW_BYTES=1024*1024;
export const BACKGROUND_ERASER_COMMIT_SAMPLES=131072;
export const BACKGROUND_ERASER_COMMIT_BYTES=16*1024*1024;

export function backgroundEraserPreviewSampleAllowed(sampleCount:number):boolean {
  return Number.isSafeInteger(sampleCount)&&sampleCount>=0&&sampleCount<=BACKGROUND_ERASER_PREVIEW_SAMPLES;
}

export function backgroundEraserPreviewAllowed(params:Record<string,unknown>):boolean {
  const points=params.points;
  return Array.isArray(points)&&points.length<=BACKGROUND_ERASER_PREVIEW_SAMPLES&&JSON.stringify(params).length<=BACKGROUND_ERASER_PREVIEW_BYTES;
}

export function backgroundEraserCommitAllowed(params:Record<string,unknown>):boolean {
  const points=params.points;
  return Array.isArray(points)&&points.length<=BACKGROUND_ERASER_COMMIT_SAMPLES&&JSON.stringify(params).length<=BACKGROUND_ERASER_COMMIT_BYTES;
}

export function eraserTargetProblem(target:EraserTargetState):string|null {
  if(!["Pixel","Raster"].includes(target.layerKind??"")||target.activeLayer===null)return "The erasers work on an active pixel layer.";
  if(target.channelKind&&target.channelKind!=="composite"||target.maskView||target.quickMask||target.paintingMask)return "The erasers edit layer pixels. Switch to the composite pixel layer first.";
  return null;
}

export function sameEraserGesture(captured:EraserGestureContext,current:EraserGestureContext):boolean {
  return captured.projectId===current.projectId&&captured.photoId===current.photoId&&captured.version===current.version&&captured.viewKey===current.viewKey&&captured.layerId===current.layerId&&JSON.stringify(captured.target)===JSON.stringify(current.target);
}

export function magicEraserParams(point:readonly number[],options:Record<string,unknown>):Record<string,unknown>|null {
  if(point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1])||Math.abs(point[0]!)>=1_000_000_000||Math.abs(point[1]!)>=1_000_000_000)return null;
  return {x:point[0],y:point[1],...options};
}
