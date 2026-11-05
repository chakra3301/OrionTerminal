import { afterEach, expect, it, vi } from "vitest";
import { PreviewSurface } from "./previewSurface";
import type { StrokeChunk } from "./strokeCanvas";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const chunk=(x:number):StrokeChunk=>({x,y:0,width:1,height:1,scale:1,pixelWidth:1,pixelHeight:1,pixels:new Uint8ClampedArray(4)});
const setup=()=>{
  const calls:string[]=[];
  vi.stubGlobal("ImageData",class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:()=>calls.push("image"),clearRect:()=>calls.push("clear"),putImageData:(_:unknown,x:number)=>calls.push(`put ${x}`)} as never);
  const image=document.createElement("img");Object.defineProperties(image,{naturalWidth:{value:40},naturalHeight:{value:30},decode:{value:async()=>{},configurable:true}});
  return {calls,image,canvas:document.createElement("canvas"),surface:new PreviewSurface()};
};
it("sizes the canvas to the preview and redraws it into a newly attached canvas",async()=>{
  const {calls,image,canvas,surface}=setup();
  expect(await surface.show(image)).toBe(true);surface.attach(canvas);
  expect([canvas.width,canvas.height]).toEqual([40,30]);expect(calls).toEqual(["image"]);
  surface.attach(canvas);expect(calls).toEqual(["image"]);
  Object.defineProperty(image,"decode",{value:async()=>{throw new Error("source changed");}});expect(await surface.show(image)).toBe(false);expect(calls).toEqual(["image"]);
});
it("reapplies a live stroke over a preview that loads under it, but not once it settled",async()=>{
  const {calls,image,canvas,surface}=setup();surface.attach(canvas);await surface.show(image);calls.length=0;
  surface.begin();surface.paint([chunk(1)]);surface.paint([chunk(2)]);
  await surface.show(image);expect(calls).toEqual(["put 1","put 2","clear","image","put 1","put 2"]);
  calls.length=0;surface.settle();await surface.show(image);expect(calls).toEqual(["clear","image"]);
});
it("restores the preview without a stroke that did not commit",async()=>{
  const {calls,image,canvas,surface}=setup();surface.attach(canvas);await surface.show(image);
  surface.restore();expect(calls).toEqual(["image"]);
  surface.begin();surface.paint([chunk(3)]);calls.length=0;surface.restore();expect(calls).toEqual(["clear","image"]);
  calls.length=0;await surface.show(image);expect(calls).toEqual(["clear","image"]);
});
it("replaces the whole live result for Patch and the erasers, and clears it with an empty result",async()=>{
  const {calls,image,canvas,surface}=setup();surface.attach(canvas);await surface.show(image);calls.length=0;
  surface.begin();surface.paint([chunk(1)]);surface.paint([chunk(2)],true);expect(calls).toEqual(["put 1","clear","image","put 2"]);
  calls.length=0;surface.paint([],true);expect(calls).toEqual(["clear","image"]);
  calls.length=0;await surface.show(image);expect(calls).toEqual(["clear","image"]);
});
