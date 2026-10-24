import { SkiaRenderer } from "@open-pencil/core/canvas";
import { renderNodesToImage } from "@open-pencil/core/io";
import { withNativeOpacityLayers } from "./nativeRendererLifecycle";
import type { CanvasKit, RuntimeEffect } from "canvaskit-wasm";
import type { Fill, SceneGraph, SceneNode } from "@open-pencil/scene-graph";

const SOURCE=`uniform float4 ink; uniform float density; uniform float2 cell; uniform float kind;
float random(float2 p) { return fract(sin(dot(p,float2(127.1,311.7)))*43758.5453); }
half4 main(float2 p) {
  float2 grid=floor(p/cell); float r=random(grid);
  if(kind<3.0) {
    if(r>density) return half4(0);
    float3 c=ink.rgb;
    if(kind<0.5) c*=r;
    else if(kind<1.5) c=mix(ink.rgb,1.0-ink.rgb,r);
    else c=float3(r,random(grid+float2(53,11)),random(grid+float2(7,89)));
    return half4(c*ink.a,ink.a);
  }
  float2 local=fract(p/cell);
  float on=kind<3.5?mod(grid.x+grid.y,2.0):kind<4.5?(length(local-float2(0.5))<0.25?1.0:0.0):(local.x<0.15?1.0:0.0);
  return half4(ink.rgb*ink.a*on,ink.a*on);
}`;
export const CUSTOM_PAINTS = [{id:"orion.checker",label:"Checkerboard"},{id:"orion.dots",label:"Dots"},{id:"orion.stripes",label:"Stripes"}] as const;
const effects=new WeakMap<CanvasKit,RuntimeEffect>();
const BLENDS:Record<string,Exclude<keyof CanvasKit["BlendMode"],"values">>={DARKEN:"Darken",MULTIPLY:"Multiply",COLOR_BURN:"ColorBurn",LIGHTEN:"Lighten",SCREEN:"Screen",COLOR_DODGE:"ColorDodge",OVERLAY:"Overlay",SOFT_LIGHT:"SoftLight",HARD_LIGHT:"HardLight",DIFFERENCE:"Difference",EXCLUSION:"Exclusion",HUE:"Hue",SATURATION:"Saturation",COLOR:"Color",LUMINOSITY:"Luminosity"};
const patternStacks=new WeakMap<SkiaRenderer,Set<string>>();
const exportSources=new WeakMap<SkiaRenderer,SceneGraph>();
export const designPaintSource=(renderer:SkiaRenderer,graph:SceneGraph)=>exportSources.get(renderer)??graph;
/** Upstream selection extraction omits pattern-source dependencies. Resolve
 * paints against the isolated full export graph without rendering its layers. */
