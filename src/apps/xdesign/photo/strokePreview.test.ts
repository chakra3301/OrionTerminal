import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NativeStrokePreview, strokeSeed, type StrokePreviewRequest } from "./strokePreview";
import type { DisplayTile, PhotoTile } from "./tiles";
const request=(count:number):StrokePreviewRequest=>({params:{seed:7,points:Array(count).fill([10,10,1])},viewport:{x:0,y:0,width:512,height:512,scale:1},count});
const tile=(x=0):PhotoTile=>({x,y:0,width:512,height:512,scale:1,pixelWidth:512,pixelHeight:512,png:"AA==",selectionPath:"",selectionTruncated:false});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it("streams long strokes in ordered bounded batches and releases native state after an in-flight request",async()=>{
  const load=vi.fn(async(_request:StrokePreviewRequest)=>[tile()]),release=vi.fn(async()=>{}),changed=vi.fn();
  const controller=new NativeStrokePreview(load,changed,{create:()=>"blob:tile",revoke:vi.fn()},65536,{release});
  controller.request(request(9000));await vi.advanceTimersByTimeAsync(100);await flush();
  expect(load).toHaveBeenCalledTimes(5);expect(load.mock.calls.map(call=>(call[0] as StrokePreviewRequest).params._orionOffset)).toEqual([0,2048,4096,6144,8192]);
  expect(changed.mock.lastCall?.[1]).toBe(9000);controller.dispose();expect(release).toHaveBeenCalledOnce();
  let finish!:(tiles:PhotoTile[])=>void;const delayed=new NativeStrokePreview(()=>new Promise(resolve=>finish=resolve),vi.fn(),{create:()=>"blob:tile",revoke:vi.fn()},65536,{release});
  delayed.request(request(1));await vi.advanceTimersByTimeAsync(100);delayed.dispose();expect(release).toHaveBeenCalledTimes(1);finish([tile()]);await flush();expect(release).toHaveBeenCalledTimes(2);
});
it("does not repeatedly retry a failed streamed batch without new samples",async()=>{
  const load=vi.fn().mockRejectedValue(new Error("Native failure"));const controller=new NativeStrokePreview(load,vi.fn(),{create:()=>"blob",revoke:vi.fn()},65536,{release:vi.fn(async()=>{})});
  controller.request(request(9000));await vi.advanceTimersByTimeAsync(100);await flush();expect(load).toHaveBeenCalledOnce();controller.dispose();
});
it("serializes rendering, coalesces points and accepts progressive pixels while a newer prefix waits",async()=>{
  const pending:((value:PhotoTile[])=>void)[]=[];
  const load=vi.fn((_request:StrokePreviewRequest)=>new Promise<PhotoTile[]>(resolve=>pending.push(resolve))),changed=vi.fn();
  const controller=new NativeStrokePreview(load,changed,{create:vi.fn(()=>"blob:tile"),revoke:vi.fn()});
  controller.request(request(1));await vi.advanceTimersByTimeAsync(100);
  controller.request(request(2));controller.request(request(3));expect(load).toHaveBeenCalledTimes(1);
  pending[0]!([tile()]);await flush();expect(changed).toHaveBeenCalledWith(expect.any(Array),1,null);expect(load).toHaveBeenCalledTimes(2);expect(load.mock.calls[1]![0].count).toBe(3);
  controller.dispose();pending[1]!([tile(512)]);await flush();expect(changed).toHaveBeenCalledTimes(1);
});
it("replaces native tiles, retains previous painted areas and releases pixel and selection URLs",async()=>{
  let sequence=0;const create=vi.fn(()=>`blob:${sequence++}`),revoke=vi.fn();
  const load=vi.fn().mockResolvedValueOnce([{...tile(),selectionPng:"AA=="}]).mockResolvedValueOnce([tile(512)]).mockResolvedValue([tile()]);
  const controller=new NativeStrokePreview(load,vi.fn(),{create,revoke});
  for(let count=1;count<=3;count++){controller.request(request(count));await vi.advanceTimersByTimeAsync(100);}
  expect(revoke.mock.calls.flat()).toEqual(["blob:0","blob:1"]);
  controller.dispose();expect(revoke.mock.calls.flat().sort()).toEqual(["blob:0","blob:1","blob:2","blob:3"]);
});
it("rejects oversized data, does not retry a failed prefix forever and cleans up partial decoding",async()=>{
  const create=vi.fn().mockReturnValueOnce("blob:color").mockImplementationOnce(()=>{throw new Error("decode failed");}),revoke=vi.fn(),changed=vi.fn();
  const load=vi.fn().mockResolvedValueOnce([{...tile(),pixelWidth:1024}]).mockResolvedValue([{...tile(),selectionPng:"AA=="}]);
  const controller=new NativeStrokePreview(load,changed,{create,revoke});
  controller.request(request(1));await vi.advanceTimersByTimeAsync(100);expect(create).not.toHaveBeenCalled();
  controller.request(request(1));await vi.advanceTimersByTimeAsync(100);expect(load).toHaveBeenCalledTimes(1);
  controller.request(request(2));await vi.advanceTimersByTimeAsync(100);expect(revoke).toHaveBeenCalledWith("blob:color");expect(changed.mock.calls.at(-1)![2]).toContain("decode failed");controller.dispose();
});
it("bounds accumulated tiles and reports the long-stroke limit without allocating further previews",async()=>{
  const load=vi.fn(async(req:StrokePreviewRequest)=>[tile(req.count*512)]),create=vi.fn(()=>"blob:tile"),revoke=vi.fn(),changed=vi.fn();
  const controller=new NativeStrokePreview(load,changed,{create,revoke});
  for(let count=1;count<=65;count++){controller.request(request(count));await vi.advanceTimersByTimeAsync(100);}
  expect(changed.mock.calls.at(-1)![0]).toHaveLength(64);expect(revoke).toHaveBeenCalledTimes(1);
  controller.request(request(8193));await vi.advanceTimersByTimeAsync(100);expect(load).toHaveBeenCalledTimes(65);expect(changed.mock.calls.at(-1)![2]).toContain("release");controller.dispose();expect(revoke).toHaveBeenCalledTimes(65);
});
it("produces seeds that survive JSON and native integer transport exactly",()=>{
  for(let i=0;i<50;i++){const seed=strokeSeed();expect(Number.isSafeInteger(seed)&&seed>=0).toBe(true);expect(JSON.parse(JSON.stringify(seed))).toBe(seed);}
});
it("keeps the retouch limit visible when an earlier preview finishes and never renders the oversized prefix",async()=>{
  let finish!:(tiles:PhotoTile[])=>void;
  const load=vi.fn(()=>new Promise<PhotoTile[]>(resolve=>finish=resolve)),changed=vi.fn();
  const controller=new NativeStrokePreview(load,changed,{create:()=>"blob:retouch",revoke:vi.fn()},2048);
  controller.request(request(100));await vi.advanceTimersByTimeAsync(100);controller.request(request(2049));
  finish([tile()]);await flush();await vi.advanceTimersByTimeAsync(500);
  expect(load).toHaveBeenCalledOnce();expect(changed.mock.lastCall).toEqual([expect.any(Array),100,expect.stringContaining("release")]);controller.dispose();
});
it("refreshes retouch tiles when the viewport moves without resending sample batches and releases native drafts",async()=>{
  const load=vi.fn(async(_request:StrokePreviewRequest)=>[tile()]),release=vi.fn(async()=>{}),controller=new NativeStrokePreview(load,vi.fn(),{create:()=>"blob:retouch",revoke:vi.fn()},2048,{append:false,release});
  controller.request(request(100));await vi.advanceTimersByTimeAsync(100);await flush();
  controller.request({...request(100),viewport:{...request(100).viewport,x:32}});await vi.advanceTimersByTimeAsync(100);await flush();
  expect(load).toHaveBeenCalledTimes(2);expect(load.mock.calls[1]![0].params).not.toHaveProperty("_orionOffset");
  controller.dispose();await flush();expect(release).toHaveBeenCalledOnce();
});

