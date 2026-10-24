import { afterEach, expect, it, vi } from "vitest";
import { parseStrokePixels, record, TileSurface, type StrokeChunk } from "./strokeCanvas";
const encode=(chunks:number[][],extra=0)=>{
  const body=chunks.reduce((sum,chunk)=>sum+chunk[4]!*chunk[5]!*4,0),buffer=new ArrayBuffer(4+chunks.length*24+body+extra),view=new DataView(buffer);
  view.setUint32(0,chunks.length,true);chunks.forEach((chunk,i)=>chunk.forEach((value,k)=>view.setUint32(4+i*24+k*4,value,true)));return buffer;
};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("reads aligned damage chunks from binary IPC in every transport shape",()=>{
  const buffer=encode([[1024,512,6,4,3,2],[0,0,2,2,1,1]]);new Uint8Array(buffer).set([1,2,3,4],4+48);
  const chunks=parseStrokePixels(buffer,2,2048,1024);
  expect(chunks.map(({pixels:_pixels,...rest})=>rest)).toEqual([{x:1024,y:512,width:6,height:4,scale:2,pixelWidth:3,pixelHeight:2},{x:0,y:0,width:2,height:2,scale:2,pixelWidth:1,pixelHeight:1}]);
  expect([...chunks[0]!.pixels.slice(0,4)]).toEqual([1,2,3,4]);expect(chunks[0]!.pixels).toHaveLength(24);expect(chunks[1]!.pixels).toHaveLength(4);
  expect(parseStrokePixels([...new Uint8Array(buffer)],2,2048,1024)).toHaveLength(2);expect(parseStrokePixels(new Uint8Array(buffer),2,2048,1024)).toHaveLength(2);
});
it.each([
  ["misaligned",[1,0,2,2,1,1]],
  ["out-of-image",[2046,0,4,2,2,1]],
  ["tile-crossing",[1022,0,4,2,2,1]],
  ["wrongly reduced",[0,0,4,2,1,1]],
  ["empty",[0,0,0,2,0,1]],
])("rejects %s chunks",(_label,chunk)=>{expect(()=>parseStrokePixels(encode([chunk]),2,2048,1024)).toThrow("invalid pixels");});
it("rejects truncated, padded and oversized payloads",()=>{
  expect(()=>parseStrokePixels(encode([[0,0,2,2,1,1]],4),2,2048,1024)).toThrow("invalid pixels");
  expect(()=>parseStrokePixels(encode([[0,0,2,2,1,1]]).slice(0,-1),2,2048,1024)).toThrow("invalid pixels");
  expect(()=>parseStrokePixels([],2,2048,1024)).toThrow("invalid pixels");
  const many=new ArrayBuffer(4+65*24);new DataView(many).setUint32(0,65,true);expect(()=>parseStrokePixels(many,2,2048,1024)).toThrow("invalid pixels");
});
const chunk=(x:number,y:number,size:number,scale=1):StrokeChunk=>({x,y,width:size,height:size,scale,pixelWidth:size/scale,pixelHeight:size/scale,pixels:new Uint8ClampedArray(size*size/scale/scale*4)});
it("drops recorded chunks a newer chunk of the same scale covers",()=>{
  const recorded:StrokeChunk[]=[];const inner=chunk(2,2,2),other=chunk(2,2,2,2);
  record(recorded,[inner,other,chunk(20,20,2)]);record(recorded,[chunk(0,0,8)]);
  expect(recorded.map(({x,y,width,scale})=>[x,y,width,scale])).toEqual([[2,2,2,2],[20,20,2,1],[0,0,8,1]]);
});
it("patches stroke chunks into the matching tile canvases and redraws only the touched ones",()=>{
  const calls:string[]=[],names=new Map<HTMLCanvasElement,string>();
  vi.stubGlobal("ImageData",class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockImplementation(function(this:HTMLCanvasElement){const name=names.get(this);return {drawImage:()=>calls.push(`${name} image`),clearRect:()=>calls.push(`${name} clear`),putImageData:(_:unknown,x:number,y:number)=>calls.push(`${name} put ${x},${y}`)} as never;});
  const image=Object.defineProperties(document.createElement("img"),{naturalWidth:{value:512},naturalHeight:{value:512}});
  const a=document.createElement("canvas"),b=document.createElement("canvas"),tileA={x:0,y:0,width:1024,height:1024,scale:2,image},tileB={x:1024,y:0,width:1024,height:1024,scale:2,image};
  names.set(a,"a");names.set(b,"b");
  const surface=new TileSurface();surface.show(a,tileA);surface.show(b,tileB);
  expect([b.width,b.height]).toEqual([512,512]);expect(calls).toEqual(["a image","b image"]);
  calls.length=0;surface.begin();surface.paint(parseStrokePixels(encode([[1024,512,6,4,3,2]]),2,2048,1024));surface.paint([chunk(0,0,4)]);
  expect(calls).toEqual(["b put 0,256"]);
  calls.length=0;surface.show(b,tileB);expect(calls).toEqual(["b clear","b image","b put 0,256"]);
  calls.length=0;surface.restore();expect(calls).toEqual(["b clear","b image"]);
  calls.length=0;surface.begin();surface.paint([chunk(2,2,2,2)]);surface.paint([chunk(1026,0,2,2)],true);
  expect(calls).toEqual(["a put 1,1","a clear","a image","b clear","b image","b put 1,0"]);
  calls.length=0;surface.settle();surface.show(b,tileB);expect(calls).toEqual(["b clear","b image"]);
  calls.length=0;surface.detach(b);surface.begin();surface.paint([chunk(1026,0,2,2)]);expect(calls).toEqual([]);
});
