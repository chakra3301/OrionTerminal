import { record, type StrokeChunk } from "./strokeCanvas";

/** The image preview as one canvas. The published preview is drawn into it and live stroke
 * damage, rendered exactly like that preview, is patched in place, so the stroke never sits on
 * a differently resampled layer and nothing visibly swaps when the committed preview arrives. */
export class PreviewSurface {
  private canvas:HTMLCanvasElement|null=null;
  private image:HTMLImageElement|null=null;
  private painted=false;
  private stroke:StrokeChunk[]|null=null;
  readonly attach=(canvas:HTMLCanvasElement|null)=>{if(canvas===this.canvas)return;this.canvas=canvas;if(canvas&&this.image)this.draw(this.image);};
  /** Draws a loaded preview; false when it no longer decodes, for example because its source changed. */
  async show(image:HTMLImageElement):Promise<boolean>{
    try{await image.decode();}catch{return false;}
    this.draw(image);return true;
  }
  /** Chunks painted until `settle` or `restore` are reapplied over any preview loaded meanwhile:
   * the preview of the previous commit can arrive after this stroke has started. */
  begin(){this.stroke=[];}
  /** `replace` drops the previously painted chunks first: Patch and the erasers re-render their whole result. */
  paint(chunks:StrokeChunk[],replace=false){
    if(replace){this.stroke=[...chunks];if(this.image&&(this.painted||chunks.length))this.draw(this.image);else this.put(chunks);return;}
    if(this.stroke)record(this.stroke,chunks);
    this.put(chunks);
  }
  /** The stroke committed; its preview matches the painted pixels, and an older preview (undo) must not get them back. */
  settle(){this.stroke=null;}
  /** The stroke did not commit: show the preview without it. */
  restore(){this.stroke=null;if(this.painted&&this.image)this.draw(this.image);}
  private put(chunks:readonly StrokeChunk[]){
    const context=this.canvas?.getContext("2d");if(!context||!chunks.length)return;
    for(const chunk of chunks)context.putImageData(new ImageData(chunk.pixels,chunk.pixelWidth,chunk.pixelHeight),chunk.x,chunk.y);
    this.painted=true;
  }
  private draw(image:HTMLImageElement){
    this.image=image;this.painted=false;
    const canvas=this.canvas,context=canvas?.getContext("2d");if(!canvas||!context)return;
    if(canvas.width!==image.naturalWidth||canvas.height!==image.naturalHeight){canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;}
    else context.clearRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0);
    if(this.stroke)this.put(this.stroke);
  }
}