it("refreshes streamed retouch viewports with one idempotent overlap sample",async()=>{
  const load=vi.fn(async(_request:StrokePreviewRequest)=>[tile()]),release=vi.fn(async()=>{}),controller=new NativeStrokePreview(load,vi.fn(),{create:()=>"blob:streamed-retouch",revoke:vi.fn()},65536,{append:true,release});
  controller.request(request(3000));await vi.advanceTimersByTimeAsync(100);await flush();
  expect(load.mock.calls.map(([request])=>[request.params._orionOffset,(request.params.points as unknown[]).length])).toEqual([[0,2048],[2048,952]]);
  controller.request({...request(3000),viewport:{...request(3000).viewport,x:32}});await vi.advanceTimersByTimeAsync(100);await flush();
  expect(load.mock.lastCall?.[0].params).toMatchObject({_orionOffset:2999,points:[[10,10,1]]});expect(load).toHaveBeenCalledTimes(3);controller.dispose();expect(release).toHaveBeenCalledOnce();
});

it("replaces Patch destination tiles and clears invalidated in-flight generations",async()=>{
  const pending:((value:PhotoTile[])=>void)[]=[];let id=0;
  const create=vi.fn(()=>`blob:patch-${id++}`),revoke=vi.fn(),changed=vi.fn();
  const load=vi.fn((_request:StrokePreviewRequest)=>new Promise<PhotoTile[]>(resolve=>pending.push(resolve)));
  const controller=new NativeStrokePreview(load,changed,{create,revoke});
  controller.replace({...request(1),params:{offset:[8,0]}});await vi.advanceTimersByTimeAsync(100);
  pending[0]!([tile(0)]);await flush();expect(changed.mock.lastCall?.[0].map((entry:DisplayTile)=>entry.x)).toEqual([0]);
  controller.replace({...request(2),params:{offset:[16,0]}});expect(changed.mock.lastCall?.[0]).toEqual([]);await vi.advanceTimersByTimeAsync(100);
  pending[1]!([tile(512)]);await flush();expect(changed.mock.lastCall?.[0].map((entry:DisplayTile)=>entry.x)).toEqual([512]);expect(revoke).toHaveBeenCalledWith("blob:patch-0");

  controller.replace({...request(3),params:{offset:[24,0]}});await vi.advanceTimersByTimeAsync(100);
  controller.clearReplacement();expect(changed.mock.lastCall?.[0]).toEqual([]);
  pending[2]!([tile(1024)]);await flush();expect(changed.mock.lastCall?.[0]).toEqual([]);
  controller.replace({...request(4),params:{offset:[32,0]}});await vi.advanceTimersByTimeAsync(100);
  pending[3]!([tile(1536)]);await flush();expect(changed.mock.lastCall?.[0].map((entry:DisplayTile)=>entry.x)).toEqual([1536]);
  controller.dispose();expect(revoke).toHaveBeenCalledWith("blob:patch-1");expect(revoke).toHaveBeenCalledWith("blob:patch-2");
});
it("paints raw pixels without tile URLs and flushes the release samples before closing",async()=>{
  const pending:((value:ArrayBuffer)=>void)[]=[];
  const load=vi.fn((_request:StrokePreviewRequest)=>new Promise<ArrayBuffer>(resolve=>pending.push(resolve))),changed=vi.fn(),paint=vi.fn(),release=vi.fn(async()=>{}),create=vi.fn();
  const controller=new NativeStrokePreview(load,changed,{create,revoke:vi.fn()},65536,{release},paint);
  controller.request(request(1));await vi.advanceTimersByTimeAsync(100);
  const first=new ArrayBuffer(4);pending[0]!(first);await flush();
  expect(paint).toHaveBeenCalledWith(first,expect.objectContaining({count:1}),false);expect(changed).toHaveBeenLastCalledWith([],1,null);
  let ended=false;controller.request(request(3));void controller.end().then(()=>{ended=true;});controller.request(request(5));
  expect(load).toHaveBeenCalledTimes(2);expect(load.mock.calls[1]![0]).toMatchObject({count:3,params:{_orionOffset:1}});await flush();expect(ended).toBe(false);
  pending[1]!(new ArrayBuffer(4));await flush();expect(ended).toBe(true);await vi.advanceTimersByTimeAsync(100);
  expect(paint).toHaveBeenCalledTimes(2);expect(changed).toHaveBeenCalledOnce();expect(load).toHaveBeenCalledTimes(2);expect(create).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();controller.releaseFeedback();expect(release).toHaveBeenCalledOnce();
});
it("paints replacement results whole, clears them with null and ends without a pending render",async()=>{
  const load=vi.fn(async(_request:StrokePreviewRequest)=>new ArrayBuffer(4)),paint=vi.fn();
  const controller=new NativeStrokePreview(load,vi.fn(),undefined,1_000_000,undefined,paint);
  controller.replace(request(1));await vi.advanceTimersByTimeAsync(100);await flush();
  expect(paint).toHaveBeenLastCalledWith(expect.any(ArrayBuffer),expect.objectContaining({count:1}),true);
  controller.clearReplacement();expect(paint).toHaveBeenLastCalledWith(null,null,true);
  await controller.end();expect(paint).toHaveBeenCalledTimes(2);expect(load).toHaveBeenCalledOnce();
});
