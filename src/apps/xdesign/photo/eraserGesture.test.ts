import { describe,expect,it } from "vitest";
import { BACKGROUND_ERASER_COMMIT_SAMPLES,BACKGROUND_ERASER_PREVIEW_SAMPLES,backgroundEraserCommitAllowed,backgroundEraserPreviewAllowed,backgroundEraserPreviewSampleAllowed,eraserTargetProblem,magicEraserParams,sameEraserGesture,type EraserGestureContext } from "./eraserGesture";

const context=(patch:Partial<EraserGestureContext>={}):EraserGestureContext=>({projectId:"p",photoId:"d",version:"v",viewKey:"view",layerId:4,target:{activeLayer:4,layerKind:"Raster",channelKind:"composite",maskView:false,quickMask:false,paintingMask:false},...patch});

describe("eraser gesture routing",()=>{
  it("caps only provisional feedback while preserving the full native commit budget",()=>{
    const previewSized={points:Array.from({length:BACKGROUND_ERASER_PREVIEW_SAMPLES},()=>[1,2,1,0,0,0,0])};
    const fullStroke={points:Array.from({length:BACKGROUND_ERASER_PREVIEW_SAMPLES+1},()=>[1,2,1,0,0,0,0])};
    expect(backgroundEraserPreviewAllowed(previewSized)).toBe(true);expect(backgroundEraserPreviewAllowed(fullStroke)).toBe(false);
    expect(backgroundEraserPreviewSampleAllowed(0)).toBe(true);expect(backgroundEraserPreviewSampleAllowed(BACKGROUND_ERASER_PREVIEW_SAMPLES)).toBe(true);expect(backgroundEraserPreviewSampleAllowed(BACKGROUND_ERASER_PREVIEW_SAMPLES+1)).toBe(false);expect(backgroundEraserPreviewSampleAllowed(Number.NaN)).toBe(false);
    const maxCommit={points:Array.from({length:BACKGROUND_ERASER_COMMIT_SAMPLES},()=>[1,2,1,0,0,0,0])};
    expect(backgroundEraserCommitAllowed(maxCommit)).toBe(true);expect(backgroundEraserPreviewAllowed(maxCommit)).toBe(false);
    expect(backgroundEraserCommitAllowed({...maxCommit,payload:"x".repeat(16*1024*1024)})).toBe(false);
  });
  it("sends the real click coordinate and validated tool options",()=>{
    expect(magicEraserParams([23.5,41.25,1,10,-5],{tolerance:36,contiguous:false,sampleAllLayers:true})).toEqual({x:23.5,y:41.25,tolerance:36,contiguous:false,sampleAllLayers:true});
    expect(magicEraserParams([Infinity,1],{})).toBeNull();expect(magicEraserParams([999_999_999,0],{})).not.toBeNull();expect(magicEraserParams([1_000_000_000,0],{})).toBeNull();expect(magicEraserParams([-1_000_000_000,0],{})).toBeNull();
  });
  it("rejects non-pixel and non-composite targets",()=>{
    expect(eraserTargetProblem(context().target)).toBeNull();
    expect(eraserTargetProblem({...context().target,layerKind:"Pixel"})).toBeNull();
    expect(eraserTargetProblem({...context().target,layerKind:"Smart Object"})).toContain("pixel layer");
    expect(eraserTargetProblem({...context().target,channelKind:"alpha"})).toContain("composite");
    expect(eraserTargetProblem({...context().target,maskView:true})).toContain("composite");
    expect(eraserTargetProblem({...context().target,quickMask:true})).toContain("composite");
  });
  it("invalidates a gesture when its project, document, layer, version or view changes",()=>{
    const initial=context();expect(sameEraserGesture(initial,context())).toBe(true);
    for(const next of [context({projectId:"other"}),context({photoId:"other"}),context({version:"other"}),context({viewKey:"other"}),context({layerId:5})])expect(sameEraserGesture(initial,next)).toBe(false);
  });
});