export function renderDesignNodes(...args:Parameters<typeof renderNodesToImage>):ReturnType<typeof renderNodesToImage> {
  const renderer=args[1],previous=exportSources.get(renderer),viewport=renderer.worldViewport;exportSources.set(renderer,args[2]);
  try{return withNativeOpacityLayers(renderer,()=>renderNodesToImage(...args));}finally{renderer.worldViewport=viewport;if(previous)exportSources.set(renderer,previous);else exportSources.delete(renderer);}
}
function sourceNode(graph:SceneGraph,id:string){return graph.getNode(id)??[...graph.nodes.values()].find(node=>node.source.id===id);}
function texturePattern(graph:SceneGraph,source:SceneNode,seen=new Set<string>()):boolean {
  if(seen.has(source.id)||seen.size>=128)return false;seen.add(source.id);
  return source.fills.some(fill=>proceduralPaint(fill)||fill.type==="PATTERN"&&!!fill.sourceNodeId&&!!sourceNode(graph,fill.sourceNodeId)&&texturePattern(graph,sourceNode(graph,fill.sourceNodeId)!,seen));
}
function pattern(renderer:SkiaRenderer,fill:Fill,node:SceneNode,graph:SceneGraph):boolean|null {
  if(fill.type!=="PATTERN"||!fill.sourceNodeId)return null;const dependencies=exportSources.get(renderer)??graph,source=sourceNode(graph,fill.sourceNodeId)??sourceNode(dependencies,fill.sourceNodeId);if(!source||source.fillGeometry.some(geometry=>geometry.fills?.length)||!texturePattern(dependencies,source))return null;
  let stack=patternStacks.get(renderer);if(!stack){stack=new Set();patternStacks.set(renderer,stack);}if(source.id===node.id||stack.has(source.id)||stack.size>=128)return false;
  const scale=number(fill.scale,1,.001,100),spacing=fill.patternSpacing??{x:0,y:0},gapX=source.width*scale*number(spacing.x,0,0,100),gapY=source.height*scale*number(spacing.y,0,0,100),width=source.width*scale+gapX,height=source.height*scale+gapY;
  if(!(width>0&&height>0)||!Number.isFinite(width+height))return false;
  const x=fill.horizontalAlignment==="CENTER"?-gapX/2:fill.horizontalAlignment==="END"?-gapX:0,y=fill.verticalAlignment==="CENTER"?-source.height*scale/2:fill.verticalAlignment==="END"?-gapY:0;
  const positions=[[x,y]];if(fill.patternTileType==="HORIZONTAL_HEXAGONAL")positions.push([x+width/2,y+height/2]);if(fill.patternTileType==="VERTICAL_HEXAGONAL")positions.push([x+width/2,y-height/2]);
  const recorder=new renderer.ck.PictureRecorder(),rect=renderer.ck.LTRBRect(0,0,width,height),canvas=recorder.beginRecording(rect);stack.add(source.id);
  try{
    for(const [x,y] of positions){canvas.save();canvas.translate(x!,y!);canvas.scale(scale,scale);
      for(const sourceFill of source.fills){if(!sourceFill.visible||!renderer.applyFill(sourceFill,source,dependencies,source.fills.indexOf(sourceFill)))continue;renderer.fillPaint.setAlphaf(sourceFill.opacity);renderer.fillPaint.setBlendMode(renderer.ck.BlendMode[BLENDS[sourceFill.blendMode??"NORMAL"]??"SrcOver"]);renderer.drawNodeFill(canvas,source,renderer.ck.LTRBRect(0,0,source.width,source.height),source.cornerRadius>0,sourceFill);renderer.fillPaint.setShader(null);}
      canvas.restore();
    }
    const picture=recorder.finishRecordingAsPicture();try{const shader=picture.makeShader(renderer.ck.TileMode.Repeat,renderer.ck.TileMode.Repeat,renderer.ck.FilterMode.Linear,undefined,rect);renderer.fillPaint.setShader(shader);shader.delete();return true;}finally{picture.delete();}
  }finally{stack.delete(source.id);recorder.delete();}
}
export function proceduralPaint(fill:Fill):boolean{return fill.type==="NOISE"||fill.type==="CUSTOM"&&CUSTOM_PAINTS.some(paint=>paint.id===fill.customEffectId);}
function number(value:number|undefined,fallback:number,min:number,max:number){return Number.isFinite(value)?Math.max(min,Math.min(max,value!)):fallback;}
let installed=false;
/** Trusted built-in programs; authored documents cannot supply shader code. */
export function installProceduralPaints():void {
  if(installed)return;installed=true;
  const original=SkiaRenderer.prototype.applyFill;
  SkiaRenderer.prototype.applyFill=function(fill,node,graph,index=0){
    if(fill.type==="PATTERN")graph=exportSources.get(this)??graph;
    const patterned=pattern(this,fill,node,graph);if(patterned!==null)return patterned;
    if(!proceduralPaint(fill))return original.call(this,fill,node,graph,index);
    let effect=effects.get(this.ck);
    if(!effect){const compiled=this.ck.RuntimeEffect.Make(SOURCE);if(!compiled)throw new Error("The design renderer could not compile its texture paints");effect=compiled;effects.set(this.ck,effect);}
    const c=this.resolveFillColor(fill,index,node,graph);
    const kind=fill.type==="NOISE"?fill.noiseType==="DUOTONE"?1:fill.noiseType==="MULTITONE"?2:0:3+CUSTOM_PAINTS.findIndex(paint=>paint.id===fill.customEffectId);
    const scale=number(fill.scale,1,.01,100);
    const size=fill.noiseSize??{x:12*scale,y:12*scale};
    const shader=effect.makeShader([c.r,c.g,c.b,c.a,number(fill.density,.5,0,1),number(size.x,1,.1,4096),number(size.y,1,.1,4096),kind]);
    this.fillPaint.setShader(shader);shader.delete();return true;
  };
}
