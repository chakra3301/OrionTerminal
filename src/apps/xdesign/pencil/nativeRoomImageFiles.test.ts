import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ulid } from 'ulid';
import { NativeRoomTransport } from './nativeRoomTransport';
import { createRoomImageManifest, roomImageBytesDigest } from './roomImageProtocol';
import { roomBinary } from './sharedRoomProtocol';
import { readRoomImageFileStatus, type RoomImageFileInfo, type RoomImageFileScope } from './roomImageFileProtocol';
import type { PhotoDocument } from '../photo/types';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => true }));
const documentId = 'image_document_0001', handle = 'image_file_handle_01';
const transports: NativeRoomTransport[] = [], signal = () => new AbortController().signal;
const open = async () => { const transport = await NativeRoomTransport.open('https://rooms.example.test', documentId); transports.push(transport); return transport; };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); native.invoke.mockReset(); native.invoke.mockImplementation(async (command: string) => command === 'xdesign_room_open' ? handle : undefined); });
afterEach(async () => { await Promise.all(transports.splice(0).map(transport => transport.dispose())); vi.unstubAllGlobals(); });
async function fixture() {
  const scope: RoomImageFileScope = { projectId: ulid(), memberId: 'image_member_00001', transferId: 'image_transfer_001' };
  const id = ulid(), version = ulid(), localId = ulid(), bytes = new Uint8Array([80,75,3,4,9,0,255]), digest = await roomImageBytesDigest(bytes);
  const source: PhotoDocument = { id, version, name: 'Editable Image 🙂', width: 24, height: 24, previewWidth: 24, previewHeight: 24, bundlePath: `/assets/xdesign/${scope.projectId}/${id}/${version}.pcraft`, previewPath: `/assets/xdesign/${scope.projectId}/${id}/${version}.png`, originalPath: '/original.psd' };
  const info: RoomImageFileInfo = { name: source.name, width:24,height:24,previewWidth:24,previewHeight:24,archiveBytes:bytes.length,archiveDigest:digest,previewDigest:'b'.repeat(64),chunkDigests:[digest] };
  const manifest = await createRoomImageManifest({ imageId:'shared_image_00001',previousRevisionId:null,...info });
  const photo: PhotoDocument = { ...source, id:localId,bundlePath:`/assets/xdesign/${scope.projectId}/${localId}/${version}.pcraft`,previewPath:`/assets/xdesign/${scope.projectId}/${localId}/${version}.png`,originalPath:null };
  const prefix = { version:1,documentId,...scope }, ready = { ...prefix,direction:'upload',state:'ready',source,manifest:null,info,received:[],photo:null }, receiving = { ...prefix,direction:'download',state:'receiving',source:null,manifest,info,received:[],photo:null };
  const chunk = { version:1 as const,index:0,sha256:digest,data:roomBinary(bytes) }, imported = { ...receiving,state:'imported',received:[0],photo };
  return { scope,source,info,manifest,bytes,chunk,prefix,ready,receiving,imported,part:{...prefix,chunk},discarded:{...prefix,discarded:true} };
}
it('uses seven closed native file actions under the same immutable handle and operation sequence', async () => {
  const f = await fixture(), transport = await open(), actions: unknown[] = [];
  native.invoke.mockImplementation(async (command: string,args: { operation:{ action:{ kind:string } };handle:string;sequence:number }) => {
    if(command!=='xdesign_room_image_file_request')return;
    expect(command).toBe('xdesign_room_image_file_request'); expect(args.handle).toBe(handle); actions.push(structuredClone(args.operation));
    switch(args.operation.action.kind) { case 'prepare': return f.ready; case 'read': return f.part; case 'stage': return f.receiving; case 'put': return {...f.receiving,received:[0]}; case 'import': return f.imported; case 'discard': return f.discarded; default:return f.ready; }
  });
  await transport.prepareImageFile(f.scope,f.source,signal()); await transport.imageFileStatus(f.scope,{direction:'upload',source:f.source},signal());
  expect((await transport.readImageFileChunk(f.scope,f.info,0,signal())).bytes).toEqual(f.bytes);
  await transport.stageImageFile(f.scope,f.manifest,signal()); await transport.putImageFileChunk(f.scope,f.chunk,f.manifest,signal());
  expect((await transport.importImageFile(f.scope,f.manifest,signal())).photo).toEqual(f.imported.photo); await transport.discardImageFile(f.scope,signal());
  expect(actions).toEqual([{version:1,...f.scope,action:{kind:'prepare',photo:f.source}},{version:1,...f.scope,action:{kind:'status'}},{version:1,...f.scope,action:{kind:'read',index:0}},
    {version:1,...f.scope,action:{kind:'stage',manifest:f.manifest}},{version:1,...f.scope,action:{kind:'put',index:0,chunk:f.chunk}},{version:1,...f.scope,action:{kind:'import'}},{version:1,...f.scope,action:{kind:'discard'}}]);
  expect(native.invoke.mock.calls.filter(call=>call[0]==='xdesign_room_image_file_request').map(call=>call[1].sequence)).toEqual([1,2,3,4,5,6,7]);
});
it('admits reordered native source keys and copies caller scope and source metadata before dispatch', async () => {
  const f=await fixture(),transport=await open(),source=structuredClone(f.source),scope={...f.scope};
  const sorted=Object.fromEntries(Object.entries(f.source).sort(([a],[b])=>a.localeCompare(b))); native.invoke.mockResolvedValue({...f.ready,source:sorted});
  const work=transport.prepareImageFile(scope,source,signal());scope.memberId='other_member_0001';source.name='Caller mutation';await work;
  expect(native.invoke.mock.lastCall![1].operation).toEqual({version:1,...f.scope,action:{kind:'prepare',photo:f.source}});
});
it('refuses foreign scope, changed original source and unsupported response fields', async () => {
  const f=await fixture(),transport=await open();
  for(const patch of [{version:2},{documentId:'other_document_001'},{memberId:'other_member_0001'},{projectId:ulid()},{transferId:'other_transfer_001'},{credential:'secret'},{source:{...f.source,name:'Changed original'}},{info:{...f.info,width:25}},{state:'receiving'},{received:[0]}]) {
    native.invoke.mockResolvedValue({...f.ready,...patch});await expect(transport.prepareImageFile(f.scope,f.source,signal())).rejects.toThrow();
  }
});
it('requires immutable download manifests, exact native chunk acknowledgements and completed import or discard', async () => {
  const f=await fixture(),transport=await open();native.invoke.mockResolvedValue(f.receiving);
  await expect(transport.putImageFileChunk(f.scope,f.chunk,f.manifest,signal())).rejects.toThrow(/acknowledge/);
  await expect(transport.importImageFile(f.scope,f.manifest,signal())).rejects.toThrow(/acknowledge/);
  native.invoke.mockResolvedValue({...f.discarded,discarded:false});await expect(transport.discardImageFile(f.scope,signal())).rejects.toThrow(/acknowledge/);
  for(const patch of [{manifest:{...f.manifest,name:'Changed original'}},{info:{...f.info,chunkDigests:['0'.repeat(64)]}},{received:[0,0]},{state:'imported',photo:null}]) {
    native.invoke.mockResolvedValue({...f.receiving,...patch});await expect(transport.stageImageFile(f.scope,f.manifest,signal())).rejects.toThrow();
  }
});
it('rejects imported file paths from another project or image and preserves original-source boundaries', async () => {
  const f=await fixture(),transport=await open();
  for(const patch of [{originalPath:'/original.psd'},{bundlePath:f.source.bundlePath},{previewPath:f.source.previewPath},{bundlePath:f.imported.photo.bundlePath.replace(f.scope.projectId,ulid())},{width:25},{id:ulid()},{credential:'secret'}]) {
    native.invoke.mockResolvedValue({...f.imported,photo:{...f.imported.photo,...patch}});await expect(transport.importImageFile(f.scope,f.manifest,signal())).rejects.toThrow();
  }
  const windows={...f.imported,photo:{...f.imported.photo,bundlePath:f.imported.photo.bundlePath.replaceAll('/','\\'),previewPath:f.imported.photo.previewPath.replaceAll('/','\\')}};
  native.invoke.mockResolvedValue(windows);expect((await transport.importImageFile(f.scope,f.manifest,signal())).photo).toEqual(windows.photo);
});
it('checks native chunk bytes against the original inventory and refuses altered or foreign chunks', async () => {
  const f=await fixture(),transport=await open();
  for(const patch of [{transferId:'other_transfer_001'},{chunk:{...f.chunk,index:1}},{chunk:{...f.chunk,data:roomBinary(new Uint8Array(f.bytes.length))}},{chunk:{...f.chunk,sha256:'0'.repeat(64)}},{credential:'secret'}]) {
    native.invoke.mockResolvedValue({...f.part,...patch});await expect(transport.readImageFileChunk(f.scope,f.info,0,signal())).rejects.toThrow();
  }
});
it('retains upload preparation and importing progress through explicit status recovery', async () => {
  const f=await fixture(),transport=await open();native.invoke.mockResolvedValue({...f.ready,state:'preparing',info:null});
  expect((await transport.imageFileStatus(f.scope,{direction:'upload',source:f.source},signal())).state).toBe('preparing');
  native.invoke.mockResolvedValue({...f.receiving,state:'importing',received:[0]});expect((await transport.imageFileStatus(f.scope,{direction:'download',manifest:f.manifest},signal())).state).toBe('importing');
  native.invoke.mockResolvedValue(f.imported);expect((await transport.imageFileStatus(f.scope,{direction:'download',manifest:f.manifest},signal())).photo).toEqual(f.imported.photo);
  const upload=await readRoomImageFileStatus({...f.ready,state:'preparing',info:null},documentId,f.scope,{direction:'upload',source:f.source});expect(upload.info).toBeNull();
});
it('shares single-flight preparation with network actions and ignores aborted native file decoding', async () => {
  const f=await fixture(),transport=await open();let release!:()=>void,hashing=false;const digest=webcrypto.subtle.digest.bind(webcrypto.subtle);
  vi.stubGlobal('crypto',{subtle:{digest:async(...args:Parameters<typeof digest>)=>{hashing=true;await new Promise<void>(resolve=>{release=resolve;});return digest(...args);}}});
  const scope={...f.scope},manifest=structuredClone(f.manifest),controller=new AbortController(),work=transport.stageImageFile(scope,manifest,controller.signal),ignored=expect(work).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(hashing).toBe(true));scope.transferId='other_transfer_001';manifest.name='Caller mutation';expect(transport.inFlight).toBe(true);
  await expect(transport.imageCatalog(signal())).rejects.toMatchObject({code:'busy'});controller.abort();vi.stubGlobal('crypto',webcrypto);release();await ignored;expect(native.invoke).toHaveBeenCalledTimes(1);
  let resolve!:(value:unknown)=>void;native.invoke.mockImplementation(async(command:string)=>command==='xdesign_room_image_file_request'?new Promise(done=>{resolve=done;}):undefined);
  const late=transport.importImageFile(f.scope,f.manifest,signal()),rejected=expect(late).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));await transport.dispose();resolve(f.imported);await rejected;
});
it('retains the active lease through canceled IPC and uses the same native cancel sequence', async () => {
  const f=await fixture(),transport=await open();let resolve!:(value:unknown)=>void;
  native.invoke.mockImplementation(async(command:string)=>command==='xdesign_room_image_file_request'?new Promise(done=>{resolve=done;}):undefined);
  const controller=new AbortController(),work=transport.prepareImageFile(f.scope,f.source,controller.signal),ignored=expect(work).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));controller.abort();expect(transport.inFlight).toBe(true);
  expect(native.invoke.mock.lastCall).toEqual(['xdesign_room_cancel',{handle,sequence:1}]);await expect(transport.discardImageFile(f.scope,signal())).rejects.toMatchObject({code:'busy'});resolve(f.ready);await ignored;expect(transport.inFlight).toBe(false);
});
it('rejects invalid outgoing scopes, local documents, original digests and indices before native dispatch', async () => {
  const f=await fixture(),transport=await open();
  await expect(transport.prepareImageFile({...f.scope,projectId:'../outside'},f.source,signal())).rejects.toThrow();
  await expect(transport.prepareImageFile(f.scope,{...f.source,id:f.source.id.toLowerCase()},signal())).rejects.toThrow();
  await expect(transport.prepareImageFile(f.scope,{...f.source,credential:'secret'} as PhotoDocument,signal())).rejects.toThrow();
  await expect(transport.prepareImageFile(f.scope,{...f.source,originalPath:'x'.repeat(140_000)},signal())).rejects.toThrow(/limit/);
  await expect(transport.stageImageFile(f.scope,{...f.manifest,name:'Changed hash'},signal())).rejects.toThrow(/integrity/);
  await expect(transport.putImageFileChunk(f.scope,{...f.chunk,data:roomBinary(new Uint8Array(f.bytes.length))},f.manifest,signal())).rejects.toThrow(/immutable/);
  await expect(transport.readImageFileChunk(f.scope,f.info,1,signal())).rejects.toThrow();expect(native.invoke).toHaveBeenCalledTimes(1);
});
it('does not reflect native file failure text or turn it into a successful import', async () => {
  const f=await fixture(),transport=await open();native.invoke.mockImplementation(async(command:string)=>{if(command==='xdesign_room_image_file_request')throw {status:422,code:'file',message:'/sensitive/local/path'};});
  const error=await transport.importImageFile(f.scope,f.manifest,signal()).catch(error=>error);expect(error).toMatchObject({status:422,code:'file'});expect(error.message).toContain('Original files were retained');expect(error.message).not.toContain('sensitive');
});
