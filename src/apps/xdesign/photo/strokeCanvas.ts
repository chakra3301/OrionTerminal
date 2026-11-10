import { TILE_SIZE } from "./tiles";

export type StrokeChunk={x:number;y:number;width:number;height:number;scale:number;pixelWidth:number;pixelHeight:number;pixels:Uint8ClampedArray};

const invalid=()=>new Error("Native stroke feedback returned invalid pixels");
/** Reads `xdesign_photo_stroke_pixels`: u32 LE count, six u32 per chunk, then each chunk's straight RGBA. */
export function parseStrokePixels(data:unknown,scale:number,width:number,height:number,edge=TILE_SIZE*scale):StrokeChunk[]{
  const bytes=data instanceof ArrayBuffer?new Uint8Array(data):ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):Array.isArray(data)?Uint8Array.from(data):null;
  if(!bytes||bytes.length<4||!Number.isInteger(scale)||scale<1||scale>64||(scale&(scale-1))!==0)throw invalid();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(0,true);
  if(count>64||bytes.length<4+count*24)throw invalid();
  const chunks:StrokeChunk[]=[];
  let offset=4+count*24;
  for(let i=0;i<count;i++){
    const [x,y,w,h,pixelWidth,pixelHeight]=[0,1,2,3,4,5].map(k=>view.getUint32(4+i*24+k*4,true)) as [number,number,number,number,number,number];
    if(w<1||h<1||x%scale||y%scale||x+w>width||y+h>height||pixelWidth!==Math.ceil(w/scale)||pixelHeight!==Math.ceil(h/scale)||
       Math.floor(x/edge)!==Math.floor((x+w-1)/edge)||Math.floor(y/edge)!==Math.floor((y+h-1)/edge))throw invalid();
    const size=pixelWidth*pixelHeight*4;
    if(offset+size>bytes.length)throw invalid();
    chunks.push({x,y,width:w,height:h,scale,pixelWidth,pixelHeight,pixels:new Uint8ClampedArray(bytes.buffer,bytes.byteOffset+offset,size)});
    offset+=size;
  }
  if(offset!==bytes.length)throw invalid();
  return chunks;
}

/** Adds chunks a redraw must reapply. A chunk covering an earlier one makes it redundant, which
 * keeps retouch feedback (every frame repaints the whole damaged area) from growing per frame. */
export function record(recorded:StrokeChunk[],chunks:readonly StrokeChunk[]){
  for(const chunk of chunks){
    for(let i=recorded.length-1;i>=0;i--){const old=recorded[i]!;if(old.scale===chunk.scale&&old.x>=chunk.x&&old.y>=chunk.y&&old.x+old.width<=chunk.x+chunk.width&&old.y+old.height<=chunk.y+chunk.height)recorded.splice(i,1);}
    recorded.push(chunk);
  }
}

export type SurfaceTile={x:number;y:number;width:number;height:number;scale?:number;image?:HTMLImageElement};
const inside=(tile:SurfaceTile,chunk:StrokeChunk)=>chunk.scale===(tile.scale??1)&&chunk.x>=tile.x&&chunk.x<tile.x+tile.width&&chunk.y>=tile.y&&chunk.y<tile.y+tile.height;
/** Detail tiles as canvases. Live stroke pixels, rendered exactly like the tiles, are patched into
 * these same canvases, so the stroke is never resampled differently from the image under it and
 * nothing visibly swaps when the committed tiles load. */
export class TileSurface{
  private tiles=new Map<HTMLCanvasElement,SurfaceTile>();
  private dirty=new Set<HTMLCanvasElement>();
  private stroke:StrokeChunk[]|null=null;
  show(canvas:HTMLCanvasElement,tile:SurfaceTile){this.tiles.set(canvas,tile);this.draw(canvas,tile);}
  detach(canvas:HTMLCanvasElement){this.tiles.delete(canvas);this.dirty.delete(canvas);}
  /** Chunks painted until `settle` or `restore` are reapplied to tiles that load or redraw meanwhile. */
  begin(){this.stroke=[];}
  /** `replace` drops the previously painted chunks first: Patch and the erasers re-render their whole result. */
  paint(chunks:StrokeChunk[],replace=false){
    if(replace){
      this.stroke=[...chunks];
      for(const [canvas,tile] of this.tiles)if(this.dirty.has(canvas)||chunks.some(chunk=>inside(tile,chunk)))this.draw(canvas,tile);
      return;
    }
    if(this.stroke)record(this.stroke,chunks);
    for(const [canvas,tile] of this.tiles){const context=canvas.getContext("2d");if(context)this.put(canvas,tile,context,chunks);}
  }
  /** The stroke committed; the committed tiles match the painted pixels, and older tiles (undo) must not get them back. */
  settle(){this.stroke=null;this.dirty.clear();}
  /** The stroke did not commit: show the tiles without it. */
  restore(){this.stroke=null;for(const canvas of [...this.dirty]){const tile=this.tiles.get(canvas);if(tile)this.draw(canvas,tile);}this.dirty.clear();}
  private draw(canvas:HTMLCanvasElement,tile:SurfaceTile){
    this.dirty.delete(canvas);
    const context=canvas.getContext("2d");if(!context)return;
    const scale=tile.scale??1,width=Math.ceil(tile.width/scale),height=Math.ceil(tile.height/scale);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    else context.clearRect(0,0,width,height);
    if(tile.image?.naturalWidth)context.drawImage(tile.image,0,0);
    if(this.stroke)this.put(canvas,tile,context,this.stroke);
  }
  private put(canvas:HTMLCanvasElement,tile:SurfaceTile,context:CanvasRenderingContext2D,chunks:readonly StrokeChunk[]){
    const scale=tile.scale??1;
    for(const chunk of chunks)if(inside(tile,chunk)){context.putImageData(new ImageData(chunk.pixels,chunk.pixelWidth,chunk.pixelHeight),(chunk.x-tile.x)/scale,(chunk.y-tile.y)/scale);this.dirty.add(canvas);}
  }
}
