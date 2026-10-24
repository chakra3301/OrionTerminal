import type { DisplayTile, PhotoTile, TileRect } from "./tiles";
import { tileKey, TILE_CAPACITY } from "./tiles";
import { photoPreviewURL } from "./imageView";

export type StrokePreviewRequest={params:Record<string,unknown>;viewport:TileRect;count:number};
/** One render in flight, coalesced point updates, native pixels retained behind
 * the pointer, and deterministic seeds shared with the final single commit. */
export class NativeStrokePreview {
  private latest:StrokePreviewRequest|null=null;
  private pending=false;
  private closed=false;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private entries=new Map<string,DisplayTile>();
  private scale=1;
  private attempted=0;
  private attemptedViewport="";
  private completed=0;
  private acknowledged=0;
  private released=false;
  private retained=false;
  private replacementGeneration=0;
  private replacementLatest=false;
  private attemptedReplacementGeneration=0;
  private ending=false;
  private ended:(()=>void)|null=null;
  constructor(
    private load:(request:StrokePreviewRequest)=>Promise<PhotoTile[]|ArrayBuffer>,
    private changed:(tiles:DisplayTile[],count:number,error:string|null)=>void,
    private urls={create:photoPreviewURL,revoke:(url:string)=>URL.revokeObjectURL(url)},
    private maxSamples=8192,
    private streaming?:{release:()=>Promise<unknown>;append?:boolean},
    /** Pixel mode: raw damage goes straight to the caller's canvas instead of tile URLs. `replace`
     * results stand for the whole preview; `null` data clears it. */
    private paint?:(data:unknown,request:StrokePreviewRequest|null,replace:boolean)=>void,
  ){}
  request(request:StrokePreviewRequest){
    if(this.closed||this.ending)return;
    this.latest=request;
    this.replacementLatest=false;
    if(request.count>this.maxSamples){this.changed([...this.entries.values()],this.completed,"Native feedback will finish rendering on release");return;}
    // One frame, not 100ms: the brush must follow the pointer. While a render is in flight,
    // newer samples coalesce and go out as soon as it returns.
    if(!this.pending&&!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.pump();},16);
  }
  replace(request:StrokePreviewRequest){
    if(this.closed)return;
    this.replacementGeneration++;
    this.latest=request;this.replacementLatest=true;
    this.release();this.completed=0;
    this.changed([],request.count,null);
    if(!this.pending&&!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.pump();},100);
  }
  clearReplacement(){
    if(this.closed)return;
    this.replacementGeneration++;this.latest=null;this.replacementLatest=true;
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    this.release();this.completed=0;this.paint?.(null,null,true);this.changed([],0,null);
  }
  private async pump(){
    const latest=this.latest;
    let request=latest;
    const replacement=this.replacementLatest,generation=this.replacementGeneration;
    if(this.closed||this.pending||!request||request.count>this.maxSamples||request.count===this.attempted&&JSON.stringify(request.viewport)===this.attemptedViewport&&(!replacement||generation===this.attemptedReplacementGeneration)){if(this.ending&&!this.pending&&!this.closed){this.closed=true;this.latest=null;this.releaseNative();this.finish();}return;}
    this.attemptedReplacementGeneration=generation;
    this.pending=true;this.attempted=request.count;this.attemptedViewport=JSON.stringify(request.viewport);
    if(!replacement&&this.streaming&&this.streaming.append!==false){const points=request.params.points;if(!Array.isArray(points)||points.length!==request.count){this.pending=false;this.changed([...this.entries.values()],0,"Invalid stroke sample batch");return;}const start=this.acknowledged===request.count?Math.max(0,this.acknowledged-1):this.acknowledged,end=Math.min(request.count,this.acknowledged+2048);request={...request,count:end,params:{...request.params,points:points.slice(start,end),_orionOffset:start}};}
    try{
      const tiles=await this.load(request);if(replacement&&generation!==this.replacementGeneration)return;if(this.streaming&&!replacement){this.acknowledged=request.count;this.attempted=request.count;}if(this.closed)return;
      if(this.paint){this.paint(tiles,request,replacement);this.completed=request.count;if(!this.ending)this.changed([],request.count,this.latest&&this.latest.count>this.maxSamples?"Native feedback will finish rendering on release":null);return;}
      if(!Array.isArray(tiles)||tiles.length>8||tiles.some(tile=>!Number.isSafeInteger(tile.x)||!Number.isSafeInteger(tile.y)||tile.x<0||tile.y<0||!Number.isSafeInteger(tile.width)||!Number.isSafeInteger(tile.height)||tile.width<1||tile.height<1||tile.scale!==request.viewport.scale||tile.pixelWidth!==Math.ceil(tile.width/(tile.scale??1))||tile.pixelHeight!==Math.ceil(tile.height/(tile.scale??1))||tile.pixelWidth!>512||tile.pixelHeight!>512||typeof tile.png!=="string"||tile.png.length>4*1024*1024||(tile.selectionPng!==undefined&&(typeof tile.selectionPng!=="string"||tile.selectionPng.length>4*1024*1024))))throw new Error("Native stroke feedback returned invalid pixels");
      const allocated:DisplayTile[]=[];
      try {for(const tile of tiles){const {png,selectionPng,...metadata}=tile;const url=this.urls.create(png);let selectionUrl:string|undefined;try {if(selectionPng)selectionUrl=this.urls.create(selectionPng);}catch(error){this.urls.revoke(url);throw error;}allocated.push({...metadata,url,selectionUrl});}}
      catch(error){for(const tile of allocated)this.releaseTile(tile);throw error;}
      if(replacement){this.release();this.scale=request.viewport.scale??1;for(const tile of allocated)this.entries.set(tileKey(tile),tile);}
      else {if(this.scale!==request.viewport.scale){this.release();this.scale=request.viewport.scale??1;}for(const tile of allocated){const key=tileKey(tile),previous=this.entries.get(key);if(previous)this.releaseTile(previous);this.entries.delete(key);this.entries.set(key,tile);}}
      while(this.entries.size>TILE_CAPACITY){const key=this.entries.keys().next().value!;this.releaseTile(this.entries.get(key)!);this.entries.delete(key);}
      this.completed=request.count;
      this.changed([...this.entries.values()],request.count,this.latest&&this.latest.count>this.maxSamples?"Native feedback will finish rendering on release":null);
    }catch(error){if(replacement&&generation!==this.replacementGeneration)return;if(this.streaming&&!replacement)this.attempted=latest!.count;if(!this.closed&&!this.ending)this.changed([...this.entries.values()],0,`Native paint feedback: ${String(error)}`);}
    finally{this.pending=false;if(this.closed)this.releaseNative();else if(this.ending||this.latest&&(this.latest.count!==this.attempted||JSON.stringify(this.latest.viewport)!==this.attemptedViewport||this.replacementLatest&&generation!==this.replacementGeneration))void this.pump();}
  }
  private releaseTile(tile:DisplayTile){this.urls.revoke(tile.url);if(tile.selectionUrl)this.urls.revoke(tile.selectionUrl);}
  private release(){for(const tile of this.entries.values())this.releaseTile(tile);this.entries.clear();}
  private releaseNative(){if(this.streaming&&!this.released&&!this.retained){this.released=true;void this.streaming.release().catch(()=>{});}}
  /** Hand the current tiles to the caller, who now owns (and must revoke) their URLs. */
  detach():DisplayTile[]{const tiles=[...this.entries.values()];this.entries.clear();return tiles;}
  releaseFeedback(){this.retained=false;if(!this.pending)this.releaseNative();}
  /** Pixel mode: paint the samples still queued so the canvas matches the stroke the commit
   * renders, then close. Resolves once they are painted (or failed), so the commit can wait for
   * them instead of racing them. Without a painter there is nothing to finish. */
  end():Promise<void>{
    if(this.closed)return Promise.resolve();
    if(!this.paint){this.dispose(false);return Promise.resolve();}
    const ended=new Promise<void>(resolve=>{const previous=this.ended;this.ended=()=>{previous?.();resolve();};});
    if(this.ending)return ended;
    this.ending=true;this.retained=true;
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(!this.pending)void this.pump();
    return ended;
  }
  private finish(){const ended=this.ended;this.ended=null;ended?.();}
  dispose(releaseNative=true){this.retained=!releaseNative;this.closed=true;if(this.timer)clearTimeout(this.timer);this.release();this.latest=null;if(!this.pending)this.releaseNative();this.finish();}
}

export function strokeSeed():number {
  const bytes=crypto.getRandomValues(new Uint32Array(2));
  return (bytes[0]!&0x1fffff)*0x100000000+bytes[1]!;
}
